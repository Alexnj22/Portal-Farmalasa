// Facturación, NATIVO — las cinco colas de `FacturacionView`, cada una con el
// permiso `facturacion_tab_*` que la deja ver, como el portal:
//   · Pendiente MH: lo que sigue sin sello de Hacienda, CCF primero y en rojo,
//     con Pendientes / CCF urgentes / Días que le quedan al mes.
//   · Observaciones: lo que Hacienda recibió con reparos, palabra por palabra,
//     con el filtro por código y Facturas / La más antigua.
//   · Anuladas: por solventar, con Pendientes / CCF urgentes / Solventadas.
//   · En Hacienda y Anuladas, el historial de lo resuelto (`fiscal/Resueltas`):
//     selladas del mes, resueltas a mano y las «solventadas internamente».
//   · Saltos (solventar saltos y campos nulos, con su historial) y No efectivo
//     (confirmar pagos con comprobante).
//
// Acciones, con las MISMAS funciones del portal:
//   · «Solventar» una pendiente: corrige lo que haga falta y la reenvía
//     (`regularizarDte` alcance 'una'); el motivo de Hacienda, palabra por
//     palabra, si no entró.
//   · «Resolver» con una nota: registra que alguien la revisó
//     (`insertInvoiceResolution` / `insertObservationResolution`). El sello
//     NUNCA se fabrica desde acá: lo trae la sincronización.
//   · «Solventar todas» (barra): lo que corre solo cada noche, para no
//     esperar, sobre la sala elegida o todas.
// Sin tope de filas: se pagina de 40 en 40. Qué está pendiente, los textos y
// los días que quedan salen del núcleo (`colasDeFacturacion`). Los montos,
// sólo con `facturacion_ver_montos`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  countConfirmedMhInvoices, fetchInvoiceObservations, fetchInvoiceResolutionsHistorial, fetchNulaInvoices, fetchObservationResolutions, fetchPendingMhInvoices,
  insertInvoiceResolution, insertObservationResolution, regularizarDte,
} from '@nucleo/data/facturacion';
import {
  conteoDeObservaciones, diasQuedanDelMes, esSolventable, metaObs, observacionesPendientes, resumenDeRegularizacion,
  resumenDeRegularizarUna, sinResolver, tonoDeDiasQuedan,
} from '@nucleo/utils/colasDeFacturacion';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { diasEntre, fechaTexto, hoySV, relojSV } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';
import { fallo, listo } from '../componentes/Progreso';
import Saltos from '../componentes/fiscal/Saltos';
import NoEfectivo from '../componentes/fiscal/NoEfectivo';
import Resueltas from '../componentes/fiscal/Resueltas';

const PAGINA = 40;
const COLAS = [
  { id: 'mh', tab: 'pendiente_mh', label: 'Hacienda' },
  { id: 'obs', tab: 'observaciones', label: 'Observaciones' },
  { id: 'nulas', tab: 'anuladas', label: 'Anuladas' },
  { id: 'saltos', tab: 'saltos', label: 'Saltos' },
  { id: 'noef', tab: 'no_efectivo', label: 'No efectivo' },
];
const BOLSA = { mh: 'sin_sello', nulas: 'anuladas' };

