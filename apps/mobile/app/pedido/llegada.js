// Confirmar que el pedido LLEGÓ a la sala, NATIVO — el `LlegadaModal` del
// portal: caja por caja (bien, dañada o no llegó), el Electrolit, las cajas
// especiales y las cajas de más. Lo escribe `confirmarLlegadaDePedido` del
// núcleo, la misma función que usa el portal; los avisos a Bodega los manda la
// base. Guarda borrador: se llena con las cajas enfrente y la sesión se cierra
// sola.
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPedidoItemsAll, fetchPedidosEnCurso } from '@nucleo/data/pedidos';
import { confirmarLlegadaDePedido } from '@nucleo/data/llegadaDePedido';
import { electrolitFueraDeEspeciales } from '@nucleo/utils/cajasEspeciales';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const ESTADOS = [['ok', 'Bien', MARCA.verde], ['danada', 'Dañada', MARCA.ambar], ['faltante', 'No llegó', MARCA.rojo]];

function Tres({ valor, onCambiar, opciones = ESTADOS }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {opciones.map(([id, rotulo, color]) => {
        const activo = valor === id;
        return (
          <Pressable key={id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(id); }}
            style={({ pressed }) => ({ minHeight: 38, paddingHorizontal: 12, borderRadius: 19, justifyContent: 'center',
              backgroundColor: activo ? color : 'rgba(127,127,127,0.16)', opacity: pressed ? 0.7 : 1 })}>
            <Text style={{ color: activo ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Llegada() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const { user } = useAuth();
  const clave = `llegada_app_${pedidoId}_${sucId}`;
  const [fila, setFila] = useState(undefined);
  const [items, setItems] = useState([]);
  const [estados, setEstados] = useState({});
  const [electrolit, setElectrolit] = useState(null);   // null sin responder, 0 todas, N faltan
  const [esp, setEsp] = useState({});
  const [extras, setExtras] = useState([]);              // [{ caja, sinRotulacion }]
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([fetchPedidosEnCurso(), fetchPedidoItemsAll(pedidoId, Number(sucId))]).then(([{ data }, rows]) => {
      if (!vivo) return;
      setFila((data ?? []).find((r) => r.pedido_id === pedidoId && Number(r.erp_sucursal_id) === Number(sucId)) ?? null);
      setItems(rows ?? []);
      const b = loadDraft(clave);
      if (b) { setEstados(b.estados ?? {}); setElectrolit(b.electrolit ?? null); setEsp(b.esp ?? {}); setExtras(b.extras ?? []); setNota(b.nota ?? ''); }
    });
    return () => { vivo = false; };
  }, [pedidoId, sucId, clave]);
  useEffect(() => { if (fila) saveDraft(clave, { estados, electrolit, esp, extras, nota }); }, [fila, clave, estados, electrolit, esp, extras, nota]);

  const cajas = useMemo(() => {
    const mapa = fila?.caja_map ?? {};
    const nums = Object.keys(mapa).length ? Object.keys(mapa).map(Number).sort((a, b) => a - b)
      : Array.from({ length: Number(fila?.total_cajas) || 0 }, (_, i) => i + 1);
    return nums;
  }, [fila]);
  const especiales = Array.isArray(fila?.cajas_especiales) ? fila.cajas_especiales : [];
  const electrolitAparte = fila ? electrolitFueraDeEspeciales(fila.cajas_electrolit ?? 0, especiales) : 0;
  const est = (n) => estados[n] ?? 'ok';
  const danadas = cajas.filter((n) => est(n) === 'danada');
  const faltantes = cajas.filter((n) => est(n) === 'faltante');
  const extrasMal = extras.findIndex((x) => !x.sinRotulacion && !String(x.caja || '').trim());
  const falta = electrolitAparte > 0 && electrolit === null ? 'Responde si llegó todo el Electrolit.'
    : extrasMal >= 0 ? `Caja de más ${extrasMal + 1}: escribe su número o marca «Sin rotulación».` : null;

  const confirmar = async () => {
    setEnviando(true); trabajando('Confirmando la llegada…');
    try {
      const notas = extras.length ? Object.fromEntries(extras.map((x, i) => [i, x.sinRotulacion ? 'Sin rotulación' : `Caja #${String(x.caja).trim()}`])) : null;
      const r = await confirmarLlegadaDePedido({
        pedidoId, sucId: Number(sucId), rows: items, userId: user?.id ?? null,
        cajasDanadas: danadas, cajasFaltantes: faltantes, nota: nota.trim(),
        electrolitFaltantes: electrolitAparte > 0 ? electrolit : null,
        especialesLlegadas: especiales.length ? Object.fromEntries(especiales.map((e) => [e.label, esp[e.label] ?? 'ok'])) : null,
        cajasExtra: extras.length, cajasExtraNotas: notas,
      });
      useStaffStore.getState().appendAuditLog?.('PEDIDO_LLEGADA_CONFIRMADA', pedidoId, { tipo: r.tipo, cajasFaltantes: faltantes, cajasDanadas: danadas, cajasExtra: extras.length, cajasExtraNotas: notas, desde: 'app' });
      clearDraft(clave);
      listo('Llegada confirmada', r.tipo === 'completa' ? 'Ya puedes contar lo que llegó' : 'Bodega recibe el aviso de lo que faltó');
      router.back();
    } catch (e) {
      fallo('No se pudo confirmar la llegada', mensajeAmigable(e));
    } finally {
      setEnviando(false);
    }
  };

  if (fila === undefined) return <Stack.Screen options={{ ...BARRA_NATIVA, title: `Pedido #${numero ?? ''}` }} />;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Llegó el #${numero ?? fila?.numero ?? ''}` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {!fila ? <Aviso tono="freno" texto="Este pedido ya no está en camino." /> : (
            <>
              <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 4 }}>{`${ERP_NAMES[Number(sucId)] ?? ''} · revisa cada caja antes de abrirla`}</Text>
              {cajas.length ? (
                <Seccion titulo={`Cajas · ${cajas.length}`}>
                  {cajas.map((n, i) => (
                    <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{`Caja ${n}`}</Text>
                      <Tres valor={est(n)} onCambiar={(v) => setEstados((s) => ({ ...s, [n]: v }))} />
                    </View>
                  ))}
                </Seccion>
              ) : null}

              {electrolitAparte > 0 ? (
                <Seccion titulo={`Electrolit · ${electrolitAparte} caja${electrolitAparte === 1 ? '' : 's'}`}>
                  <Tres valor={electrolit === null ? null : electrolit === 0 ? 'si' : 'no'}
                    opciones={[['si', 'Llegaron todas', MARCA.verde], ['no', 'Faltan', MARCA.rojo]]}
                    onCambiar={(v) => setElectrolit(v === 'si' ? 0 : Math.max(1, electrolit || 1))} />
                  {electrolit > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>¿Cuántas faltan?</Text>
                      <View style={{ width: 90 }}><Campo multiline={false} value={String(electrolit)} keyboardType="number-pad" style={{ textAlign: 'center' }}
                        onChangeText={(t) => setElectrolit(Math.min(electrolitAparte, Math.max(1, Number(t.replace(/\D/g, '')) || 1)))} /></View>
                    </View>
                  ) : null}
                </Seccion>
              ) : null}

              {especiales.length ? (
                <Seccion titulo="Cajas especiales">
                  {especiales.map((e, i) => (
                    <View key={e.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{e.label}</Text>
                      <Tres valor={esp[e.label] ?? 'ok'} opciones={[['ok', 'Llegó', MARCA.verde], ['faltante', 'No llegó', MARCA.rojo]]}
                        onCambiar={(v) => setEsp((s) => ({ ...s, [e.label]: v }))} />
                    </View>
                  ))}
                </Seccion>
              ) : null}

              <Seccion titulo={`Cajas de más · ${extras.length}`}>
                {extras.map((x, i) => (
                  <View key={i} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`Caja de más ${i + 1}`}</Text>
                      <Pressable onPress={() => setExtras((xs) => xs.filter((_, j) => j !== i))} hitSlop={6}><Text style={{ color: MARCA.rojo, fontSize: 14 }}>Quitar</Text></Pressable>
                    </View>
                    {!x.sinRotulacion ? <Campo multiline={false} value={x.caja ?? ''} placeholder="Número de caja" keyboardType="number-pad"
                      onChangeText={(t) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, caja: t.replace(/\D/g, '') } : y)))} /> : null}
                    <Tres valor={x.sinRotulacion ? 'sin' : 'con'} opciones={[['con', 'Tiene número', MARCA.azulClaro], ['sin', 'Sin rotulación', MARCA.ambar]]}
                      onCambiar={(v) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, sinRotulacion: v === 'sin' } : y)))} />
                  </View>
                ))}
                <BotonGrande texto="Llegó una caja de más" borde onPress={() => setExtras((xs) => [...xs, { caja: '', sinRotulacion: false }])} />
              </Seccion>

              <Seccion titulo="Nota (opcional)">
                <Campo value={nota} onChangeText={setNota} placeholder="Algo que Bodega deba saber" />
              </Seccion>
              {danadas.length || faltantes.length ? (
                <Aviso tono="cuidado" texto={`${faltantes.length ? `No llegaron: ${faltantes.join(', ')}. ` : ''}${danadas.length ? `Dañadas: ${danadas.join(', ')}.` : ''} Bodega recibe el aviso.`} />
              ) : null}
              {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
              <BotonGrande texto={enviando ? 'Confirmando…' : 'Confirmar llegada'} color={MARCA.azul} deshabilitado={enviando || !!falta} onPress={confirmar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
