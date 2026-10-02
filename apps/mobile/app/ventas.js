// Ventas, NATIVO — la pestaña «Ventas» del portal (`VentasView.jsx`): las
// facturas del período con sus cifras arriba (facturas, total, ticket promedio
// y puntos canjeados, cada una contra el período anterior equivalente) y la
// lista, la más reciente primero. Tocar una abre su detalle con los productos.
//
// Los caminos de datos son los MISMOS del portal, y por el mismo motivo: sin
// búsqueda ni filtros la lista pagina por índice y las cifras salen del
// resumen diario; con búsqueda, «Receta médica» o «Anuladas», el conjunto lo
// arma la base (`get_ventas_con_receta` / `get_ventas_receta_stats`) para que
// el encabezado hable exactamente de la lista que se ve. La comparación y la
// variación por día salen del núcleo (`ventasPeriodo`).
//
// Período, sala y qué mostrar van en el menú de la barra; la búsqueda (3
// letras mínimo, igual que el portal) en la barra del sistema.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  fetchInvoicesList, fetchPuntosCanjeados, fetchResumenDeVentas, fetchVentasConReceta,
  fetchVentasRecetaStats, ventasBusquedaEsAproximada,
} from '@nucleo/data/ventas';
import { diasDelRango, horaDeCorte, mesEnCurso, periodoAnterior, variacionPorDia } from '@nucleo/utils/ventasPeriodo';
import { ESTADOS_ANULADA, ROTULO_PAGO } from '@nucleo/utils/solicitudFacturacion';
import { correrMes, fechaTexto, hoySV, rangoDelMes, sumarDias } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ordenDeSala } from '@nucleo/constants/erp';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Vendedores from '../componentes/ventas/Vendedores';
import Productos, { ORDENES_DE_PRODUCTOS } from '../componentes/ventas/Productos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const POR_PAGINA = 30;
const MIN_LETRAS = 3;

// Los rangos del menú, calculados en el día de El Salvador.
function rangoDe(periodo, hoy = hoySV()) {
  if (periodo === 'hoy') return [hoy, hoy];
  if (periodo === 'ayer') return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
  if (periodo === '7') return [sumarDias(hoy, -6), hoy];
  if (periodo === 'anterior') return rangoDelMes(correrMes(hoy.slice(0, 7), -1));
  const { fini, ffin } = mesEnCurso(hoy);
  return [fini, ffin];
}
const PERIODOS = [
  { id: 'hoy', label: 'Hoy' }, { id: 'ayer', label: 'Ayer' }, { id: '7', label: 'Últimos 7 días' },
  { id: 'mes', label: 'Este mes' }, { id: 'anterior', label: 'Mes anterior' },
];