export default function Facturacion() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const verMontos = hasPermission('facturacion_ver_montos');
  const canEdit = hasPermission('facturacion', 'can_edit');
  const todas = getScope?.('facturacion') === 'ALL';
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? (salaElegida === 'ALL' ? null : salaElegida) : String(user?.branchId ?? '');
  const colas = COLAS.filter((c) => hasPermission(`facturacion_tab_${c.tab}`));
  const [colaElegida, setCola] = useState(null);
  const cola = colas.some((c) => c.id === colaElegida) ? colaElegida : (colas[0]?.id ?? 'mh');
  const [obsCode, setObsCode] = useState('todos');
  const [texto, setTexto] = useState('');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [paginas, setPaginas] = useState(1);
  const [abierta, setAbierta] = useState(null);
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [recargaHija, setRecargaHija] = useState(0);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const hoy = hoySV();
      const [mh, resHist, obs, resObs, nulas, confirmadas] = await Promise.all([
        fetchPendingMhInvoices(sala), fetchInvoiceResolutionsHistorial('invoice_id, resolved_at'),
        fetchInvoiceObservations('2000-01-01', '2099-12-31', sala), fetchObservationResolutions('invoice_id, resolved_at'),
        fetchNulaInvoices(sala),
        // Lo que Hacienda ya selló este mes (sello válido: `SELLO_MH_LIKE`), como el portal.
        Promise.resolve(countConfirmedMhInvoices(sala, `${hoy.slice(0, 7)}-01`, hoy)).then((r) => r.count ?? null).catch(() => null),
      ]);
      if (obs.error) throw new Error(obs.error.message);
      const res = resHist.data || [];
      const mes = hoySV().slice(0, 7);
      const idsNulas = new Set((nulas || []).map((r) => r.id));
      setDatos({
        mh: sinResolver(mh, res).sort((a, b) => (a.tipo_documento === 'CCF' ? 0 : 1) - (b.tipo_documento === 'CCF' ? 0 : 1) || String(a.fecha).localeCompare(String(b.fecha))),
        obs: observacionesPendientes(obs.data, resObs.data),
        nulas: sinResolver(nulas || [], res),
        nulasSolventadasMes: res.filter((r) => idsNulas.has(r.invoice_id) && String(r.resolved_at || '').startsWith(mes)).length,
        confirmadasMes: confirmadas,
      });
    } catch (e) { setError(e?.message || 'No se pudo cargar'); setDatos({ mh: [], obs: [], nulas: [], nulasSolventadasMes: 0 }); }
  }, [sala]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);
  useEffect(() => { setPaginas(1); setAbierta(null); }, [cola, texto, obsCode, salaElegida]);

  const nombreSala = useCallback((id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? '', [sucursales]);
  const lista = useMemo(() => {
    let l = datos?.[cola] || [];
    if (cola === 'obs' && obsCode !== 'todos') l = l.filter((r) => (r.observaciones || []).includes(obsCode));
    return l.filter((r) => !texto.trim() || tokenMatch(texto.trim(), r.correlativo, r.cliente, r.erp_invoice_id, ...(r.observaciones || [])));
  }, [datos, cola, texto, obsCode]);
  const conteos = useMemo(() => conteoDeObservaciones(datos?.obs), [datos]);
  const n = (k) => datos?.[k]?.length ?? 0;
  const ccf = (k) => (datos?.[k] || []).filter((r) => r.tipo_documento === 'CCF').length;
  const diasQuedan = diasQuedanDelMes(relojSV());
  const masVieja = (datos?.obs || []).reduce((m, r) => Math.max(m, r.fecha ? diasEntre(r.fecha, hoySV()) : 0), 0);

  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
      opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
    ...(cola === 'obs' && conteos.length ? [{ id: 'obs', titulo: 'Observación', activa: obsCode, porDefecto: 'todos', onCambiar: setObsCode,
      opciones: [{ id: 'todos', label: 'Todas' }, ...conteos.map(([c, k]) => ({ id: c, label: `${metaObs(c).label} · ${k}` }))] }] : []),
  ];

  // ── Acciones ──────────────────────────────────────────────────────────────
  const solventarUna = async (r) => {
    setOcupado(r.id);
    const res = await regularizarDte({ alcance: 'una', invoiceId: r.id }, { correlativo: r.correlativo, desde: 'app' });
    setOcupado(null);
    if (!res.ok) { fallo('No se pudo enviar', mensajeAmigable(res.error)); return; }
    const { titulo, texto: t, tono } = resumenDeRegularizarUna(res, r.correlativo);
    if (tono === 'success') { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); listo(titulo, t); }
    else fallo(titulo, t);
    cargar();
  };
  const resolver = async (r) => {
    setOcupado(r.id);
    const por = user?.name || user?.email || 'Desconocido';
    const payload = { invoice_id: r.id, comment: nota.trim() || null, resolved_by: por };
    const { error: e } = cola === 'obs'
      ? await insertObservationResolution(payload, { correlativo: r.correlativo, observaciones: r.observaciones || [], resolved_by: por, desde: 'app' })
      : await insertInvoiceResolution(payload, undefined, { accion: cola === 'mh' ? 'SOLVENTAR_PENDIENTE_MH' : 'SOLVENTAR_ANULACION', correlativo: r.correlativo, resolved_by: por, desde: 'app' });
    setOcupado(null);
    if (e) { fallo('No se pudo solventar', 'No quedó registrado. Si sigue, tu rol no tiene permiso de edición en Facturación.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    listo(cola === 'obs' ? 'Observación solventada' : cola === 'mh' ? 'Pendiente solventado' : 'Anulación solventada', r.correlativo || '');
    setAbierta(null); setNota('');
    cargar();
  };
  const solventarTodas = () => {
    const donde = sala ? nombreSala(sala) || 'esta sala' : 'todas las salas';
    Alert.alert('Solventar todas', `Corrige lo que haga falta y envía a Hacienda lo pendiente de ${donde}. Es lo mismo que corre solo cada noche.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar', onPress: async () => {
        setOcupado('todas');
        const r = await regularizarDte({ alcance: sala ? 'sucursal' : 'todas', branchId: sala || null, bolsa: BOLSA[cola] });
        setOcupado(null);
        if (!r.ok) { fallo('No se pudo completar', mensajeAmigable(r.error)); return; }
        const { titulo, texto: t } = resumenDeRegularizacion(r);
        // Un lote que resolvió parte también es un resultado: se dice con
        // sus números (el texto ya lleva «sin resolver» / «quedan»).
        listo(titulo, t);
        cargar();
      } },
    ]);
  };

  const visibles = lista.slice(0, paginas * PAGINA);
  const textoDias = diasQuedan === 0 ? 'Último día' : `${diasQuedan}`;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Facturación', headerLargeTitle: true,
        headerSearchBarOptions: cola === 'saltos' ? undefined : {
          placeholder: 'Número, cliente u observación', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} extra={canEdit && BOLSA[cola] ? { icono: 'paperplane', etiqueta: 'Solventar todas', onPress: solventarTodas } : null} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargaHija((x) => x + 1); setRecargando(false); }} />}>
        <FiltrosActivos grupos={grupos} />
        {colas.length > 1 ? (
          <Segmentos activa={cola} onCambiar={setCola} opciones={colas.map((c) => ({
            id: c.id, label: datos && ['mh', 'obs', 'nulas'].includes(c.id) && n(c.id) ? `${c.label} · ${n(c.id)}` : c.label,
          }))} />
        ) : null}
        {!colas.length ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto="Tu cargo no tiene ninguna cola de Facturación." /></View> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {ocupado === 'todas' ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Enviando a Hacienda… puede tardar un par de minutos." /></View> : null}

        {cola === 'saltos' ? <Saltos sala={sala} nombreSala={nombreSala} recarga={recargaHija} canEdit={canEdit} user={user} /> : null}
        {cola === 'noef' ? <NoEfectivo sala={sala} nombreSala={nombreSala} texto={texto} canEdit={canEdit} user={user} verMontos={verMontos} /> : null}

        {['mh', 'obs', 'nulas'].includes(cola) && datos ? (
          <>
            {cola === 'mh' ? (
              <>
                <FilaDeKpis>
                  <Kpi icono="Clock" rotulo="Pendientes" valor={String(n('mh'))} color={n('mh') ? MARCA.ambar : MARCA.verde} apoyo="sin sello de Hacienda" />
                  <Kpi icono="AlertTriangle" rotulo="CCF urgentes" valor={String(ccf('mh'))} color={ccf('mh') ? MARCA.rojo : MARCA.verde} pide={ccf('mh') > 0} apoyo="créditos fiscales" />
                </FilaDeKpis>
                <FilaDeKpis>
                  <Kpi icono="Hourglass" rotulo="Días restantes" valor={textoDias} color={colorDeVariante(tonoDeDiasQuedan(diasQuedan))} pide={diasQuedan <= 2} apoyo="para cerrar el mes" />
                  <Kpi icono="CheckCircle2" rotulo="Selladas" valor={datos.confirmadasMes == null ? '—' : String(datos.confirmadasMes)} color={MARCA.verde} apoyo="por Hacienda este mes" />
                </FilaDeKpis>
                <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Sin sello de Hacienda. El envío nocturno las reintenta solo.</Text>
              </>
            ) : null}
            {cola === 'obs' ? (
              <FilaDeKpis>
                <Kpi icono="AlertTriangle" rotulo="Facturas" valor={String(n('obs'))} color={n('obs') ? MARCA.rojo : MARCA.verde} apoyo={obsCode !== 'todos' ? `${lista.length} en el filtro` : 'con observaciones'} />
                <Kpi icono="Hourglass" rotulo="Más antigua" valor={n('obs') ? `${masVieja} d` : '—'} color={MARCA.ambar} apoyo="sin solventar" />
              </FilaDeKpis>
            ) : null}
            {cola === 'nulas' ? (
              <FilaDeKpis>
                <Kpi icono="Clock" rotulo="Pendientes" valor={String(n('nulas'))} color={n('nulas') ? MARCA.ambar : MARCA.verde} apoyo={`${ccf('nulas')} CCF urgentes`} />
                <Kpi icono="FileCheck" rotulo="Solventadas" valor={String(datos.nulasSolventadasMes)} color={MARCA.verde} apoyo="este mes" />
              </FilaDeKpis>
            ) : null}

            {visibles.map((r) => {
              const esCcf = r.tipo_documento === 'CCF';
              const abierto = abierta === r.id;
              const d = r.fecha ? diasEntre(r.fecha, hoySV()) : 0;
              const solventable = cola !== 'obs' || esSolventable(r);
              return (
                <View key={r.id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={18} tinte={esCcf ? 'rgba(240,68,56,0.10)' : undefined}>
                    <Pressable disabled={!canEdit || !solventable} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abierto ? null : r.id); setNota(''); }} style={{ padding: 12, gap: 5 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text selectable style={{ flex: 1, color: esCcf ? MARCA.rojo : colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${r.tipo_documento ?? '—'} ${r.correlativo ?? 'sin número'}`}</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{verMontos ? formatMoney(r.total || 0) : '—'}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {[r.cliente || 'Sin cliente', todas ? nombreSala(r.branch_id) : null, r.fecha ? fechaTexto(r.fecha, { day: 'numeric', month: 'short', year: 'numeric' }) : null, r.erp_invoice_id ? `ID ${r.erp_invoice_id}` : null].filter(Boolean).join(' · ')}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        {cola !== 'obs' ? <Pildora texto={d ? `${d} día${d === 1 ? '' : 's'} esperando` : 'de hoy'} color={d > 3 ? MARCA.rojo : d ? MARCA.ambar : MARCA.verde} /> : null}
                        {r.cliente_categoria ? <Pildora texto={r.cliente_categoria} color={MARCA.azulClaro} /> : null}
                        {r.tipo_pago ? <Pildora texto={String(r.tipo_pago)} color={colorSistema.texto2} /> : null}
                        {cola === 'obs' ? (r.observaciones || []).map((c) => <Pildora key={c} texto={metaObs(c).label} color={colorDeVariante(metaObs(c).variant)} />) : null}
                      </View>
                      {cola === 'obs' ? (r.motivos_mh || []).map((m, k) => <Text key={`${k}-${m}`} style={{ color: MARCA.rojo, fontSize: 13 }}>{m}</Text>) : null}
                      {cola === 'obs' && !solventable ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Se cierra sola cuando llegue el sello.</Text> : null}
                      {canEdit && solventable && !abierto ? <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>{cola === 'mh' ? 'Solventar o resolver ›' : 'Resolver ›'}</Text> : null}
                    </Pressable>
                    {abierto ? (
                      <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
                        {cola === 'mh' ? (
                          <>
                            <BotonGrande texto={ocupado === r.id ? 'Enviando…' : 'Solventar: corregir y reenviar'} color={MARCA.verde} deshabilitado={!!ocupado} onPress={() => solventarUna(r)} />
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>O, si ya se revisó por otro lado, márcala como resuelta con una nota:</Text>
                          </>
                        ) : null}
                        <Campo value={nota} onChangeText={setNota} placeholder="Nota: qué se revisó o por qué" />
                        <BotonGrande texto={ocupado === r.id ? 'Guardando…' : 'Marcar como resuelta'} borde color={MARCA.azulClaro} deshabilitado={!!ocupado} onPress={() => resolver(r)} />
                      </View>
                    ) : null}
                  </Vidrio>
                </View>
              );
            })}
            {lista.length > visibles.length ? (
              <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más · quedan ${lista.length - visibles.length}`} borde color={MARCA.azulClaro} onPress={() => setPaginas((p) => p + 1)} /></View>
            ) : null}
            {!lista.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Nada pendiente aquí</Text> : null}
            {cola === 'mh' || cola === 'nulas' ? <Resueltas cola={cola} sala={sala} nombreSala={nombreSala} verMontos={verMontos} recarga={recargaHija} /> : null}
          </>
        ) : ['mh', 'obs', 'nulas'].includes(cola) ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      </ScrollView>
    </>
  );
}
