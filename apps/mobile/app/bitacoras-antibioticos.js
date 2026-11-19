// Antibióticos de Bitácoras, NATIVO — el grupo «Antibióticos» del portal
// (`BitacorasView`, secciones «Listado» y «Por lote») más el cuadre del mes
// con su hoja de movimientos (`TabCierre` → `HojaCuadreAntibioticos`). Las
// mismas funciones y reglas del núcleo; aquí sólo se dibuja.
//
//   · Listado: una molécula con su grupo AWaRe y sus productos (vía y cómo se
//     vende). Toda la red: la sucursal no lo recorta. El regente confirma el
//     grupo (`bitacoras_confirmar_aware`); quien edita
//     (`bitacoras_editar_antibioticos`) asigna, saca y devuelve productos.
//   · Por lote: el registro por lote del mes (Guía SRS 3.3/3.4). Tocar un lote
//     abre sus movimientos con el saldo corrido.
//   · Cuadre: el conteo del mes y la hoja de movimientos por producto.
// Las tres descargas son el mismo CSV del portal, anotado como salida de datos.
//
// `?sala=` la sucursal que se miraba en Bitácoras.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  GRUPOS_AWARE, VENTA_ANTIBIOTICO, VIAS_ANTIBIOTICO, antibioticoAutomatico, confirmarMoleculaAware, correrPeriodo,
  devolverAlLibro, fetchAntibioticosPorRevisar, fetchCuadreAntibioticos, fetchListadoAntibioticos,
  fetchRegistroAntibioticosLote, sacarDelLibro,
} from '@nucleo/data/bitacoras';
import {
  TIPO_MOVIMIENTO, contarPorEstado, csvDelRegistro, enCajas, estadoDeFila, explicarDiferencia, filasDelRegistro, saldoCorrido,
} from '@nucleo/utils/registroAntibioticos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { fechaTexto, hoySV, mesSV } from '@nucleo/utils/fecha';
import { salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { Presionable as Pressable } from '../componentes/Tocable';
import Refrescar from '../componentes/Refrescar';
import { useEnTramos } from '../componentes/alFinal';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Cargando, Dato, Seccion, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { FiltrosActivos, MenuDeFiltros } from '../componentes/Filtros';
import Segmentos from '../componentes/Segmentos';
import Subfiltro from '../componentes/Subfiltro';
import FijoArriba from '../componentes/FijoArriba';
import PasoDeMes from '../componentes/PasoDeMes';
import Vidrio from '../componentes/Vidrio';
import { FONDO_CONTROL, MARCA } from '../componentes/inicio/marca';
import { compartirCsv } from '../componentes/fiscal/csv';
import { fallo, listo } from '../componentes/Progreso';
import { BotonChico, Hoja, pedirMotivo } from '../componentes/bitacoras/Piezas';
import EditarAntibiotico from '../componentes/bitacoras/EditarAntibiotico';

const VACIO = [];
const VIA = Object.fromEntries(VIAS_ANTIBIOTICO.map((v) => [v.value, v.label]));
const COLOR = { success: MARCA.verde, warning: MARCA.ambar, danger: MARCA.rojo, neutral: MARCA.gris, get info() { return MARCA.azulClaro; } };
const fmtNum = (v, dec = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-SV', { maximumFractionDigits: dec }));
const fmtSigno = (v) => (v > 0 ? `+${fmtNum(v)}` : fmtNum(v));
const fmtVence = (f) => fechaTexto(f, { month: 'short', year: 'numeric' }, '');
const fmtDiaCorto = (f) => fechaTexto(f, { day: 'numeric', month: 'short' }, '—');
const fmtDiaLargo = (f) => fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }, '—');
const distinto = (v) => v !== null && v !== undefined && Number(v) !== 0;
const filaConDiferencia = (f) => distinto(f.otros) || distinto(f.conteo_diferencia);
const ESTADO_LOTE = {
  cuadra: { color: MARCA.verde, label: 'Cuadra' },
  diferencia: { color: MARCA.rojo, label: 'Diferencia' },
  sin_base: { color: MARCA.gris, label: 'Sin saldo inicial' },
  sin_lote: { color: MARCA.ambar, label: 'Sin lote' },
};

function Tarjeta({ children, onPress }) {
  const cuerpo = <Vidrio radio={20} interactivo={!!onPress}><View style={{ padding: 14, gap: 6 }}>{children}</View></Vidrio>;
  if (!onPress) return <View style={{ marginHorizontal: 16 }}>{cuerpo}</View>;
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ marginHorizontal: 16, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      {cuerpo}
    </Pressable>
  );
}

const T = ({ children, tenue, fuerte, tam = 15, color, style }) => (
  <Text style={[{ color: color ?? (tenue ? colorSistema.texto2 : colorSistema.texto), fontSize: tam, fontWeight: fuerte ? '700' : '400' }, style]}>{children}</Text>
);

