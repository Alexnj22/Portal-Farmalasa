// Gestión de stock, NATIVO — las dos preguntas de `GestionStockView` sobre la
// existencia de una sala:
//
//  · Sin venta: lo que lleva seis meses sin venderse, agrupado por ADÓNDE
//    mandarlo (`productos_parados_de_sala`, el mismo juez del aviso semanal).
//    Armar el envío —presentaciones, unidad de despacho, tope de renglones— se
//    hace en el portal (dentro de la app).
//  · Sin Min/Max: lo que se vende y el pedido no repone solo, con qué hacer con
//    cada uno. Desde acá se pide (o aplica, si el cargo aprueba) el Min/Max, y
//    se descarta o restaura una sugerencia.
//
// Agrupar, sugerir y validar salen del núcleo (`gestionDeStock`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchProductosParadosDeSala, fetchVendidosSinMinMax } from '@nucleo/data/inventarioTab';
import { deleteMinMaxIgnored, fetchMinMaxIgnored, upsertMinMaxIgnored } from '@nucleo/data/stockParams';
import { solicitarMinMax } from '@nucleo/data/minmaxRequests';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import {
  conteosMinMax, FILTROS_MINMAX, gruposPorDestino, motivoDeMinMax, problemaDeMinMax, sugerenciaMinMax, totalesDeParados,
} from '@nucleo/utils/gestionDeStock';
import { porQueDesde } from '@nucleo/utils/productosParados';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import Segmentos from '../componentes/Segmentos';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import ConAurora from '../componentes/ConAurora';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const VISIBLES = 8;
const COLOR_NIVEL = { agregar: MARCA.verde, evaluar: MARCA.ambar, encargo: MARCA.violeta, mayorista: MARCA.azulClaro, omitir: colorSistema.texto2 };
const corta = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'short', year: 'numeric' }) : null);
const n = (x) => Number(x || 0).toLocaleString('es-SV');

function SinVenta({ sala, busqueda, puedeArmar }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchProductosParadosDeSala({ p_erp_sucursal_id: sala });
    setError(e ? mensajeAmigable(e) : null);
    setFilas(Array.isArray(data) ? data : []);
  }, [sala]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  const visibles = useMemo(() => (busqueda ? smartFilter(busqueda, filas || [], (r) => [r.producto, r.laboratorio]).results : (filas || [])), [filas, busqueda]);
  const grupos = useMemo(() => gruposPorDestino(visibles, ERP_BODEGA), [visibles]);
  const t = useMemo(() => totalesDeParados(visibles, filas || [], ERP_BODEGA), [visibles, filas]);
  const veCostos = (filas || []).some((r) => r.costo != null);

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      <FilaDeKpis>
        <Kpi icono="Package" rotulo="Sin venta" valor={n(t.productos)} color={MARCA.ambar} apoyo="productos · 6 meses" />
        {veCostos
          ? <Kpi icono="DollarSign" rotulo="Costo detenido" valor={formatMoney(t.costo)} color={MARCA.violeta} apoyo={`${n(t.unidades)} unidades`} />
          : <Kpi icono="Boxes" rotulo="Unidades" valor={n(t.unidades)} color={MARCA.azul} apoyo="en existencia" />}
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {grupos.map((g) => {
        const abierto = abiertos.has(g.destino);
        const lista = abierto ? g.filas : g.filas.slice(0, VISIBLES);
        const aBodega = g.destino === ERP_BODEGA;
        return (
          <View key={g.destino} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 20, marginTop: 6 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>
                {`${aBodega ? 'Devolver a' : 'Mandar a'} ${ERP_NAMES[g.destino] || `Sucursal ${g.destino}`}`}
              </Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[`${g.filas.length} producto${g.filas.length === 1 ? '' : 's'}`, veCostos ? formatMoney(g.costo) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {lista.map((r) => {
              const otras = Array.isArray(r.vendido_en) ? r.vendido_en : [];
              return (
                <View key={r.erp_product_id} style={{ marginHorizontal: 16 }}>
                  <Vidrio radio={18}>
                    <View style={{ padding: 12, gap: 5 }}>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.producto}</Text>
                          {r.laboratorio ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.laboratorio}</Text> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{n(r.existencia)}</Text>
                          <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{r.costo != null ? formatMoney(r.costo) : 'unidades'}</Text>
                        </View>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {r.desde ? `Sin venta desde ${corta(r.desde)} · ${porQueDesde(r)}` : porQueDesde(r)}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {otras.length ? otras.slice(0, 3).map((v) => (
                          <Pildora key={v.esid} texto={`${ERP_NAMES[v.esid] || `Suc.${v.esid}`} · ${n(v.unidades)}`}
                            color={Number(v.esid) === Number(g.destino) ? MARCA.verde : colorSistema.texto2} />
                        )) : <Pildora texto="No se vende en ninguna sala" color={colorSistema.texto2} />}
                        {r.en_minmax ? <Pildora texto={`Min ${r.min_qty ?? '—'} · Max ${r.max_qty ?? '—'}`} color={MARCA.ambar} /> : null}
                      </View>
                    </View>
                  </Vidrio>
                </View>
              );
            })}
            {g.filas.length > VISIBLES ? (
              <Pressable onPress={() => setAbiertos((s) => { const x = new Set(s); if (x.has(g.destino)) x.delete(g.destino); else x.add(g.destino); return x; })}
                style={{ minHeight: 44, justifyContent: 'center', marginHorizontal: 20 }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>{abierto ? 'Ver menos' : `Ver los ${g.filas.length}`}</Text>
              </Pressable>
            ) : null}
            {puedeArmar ? (
              <View style={{ marginHorizontal: 16 }}>
                <BotonGrande texto={`Armar envío a ${ERP_NAMES[g.destino] || 'la sala'} (portal)`} borde color={MARCA.azulClaro}
                  onPress={() => router.push({ pathname: '/portal', params: { ruta: `/gestion-stock?tab=parados&sala=${sala}`, nombre: 'Gestión de stock' } })} />
              </View>
            ) : null}
          </View>
        );
      })}
      {!grupos.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Ningún producto con esa búsqueda' : 'Todo se vende: nada lleva seis meses parado'}
        </Text>
      ) : null}
    </>
  );
}

