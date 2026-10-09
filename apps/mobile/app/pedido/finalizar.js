// Finalizar la preparación de una sala, NATIVO — el `FinalizarCajasModal` del
// portal en tres pasos: cuántas cajas salen, qué hoja va en qué caja, y qué
// sale distinto de lo asignado (con la revisión de existencia contra el
// sistema corriendo desde que se abre, como en el portal).
//
// Las cuentas (`finalizarCajas`) y la escritura (`finalizarPedidoConCajas`,
// con su orden) son las del núcleo, las mismas del portal.
//
// Las HOJAS son las del papel: las guarda el portal al generar el pedido o al
// finalizarlo, calculadas del PDF exacto. Si este pedido todavía no las tiene,
// no se inventan acá — un reparto distinto del papel le diría a la sala que la
// hoja 3 está en la caja 2 cuando está en la 1.
import { volver } from '../../componentes/volver';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPedidoItemsAll, fetchPedidoSucursalStatus, fetchTrasladoErp, lanzarSimulacroTraslado } from '@nucleo/data/pedidos';
import { finalizarPedidoConCajas } from '@nucleo/data/accionesDeBodega';
import {
  ajustesDeEnvio, ajustesDelSimulacro, alternarCaja, armarCajaMap, armarPaginaItems, asignacionCompleta, asignacionInicial,
  cuantasCajas, despachablesDe,
} from '@nucleo/utils/finalizarCajas';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const PASOS = [{ id: 1, label: 'Cajas' }, { id: 2, label: 'Hojas' }, { id: 3, label: 'Qué sale' }];