/** Una cantidad en unidades con su equivalente en cajas debajo, si aporta. */
function Cantidad({ rotulo, u, factor }) {
  const cajas = enCajas(u, factor);
  return (
    <View style={{ minWidth: '30%', flexGrow: 1, padding: 8, borderRadius: 12, backgroundColor: FONDO_CONTROL }}>
      <T tenue tam={12}>{rotulo}</T>
      <T fuerte style={{ fontVariant: ['tabular-nums'] }}>{fmtNum(u)}</T>
      {cajas ? <T tenue tam={12}>{cajas}</T> : null}
    </View>
  );
}

// ── Por lote: el detalle de un lote ─────────────────────────────────────────
function DetalleLote({ fila, registro, onCerrar }) {
  const movimientos = useMemo(() => saldoCorrido(fila), [fila]);
  const explicacion = explicarDiferencia(fila);
  const estado = estadoDeFila(fila);
  const cp = fila.cuadre_producto;
  const e = ESTADO_LOTE[estado];
  return (
    <Hoja titulo={fila.producto} onCerrar={onCerrar}
      subtitulo={`Lote ${fila.lote}${fila.vence ? ` · vence ${fmtVence(fila.vence)}` : ''}${fila.factor_caja > 1 ? ` · caja de ${fila.factor_caja}` : ''}`}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pildora texto={e.label} color={e.color} />
        {fila.en_el_libro ? <Pildora texto="Va al libro bajo receta" color={MARCA.azulClaro} /> : null}
        {fila.aproximado ? <Pildora texto="Reparto aproximado" color={MARCA.ambar} /> : null}
        {fila.en_vencidos > 0 ? <Pildora texto={`${fmtNum(fila.en_vencidos)} en vencidos`} color={MARCA.ambar} /> : null}
      </View>
      {explicacion ? <Aviso tono={estado === 'diferencia' ? 'cuidado' : 'nota'} texto={explicacion} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Cantidad rotulo="Saldo inicial" u={fila.inicial} factor={fila.factor_caja} />
        <Cantidad rotulo="Entradas" u={fila.entradas} factor={fila.factor_caja} />
        <Cantidad rotulo="Salidas" u={fila.salidas ? -fila.salidas : 0} factor={fila.factor_caja} />
        <Cantidad rotulo="Debería haber" u={fila.final_calculado} factor={fila.factor_caja} />
        <Cantidad rotulo="Hay" u={fila.existencia} factor={fila.factor_caja} />
      </View>
      <Seccion titulo="Movimientos">
        {movimientos.length ? movimientos.map((m, i) => (
          <View key={`${m.fecha}-${m.documento}-${i}`} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
            <View style={{ flex: 1 }}>
              <T fuerte>{TIPO_MOVIMIENTO[m.tipo] ?? m.tipo}</T>
              {m.detalle ? <T tenue tam={13}>{m.detalle}</T> : null}
              <T tenue tam={13}>{[fmtDiaCorto(m.fecha), m.documento || null, m.responsable || null].filter(Boolean).join(' · ')}</T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T fuerte color={m.unidades < 0 ? MARCA.rojo : MARCA.verde} style={{ fontVariant: ['tabular-nums'] }}>{`${fmtSigno(m.unidades)}${m.aproximado ? '*' : ''}`}</T>
              <T tenue tam={13} style={{ fontVariant: ['tabular-nums'] }}>{`Saldo ${fmtNum(m.saldo)}`}</T>
            </View>
          </View>
        )) : <Vacio enSeccion titulo="Sin movimientos este mes" />}
      </Seccion>
      {fila.aproximado ? <Aviso texto="* En ese traslado los lotes anotados no suman lo enviado. La cantidad se repartió entre ellos." /> : null}
      {cp ? (
        <Aviso texto={`El producto entero (${registro?.desde ? `desde el ${fmtDiaCorto(registro.desde)}` : 'este mes'}): inicial ${fmtNum(cp.inicial)}, movimientos ${fmtSigno(Number(cp.neto))}, hay ${fmtNum(cp.existencia)}${cp.diferencia !== null && cp.diferencia !== undefined ? (Number(cp.diferencia) === 0 ? '. Cuadra.' : `. Diferencia ${fmtSigno(Number(cp.diferencia))}.`) : '.'}`} />
      ) : null}
    </Hoja>
  );
}

export default function AntibioticosDeBitacoras() {
  const { sala: salaParam } = useLocalSearchParams();
  const { user, hasPermission, getScope } = useAuth();
  const branches = useStaffStore((s) => s.branches) || VACIO;
  const puedeConfirmar = hasPermission('bitacoras_confirmar_aware', 'can_edit');
  const puedeEditar = hasPermission('bitacoras_editar_antibioticos', 'can_edit');
  const alcanceTodas = getScope('bitacoras') === 'ALL';
  const miSala = salaDelUsuario(user);
  const salas = useMemo(() => salasDeBitacora(branches), [branches]);
  const [elegida, setElegida] = useState(null);
  const pedida = String(salaParam || miSala || '');
  // Quien ve todas las salas y es de una que no lleva bitácora arranca en la
  // primera que sí la lleva (como el portal).
  const sala = elegida ?? (salas.some((o) => o.value === pedida) || !alcanceTodas ? pedida : (salas[0]?.value ?? ''));
  const salaValida = Boolean(sala) && salas.some((o) => o.value === String(sala));
  const nombreSala = branches.find((b) => String(b.id) === String(sala))?.name || '';

  const [seccion, setSeccion] = useState('listado');
  const [texto, setTexto] = useState('');
  const busqueda = useTextoRebotado(texto).trim();
  const [recargando, setRecargando] = useState(false);

  // ── Listado ──────────────────────────────────────────────────────────────
  const [vista, setVista] = useState('listado');
  const [venta, setVenta] = useState('todos');
  const [filas, setFilas] = useState(null);
  const [revisar, setRevisar] = useState({ fuera: [], excluidos: [] });
  const [errorListado, setErrorListado] = useState(null);
  const [confirmando, setConfirmando] = useState(null);
  const [editando, setEditando] = useState(null);
  const [verDistintos, setVerDistintos] = useState(false);
  const cargarListado = useCallback(async () => {
    const [r, rv] = await Promise.all([fetchListadoAntibioticos(), fetchAntibioticosPorRevisar()]);
    setFilas(r.filas); setRevisar(rv); setErrorListado(r.error || rv.error);
  }, []);
  useEffect(() => { if (seccion === 'listado' && filas == null) cargarListado(); }, [seccion, filas, cargarListado]);

  const todas = useMemo(() => {
    const m = new Map();
    for (const f of filas || []) {
      if (!m.has(f.molecula)) m.set(f.molecula, { molecula: f.molecula, grupo: f.grupo, atc: f.atc, fuente: f.fuente, confirmado: f.confirmado, productos: [] });
      m.get(f.molecula).productos.push(f);
    }
    return [...m.values()];
  }, [filas]);
  // Lo del libro que ninguna molécula reclama va arriba, como «sin molécula».
  const conSinAsignar = useMemo(() => (revisar.fuera.length
    ? [{ molecula: null, productos: revisar.fuera.map((p) => ({ ...p, origen: 'nuevo' })) }, ...todas] : todas), [todas, revisar.fuera]);
  const moleculas = useMemo(() => {
    const porVenta = venta === 'todos' ? conSinAsignar
      : conSinAsignar.filter((x) => x.molecula).map((x) => ({ ...x, productos: x.productos.filter((p) => p.venta === venta) })).filter((x) => x.productos.length);
    if (!busqueda) return porVenta;
    return porVenta.filter((x) => tokenMatch(busqueda, x.molecula, x.atc, ...x.productos.map((p) => p.producto)));
  }, [conSinAsignar, busqueda, venta]);
  const filtrarProductos = useCallback((lista) => (busqueda ? lista.filter((p) => tokenMatch(busqueda, p.producto, p.principio_activo)) : lista), [busqueda]);
  const cuentaVenta = useMemo(() => {
    const c = { LIBRO: 0, RECETA: 0, LIBRE: 0 };
    for (const f of filas || []) if (c[f.venta] != null) c[f.venta] += 1;
    return c;
  }, [filas]);
  const sinConfirmar = todas.filter((m) => !m.confirmado).length;
  const libroDistinto = (filas || []).filter((f) => f.revisar_libro);

  const confirmar = async (m) => {
    setConfirmando(m.molecula);
    const { error } = await confirmarMoleculaAware(m.molecula, m.grupo);
    setConfirmando(null);
    if (error) { fallo('No se pudo confirmar', mensajeAmigable(error)); return; }
    listo(`${m.molecula}: confirmado`);
    cargarListado();
  };
  const devolver = async (p) => {
    const { error } = await antibioticoAutomatico(p.product_id);
    if (error) { fallo('No se pudo devolver', mensajeAmigable(error)); return; }
    listo('Devuelto al listado', p.producto);
    cargarListado();
  };
  // «No va al libro»: pide receta pero no se anota (2026-10-28, la ranitidina).
  const sacar = async (p) => {
    const motivo = await pedirMotivo({ titulo: 'No va al libro', mensaje: `${p.producto}: se sigue vendiendo con receta, pero no se anota en el libro. Escribe por qué.`, confirmar: 'Sacar del libro' });
    if (!motivo) return;
    const { error } = await sacarDelLibro(p.product_id, motivo);
    if (error) { fallo('No se pudo sacar del libro', mensajeAmigable(error)); return; }
    listo('Ya no va al libro', p.producto);
    cargarListado();
  };
  const volverAlLibro = async (p) => {
    const { error } = await devolverAlLibro(p.product_id);
    if (error) { fallo('No se pudo devolver al libro', mensajeAmigable(error)); return; }
    listo('Vuelve al libro', p.producto);
    cargarListado();
  };
  const exportarListado = () => compartirCsv({
    headers: ['Molécula', 'Grupo AWaRe', 'ATC', 'Fuente', 'Confirmado por el regente', 'Producto', 'Principio activo', 'Vía', 'Venta'],
    rows: (filas || []).map((f) => [
      f.molecula, GRUPOS_AWARE[f.grupo]?.label || 'Sin clasificar', f.atc || '', f.fuente, f.confirmado ? 'Sí' : 'No',
      f.producto, f.principio_activo || '', VIA[f.via] || '', VENTA_ANTIBIOTICO[f.venta]?.label || '',
    ]),
    nombre: `listado_antibioticos_${hoySV()}`, modulo: 'bitacoras',
  }).catch((e) => fallo('No se pudo compartir', e?.message || ''));

  // ── Por lote ─────────────────────────────────────────────────────────────
  const [mesLotes, setMesLotes] = useState(() => mesSV());
  const [filtroLotes, setFiltroLotes] = useState('todos');
  const [registro, setRegistro] = useState(null);
  const [cargandoLotes, setCargandoLotes] = useState(false);
  const [errorLotes, setErrorLotes] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const cargarLotes = useCallback(async () => {
    if (!salaValida) return;
    setCargandoLotes(true);
    const { registro: r, error } = await fetchRegistroAntibioticosLote(sala, mesLotes);
    setRegistro(r); setErrorLotes(error ? mensajeAmigable(error) : null); setCargandoLotes(false);
  }, [salaValida, sala, mesLotes]);
  useEffect(() => { if (seccion === 'lotes') cargarLotes(); }, [seccion, cargarLotes]);
  const filasLotes = useMemo(() => filasDelRegistro(registro), [registro]);
  const cuentaLotes = useMemo(() => { const c = contarPorEstado(filasLotes); return { ...c, sin_base: c.sin_base + c.sin_lote }; }, [filasLotes]);
  const lotesVisibles = useMemo(() => filasLotes.filter((f) => {
    const e = estadoDeFila(f);
    if (filtroLotes !== 'todos' && e !== filtroLotes && !(filtroLotes === 'sin_base' && e === 'sin_lote')) return false;
    return !busqueda || tokenMatch(busqueda, f.producto, f.lote);
  }), [filasLotes, filtroLotes, busqueda]);
  const primerMes = registro?.inicial_de !== 'foto';
  const desdeCuando = useMemo(() => {
    const [y, m] = String(registro?.desde || '').split('-').map(Number);
    if (!y || !m) return 'Mes siguiente';
    const sig = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return `Desde ${fechaTexto(sig, { month: 'short' }, '')}`;
  }, [registro?.desde]);
  const descargarLotes = () => {
    const { headers, rows } = csvDelRegistro(registro, nombreSala);
    compartirCsv({ headers, rows, nombre: `registro-antibioticos-por-lote-${nombreSala || sala}-${mesLotes}`, modulo: 'bitacoras' })
      .catch((e) => fallo('No se pudo compartir', e?.message || ''));
  };

  // ── Cuadre del mes ───────────────────────────────────────────────────────
  // Arranca en el mes ANTERIOR, como el cierre del portal donde vive.
  const [mesCuadre, setMesCuadre] = useState(() => correrPeriodo(mesSV(), -1));
  const [cuadre, setCuadre] = useState(null);
  const [cargandoCuadre, setCargandoCuadre] = useState(false);
  const [errorCuadre, setErrorCuadre] = useState(null);
  const [filtroCuadre, setFiltroCuadre] = useState('todos');
  const cargarCuadre = useCallback(async () => {
    if (!salaValida) return;
    setCargandoCuadre(true);
    const { cuadre: q, error } = await fetchCuadreAntibioticos(sala, mesCuadre);
    setCuadre(q); setErrorCuadre(error ? mensajeAmigable(error) : null); setCargandoCuadre(false);
  }, [salaValida, sala, mesCuadre]);
  useEffect(() => { if (seccion === 'cuadre') cargarCuadre(); }, [seccion, cargarCuadre]);
  const filasCuadre = useMemo(() => cuadre?.filas || VACIO, [cuadre]);
  const conConteo = Boolean(cuadre?.conteo);
  const cuadreVisibles = useMemo(() => (filtroCuadre === 'diferencias' ? filasCuadre.filter(filaConDiferencia) : filasCuadre)
    .filter((f) => !busqueda || tokenMatch(busqueda, f.producto)), [filasCuadre, filtroCuadre, busqueda]);
  const descargarCuadre = () => compartirCsv({
    headers: ['Producto', 'En el libro', 'Saldo inicial', 'Compras', 'Recibidos', 'Ventas', 'Otros', 'Saldo final', ...(conConteo ? ['Contado', 'Diferencia del conteo'] : [])],
    rows: filasCuadre.map((f) => [
      f.producto, f.en_el_libro ? 'Sí' : 'No', f.inicial ?? '', f.compras ?? '', f.recibidos ?? '', f.ventas ?? '', f.otros ?? '', f.final ?? '',
      ...(conConteo ? [f.conteo_fisico ?? '', f.conteo_diferencia ?? ''] : []),
    ]),
    nombre: `cuadre-antibioticos-${cuadre?.periodo ?? mesCuadre}`, modulo: 'bitacoras',
  }).catch((e) => fallo('No se pudo compartir', e?.message || ''));

  const recargar = async () => {
    setRecargando(true);
    await (seccion === 'listado' ? cargarListado() : seccion === 'lotes' ? cargarLotes() : cargarCuadre());
    setRecargando(false);
  };

  // ── Lo de la barra ───────────────────────────────────────────────────────
  const grupos = [
    ...(seccion === 'listado' && vista === 'listado' ? [{ id: 'venta', titulo: 'Cómo se vende', activa: venta, porDefecto: 'todos', onCambiar: setVenta,
      opciones: [{ id: 'todos', label: 'Toda venta' }, ...Object.entries(VENTA_ANTIBIOTICO).map(([k, v]) => ({ id: k, label: `${v.label} (${cuentaVenta[k] ?? 0})` }))] }] : []),
    ...(seccion !== 'listado' && alcanceTodas ? [{ id: 'sala', titulo: 'Sucursal', activa: String(sala), porDefecto: pedida || String(sala), onCambiar: setElegida,
      opciones: salas.map((o) => ({ id: o.value, label: o.label })) }] : []),
  ];
  const abrirMas = () => {
    const ops = seccion === 'listado'
      ? [...(puedeEditar ? [['Agregar producto', () => setEditando({})]] : []), ...(filas?.length ? [['Exportar CSV', exportarListado]] : [])]
      : seccion === 'lotes' ? (cuentaLotes.todos && !cargandoLotes ? [['Descargar CSV', descargarLotes]] : [])
        : (filasCuadre.length ? [['Descargar CSV', descargarCuadre]] : []);
    if (!ops.length) return;
    ActionSheetIOS.showActionSheetWithOptions({ options: [...ops.map((o) => o[0]), 'Cancelar'], cancelButtonIndex: ops.length },
      (i) => { if (i < ops.length) ops[i][1](); });
  };
  const hayMas = seccion === 'listado' ? (puedeEditar || filas?.length > 0) : seccion === 'lotes' ? cuentaLotes.todos > 0 : filasCuadre.length > 0;

  const listaActual = seccion === 'listado'
    ? (vista === 'listado' ? moleculas : vista === 'revisar' ? filtrarProductos(revisar.fuera) : filtrarProductos(revisar.excluidos))
    : seccion === 'lotes' ? lotesVisibles : cuadreVisibles;
  const tramo = useEnTramos(listaActual, 40, `${seccion}|${vista}|${venta}|${filtroLotes}|${filtroCuadre}|${busqueda}|${sala}`);

  const sinSala = seccion !== 'listado' && !salaValida;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Antibióticos',
        headerSearchBarOptions: { placeholder: seccion === 'listado' ? 'Buscar molécula o producto' : seccion === 'lotes' ? 'Buscar producto o lote' : 'Buscar producto',
          hideWhenScrolling: false, onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') } }} />
      <MenuDeFiltros grupos={grupos} extra={hayMas ? { icono: 'ellipsis.circle', etiqueta: 'Más acciones', onPress: abrirMas } : null} />
      <FijoArriba>
        <Segmentos activa={seccion} onCambiar={setSeccion} opciones={[{ id: 'listado', label: 'Listado' }, { id: 'lotes', label: 'Por lote' }, { id: 'cuadre', label: 'Cuadre' }]} />
      </FijoArriba>
      <ScrollView {...tramo.scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<Refrescar refreshing={recargando} onRefresh={recargar} />}>
        <FiltrosActivos grupos={grupos} />

        {seccion === 'listado' ? (
          <>
            <Subfiltro activa={vista} onCambiar={setVista} opciones={[
              { id: 'listado', label: `Listado (${filas ? filas.length + revisar.fuera.length : '…'})` },
              { id: 'revisar', label: `Por revisar (${filas ? revisar.fuera.length : '…'})` },
              { id: 'sacados', label: `Sacados (${filas ? revisar.excluidos.length : '…'})` },
            ]} />
            {filas ? (
              <View style={{ marginHorizontal: 16, gap: 4 }}>
                <Aviso tono={sinConfirmar || revisar.fuera.length || libroDistinto.length ? 'cuidado' : 'nota'}
                  texto={sinConfirmar ? `${sinConfirmar} de ${todas.length} moléculas sin confirmar por el regente.` : 'Listado confirmado por el regente.'} />
                {revisar.fuera.length ? <Aviso tono="cuidado" texto={`${revisar.fuera.length} productos del libro sin molécula (en «Por revisar»).`} /> : null}
                {libroDistinto.length ? (
                  <Pressable hitSlop={6} onPress={() => setVerDistintos((v) => !v)} style={{ minHeight: 32, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '600', marginHorizontal: 4 }}>
                      {`${libroDistinto.length} productos con la marca del libro distinta a la regla. `}
                      <Text style={{ textDecorationLine: 'underline' }}>{verDistintos ? 'Ocultar' : 'Ver cuáles'}</Text>
                    </Text>
                  </Pressable>
                ) : null}
                {verDistintos ? libroDistinto.map((f) => <T key={f.erp_product_id ?? f.producto} tenue tam={13} style={{ marginHorizontal: 4 }}>{`· ${f.producto}`}</T>) : null}
              </View>
            ) : null}
            {errorListado ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={mensajeAmigable(errorListado)} /></View> : null}
            {filas == null ? <Cargando /> : !listaActual.length ? (
              <Vacio titulo={busqueda ? 'Nada coincide con la búsqueda'
                : vista === 'listado' ? 'Sin antibióticos en el catálogo' : vista === 'revisar' ? 'Todo lo del libro está en el listado' : 'Nadie sacó ningún producto del listado'}
                tono={vista === 'revisar' && !busqueda ? 'bien' : undefined} />
            ) : vista === 'listado' ? tramo.visibles.map((m) => {
              if (!m.molecula) return (
                <Tarjeta key="sin-molecula">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T fuerte style={{ flex: 1 }}>Sin molécula asignada</T>
                    <Pildora texto={`Por asignar · ${m.productos.length}`} color={MARCA.rojo} />
                  </View>
                  <T tenue tam={13}>Van al libro. Falta asignarles la molécula.</T>
                  {m.productos.map((p) => <Producto key={p.product_id} p={p} puedeEditar={puedeEditar} onEditar={() => setEditando(p)} sinVenta />)}
                </Tarjeta>
              );
              const g = GRUPOS_AWARE[m.grupo];
              const soloLocal = m.productos.every((p) => p.via === 'local');
              return (
                <Tarjeta key={m.molecula}>
                  <T fuerte tam={16} style={{ textTransform: 'capitalize' }}>{m.molecula}</T>
                  <T tenue tam={13}>{[m.atc, m.fuente].filter(Boolean).join(' · ')}</T>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {soloLocal ? <Pildora texto="Uso local · sin grupo" color={MARCA.gris} />
                      : <Pildora texto={g?.label || 'Sin clasificar'} color={COLOR[g?.variant] ?? MARCA.gris} />}
                    {m.confirmado ? <Pildora texto="✓ Confirmado" color={MARCA.azulClaro} /> : null}
                  </View>
                  {m.productos.map((p) => <Producto key={p.product_id} p={p} puedeEditar={puedeEditar} onEditar={() => setEditando(p)} />)}
                  {puedeConfirmar && !m.confirmado && m.grupo ? (
                    <View style={{ alignSelf: 'flex-end' }}>
                      <BotonChico texto={confirmando === m.molecula ? 'Confirmando…' : 'Confirmar'} deshabilitado={confirmando != null} onPress={() => confirmar(m)} />
                    </View>
                  ) : null}
                </Tarjeta>
              );
            }) : vista === 'revisar' ? tramo.visibles.map((p) => (
              <Tarjeta key={p.product_id}>
                <T fuerte>{p.producto}</T>
                {p.principio_activo ? <T tenue tam={13}>{p.principio_activo}</T> : null}
                <T tenue tam={13}>{`Vía (por el nombre): ${VIA[p.via] ?? '—'}`}</T>
                {puedeEditar ? <View style={{ alignSelf: 'flex-end' }}><BotonChico texto="Asignar" onPress={() => setEditando({ ...p, origen: 'nuevo' })} /></View> : null}
              </Tarjeta>
            )) : tramo.visibles.map((p) => (
              <Tarjeta key={p.product_id}>
                <T fuerte>{p.producto}</T>
                <T tenue tam={13}>{p.sin_libro ? 'No es antibiótico · pide receta, no va al libro'
                  : p.en_el_libro ? 'No es antibiótico, pero hoy entra al libro bajo receta' : 'No es antibiótico'}</T>
                {puedeEditar ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                    {p.en_el_libro ? <BotonChico texto="No va al libro" onPress={() => sacar(p)} /> : null}
                    {p.sin_libro ? <BotonChico texto="Vuelve al libro" onPress={() => volverAlLibro(p)} /> : null}
                    <BotonChico texto="Devolver al listado" onPress={() => devolver(p)} />
                  </View>
                ) : null}
              </Tarjeta>
            ))}
          </>
        ) : sinSala ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso tono="cuidado" texto={!sala ? 'Elige una sucursal para ver su bitácora.' : `${nombreSala || 'Esa sucursal'} no guarda medicamentos. No tiene lotes que registrar.`} />
          </View>
        ) : seccion === 'lotes' ? (
          <>
            {nombreSala ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombreSala}</Text> : null}
            <PasoDeMes mes={mesLotes} onCambiar={setMesLotes} />
            <Subfiltro activa={filtroLotes} onCambiar={(v) => setFiltroLotes(v)} opciones={[
              { id: 'todos', label: `Lotes (${cargandoLotes ? '…' : cuentaLotes.todos})` },
              { id: 'cuadra', label: `Cuadran (${cargandoLotes ? '…' : cuentaLotes.cuadra})` },
              { id: 'diferencia', label: `Con diferencia (${cargandoLotes ? '…' : cuentaLotes.diferencia})` },
              { id: 'sin_base', label: `Sin saldo inicial (${cargandoLotes ? '…' : cuentaLotes.sin_base})` },
            ]} />
            {errorLotes ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={errorLotes} /></View>
              : registro && (primerMes || registro.existencia_de !== 'foto' || registro.resumen?.sin_lote_unidades > 0) ? (
                <View style={{ marginHorizontal: 16 }}>
                  <Aviso texto={[
                    primerMes && 'Primer mes del registro. Sólo cuadran los lotes que entraron desde el 11 de agosto.',
                    registro.existencia_de === 'ahora' && '«Hay» es la existencia de este momento.',
                    !registro.existencia_de && 'De ese mes no quedó la existencia al cierre. No se puede comparar.',
                    registro.resumen?.sin_lote_unidades > 0 && `${fmtNum(registro.resumen.sin_lote_unidades)} unidades entraron sin lote anotado.`,
                  ].filter(Boolean).join(' ')} />
                </View>
              ) : null}
            {cargandoLotes && !registro ? <Cargando /> : !lotesVisibles.length ? (
              <Vacio titulo={busqueda ? 'Ningún lote coincide con la búsqueda' : filtroLotes === 'diferencia' ? 'Ningún lote con diferencia este mes' : 'Sin lotes que mostrar'} />
            ) : tramo.visibles.map((f) => {
              const e = estadoDeFila(f);
              const etiqueta = e === 'cuadra' ? 'Cuadra' : e === 'diferencia' ? fmtSigno(f.diferencia) : e === 'sin_lote' ? 'Sin lote' : primerMes ? desdeCuando : 'Sin base';
              return (
                <Tarjeta key={f.clave} onPress={() => setAbierta(f)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T fuerte style={{ flex: 1 }}>{f.producto}</T>
                    <Pildora texto={etiqueta} color={ESTADO_LOTE[e].color} />
                  </View>
                  <T tenue tam={13}>{`Lote ${f.lote}${f.vence ? ` · vence ${fmtVence(f.vence)}` : ''}${f.en_el_libro ? ' · Libro' : ''}`}</T>
                  <T tenue tam={13} style={{ fontVariant: ['tabular-nums'] }}>
                    {`Inicial ${fmtNum(f.inicial)} · +${fmtNum(f.entradas)} · −${fmtNum(f.salidas)} · debería ${fmtNum(f.final_calculado)}`}
                  </T>
                  <T fuerte tam={14} style={{ fontVariant: ['tabular-nums'] }}>{`Hay ${fmtNum(f.existencia)}${enCajas(f.existencia, f.factor_caja) ? ` (${enCajas(f.existencia, f.factor_caja)})` : ''}`}</T>
                </Tarjeta>
              );
            })}
          </>
        ) : (
          <>
            {nombreSala ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 20 }}>{nombreSala}</Text> : null}
            <PasoDeMes mes={mesCuadre} onCambiar={setMesCuadre} />
            {cargandoCuadre && !cuadre ? <Cargando /> : errorCuadre ? (
              <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`No se pudo calcular el cuadre de antibióticos. ${errorCuadre}`} /></View>
            ) : cuadre ? (
              <>
                <ResumenDelCuadre cuadre={cuadre} />
                <View style={{ marginHorizontal: 16, gap: 4 }}>
                  <T tenue tam={13}>{cuadre.sin_saldo_inicial
                    ? `Movimientos del ${fmtDiaLargo(cuadre.desde)} al ${fmtDiaLargo(cuadre.hasta)}`
                    : `Saldo inicial al ${fmtDiaLargo(cuadre.saldo_inicial_del)} · movimientos del ${fmtDiaLargo(cuadre.desde)} al ${fmtDiaLargo(cuadre.hasta)}`}</T>
                  {cuadre.sin_saldo_inicial ? <Aviso tono="cuidado" texto="No hay existencia guardada de antes de este mes. El saldo inicial y «Otros» no se pueden calcular." /> : null}
                  <T tenue tam={13}>«Otros» son los movimientos que no son compra, traslado recibido ni venta. Por ejemplo, traslados a otras sucursales, ajustes y descartes. Las cantidades van en unidades.</T>
                </View>
                <Subfiltro activa={filtroCuadre} onCambiar={setFiltroCuadre} opciones={[
                  { id: 'todos', label: 'Todos' }, { id: 'diferencias', label: `Con diferencia (${filasCuadre.filter(filaConDiferencia).length})` },
                ]} />
                {!cuadreVisibles.length ? (
                  <Vacio titulo={filtroCuadre === 'diferencias' ? 'Ningún producto con diferencia este mes' : 'Sin movimientos de antibióticos este mes'} />
                ) : tramo.visibles.map((f) => (
                  <Tarjeta key={f.product_id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <T fuerte style={{ flex: 1 }}>{f.producto}</T>
                      {f.en_el_libro ? <Pildora texto="Libro" color={MARCA.azulClaro} /> : null}
                    </View>
                    <Dato primero rotulo="Inicial" valor={fmtNum(f.inicial, 2)} />
                    <Dato rotulo="Compras" valor={fmtNum(f.compras, 2)} />
                    <Dato rotulo="Recibidos" valor={fmtNum(f.recibidos, 2)} />
                    <Dato rotulo="Ventas" valor={fmtNum(f.ventas, 2)} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                      <T tenue>Otros</T>
                      <T fuerte={distinto(f.otros)} color={distinto(f.otros) ? MARCA.ambar : colorSistema.texto2} style={{ fontVariant: ['tabular-nums'] }}>{fmtNum(f.otros, 2)}</T>
                    </View>
                    <Dato rotulo="Final" valor={fmtNum(f.final, 2)} fuerte />
                    {conConteo ? (
                      <>
                        <Dato rotulo="Contado" valor={f.conteo_fisico === null || f.conteo_fisico === undefined ? (f.conteo_sistema == null ? 'No entró' : 'Sin contar') : fmtNum(f.conteo_fisico, 2)} />
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
                          <T tenue>Diferencia</T>
                          <T fuerte={distinto(f.conteo_diferencia)} color={distinto(f.conteo_diferencia) ? MARCA.rojo : colorSistema.texto2} style={{ fontVariant: ['tabular-nums'] }}>{fmtNum(f.conteo_diferencia, 2)}</T>
                        </View>
                      </>
                    ) : null}
                  </Tarjeta>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
      {abierta ? <DetalleLote fila={abierta} registro={registro} onCerrar={() => setAbierta(null)} /> : null}
      {editando ? (
        <EditarAntibiotico producto={editando.product_id ? editando : null} onCerrar={() => setEditando(null)}
          onHecho={() => { setEditando(null); cargarListado(); }} />
      ) : null}
    </>
  );
}

/** Un producto dentro de la tarjeta de su molécula: vía, cómo se vende y editar. */
function Producto({ p, puedeEditar, onEditar, sinVenta = false }) {
  const v = VENTA_ANTIBIOTICO[p.venta];
  return (
    <Pressable disabled={!puedeEditar} onPress={() => { Haptics.selectionAsync().catch(() => {}); onEditar(); }}
      accessibilityLabel={puedeEditar ? `Editar ${p.producto}` : undefined}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 6, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1, gap: 4 }}>
        <T tam={14}>{p.producto}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {VIA[p.via] ? <Pildora texto={VIA[p.via]} color={MARCA.gris} /> : null}
          {!sinVenta && v ? <Pildora texto={v.corto} color={COLOR[v.variant] ?? MARCA.gris} /> : null}
        </View>
      </View>
      {puedeEditar ? <T tenue tam={18}>›</T> : null}
    </Pressable>
  );
}

/** El conteo del mes: si se contó, cómo quedó, y a dónde ir para hacerlo. */
function ResumenDelCuadre({ cuadre }) {
  const c = cuadre.conteo;
  const filas = cuadre.filas || [];
  const conOtros = filas.filter((f) => distinto(f.otros)).length;
  const terminado = c && (c.status === 'FINALIZADO' || c.status === 'CERRADO');
  return (
    <Seccion titulo="Cuadre de antibióticos" pie="El cuadre se hace cada mes.">
      <Pildora color={!c ? MARCA.ambar : terminado ? (c.diferencias > 0 ? MARCA.ambar : MARCA.verde) : MARCA.azulClaro}
        texto={!c ? 'Sin conteo este mes'
          : terminado ? `Conteo terminado el ${fechaTexto(c.finalizado || c.creado, { day: 'numeric', month: 'long' })}`
            : `Conteo en curso (${c.contados ?? 0} de ${c.productos ?? 0} contados)`} />
      <T tenue tam={13}>{!c
        ? 'En las sucursales, los antibióticos van en el conteo cíclico del día 15. En la Bodega: Conteo de inventario → «Nuevo conteo» → «Bajo receta».'
        : terminado
          ? (c.diferencias > 0 ? `${c.diferencias} ${c.diferencias === 1 ? 'producto quedó' : 'productos quedaron'} con diferencia entre lo contado y lo registrado.` : 'Lo contado coincide con lo registrado en todos los productos.')
          : 'Termínalo para completar el cuadre del mes.'}</T>
      {!c ? <BotonChico texto="Ir a Conteo de inventario" onPress={() => router.push('/conteos')} /> : null}
      {c && !terminado ? <BotonChico texto="Abrir el conteo" onPress={() => router.push(`/conteo/${c.id}`)} /> : null}
      <Dato rotulo="Productos con movimiento" valor={String(filas.length)} />
      <Dato rotulo="Con «otros» movimientos" valor={cuadre.sin_saldo_inicial ? '—' : String(conOtros)} />
    </Seccion>
  );
}