function Ajuste({ fila, sala, puedePedir, puedeAplicar, descartado, onCerrar, onHecho, onDescartar }) {
  const { user } = useAuth();
  const s = fila ? sugerenciaMinMax(fila) : null;
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { if (s) { setMin(String(s.minSug ?? '')); setMax(String(s.maxSug ?? '')); } }, [fila]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fila) return null;
  const problema = problemaDeMinMax(min, max);
  const pedir = async () => {
    setEnviando(true); trabajando(puedeAplicar ? 'Aplicando…' : 'Pidiendo…');
    const r = await solicitarMinMax({
      erp_product_id: Number(fila.erp_product_id), erp_sucursal_id: Number(sala), product_name: fila.product_name,
      current_min: null, current_max: null, current_sales_6m: Number(fila.units_sold) || 0,
      requested_min: Number(min), requested_max: Number(max), reason: motivoDeMinMax(fila),
      requested_by: user?.email ?? '', requested_by_id: user?.id ?? null, requested_by_name: user?.name ?? null,
    }, { aplicar: puedeAplicar }, { sucursal: ERP_NAMES[sala], producto: fila.product_name, erp_product_id: fila.erp_product_id, min: Number(min), max: Number(max), desde: 'app' });
    setEnviando(false);
    if (!r.ok) { fallo('No se pudo pedir', mensajeAmigable({ message: r.error })); return; }
    if (r.aplicado) listo('Aplicado', `Min ${min} · Max ${max}`);
    else if (puedeAplicar) fallo('Quedó pedido', `No se pudo aplicar: resuélvelo en Solicitudes.`);
    else listo('Pedido', 'Lo aprueba quien aprueba Min/Max.');
    onHecho(fila.erp_product_id, r.aplicado ? 'aplicado' : 'pedido');
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }} numberOfLines={2}>{fila.product_name}</Text>
              <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pildora texto={s.label} color={COLOR_NIVEL[s.level]} />
              <Pildora texto={s.reason} color={colorSistema.texto2} />
            </View>
            <Seccion titulo="En los últimos seis meses">
              <Text style={{ color: colorSistema.texto, fontSize: 15, lineHeight: 22 }}>
                {`${n(fila.units_sold)} unidades · ${formatMoney(fila.revenue)}\n${s.months} de 6 meses con venta · ${s.invoices} factura${s.invoices === 1 ? '' : 's'} (${s.avgPerInv.toFixed(1)} por factura)`}
              </Text>
            </Seccion>
            {puedePedir ? (
              <>
                <Seccion titulo={puedeAplicar ? 'Min y Max que se aplican' : 'Min y Max que se piden'}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 4 }}>Min</Text>
                      <Campo multiline={false} value={min} onChangeText={(v) => setMin(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginLeft: 4 }}>Max</Text>
                      <Campo multiline={false} value={max} onChangeText={(v) => setMax(v.replace(/[^\d]/g, ''))} keyboardType="number-pad" style={{ textAlign: 'center', fontSize: 20, fontWeight: '700' }} />
                    </View>
                  </View>
                </Seccion>
                {problema && (min || max) ? <Aviso tono="nota" texto={problema} /> : null}
                <BotonGrande texto={enviando ? 'Enviando…' : (puedeAplicar ? 'Aplicar Min/Max' : 'Pedir Min/Max')} color={MARCA.verde}
                  deshabilitado={enviando || !!problema} onPress={pedir} />
              </>
            ) : <Aviso tono="nota" texto="Tu cargo no puede pedir ajustes de Min/Max." />}
            <BotonGrande texto={descartado ? 'Volver a sugerirlo' : 'Descartar la sugerencia'} borde color={descartado ? MARCA.azulClaro : MARCA.rojo}
              onPress={() => onDescartar(fila.erp_product_id, !descartado)} />
          </ScrollView>
        </KeyboardAvoidingView>
      </ConAurora>
    </Modal>
  );
}

