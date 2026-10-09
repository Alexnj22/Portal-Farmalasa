// Revisar la sala completa de Min·Máx, NATIVO — la tabla del portal
// (`TabMinMax` + `useMinMaxData`): todos los productos de una sala con su
// existencia, el MIN·MAX vigente y el borrador del cálculo; filtros por ABC,
// XYZ y alerta; y lo que cierra el ciclo del mes: PUBLICAR los borradores
// (todos o los filtrados), DESCARTAR (uno o todos) y RECALCULAR la sala.
//
// Las reglas son las del portal, en el núcleo (`revisionDeSala`: el filtro,
// cuánto se lleva «Descartar», por qué se negó el cálculo, qué decir al
// publicar). El candado de mantenimiento lo respeta solo: `hasPermission`
// apaga la escritura mientras el módulo está tomado por otra persona.
// Tocar un producto abre su Min·Máx (`minmax-producto`), donde se ajusta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  calcularMinMaxDeSala, descartarBorradorDeFila, descartarBorradoresDeMinMax, fetchAnalisisDeStock, fetchProveedorPrincipal, fetchStockNetoPorSala, publicarMinMax,
} from '@nucleo/data/stockParams';
import { csvDeMinMax } from '@nucleo/utils/csvMinMax';
import { hoySV } from '@nucleo/utils/fecha';
import { compartirCsv } from '../componentes/fiscal/csv';
import { cuentaADescartar, filaPasaFiltros, mensajeDePublicacion, motivoDeSaltoDelCalculo } from '@nucleo/utils/revisionDeSala';
import { ALERTA_ETIQUETA, ESTADOS_DE_STOCK } from '@nucleo/constants/minmax';
import { BRANCH_A_ERP, ERP_BODEGA, ERP_NAMES, ERP_ORDEN } from '@nucleo/constants/erp';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Vidrio from '../componentes/Vidrio';
import Kpi, { FilaDeKpis } from '../componentes/inicio/Kpi';
import { MARCA } from '../componentes/inicio/marca';
import { cerrarProgreso, fallo, listo, trabajando } from '../componentes/Progreso';

const COLOR_ALERTA = {
  out_of_stock: MARCA.rojo, below_min: MARCA.rojo, approaching: MARCA.ambar, ok: MARCA.verde,
  overstocked: MARCA.violetaClaro, dead_stock: colorSistema.texto2, no_data: colorSistema.texto2,
};

function Fila({ r, onAbrir, onMantener }) {
  const pendiente = r.draft_status === 'pending';
  const cambia = pendiente && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max);
  const abc = r.draft_abc_class || r.abc_class;
  return (
    <Pressable onPress={onAbrir} onLongPress={onMantener} delayLongPress={350}
      style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 10, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={18} interactivo>
        <View style={{ padding: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.product_name}</Text>
            {abc ? <Pildora texto={abc} color={MARCA.violetaClaro} /> : null}
            <Pildora texto={ALERTA_ETIQUETA[r.alert_status] ?? r.alert_status} color={COLOR_ALERTA[r.alert_status] ?? colorSistema.texto2} />
          </View>
          {r.laboratorio_nombre ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.laboratorio_nombre}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Hay ${formatQty(r.current_stock ?? 0)}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`MIN·MAX ${r.effective_min ?? 0} · ${r.effective_max ?? 0}`}</Text>
            {pendiente ? (
              <Text style={{ color: cambia ? MARCA.azulClaro : colorSistema.texto2, fontSize: 14, fontWeight: '700' }}>
                {cambia ? `→ ${r.draft_min ?? 0} · ${r.draft_max ?? 0}` : 'borrador sin cambio'}
              </Text>
            ) : null}
          </View>
        </View>
      </Vidrio>
    </Pressable>
  );
}

