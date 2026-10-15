// Revisar la sala completa de Min·Máx, NATIVO — la tabla del portal
// (`TabMinMax` + `useMinMaxData`): todos los productos de una sala con su
// existencia (y su equivalente en la presentación principal), el MIN·MAX
// vigente y el borrador del cálculo; las tarjetas de costo; filtros por ABC,
// XYZ, alerta y estado (poca venta, regla de despacho, crítico A, ocultos y
// ajustes a mano); el orden por columna; y lo que cierra el ciclo del mes:
// PUBLICAR los borradores (todos, los filtrados o uno), DESCARTAR (uno o
// todos), RECALCULAR (la sala o todas), ocultar lo filtrado y restaurar los
// ocultos.
//
// Mantener presionado un producto abre lo que el portal pone en la fila: el
// historial, el motivo del ajuste, publicar o descartar ese borrador, la regla
// de despacho, ocultar o mostrar y —en Bodega, con permiso— 0 en todas las
// salas.
//
// Las reglas son las del portal, en el núcleo (`revisionDeSala`: el filtro, el
// orden, los conteos, cuánto se lleva «Descartar», por qué se negó el cálculo,
// qué decir al publicar, qué se escribe al ocultar). El candado de
// mantenimiento lo respeta solo: `hasPermission` apaga la escritura mientras el
// módulo está tomado por otra persona.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  calcularMinMaxDeSala, calcularMinMaxDeTodasLasSalas, descartarBorradorDeFila, descartarBorradoresDeMinMax, fetchAjustesManuales,
  fetchAnalisisDeStock, fetchCostoEstimadoDelBorrador, fetchProveedorPrincipal, fetchResumenDeCostoDelInventario, fetchStockNetoPorSala,
  ocultarProductoMinMax, publicarMinMax, updateStockParams, updateStockParamsBulk, upsertStockParams, upsertStockParamsBulk,
} from '@nucleo/data/stockParams';
import { csvDeMinMax } from '@nucleo/utils/csvMinMax';
import { hoySV } from '@nucleo/utils/fecha';
import { compartirCsv } from '../componentes/fiscal/csv';
import {
  conteosDeEstadoDeLaSala, cuentaADescartar, estadoAjuste, filaPasaFiltros, filasParaOcultar, mensajeDePublicacion,
  motivoDeSaltoDelCalculo, ordenarFilasDeMinMax, ORDENES_DE_MINMAX,
} from '@nucleo/utils/revisionDeSala';
import { fmtMoney, formatUnits, hasDispatchRisk, sortedPres, sugerenciaParaLaRegla } from '@nucleo/utils/minmaxTabla';
import { planDeGuardadoMinMax } from '@nucleo/utils/minmaxGuardar';
import { ALERTA_ETIQUETA, ESTADOS_DE_AJUSTE, ESTADOS_DE_STOCK, MOTIVO_AJUSTE } from '@nucleo/constants/minmax';
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
const COLOR_AJUSTE = { a_mano: colorSistema.texto2, en_conflicto: MARCA.ambar, volvio_a_moverse: MARCA.violetaClaro, respetado: MARCA.verde };
const ETIQUETA_AJUSTE = Object.fromEntries(ESTADOS_DE_AJUSTE.map((a) => [a.key, a.label]));