function SinMinMax({ sala, busqueda, filtro, puedePedir, puedeAplicar, onConteos }) {
  const [filas, setFilas] = useState(null);
  const [ignorados, setIgnorados] = useState(() => new Set());
  const [hechos, setHechos] = useState(() => new Map());
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [mostrar, setMostrar] = useState(30);
  const cargar = useCallback(async () => {
    const [{ data, error: e }, ign] = await Promise.all([fetchVendidosSinMinMax({ p_erp_sucursal_id: sala }), fetchMinMaxIgnored(sala)]);
    setError(e ? mensajeAmigable(e) : null);
    setFilas(Array.isArray(data) ? data : []);
    if (!ign?.error) setIgnorados(new Set((ign?.data ?? []).map((r) => r.erp_product_id)));
  }, [sala]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);
  useEffect(() => { setMostrar(30); }, [filtro, busqueda]);

  const conteos = useMemo(() => conteosMinMax(filas || [], ignorados), [filas, ignorados]);
  const ultimo = useRef(null);
  useEffect(() => { const k = JSON.stringify(conteos); if (k !== ultimo.current) { ultimo.current = k; onConteos(conteos); } }, [conteos, onConteos]);
  const filtradas = useMemo(() => {
    let rows = filtro === 'ignorado'
      ? (filas || []).filter((r) => ignorados.has(r.erp_product_id))
      : (filas || []).filter((r) => !ignorados.has(r.erp_product_id) && sugerenciaMinMax(r).level === filtro);
    if (busqueda) rows = smartFilter(busqueda, rows, (r) => [r.product_name, r.laboratorio]).results;
    return [...rows].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0));
  }, [filas, filtro, ignorados, busqueda]);

  const descartar = async (id, si) => {
    setIgnorados((p) => { const x = new Set(p); if (si) x.add(id); else x.delete(id); return x; });
    const { error: e } = si ? await upsertMinMaxIgnored(sala, id) : await deleteMinMaxIgnored(sala, id);
    if (e) {
      setIgnorados((p) => { const x = new Set(p); if (si) x.delete(id); else x.add(id); return x; });
      fallo('No se pudo guardar', mensajeAmigable(e));
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setAbierta(null);
  };

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${FILTROS_MINMAX.find((f) => f.value === filtro)?.label} · ${n(filtradas.length)} producto${filtradas.length === 1 ? '' : 's'}`}</Text>
      {filtradas.slice(0, mostrar).map((r) => {
        const s = sugerenciaMinMax(r);
        const hecho = hechos.get(r.erp_product_id);
        return (
          <Pressable key={r.erp_product_id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(r); }}
            style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <Vidrio radio={18} interactivo>
              <View style={{ padding: 12, gap: 5 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{r.product_name}</Text>
                    {r.laboratorio ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.laboratorio}</Text> : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>{formatMoney(r.revenue)}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${n(r.units_sold)} u. en 6 meses`}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {hecho ? <Pildora texto={hecho === 'aplicado' ? 'Min/Max aplicado' : 'Min/Max pedido'} color={MARCA.verde} />
                    : <Pildora texto={s.label} color={COLOR_NIVEL[s.level]} />}
                  <Pildora texto={s.reason} color={colorSistema.texto2} />
                </View>
              </View>
            </Vidrio>
          </Pressable>
        );
      })}
      {filtradas.length > mostrar ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setMostrar((m) => m + 30)} /></View> : null}
      {!filtradas.length && !error ? (
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>
          {busqueda ? 'Ningún producto con esa búsqueda' : 'Nada en este grupo'}
        </Text>
      ) : null}
      <Ajuste fila={abierta} sala={sala} puedePedir={puedePedir} puedeAplicar={puedeAplicar}
        descartado={abierta ? ignorados.has(abierta.erp_product_id) : false}
        onCerrar={() => setAbierta(null)} onDescartar={descartar}
        onHecho={(id, estado) => { setHechos((m) => new Map(m).set(id, estado)); setAbierta(null); }} />
    </>
  );
}

