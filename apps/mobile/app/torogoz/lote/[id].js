// Un lote de Torogoz, NATIVO — el `LoteModal` del inventario del portal: sus
// movimientos (entradas, ventas, ajustes, devoluciones, con quién y cuándo) y,
// para quien administra, el ajuste: la existencia contada y el vencimiento,
// con su motivo obligatorio. Escribe con la misma función de la base
// (`ajustarLote`), que deja el movimiento.
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { ajustarLote, fetchMovimientosDeLote } from '@nucleo/data/distribucionInventario';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { TIPO_MOVIMIENTO, estadoDeVencimiento, leerEntero } from '@nucleo/utils/distribucionBodega';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { formatQty } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useStaffStore } from '@nucleo/store/staffStore';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import FechaOpcional from '../../../componentes/torogoz/bodega/FechaOpcional';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../../componentes/formulario/Piezas';
import { MARCA } from '../../../componentes/inicio/marca';
import { fallo, listo } from '../../../componentes/Progreso';
import { volver } from '../../../componentes/volver';
import { Chapa, PETROLEO, confirmar } from '../../../componentes/torogoz/bodega/piezas';

export default function Lote() {
  const p = useLocalSearchParams();
  const lote = { id: Number(p.id), nombre: p.nombre ?? `Lote ${p.id}`, lote: p.lote ?? '', vence: p.vence || null, existencia: Number(p.existencia ?? 0) };
  const { hasPermission } = useAuth();
  const puedeAjustar = !!hasPermission?.('distribucion_config', 'can_edit');
  const [movs, setMovs] = useState(null);
  const [errorMovs, setErrorMovs] = useState('');
  const [existencia, setExistencia] = useState(String(lote.existencia));
  const [vence, setVence] = useState(lote.vence ?? '');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchMovimientosDeLote(lote.id)
      .then((r) => { if (vivo) setMovs(r); })
      .catch(() => { if (vivo) { setMovs([]); setErrorMovs('No se pudo cargar el historial del lote.'); } });
    return () => { vivo = false; };
  }, [lote.id]);

  const cant = leerEntero(existencia);
  const cambia = cant !== null && (cant !== lote.existencia || (vence || null) !== (lote.vence ?? null));
  const listoParaGuardar = puedeAjustar && cambia && motivo.trim() !== '' && !guardando;
  const v = estadoDeVencimiento(lote.vence);

  const guardar = async () => {
    const ok = await confirmar('¿Guardar el ajuste?',
      `${lote.nombre}, lote ${lote.lote}: ${formatQty(lote.existencia)} → ${formatQty(cant)} unidades${(vence || null) !== (lote.vence ?? null) ? `, vence ${vence ? fechaNumerica(vence) : 'sin fecha'}` : ''}. Queda en el historial con el motivo.`,
      'Guardar ajuste');
    if (!ok) return;
    setGuardando(true);
    try {
      await ajustarLote({ loteId: lote.id, existencia: cant, vence: vence || null, nota: motivo.trim() });
      useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_LOTE_AJUSTE', String(lote.id),
        { lote: lote.lote, antes: lote.existencia, despues: cant, vence_antes: lote.vence, vence: vence || null, motivo: motivo.trim(), desde: 'app' });
      listo('Ajuste guardado', lote.nombre);
      volver('/torogoz/inventario');
    } catch (e) {
      fallo('No se pudo guardar', mensajeDeDistribucion(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Lote ${lote.lote}`, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
        <Seccion>
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{lote.nombre}</Text>
          <Dato primero rotulo="Lote" valor={lote.lote} />
          <Dato rotulo="Vence" valor={lote.vence ? fechaNumerica(lote.vence) : 'Sin fecha'} />
          <View style={{ alignItems: 'flex-end' }}><Chapa variante={v.variant} texto={v.texto} /></View>
          <Dato rotulo="Existencia" valor={`${formatQty(lote.existencia)} unidades`} fuerte />
        </Seccion>

        {puedeAjustar ? (
          <Seccion titulo="Ajustar" pie={`Hoy dice ${formatQty(lote.existencia)}. El ajuste deja un movimiento con el motivo.`}>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Existencia contada</Text>
            <Campo multiline={false} keyboardType="number-pad" value={existencia} onChangeText={setExistencia} />
            {cant === null ? <Aviso tono="freno" texto="Escribe un número entero." /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Vence</Text>
              <FechaOpcional valor={vence} onCambiar={setVence} />
            </View>
            <Campo value={motivo} onChangeText={setMotivo} placeholder="Motivo: conteo físico, producto dañado, fecha mal capturada…" />
            <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar ajuste'} color={PETROLEO} onPress={guardar} deshabilitado={!listoParaGuardar} />
          </Seccion>
        ) : null}

        <Seccion titulo="Movimientos">
          {errorMovs ? <Aviso tono="freno" texto={errorMovs} /> : null}
          {movs === null ? <ActivityIndicator /> : movs.length === 0 ? <Aviso texto="Sin movimientos." /> : movs.map((m, i) => {
            const t = TIPO_MOVIMIENTO[m.tipo] ?? { label: m.tipo, variant: 'neutral' };
            return (
              <View key={m.id} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Chapa variante={t.variant} texto={t.label} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                      {`${fechaNumerica(m.created_at)} ${hora12(m.created_at)}${m.employees ? ` · ${shortEmployeeName(m.employees)}` : ''}`}
                    </Text>
                  </View>
                  {m.nota ? <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{m.nota}</Text> : null}
                  {m.pedido_id && !m.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Pedido ${m.pedido_id}`}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: m.cantidad < 0 ? MARCA.rojo : MARCA.verde, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                    {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                  </Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>{`queda ${m.existencia_despues}`}</Text>
                </View>
              </View>
            );
          })}
        </Seccion>
      </ScrollView>
    </>
  );
}
