// Bloque 6.C (continuación) — hook de estado/fetch extraído de TabPedidos.jsx.
// Extracción mecánica: mismos nombres, misma lógica, sin cambios de
// comportamiento.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { signPhotosDeep } from '../utils/storageFiles';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { tokenMatch } from '../utils/searchUtils';
import { ERP_NAMES, SUCURSALES as ERP_ORDER } from '../constants/erp';
import { printFromPedidoItems } from '../utils/pedidoPrint';
import { PAUSE_REASONS } from '../constants/pedidos';
import { getBranchStage, claveParada, currentMonthRange, necesitaAtencion, tieneObservacion, filtrarPedidos, pedidosPorSala } from '../utils/tableroDePedidos';
import { anularPedido, avanzarEtapaDePedidoEnSala, despacharTrasladoPedido, fetchActiveRutas, fetchApoyoForPedido, fetchApoyoForPedidos, fetchAttendancePunches, fetchBranchNamesForSucursales, fetchEmployeeBranchId, fetchEntregasDePedidos, fetchItemsSinIngresar, fetchPausaHistorial, fetchPedidoItemEventosAll, fetchPedidoItemsAll, fetchPedidoSucursalStatus, fetchPedidosEnCurso, fetchResumenDeRenglonesPorPedido, fetchResumenIngresoPedidos, fetchRutaLocations, fetchTrasladosDePedidos, marcarRastreoDeFondo, noReenviarEspeciales, recibirTrasladoPedido, resolverRenglonDePedido, sucursalDeLaSala, tieneEtiquetaDeDespacho, updateRutaPedidoEntregado, upsertRutaLocation } from '../data/pedidos';
import {
    fetchDevolucionesDePedido, decidirDevolucion,
    subirEvidencia, moverDevoluciones, recibirDevoluciones,
} from '../data/devoluciones';
import { decidirDiferencia, confirmarLlegadaDiferencia } from '../data/diferencias';
import { confirmarLlegadaDePedido } from '../data/llegadaDePedido';
import { confirmarLlegadaDeReenvio, finalizarSalaConCajas, pedirReenvioSala, programarEntregaSala } from '../data/pasosDelPedido';
import { seguirPosicion } from '@plataforma/ubicacion';

import { mensajeAmigable } from '../utils/errorMessages';
import { cajasDeRenglon, construirCajasEspeciales, renglonesQueSalen } from '../utils/cajasEspeciales';
import { fetchEmployeesPublicByIds } from '../data/employees';
import { escucharCambios } from '../data/tiempoReal';

// Cuánto se esperan los avisos de Realtime antes de recargar. Un UPDATE sobre
// los renglones de un pedido llega como UN aviso por renglón, casi juntos: con
// esta ventana, los 206 de una recepción se vuelven una o dos recargas.
const ESPERA_RECARGA_MS = 1500;

// El eco de lo propio (2026-10-08). Cada acción recarga el tablero al terminar
// y además la base le devuelve a esta misma pantalla el aviso de lo que se
// acaba de escribir: dos recargas iguales por clic. La recarga agendada por un
// aviso se salta si otra carga arrancó DESPUÉS de que llegó ese aviso (ver
// abajo): esa carga ya leyó lo que el aviso anuncia.
const yaLoLeyo = (ultimaCarga, desde) => ultimaCarga >= desde;

// Cada cuánto se mira si el conductor sigue mandando su posición. Antes se
// recargaban las rutas enteras (tres consultas) con CADA posición GPS, en cada
// navegador con el tablero abierto; «en línea» sólo necesita la hora de la
// última posición, y se considera en línea por 3 minutos.
const PULSO_GPS_MS = 60_000;
const EN_LINEA_MS  = 3 * 60_000;

// Lo que vuelve igual se queda con el objeto de antes, para que `React.memo`
// pueda saltarse lo que no cambió. Se compara por contenido (JSON): las filas
// son datos planos de la base, sin funciones ni fechas como objeto.
function conservarIguales(prev, next, clave) {
    if (!Array.isArray(prev) || !prev.length) return next;
    const antes = new Map(prev.map(r => [clave(r), r]));
    let todoIgual = prev.length === next.length;
    const out = next.map((r, i) => {
        const viejo = antes.get(clave(r));
        if (viejo && JSON.stringify(viejo) === JSON.stringify(r)) {
            if (prev[i] !== viejo) todoIgual = false;
            return viejo;
        }
        todoIgual = false;
        return r;
    });
    return todoIgual ? prev : out;
}
function conservarIgualesEnMapa(prev, next) {
    if (!prev) return next;
    let todoIgual = Object.keys(prev).length === Object.keys(next).length;
    const out = {};
    for (const [k, v] of Object.entries(next)) {
        if (k in prev && JSON.stringify(prev[k]) === JSON.stringify(v)) out[k] = prev[k];
        else { out[k] = v; todoIgual = false; }
    }
    return todoIgual ? prev : out;
}