export default function GestionStock() {
  const { user, getScope, hasPermission } = useAuth();
  const propia = BRANCH_A_ERP[user?.branchId ?? user?.branch_id];
  const [salaElegida, setSala] = useState(null);
  const sala = salaElegida ?? (propia && propia !== ERP_BODEGA ? propia : 5);
  const [pestana, setPestana] = useState('parados');
  const [filtro, setFiltro] = useState('agregar');
  const [conteos, setConteos] = useState(null);
  const [texto, setTexto] = useState('');
  const [llave, setLlave] = useState(0);
  const [recargando, setRecargando] = useState(false);

  const puedeArmar = getScope?.('traslados') === 'ALL' || Number(propia) === Number(sala);
  const puedePedir = hasPermission('dash_minmax_req', 'can_view');
  const alcance = getScope?.('requests_minmax');
  const puedeAplicar = hasPermission('requests_minmax', 'can_approve') && (alcance === 'ALL' || (alcance !== 'MINE' && Number(propia) === Number(sala)));

  const salas = ERP_ORDEN.filter((e) => e !== ERP_BODEGA);
  const grupos = [
    { id: 'sala', titulo: 'Sala', activa: String(sala), porDefecto: String(propia && propia !== ERP_BODEGA ? propia : 5), onCambiar: (v) => setSala(Number(v)),
      opciones: salas.map((e) => ({ id: String(e), label: ERP_NAMES[e] })) },
    ...(pestana === 'sin_minmax' ? [{ id: 'filtro', titulo: 'Qué hacer', activa: filtro, porDefecto: 'agregar', onCambiar: setFiltro,
      opciones: FILTROS_MINMAX.map((f) => ({ id: f.value, label: conteos ? `${f.label} · ${conteos[f.value]}` : f.label })) }] : []),
  ];
  const alConteos = useCallback((c) => setConteos(c), []);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Gestión de stock', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Producto o laboratorio', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={() => { setRecargando(true); setLlave((k) => k + 1); setTimeout(() => setRecargando(false), 600); }} />}>
        <FiltrosActivos grupos={grupos} />
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'parados', label: 'Sin venta' }, { id: 'sin_minmax', label: 'Sin Min/Max' }]} />
        {pestana === 'parados'
          ? <SinVenta key={`p${sala}-${llave}`} sala={sala} busqueda={texto.trim()} puedeArmar={puedeArmar} />
          : <SinMinMax key={`m${sala}-${llave}`} sala={sala} busqueda={texto.trim()} filtro={filtro} puedePedir={puedePedir} puedeAplicar={puedeAplicar} onConteos={alConteos} />}
      </ScrollView>
    </>
  );
}