function Fila({ r, esBodega, onAbrir, onMantener }) {
  const pendiente = r.draft_status === 'pending';
  const cambia = pendiente && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max);
  const abc = r.draft_abc_class || r.abc_class;
  const ajuste = estadoAjuste(r);
  const regla = !esBodega && hasDispatchRisk(r.effective_max, r.dispatch_pres_factor, r.dispatch_multiplo);
  const pres = r.presentations || [];
  const stock = Number(r.current_stock ?? 0);
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
            <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`Hay ${formatQty(stock)}`}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`MIN·MAX ${r.effective_min ?? 0} · ${r.effective_max ?? 0}`}</Text>
            {pendiente ? (
              <Text style={{ color: cambia ? MARCA.azulClaro : colorSistema.texto2, fontSize: 14, fontWeight: '700' }}>
                {cambia ? `→ ${r.draft_min ?? 0} · ${r.draft_max ?? 0}` : 'borrador sin cambio'}
              </Text>
            ) : null}
          </View>
          {stock > 0 && sortedPres(pres).length ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`≈ ${formatUnits(stock, pres)}`}</Text> : null}
          {esBodega && (r.pub_min || r.pub_max) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Σ salas ${(r.pub_min ?? 0).toLocaleString()} · ${(r.pub_max ?? 0).toLocaleString()}`}</Text> : null}
          {ajuste || regla || r.draft_status === 'sparse_data' ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {ajuste ? <Pildora texto={r._manual_motivo ? `${ETIQUETA_AJUSTE[ajuste]} · ${MOTIVO_AJUSTE[r._manual_motivo]?.label ?? r._manual_motivo}` : ETIQUETA_AJUSTE[ajuste]} color={COLOR_AJUSTE[ajuste]} /> : null}
              {regla ? <Pildora texto="Regla de despacho" color={MARCA.ambar} /> : null}
              {r.draft_status === 'sparse_data' ? <Pildora texto={`${r.draft_data_days ?? ''}d datos`} color={MARCA.ambar} /> : null}
            </View>
          ) : null}
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
  // Las mismas reglas del portal: «0 en todas las salas» lo tiene quien decide
  // sobre todas o quien recibió esa función sola.
  const puedeCeroEnTodas = puede && (todas || hasPermission('minmax_cero_en_todas'));
  const candado = moduleLock?.('minmax');
  const miErp = BRANCH_A_ERP[Number(salaDelUsuario(user))] ?? null;
  const [sala, setSala] = useState(salaParam ? Number(salaParam) : (miErp ?? ERP_ORDEN[0]));
  const esBodega = Number(sala) === ERP_BODEGA;
  const [filas, setFilas] = useState(null);
  const [costo, setCosto] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState('todos');
  const [abc, setAbc] = useState(abcParam ? String(abcParam) : 'all');
  const [xyz, setXyz] = useState(xyzParam ? String(xyzParam) : 'all');
  const [alerta, setAlerta] = useState('all');
  const [estado, setEstado] = useState('');
  const [orden, setOrden] = useState('');
  const [texto, setTexto] = useState('');
  const busca = useTextoRebotado(texto).trim();
  const [ocupado, setOcupado] = useState(false);
  const [recargando, setRecargando] = useState(false);

  // Los ajustes a mano van aparte del análisis, igual que en el portal: con
  // ellos se sabe el estado de cada ajuste y su motivo.
  const cargar = useCallback(async () => {
    setError(null);
    const [{ data, error: e }, ajustesRes, costoRes, borradorRes] = await Promise.all([
      fetchAnalisisDeStock({ p_erp_sucursal_id: sala }),
      fetchAjustesManuales(sala).catch(() => ({ data: [] })),
      fetchResumenDeCostoDelInventario({ p_erp_sucursal_id: sala }),
      fetchCostoEstimadoDelBorrador({ p_erp_sucursal_id: sala }),
    ]);
    if (e) { setError(mensajeAmigable(e)); setFilas([]); return; }
    const ajustes = new Map((ajustesRes?.data || []).map((a) => [a.erp_product_id, a]));
    setFilas((data || []).map((r) => {
      const a = ajustes.get(r.erp_product_id);
      return {
        ...r, _erp_sucursal_id: sala,
        _manual_at: a?.manual_at ?? null, _manual_por: a?.manual_por ?? null, _manual_motivo: a?.manual_motivo ?? null,
        _manual_nota: a?.manual_nota ?? null, _manual_cliente_unidades: a?.manual_cliente_unidades ?? null,
        _manual_cliente_dias: a?.manual_cliente_dias ?? null, _ajuste_solicitud_id: a?.ajuste_solicitud_id ?? null,
      };
    }));
    setCosto({ resumen: costoRes?.data ?? null, borrador: borradorRes?.data ?? null });
  }, [sala]);
  useEffect(() => { setFilas(null); setCosto(null); setEstado(''); cargar(); }, [cargar]);
  // Al volver del motivo, del historial o de «0 en todas», lo que se escribió
  // allá tiene que verse acá. La primera vez no: ya cargó el efecto de arriba.
  const yaEnfocada = useRef(false);
  useFocusEffect(useCallback(() => {
    if (yaEnfocada.current) cargar(); else yaEnfocada.current = true;
  }, [cargar]));

  const ocultos = useMemo(() => new Set((filas || []).filter((r) => r.is_hidden).map((r) => r.erp_product_id)), [filas]);
  const conteos = useMemo(() => conteosDeEstadoDeLaSala(filas), [filas]);
  const filtros = {
    ocultos, soloOcultos: estado === 'ocultos', soloSinDatos: estado === 'sparse', riesgoDeDespacho: estado === 'riesgo',
    ajuste: estado.startsWith('ajuste:') ? estado.slice(7) : 'all',
    soloBorradores: vista === 'borradores', soloCambios: vista === 'cambios',
    abc: estado === 'criticoA' ? 'A' : abc, xyz, alerta, hayBusqueda: !!busca,
  };
  const visibles = useMemo(() => {
    const base = (filas || [])
      .filter((r) => filaPasaFiltros(r, filtros))
      .filter((r) => estado !== 'criticoA' || ['out_of_stock', 'below_min'].includes(r.alert_status))
      .filter((r) => !busca || tokenMatch(busca, r.product_name, r.laboratorio_nombre));
    if (!orden) return base;
    const [clave, dir] = orden.split(':');
    return ordenarFilasDeMinMax(base, clave, dir);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, ocultos, vista, abc, xyz, alerta, estado, busca, orden]);
  const aDescartar = useMemo(() => cuentaADescartar(filas, sala), [filas, sala]);
  const hayFiltro = abc !== 'all' || xyz !== 'all' || alerta !== 'all' || (!!estado && estado !== 'ocultos') || !!busca;
  const idsFiltrados = useMemo(() => visibles.filter((r) => r.draft_status === 'pending').map((r) => r.erp_product_id), [visibles]);
  const alertas = useMemo(() => (filas || []).filter((r) => !ocultos.has(r.erp_product_id) && ['out_of_stock', 'below_min'].includes(r.alert_status)).length, [filas, ocultos]);

  const opcionesEstado = [
    { id: '', label: 'Todos' },
    ...(conteos.publicado && conteos.criticoA ? [{ id: 'criticoA', label: `${conteos.criticoA} Crítico A` }] : []),
    ...(conteos.sinDatos ? [{ id: 'sparse', label: `${conteos.sinDatos} Poca venta` }] : []),
    ...(!esBodega && conteos.riesgo ? [{ id: 'riesgo', label: `${conteos.riesgo} Regla de despacho` }] : []),
    ...(conteos.ocultos ? [{ id: 'ocultos', label: `${conteos.ocultos} Ocultos` }] : []),
    ...(conteos.ajustadas ? [{ id: 'ajuste:any', label: `${conteos.ajustadas} Ajustado a mano` }] : []),
    ...ESTADOS_DE_AJUSTE.filter((a) => conteos.ajustes[a.key]).map((a) => ({ id: `ajuste:${a.key}`, label: `${conteos.ajustes[a.key]} · ${a.label}` })),
  ];
  const grupos = [
    ...(todas ? [{ id: 'sala', titulo: 'Sala', activa: String(sala), porDefecto: String(miErp ?? ERP_ORDEN[0]), onCambiar: (v) => setSala(Number(v)),
      opciones: ERP_ORDEN.map((e) => ({ id: String(e), label: ERP_NAMES[e] })) }] : []),
    { id: 'estado', titulo: 'Estado', activa: estado, porDefecto: '', onCambiar: setEstado, opciones: opcionesEstado },
    { id: 'abc', titulo: 'ABC', activa: abc, porDefecto: 'all', onCambiar: setAbc, opciones: [{ id: 'all', label: 'Todas las clases' }, ...['A', 'B', 'C', 'D'].map((x) => ({ id: x, label: `Clase ${x}` }))] },
    { id: 'xyz', titulo: 'XYZ', activa: xyz, porDefecto: 'all', onCambiar: setXyz, opciones: [{ id: 'all', label: 'Toda variabilidad' }, ...['X', 'Y', 'Z'].map((x) => ({ id: x, label: x }))] },
    { id: 'alerta', titulo: 'Alerta', activa: alerta, porDefecto: 'all', onCambiar: setAlerta, opciones: [{ id: 'all', label: 'Todas' }, ...ESTADOS_DE_STOCK.map((e) => ({ id: e.key, label: e.label }))] },
    { id: 'orden', titulo: 'Ordenar', activa: orden, porDefecto: '', onCambiar: setOrden, opciones: [
      { id: '', label: 'Sin orden' },
      ...ORDENES_DE_MINMAX.flatMap((o) => [{ id: `${o.key}:asc`, label: `${o.label} ↑` }, { id: `${o.key}:desc`, label: `${o.label} ↓` }]),
    ] },
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
  // Todas las salas, de a una: el recorrido es el del núcleo, el mismo del portal.
  const recalcularTodas = async () => {
    setOcupado(true);
    try {
      const r = await calcularMinMaxDeTodasLasSalas(ERP_ORDEN.filter((id) => id !== ERP_BODEGA),
        (i, total, id) => trabajando(`Calculando ${ERP_NAMES[id]} (${i} de ${total})…`));
      const partes = [];
      if (r.saltadas.length) partes.push(`Con borradores sin revisar (no se recalcularon): ${r.saltadas.map((id) => ERP_NAMES[id]).join(', ')}`);
      if (r.fallidas.length) partes.push(`Error en: ${r.fallidas.map((id) => ERP_NAMES[id]).join(', ')}`);
      if (partes.length) fallo('Calcular', partes.join('. '));
      else listo('Todas las sucursales', `${r.filas.toLocaleString()} borradores generados`);
      await cargar();
      setVista('cambios');
    } finally { setOcupado(false); }
  };
  const ocultarFiltrados = async () => {
    const ids = visibles.map((r) => r.erp_product_id);
    if (!ids.length) return;
    setOcupado(true);
    trabajando('Ocultando…');
    const { error: e } = await upsertStockParamsBulk(filasParaOcultar(ids, sala));
    setOcupado(false);
    if (e) { fallo('No se pudo ocultar', mensajeAmigable(e)); return; }
    anotar('MINMAX_HIDE_FILTERED', { count: ids.length });
    listo(ERP_NAMES[sala], `Ocultó ${ids.length} producto${ids.length !== 1 ? 's' : ''}`);
    await cargar();
  };
  const restaurarOcultos = async () => {
    const ids = [...ocultos];
    if (!ids.length) return;
    setOcupado(true);
    trabajando('Restaurando…');
    const { error: e } = await updateStockParamsBulk(ids, sala, { is_hidden: false, updated_at: new Date().toISOString() });
    setOcupado(false);
    if (e) { fallo('No se pudo restaurar', mensajeAmigable(e)); return; }
    anotar('MINMAX_UNHIDE_ALL', { count: ids.length });
    listo(ERP_NAMES[sala], `Volvieron ${ids.length} producto${ids.length !== 1 ? 's' : ''}`);
    setEstado('');
    await cargar();
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
  const ocultarUno = async (r) => {
    const { error: e } = await ocultarProductoMinMax(r.erp_product_id, sala, { product: r.product_name, desde: 'app' });
    if (e) { fallo('No se pudo ocultar', mensajeAmigable(e)); return; }
    listo('Oculto en la sala', r.product_name);
    await cargar();
  };
  const mostrarUno = async (r) => {
    const { error: e } = await updateStockParams(r.erp_product_id, sala, { is_hidden: false, updated_at: new Date().toISOString() });
    if (e) { fallo('No se pudo mostrar', mensajeAmigable(e)); return; }
    useStaffStore.getState().appendAuditLog?.('MINMAX_UNHIDE', String(r.erp_product_id), { sucursal_id: sala, desde: 'app' });
    listo('Vuelve a la sala', r.product_name);
    await cargar();
  };
  // La regla de despacho: el paquete, el MAX de hoy, y el número más chico que
  // destraba el producto (`sugerenciaParaLaRegla`, núcleo). Aceptar escribe por
  // el mismo camino que una edición (`planDeGuardadoMinMax`): en vivo o al
  // borrador según la sala.
  const reglaDeDespacho = (r) => {
    const factor = Number(r.dispatch_pres_factor || 0);
    const multiplo = Number(r.dispatch_multiplo ?? 1);
    const paquete = factor * multiplo;
    const minHoy = Number(r.effective_min ?? 0);
    const maxHoy = Number(r.effective_max ?? 0);
    const sug = sugerenciaParaLaRegla(minHoy, maxHoy, factor, multiplo);
    const como = r.dispatch_tipo ? `${r.dispatch_tipo}${multiplo > 1 ? ` ×${multiplo}` : ''}` : `${paquete.toLocaleString()} und`;
    const texto = `Se despacha de a ${paquete.toLocaleString()} und (${como}).\n\nEl MAX de hoy es ${maxHoy.toLocaleString()}, y aunque la sala quede en cero eso no llega a pedir ni un paquete: el pedido redondea a cero y este producto nunca entra.`
      + (sug ? `\n\nSugerencia: ${minHoy} · ${maxHoy} → ${sug.minNuevo} · ${sug.maxNuevo}. ${sug.maxNuevo} es el MAX más chico que alcanza el 40% del paquete, el umbral del armado del pedido.` : '')
      + `\n\nSi de verdad no se pide de a ${paquete.toLocaleString()} unidades, lo que hay que cambiar es la regla (Pedidos → Reglas de despacho) y no el MAX.`;
    Alert.alert(r.product_name, texto, [
      { text: 'Cerrar', style: 'cancel' },
      ...(sug && puede ? [{ text: 'Aceptar sugerencia', onPress: async () => {
        const plan = planDeGuardadoMinMax({ row: r, productId: r.erp_product_id, sucursalId: sala, min: String(sug.minNuevo), max: String(sug.maxNuevo), hayPublicado: conteos.publicado, confirmado: true });
        if (plan.sinCambio) return;
        if (plan.error) { fallo('No se puede guardar', plan.error); return; }
        trabajando('Guardando el MIN·MAX…');
        const { error: e } = await upsertStockParams(plan.payload);
        if (e) { fallo('No se pudo guardar', mensajeAmigable(e)); return; }
        useStaffStore.getState().appendAuditLog?.(plan.accion, String(r.erp_product_id), { ...plan.detalle, product: r.product_name, desde: 'app' });
        listo(plan.tipo === 'borrador' ? 'Quedó en el borrador' : 'MIN·MAX actualizado', `${sug.minNuevo} · ${sug.maxNuevo}`);
        await cargar();
      } }] : []),
    ]);
  };

  const menuDeFila = (r) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const borrador = r.draft_status === 'pending';
    const regla = !esBodega && hasDispatchRisk(r.effective_max, r.dispatch_pres_factor, r.dispatch_multiplo);
    const params = { producto: String(r.erp_product_id), sala: String(sala), nombre: r.product_name };
    const opciones = [['Historial de cambios', 'hist']];
    if (puede) opciones.push([r._manual_motivo ? 'Ver motivo del ajuste' : 'Poner motivo del ajuste', 'motivo']);
    if (puede && borrador && !esBodega) opciones.push(['Publicar este borrador', 'pub'], ['Descartar el borrador', 'desc']);
    if (regla) opciones.push(['Regla de despacho', 'regla']);
    if (puede && !esBodega) opciones.push([r.is_hidden ? 'Mostrar en la sala' : 'Ocultar en la sala', r.is_hidden ? 'mostrar' : 'ocultar']);
    if (esBodega && puedeCeroEnTodas) opciones.push(['0 en todas las salas', 'cero']);
    const destructivos = opciones.map((o, i) => (['desc', 'ocultar', 'cero'].includes(o[1]) ? i : -1)).filter((i) => i >= 0);
    ActionSheetIOS.showActionSheetWithOptions({
      title: r.product_name, options: [...opciones.map((o) => o[0]), 'Cancelar'],
      destructiveButtonIndex: destructivos, cancelButtonIndex: opciones.length,
    }, (i) => {
      const accion = opciones[i]?.[1];
      if (accion === 'hist') router.push({ pathname: '/minmax-historial', params });
      else if (accion === 'motivo') router.push({ pathname: '/minmax-motivo', params });
      else if (accion === 'regla') reglaDeDespacho(r);
      else if (accion === 'mostrar') mostrarUno(r);
      else if (accion === 'cero') router.push({ pathname: '/minmax-cero', params: { producto: params.producto, nombre: r.product_name, clase: r.draft_abc_class || r.abc_class || '', velocidad: String(r.daily_velocity ?? 0) } });
      else if (accion === 'pub') {
        Alert.alert('Publicar este borrador', `${r.product_name} pasa a ${r.draft_min ?? 0} · ${r.draft_max ?? 0} como MIN·MAX vigente de ${ERP_NAMES[sala]}.`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Publicar', onPress: () => publicar([r.erp_product_id]) },
        ]);
      } else if (accion === 'desc') {
        Alert.alert('Descartar el borrador', `${r.product_name} vuelve a ${r.effective_min ?? 0} · ${r.effective_max ?? 0} y queda sin borrador.`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: () => descartarUno(r) },
        ]);
      } else if (accion === 'ocultar') {
        Alert.alert('Ocultar en esta sala', `${r.product_name} deja de tener Mín·Máx en ${ERP_NAMES[sala]} y no se le vuelve a calcular.`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Ocultar', style: 'destructive', onPress: () => ocultarUno(r) },
        ]);
      }
    });
  };

  // El CSV del portal (`csvDeMinMax`, núcleo); en Bodega lleva además el stock
  // neto de las salas y el proveedor principal, pedidos en tandas de 1000 ids.
  const exportar = async () => {
    trabajando('Armando el archivo…');
    try {
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
    if (todas) opciones.push(['Recalcular todas las sucursales', 'recalcularTodas']);
    if (hayFiltro && visibles.length && !esBodega) opciones.push([`Ocultar lo filtrado (${visibles.length})`, 'ocultarFiltrados']);
    if (estado === 'ocultos' && ocultos.size) opciones.push([`Restaurar ${ocultos.size} oculto${ocultos.size === 1 ? '' : 's'}`, 'restaurar']);
    if (todas) opciones.push(['Configuración y laboratorios', 'config']);
    opciones.push(['Matriz ABC·XYZ', 'matriz']);
    if (hasPermission('minmax_descargar')) opciones.push([`Exportar CSV (${visibles.length})`, 'csv']);
    const destructivos = opciones.map((o, i) => (['descartar', 'ocultarFiltrados'].includes(o[1]) ? i : -1)).filter((i) => i >= 0);
    ActionSheetIOS.showActionSheetWithOptions({
      title: ERP_NAMES[sala], options: [...opciones.map((o) => o[0]), 'Cancelar'],
      destructiveButtonIndex: destructivos, cancelButtonIndex: opciones.length,
    }, (i) => {
      const accion = opciones[i]?.[1];
      if (accion === 'config') { router.push('/minmax-config'); return; }
      if (accion === 'csv') { exportar(); return; }
      if (accion === 'matriz') { router.push({ pathname: '/minmax-matriz', params: { sala: String(sala) } }); return; }
      if (accion === 'restaurar') { restaurarOcultos(); return; }
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
      } else if (accion === 'recalcularTodas') {
        Alert.alert('Recalcular todas las sucursales', 'Se generan nuevos borradores para todas las sucursales, de a una. Las que tienen borradores sin revisar se saltan. Bodega se arma sola al publicar.', [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Recalcular', onPress: recalcularTodas },
        ]);
      } else if (accion === 'ocultarFiltrados') {
        Alert.alert(`¿Ocultar ${visibles.length} producto${visibles.length !== 1 ? 's' : ''}?`, `Los productos filtrados en ${ERP_NAMES[sala]} quedan ocultos y sin MIN·MAX. Se revierte desde el estado «Ocultos».`, [
          { text: 'Cancelar', style: 'cancel' }, { text: 'Ocultar', style: 'destructive', onPress: ocultarFiltrados },
        ]);
      }
    });
  };

  // Las tarjetas de costo del portal (`CostCards` + `DraftCostCard`): en Bodega
  // no hay «útil» ni «excedente», y el techo es la suma de la red.
  const resumen = costo?.resumen;
  const borrador = costo?.borrador;
  const techo = (() => {
    if (!borrador) return null;
    const pubMax = Number(borrador.pub_max_cost ?? borrador.max_cost ?? 0);
    const effMax = Number(borrador.eff_max_cost ?? pubMax);
    const hay = Number(borrador.draft_count ?? 0) > 0;
    if (!pubMax && !effMax) return null;
    const delta = effMax - pubMax;
    return { valor: hay ? effMax : pubMax, apoyo: hay && Math.abs(delta) > 0.01 ? `Borrador ${delta >= 0 ? '+' : ''}${fmtMoney(delta)}` : 'Techo al MAX' };
  })();

  const encabezado = (
    <View style={{ gap: 12, paddingTop: 12, paddingBottom: 6 }}>
      {todas ? null : <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>{ERP_NAMES[sala]}</Text>}
      {candado ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`Min·Máx está en mantenimiento${candado.locked_by_name ? ` (${candado.locked_by_name})` : ''}: se puede mirar, no cambiar.`} /></View> : null}
      {esBodega && filas ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono={conteos.bodegaPendientes ? 'cuidado' : 'nota'} texto={`En Bodega, MIN/MAX = Σ sucursales publicadas.${conteos.bodegaPendientes ? ` ${conteos.bodegaPendientes} pendiente${conteos.bodegaPendientes !== 1 ? 's' : ''} de que las salas publiquen.` : ''}`} />
        </View>
      ) : null}
      {filas ? (
        <FilaDeKpis>
          <Kpi icono="FileText" rotulo="Borradores" valor={aDescartar.borradores.toLocaleString('es-SV')} color={MARCA.azulClaro}
            apoyo={aDescartar.sinDatos ? `${aDescartar.sinDatos} sin datos` : 'por revisar'} onPress={() => setVista(vista === 'borradores' ? 'todos' : 'borradores')} />
          <Kpi icono="AlertTriangle" rotulo="Sin stock o bajo" valor={alertas.toLocaleString('es-SV')} color={alertas ? MARCA.rojo : MARCA.verde}
            apoyo="productos" onPress={() => setAlerta(alerta === 'below_min' ? 'all' : 'below_min')} />
        </FilaDeKpis>
      ) : null}
      {resumen ? (
        <>
          <FilaDeKpis>
            <Kpi icono="DollarSign" rotulo="Inventario" valor={fmtMoney(Number(resumen.total_cost) || 0)} color={MARCA.azulClaro} apoyo="Stock total" />
            <Kpi icono="Archive" rotulo="Sin movimiento" valor={fmtMoney(Number(resumen.dead_cost) || 0)} color={colorSistema.texto2} apoyo="Sin MIN/MAX" />
          </FilaDeKpis>
          {!esBodega || techo ? (
            <FilaDeKpis>
              {!esBodega ? <Kpi icono="TrendingUp" rotulo="Útil" valor={fmtMoney(Number(resumen.useful_cost) || 0)} color={MARCA.verde} apoyo="Bajo MAX" /> : null}
              {!esBodega ? <Kpi icono="TrendingDown" rotulo="Excedente" valor={fmtMoney(Number(resumen.excess_cost) || 0)} color={MARCA.ambar} apoyo="Sobre MAX" /> : null}
              {esBodega && techo ? <Kpi icono="Target" rotulo="Σ red al MAX" valor={fmtMoney(techo.valor)} color={MARCA.violetaClaro} apoyo={techo.apoyo} /> : null}
            </FilaDeKpis>
          ) : null}
          {!esBodega && techo ? (
            <FilaDeKpis>
              <Kpi icono="Target" rotulo="Catálogo al MAX" valor={fmtMoney(techo.valor)} color={MARCA.violetaClaro} apoyo={techo.apoyo} />
            </FilaDeKpis>
          ) : null}
        </>
      ) : null}
      <Segmentos activa={vista} onCambiar={setVista} opciones={[{ id: 'todos', label: 'Todos' }, { id: 'borradores', label: 'Borradores' }, { id: 'cambios', label: 'Cambios' }]} />
      <FiltrosActivos grupos={grupos} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {filas ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>{`${visibles.length.toLocaleString('es-SV')} productos · mantén presionado uno para ver su historial${puede ? ', el motivo y sus acciones' : ''}`}</Text> : null}
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
            <Fila r={r} esBodega={esBodega}
              onAbrir={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/minmax-producto', params: { producto: String(r.erp_product_id), nombre: r.product_name } }); }}
              onMantener={() => menuDeFila(r)} />
          )} />
      )}
    </>
  );
}