function Chip({ texto, activo, onPress, color = MARCA.azulClaro }) {
  return (
    <Pressable onPress={onPress} hitSlop={4}
      style={({ pressed }) => ({ minWidth: 44, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10,
        backgroundColor: activo ? color : `${color}22`, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <Text style={{ color: activo ? '#fff' : colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{texto}</Text>
    </Pressable>
  );
}

export default function FinalizarPedido() {
  const { pedidoId, sucId, numero } = useLocalSearchParams();
  const suc = Number(sucId);
  const BORRADOR = `finalizar-app-${pedidoId}-${suc}`;
  const [items, setItems] = useState(null);
  const [hojas, setHojas] = useState(null);
  const [paso, setPaso] = useState(1);
  const [cajasTexto, setCajasTexto] = useState(() => loadDraft(BORRADOR)?.cajasTexto ?? '');
  const [asignacion, setAsignacion] = useState([]);
  const [ajustes, setAjustes] = useState({});
  const [buscar, setBuscar] = useState('');
  const [simuId, setSimuId] = useState(null);
  const [simu, setSimu] = useState(null);
  const [simuError, setSimuError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([
      fetchPedidoItemsAll(pedidoId, suc).catch(() => []),
      Promise.resolve(fetchPedidoSucursalStatus(pedidoId, suc, 'paginas')).catch(() => ({ data: null })),
    ]).then(([rows, { data }]) => { setItems(rows ?? []); setHojas(Array.isArray(data?.paginas) ? data.paginas : []); });
  }, [pedidoId, suc]);

  // La revisión de existencia arranca al abrir: tarda lo que lleva contar las cajas.
  useEffect(() => {
    let vivo = true;
    lanzarSimulacroTraslado(pedidoId, suc).then(({ trasladoId, error }) => {
      if (!vivo) return;
      if (error) setSimuError(String(error?.message ?? error));
      else setSimuId(trasladoId);
    }).catch((e) => { if (vivo) setSimuError(mensajeAmigable(e)); });
    return () => { vivo = false; };
  }, [pedidoId, suc]);
  useEffect(() => {
    if (!simuId || (simu && simu.estado !== 'en_curso')) return undefined;
    let vivo = true;
    const t = setInterval(() => {
      Promise.resolve(fetchTrasladoErp(simuId)).then(({ data }) => { if (vivo && data) setSimu(data); }).catch(() => {});
    }, 3000);
    return () => { vivo = false; clearInterval(t); };
  }, [simuId, simu]);
  // Lo que el sistema no pudo resolver arranca en cero; no pisa lo ya tocado.
  useEffect(() => {
    if (simu?.estado !== 'verificado' || !items) return;
    const nuevos = ajustesDelSimulacro(simu, items);
    setAjustes((prev) => ({ ...nuevos, ...prev }));
  }, [simu, items]);

  useEffect(() => { saveDraft(BORRADOR, { cajasTexto }); }, [BORRADOR, cajasTexto]);

  const totalHojas = hojas?.length ?? 0;
  const cajas = cuantasCajas(cajasTexto);
  const despachables = useMemo(() => despachablesDe(items ?? []), [items]);
  const lista = useMemo(() => ajustesDeEnvio(ajustes, items ?? []), [ajustes, items]);
  const noSalen = lista.filter((a) => a.cantidad_enviada === 0).length;
  const encontrados = useMemo(() => (buscar.trim().length >= 2
    ? despachables.filter((r) => !(String(r.id) in ajustes) && tokenMatch(buscar, r.products?.nombre, r.products?.laboratorios?.nombre)).slice(0, 6)
    : []), [buscar, despachables, ajustes]);

  const irAHojas = () => { setAsignacion(asignacionInicial(totalHojas, cajas)); setPaso(2); };
  const setCantidad = (id, valor, motivo) => setAjustes((prev) => ({ ...prev, [id]: { cantidad: valor, motivo: motivo ?? prev[id]?.motivo ?? '' } }));
  const quitar = (id) => setAjustes((prev) => { const n = { ...prev }; delete n[id]; return n; });

  const finalizar = async () => {
    setGuardando(true);
    trabajando('Finalizando…');
    try {
      const cajaMap = armarCajaMap(asignacion, cajas);
      const paginaItems = armarPaginaItems(hojas);
      const r = await finalizarPedidoConCajas({ pedidoId, sucId: suc, rows: items, totalCajas: cajas, cajaMap, paginaItems, ajustesEnvio: lista });
      // El segundo toque de un doble toque: ya estaba finalizado; no se anota ni se despacha otra vez.
      if (r.yaEstaba) {
        clearDraft(BORRADOR);
        listo('Ya estaba finalizado', 'Esta sala ya se había finalizado.');
        volver('/pedidos');
        return;
      }
      useStaffStore.getState().appendAuditLog?.('PEDIDO_FINALIZADO', pedidoId, {
        totalCajas: cajas, cajasElectrolit: r.cajasElectrolit, cajasEspeciales: r.cajasEspeciales.length,
        cajas: Object.keys(cajaMap).length, ajustes_envio: lista.length, no_enviados: noSalen, desde: 'app',
      });
      clearDraft(BORRADOR);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (r.despacho.ok) listo(`Pedido #${numero} finalizado`, `${cajas} caja${cajas === 1 ? '' : 's'}.`);
      else fallo('Quedó finalizado, pero no salió del sistema', r.despacho.error ?? 'Se puede reintentar desde el pedido.');
      volver('/pedidos');
    } catch (e) {
      fallo('No se pudo finalizar', mensajeAmigable(e));
    } finally {
      setGuardando(false);
    }
  };
  const confirmar = () => Alert.alert(`Finalizar el pedido #${numero}`,
    `${cajas} caja${cajas === 1 ? '' : 's'} · ${totalHojas} hoja${totalHojas === 1 ? '' : 's'}${noSalen ? ` · ${noSalen} producto${noSalen === 1 ? '' : 's'} no sale${noSalen === 1 ? '' : 'n'}` : ''}. Sale del sistema hacia ${ERP_NAMES[suc] ?? 'la sala'} y no se deshace.`,
    [{ text: 'Cancelar', style: 'cancel' }, { text: 'Finalizar', onPress: finalizar }]);

  if (items == null || hojas == null) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Finalizar' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Finalizar', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>{`Pedido #${numero} · ${ERP_NAMES[suc] ?? ''}`}</Text>
        {!totalHojas ? (
          <View style={{ marginHorizontal: 16, gap: 10 }}>
            <Aviso tono="cuidado" texto="Este pedido todavía no tiene sus hojas guardadas. Se calculan del papel exacto: finalízalo esta vez en la computadora de Bodega." />
          </View>
        ) : (
          <>
            <Segmentos opciones={PASOS.map((p) => ({ id: String(p.id), label: p.label }))} activa={String(paso)}
              onCambiar={(v) => { const n = Number(v); if (n === 1 || (n === 2 && cajasTexto) || (n === 3 && asignacionCompleta(asignacion, totalHojas))) { if (n === 2 && paso === 1) irAHojas(); else setPaso(n); } }} />
            {paso === 1 ? (
              <View style={{ marginHorizontal: 16, gap: 14 }}>
                <Seccion titulo="Hojas del pedido">
                  <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', paddingVertical: 6 }}>{`${totalHojas} ${totalHojas === 1 ? 'hoja' : 'hojas'}`}</Text>
                </Seccion>
                <Seccion titulo="¿Cuántas cajas salen?" pie={cajasTexto && totalHojas ? (cajas >= totalHojas ? '1 hoja por caja' : `~${(totalHojas / cajas).toFixed(1)} hojas por caja`) : null}>
                  <Campo multiline={false} keyboardType="number-pad" value={cajasTexto} onChangeText={(t) => setCajasTexto(t.replace(/\D/g, '').slice(0, 2))} placeholder="Ej. 4" />
                </Seccion>
                <BotonGrande texto="Siguiente" deshabilitado={!cajasTexto || cuantasCajas(cajasTexto) < 1} onPress={irAHojas} />
              </View>
            ) : null}
            {paso === 2 ? (
              <View style={{ marginHorizontal: 16, gap: 10 }}>
                <Aviso texto="Toca la caja donde va cada hoja. Una hoja larga puede ir en dos." />
                {hojas.map((h, i) => (
                  <Seccion key={i} titulo={`Hoja ${i + 1} · ${h.itemCount ?? h.ids?.length ?? 0} productos`} pie={[h.firstLab, h.firstItem].filter(Boolean).join(' · ') || null}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 }}>
                      {Array.from({ length: cajas }, (_, b) => b + 1).map((b) => (
                        <Chip key={b} texto={String(b)} activo={(asignacion[i] ?? []).includes(b)}
                          onPress={() => { Haptics.selectionAsync().catch(() => {}); setAsignacion((a) => alternarCaja(a, i, b)); }} />
                      ))}
                    </View>
                  </Seccion>
                ))}
                <BotonGrande texto="Siguiente" deshabilitado={!asignacionCompleta(asignacion, totalHojas)} onPress={() => setPaso(3)} />
              </View>
            ) : null}
            {paso === 3 ? (
              <View style={{ marginHorizontal: 16, gap: 12 }}>
                {simuError ? <Aviso tono="cuidado" texto={`No se pudo revisar la existencia: ${simuError}. Puedes finalizar igual y ajustar a mano.`} />
                  : !simu || simu.estado === 'en_curso' ? <Aviso texto={`Revisando la existencia de ${despachables.length} productos…`} />
                    : (simu.hallazgos ?? []).length ? <Aviso tono="cuidado" texto={`${simu.hallazgos.length} producto${simu.hallazgos.length === 1 ? '' : 's'} con problema de existencia. Se marcaron en cero — corrige si sí van en la caja.`} />
                      : <Aviso texto={`Los ${despachables.length} productos tienen existencia. Sale todo como se asignó.`} />}
                {Object.entries(ajustes).map(([id, a]) => {
                  const it = despachables.find((r) => String(r.id) === String(id));
                  if (!it) return null;
                  const cero = Number(a.cantidad) === 0 && a.cantidad !== '';
                  return (
                    <Seccion key={id} titulo={it.products?.nombre ?? '—'} pie={a.motivo || null}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`asignado ${it.cantidad_asignada} → sale`}</Text>
                        <View style={{ width: 80 }}>
                          <Campo multiline={false} keyboardType="number-pad" value={String(a.cantidad ?? '')}
                            onChangeText={(t) => setCantidad(id, t === '' ? '' : Math.max(0, parseInt(t, 10) || 0))} />
                        </View>
                        {cero ? <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '700' }}>no sale</Text> : null}
                        <View style={{ flex: 1 }} />
                        <Pressable onPress={() => quitar(id)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Como se asignó</Text>
                        </Pressable>
                      </View>
                    </Seccion>
                  );
                })}
                <Seccion titulo="¿Salió distinto algún otro?">
                  <Campo multiline={false} value={buscar} onChangeText={setBuscar} placeholder="Busca el producto" />
                  {encontrados.map((r) => (
                    <Pressable key={r.id} onPress={() => { setCantidad(r.id, Number(r.cantidad_asignada ?? 0), ''); setBuscar(''); }}
                      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{r.products?.nombre ?? '—'}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`asignado ${r.cantidad_asignada}`}</Text>
                    </Pressable>
                  ))}
                </Seccion>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
                  {`${despachables.length - lista.length} salen como se asignaron${lista.length ? ` · ${lista.length} ajustados` : ''}${noSalen ? ` · ${noSalen} no salen` : ''}`}
                </Text>
                <BotonGrande texto={guardando ? 'Finalizando…' : 'Confirmar y finalizar'} color={MARCA.verde} deshabilitado={guardando || !asignacionCompleta(asignacion, totalHojas)} onPress={confirmar} />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
