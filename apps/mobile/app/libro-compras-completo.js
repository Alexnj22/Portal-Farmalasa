// Libro de compras completo, NATIVO — `LibroComprasCompletoView` para
// consultarlo: qué compró la farmacia de verdad en el mes (lo registrado más
// los documentos que llegaron del proveedor y nunca se registraron) y, en
// «Declarable», qué de eso puede reclamarse como crédito fiscal y por qué no
// cuenta lo que no cuenta. Tocar un documento que llegó por correo lo abre.
//
// Los totales salen del núcleo (`libroComprasCompleto`), los mismos del portal;
// los montos, sólo con `libro_compras_completo_ver_montos`. «Exportar CSV»
// comparte el MISMO archivo del portal (`csvDelLibroCompleto` /
// `csvDelDeclarable`, núcleo) con `libro_compras_completo_descargar`. Sin
// tope de filas: se pagina de 40 en 40.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchLibroComprasCompleto, fetchLibroComprasDeclarable } from '@nucleo/data/libroComprasCompleto';
import { csvDelDeclarable, csvDelLibroCompleto, filasDeLaPestana, totalesDeclarable, totalesDelLibro } from '@nucleo/utils/libroComprasCompleto';
import { compartirCsv } from '../componentes/fiscal/csv';
import { fallo } from '../componentes/Progreso';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { ordenDeSala } from '@nucleo/constants/erp';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import PasoDeMes from '../componentes/PasoDeMes';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const PAGINA = 40;

