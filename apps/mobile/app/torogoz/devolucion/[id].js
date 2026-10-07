// Torogoz › devolución de un Crédito Fiscal, NATIVO — el `DevolucionModal` del
// portal (borrador 0017): el cliente regresa parte de lo que compró y sale una
// Nota de Crédito por eso.
//
// Por renglón y LOTE, porque lo que vuelve tiene que volver a su lote (o no
// volver: dañado o vencido va a cuarentena). Sólo deja pedir lo que la base va
// a aceptar —lo vendido menos lo ya devuelto—, y el total es el de los
// productos con IVA (`totalDevolucion`, del núcleo); la nota calcula el exacto
// con la percepción o retención del original. Un reintento tras un corte no
// emite dos notas: el `clientUuid` es uno por intento.
//
// ⚠ Emite una Nota de Crédito ante Hacienda y mueve inventario y cartera DE
// VERDAD: en el entorno de pruebas la función no está y no se puede probar.
import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { emitirNotaCredito, fetchDevolucionDisponible, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { avisoDeNotaDeCredito, claveDeDevolucion, DESTINOS_DEVOLUCION, totalDevolucion } from '@nucleo/utils/distribucionFacturacion';
import { nuevoUuid } from '@nucleo/utils/distribucionComercial';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../../componentes/formulario/Piezas';
import Segmentos from '../../../componentes/Segmentos';
import Vidrio from '../../../componentes/Vidrio';
import { fallo, listo, trabajando } from '../../../componentes/Progreso';
import { volver } from '../../../componentes/volver';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../../componentes/torogoz/soloConsulta';

const PETROLEO = '#0f6e7d';
const DESTINOS = DESTINOS_DEVOLUCION.map((x) => ({ id: x.value, label: x.label }));

export default function Devolucion() {
  const { id } = useLocalSearchParams();
  const dteId = Number(id);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [unidades, setUnidades] = useState({});
  const [destino, setDestino] = useState({});
  const [motivo, setMotivo] = useState('');
  const [emitiendo, setEmitiendo] = useState(false);
  const [uuid] = useState(() => nuevoUuid());

  useEffect(() => {
    let vivo = true;
    fetchDevolucionDisponible(dteId).then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { if (vivo) setError(mensajeDeDistribucion(e)); });
    return () => { vivo = false; };
  }, [dteId]);

  const items = useMemo(() => (datos?.items ?? []).map((it) => ({ ...it, clave: claveDeDevolucion(it) })), [datos]);
  const pedidos = useMemo(() => items.map((it) => ({ ...it, pide: unidades[it.clave] ?? '', destino: destino[it.clave] ?? 'reingreso' })), [items, unidades, destino]);
  const { total, renglones, errores } = useMemo(() => totalDevolucion(pedidos), [pedidos]);
  const listoParaEmitir = !!datos?.puede && renglones.length > 0 && !errores.length && motivo.trim() !== '' && !emitiendo;
  const doc = datos?.documento;

  const emitir = () => Alert.alert('¿Emitir la nota de crédito?',
    `${renglones.length} renglón${renglones.length === 1 ? '' : 'es'} por ${formatMoney(total)} (con IVA). Se transmite a Hacienda y no se deshace.`, [
      { text: 'Revisar', style: 'cancel' },
      { text: 'Emitir', onPress: async () => {
        setEmitiendo(true); trabajando('Emitiendo la nota de crédito…');
        try {
          const r = await emitirNotaCredito({ dteId, clientUuid: uuid, motivo: motivo.trim(), renglones });
          useStaffStore.getState().appendAuditLog?.('DISTRIBUCION_NOTA_CREDITO', String(r?.dte_id ?? ''),
            { origen: dteId, total: r?.total, renglones: renglones.length, a_favor: r?.a_favor, motivo: motivo.trim(), via: 'app' });
          listo('Nota de crédito emitida', avisoDeNotaDeCredito(r, formatMoney));
          if (r?.dte_id) router.replace(`/torogoz/documento/${r.dte_id}`); else volver('/torogoz/documentos');
        } catch (e) {
          fallo('No se pudo emitir', mensajeDeDistribucion(e));
        } finally { setEmitiendo(false); }
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Devolución' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          {doc ? (
            <Vidrio radio={22}>
              <View style={{ padding: 16, gap: 4 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{doc.cliente}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${doc.numero_control} · ${fechaNumerica(doc.fec_emi)}`}</Text>
              </View>
            </Vidrio>
          ) : null}
          {error ? <Aviso tono="freno" texto={error} /> : null}
          {!datos && !error ? <Aviso tono="nota" texto="Cargando…" /> : null}
          {datos && !datos.puede ? <Aviso tono="cuidado" texto={datos.motivo} /> : null}
          {datos?.notas?.length ? (
            <Aviso tono="nota" texto={`Ya tiene ${datos.notas.length} nota${datos.notas.length === 1 ? '' : 's'} de crédito por ${formatMoney(datos.notas.reduce((a, n) => a + Number(n.total), 0))}. Abajo sólo se puede devolver lo que queda.`} />
          ) : null}
          {datos?.puede ? (
            <>
              <Seccion titulo="Qué devuelve">
                {pedidos.map((it, i) => {
                  const sinQueda = it.disponibles <= 0;
                  const mal = errores.includes(it.clave);
                  return (
                    <View key={it.clave} style={{ gap: 8, opacity: sinQueda ? 0.45 : 1, paddingTop: i ? 12 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{it.descripcion}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {`${it.lote ? `Lote ${it.lote}${it.vence ? ` · vence ${fechaNumerica(it.vence)}` : ''} · ` : ''}vendidas ${it.vendidas}${it.devueltas ? ` · ya devueltas ${it.devueltas}` : ''} · ${formatMoney(Number(it.precio_unitario))} c/u`}
                      </Text>
                      {!sinQueda ? (
                        <>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{`Devuelve (de ${it.disponibles})`}</Text>
                            <View style={{ width: 100 }}>
                              <Campo multiline={false} value={it.pide} keyboardType="number-pad" placeholder="0" style={{ textAlign: 'center', borderWidth: mal ? 2 : 0, borderColor: colorSistema.rojo }}
                                onChangeText={(v) => setUnidades((u) => ({ ...u, [it.clave]: v.replace(/\D/g, '') }))} />
                            </View>
                          </View>
                          {mal ? <Aviso tono="freno" texto={`Hasta ${it.disponibles}.`} /> : null}
                          <Segmentos margen={14} activa={it.destino} onCambiar={(v) => setDestino((x) => ({ ...x, [it.clave]: v }))} opciones={DESTINOS} />
                        </>
                      ) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Ya no queda nada por devolver.</Text>}
                    </View>
                  );
                })}
              </Seccion>
              <Seccion titulo="¿Por qué devuelve? (va en la nota)">
                <Campo value={motivo} onChangeText={setMotivo} placeholder="Ej.: dos cajas llegaron golpeadas" />
              </Seccion>
              <Vidrio radio={22}>
                <View style={{ padding: 16, gap: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                      {`${renglones.filter((r) => r.destino === 'reingreso').length} vuelven a bodega · ${renglones.filter((r) => r.destino === 'cuarentena').length} a cuarentena`}
                    </Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(total)}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Si la venta se fió y todavía se debe, la nota se descuenta de esa cuenta. Si ya estaba pagada, te dice cuánto devolverle al cliente.</Text>
                </View>
              </Vidrio>
              {/* La nota de crédito se emite ante Hacienda: en sólo consulta, desde el portal. */}
              {ACCIONES_DE_DINERO
                ? <BotonGrande color={PETROLEO} texto={emitiendo ? 'Emitiendo…' : 'Emitir nota de crédito'} deshabilitado={!listoParaEmitir} onPress={emitir} />
                : <SeHaceEnElPortal texto="La nota de crédito se emite desde el portal." />}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
