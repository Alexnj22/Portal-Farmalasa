// Facturación, NATIVO — las colas de `FacturacionView` para revisarlas: lo que
// sigue sin sello de Hacienda (con los días que lleva esperando), las
// observaciones abiertas (con lo que contestó Hacienda palabra por palabra) y
// las anuladas por solventar. Quien ve una sola sala, ve su sala; los montos,
// sólo con `facturacion_ver_montos`.
//
// Qué está pendiente sale del núcleo (`colasDeFacturacion`), la misma regla
// del portal. Solventar, saltos de correlativo y pagos no efectivo siguen en
// el portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  fetchInvoiceObservations, fetchInvoiceResolutionIds, fetchNulaInvoices, fetchObservationResolutions, fetchPendingMhInvoices,
} from '@nucleo/data/facturacion';
import { conteoDeObservaciones, esSolventable, metaObs, observacionesPendientes, sinResolver } from '@nucleo/utils/colasDeFacturacion';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { diasEntre, fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { colorDeVariante } from '../componentes/colorDeVariante';

const TOPE = 150;

function Fila({ r, sala, verMontos, children, i }) {
  return (
    <View style={{ gap: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{`${r.tipo_documento ?? '—'} ${r.correlativo ?? 'sin número'}`}</Text>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{verMontos ? formatMoney(r.total || 0) : '—'}</Text>
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
        {[r.cliente || 'Sin cliente', sala, r.fecha ? fechaTexto(r.fecha, { day: 'numeric', month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ')}
      </Text>
      {children}
    </View>
  );
}

export default function Facturacion() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const verMontos = hasPermission('facturacion_ver_montos');
  const todas = getScope?.('facturacion') === 'ALL';
  const [salaElegida, setSala] = useState('ALL');
  const sala = todas ? (salaElegida === 'ALL' ? null : salaElegida) : String(user?.branchId ?? '');
  const [cola, setCola] = useState('mh');
  const [texto, setTexto] = useState('');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [mh, resMh, obs, resObs, nulas] = await Promise.all([
        fetchPendingMhInvoices(sala), fetchInvoiceResolutionIds(),
        fetchInvoiceObservations('2000-01-01', '2099-12-31', sala), fetchObservationResolutions('invoice_id, resolved_at'),
        fetchNulaInvoices(sala),
      ]);
      if (obs.error) throw new Error(obs.error.message);
      setDatos({
        mh: sinResolver(mh, resMh.data).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
        obs: observacionesPendientes(obs.data, resObs.data),
        nulas: sinResolver(nulas || [], resMh.data),
      });
    } catch (e) { setError(e?.message || 'No se pudo cargar'); setDatos({ mh: [], obs: [], nulas: [] }); }
  }, [sala]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? '';
  const filtra = (l) => (l || []).filter((r) => !texto.trim() || tokenMatch(texto.trim(), r.correlativo, r.cliente, r.erp_invoice_id));
  const lista = useMemo(() => filtra(datos?.[cola]), [datos, cola, texto]); // eslint-disable-line react-hooks/exhaustive-deps
  const conteos = useMemo(() => conteoDeObservaciones(datos?.obs), [datos]);
  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Todas las salas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];
  const n = (k) => datos?.[k]?.length ?? 0;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Facturación', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Número o cliente', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <Segmentos activa={cola} onCambiar={setCola} opciones={[
          { id: 'mh', label: datos ? `Hacienda · ${n('mh')}` : 'Hacienda' },
          { id: 'obs', label: datos ? `Observ. · ${n('obs')}` : 'Observ.' },
          { id: 'nulas', label: datos ? `Anuladas · ${n('nulas')}` : 'Anuladas' },
        ]} />
        {error ? <Text style={{ color: MARCA.rojo, fontSize: 14, marginHorizontal: 20 }}>{error}</Text> : null}
        {cola === 'mh' && datos ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Sin sello de Hacienda. El envío nocturno las reintenta solo.</Text> : null}
        {cola === 'obs' && conteos.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 16 }}>
            {conteos.map(([c, k]) => <Pildora key={c} texto={`${metaObs(c).label} · ${k}`} color={colorDeVariante(metaObs(c).variant)} />)}
          </View>
        ) : null}
        {datos == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : lista.length ? (
          <View style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 12, gap: 10 }}>
                {lista.slice(0, TOPE).map((r, i) => (
                  <Fila key={r.id} r={r} i={i} sala={todas ? nombreSala(r.branch_id) : null} verMontos={verMontos}>
                    {cola === 'mh' ? (
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        {(() => { const d = r.fecha ? diasEntre(r.fecha, hoySV()) : 0; return <Pildora texto={d ? `${d} día${d === 1 ? '' : 's'} esperando` : 'de hoy'} color={d > 3 ? MARCA.rojo : d ? MARCA.ambar : MARCA.verde} />; })()}
                        {r.cliente_categoria ? <Pildora texto={r.cliente_categoria} color={MARCA.azulClaro} /> : null}
                      </View>
                    ) : null}
                    {cola === 'obs' ? (
                      <>
                        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                          {(r.observaciones || []).map((c) => <Pildora key={c} texto={metaObs(c).label} color={colorDeVariante(metaObs(c).variant)} />)}
                        </View>
                        {(r.motivos_mh || []).map((m, k) => <Text key={`${k}-${m}`} style={{ color: MARCA.rojo, fontSize: 12 }}>{m}</Text>)}
                        {!esSolventable(r) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Se cierra sola cuando llegue el sello.</Text> : null}
                      </>
                    ) : null}
                  </Fila>
                ))}
                {lista.length > TOPE ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Se muestran ${TOPE} de ${lista.length}. Filtra o búscalas en el portal.`}</Text> : null}
              </View>
            </Vidrio>
          </View>
        ) : <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Nada pendiente aquí</Text>}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Solventar y más colas (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/facturacion', nombre: 'Facturación' } })} />
        </View>
      </ScrollView>
    </>
  );
}