const conSigno = (pct) => (pct == null ? null : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% por día`);

function Fila({ r, sala, vendedor }) {
  const anulada = ESTADOS_ANULADA.includes(r.estado);
  const abrir = () => {
    Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/venta/[id]', params: { id: String(r.id) } });
  };
  return (
    <Pressable onPress={abrir} style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo>
        <View style={{ padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
              {r.cliente || 'Consumidor final'}
            </Text>
            <Text style={{ color: anulada ? colorSistema.texto2 : MARCA.verde, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'],
              textDecorationLine: anulada ? 'line-through' : 'none' }}>
              {formatMoney(r.total)}
            </Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
            {[`${fechaTexto(r.fecha, { day: 'numeric', month: 'short' })} · ${hora12(r.hora)}`, sala, vendedor].filter(Boolean).join(' · ')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {anulada ? <Pildora texto="Anulada" color={MARCA.rojo} /> : null}
            {r.tipo_documento ? <Pildora texto={r.tipo_documento} color={MARCA.azulClaro} /> : null}
            {r.tipo_pago ? <Pildora texto={ROTULO_PAGO[r.tipo_pago] ?? r.tipo_pago} color={colorSistema.texto2} /> : null}
            {r.has_puntos ? <Pildora texto="Con puntos" color={MARCA.ambar} /> : null}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function Ventas() {
  const { user, getScope, hasPermission } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const empleados = useStaffStore((s) => s.employees);
  const todas = getScope?.('ventas') === 'ALL';
  const verCifras = hasPermission('ventas_ver_cards');
  // Las mismas pestañas que el portal, cada una con su permiso.
  const verFacturas = hasPermission('ventas_tab_ventas');
  const verVendedores = hasPermission('ventas_tab_vendedores');
  const verProductos = hasPermission('ventas_tab_productos');
  const vistas = [verFacturas && { id: 'facturas', label: 'Facturas' }, verVendedores && { id: 'vendedores', label: 'Vendedores' },
    verProductos && { id: 'productos', label: 'Productos' }].filter(Boolean);
  const [vistaElegida, setVista] = useState('facturas');
  const vista = vistas.some((v) => v.id === vistaElegida) ? vistaElegida : (vistas[0]?.id ?? 'facturas');
  const [ordenProductos, setOrdenProductos] = useState('neto');
  const miSala = String(user?.branchId || '');

  const [periodo, setPeriodo] = useState('mes');
  const [salaElegida, setSala] = useState('todas');
  const [mostrar, setMostrar] = useState('todas');
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto, 350).trim();
  const buscando = busqueda.length >= MIN_LETRAS;
  const corta = busqueda.length > 0 && !buscando;
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ filas: [], hayMas: false });
  const [cifras, setCifras] = useState(null);
  const [parecidas, setParecidas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [recargando, setRecargando] = useState(false);
  const [error, setError] = useState(null);
  const pedido = useRef(0);

  const [fini, ffin] = useMemo(() => rangoDe(periodo), [periodo]);
  const sala = todas ? (salaElegida === 'todas' ? null : salaElegida) : miSala;
  const receta = mostrar === 'receta';
  const anuladas = mostrar === 'anuladas';
  const porLaBase = receta || anuladas || buscando;

  const nombreDeSala = useCallback((id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? null, [sucursales]);
  const porCodigo = useMemo(() => new Map((empleados || []).map((e) => [e.code, e])), [empleados]);

  useEffect(() => { setPagina(1); }, [fini, ffin, sala, mostrar, busqueda]);

  const cargarCifras = useCallback(async () => {
    if (!verCifras) return;
    if (porLaBase) {
      // Sin comparativo, igual que el portal: compararía universos distintos.
      const { data } = await fetchVentasRecetaStats({
        fini, ffin, branchFilter: sala, anuladas: anuladas ? 'solo' : 'todas',
        searchTerm: buscando ? busqueda : null, soloReceta: receta,
      });
      const r = data?.[0] || {};
      setCifras({ facturas: +r.total_count_todas || 0, validas: +r.total_count || 0, total: +r.total_sum || 0, puntos: +r.total_puntos || 0, previo: null });
      return;
    }
    const { prevFini, prevFfin } = periodoAnterior(fini, ffin);
    const branch = sala ? Number(sala) : null;
    const corte = horaDeCorte(ffin);
    const [act, ant, ptsAct, ptsAnt] = await Promise.all([
      fetchResumenDeVentas({ p_fini: fini, p_ffin: ffin, p_branch_id: branch, p_hora_corte: corte }),
      fetchResumenDeVentas({ p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branch, p_hora_corte: corte }),
      fetchPuntosCanjeados({ p_fini: fini, p_ffin: ffin, p_branch_id: branch, p_hora_corte: corte }),
      fetchPuntosCanjeados({ p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branch, p_hora_corte: corte }),
    ]);
    const a = act.data?.[0] || {};
    const p = ant.data?.[0] || {};
    setCifras({
      facturas: +a.total_count_todas || 0, validas: +a.total_count || 0, total: +a.total_sum || 0, puntos: +ptsAct.data || 0,
      previo: { facturas: +p.total_count_todas || 0, validas: +p.total_count || 0, total: +p.total_sum || 0, puntos: +ptsAnt.data || 0,
        dias: diasDelRango(prevFini, prevFfin) },
    });
  }, [verCifras, porLaBase, fini, ffin, sala, anuladas, buscando, busqueda, receta]);
  useEffect(() => { cargarCifras().catch(() => setCifras(null)); }, [cargarCifras]);

  useEffect(() => {
    if (!buscando) { setParecidas(false); return undefined; }
    let vivo = true;
    ventasBusquedaEsAproximada({ searchTerm: busqueda, fini, ffin }).then((es) => { if (vivo) setParecidas(es); }).catch(() => {});
    return () => { vivo = false; };
  }, [buscando, busqueda, fini, ffin]);

  const cargar = useCallback(async () => {
    const yo = ++pedido.current;
    setCargando(true);
    try {
      let filas;
      if (receta || buscando) {
        const { data, error: e } = await fetchVentasConReceta({
          fini, ffin, branchFilter: sala, anuladas: anuladas ? 'solo' : 'todas', searchTerm: buscando ? busqueda : null,
          sortCol: 'fecha', sortDir: 'desc', page: pagina, pageSize: POR_PAGINA, soloReceta: receta,
        });
        if (e) throw e;
        filas = data || [];
      } else {
        const { data, error: e } = await fetchInvoicesList({
          fini, ffin, sortCol: 'fecha', asc: false, filterBranch: sala, filterAnuladas: anuladas, filterPuntosEstado: '',
          cancelledEstados: ESTADOS_ANULADA, isSearching: false, searchTerm: '', page: pagina, pageSize: POR_PAGINA,
        });
        if (e) throw e;
        filas = data || [];
      }
      if (yo !== pedido.current) return;   // llegó tarde: ya se pidió otra cosa
      setError(null);
      setDatos((d) => ({ filas: pagina === 1 ? filas : [...d.filas, ...filas], hayMas: filas.length === POR_PAGINA }));
    } catch {
      if (yo === pedido.current) setError('No se pudieron cargar las ventas.');
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
  }, [fini, ffin, sala, receta, anuladas, buscando, busqueda, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const recargar = async () => {
    setRecargando(true);
    await Promise.all([cargar(), cargarCifras().catch(() => {})]);
    setRecargando(false);
  };

  const salas = useMemo(() => [...(sucursales || [])].sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id)), [sucursales]);
  const grupos = [
    { id: 'periodo', titulo: 'Período', activa: periodo, porDefecto: 'mes', onCambiar: setPeriodo, opciones: PERIODOS },
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: salaElegida, porDefecto: 'todas', onCambiar: setSala,
      opciones: [{ id: 'todas', label: 'Todas las salas' }, ...salas.map((b) => ({ id: String(b.id), label: b.name }))] }] : []),
    ...(vista === 'facturas' ? [{ id: 'mostrar', titulo: 'Mostrar', activa: mostrar, porDefecto: 'todas', onCambiar: setMostrar,
      opciones: [{ id: 'todas', label: 'Todas las ventas' }, { id: 'receta', label: 'Con receta médica' }, { id: 'anuladas', label: 'Sólo anuladas' }] }] : []),
    ...(vista === 'productos' ? [{ id: 'orden', titulo: 'Ordenar por', activa: ordenProductos, porDefecto: 'neto', onCambiar: setOrdenProductos,
      opciones: ORDENES_DE_PRODUCTOS }] : []),
  ];

  const c = cifras;
  const dias = diasDelRango(fini, ffin);
  const ticket = c && c.validas ? c.total / c.validas : 0;
  const ticketPrevio = c?.previo && c.previo.validas ? c.previo.total / c.previo.validas : 0;
  const rangoTexto = fini === ffin ? fechaTexto(fini, { weekday: 'long', day: 'numeric', month: 'long' })
    : `${fechaTexto(fini, { day: 'numeric', month: 'short' })} – ${fechaTexto(ffin, { day: 'numeric', month: 'short' })}`;

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Ventas', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: vista === 'vendedores' ? 'Nombre del vendedor' : vista === 'productos' ? 'Producto o laboratorio' : 'Cliente, producto o número', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={recargar} />}>
        <FiltrosActivos grupos={grupos} />
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20, textTransform: fini === ffin ? 'capitalize' : 'none' }}>{rangoTexto}</Text>
        {vistas.length > 1 ? <Segmentos activa={vista} onCambiar={setVista} opciones={vistas} /> : null}
        {vista === 'productos' ? <Productos key={`${fini}|${ffin}|${sala}`} fini={fini} ffin={ffin} sala={sala} busqueda={busqueda} verCifras={verCifras} orden={ordenProductos} />
          : vista === 'vendedores' ? <Vendedores key={`${fini}|${ffin}|${sala}`} fini={fini} ffin={ffin} sala={sala} busqueda={busqueda} verCifras={verCifras} /> : (<>
        {verCifras && c ? (
          <>
            <FilaDeKpis>
              <Kpi icono="TrendingUp" rotulo="Total" valor={formatMoney(c.total, { decimales: 0 })} color={MARCA.verde}
                apoyo={c.previo ? conSigno(variacionPorDia(c.total, dias, c.previo.total, c.previo.dias)) : null} />
              <Kpi icono="Receipt" rotulo="Facturas" valor={c.facturas.toLocaleString('es-SV')} color={MARCA.azul}
                apoyo={c.previo ? conSigno(variacionPorDia(c.facturas, dias, c.previo.facturas, c.previo.dias)) : null} />
            </FilaDeKpis>
            <FilaDeKpis>
              <Kpi icono="ShoppingCart" rotulo="Ticket promedio" valor={formatMoney(ticket)} color={MARCA.violeta}
                apoyo={ticketPrevio ? `antes ${formatMoney(ticketPrevio)}` : null} />
              <Kpi icono="Star" rotulo="Puntos canjeados" valor={formatMoney(c.puntos)} color={MARCA.ambar}
                apoyo={c.previo?.puntos ? `antes ${formatMoney(c.previo.puntos)}` : null} />
            </FilaDeKpis>
          </>
        ) : null}
        {corta ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto={`Escribe al menos ${MIN_LETRAS} letras para buscar.`} /></View> : null}
        {buscando && parecidas && datos.filas.length ? <View style={{ marginHorizontal: 16 }}><Aviso tono="nota" texto="No hay coincidencia exacta: se muestran ventas de productos parecidos." /></View> : null}
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {datos.filas.map((r) => {
          const emp = porCodigo.get(r.cod_vendedor);
          return <Fila key={r.id} r={r} sala={todas && !sala ? nombreDeSala(r.branch_id) : null} vendedor={emp ? shortEmployeeName(emp) : null} />;
        })}
        {cargando ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!cargando && datos.hayMas ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Ver más" borde onPress={() => setPagina((p) => p + 1)} /></View> : null}
        {!cargando && !datos.filas.length && !error ? (
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600' }}>{buscando ? 'Nada con esa búsqueda' : 'Sin ventas en este período'}</Text>
          </View>
        ) : null}
        </>)}
      </ScrollView>
    </>
  );
}