export function usePedidosData({ searchTerm = '' }) {
    const { user, getScope, hasPermission } = useAuth();
    const isBranch = getScope('pedidos') !== 'ALL';
    const canEdit  = hasPermission('pedidos', 'can_edit');
    // ── Editar MIN·MAX es del módulo MIN·MAX, no de Pedidos (2026-08-15) ──
    // Reportado: «un empleado que ve los pedidos puede modificar los min y max,
    // ¿por qué? no tienen permisos». Porque nadie lo preguntaba: la fila de
    // «revisión MIN·MAX» de `ItemSections` escribe `product_stock_params` y no
    // consultaba ningún permiso, así que la veía y la podía usar cualquiera que
    // abriera un pedido. `pedidos.can_edit` está concedido a ONCE cargos —los de
    // sala lo necesitan para RECIBIR—, y con él se estaba reescribiendo el
    // MIN·MAX del catálogo.
    const canEditMinMax = hasPermission('minmax', 'can_edit');

    // Employee store for name/photo lookups
    const storeEmployees = useStaff(s => s.employees);
    // Quienes actuaron sobre el pedido desde OTRA sucursal — casi siempre
    // bodega. El padrón del arranque llega recortado a la sucursal propia para
    // quien no tiene «ver» en Personal (ningún rol de sala lo tiene), así que
    // sin esto la línea de tiempo mostraba la hora de «Inicio», «Listo» y «En
    // ruta» con el nombre y la cara en blanco. Se resuelven aparte, por id.
    const [empExternos, setEmpExternos] = useState(() => new Map());
    const empIntentados = useRef(new Set());
    const empMap = useMemo(() => {
        const m = new Map();
        (storeEmployees || []).forEach(e => m.set(e.id, e));
        // El padrón propio manda: trae más campos y su foto ya viene firmada.
        empExternos.forEach((e, id) => { if (!m.has(id)) m.set(id, e); });
        return m;
    }, [storeEmployees, empExternos]);

    const [erpSucursalId, setErpSucursalId] = useState(null);
    const [branchName,    setBranchName]    = useState('');
    const [filterSuc,     setFilterSuc]     = useState('');
    const [filterStatus,  setFilterStatus]  = useState('all');
    const [filterDate,    setFilterDate]    = useState(() => currentMonthRange());

    const [activeRows,  setActiveRows]  = useState([]);
    const [loading,     setLoading]     = useState(true);

    const [expanded,     setExpanded]     = useState(null);
    const [expandedMeta, setExpandedMeta] = useState(null);
    // El canal de Realtime lee el detalle abierto de una ref y no de sus deps:
    // con `expanded` en las deps, abrir o cerrar una fila cerraba el canal y lo
    // volvía a abrir (un `phx_join` por clic, en cada navegador).
    const expandedRef     = useRef(null);
    const expandedMetaRef = useRef(null);
    useEffect(() => { expandedRef.current = expanded; expandedMetaRef.current = expandedMeta; }, [expanded, expandedMeta]);

    // ── Recargas pedidas por Realtime, juntadas (2026-09-14) ──
    // Cada aviso de `pedido_items` recargaba el detalle entero del pedido: 5
    // peticiones, una de ellas paginada. Recibir un pedido de 206 renglones
    // fueron ~1,040 peticiones en un minuto desde un solo navegador, y ese día
    // tumbaron el portal (docs/INCIDENTE-CAIDA-2026-09-14.md). La primera
    // recarga de una clave se agenda; las que llegan dentro de la ventana no
    // agregan nada, porque la recarga agendada ya va a leer lo último.
    const recargasRef = useRef(new Map());
    // Los detalles que esta pantalla pidió alguna vez, aunque sigan en vuelo. Un
    // aviso de un pedido cuyo detalle nadie pidió no tiene nada que refrescar:
    // el día que se abra, `!items[key]` lo trae fresco.
    const detallesPedidosRef = useRef(new Set());
    useEffect(() => () => {
        recargasRef.current.forEach(t => clearTimeout(t));
        recargasRef.current.clear();
    }, []);

    const [items,         setItems]         = useState({});
    const [eventosMap,    setEventosMap]    = useState({});
    // Las devoluciones del pedido, por tarjeta. Viven al lado de los ítems
    // porque se pintan pegadas a su renglón: una diferencia y lo que se decidió
    // hacer con ella son la misma conversación.
    const [devolucionesMap, setDevolucionesMap] = useState({});
    // Cargando y error POR TARJETA (2026-10-08). Era un booleano para todas:
    // el detalle que se recargaba por un aviso de Realtime ponía en «cargando»
    // a la tarjeta que se estaba mirando, y la primera que terminaba lo apagaba
    // para las demás.
    const [loadingItems,  setLoadingItems]  = useState({});
    const [itemsError,    setItemsError]    = useState({});
    const [llegadaStatus, setLlegadaStatus] = useState({});
    const [erpStatus,     setErpStatus]     = useState({});
    const [busyAction,    setBusyAction]    = useState(null);
    // El freno del reenvío vive también en una ref: dos clics en el mismo
    // cuadro llegan antes de que `busyAction` se repinte.
    const reenvioEnCursoRef = useRef(false);
    const [busyLifecycle, setBusyLifecycle] = useState(null);
    const [crearRutaOpen, setCrearRutaOpen] = useState(null); // null | string[] (keys pre-seleccionados)
    const [modal,         setModal]         = useState(null);
    const [rutaMapOpen,   setRutaMapOpen]   = useState(null); // ruta obj para RutaMapModal

    // Rutas activas: mapa `claveParada(pedidoId, sucId)` → { ruta, stop, driverOnline }.
    // Por PARADA y no por pedido — ver `claveParada` en ./helpers. Se deriva
    // más abajo (`pedidoRutaMap`, junto a `loadActiveRutas`).

    const [llegadaModal,         setLlegadaModal]         = useState(null); // { pedidoId, sucId, key, rows }
    const [reenvioLlegadaModal,  setReenvioLlegadaModal]  = useState(null); // { pedidoId, sucId, key, ciclo, cajasCiclo }
    const [reenviarConfirmModal, setReenviarConfirmModal] = useState(null); // { pedidoId, sucId, numero, cajas, electrolits, especiales }
    const [finalizarModal,     setFinalizarModal]      = useState(null); // { pedidoId, sucId, numero, key, rows }
    const [newAlert,      setNewAlert]      = useState(null);

    // Pause modal
    const [pauseModal,   setPauseModal]   = useState(null);
    const [pauseHistory, setPauseHistory] = useState([]);
    const [pauseRazon,   setPauseRazon]   = useState('almuerzo');
    const [pauseComment, setPauseComment] = useState('');
    const [kioskLunch,   setKioskLunch]   = useState(false);

    // Apoyo
    const [apoyoMap,   setApoyoMap]   = useState({}); // cardKey → [{id, name, photo_url}]
    const [apoyoModal, setApoyoModal] = useState(null); // { pedidoId, sucId, cardKey }

    // Card stats (for collapsed pill display)
    const [trasladoStats, setTrasladoStats] = useState({});
    // Lo confirmado que NO llegó al inventario, por tarjeta. Es el único estado
    // del circuito que deja a la sala sin poder facturar y no se veía en
    // ninguna pantalla: el aviso era un toast que se va solo.
    const [ingresoStats, setIngresoStats] = useState({});
    // Las tarjetas cuyo ingreso al inventario está corriendo AHORA, en segundo
    // plano (2026-08-17). Sin esto, confirmar y cerrar la pantalla dejaba la
    // tarjeta en rojo —«N sin ingresar»— durante el minuto que tarda el sistema,
    // invitando a apretar «Reintentar» sobre algo que ya está en marcha.
    const [ingresoEnCurso, setIngresoEnCurso] = useState({});
    // Los relojes de esa vigilancia, para poder apagarlos al desmontar.
    const vigilanciaRef = useRef({});
    const [cardStats,  setCardStats]  = useState({}); // cardKey → { enviados, sinStock, porRegla, pendientes, sinResolver }
    const [entregaMap, setEntregaMap] = useState({}); // cardKey → { entregado_at, entregado_por, ruta }

    // ── Cargar rutas activas ──────────────────────────────────────────────────

    // ── Branch ERP ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!isBranch || !user?.id) return undefined;
        let vivo = true;
        (async () => {
            // La sala de quien entra ya viene en la sesión: `user.branchId` lo
            // ponen el login y `ensure_user_by_code`. Sólo una sesión guardada
            // antes de que existiera ese dato la pregunta a la base. Y la
            // sucursal de esa sala se recuerda (`sucursalDeLaSala`): cada cambio
            // de pestaña volvía a pedir las dos.
            let branchId = user.branchId ?? null;
            if (branchId == null) {
                const { data: emp, error: empErr } = await fetchEmployeeBranchId(user.id);
                if (empErr) console.error('fetch employee branch_id failed:', empErr.message);
                branchId = emp?.branch_id ?? null;
            }
            if (branchId == null) return;
            const { data: mapRow, error: mapErr } = await sucursalDeLaSala(branchId);
            if (mapErr) console.error('fetch erp_sucursal_map failed:', mapErr.message);
            if (!vivo || !mapRow) return;
            setErpSucursalId(mapRow.erp_sucursal_id);
            setFilterSuc(mapRow.erp_sucursal_id);
            setBranchName(ERP_NAMES[mapRow.erp_sucursal_id] ?? `Sucursal ${mapRow.erp_sucursal_id}`);
        })();
        return () => { vivo = false; };
    }, [isBranch, user?.id, user?.branchId]);

    // ── Loaders ───────────────────────────────────────────────────────────────

    // Número de petición y hora de arranque de la última carga del tablero. El
    // número evita que una respuesta vieja pise a una nueva (dos recargas
    // seguidas pueden volver en desorden); la hora es la que mira el eco.
    const cargaActivosRef       = useRef(0);
    const ultimaCargaActivosRef = useRef(0);
    const loadActive = useCallback(async () => {
        const turno = ++cargaActivosRef.current;
        ultimaCargaActivosRef.current = Date.now();
        try {
            const { data, error } = await fetchPedidosEnCurso();
            if (error) { console.error('loadActive: get_pedidos_en_curso failed:', error.message); return []; }
            const rows = data ?? [];
            const ids = [...new Set(rows.map(r => r.pedido_id))];

            // Las cuatro consultas por tarjeta van JUNTAS (2026-10-08): iban una
            // detrás de otra —cinco viajes en serie para pintar el tablero— y
            // cada una hacía su propio repintado. Ninguna depende de otra, y el
            // fallo de una no tumba el tablero: sólo deja sin su badge.
            const vacio = { data: [], error: null };
            const [statRes, trRes, ingRes, entRes] = ids.length
                ? await Promise.all([
                    fetchResumenDeRenglonesPorPedido({ p_pedido_ids: ids }),
                    fetchTrasladosDePedidos(ids),
                    fetchResumenIngresoPedidos(ids),
                    fetchEntregasDePedidos(ids),
                ])
                : [vacio, vacio, vacio, vacio];
            if (statRes.error) console.error('loadActive: get_pedido_item_stats failed:', statRes.error.message);
            if (trRes.error)   console.error('loadActive: traslados failed:', trRes.error.message);
            if (ingRes.error)  console.error('loadActive: ingreso al inventario failed:', ingRes.error.message);
            if (entRes.error)  console.error('loadActive: entregas failed:', entRes.error.message);

            // Mientras ésta viajaba arrancó otra: la otra trae lo más nuevo.
            if (turno !== cargaActivosRef.current) return rows;

            const stats = {};
            rows.forEach(row => {
                stats[`act_${row.pedido_id}_${row.erp_sucursal_id}`] = { enviados: 0, sinStock: 0, porRegla: 0, agotamiento: 0 };
            });
            (statRes.data ?? []).forEach(st => {
                const k = `act_${st.pedido_id}_${st.erp_sucursal_id}`;
                stats[k] = { enviados: st.enviados, sinStock: st.sin_stock, porRegla: st.por_regla, agotamiento: st.agotamiento ?? 0, pendientes: st.pendientes ?? 0, sinResolver: st.sin_resolver ?? 0 };
            });

            // El estado del traslado al sistema, para que la tarjeta lo muestre.
            // Llegan del intento más viejo al más nuevo (`fetchTrasladosDePedidos`):
            // al indexar por sala, gana el último intento.
            const traslados = {};
            (trRes.data ?? []).forEach(t => {
                traslados[`act_${t.pedido_id}_${t.erp_sucursal_id}`] = t;
            });

            // Y si lo confirmado llegó al inventario.
            const ingresos = {};
            (ingRes.data ?? []).forEach(r => {
                ingresos[`act_${r.pedido_id}_${r.erp_sucursal_id}`] = r;
            });

            // La entrega de cada parada. Viaja con el pedido y no con la ruta: el
            // mapa de rutas activas sólo conoce las de hoy, así que al día siguiente
            // el paso «Entregado» se quedaba vacío aunque el conductor lo hubiera
            // marcado. Se guarda por (pedido, sucursal) — el mapa de rutas se indexa
            // sólo por pedido, y un pedido de dos sucursales tiene dos paradas.
            const entregas = {};
            (entRes.data ?? []).forEach(e => {
                entregas[`act_${e.pedido_id}_${e.erp_sucursal_id}`] = {
                    ...e, ruta: { conductor_id: e.conductor_id, conductor_nombre: e.conductor_nombre },
                };
            });

            // Todo de una vez: React junta estos cinco en UN repintado. Y lo que
            // no cambió conserva su objeto (`conservarIguales`): la fila de cada
            // sala se dibuja con `React.memo`, y un objeto nuevo con los mismos
            // datos la volvía a dibujar entera en cada recarga.
            setActiveRows(prev => conservarIguales(prev, rows, r => `${r.pedido_id}_${r.erp_sucursal_id}`));
            setCardStats(prev => conservarIgualesEnMapa(prev, stats));
            setTrasladoStats(prev => conservarIgualesEnMapa(prev, traslados));
            setIngresoStats(prev => conservarIgualesEnMapa(prev, ingresos));
            setEntregaMap(prev => conservarIgualesEnMapa(prev, entregas));
            return rows;
        } catch (e) {
            // Un tropiezo de red no puede convertirse en «no se pudo finalizar»
            // en quien recarga después de escribir: la recarga es aparte.
            console.error('loadActive:', e);
            return [];
        }
    }, []);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await loadActive();
            setLoading(false);
        })();
    }, []); // eslint-disable-line

    // Auto-load items for pedidos parciales so DifSection always shows item details.
    // Por SALA: sólo la que reportó diferencias pinta DifSection, y con el
    // `pedido_status` del pedido se bajaban los renglones de todas.
    useEffect(() => {
        const parciales = activeRows.filter(r => r.diferencias_reportadas_at && r.pedido_status !== 'completado');
        if (!parciales.length) return;
        parciales.forEach(r => {
            const key = `act_${r.pedido_id}_${r.erp_sucursal_id}`;
            // `detallesPedidosRef`: ya pedido (aunque siga en vuelo). Sin esto,
            // cada recarga del tablero mientras viajaba la primera lo volvía a
            // pedir entero.
            if (!items[key] && !detallesPedidosRef.current.has(key)) fetchItems(key, r.pedido_id, r.erp_sucursal_id);
        });
    }, [activeRows]); // eslint-disable-line

    // Batch-load apoyo for ALL users whenever activeRows changes (branch + bodega)
    //
    // Depende de la LISTA DE PEDIDOS como texto, no de `activeRows`: ese arreglo
    // es nuevo en cada recarga del tablero aunque traiga los mismos pedidos, y
    // cada recarga volvía a pedir el apoyo de todos y a firmar sus fotos. Un
    // apoyo nuevo ya lo pinta `handleApoyoSuccess`, y el detalle abierto lo
    // relee con `fetchItems`.
    const idsDePedidos = useMemo(() => [...new Set(activeRows.map(r => r.pedido_id))].sort().join(','), [activeRows]);
    useEffect(() => {
        if (!idsDePedidos) return undefined;
        let vivo = true;
        (async () => {
            const ids = idsDePedidos.split(',');
            // Branch: filter to their sucursal only; bodega: load all sucursales
            const { data, error } = await fetchApoyoForPedidos(ids, isBranch && erpSucursalId ? erpSucursalId : null);
            if (error) console.error('apoyo de los pedidos:', error.message);
            await signPhotosDeep(data || []);
            if (!vivo || !data) return;
            const map = {};
            data.forEach(r => {
                const key = `act_${r.pedido_id}_${r.erp_sucursal_id}`;
                if (!map[key]) map[key] = { preparacion: [], recepcion: [] };
                const t = r.tipo ?? 'preparacion';
                if (!map[key][t]) map[key][t] = [];
                if (!map[key][t].find(e => e.id === r.employee_id)) {
                    map[key][t].push({ id: r.employee_id, ...r.employees });
                }
            });
            setApoyoMap(prev => ({ ...prev, ...map }));
        })();
        return () => { vivo = false; };
    }, [isBranch, erpSucursalId, idsDePedidos]);

    // ── Realtime ──────────────────────────────────────────────────────────────

    // Lo que los canales llaman vive en refs: los canales se abren UNA vez y no
    // se cierran y reabren cada vez que cambia una función o la fila abierta.
    // `fetchItems` y `loadActiveRutas` se declaran más abajo; sus refs se
    // actualizan en un efecto pegado a ellas.
    const fetchItemsRef      = useRef(null);
    const loadActiveRutasRef = useRef(null);
    const isBranchRef        = useRef(isBranch);
    const erpSucursalIdRef   = useRef(erpSucursalId);
    useEffect(() => { isBranchRef.current = isBranch; erpSucursalIdRef.current = erpSucursalId; }, [isBranch, erpSucursalId]);
    // Hora de arranque de la última carga de cada detalle — la que mira el eco.
    const ultimaCargaDetalleRef = useRef({});

    // UNA sola cola de recargas para todos los canales: el aviso de `pedidos` y
    // el de `rutas` piden recargar las rutas, y con dos colas eran dos recargas.
    const juntar = useCallback((clave, recargar) => {
        const pendientes = recargasRef.current;
        if (pendientes.has(clave)) return;
        // `desde` es la hora del PRIMER aviso de la tanda: es lo que decide si
        // una carga ya lo cubrió (ver `yaLoLeyo`).
        const desde = Date.now();
        pendientes.set(clave, setTimeout(() => { pendientes.delete(clave); recargar(desde); }, ESPERA_RECARGA_MS));
    }, []);
    // El eco (2026-10-08, corregido en la revisión): una carga cubre un aviso
    // sólo si ARRANCÓ después de que el aviso llegó — el cambio ya estaba
    // escrito, así que esa carga lo leyó. Comparar contra «ahora» (como era)
    // se tragaba el cambio de otra persona que caía en los 2 s siguientes a
    // cualquier carga, y no se veía hasta el próximo aviso.
    const recargarActivos = useCallback(() => juntar('activos', (desde) => {
        if (yaLoLeyo(ultimaCargaActivosRef.current, desde)) return;
        loadActive();
    }), [juntar, loadActive]);
    const recargarRutas = useCallback(() => juntar('rutas', () => loadActiveRutasRef.current?.()), [juntar]);
    const recargarDetalle = useCallback((key, pedidoId, sucId) => {
        if (!key || !detallesPedidosRef.current.has(key)) return;
        juntar(`detalle:${key}`, (desde) => {
            if (yaLoLeyo(ultimaCargaDetalleRef.current[key] ?? 0, desde)) return;
            fetchItemsRef.current?.(key, pedidoId, sucId);
        });
    }, [juntar]);

    useEffect(() => escucharCambios('tab-pedidos-rt', [
        { tabla: 'pedidos', alCambiar: (payload) => {
            recargarActivos();
            recargarRutas(); // rutas/ruta_pedidos pueden no estar en la pub; pedidos sí
            const s = payload.new?.status;
            const sala = erpSucursalIdRef.current;
            if (isBranchRef.current && s === 'enviado') {
                const ids = payload.new?.sucursal_ids ?? [];
                if (sala && ids.includes(sala)) {
                    setNewAlert({ numero: payload.new.numero });
                    setTimeout(() => setNewAlert(null), 8000);
                }
            }
            const meta = expandedMetaRef.current;
            const affectedId = payload.new?.id ?? payload.old?.id;
            if (meta && meta.pedidoId === affectedId) recargarDetalle(expandedRef.current, meta.pedidoId, meta.sucId);
        } },
        { tabla: 'pedido_sucursal_status', alCambiar: () => { recargarActivos(); } },
        { tabla: 'pedido_item_eventos', evento: 'INSERT', alCambiar: (payload) => {
            const { pedido_id, erp_sucursal_id } = payload.new ?? {};
            if (!pedido_id) return;
            recargarDetalle(`act_${pedido_id}_${erp_sucursal_id}`, pedido_id, erp_sucursal_id);
            recargarActivos();
        } },
    ]), [recargarActivos, recargarRutas, recargarDetalle]);

    // Los renglones, SÓLO del pedido abierto (2026-10-08). El canal de arriba
    // escuchaba todo UPDATE de `pedido_items` sin filtro: cada renglón contado en
    // cualquier sala llegaba a cada navegador con el tablero abierto —206
    // avisos por recepción, por navegador— para descartarse acá casi siempre.
    // Con el filtro la base sólo manda los del pedido que alguien mira.
    const pedidoAbierto = expandedMeta?.pedidoId ?? null;
    useEffect(() => {
        if (!pedidoAbierto) return undefined;
        return escucharCambios(`tab-pedidos-items-${pedidoAbierto}`, [
            { tabla: 'pedido_items', evento: 'UPDATE', filtro: `pedido_id=eq.${pedidoAbierto}`, alCambiar: (payload) => {
                const { pedido_id, erp_sucursal_id } = payload.new ?? {};
                if (!pedido_id) return;
                recargarDetalle(`act_${pedido_id}_${erp_sucursal_id}`, pedido_id, erp_sucursal_id);
            } },
        ]);
    }, [pedidoAbierto, recargarDetalle]);

    // ── Rutas activas: mapa (pedido, sala) → { ruta, stop, driverOnline } ────
    //
    // Se guardan las rutas y la hora de la última posición de cada una, y el
    // mapa se DERIVA: «en línea» depende del reloj, no de que llegue un aviso.
    const [rutasActivas, setRutasActivas] = useState([]);
    const [posiciones,   setPosiciones]   = useState({}); // ruta_id → updated_at
    const [reloj,        setReloj]        = useState(() => Date.now());
    // Una carga a la vez, pero sin tirar la que llega en vuelo: el candado
    // descartaba la recarga pedida mientras otra viajaba, y si esa otra había
    // leído ANTES del cambio, el cambio no se veía hasta el próximo aviso. Ahora
    // queda pendiente y se corre al terminar.
    const loadingRutasRef  = useRef(false);
    const rutasPendienteRef = useRef(false);
    const loadActiveRutas = useCallback(async () => {
        if (loadingRutasRef.current) { rutasPendienteRef.current = true; return; }
        loadingRutasRef.current = true;
        try {
            do {
                rutasPendienteRef.current = false;
                const todayStart = new Date(); todayStart.setHours(0,0,0,0);
                const { data, error } = await fetchActiveRutas(todayStart.toISOString());
                if (error) { console.error('loadActiveRutas: fetch rutas failed:', error.message); continue; }
                if (!data?.length) { setRutasActivas([]); setPosiciones({}); continue; }

                const rutaIds = data.map(r => r.id);
                const allStops = data.flatMap(r => r.ruta_pedidos ?? []);
                const sucIds   = [...new Set(allStops.map(st => st.erp_sucursal_id))];

                const [{ data: locs, error: locsErr }, { data: sucData, error: sucErr }] = await Promise.all([
                    fetchRutaLocations(rutaIds),
                    sucIds.length
                        ? fetchBranchNamesForSucursales(sucIds)
                        : Promise.resolve({ data: [] }),
                ]);
                if (locsErr) console.error('loadActiveRutas: fetch ruta_locations failed:', locsErr.message);
                if (sucErr) console.error('loadActiveRutas: fetch erp_sucursal_map failed:', sucErr.message);

                const sucNameMap = Object.fromEntries((sucData ?? []).map(x => [x.erp_sucursal_id, x.branch?.name]));
                setRutasActivas(data.map(ruta => ({
                    ...ruta,
                    ruta_pedidos: (ruta.ruta_pedidos ?? []).map(st => ({
                        ...st, suc_name: sucNameMap[st.erp_sucursal_id] ?? `Suc. ${st.erp_sucursal_id}`,
                    })),
                })));
                setPosiciones(Object.fromEntries((locs ?? []).map(l => [l.ruta_id, l.updated_at])));
                setReloj(Date.now());
            } while (rutasPendienteRef.current);
        } catch (e) {
            console.error('loadActiveRutas:', e);
        } finally {
            loadingRutasRef.current = false;
        }
    }, []);
    useEffect(() => { loadActiveRutasRef.current = loadActiveRutas; }, [loadActiveRutas]);

    useEffect(() => { loadActiveRutas(); }, [loadActiveRutas]);

    // «En línea» como texto: el mapa sólo se rehace si cambia QUIÉN está en
    // línea, no cada vez que avanza el reloj.
    const enLinea = useMemo(() => Object.entries(posiciones)
        .filter(([, t]) => reloj - new Date(t).getTime() < EN_LINEA_MS)
        .map(([id]) => id).sort().join(','), [posiciones, reloj]);
    const pedidoRutaMap = useMemo(() => {
        const online = new Set(enLinea ? enLinea.split(',') : []);
        const map = new Map();
        rutasActivas.forEach(ruta => {
            (ruta.ruta_pedidos ?? []).forEach(stop => {
                map.set(claveParada(stop.pedido_id, stop.erp_sucursal_id), { ruta, stop, driverOnline: online.has(String(ruta.id)) });
            });
        });
        return map;
    }, [rutasActivas, enLinea]);

    // El pulso: mientras haya una ruta EN CURSO, una lectura liviana de la hora
    // de la última posición por minuto (una consulta de dos columnas), en vez
    // de recargar las rutas enteras por cada posición GPS en cada navegador.
    const rutasEnCurso = useMemo(() => rutasActivas.filter(r => r.status === 'en_ruta').map(r => r.id).sort().join(','), [rutasActivas]);
    useEffect(() => {
        if (!rutasEnCurso) return undefined;
        let vivo = true;
        const ids = rutasEnCurso.split(',');
        const t = setInterval(async () => {
            const { data, error } = await fetchRutaLocations(ids);
            if (!vivo) return;
            if (error) { console.error('pulso GPS:', error.message); return; }
            setPosiciones(prev => {
                const next = { ...prev };
                (data ?? []).forEach(l => { next[l.ruta_id] = l.updated_at; });
                return next;
            });
            setReloj(Date.now());
        }, PULSO_GPS_MS);
        return () => { vivo = false; clearInterval(t); };
    }, [rutasEnCurso]);

    // Resolver las caras que faltan. Se junta lo que las filas visibles ya
    // nombran —quien confirmó, inició, finalizó, envió, recibió, reenvió, el
    // conductor, quien entregó— y se piden sólo los ids que el padrón propio no
    // trajo. Corre después de cada carga porque una ruta nueva o un pedido que
    // avanza suman personas que antes no estaban.
    useEffect(() => {
        const ids = new Set();
        const anotar = v => { if (v) ids.add(v); };
        activeRows.forEach(r => {
            [r.created_by, r.iniciado_por, r.finalizado_por, r.enviado_por,
             r.llegada_fisica_por, r.recibido_erp_por, r.diferencias_reportadas_por,
             r.confirmado_correccion_por, r.reenvio_por, r.reanudado_por].forEach(anotar);
            (r.pauses ?? []).forEach(p => { anotar(p.pausado_por); anotar(p.reanudado_por); });
            (r.reenvios_historial ?? []).forEach(c => { anotar(c.sent_by); anotar(c.arrived_por); });
        });
        pedidoRutaMap.forEach(({ ruta, stop }) => {
            anotar(ruta?.conductor_id);
            anotar(stop?.entregado_por);
        });
        // Y quien entregó según el registro del pedido, que es el que sobrevive
        // a que la ruta deje de estar activa.
        Object.values(entregaMap).forEach(e => {
            anotar(e?.entregado_por);
            anotar(e?.ruta?.conductor_id);
        });

        // `empIntentados` evita el bucle: un id que la consulta NO devuelve
        // —dado de baja, o filtrado— seguiría faltando en `empMap`, y como este
        // efecto depende de `empMap`, volvería a pedirlo para siempre. Se
        // pregunta una vez por id; si la consulta falla se sueltan para que un
        // render posterior reintente.
        const faltantes = [...ids].filter(id => !empMap.has(id) && !empIntentados.current.has(id));
        if (!faltantes.length) return;
        faltantes.forEach(id => empIntentados.current.add(id));

        let vivo = true;
        (async () => {
            const { data, error } = await fetchEmployeesPublicByIds(faltantes);
            if (error) {
                console.error('empExternos:', error.message);
                faltantes.forEach(id => empIntentados.current.delete(id));
                return;
            }
            // El bucket de fotos es privado: sin firmar, el `img` da 400 y la
            // cara queda rota, que es peor que no ponerla.
            const firmados = await signPhotosDeep(data ?? []);
            if (!vivo || !firmados?.length) return;
            setEmpExternos(prev => {
                const next = new Map(prev);
                firmados.forEach(e => next.set(e.id, { ...e, photo: e.photo_url }));
                return next;
            });
        })();
        return () => { vivo = false; };
    }, [activeRows, pedidoRutaMap, entregaMap, empMap]);
    useEffect(() => escucharCambios('pedido-rutas-rt', [
        // Por la misma cola que el canal principal (`juntar`): crear una ruta de
        // cinco paradas son seis avisos casi juntos, y cada uno recargaba las
        // rutas y el tablero enteros. `ruta_locations` ya NO se escucha acá:
        // ver `PULSO_GPS_MS`.
        { tabla: 'rutas',        alCambiar: () => { recargarRutas(); recargarActivos(); } },
        { tabla: 'ruta_pedidos', alCambiar: () => { recargarRutas(); recargarActivos(); } },
    ]), [recargarRutas, recargarActivos]);

    // ── GPS background persistente — conductor con ruta en_ruta ──────────────
    // Corre independiente del RutaMapModal: pantalla apagada o modal cerrado.
    // Cómo se mide lo decide la plataforma (`plataforma/ubicacion`).
    //
    // Depende del ID de la ruta (texto), no del mapa de rutas: el mapa es nuevo
    // en cada recarga, y cada recarga apagaba y volvía a encender el GPS.
    //
    // Y es el ÚNICO que escribe mientras corre: `marcarRastreoDeFondo` le avisa
    // al mapa de la ruta (`hayRastreoDeFondo`) que no escriba él también.
    const rutaDelConductor = useMemo(() => {
        const entry = [...pedidoRutaMap.values()]
            .find(v => v.ruta.conductor_id && String(v.ruta.conductor_id) === String(user?.id) && v.ruta.status === 'en_ruta');
        return entry ? String(entry.ruta.id) : null;
    }, [pedidoRutaMap, user?.id]);
    const bgGpsPosRef = useRef(null);
    useEffect(() => {
        if (!rutaDelConductor) return undefined;
        const rutaId = rutaDelConductor;
        let detener = null;
        let cerrado = false;
        seguirPosicion((pos) => { bgGpsPosRef.current = pos; })
            .then((d) => {
                if (cerrado) { d(); return; }
                detener = d;
                marcarRastreoDeFondo(rutaId, true);
            })
            .catch((e) => console.warn('[BG-GPS] start error:', e));
        // Escribir a DB cada 30s
        const intervalo = setInterval(() => {
            const pos = bgGpsPosRef.current;
            if (!pos) return;
            upsertRutaLocation(rutaId, pos.lat, pos.lng).then(() => {}, () => {});
        }, 30_000);
        return () => {
            cerrado = true;
            detener?.();
            clearInterval(intervalo);
            marcarRastreoDeFondo(rutaId, false);
        };
    }, [rutaDelConductor]);

    // ── Fetch items ───────────────────────────────────────────────────────────

    // Devuelve los renglones, o `null` si no se pudieron leer COMPLETOS. Antes
    // devolvía `[]` en el error, y `[]` es también «este pedido no tiene
    // renglones»: FINALIZAR guardaba cero cajas especiales y cero Electrolit, e
    // IMPRIMIR sacaba un PDF sin productos, sin que nadie se enterara
    // (2026-10-08). Quien llama decide qué hacer con el `null`; la tarjeta lo
    // muestra con `itemsError`.
    //
    // Las cinco consultas van juntas: iban en tres tandas una detrás de otra.
    const cargasDetalleRef = useRef({});
    const fetchItems = useCallback(async (key, pedidoId, sucId) => {
        if (!pedidoId) return null;
        detallesPedidosRef.current.add(key);
        const turno = (cargasDetalleRef.current[key] ?? 0) + 1;
        cargasDetalleRef.current[key] = turno;
        ultimaCargaDetalleRef.current[key] = Date.now();
        const vigente = () => cargasDetalleRef.current[key] === turno;
        setLoadingItems(prev => ({ ...prev, [key]: true }));
        const sucFilter = sucId ?? (isBranch && erpSucursalId ? erpSucursalId : null);
        try {
            const lcPromise = (sucFilter && isBranch)
                ? fetchPedidoSucursalStatus(pedidoId, sucFilter, 'recibido_erp_at, llegada_fisica_at')
                : Promise.resolve({ data: null, error: null });
            // Paginadas (`fetchAllRows`, cap-safe): pedidos con >1000 renglones
            // existen en producción. Las devoluciones van en el mismo viaje: son
            // pocas filas y se pintan pegadas a su renglón.
            const [allItemRows, allEvRows, { data: lcRow, error: lcErr }, { data: apoyoRows, error: apoyoErr }, devs] =
                await Promise.all([
                    fetchPedidoItemsAll(pedidoId, sucFilter),
                    fetchPedidoItemEventosAll(pedidoId, sucFilter),
                    lcPromise,
                    fetchApoyoForPedido(pedidoId, sucFilter),
                    fetchDevolucionesDePedido(pedidoId, sucFilter),
                ]);
            if (allItemRows === null) throw new Error('No se pudieron leer todos los productos del pedido.');
            if (allEvRows === null) throw new Error('No se pudo leer el historial de las diferencias del pedido.');
            if (lcErr) throw lcErr;
            if (apoyoErr) throw apoyoErr;
            await signPhotosDeep(apoyoRows || []);
            const resolved = allItemRows.map(row => ({
                ...row,
                presentations: (row.products?.product_precios || [])
                    .filter(pp => pp.activo !== false)
                    .map(pp => ({ factor: pp.factor, tipo: pp.presentaciones?.tipo }))
                    .filter(p => p.tipo && p.factor >= 1),
                tiene_dispatch_label: tieneEtiquetaDeDespacho(row),
            }));
            // Una lectura vieja de la MISMA tarjeta no pisa a una más nueva; a
            // quien la esperaba igual se le devuelve lo que leyó.
            if (!vigente()) return resolved;
            const apoyoByTipo = { preparacion: [], recepcion: [] };
            (apoyoRows || []).forEach(r => {
                const t = r.tipo ?? 'preparacion';
                if (!apoyoByTipo[t]) apoyoByTipo[t] = [];
                apoyoByTipo[t].push({ id: r.employee_id, ...r.employees });
            });
            setItems(prev => ({ ...prev, [key]: resolved }));
            setEventosMap(prev => ({ ...prev, [key]: allEvRows }));
            setDevolucionesMap(prev => ({ ...prev, [key]: devs }));
            setApoyoMap(prev => ({ ...prev, [key]: apoyoByTipo }));
            setItemsError(prev => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });
            if (lcRow) {
                setErpStatus(prev => ({ ...prev, [key]: !!lcRow.recibido_erp_at }));
                setLlegadaStatus(prev => ({ ...prev, [key]: !!lcRow.llegada_fisica_at }));
            }
            return resolved;
        } catch (err) {
            console.error('[fetchItems] error:', err?.message ?? err);
            // Se puede volver a pedir: sin esto, `detallesPedidosRef` lo daba por
            // pedido y la carga automática no lo reintentaba nunca.
            if (vigente()) {
                detallesPedidosRef.current.delete(key);
                setItemsError(prev => ({ ...prev, [key]: mensajeAmigable(err, 'No se pudieron cargar los productos del pedido.') }));
            }
            return null;
        } finally {
            if (vigente()) setLoadingItems(prev => { const n = { ...prev }; delete n[key]; return n; });
        }
    }, [isBranch, erpSucursalId]);
    useEffect(() => { fetchItemsRef.current = fetchItems; }, [fetchItems]);

    // El aviso para quien tocó un botón que necesita los renglones y no los
    // tiene. Mismo texto en los cuatro sitios.
    const avisarSinRenglones = useCallback((que) => {
        useToastStore.getState().showToast(
            `No se pudo ${que}`,
            'No se pudieron leer los productos del pedido. Revisa la conexión e intenta de nuevo.',
            'error',
        );
    }, []);

    const toggleExpand = useCallback(async (key, pedidoId, sucId) => {
        if (expanded === key) { setExpanded(null); setExpandedMeta(null); return; }
        setExpanded(key);
        setExpandedMeta({ pedidoId, sucId });
        if (!items[key]) await fetchItems(key, pedidoId, sucId);
    }, [expanded, items, fetchItems]);

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    const handleLifecycle = useCallback(async (pedidoId, sucId, stage, razon = null) => {
        const key = `lc_${pedidoId}_${sucId}`;
        setBusyLifecycle(key);
        try {
            const { error } = await avanzarEtapaDePedidoEnSala({ p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: stage, p_user_id: user?.id ?? null, p_razon: razon });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, pedidoId, { sucursal_id: sucId, razon });
            loadActive();
            // El aviso «en preparación» a la sala lo escribe la base
            // (`avisar_camino_del_pedido`), no esta pantalla.
            return true;
        } catch (e) {
            // Se dice (2026-10-08). Era un `console.error` a secas: «Iniciar»,
            // «Pausar» o «Reanudar» rechazados por la base —una pausa sin
            // reanudar, un permiso— giraban, se apagaban y no pasaba nada.
            console.error('Lifecycle error:', e);
            const que = { iniciar: 'iniciar', pausar: 'pausar', reanudar: 'reanudar', finalizar: 'finalizar' }[stage] ?? 'guardar el cambio';
            useToastStore.getState().showToast(`No se pudo ${que}`, mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
            return false;
        } finally { setBusyLifecycle(null); }
    }, [user, loadActive]);

    const [anularModal,      setAnularModal]      = useState(null); // { pedidoId, numero, requiresReason }
    const [busyAnular,       setBusyAnular]       = useState(false);

    const [printingPdf,      setPrintingPdf]      = useState(null);
    const [programarModal,   setProgramarModal]   = useState(null); // { pedidoId, sucId, numero, currentAt, historial }
    const [savingProgramar,  setSavingProgramar]  = useState(false);

    const handleProgramarEntrega = useCallback(async (newIso) => {
        if (!programarModal) return;
        const { pedidoId, sucId, historial } = programarModal;
        setSavingProgramar(true);
        try {
            // La entrada se AGREGA en la base (`programar_entrega_sala`); el
            // historial y el nombre sólo los usa el camino viejo de respaldo.
            const emp = empMap.get(user?.id);
            const { error } = await programarEntregaSala({
                pedidoId, sucId, cuando: newIso, historial,
                por: user?.id ?? null, nombre: emp?.name ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_ENTREGA_PROGRAMADA', pedidoId, { sucursal_id: sucId, entrega_at: newIso });
            setProgramarModal(null);
            await loadActive();
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo programar la entrega', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setSavingProgramar(false); }
    }, [programarModal, user, empMap, loadActive]);

    // `finalizada`: la sala ya despachó, y la hoja reimpresa tiene que decir lo
    // que SALIÓ (`cantidad_enviada`), no lo asignado — ver `printFromPedidoItems`.
    const handlePrintPdf = useCallback(async (pedidoId, pedidoNumero, sucId, cardKey, codigo, finalizada = false) => {
        setPrintingPdf(pedidoId);
        try {
            let rows = items[cardKey];
            if (!rows) rows = await fetchItems(cardKey, pedidoId, sucId);
            // Sin renglones no se imprime: un PDF vacío se ve como un pedido
            // vacío, y con él en la mano nadie arma las cajas que faltan.
            if (!rows?.length) { avisarSinRenglones('imprimir'); return; }
            await printFromPedidoItems(pedidoNumero, [[sucId, rows]], finalizada ? { cantidad: 'enviada' } : {}, codigo ?? `${pedidoNumero}`);
        } catch (e) {
            console.error('PDF error:', e);
            useToastStore.getState().showToast('No se pudo imprimir', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setPrintingPdf(null); }
    }, [items, fetchItems, avisarSinRenglones]);

    const openPauseModal = useCallback(async (pedidoId, sucId) => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [{ data: histData, error: histErr }, { data: punchData, error: punchErr }] = await Promise.all([
                fetchPausaHistorial(pedidoId, sucId),
                user?.id
                    ? fetchAttendancePunches(user.id, todayStart.toISOString())
                    : Promise.resolve({ data: [] }),
            ]);
            if (histErr) throw histErr;
            if (punchErr) throw punchErr;

            const history = histData ?? [];
            const punches = punchData ?? [];
            const onKioskLunch = punches.length > 0 && punches[0].type === 'OUT_LUNCH';
            const alreadyUsedAlmuerzo = history.some(h => h.razon?.toLowerCase().includes('almuerzo'));

            setKioskLunch(onKioskLunch);
            setPauseHistory(history);
            setPauseRazon(onKioskLunch && !alreadyUsedAlmuerzo ? 'almuerzo' : 'insumos');
            setPauseComment('');
            setPauseModal({ pedidoId, sucId });
        } catch (e) {
            console.error('openPauseModal error:', e);
            // Abre el modal aunque falle la detección de kiosko
            setPauseHistory([]);
            setKioskLunch(false);
            setPauseRazon('insumos');
            setPauseComment('');
            setPauseModal({ pedidoId, sucId });
        }
    }, [user?.id]);

    const confirmPause = useCallback(async () => {
        if (!pauseModal) return;
        const reason = PAUSE_REASONS.find(r => r.key === pauseRazon);
        let razon = reason?.label ?? pauseRazon;
        if (pauseComment.trim()) razon += ` — ${pauseComment.trim()}`;
        // Se cierra sólo si la pausa entró: cerrado sobre un rechazo, quien
        // pausó se iba creyendo que el reloj se había detenido.
        const ok = await handleLifecycle(pauseModal.pedidoId, pauseModal.sucId, 'pausar', razon);
        if (ok) setPauseModal(null);
    }, [pauseModal, pauseRazon, pauseComment, handleLifecycle]);

    const handleApoyoSuccess = useCallback((emp, cardKey, tipo = 'preparacion') => {
        setApoyoMap(prev => {
            const existing = prev[cardKey] ?? { preparacion: [], recepcion: [] };
            const bucket   = existing[tipo] ?? [];
            if (bucket.find(e => e.id === emp.id)) return prev;
            return { ...prev, [cardKey]: { ...existing, [tipo]: [...bucket, { id: emp.id, name: emp.name, first_names: emp.first_names, last_names: emp.last_names, photo_url: emp.photo_url }] } };
        });
        loadActive();
    }, [loadActive]);

    const handleAnular = useCallback(async (motivo = null) => {
        if (!anularModal) return;
        setBusyAnular(true);
        try {
            const { error } = await anularPedido({
                p_pedido_id:  anularModal.pedidoId,
                p_anulado_por: user?.id ?? null,
                p_motivo:     motivo || null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_ANULADO', anularModal.pedidoId, { numero: anularModal.numero, motivo });
            useToastStore.getState().showToast(`Pedido #${anularModal.numero} anulado`, motivo ? `Motivo: ${motivo}` : 'El pedido fue anulado correctamente.', 'success');
            setAnularModal(null);
            await loadActive();
        } catch (e) {
            useToastStore.getState().showToast('Error al anular', mensajeAmigable(e, 'Ocurrió un error.'), 'error');
        } finally {
            setBusyAnular(false);
        }
    }, [anularModal, user, loadActive]);

    // ── Reception ─────────────────────────────────────────────────────────────

    const openFinalizarModal = useCallback(async (pedidoId, sucId, numero, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        setBusyAction(`finalizar_load_${key}`);
        try {
            const [rowsResult, pssResult] = await Promise.all([
                items[key] ? Promise.resolve(items[key]) : fetchItems(key, pedidoId, sucId),
                fetchPedidoSucursalStatus(pedidoId, sucId, 'paginas'),
            ]);
            // Con los renglones vacíos o a medias NO se abre (2026-10-08): de
            // esta lista salen las cajas especiales y las de Electrolit que se
            // guardan al finalizar, y con `[]` se guardaban CERO sin aviso.
            if (!rowsResult?.length) { avisarSinRenglones('abrir el cierre del pedido'); return; }
            if (pssResult.error) throw pssResult.error;
            setFinalizarModal({
                pedidoId, sucId, numero, key,
                rows:    rowsResult,
                paginas: pssResult.data?.paginas ?? null,
            });
        } catch (e) {
            console.error('openFinalizarModal:', e);
            useToastStore.getState().showToast('No se pudo abrir el cierre del pedido', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setBusyAction(null); }
    }, [busyAction, items, fetchItems, avisarSinRenglones]);

    const handleFinalizarConCajas = useCallback(async ({ totalCajas, cajaMap, paginaItems, ajustesEnvio = [] }) => {
        if (!finalizarModal) return;
        const { pedidoId, sucId } = finalizarModal;
        const allRows = finalizarModal.rows ?? [];
        // Las dos cuentas de cajas salen de lo que de verdad SALE, no de lo
        // asignado: `ajustesEnvio` ya dice qué renglón se despacha corto o no se
        // despacha. Contar una caja que acaba de declararse no enviada le pide a
        // la sala que reciba algo que nunca viajó — ver `renglonesQueSalen`.
        const rowsQueSalen = renglonesQueSalen(allRows, ajustesEnvio);

        // Contar cajas Electrolit: solo los que despachan por CAJA (625ml).
        // Cuenta CAJAS con la misma fórmula que las especiales — antes tenía su
        // propio `Math.round(...)` copiado, y dos fórmulas para "cuántas cajas
        // son estas unidades" es una discrepancia esperando su parcial.
        const cajasElectrolit = rowsQueSalen
            .filter(r =>
                (r.products?.nombre ?? '').toLowerCase().includes('electrolit') &&
                (r.dispatch_tipo ?? '').toUpperCase() === 'CAJA'
            )
            .reduce((sum, r) => sum + cajasDeRenglon(r), 0);

        // Cajas especiales: E1, E2… una por CAJA. Un Electrolit ×12 es una caja
        // especial, no doce.
        const cajasEspeciales = construirCajasEspeciales(rowsQueSalen);

        setBusyAction('finalizar');
        try {
            // 1-3. Qué sale, finalizar, y cajas y hojas: UNA transacción
            //      (`finalizar_sala_con_cajas`, `data/pasosDelPedido`). Antes
            //      eran tres escrituras y si la tercera fallaba la sala quedaba
            //      finalizada sin cajas ni hojas, sin forma de reintentar.
            const { data: fin, error: finErr } = await finalizarSalaConCajas({
                pedidoId, sucId, userId: user?.id ?? null,
                totalCajas, cajaMap, paginaItems, cajasElectrolit, cajasEspeciales, ajustesEnvio,
            });
            if (finErr) throw finErr;
            // El segundo clic de un doble clic: el primero ya finalizó y ya
            // mandó el traslado. No se anota ni se despacha otra vez.
            if (fin?.yaEstaba) {
                useToastStore.getState().showToast('Ya estaba finalizado', 'Esta sala ya se había finalizado.', 'info');
                setFinalizarModal(null);
                await loadActive();
                return true;
            }

            useStaff.getState().appendAuditLog('PEDIDO_FINALIZADO', pedidoId, {
                totalCajas, cajasElectrolit,
                cajasEspeciales: cajasEspeciales.length,
                cajas: Object.keys(cajaMap).length,
                ajustes_envio: ajustesEnvio.length,
                no_enviados: ajustesEnvio.filter(a => a.cantidad_enviada === 0).length,
            });

            // 4. Y recién ahora sale del sistema: un traslado por producto.
            //    Va al final a propósito — necesita `finalizado_at` y necesita
            //    las hojas ya escritas, porque el número de hoja viaja adentro
            //    de cada traslado. Responde enseguida y sigue en segundo plano;
            //    el avance se sigue en `pedido_traslado_erp`.
            //
            //    Un fallo acá NO tumba el finalizado, y por eso va en su PROPIO
            //    try: si se cayera al catch de afuera, el mensaje diría «no se
            //    pudo finalizar» sobre un pedido que sí quedó finalizado, y
            //    quien despacha lo intentaría de nuevo. Un tropiezo de red al
            //    invocar no puede reescribir lo que ya pasó.
            try {
                const despacho = await despacharTrasladoPedido(pedidoId, sucId);
                if (!despacho.ok) {
                    useToastStore.getState().showToast(
                        'El pedido quedó finalizado, pero no salió del sistema',
                        mensajeAmigable(despacho.error, 'Se puede reintentar desde el pedido.'),
                        'warning',
                    );
                }
            } catch (e) {
                console.error('despacho del traslado:', e);
                useToastStore.getState().showToast(
                    'El pedido quedó finalizado, pero no salió del sistema',
                    mensajeAmigable(e, 'Se puede reintentar desde el pedido.'),
                    'warning',
                );
            }

            // Cerrar recién acá: lo escrito ya está en la base. Antes se cerraba
            // ANTES de escribir y un error se llevaba todo lo que se había
            // anotado en el modal (2026-10-07).
            setFinalizarModal(null);
            await loadActive();
            return true;
        } catch (e) {
            console.error('handleFinalizarConCajas:', e);
            useToastStore.getState().showToast('No se pudo finalizar', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
            return false;
        } finally { setBusyAction(null); }
    }, [finalizarModal, user, loadActive]);

    const handleLlegada = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        let rows = items[key];
        if (!rows) {
            setBusyAction('llegada');
            rows = await fetchItems(key, pedidoId, sucId);
            setBusyAction(null);
        }
        // La llegada marca con estos renglones qué no vino; sin ellos marcaría
        // nada y diría que sí.
        if (!rows) { avisarSinRenglones('confirmar la llegada'); return; }
        setLlegadaModal({ pedidoId, sucId, key, rows });
    }, [busyAction, items, fetchItems, avisarSinRenglones]);

    const handleLlegadaConfirm = useCallback(async ({ cajasDanadas, cajasFaltantes, nota, electrolitFaltantes = null, especialesLlegadas = null, cajasExtra = 0, cajasExtraNotas = null }) => {
        if (!llegadaModal) return;
        const { pedidoId, sucId, key, rows } = llegadaModal;
        setBusyAction('llegada');
        try {
            // La lógica vive en el núcleo (`data/llegadaDePedido`): la app del
            // teléfono confirma la llegada con la misma función.
            const { tipo, electrolitSinUbicar = 0 } = await confirmarLlegadaDePedido({
                pedidoId, sucId, rows, userId: user?.id ?? null,
                cajasDanadas, cajasFaltantes, nota, electrolitFaltantes, especialesLlegadas, cajasExtra, cajasExtraNotas,
            });
            // El Electrolit que faltó sin saber de qué sabor: queda anotado en la
            // sala y no se bloquea ningún renglón al azar — ver
            // `renglonesDeElectrolitFaltante`. Se dice para que al contar no
            // sorprenda que el producto aparezca para contarse.
            if (electrolitSinUbicar > 0) {
                useToastStore.getState().showToast(
                    'Electrolit faltante anotado en la sala',
                    `No se pudo saber de qué sabor ${electrolitSinUbicar === 1 ? 'es la caja que no llegó' : `son las ${electrolitSinUbicar} cajas que no llegaron`}. Al contar, anota como faltante el que no esté.`,
                    'info', 9000,
                );
            }

            useStaff.getState().appendAuditLog('PEDIDO_LLEGADA_CONFIRMADA', pedidoId, { tipo, cajasFaltantes, cajasDanadas, cajasExtra, cajasExtraNotas });
            setLlegadaStatus(prev => ({ ...prev, [key]: true }));

            // 5. Los avisos a bodega —cajas, Electrolit, especiales y cajas de
            //    más— los escribe la base al ver `llegada_tipo`
            //    (`avisar_camino_del_pedido`, 2026-09-28). Una app que confirme la
            //    llegada no puede olvidarlos.

            // Cerrar recién acá: lo escrito ya está en la base. Antes se cerraba
            // ANTES de escribir y un error se llevaba todo lo que se había
            // anotado en el modal (2026-10-07).
            setLlegadaModal(null);
            await Promise.all([loadActive(), fetchItems(key, pedidoId, sucId)]);
            return true;
        } catch (e) {
            // Y se dice. Un `console.error` a secas dejaba a quien recibe
            // creyendo que la llegada quedó registrada.
            console.error('llegada confirm:', e);
            useToastStore.getState().showToast('No se pudo confirmar la llegada', mensajeAmigable(e), 'error');
            return false;
        } finally { setBusyAction(null); }
    }, [llegadaModal, user, loadActive, fetchItems]);

    // `especialesFaltantes` llega como `[{ label, producto }]` —de
    // `faltantesDeLaSala`— para que el aviso nombre el producto. El ciclo guarda
    // sólo las etiquetas: es la clave que leen la segunda llegada y
    // `cajas_especiales_llegadas`.
    //
    // `desdeResolver`: lo llama `handleResolverFaltantes`, que ya tomó el
    // `busyAction` y lo soltó en el medio. Cualquier otro llamador pasa por el
    // freno de doble clic: dos clics abrían DOS ciclos de reenvío por las
    // mismas cajas (2026-10-08).
    const handleReenviarCaja = useCallback(async (pedidoId, sucId, numero, cajasFaltantes, electrolitsFaltantes = 0, especialesFaltantes = [], { desdeResolver = false } = {}) => {
        if (busyAction && !desdeResolver) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        if (reenvioEnCursoRef.current) return;
        reenvioEnCursoRef.current = true;
        setBusyAction('reenvio');
        try {
            // El ciclo lo numera la base sobre la fila bloqueada
            // (`pedir_reenvio_sala`): leído acá, dos pedidos simultáneos daban
            // el MISMO número, que es la clave con la que la ruta marca el
            // reenvío. Nace PENDIENTE: el aviso sale cuando sale la ruta.
            const especialesLabels = especialesFaltantes.map(e => (typeof e === 'string' ? e : e.label));
            const { data: reenvio, error: reenvioErr } = await pedirReenvioSala({
                pedidoId, sucId, cajas: cajasFaltantes, especiales: especialesLabels,
                electrolits: electrolitsFaltantes, userId: user?.id ?? null,
            });
            if (reenvioErr) throw reenvioErr;
            const ciclo = reenvio?.ciclo;

            useStaff.getState().appendAuditLog('PEDIDO_REENVIO_CAJA', pedidoId, { sucursal_id: sucId, ciclo, cajas: cajasFaltantes, electrolits: electrolitsFaltantes, especiales: especialesLabels });

            // El aviso «reenvío en camino» lo escribe la base cuando la ruta
            // SALE. Se abre «Nueva ruta» con el reenvío ya marcado. Si la base
            // todavía no saca reenvíos en ruta (`enRuta === false`), el reenvío
            // ya salió al pedirlo, como siempre: no hay ruta que armar.
            await loadActive();
            if (reenvio?.enRuta !== false) setCrearRutaOpen([reenvio?.clave ?? `${pedidoId}__${sucId}__r${ciclo}`]);
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo registrar el reenvío', mensajeAmigable(e), 'error');
        } finally { reenvioEnCursoRef.current = false; setBusyAction(null); }
    }, [busyAction, user, loadActive]);

    // Lo que bodega decidió sobre lo que no llegó: una parte se reenvía y otra
    // no. «No reenviar» va PRIMERO y, si falla, no se reenvía nada: son la misma
    // decisión y quien la tomó tiene que ver el error antes de que la mitad ya
    // esté hecha.
    //
    // `noReenviar` son productos, no cajas —`[{ labels, producto }]`—: el
    // sistema hace un traslado por producto y se anula entero.
    const handleResolverFaltantes = useCallback(async ({ pedidoId, sucId, numero, cajas = [], electrolits = 0, reenviarEspeciales = [], noReenviar = [] }) => {
        if (busyAction || reenvioEnCursoRef.current) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        if (noReenviar.length > 0) {
            setBusyAction('reenvio');
            const labels = noReenviar.flatMap(p => p.labels);
            const r = await noReenviarEspeciales(pedidoId, sucId, labels);
            if (!r?.ok) {
                setBusyAction(null);
                // El motivo del servidor pasa por el traductor: viaja tal cual lo
                // escribió la función («Faltan pedido_id o …») y eso no se lee.
                useToastStore.getState().showToast('No se pudo cancelar el reenvío', mensajeAmigable(r?.error, 'Intenta de nuevo.'), 'error');
                return;
            }
            useStaff.getState().appendAuditLog('PEDIDO_NO_REENVIO', pedidoId, {
                sucursal_id: sucId, labels, items: r.items ?? [],
                traslados_anulados: r.anulados ?? [], ya_anulados: r.ya_anulados ?? [],
            });
            // El aviso a la sala lo escribe `cerrar_no_reenviadas`, en la base.
            const que = noReenviar.map(p => (p.producto ? `${p.labels.join('–')} · ${p.producto}` : p.labels.join('–'))).join(' · ');
            const regresa = (r.anulados ?? []).length > 0 || (r.ya_anulados ?? []).length > 0;
            useToastStore.getState().showToast(
                'Reenvío cancelado',
                regresa ? `${que}: regresó a bodega.` : `${que}: no había salido, quedó cerrado.`,
                'success',
            );
            setBusyAction(null);
        }
        if (cajas.length > 0 || electrolits > 0 || reenviarEspeciales.length > 0) {
            await handleReenviarCaja(pedidoId, sucId, numero, cajas, electrolits, reenviarEspeciales, { desdeResolver: true });
        } else {
            await loadActive();
        }
    }, [busyAction, handleReenviarCaja, loadActive]);

    // Abre el modal de confirmación de llegada de reenvío (sustituye el botón ciego anterior)
    const handleSegundaLlegada = useCallback((pedidoId, sucId, key, reenviosHistorial, faltaCajasLegacy = [], cajaMap = {}) => {
        const historial = reenviosHistorial ?? [];
        // Sólo un ciclo que SALIÓ puede llegar: uno pendiente sigue en bodega.
        const cicloIdx  = historial.findIndex(c => c.sent_at && !c.arrived_at);
        const ciclo     = cicloIdx >= 0 ? historial[cicloIdx] : historial[historial.length - 1];
        if (!ciclo) {
            if (faltaCajasLegacy.length > 0) {
                setReenvioLlegadaModal({ pedidoId, sucId, key, ciclo: 1, cajasCiclo: faltaCajasLegacy, electrolitCount: 0, especialesList: [], historial: [], cajaMap });
            } else {
                useToastStore.getState().showToast('Sin reenvío pendiente', 'No hay ciclo de reenvío registrado para confirmar.', 'info');
            }
            return;
        }
        setReenvioLlegadaModal({
            pedidoId, sucId, key,
            ciclo:           ciclo.ciclo,
            cajasCiclo:      ciclo.cajas       ?? [],
            electrolitCount: ciclo.electrolits ?? 0,
            especialesList:  ciclo.especiales  ?? [],
            historial,
            cajaMap,
        });
    }, []);

    const handleReenvioLlegadaConfirm = useCallback(async ({ cajasOk, cajasDanadas, cajasFaltantes, nota, electrolitOk = true, especialesAun = [] }) => {
        if (!reenvioLlegadaModal) return;
        const { pedidoId, sucId, key, ciclo, historial, electrolitCount = 0, especialesList = [] } = reenvioLlegadaModal;
        setBusyAction('segunda_llegada');
        try {
            // Todo en UNA transacción (`confirmar_llegada_reenvio`,
            // `data/pasosDelPedido`): el ciclo, las cajas, el Electrolit, las
            // especiales y los renglones que se liberan. Antes eran de cuatro a
            // siete escrituras y un corte en el medio dejaba la llegada
            // confirmada con renglones todavía bloqueados.
            const hasFalta = cajasFaltantes.length > 0;
            const { data: llego, error: llegoErr } = await confirmarLlegadaDeReenvio({
                pedidoId, sucId, ciclo, historial, userId: user?.id ?? null,
                cajasOk, cajasDanadas, cajasFaltantes, nota,
                electrolitOk, electrolitCount, especialesList, especialesAun,
            });
            if (llegoErr) throw llegoErr;
            if (!llego?.yaEstaba) {
                useStaff.getState().appendAuditLog('PEDIDO_REENVIO_LLEGADA', pedidoId, { ciclo, arrived_tipo: llego?.arrived_tipo ?? null, cajasOk, cajasDanadas, cajasFaltantes });
            }

            // El mapa de hojas y lo ya contado, para abrir la recepción de lo
            // que llegó.
            const { data: pss, error: pssErr } = await fetchPedidoSucursalStatus(pedidoId, sucId,
                'caja_map, pagina_items, paginas, hojas_recibidas');
            if (pssErr) throw pssErr;
            const cajaMapDb     = pss?.caja_map    ?? {};
            const paginaItemsDb = pss?.pagina_items ?? {};

            // Si aún falta algo, el aviso a BODEGA lo escribe la base al ver
            // `segunda_llegada_at` (`avisar_camino_del_pedido`). Antes lo mandaba
            // esta pantalla, y a la sala equivocada: la propia.

            // Cerrar recién acá: lo escrito ya está en la base. Antes se cerraba
            // ANTES de escribir y un error se llevaba todo lo que se había
            // anotado en el modal (2026-10-07).
            setReenvioLlegadaModal(null);
            const [, freshItems] = await Promise.all([loadActive(), fetchItems(key, pedidoId, sucId)]);

            // Auto-abrir RecepcionModal para los ítems de las cajas/especiales/electrolits que sí llegaron
            const pendingArrived  = (freshItems || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0 && !r.falta_caja);
            const hasFaltaItemsNow = (freshItems || []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
            if (pendingArrived.length > 0) {
                const pedidoRow = activeRows.find(r => r.pedido_id === pedidoId && r.erp_sucursal_id === sucId);
                setModal({
                    pedido: { id: pedidoId, numero: pedidoRow?.numero ?? null, codigo: pedidoRow?.codigo ?? null },
                    sucId, key,
                    rows:           pendingArrived,
                    cajaDanada:     cajasDanadas,
                    cajaMap:        cajaMapDb,
                    paginaItems:    paginaItemsDb,
                    paginas:        pss?.paginas ?? [],
                    hojasRecibidas: pss?.hojas_recibidas ?? [],
                    faltaCajas:     hasFalta ? cajasFaltantes : [],
                    hasFaltaItems:  hasFaltaItemsNow,
                    // Ver el comentario de `openModal`: sin estos dos juegos de
                    // ids, una hoja ya contada se ve igual que una en reenvío.
                    itemsEnReenvio:  (freshItems || []).filter(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0).map(r => r.id),
                    itemsYaContados: (freshItems || []).filter(r => r.status !== 'pendiente').map(r => r.id),
                });
            }
            return true;
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo confirmar la llegada del reenvío', mensajeAmigable(e), 'error');
            return false;
        } finally { setBusyAction(null); }
    }, [reenvioLlegadaModal, user, loadActive, fetchItems, activeRows]);

    const handleEntregarStop = useCallback(async (stopId, rutaId, sucId) => {
        try {
            const { error } = await updateRutaPedidoEntregado(stopId, user?.id, { sucursal_id: sucId });
            if (error) throw error;
            // «El conductor llegó» lo escribe la base (`avisar_llegada_del_conductor`).
            loadActiveRutas();
        } catch (e) {
            useToastStore.getState().showToast('No se pudo marcar la entrega', mensajeAmigable(e), 'error');
        }
    }, [user, loadActiveRutas]);

    // `sinRecargar`: lo pide el cierre de la recepción (`onConfirmed`), que
    // recarga el tablero y el detalle UNA vez al final. Recargando también acá
    // eran dos recargas del tablero por cada recepción terminada.
    // Devuelve si quedó confirmado.
    const handleMarkErp = useCallback(async (pedidoId, sucId, key, { sinRecargar = false } = {}) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return false; }
        setBusyAction('erp');
        try {
            // Mismo silencio que la llegada: sin mirar el `error`, la tarjeta
            // pasaba a «Confirmado» y la bitácora lo daba por hecho sobre una
            // fila que no se había tocado.
            const { error } = await avanzarEtapaDePedidoEnSala({ p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'recibir_erp', p_user_id: user?.id ?? null });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: sucId });
            setErpStatus(prev => ({ ...prev, [key]: true }));
            if (!sinRecargar) await loadActive();
            return true;
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo confirmar', mensajeAmigable(e), 'error');
            return false;
        } finally { setBusyAction(null); }
    }, [busyAction, user, loadActive]);

    // ── Reintentar el ingreso al inventario ─────────────────────────────────
    // El caso: la sala contó y confirmó, y el ingreso —que va en su propio try
    // para no deshacer un conteo ya guardado— no entró. El producto está en la
    // sala y el inventario no lo tiene, así que no se puede facturar.
    //
    // La lista de qué reintentar sale del SERVIDOR (`items_sin_ingresar`), no
    // del navegador: son los renglones que la sala ya contó y cuya línea quedó
    // sin recibir. Mandar la recepción sin lista toma todo lo pendiente de la
    // sucursal, y ahí entrarían productos que nadie contó.
    //
    // Repetirlo es inofensivo: la recepción sólo mira las líneas que siguen
    // 'enviada', así que reintentar sobre algo ya ingresado no hace nada.
    const handleReintentarIngreso = useCallback(async (pedidoId, sucId) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        setBusyAction('ingreso');
        try {
            const { itemIds, error } = await fetchItemsSinIngresar(pedidoId, sucId);
            if (error) throw error;
            if (!itemIds.length) {
                useToastStore.getState().showToast('Nada que ingresar', 'Todo lo confirmado ya está en el inventario.', 'info');
                await loadActive();
                return;
            }
            const erp = await recibirTrasladoPedido(pedidoId, sucId, { itemIds });
            if (!erp.ok && erp.codigo !== 'NADA_QUE_RECIBIR') throw new Error(mensajeAmigable(erp.error, 'No se pudo ingresar.'));
            useStaff.getState().appendAuditLog('REINTENTAR_INGRESO_INVENTARIO', pedidoId, {
                sucursal_id: sucId, items_count: itemIds.length,
                entraron: erp.recibidas ?? null, completo: erp.completo ?? null,
            });
            // Lo que ENTRÓ, no lo que se pidió. Decía «N entraron» sobre el
            // tamaño de la lista aunque no hubiera entrado ninguno: con
            // `NADA_QUE_RECIBIR` —que se acepta como éxito— la cuenta era cero y
            // el aviso igual felicitaba.
            const entraron = erp.recibidas ?? 0;
            if (entraron === 0) {
                useToastStore.getState().showToast('Nada entró al inventario',
                    'Los productos siguen pendientes. Si se repite, hay que revisarlos en el sistema.', 'error', 8000);
            } else {
                useToastStore.getState().showToast('Ingresado',
                    `${entraron} producto${entraron !== 1 ? 's' : ''} entr${entraron !== 1 ? 'aron' : 'ó'} al inventario.`
                    + (erp.completo === false ? ` Quedan ${itemIds.length - entraron} por reintentar.` : ''),
                    erp.completo === false ? 'info' : 'success');
            }
            await loadActive();
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo ingresar', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [busyAction, loadActive]);

    // ── Vigilar un ingreso que quedó corriendo en segundo plano ─────────────────
    //
    // Desde v2.656.0 confirmar una hoja NO espera al sistema: la sala se va y el
    // ingreso sigue del lado del servidor (18-45 s una hoja de 35 productos,
    // medido). Eso deja un hueco: la tarjeta muestra el resultado y nadie se lo
    // vuelve a preguntar, así que hasta la próxima recarga se quedaba con la foto
    // de antes —en rojo, invitando a un reintento innecesario—.
    //
    // Se pregunta sólo por ESTE pedido y sólo por el resumen: una fila, no la
    // vista entera. Y para de preguntar en cuanto no queda nada pendiente o a los
    // 4 minutos, que es más de lo que tarda el pedido más grande medido.
    const vigilarIngreso = useCallback((pedidoId, sucId) => {
        const cardKey = `act_${pedidoId}_${sucId}`;
        if (vigilanciaRef.current[cardKey]) clearInterval(vigilanciaRef.current[cardKey].timer);
        setIngresoEnCurso(p => ({ ...p, [cardKey]: true }));

        const fin = () => {
            const v = vigilanciaRef.current[cardKey];
            if (v) { clearInterval(v.timer); delete vigilanciaRef.current[cardKey]; }
            setIngresoEnCurso(p => { const n = { ...p }; delete n[cardKey]; return n; });
        };

        let vueltas = 0;
        const timer = setInterval(async () => {
            vueltas += 1;
            const { data, error } = await fetchResumenIngresoPedidos([pedidoId]);
            if (error) { console.error('vigilarIngreso:', error.message); fin(); return; }
            const fila = (data ?? []).find(r => r.erp_sucursal_id === sucId);
            if (fila) setIngresoStats(p => ({ ...p, [cardKey]: fila }));
            // Terminó cuando no queda nada por ingresar. Si el sistema dejó algo
            // afuera, el tope corta y la tarjeta lo dice con su reintento.
            if (!fila || fila.sin_ingresar === 0 || vueltas >= 20) fin();
        }, 12_000);
        vigilanciaRef.current[cardKey] = { timer };
    }, []);

    useEffect(() => () => {
        Object.values(vigilanciaRef.current).forEach(v => clearInterval(v.timer));
        vigilanciaRef.current = {};
    }, []);

    const openModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        // Los renglones y el reparto por hoja van JUNTOS: no dependen uno del
        // otro, y en serie eran dos esperas antes de que se abriera la pantalla.
        const [loaded, pssRes] = await Promise.all([
            fetchItems(key, pedidoId, sucId),
            fetchPedidoSucursalStatus(pedidoId, sucId, 'pagina_items, paginas, hojas_recibidas'),
        ]);
        if (loaded === null) { avisarSinRenglones('abrir la recepción'); return; }
        // Lo que queda por contar, MÁS lo que ya se anotó como llegado de más.
        // Los extras no son «pendientes» —nacen con su diferencia puesta—, así
        // que este filtro los dejaba afuera y reabrir la pantalla mostraba la
        // lista de extras vacía sobre renglones que sí existen. `sortedRows`
        // los saca de lo que se cuenta; acá sólo tienen que llegar.
        const extrasAnotados = (loaded || []).filter(r => r.es_extra && r.status !== 'anulado');
        const rows = [
            ...(loaded || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0 && !r.falta_caja),
            ...extrasAnotados,
        ];
        // Lo YA contado, aparte y nunca dentro de `rows`.
        //
        // Un renglón confirmado no se vuelve a contar —`receive_pedido_sucursal`
        // sólo toca los `pendiente`— así que mezclarlo acá lo metería en la
        // grilla de conteo y en «Confirmar todo» sin que hiciera nada. Pero
        // tampoco puede faltar: sin él, buscar un producto ya confirmado no
        // devolvía NADA y no existía pantalla donde verlo. Medido el 2026-09-02
        // en Salud 5 con SECUFEM — se confirmó 1 sobre 3 que llegaron y las
        // otras 2 no tenían dónde escribirse.
        //
        // Y con la misma criba de cantidad que `rows`: un pedido trae CIEN
        // renglones con `cantidad_asignada = 0` que nacen `recibido` con cero
        // —lo que la regla decidió no pedir— y sin este filtro la lista de lo
        // contado los mostraría a todos. Medido en el pedido #150 de Salud 5:
        // 100 renglones fantasma sobre el único que de verdad se contó.
        const confirmados = (loaded || []).filter((r) => {
            if (r.es_extra || !['recibido', 'con_diferencia'].includes(r.status)) return false;
            const enviado = r.cantidad_enviada ?? r.cantidad_asignada ?? 0;
            return enviado > 0 || (r.cantidad_recibida ?? 0) > 0;
        });
        if (!rows.length && !confirmados.length) return;
        const hasFaltaItems = (loaded || []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
        const activeRow  = activeRows.find(r => r.pedido_id === pedidoId && r.erp_sucursal_id === sucId);
        // cajas_danadas y falta_cajas son ahora arrays independientes (soporta 'mixto')
        const cajaDanada = activeRow?.cajas_danadas ?? [];
        const faltaCajas = activeRow?.falta_cajas   ?? [];
        const cajaMap    = activeRow?.caja_map       ?? {};

        // El reparto por hoja y lo ya contado. `pagina_items` es lo que decide si
        // se puede contar por hoja; `paginas` trae el rótulo de cada una (su
        // primer laboratorio), que es como quien recibe la reconoce en el papel.
        const { data: pss, error: pssErr } = pssRes;
        if (pssErr) console.error('openModal: fetch pedido_sucursal_status failed:', pssErr.message);
        const paginaItems    = pss?.pagina_items    ?? {};
        const paginas        = pss?.paginas         ?? [];
        const hojasRecibidas = pss?.hojas_recibidas ?? [];

        const especialesLlegadas = activeRow?.cajas_especiales_llegadas ?? {};
        // La lista de cajas especiales tal como se imprimió, para que la pantalla
        // de recepción rotule E1…En con las MISMAS etiquetas con las que la sala
        // reportó la llegada. Derivarla de `rows` las corre: `rows` es lo que
        // queda pendiente, no lo que salió de bodega.
        const cajasEspeciales = Array.isArray(activeRow?.cajas_especiales) ? activeRow.cajas_especiales : [];

        // `rows` sólo lleva lo que queda PENDIENTE, así que una hoja contada en
        // una sesión anterior llega al modal sin un solo renglón — idéntica a una
        // que viaja en una caja que no llegó. Estos dos juegos de ids son lo único
        // que las separa, y sin ellos el encabezado contaba «0/2» sobre una lista
        // de cuatro hojas con dos ya contadas.
        const itemsEnReenvio  = (loaded || []).filter(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0).map(r => r.id);
        const itemsYaContados = (loaded || []).filter(r => r.status !== 'pendiente').map(r => r.id);

        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, confirmados, cajaDanada, cajaMap, paginaItems, paginas, hojasRecibidas, faltaCajas, hasFaltaItems, especialesLlegadas, cajasEspeciales, itemsEnReenvio, itemsYaContados });
    }, [fetchItems, activeRows, avisarSinRenglones]);

    const openReenvioModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = await fetchItems(key, pedidoId, sucId);
        if (loaded === null) { avisarSinRenglones('abrir el reenvío'); return; }
        const rows = (loaded || []).filter(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
        if (!rows.length) return;
        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada: [] });
    }, [fetchItems, avisarSinRenglones]);

    // No lanza: lo llama `onConfirmed` del modal de recepción, que ya cerró la
    // pantalla. Pero tampoco firma lo que no ocurrió — si el reporte no entra,
    // se avisa y la bitácora se queda callada.
    const handleReportarDiferencias = useCallback(async (pedidoId, sucId) => {
        const { error } = await avanzarEtapaDePedidoEnSala({
            p_pedido_id: pedidoId, p_sucursal_id: sucId,
            p_stage: 'reportar_diferencias', p_user_id: user?.id ?? null,
        });
        if (error) {
            console.error('lifecycle reportar_diferencias:', error);
            useToastStore.getState().showToast('No se pudo reportar las diferencias', mensajeAmigable(error), 'error');
            return;
        }
        useStaff.getState().appendAuditLog('PEDIDO_DIFERENCIAS_REPORTADAS', pedidoId, { sucursal_id: sucId });
        // loadActive() lo llama el caller (onConfirmed) para no duplicar el fetch
    }, [user]);

    // 7A.1: cierre de bodega tras resolver todas las diferencias — llamado
    // desde DifSection.jsx (bloque "Cierre de bodega").
    const handleCorregirBodega = useCallback(async (pedidoId, sucId, nota) => {
        setBusyAction('corr_bodega');
        try {
            const { error } = await avanzarEtapaDePedidoEnSala({
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'corregir_bodega', p_user_id: user?.id ?? null, p_nota: nota || null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_CORREGIDO_BODEGA', pedidoId, { sucursal_id: sucId, nota });
            await loadActive();
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo marcar como corregido', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [user, loadActive]);

    // 7A.1: confirmación de sucursal tras el "Marcar corregido" de bodega —
    // llamado desde DifSection.jsx (bloque "Cierre de bodega").
    const handleConfirmarCorreccion = useCallback(async (pedidoId, sucId) => {
        setBusyAction('confirmar_corr');
        try {
            const { error } = await avanzarEtapaDePedidoEnSala({
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'confirmar_correccion', p_user_id: user?.id ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_CORRECCION_CONFIRMADA', pedidoId, { sucursal_id: sucId });
            await loadActive();
        } catch (e) {
            console.error(e);
            useToastStore.getState().showToast('No se pudo confirmar la corrección', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [user, loadActive]);

    const handleResolverItem = useCallback(async (pedidoId, sucId, itemId, action, tipo, nota) => {
        setBusyAction(`res_${itemId}`);
        try {
            const { error } = await resolverRenglonDePedido({
                p_item_id: itemId, p_action: action,
                p_user_id: user?.id ?? null,
                p_tipo:    tipo ?? null,
                p_nota:    nota ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_RESOLUCION_${action.toUpperCase()}`, pedidoId, { item_id: itemId, tipo, nota });
            const key = `act_${pedidoId}_${sucId}`;
            await Promise.all([loadActive(), fetchItems(key, pedidoId, sucId)]);
            return true;
        } catch (e) {
            // Se dice: con sólo `console.error`, una resolución rechazada se veía
            // igual que una que entró.
            console.error('resolverItem:', e);
            useToastStore.getState().showToast('No se pudo resolver', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
            return false;
        } finally { setBusyAction(null); }
    }, [user, loadActive, fetchItems]);

    // ── Devolución a bodega ───────────────────────────────────────────────────
    //
    // Tres pasos y ninguno se saltea: la sala pide, bodega decide —y al aceptar
    // el producto sale—, y bodega confirma la entrada. Ese último es el que
    // faltaba en todas las versiones anteriores de esta idea: sin él el producto
    // queda en tránsito, fuera de la sala y todavía no en bodega.

    const recargarTarjeta = useCallback(async (pedidoId, sucId) => {
        const key = `act_${pedidoId}_${sucId}`;
        await Promise.all([loadActive(), fetchItems(key, pedidoId, sucId)]);
    }, [loadActive, fetchItems]);

    // ── La decisión de la diferencia ──────────────────────────────────────────
    //
    // Un turno de la conversación. De quién es el turno y qué opciones valen lo
    // decide la BASE — acá se manda lo que la pantalla ofreció, y si no
    // correspondía rebota con su motivo. Escribir esa regla también acá sería
    // tenerla dos veces, y dos copias se separan.
    //
    // Cuando el acuerdo cae en una salida que se arregla EN EL SISTEMA, la RPC
    // deja la devolución creada y ya aceptada; lo único que falta es sacarla de
    // la sala, y eso habla con el sistema y puede fallar. Por eso va aparte: el
    // fallo del movimiento no borra el acuerdo.
    const handleDecidirDiferencia = useCallback(async (pedidoId, sucId, itemId, accion, tipo, nota, evidencia = []) => {
        setBusyAction(`dif_${itemId}`);
        try {
            const { data, error } = await decidirDiferencia({ itemId, accion, tipo, nota, evidencia });
            if (error) throw error;

            useStaff.getState().appendAuditLog(`PEDIDO_DIFERENCIA_${String(accion).toUpperCase()}`, pedidoId, {
                sucursal_id: sucId, item_id: itemId, opcion: data?.opcion ?? tipo, estado: data?.estado,
            });

            if (data?.devolucion_id) {
                // Los dos sentidos salen por acá desde el 2026-08-24: el
                // sobrante hace el mismo traslado de papel con el origen y el
                // destino cambiados. Lo único que cambia es cómo se cuenta.
                const aLaSala = data?.mueve === 'traslado_a_sala';
                const r = await moverDevoluciones([data.devolucion_id], { simulacro: false });
                useToastStore.getState().showToast(
                    r.ok ? (aLaSala ? 'Salió de bodega' : 'Salió de la sala')
                         : 'Quedaron de acuerdo, pero no salió',
                    r.ok ? (aLaSala ? 'Falta confirmar la entrada en la sala.'
                                    : 'Falta que bodega confirme la entrada.')
                         : mensajeAmigable(r.fallos?.[0]?.error ?? r.error, 'Se puede reintentar.'),
                    r.ok ? 'success' : 'warning',
                );
            } else if (data?.estado === 'escalada') {
                useToastStore.getState().showToast(
                    'Pasó a supervisión',
                    'No hubo acuerdo. Supervisión decide con qué salida se queda.',
                    'info',
                );
            }
            await recargarTarjeta(pedidoId, sucId);
        } catch (e) {
            useToastStore.getState().showToast('Diferencia', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [recargarTarjeta]);

    // «Ya lo tengo en la mano.» Cierra las salidas que se arreglan en FÍSICO: no
    // mueven nada en el sistema, pero igual las firma quien recibe el producto.
    const handleConfirmarLlegadaDiferencia = useCallback(async (pedidoId, sucId, itemId) => {
        setBusyAction(`dif_${itemId}`);
        try {
            const { error } = await confirmarLlegadaDiferencia(itemId);
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_DIFERENCIA_LLEGADA', pedidoId, {
                sucursal_id: sucId, item_id: itemId,
            });
            useToastStore.getState().showToast('Diferencia cerrada', 'Queda la constancia de que llegó.', 'success');
            await recargarTarjeta(pedidoId, sucId);
        } catch (e) {
            useToastStore.getState().showToast('Diferencia', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [recargarTarjeta]);

    // Proponer una salida que necesita FOTO — hoy sólo el daño.
    //
    // La evidencia va PRIMERO: si la foto no sube, la propuesta no se hace. Una
    // devolución por daño sin foto es exactamente la que bodega no puede
    // decidir, y dejarla entrar «para no perder lo escrito» la convierte en una
    // fila que alguien va a tener que rechazar a mano. La base además la
    // rechaza, así que subir después sería confiar en que el segundo paso ocurra.
    const handleProponerConFoto = useCallback(async ({ pedidoId, sucId, item, opcion, nota }, { nota: notaModal, fotos = [] }) => {
        setBusyAction(`dif_${item.id}`);
        let evidencia = [];
        try {
            evidencia = fotos.length
                ? await subirEvidencia(fotos, { salaId: sucId, userId: user?.id })
                : [];
        } catch (e) {
            useToastStore.getState().showToast('Diferencia', mensajeAmigable(e), 'error');
            setBusyAction(null);
            return;
        }
        setBusyAction(null);
        await handleDecidirDiferencia(pedidoId, sucId, item.id, 'proponer', opcion,
            notaModal || nota || null, evidencia);
    }, [user, handleDecidirDiferencia]);

    // Aceptar y mover son UN gesto para quien aprieta, pero dos escrituras
    // distintas: la decisión es del portal y siempre entra; el movimiento habla
    // con el sistema y puede fallar, tardar o estar pausado. Por eso el fallo del
    // segundo no borra el primero — la devolución queda aceptada y se reintenta.
    const handleDecidirDevolucion = useCallback(async (pedidoId, sucId, id, accion, nota) => {
        setBusyAction(`devdec_${id}`);
        try {
            const { error } = await decidirDevolucion(id, accion, nota);
            if (error) throw error;

            if (accion === 'aceptar') {
                const r = await moverDevoluciones([id], { simulacro: false });
                if (!r.ok) {
                    useToastStore.getState().showToast(
                        'Quedó aceptada, pero no salió',
                        mensajeAmigable(r.fallos?.[0]?.error ?? r.error, 'Se puede reintentar.'),
                        'warning',
                    );
                } else {
                    useToastStore.getState().showToast(
                        'Salió de la sala',
                        'Falta confirmar la entrada en bodega.',
                        'success',
                    );
                }
            }
            useStaff.getState().appendAuditLog(`PEDIDO_DEVOLUCION_${accion.toUpperCase()}`, pedidoId, {
                sucursal_id: sucId, devolucion_id: id, nota,
            });
            await recargarTarjeta(pedidoId, sucId);
        } catch (e) {
            useToastStore.getState().showToast('Devolución', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [recargarTarjeta]);

    // El reintento de la salida. Existe porque aceptar y mover son dos
    // escrituras: la primera siempre entra, la segunda habla con el sistema y
    // puede rebotar —sin existencia, presentación cambiada, movimientos
    // pausados—. Sin este botón, un acuerdo ya tomado se quedaría sin brazos.
    const handleMoverDevolucion = useCallback(async (pedidoId, sucId, id) => {
        setBusyAction(`devmov_${id}`);
        try {
            const r = await moverDevoluciones([id], { simulacro: false });
            useToastStore.getState().showToast(
                r.ok ? 'Salió de la sala' : 'No salió',
                r.ok ? 'Falta confirmar la entrada en bodega.'
                     : mensajeAmigable(r.fallos?.[0]?.error ?? r.error, 'Se puede reintentar.'),
                r.ok ? 'success' : 'error',
            );
            useStaff.getState().appendAuditLog('PEDIDO_DEVOLUCION_MOVIDA', pedidoId, {
                sucursal_id: sucId, devolucion_id: id, ok: r.ok === true,
            });
            await recargarTarjeta(pedidoId, sucId);
        } catch (e) {
            useToastStore.getState().showToast('Devolución', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [recargarTarjeta]);

    // La misma corrida SIN escribir. `simulacro` es el valor por omisión de la
    // función desde el día uno —hace todas las comprobaciones contra el sistema
    // y no toca una línea— y no había forma de dispararlo desde el portal, así
    // que un movimiento pausado era un freno sin salida: la única manera de
    // saber si iba a andar era dejarlo andar.
    //
    // Lo que devuelve se cuenta con detalle a propósito: el lote y la
    // presentación que eligió son justo lo que hay que mirar antes de dejar
    // salir producto por un camino recién estrenado.
    const handleProbarDevolucion = useCallback(async (pedidoId, sucId, id) => {
        setBusyAction(`devsim_${id}`);
        try {
            const r = await moverDevoluciones([id], { simulacro: true });
            const hecho = r.hechas?.[0] ?? null;
            useToastStore.getState().showToast(
                r.ok ? 'La prueba pasó — no se movió nada' : 'La prueba encontró un problema',
                r.ok && hecho
                    ? `${hecho.producto ?? 'El producto'} · ${hecho.presentacion ?? 'sin presentación'} · `
                      + `${(hecho.renglones ?? []).map(x => `${x.cantidad} del lote ${x.lote ?? 'sin lote'}`).join(', ') || 'sin lotes'}`
                      + (hecho.avisos?.length ? ` · ${hecho.avisos.join(' · ')}` : '')
                    : mensajeAmigable(r.fallos?.[0]?.error ?? r.error, 'Sin detalle.'),
                r.ok ? 'success' : 'warning', 12000,
            );
            useStaff.getState().appendAuditLog('PEDIDO_DEVOLUCION_PROBADA', pedidoId, {
                sucursal_id: sucId, devolucion_id: id, ok: r.ok === true,
            });
        } catch (e) {
            useToastStore.getState().showToast('Prueba', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, []);

    // El botón que cierra el círculo. Mientras nadie lo apriete, el producto
    // está en tránsito — y esa es la razón de que esta pieza se construyera
    // primero.
    const handleRecibirDevolucion = useCallback(async (pedidoId, sucId, id) => {
        setBusyAction(`devrec_${id}`);
        try {
            const r = await recibirDevoluciones([id], { simulacro: false });
            if (!r.ok) {
                useToastStore.getState().showToast(
                    'No se pudo ingresar',
                    mensajeAmigable(r.fallos?.[0]?.error ?? r.error, 'Se puede reintentar.'),
                    'error',
                );
            } else {
                useToastStore.getState().showToast('Entró en bodega', 'La diferencia queda cerrada.', 'success');
            }
            useStaff.getState().appendAuditLog('PEDIDO_DEVOLUCION_RECIBIDA', pedidoId, {
                sucursal_id: sucId, devolucion_id: id, ok: r.ok === true,
            });
            await recargarTarjeta(pedidoId, sucId);
        } catch (e) {
            useToastStore.getState().showToast('Devolución', mensajeAmigable(e), 'error');
        } finally { setBusyAction(null); }
    }, [recargarTarjeta]);

    // ── Derived ───────────────────────────────────────────────────────────────

    const filterOptions = useMemo(() => ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` })), []);

    // Qué hace que un pedido siga mereciendo la pantalla. Importa por el filtro
    // por defecto: un completado SIN observación se oculta.
    //
    // Y ahí entra lo que quedó sin ingresar al inventario. Un pedido se completa
    // en cuanto la sala termina de contar —el ingreso va aparte, en su propio
    // try— así que el caso «lo conté, no entró, y no puedo facturar» nacía
    // completado y se ocultaba solo: la alarma desaparecía justo cuando importa.
    // Visto en el navegador, no en el fuente; el `get_pedidos_en_curso` sí los
    // devuelve, era este filtro el que los tiraba.
    //
    // El Electrolit y las cajas especiales entran en la cuenta por lo mismo que
    // entran en `llegada_tipo`: un despacho donde lo único que no llegó fueron
    // cuatro cajas de Electrolit tiene una observación, y sin estas dos líneas se
    // ocultaba solo del filtro que existe para encontrarlo.
    //
    // La diferencia se mira por SALA (`diferencias_reportadas_at`), no por
    // `pedido_status === 'parcial'`: ese es del pedido, y una diferencia de una
    // sala marcaba como «con observación» a todas las demás (#174, 2026-09-17).
    // La regla vive en el núcleo (`tieneObservacion`): la app nativa filtra igual.
    const hasObservacion = useCallback((r) =>
        tieneObservacion(r, ingresoStats[`act_${r.pedido_id}_${r.erp_sucursal_id}`]?.sin_ingresar ?? 0),
    [ingresoStats]);

    // Group activeRows by pedido to detect if ALL sucursales for a pedido are preparado
    const pedidoStageMap = useMemo(() => {
        const map = new Map();
        activeRows.forEach(row => {
            const prev = map.get(row.pedido_id) ?? { allFinalized: true, anyActive: false, anyFinalized: false };
            map.set(row.pedido_id, {
                allFinalized:  prev.allFinalized  && !!row.finalizado_at,
                anyActive:     prev.anyActive     || (!!row.iniciado_at && !row.finalizado_at),
                anyFinalized:  prev.anyFinalized  || !!row.finalizado_at,
            });
        });
        return map;
    }, [activeRows]);

    // En ruta (transito) → procesando → con observación → erp
    const STAGE_ORDER = { transito: 0, preparando: 1, contando: 2, pausado: 3, preparado: 4, sin_iniciar: 5, erp: 7 };

    const filteredRows = useMemo(() => {
        let rows = activeRows;
        // guard cliente para branch: nunca mostrar datos de otra sucursal aunque la query DB llegue tarde
        if (isBranch && erpSucursalId) rows = rows.filter(r => r.erp_sucursal_id === erpSucursalId);
        if (filterSuc) rows = rows.filter(r => r.erp_sucursal_id === Number(filterSuc));

        // Estado y período: `filtrarPedidos` (núcleo), el mismo de la app nativa.
        // Los porqués de cada rama —«Pendientes» contra el estado de la SALA, el
        // completado con observación que no se esconde— están ahí.
        rows = filtrarPedidos(rows, { estado: filterStatus, rango: filterDate, observado: hasObservacion });
        if (searchTerm.trim()) rows = rows.filter(r => tokenMatch(searchTerm, String(r.numero), r.notes));
        const uid = String(user?.id ?? '');
        const stat = (r) => cardStats[`act_${r.pedido_id}_${r.erp_sucursal_id}`] ?? {};
        return [...rows].sort((a, b) => {
            // 1. Lo que le pide algo a alguien AHORA — ver `necesitaAtencion`.
            //    Va ANTES que «mío» y antes que la fecha: el pedido con una
            //    diferencia abierta o con las cajas sin contar es el que hay que
            //    ver, lo haya creado quien lo haya creado y sea de cuando sea.
            //    «Mío» sigue existiendo, pero adentro de cada grupo.
            const atA = necesitaAtencion(a, stat(a));
            const atB = necesitaAtencion(b, stat(b));
            if (atA !== atB) return atA ? -1 : 1;
            // 2. Mío — lo inicié o lo creé yo
            const mineA = uid && (String(a.iniciado_por) === uid || String(a.created_by) === uid);
            const mineB = uid && (String(b.iniciado_por) === uid || String(b.created_by) === uid);
            if (mineA !== mineB) return mineA ? -1 : 1;
            // 3. Stage
            const stageA = getBranchStage(a);
            const stageB = getBranchStage(b);
            const baseA = STAGE_ORDER[stageA] ?? 5;
            const baseB = STAGE_ORDER[stageB] ?? 5;
            const sa = (hasObservacion(a) && baseA > 0 && baseA < 7) ? 6 : baseA;
            const sb = (hasObservacion(b) && baseB > 0 && baseB < 7) ? 6 : baseB;
            // 4. Fecha más reciente
            return sa !== sb ? sa - sb : new Date(b.created_at) - new Date(a.created_at);
        });
    }, [activeRows, filterSuc, filterStatus, filterDate, searchTerm, hasObservacion, user, cardStats]); // eslint-disable-line

    const sucursalCounts = useMemo(() => {
        // branch: solo muestra su propia sucursal en las cards de stats.
        // La cuenta por sala y período es del núcleo (`pedidosPorSala`).
        const baseRows = (isBranch && erpSucursalId)
            ? activeRows.filter(r => r.erp_sucursal_id === erpSucursalId)
            : activeRows;
        const cuenta = pedidosPorSala(baseRows, filterDate);
        return ERP_ORDER.map(id => ({ id, name: ERP_NAMES[id] ?? `Suc. ${id}`, total: cuenta.get(id) ?? 0 }))
            .filter(s => s.total > 0);
    }, [activeRows, filterDate, isBranch, erpSucursalId]);

    return {
        user, isBranch, canEdit, canEditMinMax,
        erpSucursalId, branchName,
        filterSuc, setFilterSuc,
        filterStatus, setFilterStatus,
        filterDate, setFilterDate,
        activeRows,
        loading,
        expanded,
        items,
        eventosMap,
        devolucionesMap,
        loadingItems,
        itemsError,
        llegadaStatus,
        erpStatus,
        busyAction,
        busyLifecycle,
        crearRutaOpen, setCrearRutaOpen,
        modal, setModal,
        rutaMapOpen, setRutaMapOpen,
        pedidoRutaMap,
        llegadaModal, setLlegadaModal,
        reenvioLlegadaModal, setReenvioLlegadaModal,
        reenviarConfirmModal, setReenviarConfirmModal,
        finalizarModal, setFinalizarModal,
        newAlert, setNewAlert,
        pauseModal, setPauseModal,
        pauseHistory,
        pauseRazon, setPauseRazon,
        pauseComment, setPauseComment,
        kioskLunch,
        apoyoMap,
        apoyoModal, setApoyoModal,
        cardStats,
        trasladoStats,
        ingresoStats,
        ingresoEnCurso,
        vigilarIngreso,
        handleReintentarIngreso,
        entregaMap,
        anularModal, setAnularModal,
        busyAnular,
        printingPdf,
        programarModal, setProgramarModal,
        savingProgramar,
        empMap,
        loadActive,
        loadActiveRutas,
        fetchItems,
        toggleExpand,
        handleLifecycle,
        handleProgramarEntrega,
        handlePrintPdf,
        openPauseModal,
        confirmPause,
        handleApoyoSuccess,
        handleAnular,
        openFinalizarModal,
        handleFinalizarConCajas,
        handleLlegada,
        handleLlegadaConfirm,
        handleReenviarCaja,
        handleResolverFaltantes,
        handleSegundaLlegada,
        handleReenvioLlegadaConfirm,
        handleEntregarStop,
        handleMarkErp,
        openModal,
        openReenvioModal,
        handleReportarDiferencias,
        handleCorregirBodega,
        handleConfirmarCorreccion,
        handleResolverItem,
        handleDecidirDiferencia,
        handleConfirmarLlegadaDiferencia,
        handleProponerConFoto,
        handleDecidirDevolucion,
        handleMoverDevolucion,
        handleProbarDevolucion,
        handleRecibirDevolucion,
        filterOptions,
        hasObservacion,
        pedidoStageMap,
        filteredRows,
        sucursalCounts,
    };
}