export default function LibroComprasCompleto() {
  const { getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const verMontos = hasPermission('libro_compras_completo_ver_montos');
  const puedeDescargar = hasPermission('libro_compras_completo_descargar');
  const todas = getScope?.('libro_compras_completo') === 'ALL';
  const [mes, setMes] = useState(mesSV);
  const [sala, setSala] = useState('ALL');
  const [pestana, setPestana] = useState('todos');
  const [texto, setTexto] = useState('');
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState('');
  const [recargando, setRecargando] = useState(false);
  const esDecl = pestana === 'declarable';
  const [paginas, setPaginas] = useState(1);
  const m = (n) => (verMontos ? formatMoney(n || 0) : '—');

  const cargar = useCallback(async () => {
    setError('');
    const [desde, hasta] = rangoDelMes(mes);
    const data = esDecl ? await fetchLibroComprasDeclarable(desde, hasta) : await fetchLibroComprasCompleto(desde, hasta, sala === 'ALL' ? null : sala);
    if (data === null) { setError('No se pudo leer el libro.'); setFilas([]); } else setFilas(data);
  }, [mes, sala, esDecl]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);
  useEffect(() => { setPaginas(1); }, [pestana, texto, mes, sala]);

  const t = useMemo(() => totalesDelLibro(filas), [filas]);
  const td = useMemo(() => (esDecl ? totalesDeclarable(filas) : null), [filas, esDecl]);
  const vistas = useMemo(() => filasDeLaPestana(filas, pestana)
    .filter((r) => !texto.trim() || tokenMatch(texto.trim(), r.proveedor, r.documento_completo, r.nit)), [filas, pestana, texto]);
  const nombreSala = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? '';
  const exportar = async () => {
    try {
      const csv = esDecl ? csvDelDeclarable(filas, td, mes) : csvDelLibroCompleto(filas, t, nombreSala, mes);
      await compartirCsv({ headers: csv.headers, rows: csv.rows, nombre: csv.archivo, modulo: esDecl ? 'libro_compras_declarable' : 'libro_compras_completo', detalle: { mes } });
    } catch (e) { fallo('No se pudo armar el CSV', e?.message || ''); }
  };
  const grupos = todas && !esDecl ? [{ id: 'sala', titulo: 'Sucursal', activa: sala, porDefecto: 'ALL', onCambiar: setSala,
    opciones: [{ id: 'ALL', label: 'Todas' }, ...[...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)).map((b) => ({ id: String(b.id), label: b.name }))] }] : [];

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Libro de compras', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Proveedor, NIT o documento', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      {grupos.length ? <MenuDeFiltros grupos={grupos} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {grupos.length ? <FiltrosActivos grupos={grupos} /> : null}
        <PasoDeMes mes={mes} onCambiar={setMes} />
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'todos', label: 'Todos' }, { id: 'sin_compra', label: 'Sin registrar' }, { id: 'declarable', label: 'Declarable' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {filas && !esDecl ? (
          <>
            <FilaDeKpis>
              <Kpi icono="BookOpen" rotulo="Documentos" valor={String(t.docs)} color={MARCA.azul} apoyo={`${t.docs - t.sinCompra} registradas · ${t.sinCompra} sin registrar`} />
              <Kpi icono="SearchX" rotulo="Sin registrar" valor={String(t.sinCompra)} color={t.sinCompra ? MARCA.ambar : MARCA.verde} apoyo={`crédito ${m(t.creditoSinCompra)}`} onPress={t.sinCompra ? () => setPestana('sin_compra') : undefined} />
            </FilaDeKpis>
            {verMontos ? (
              <FilaDeKpis>
                <Kpi icono="ShoppingCart" rotulo="Compras" valor={m(t.total)} color={MARCA.violeta} apoyo="del período" />
                <Kpi icono="Percent" rotulo="Crédito fiscal" valor={m(t.credito)} color={MARCA.verde} apoyo="del período" />
              </FilaDeKpis>
            ) : null}
            {t.sinCompra > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${t.sinCompra} documento(s) del proveedor todavía no están registrados como compra — ${m(t.creditoSinCompra)} de crédito fiscal que no entra al libro del Art. 86. La Ley de IVA da tres períodos para reclamarlo.`} /></View> : null}
          </>
        ) : null}
        {filas && td ? (
          <>
            <FilaDeKpis>
              <Kpi icono="Percent" rotulo="Crédito declarable" valor={m(td.credito)} color={MARCA.verde} apoyo={`${td.docs - td.sinCuenta} cuentan · ${td.sinCuenta} no`} />
              <Kpi icono="Lock" rotulo="No cuentan" valor={String(td.sinCuenta)} color={td.sinCuenta ? MARCA.ambar : MARCA.verde} apoyo={td.trabado ? `trabado ${m(td.trabado)}` : 'nada trabado'} />
            </FilaDeKpis>
            {td.motivos.size ? (
              <View style={{ marginHorizontal: 16, gap: 4 }}>
                {[...td.motivos.entries()].sort((a, b) => b[1] - a[1]).map(([mot, k]) => <Text key={mot ?? 'x'} style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${k} · ${mot ?? 'Sin motivo'}`}</Text>)}
              </View>
            ) : null}
            {td.repRenglones ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${Math.round(td.repDocs)} documento(s) aparecen repetidos en el libro (${td.repRenglones} renglones): ${m(td.repCredito)} de crédito contado de más.`} /></View> : null}
          </>
        ) : null}
        {filas && filas.length && puedeDescargar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={esDecl ? 'Exportar el declarable (CSV)' : 'Exportar el libro (CSV)'} borde color={MARCA.azulClaro} onPress={exportar} /></View> : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : vistas.length ? vistas.slice(0, paginas * PAGINA).map((r, i) => {
          const abre = !!r.json_path && r.dte_id;
          const repetido = Number(r.veces_en_el_libro || 1) > 1;
          return (
            <Pressable key={`${r.dte_id ?? ''}-${r.documento_completo}-${i}`} disabled={!abre}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/factura-compra/[id]', params: { id: String(r.dte_id), fecha: r.fecha } }); }}
              style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed && abre ? 0.98 : 1 }] })}>
              <Vidrio radio={16} interactivo={!!abre} tinte={repetido ? 'rgba(240,68,56,0.10)' : esDecl && !r.computa_credito ? 'rgba(247,144,9,0.08)' : undefined}>
                <View style={{ padding: 12, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.proveedor || 'Sin proveedor'}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{m(r.total)}</Text>
                  </View>
                  <Text selectable style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[r.fecha ? fechaTexto(r.fecha, { day: 'numeric', month: 'short' }) : null, r.documento_tipo, r.documento_completo, r.nrc ? `NRC ${r.nrc}` : 'sin NRC', !esDecl && todas ? nombreSala(r.branch_id) : null].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`gravadas ${m(r.compras_gravadas)} · crédito ${m(r.credito_fiscal)}`}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {!esDecl && r.origen !== 'registrada' ? <Pildora texto="Sin registrar" color={MARCA.ambar} /> : null}
                    {esDecl ? <Pildora texto={r.computa_credito ? 'Cuenta' : 'No cuenta'} color={r.computa_credito ? MARCA.verde : MARCA.ambar} /> : null}
                    {repetido ? <Pildora texto={`Repetido ×${r.veces_en_el_libro}`} color={MARCA.rojo} /> : null}
                    {r.anulada ? <Pildora texto="Anulada" color={colorSistema.texto2} /> : null}
                  </View>
                  {esDecl && !r.computa_credito && r.motivo ? <Text style={{ color: MARCA.ambar, fontSize: 13 }}>{r.motivo}</Text> : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        }) : <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>Sin documentos este mes</Text>}
        {vistas.length > paginas * PAGINA ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más · quedan ${vistas.length - paginas * PAGINA}`} borde color={MARCA.azulClaro} onPress={() => setPaginas((p) => p + 1)} /></View> : null}
      </ScrollView>
    </>
  );
}