export default function MinMaxSala() {
  const { sala: salaParam, abc: abcParam, xyz: xyzParam } = useLocalSearchParams();
  const { user, hasPermission, getScope, moduleLock } = useAuth();
  const todas = getScope?.('minmax') === 'ALL';
  const puede = hasPermission('minmax', 'can_edit');
  const candado = moduleLock?.('minmax');
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [sala, setSala] = useState(salaParam ? Number(salaParam) : (miErp ?? ERP_ORDEN[0]));
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('todos');
  const [abc, setAbc] = useState(abcParam ? String(abcParam) : 'all');
  const [xyz, setXyz] = useState(xyzParam ? String(xyzParam) : 'all');
  const [alerta, setAlerta] = useState('all');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto).trim();
  const [ocupado, setOcupado] = useState(false);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    const { data, error: e } = await fetchAnalisisDeStock({ p_erp_sucursal_id: sala });
    if (e) { setError(mensajeAmigable(e)); setFilas([]); return; }
    setFilas((data || []).map((r) => ({ ...r, _erp_sucursal_id: sala })));
  }, [sala]);
  useEffect(() => { setFilas(null); cargar(); }, [cargar]);

  const ocultos = useMemo(() => new Set((filas || []).filter((r) => r.is_hidden).map((r) => r.erp_product_id)), [filas]);
  const filtros = { ocultos, soloBorradores: vista === 'borradores', soloCambios: vista === 'cambios', abc, xyz, alerta, hayBusqueda: !!busca };
  const visibles = useMemo(() => (filas || [])
    .filter((r) => filaPasaFiltros(r, filtros))
    .filter((r) => !busca || tokenMatch(busca, r.product_name, r.laboratorio_nombre)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [filas, ocultos, vista, abc, xyz, alerta, busca]);
  const aDescartar = useMemo(() => cuentaADescartar(filas, sala), [filas, sala]);
  const hayFiltro = abc !== 'all' || xyz !== 'all' || alerta !== 'all' || !!busca;
  const idsFiltrados = useMemo(() => visibles.filter((r) => r.draft_status === 'pending').map((r) => r.erp_product_id), [visibles]);
  const alertas = useMemo(() => (filas || []).filter((r) => !ocultos.has(r.erp_product_id) && ['out_of_stock', 'below_min'].includes(r.alert_status)).length, [filas, ocultos]);

  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: String(sala), porDefecto: String(miErp ?? ERP_ORDEN[0]), onCambiar: (v) => setSala(Number(v)),
      opciones: ERP_ORDEN.map((e) => ({ id: String(e), label: ERP_NAMES[e] })) }] : []),
    { id: 'abc', titulo: 'ABC', activa: abc, porDefecto: 'all', onCambiar: setAbc, opciones: [{ id: 'all', label: 'Todas las clases' }, ...['A', 'B', 'C', 'D'].map((x) => ({ id: x, label: `Clase ${x}` }))] },
    { id: 'xyz', titulo: 'XYZ', activa: xyz, porDefecto: 'all', onCambiar: setXyz, opciones: [{ id: 'all', label: 'Toda variabilidad' }, ...['X', 'Y', 'Z'].map((x) => ({ id: x, label: x }))] },
    { id: 'alerta', titulo: 'Alerta', activa: alerta, porDefecto: 'all', onCambiar: setAlerta, opciones: [{ id: 'all', label: 'Todas' }, ...ESTADOS_DE_STOCK.map((e) => ({ id: e.key, label: e.label }))] },
  ];

  const anotar = (accion, detalle) => useStaffStore.getState().appendAuditLog?.(accion, String(sala), { sucursal: ERP_NAMES[sala], sucursal_id: sala, ...detalle, desde: 'app' });

  const publicar = async (ids) => {
    setOcupado(true);
    trabajando('Publicando…');
    try {
      const { data: res, error: e } = await publicarMinMax({ p_erp_sucursal_id: sala, ...(ids ? { p_erp_product_ids: ids } : {}) });
      if (e) throw e;
      anotar('MINMAX_PUBLISH', { published_count: res?.published, omitidas_por_ajuste_manual: res?.omitidas_por_ajuste_manual ?? 0, scope: ids ? 'selective' : 'all', product_ids: ids ?? null });
      const m = mensajeDePublicacion(res);
      listo(ERP_NAMES[sala], m.texto);
      await cargar();
    } catch (e) { fallo('No se pudo publicar', mensajeAmigable(e)); } finally { setOcupado(false); }
  };
  const descartarTodo = async () => {
    setOcupado(true);
    try {
      const { data: count, error: e } = await descartarBorradoresDeMinMax({ p_erp_sucursal_id: sala });
      if (e) throw e;
      anotar('MINMAX_DISCARD_ALL', { count, borradores: aDescartar.borradores, sin_datos: aDescartar.sinDatos });
      listo(ERP_NAMES[sala], `Se descartaron ${(count ?? 0).toLocaleString()} borradores`);
      await cargar();
    } catch (e) { fallo('No se pudo descartar', mensajeAmigable(e)); } finally { setOcupado(false); }
  };
  const recalcular = async () => {
    setOcupado(true);
    trabajando('Calculando la sala…');
    try {
      const { data: res, error: e } = await calcularMinMaxDeSala({ p_erp_sucursal_id: sala });
      if (e) throw e;
      const salto = motivoDeSaltoDelCalculo(res);
      if (salto) { fallo(ERP_NAMES[sala], salto); return; }
      listo(ERP_NAMES[sala], `${(res?.rows ?? 0).toLocaleString()} borradores generados`);
      await cargar();
      setVista('cambios');
    } catch (e) {
      fallo(ERP_NAMES[sala], /timeout|canceling statement/i.test(e?.message ?? '') ? 'El cálculo tardó demasiado. Intenta de nuevo en un momento.' : mensajeAmigable(e));
    } finally { setOcupado(false); }
  };
  const descartarUno = async (r) => {
    const { error: e } = await descartarBorradorDeFila(r);
    if (e) { fallo(r.product_name, mensajeAmigable(e)); return; }
    useStaffStore.getState().appendAuditLog?.('MINMAX_DISCARD_DRAFT', String(r.erp_product_id), {
      field: 'min+max', product: r.product_name, sucursal_id: sala, old_min: r.draft_min ?? 0, old_max: r.draft_max ?? 0,
      new_min: r.effective_min ?? 0, new_max: r.effective_max ?? 0, desde: 'app',
    });
    setFilas((x) => x.map((f) => (f.erp_product_id === r.erp_product_id ? { ...f, draft_status: 'none', draft_min: r.effective_min, draft_max: r.effective_max } : f)));
  };

  // El CSV del portal (`csvDeMinMax`, núcleo); en Bodega lleva además el stock
  // neto de las salas y el proveedor principal, pedidos en tandas de 1000 ids.
  const exportar = async () => {
    trabajando('Armando el archivo…');
    try {
      const esBodega = Number(sala) === ERP_BODEGA;
      const neto = {}; const proveedor = {};
      if (esBodega && visibles.length) {
        const ids = visibles.map((r) => r.erp_product_id);
        const tandas = []; for (let i = 0; i < ids.length; i += 1000) tandas.push(ids.slice(i, i + 1000));
        const [ns, sp] = await Promise.all([
          Promise.all(tandas.map((t) => fetchStockNetoPorSala({ p_product_ids: t }))),
          Promise.all(tandas.map((t) => fetchProveedorPrincipal({ p_product_ids: t }))),
        ]);
        ns.forEach((r) => (r.data ?? []).forEach((x) => { neto[x.erp_product_id] = x.net_stock; }));
        sp.forEach((r) => (r.data ?? []).forEach((x) => { proveedor[x.erp_product_id] = x.proveedor; }));
      }
      const { headers, filas: csv } = csvDeMinMax(visibles, ERP_NAMES[sala], esBodega, neto, proveedor);
      cerrarProgreso();
      await compartirCsv({ headers, rows: csv, nombre: `minmax_${ERP_NAMES[sala]}_${hoySV()}`, modulo: 'minmax', detalle: { sucursal: ERP_NAMES[sala], bodega: esBodega } });
    } catch (e) { fallo('No se pudo exportar', mensajeAmigable(e)); }
  };

  const menuDeSala = () => {
    Haptics.selectionAsync().catch(() => {});
    const opciones = [];
    if (aDescartar.borradores) opciones.push([hayFiltro && idsFiltrados.length ? `Publicar lo filtrado (${idsFiltrados.length})` : `Publicar todo (${aDescartar.borradores})`, 'publicar']);
    if (aDescartar.total) opciones.push([`Descartar todo (${aDescartar.total})`, 'descartar']);
    opciones.push(['Recalcular la sala', 'recalcular']);
    if (todas) opciones.push(['Configuración y laboratorios', 'config']);
    opciones.push(['Matriz ABC·XYZ', 'matriz']);
    if (hasPermission('minmax_descargar')) opciones.push([`Exportar CSV (${visibles.length})`, 'csv']);
    ActionSheetIOS.showActionSheetWithOptions({
      title: ERP_NAMES[sala], options: [...opciones.map((o) => o[0]), 'Cancelar'],
      destructiveButtonIndex: opciones.findIndex((o) => o[1] === 'descartar'), cancelButtonIndex: opciones.length,
    }, (i) => {
      const accion = opciones[i]?.[1];
      if (accion === 'config') { router.push('/minmax-config'); return; }
      if (accion === 'csv') { exportar(); return; }
      if (accion === 'matriz') { router.push({ pathname: '/minmax-matriz', params: { sala: String(sala) } }); return; }
      if (accion === 'publicar') {
        const ids = hayFiltro && idsFiltrados.length ? idsFiltrados : null;
        Alert.alert('Publicar borradores', `${ids ? ids.length : aDescartar.borradores} borradores pasan a ser el MIN·MAX vigente de ${ERP_NAMES[sala]}. Los que vienen de una solicitud aprobada no se tocan.`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Publicar', onPress: () => publicar(ids) },
        ]);
      } else if (accion === 'descartar') {
        Alert.alert('Descartar todo', `Se descartan ${aDescartar.borradores} borradores${aDescartar.sinDatos ? ` y ${aDescartar.sinDatos} productos sin ventas para calcular (vuelven solos)` : ''}. El MIN·MAX vigente no cambia.`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: descartarTodo },
        ]);
      } else if (accion === 'recalcular') {
        Alert.alert('Recalcular la sala', `Se calcula de nuevo el MIN·MAX de ${ERP_NAMES[sala]} y queda como borrador para revisar.${aDescartar.borradores ? ' Primero hay que publicar o descartar los borradores que ya tiene.' : ''}`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Recalcular', onPress: recalcular },
        ]);
      }
    });
  };

  const encabezado = (
    <View style={{ gap: 12, paddingTop: 12, paddingBottom: 6 }}>
      {todas ? null : <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>{ERP_NAMES[sala]}</Text>}
      {candado ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`Min·Máx está en mantenimiento${candado.locked_by_name ? ` (${candado.locked_by_name})` : ''}: se puede mirar, no cambiar.`} /></View> : null}
      {filas ? (
        <FilaDeKpis>
          <Kpi icono="FileText" rotulo="Borradores" valor={aDescartar.borradores.toLocaleString('es-SV')} color={MARCA.azulClaro}
            apoyo={aDescartar.sinDatos ? `${aDescartar.sinDatos} sin datos` : 'por revisar'} onPress={() => setVista(vista === 'borradores' ? 'todos' : 'borradores')} />
          <Kpi icono="AlertTriangle" rotulo="Sin stock o bajo" valor={alertas.toLocaleString('es-SV')} color={alertas ? MARCA.rojo : MARCA.verde}
            apoyo="productos" onPress={() => setAlerta(alerta === 'below_min' ? 'all' : 'below_min')} />
        </FilaDeKpis>
      ) : null}
      <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'todos', label: 'Todos' }, { id: 'borradores', label: 'Borradores' }, { id: 'cambios', label: 'Cambios' }]} />
      <FiltrosActivos grupos={grupos} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length.toLocaleString('es-SV')} productos${puede ? ' · mantén presionado un borrador para descartarlo' : ''}`}</Text> : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: todas ? `Min·Máx · ${ERP_NAMES[sala] ?? ''}` : 'Min·Máx de la sala', headerLargeTitle: false,
        headerSearchBarOptions: { placeholder: 'Producto o laboratorio', hideWhenScrolling: false, onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      <MenuDeFiltros grupos={grupos} extra={puede && filas ? { icono: 'ellipsis.circle', etiqueta: 'Acciones de la sala', onPress: ocupado ? () => {} : menuDeSala } : null} />
      {filas == null ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
        <FlatList data={visibles} keyExtractor={(r) => String(r.erp_product_id)} ListHeaderComponent={encabezado}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" initialNumToRender={20} windowSize={9}
          contentContainerStyle={{ paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}
          ListEmptyComponent={<Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 30, fontSize: 15 }}>Ningún producto con este filtro.</Text>}
          renderItem={({ item: r }) => (
            <Fila r={r}
              onAbrir={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/minmax-producto', params: { producto: String(r.erp_product_id), nombre: r.product_name } }); }}
              onMantener={puede && r.draft_status === 'pending' ? () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                Alert.alert('Descartar el borrador', `${r.product_name} vuelve a ${r.effective_min ?? 0} · ${r.effective_max ?? 0} y queda sin borrador.`, [
                  { text: 'Cancelar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: () => descartarUno(r) },
                ]);
              } : undefined} />
          )} />
      )}
    </>
  );
}
