import React from 'react';
import CarrilCards from '../../components/common/CarrilCards';
import { EmptyState } from '../../components/common/StateViews';
import Button from '../../components/common/Button';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Notice from '../../components/common/Notice';
import { SkeletonText } from '../../components/common/StateViews';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle,
    Truck, Pause, Play, Home,
    X, Send, Check, RotateCcw, Flag,
    ClipboardList, UserPlus, Inbox, FileDown, Box, Zap, Map as MapIcon,
    CalendarClock, Ban, Star, Search, Radio, RefreshCw, PackageX, PackageCheck, Store,
} from 'lucide-react';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import ConfirmModal from '../../components/common/ConfirmModal';
import SegmentedControl from '../../components/common/SegmentedControl';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { fmtMin, elapsed, fmtEntrega, fmtRelative, getBranchStage, hayRecepcionPendiente, estadoDeLaSala, claveParada, puedePrepararse, puedeDespacharse, faltantesDeLaSala, describirFaltantes } from '@nucleo/utils/tableroDePedidos';
import ItemSections from './tabpedidos/ItemSections';
import AvanceCompacto, { EncabezadoDeAvance } from './tabpedidos/AvanceCompacto';
import LifecycleTimeline from './tabpedidos/LifecycleTimeline';
import DifSection from './tabpedidos/DifSection';
import PostCompletionSection from './tabpedidos/PostCompletionSection';
import ReceptionActions from './tabpedidos/ReceptionActions';
import FilterPill from './tabpedidos/FilterPill';
import { iniciarRuta, completarRuta } from '@nucleo/data/pedidos';
import { usePedidosData } from '@nucleo/hooks/usePedidosData';
import { clickable } from '@nucleo/utils/clickable';
import { esCargoDeSupervision } from '@nucleo/utils/decisionDiferencia';
import { dialogoDiferido } from '@nucleo/utils/dialogoDiferido';
import { electrolitFueraDeEspeciales } from '@nucleo/utils/cajasEspeciales';
import { hora12 } from '@nucleo/utils/hora';

/* Los once diálogos se bajan al ABRIRLOS, no al entrar a la pestaña: abrir
 * Pedidos descargaba RecepcionModal (1,959 líneas), CrearRutaModal (812),
 * RutaMapModal (565) y FinalizarCajasModal (516) —entre otros— para ver una
 * lista. 123 → 78 kB gzip. El porqué y el latch de montado, en
 * `src/utils/dialogoDiferido.jsx`; los sitios donde se usan no cambiaron. */
const RecepcionModal        = dialogoDiferido(() => import('./RecepcionModal'));
const LlegadaModal          = dialogoDiferido(() => import('./LlegadaModal'));
const ReenvioLlegadaModal   = dialogoDiferido(() => import('./ReenvioLlegadaModal'));
const FinalizarCajasModal   = dialogoDiferido(() => import('./FinalizarCajasModal'));
const CrearRutaModal        = dialogoDiferido(() => import('./CrearRutaModal'));
const RutaMapModal          = dialogoDiferido(() => import('./RutaMapModal'));
const ProgramarEntregaModal = dialogoDiferido(() => import('./ProgramarEntregaModal'));
const DevolverModal         = dialogoDiferido(() => import('./DevolverModal'));
const PauseModal            = dialogoDiferido(() => import('./tabpedidos/PauseModal'));
const AnularModal           = dialogoDiferido(() => import('./tabpedidos/AnularModal'));
const ApoioScanModal        = dialogoDiferido(() => import('./tabpedidos/ApoioScanModal'));

// ─── Constants ───────────────────────────────────────────────────────────────

// La tabla de color por sucursal vivía duplicada acá y en
// `tabpedidos/constants.js`. Se queda la de constants (la usa `SucPill`, que
// es quien pinta el chip); ésta no la usaba nadie. (2026-07-28, D3.5)
//
// Con el estado y el fetch ya extraídos al hook (bloque 6.C) quedaron acá,
// sin usar, `PAGE_SIZE`, `MINI_PAGE`, `DONE_STATUSES`, `STAGE_CONFIG` y
// `COLOR_CLS` — más 23 imports. Se van: una tabla de estados que nadie lee es
// la que después alguien actualiza creyendo que cambia algo.

// El estado del pedido, como variante del canónico `Badge`. Era un par
// bg/texto/borde escrito a mano por estado y pintado en un `<span>` con
// `rounded-full` fijo: o sea un badge que no seguía al tema (en Solid la forma
// es tensa, no redonda) y que se saltaba el contraste que `Badge` ya resuelve.
const PEDIDO_BADGE = {
    confirmado: { label: 'Por despachar',   variant: 'chart-1' },
    enviado:    { label: 'En ruta',         variant: 'chart-3' },
    parcial:    { label: 'Con diferencias', variant: 'warning' },
    completado: { label: 'Completado',      variant: 'success' },
    anulado:    { label: 'Anulado',         variant: 'danger'  },
};

// La etiqueta de la tarjeta dice en qué paso va LA SALA, el mismo que marca
// su avance (2026-10-07). Salía sólo de `estadoDeLaSala` —cinco valores— y
// por eso una sala que ya había recibido sus cajas, o a la que el conductor
// ya le entregó, seguía diciendo «En ruta» con el avance en «Llegada». Los
// tres estados que NO son un paso (anulado, con diferencias, completado)
// siguen mandando; para lo demás manda la etapa.
const ETIQUETA_ETAPA = {
    sin_iniciar: { label: 'Por preparar',         variant: 'neutral' },
    preparando:  { label: 'En preparación',       variant: 'chart-1' },
    preparado:   { label: 'Listo para despachar', variant: 'chart-1' },
    transito:    { label: 'En ruta',              variant: 'chart-3' },
    contando:    { label: 'Recibiendo',           variant: 'chart-9' },
    erp:         { label: 'Completado',           variant: 'success' },
};
// El color del estado como texto (vista lista). Literales: Tailwind escanea.
const TEXTO_VARIANTE = {
    neutral: 'text-content-2', danger: 'text-danger-text', warning: 'text-warning-text', success: 'text-success-text',
    'chart-1': 'text-chart-1-text', 'chart-3': 'text-chart-3-text', 'chart-9': 'text-chart-9-text',
};
function etiquetaDeLaSala(estadoSala, stage, entregada, difsPendientes = 0) {
    if (estadoSala === 'anulado') return PEDIDO_BADGE.anulado;
    // «Completado» con «2 difs. pendientes» al lado se contradecía.
    if (difsPendientes > 0 || estadoSala === 'parcial') return PEDIDO_BADGE.parcial;
    if (estadoSala === 'completado') return PEDIDO_BADGE.completado;
    if (stage === 'transito' && entregada) return { label: 'Entregado', variant: 'chart-9' };
    return ETIQUETA_ETAPA[stage] ?? PEDIDO_BADGE[estadoSala] ?? { label: estadoSala, variant: 'neutral' };
}

// PAUSE_REASONS: extraído a ./tabpedidos/constants.js (Bloque 6.C) —
// importado arriba.

// ─── Helpers ─────────────────────────────────────────────────────────────────

// fmtMin, elapsed, fmtEntrega, fmtRelative, getBranchStage, calcSolicitado,
// fmtRegla, currentMonthRange: extraídos a ./tabpedidos/helpers.js (Bloque
// 6.C) — importados arriba (calcSolicitado y fmtRegla solo se usan dentro
// de los componentes ya extraídos, no hace falta reimportarlos acá).

// ItemSection/ItemSections, LifecycleTimeline/PauseBadge, DifSection,
// PostCompletionSection, ReceptionActions, FilterPill: extraídos a
// ./tabpedidos/ (Bloque 6.C) — importados arriba.

// ─── Main component ───────────────────────────────────────────────────────────
// Bloque 6.C (continuación): el estado/fetch de este componente vive en el
// hook usePedidosData (./tabpedidos/usePedidosData.js) — mismos nombres,
// misma lógica, extracción mecánica. Este archivo queda solo con el JSX.
export default function TabPedidos({ searchTerm = '', vista = 'tarjetas' }) {
    const { hasPermission, isSU } = useAuth();
    // `pedidos_descargar` gatea la REIMPRESIÓN de un pedido ya generado, no la
    // impresión que sale al generarlo: esa es el entregable del flujo de bodega
    // —el papel con el que se arman las cajas— y bloquearla dejaría el pedido
    // hecho y sin hoja. El permiso se llama "Reimprimir el pedido" por eso.
    const canDownload = hasPermission('pedidos_descargar');
    // { pedidoId, sucId, item, opcion, nota } — el renglón cuya foto falta.
    const [devolverModal, setDevolverModal] = React.useState(null);
    // Qué ruta está siendo movida ahora mismo. Sin esto, dos toques seguidos en
    // «Iniciar» mandan DOS avisos de salida a cada sala de la ruta — el aviso ya
    // se fue y no se puede retirar. Es por ruta y no una bandera global porque
    // un conductor puede tener varias en pantalla.
    const [rutaOcupada, setRutaOcupada] = React.useState(null);
    const {
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
        handleProponerConFoto,
        handleMoverDevolucion,
        handleProbarDevolucion,
        handleRecibirDevolucion,
        handleDecidirDiferencia,
        handleConfirmarLlegadaDiferencia,
        filterOptions,
        hasObservacion,
        pedidoStageMap,
        filteredRows,
        sucursalCounts,
        renderGroups,
    } = usePedidosData({ searchTerm });

    // Supervisión es el CARGO, no el alcance. Bodega tiene alcance «todas las
    // salas» sobre Pedidos y NO es supervisión: confundirlos le daba el turno de
    // la sala (medido el 2026-08-17). La base decide igual con
    // `auth_es_supervision()`; acá sólo se elige qué botón se pinta.
    const esSupervision = esCargoDeSupervision(user?.rango);

    // Dónde se pega el encabezado de los pasos (vista lista): justo debajo del
    // encabezado de la vista, que también es pegajoso y cuyo alto cambia con
    // la densidad y las pestañas. Se MIDE en vez de adivinarse.
    const [topEncabezado, setTopEncabezado] = React.useState(96);
    // Cuánto sobresale la barra de la página a cada lado de la lista: pegado,
    // el encabezado toma ESE ancho para leerse como su continuación.
    const [alas, setAlas] = React.useState({ izq: 0, der: 0 });
    const listaRef = React.useRef(null);
    React.useLayoutEffect(() => {
        if (vista !== 'lista') return undefined;
        const hdr = document.querySelector('[data-surface="page-header"]');
        if (!hdr) return undefined;
        const medir = () => {
            const top = parseFloat(getComputedStyle(hdr).top) || 0;
            const r = hdr.getBoundingClientRect();
            setTopEncabezado(Math.round(top + r.height));
            const l = listaRef.current?.getBoundingClientRect();
            if (l) setAlas({ izq: Math.max(0, Math.round(l.left - r.left)), der: Math.max(0, Math.round(r.right - l.right)) });
        };
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(hdr);
        if (listaRef.current) ro.observe(listaRef.current);
        return () => ro.disconnect();
    }, [vista, loading]);

    // Pegado (2026-10-08): al quedar fijo, el encabezado de columnas SALE de
    // debajo de la barra de la página —se desliza desde ella— y se pega a su
    // borde sin esquinas arriba, así se lee como una sola pieza. El centinela
    // de altura 0 justo antes dice cuándo pasó: cuando cruza el borde de la
    // barra. Va por la Web Animations API y no por una clase: la animación es
    // de un instante (el cruce), no un estado.
    const centinelaRef = React.useRef(null);
    const encabezadoRef = React.useRef(null);
    const [pegado, setPegado] = React.useState(false);
    React.useEffect(() => {
        const c = centinelaRef.current;
        if (vista !== 'lista' || !c) return undefined;
        const io = new IntersectionObserver(([e]) => {
            setPegado(!e.isIntersecting && e.boundingClientRect.top < topEncabezado + 1);
        }, { rootMargin: `-${topEncabezado + 1}px 0px 0px 0px`, threshold: 0 });
        io.observe(c);
        return () => io.disconnect();
    }, [vista, topEncabezado, loading]);
    React.useEffect(() => {
        const el = encabezadoRef.current;
        if (!pegado || !el?.animate) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        // Duración y curva del reloj del portal (`--dur-slow`, `--ease-spring`).
        const css = getComputedStyle(el);
        const dur = parseFloat(css.getPropertyValue('--dur-slow')) || 300;
        el.animate(
            [{ transform: 'translateY(-100%)', opacity: 0.4 }, { transform: 'translateY(0)', opacity: 1 }],
            { duration: dur, easing: css.getPropertyValue('--ease-spring').trim() || 'ease-out' },
        );
    }, [pegado]);

    // Al abrir una fila, se CENTRA ya abierta (2026-10-08). Se espera a que
    // lleguen sus productos —es lo que le cambia la altura— y a un cuadro más
    // para medirla ya pintada. Si abierta no cabe, va arriba, bajo el
    // encabezado pegajoso, para que se lea desde el principio.
    const abiertaCargada = expanded ? Boolean(items[expanded]) : false;
    React.useEffect(() => {
        if (!expanded) return undefined;
        const id = requestAnimationFrame(() => requestAnimationFrame(() => {
            const el = document.querySelector(`[data-fila-pedido="${expanded}"]`);
            if (!el) return;
            const reducir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            const libre = window.innerHeight - topEncabezado - 64;
            el.style.scrollMarginTop = `${topEncabezado + 64}px`;
            el.scrollIntoView({ block: el.offsetHeight > libre ? 'start' : 'center', behavior: reducir ? 'auto' : 'smooth' });
        }));
        return () => cancelAnimationFrame(id);
    }, [expanded, abiertaCargada, topEncabezado]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="py-20"><SkeletonText lines={5} /></div>
        );
    }

    // ── Vista LISTA (en prueba, 2026-10-07) ──────────────────────────────
    // Una fila por sala, agrupadas por lo que toca hacer. Usa las MISMAS
    // piezas que la tarjeta (`datosJSX`, `accionesJSX`, `seccionesJSX`), así
    // que botones, condiciones, recepción y diferencias son idénticos: sólo
    // cambia cómo se dibuja. Cerrada: sala, avance, estado y la acción
    // principal. Abierta: lo mismo que la tarjeta abierta.
    const renderFilaLista = ({ row, cardKey, isExp, stage, etiqueta, tiempoEnEtapa, rtStop, rtCond,
        prepApoyo, recepApoyo, faltan, difsDeLaSala, datosJSX, accionesJSX, seccionesJSX }) => {
        // El estado se marca con una FRANJA fina a la izquierda, no con el borde
        // entero: con tres filas con problema seguidas, el borde rojo de cada
        // una dominaba la pantalla (lo pidió el usuario, 2026-10-07).
        // Ni borde de color ni franja lateral (el canon prohíbe la franja a un
        // lado de una tarjeta): lo que tiene problema lleva un ÍCONO junto al
        // nombre de la sala, en el color del problema.
        const danadas = Array.isArray(row.cajas_danadas) ? row.cajas_danadas : [];
        const marca = stage === 'pausado' ? { Icono: Pause, cls: 'text-warning-text', txt: 'En pausa' }
            // Con el reenvío ya en camino no hay nada que resolver: se espera.
            : faltan.enCamino ? { Icono: Truck, cls: 'text-brand-text', txt: 'Reenvío en camino' }
            : (faltan.hay || difsDeLaSala > 0) ? { Icono: AlertTriangle, cls: 'text-danger-text', txt: 'Con problema' }
            : danadas.length > 0 ? { Icono: AlertTriangle, cls: 'text-warning-text', txt: 'Caja dañada' }
            : null;
        // Sin el agrupamiento por ruta de la tarjeta, la fila dice en cuál va.
        const rutaDeLaFila = stage === 'transito' ? pedidoRutaMap.get(claveParada(row.pedido_id, row.erp_sucursal_id))?.ruta : null;
        return (
            <div key={cardKey} data-fila-pedido={cardKey} data-surface="card" className="select-none"
                {...clickable(() => toggleExpand(cardKey, row.pedido_id, row.erp_sucursal_id), { label: `Pedido ${row.codigo ?? row.numero}` })}
                aria-expanded={isExp}>
                <div className="grid items-center gap-x-5 gap-y-2 pl-4 pr-3 py-3.5 grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[9rem_minmax(24rem,1fr)_17rem_1rem]">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-body font-bold text-content leading-tight min-w-0">
                            {marca && <marca.Icono size={14} className={`shrink-0 ${marca.cls}`} aria-label={marca.txt} />}
                            <span className="truncate">{ERP_NAMES[row.erp_sucursal_id] ?? `Sucursal ${row.erp_sucursal_id}`}</span>
                        </div>
                        <div className="text-caption text-content-3 tabular-nums truncate">{row.codigo ?? `#${row.numero}`}</div>
                    </div>
                    {/* Abierta o cerrada, la línea se queda en SU columna: así sus
                        puntos siguen bajo los nombres del encabezado (a todo el
                        ancho se desalineaba). Abierta, crece hacia abajo con la
                        hora y la persona de cada paso. */}
                    <div className={`hidden lg:block min-w-0 self-start ${isExp ? 'pb-1' : ''}`}>
                        <AvanceCompacto row={row} stage={stage} rutaStop={rtStop} conductor={rtCond} rotulos="activo"
                            detalle={isExp} quien={id => empMap.get(id) ?? null}
                            apoyo={{ bodega: prepApoyo, sala: recepApoyo }} />
                    </div>
                    {/* El estado como TEXTO con su color, sin pastilla: la
                        pastilla repetía lo que ya dice el paso en curso, y
                        era la mitad del ruido de la fila. */}
                    {/* Estado y acción comparten UNA columna (estado a la izquierda,
                        botón a la derecha). Eran dos columnas fijas y en las filas
                        sin botón la de la acción quedaba vacía: ese ancho ahora es
                        de la línea de pasos. En el teléfono, `contents` deja que
                        cada uno vaya a su lugar de siempre. */}
                    <div className="contents lg:flex lg:items-center lg:gap-3 lg:min-w-0">
                    <div className="flex flex-col items-end lg:items-start gap-0.5 min-w-0 lg:flex-1">
                        <span className={`text-body-sm font-semibold truncate max-w-full ${TEXTO_VARIANTE[stage === 'pausado' ? 'warning' : etiqueta.variant] ?? 'text-content-2'}`}>
                            {stage === 'pausado' ? 'Pausado' : etiqueta.label}
                        </span>
                        {/* Hasta dos renglones y nunca debajo del botón: con `items-start`
                            el texto medía lo que su contenido y `truncate` no
                            cortaba (lo tapaba el botón). `max-w-full` lo ata a la
                            columna. */}
                        <span className={`text-caption tabular-nums max-w-full line-clamp-2 break-words ${stage === 'pausado' ? 'text-warning-text' : 'text-content-3'}`}>
                            {faltan.porDespachar ? 'Reenvío por salir'
                                : faltan.enCamino ? `Reenvío en camino: ${describirFaltantes(faltan).join(' · ') || 'cajas faltantes'}`
                                : faltan.hay ? `Falta: ${describirFaltantes(faltan).join(' · ')}`
                                : danadas.length > 0 ? `Dañada${danadas.length > 1 ? 's' : ''}: ${danadas.map(n => `#${n}`).join(', ')}`
                                : stage === 'preparado' && row.entrega_programada_at ? `Sale ${fmtEntrega(row.entrega_programada_at).replace(/^\p{Lu}/u, c => c.toLowerCase())}`
                                : difsDeLaSala > 0 ? `${difsDeLaSala} diferencia${difsDeLaSala > 1 ? 's' : ''} por resolver`
                                : [rutaDeLaFila ? `Ruta #${rutaDeLaFila.numero}` : null, tiempoEnEtapa ?? fmtRelative(row.enviado_at ?? row.created_at)].filter(Boolean).join(' · ')}
                        </span>
                    </div>
                    {/* `empty:hidden`: sin acción, en el teléfono no queda un
                        renglón vacío. */}
                    {/* Columnas de ancho FIJO: así los puntos de todas las filas
                        caen bajo los nombres del encabezado. Por eso, abierta, la
                        barra completa de acciones baja al detalle. */}
                    <div className="col-span-2 lg:col-span-1 lg:shrink-0 flex items-center justify-end gap-1.5 flex-wrap empty:hidden" onClick={e => e.stopPropagation()}>
                        {!isExp && accionesJSX}
                    </div>
                    </div>
                    {/* La flecha sólo en escritorio: en el teléfono la fila
                        entera se toca para abrirla. */}
                    <span className="hidden lg:flex text-content-3" aria-hidden="true">
                        {isExp ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                </div>
                {/* Recepción y diferencias se abren con la fila: la fila ya
                    dice «Falta…» o «N diferencias por resolver». */}
                {isExp && seccionesJSX}
                {isExp && (
                    <div className="border-t border-divider" onClick={e => e.stopPropagation()}>
                        {/* La línea con hora y persona ya está ARRIBA, en la fila.
                            En el teléfono la fila no la muestra, así que va acá. */}
                        <div className="lg:hidden px-3 pt-2 pb-1">
                            <AvanceCompacto row={row} stage={stage} rutaStop={rtStop} conductor={rtCond} rotulos="siempre"
                                detalle quien={id => empMap.get(id) ?? null} apoyo={{ bodega: prepApoyo, sala: recepApoyo }} />
                        </div>
                        <div className="flex items-center gap-x-3 gap-y-2 flex-wrap pl-4 pr-3 pt-3 pb-3">
                            <div className="flex items-center gap-1 flex-wrap min-w-0">{datosJSX}</div>
                            <div className="ml-auto flex items-center gap-1.5 flex-wrap">{accionesJSX}</div>
                        </div>
                        <ItemSections allItems={items[cardKey] ?? []} loading={loadingItems && !items[cardKey]} canEditMinMax={canEditMinMax} />
                    </div>
                )}
            </div>
        );
    };

    // Los grupos de la lista: «¿qué toca hacer?», en orden de urgencia. Lo que
    // tiene un problema abierto va primero, sea cual sea su etapa.
    const GRUPOS_LISTA = [
        { key: 'problemas',   label: 'Con problemas',     Icono: AlertTriangle, tono: 'text-danger-text' },
        { key: 'pausado',     label: 'En pausa',          Icono: Pause,         tono: 'text-warning-text' },
        { key: 'sin_iniciar', label: 'Por preparar',      Icono: ClipboardList, tono: 'text-content' },
        { key: 'preparando',  label: 'En preparación',    Icono: Package,       tono: 'text-content' },
        { key: 'preparado',   label: 'Listos para salir', Icono: PackageCheck,  tono: 'text-content' },
        { key: 'transito',    label: 'En camino',         Icono: Truck,         tono: 'text-content' },
        { key: 'contando',    label: 'En la sala',        Icono: Store,         tono: 'text-content' },
        { key: 'erp',         label: 'Completados',       Icono: CheckCircle2,  tono: 'text-content-3' },
    ];
    const grupoDeLaFila = (row) => {
        const ck = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
        const f = faltantesDeLaSala(row);
        if ((f.hay && !f.enCamino) || (cardStats[ck]?.sinResolver ?? 0) > 0) return 'problemas';
        return getBranchStage(row);
    };

    const renderSala = (row) => {
                            const stage      = getBranchStage(row);
                            const estadoSala = estadoDeLaSala(row);
                            // Lo que no llegó, de una sola fuente para la etiqueta,
                            // el aviso de la sala y el botón de reenvío.
                            const faltan     = faltantesDeLaSala(row);
                            const cardKey    = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
                            // De la MISMA fuente que el orden del tablero: la
                            // stat que calcula la base. Antes se contaba sobre
                            // los renglones cargados, que llegan un momento
                            // después — el chip aparecía de golpe. Y con dos
                            // cuentas de la misma cosa, la lista y la tarjeta
                            // podían decir distinto.
                            const difsDeLaSala = cardStats[cardKey]?.sinResolver ?? 0;
                            const isExp      = expanded === cardKey;
                            const lcKey      = `lc_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isLCBusy   = busyLifecycle === lcKey;

                            const canActuar = canEdit && !isBranch; // GESTIONAR + Alcance TODOS
                            // La sala de ESTA tarjeta — ver el bloque de Recepción más abajo.
                            const sucDeLaTarjeta = row.erp_sucursal_id ?? erpSucursalId;

                            // Preparar y despachar son de la SALA — `puedePrepararse` /
                            // `puedeDespacharse` (./tabpedidos/helpers), que es donde están
                            // probadas y por qué.
                            const canIniciar       = canActuar && !isBranch && puedePrepararse(row);
                            const canPausar        = canActuar && !isBranch && stage === 'preparando';
                            const canReanudar      = canActuar && !isBranch && stage === 'pausado';
                            // Botón aparece por sucursal cuando esa ya está lista (preparado), sin esperar a las demás
                            const canMarcarEnRuta  = canActuar && !isBranch && puedeDespacharse(row);

                            const creator      = row.created_by               ? empMap.get(row.created_by)               : null;
                            const iniciador    = row.iniciado_por             ? empMap.get(row.iniciado_por)             : null;
                            const finalizador  = row.finalizado_por           ? empMap.get(row.finalizado_por)           : null;
                            const enviador     = row.enviado_por              ? empMap.get(row.enviado_por)              : null;
                            const llegadaEmp   = row.llegada_fisica_por       ? empMap.get(row.llegada_fisica_por)       : null;
                            const conteoEmp    = row.conteo_por               ? empMap.get(row.conteo_por)               : null;
                            const erpEmp       = row.recibido_erp_por         ? empMap.get(row.recibido_erp_por)         : null;
                            const difsEmp      = row.diferencias_reportadas_por ? empMap.get(row.diferencias_reportadas_por) : null;
                            const corrConfEmp  = row.confirmado_correccion_por  ? empMap.get(row.confirmado_correccion_por)  : null;
                            const reenvioEmp   = row.reenvio_por                ? empMap.get(row.reenvio_por)                : null;

                            const elapsedPrep  = stage === 'preparando' ? fmtMin(Math.max(0, (elapsed(row.iniciado_at) ?? 0) - (row.min_pausado_total ?? 0))) : null;
                            const elapsedPause = stage === 'pausado'    ? fmtMin(elapsed(row.pausado_at)) : null;
                            const elapsedTrans = stage === 'transito'   ? fmtMin(elapsed(row.finalizado_at)) : null;

                            // La parada de esta sala en su ruta: dice si ya la entregaron.
                            const paradaSala = pedidoRutaMap.get(claveParada(row.pedido_id, sucDeLaTarjeta))?.stop
                                ?? entregaMap[cardKey] ?? null;
                            const entregada  = !!paradaSala?.entregado_at;
                            const etiqueta   = etiquetaDeLaSala(estadoSala, stage, entregada, difsDeLaSala);
                            const tiempoEnEtapa = elapsedPrep  ? `${elapsedPrep} preparando`
                                                : elapsedPause ? `${elapsedPause} en pausa`
                                                : elapsedTrans && !entregada ? `${elapsedTrans} en ruta`
                                                : null;

                            const apoyoBucket  = apoyoMap[cardKey] ?? { preparacion: [], recepcion: [] };
                            const prepApoyo    = apoyoBucket.preparacion ?? [];
                            const recepApoyo   = apoyoBucket.recepcion   ?? [];

                            // En la lista, lo secundario aparece al abrir la fila.
                            const verSecundarias = vista !== 'lista' || isExp;
                            const canFinalizar = canActuar && !isBranch && stage === 'preparando';

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

                            // Anular SÍ es del pedido —se anula entero, no una sala— así que
                            // acá `pedido_status` es lo correcto: si alguna sala ya salió, el
                            // pedido no se anula. Es la única de estas guardas que se queda.
                            const canAnular = canActuar && !isBranch
                                && row.pedido_status === 'confirmado'
                                && !(pedidoStageMap.get(row.pedido_id)?.anyFinalized);

                            // Solo fade cuando completado: parcial queda visible (pendiente corrección)
                            // …salvo que le falte algo: «Completado» con una caja sin
                            // llegar no es un pedido cerrado, y apagarlo lo escondía.
                            const isFadedOut = row.pedido_status === 'completado' && !!row.recibido_erp_at && !faltan.hay;  // sutil: solo baja un poco la opacidad

                                            const rutaInfo = pedidoRutaMap.get(claveParada(row.pedido_id, sucDeLaTarjeta));
                                            const entrega  = entregaMap[cardKey] ?? null;
                                            const rtStop   = rutaInfo?.stop ?? entrega ?? null;
                                            const condId   = rutaInfo?.ruta?.conductor_id ?? entrega?.ruta?.conductor_id ?? null;
                                            const rtCond   = condId ? empMap.get(condId) ?? null : null;

                            // Las piezas que comparten las dos formas de dibujar la sala
                            // (tarjeta y lista, 2026-10-07): mismos datos, mismos botones
                            // con las mismas condiciones, mismas secciones.
                            const datosJSX = (<>
                                        {/* Lo que dice la base de esta sala: enviados, sistema, inventario. */}
                                        {cardStats[cardKey] && (
                                            <>
                                            <Badge uppercase={false}>{cardStats[cardKey].enviados} {['sin_iniciar', 'preparando', 'preparado', 'pausado'].includes(stage) ? 'productos' : 'enviados'}</Badge>
                                            {(() => {
                                                // El traslado al sistema. Sólo se pinta si el
                                                // pedido llegó a intentarlo: en los que se
                                                // despacharon a mano no hay nada que decir.
                                                const tr = trasladoStats?.[cardKey];
                                                if (!tr) return null;
                                                const nHall = Array.isArray(tr.hallazgos) ? tr.hallazgos.length : 0;
                                                if (tr.estado === 'despachado') return (
                                                    <Badge variant={nHall > 0 ? 'warning' : 'success'} uppercase={false}>
                                                        {nHall > 0 ? `en el sistema · ${nHall} con aviso` : 'en el sistema'}
                                                    </Badge>
                                                );
                                                if (tr.estado === 'en_curso') return (
                                                    <Badge variant="chart-3" uppercase={false}>saliendo al sistema…</Badge>
                                                );
                                                if (tr.estado === 'error') return (
                                                    <Badge variant="danger" uppercase={false}>no salió al sistema</Badge>
                                                );
                                                return null;
                                            })()}
                                            {(() => {
                                                // ¿Lo confirmado llegó al inventario? Es la otra
                                                // mitad del circuito y la que puede fallar sola: el
                                                // ingreso va en su propio try para no deshacer un
                                                // conteo ya guardado, así que «lo conté y NO entró»
                                                // existe por diseño. Hasta acá el único aviso era un
                                                // toast que se va solo, y es el ÚNICO estado que deja
                                                // a la sala sin poder facturar.
                                                const ing = ingresoStats?.[cardKey];
                                                if (!ing || !ing.lineas) return null;
                                                // Está entrando AHORA: la sala confirmó y se fue, y
                                                // el ingreso sigue solo. Mientras dure, el rojo de
                                                // «sin ingresar» sería un susto y su reintento una
                                                // carrera contra algo que ya está en marcha.
                                                if (ingresoEnCurso?.[cardKey] && ing.sin_ingresar > 0) return (
                                                    <Badge variant="chart-3" uppercase={false}>entrando al inventario…</Badge>
                                                );
                                                if (ing.sin_ingresar > 0) return (
                                                    <>
                                                        <Badge variant="danger" icon={AlertTriangle} uppercase={false}>
                                                            {ing.sin_ingresar} sin ingresar
                                                        </Badge>
                                                        {canEdit && (
                                                            <Button
                                                                variant="secondary" size="xs" icon={RefreshCw}
                                                                disabled={busyAction === 'ingreso'}
                                                                title="Vuelve a ingresar al inventario sólo lo que ya se contó y no entró"
                                                                onClick={() => handleReintentarIngreso(row.pedido_id, row.erp_sucursal_id)}
                                                            >Reintentar</Button>
                                                        )}
                                                    </>
                                                );
                                                // El verde también se dice: es la única señal de que
                                                // el circuito cerró, y sin ella «no hay aviso» y
                                                // «entró todo» se ven igual.
                                                if (ing.ingresadas > 0) return (
                                                    <Badge variant="success" uppercase={false}>
                                                        {ing.ingresadas} en el inventario
                                                    </Badge>
                                                );
                                                return null;
                                            })()}
                                            {(cardStats[cardKey].agotamiento ?? 0) > 0 && (
                                                <Badge uppercase={false}>{cardStats[cardKey].agotamiento} stock insuf.</Badge>
                                            )}
                                            {cardStats[cardKey].sinStock > 0 && (
                                                <Badge uppercase={false}>{cardStats[cardKey].sinStock} sin stock</Badge>
                                            )}
                                            {cardStats[cardKey].porRegla > 0 && (
                                                <Badge icon={AlertTriangle} uppercase={false}>{cardStats[cardKey].porRegla} por regla</Badge>
                                            )}
                                        </>
                                        )}
                                        {row.total_cajas > 0 && (
                                            <Badge icon={Box} uppercase={false}>{row.total_cajas} caja{row.total_cajas !== 1 ? 's' : ''}</Badge>
                                        )}
                                        {/* Sólo las que NO son además caja especial: si no,
                                            las mismas cuatro cajas salían dos veces —«4
                                            Electrolit» y «4 cajas especiales»— y la tarjeta
                                            aparentaba ocho. Misma cuenta que usa el modal de
                                            llegada, para que no vuelvan a discrepar. */}
                                        {electrolitFueraDeEspeciales(row.cajas_electrolit, row.cajas_especiales) > 0 && (
                                            <Badge icon={Inbox} uppercase={false}>{electrolitFueraDeEspeciales(row.cajas_electrolit, row.cajas_especiales)} Electrolit</Badge>
                                        )}
                                        {row.electrolit_ok === false && (
                                            <Badge icon={Zap} uppercase={false}>{(row.electrolit_faltantes ?? 0) > 0
                                                    ? `${row.electrolit_faltantes} Electrolit faltante${row.electrolit_faltantes > 1 ? 's' : ''}`
                                                    : 'Electrolit faltante'}</Badge>
                                        )}
                                        {(row.cajas_especiales ?? []).length > 0 && (
                                            <Badge icon={Star} uppercase={false}>{row.cajas_especiales.length} caja{row.cajas_especiales.length > 1 ? 's' : ''} especial{row.cajas_especiales.length > 1 ? 'es' : ''}</Badge>
                                        )}
                                        {(row.cajas_danadas ?? []).length > 0 && (
                                            <Badge variant="warning" icon={AlertTriangle} uppercase={false}>Dañada{row.cajas_danadas.length > 1 ? 's' : ''}: {row.cajas_danadas.map(n => `#${n}`).join(', ')}</Badge>
                                        )}
                                        {(row.falta_cajas ?? []).length > 0 && (
                                            // Con el reenvío en la calle deja de ser un pendiente: se espera.
                                            faltan.enCamino
                                                ? <Badge variant="info" icon={Truck} uppercase={false}>Reenvío en camino: {row.falta_cajas.map(n => `#${n}`).join(', ')}</Badge>
                                                : <Badge variant="danger" icon={Package} uppercase={false}>Faltante{row.falta_cajas.length > 1 ? 's' : ''}: {row.falta_cajas.map(n => `#${n}`).join(', ')}</Badge>
                                        )}
                                        {/* La caja especial que no llegó, con su producto. Sin
                                            esta etiqueta, el único rastro era el botón rojo de
                                            reenvío: bodega veía que había que mandar algo y no
                                            qué (pedido #178, Salud 4). */}
                                        {faltan.especiales.map(e => (
                                            <Badge key={`esp-${e.label}`} variant="danger" icon={Star} uppercase={false}>
                                                Faltante: {e.producto ? `${e.label} · ${e.producto}` : e.label}
                                            </Badge>
                                        ))}
                                        {/* Lo que bodega decidió no reenviar. Ya no es un
                                            pendiente —por eso gris—, pero sin esta línea la
                                            caja simplemente desaparecía de la tarjeta y la
                                            sala no sabía si seguía esperándola. */}
                                        {Object.entries(row.cajas_especiales_llegadas ?? {})
                                            .filter(([, v]) => v === 'no_reenviada')
                                            .map(([label]) => {
                                                const producto = (Array.isArray(row.cajas_especiales) ? row.cajas_especiales : []).find(c => c?.label === label)?.product_name;
                                                return (
                                                    <Badge key={`noreenv-${label}`} variant="neutral" icon={Star} uppercase={false}>
                                                        No se reenvió: {producto ? `${label} · ${producto}` : label}
                                                    </Badge>
                                                );
                                            })}
                                        {/* De ESTA sala y sin resolver — ver `difsSinResolver`.
                                            Con `pedido_status === 'parcial'` decía «Difs.
                                            pendientes» sobre Salud 5 con su única diferencia
                                            cerrada: la viva era de La Popular, la otra sala del
                                            mismo pedido. Es el mismo defecto que ya costó el
                                            rótulo de arriba (`estadoDeLaSala`). */}
                                        {faltan.porDespachar && (
                                            <Badge variant="warning" icon={RotateCcw} uppercase={false}>Reenvío por despachar</Badge>
                                        )}
                                        {difsDeLaSala > 0 && !(row.cajas_danadas?.length > 0 || row.falta_cajas?.length > 0) && (
                                            <Badge icon={ClipboardList} uppercase={false}>
                                                {difsDeLaSala === 1 ? '1 dif. pendiente' : `${difsDeLaSala} difs. pendientes`}
                                            </Badge>
                                        )}
                            </>);
                            const accionesJSX = (<>
                                            {/* Anular va PRIMERO y separado: es irreversible, y junto
                                                a Finalizar o Iniciar —el botón que más se aprieta— un
                                                clic de más anulaba el pedido. Sigue en rojo (§15.2: una
                                                acción irreversible no se atenúa). */}
                                            {verSecundarias && canAnular && (
                                                <Button variant="destructive" icon={Ban} className="mr-2" onClick={e => { e.stopPropagation(); const st = pedidoStageMap.get(row.pedido_id) ?? {}; setAnularModal({ pedidoId: row.pedido_id, numero: row.numero, requiresReason: !!(st.anyActive) }); }}>Anular</Button>
                                            )}
                                            {/* El botón se pedía además con `!isApoyoBodega`,
                                                o sea «que YO no esté ya de apoyo» — y esto
                                                no es «me apunto»: abre el escáner y anota a
                                                QUIEN SEA. En Bodega, el primero que pasaba
                                                su carné hacía desaparecer el botón de la
                                                tarjeta y ya no se podía anotar a nadie más
                                                (probado en sala el 2026-08-17: un apoyo a
                                                las 15:59 y ni un intento después). El
                                                gemelo de recepción nunca tuvo esa condición.
                                                Los repetidos los frena el modal, que para
                                                eso recibe `existingApoyo`. */}
                                            {verSecundarias && canApoyo && (
                                                <Button variant="secondary" icon={UserPlus} disabled={isLCBusy} onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey, tipo: 'preparacion' })}>Apoyo</Button>
                                            )}
                                            {/* `icon` + `loading` del canónico, en vez de armar
                                                el intercambio ícono/spinner a mano en cada
                                                botón: `Button` ya lo hace, y además apaga el
                                                click y marca `aria-busy` mientras corre. */}
                                            {verSecundarias && canActuar && canDownload && (
                                                <Button variant="secondary" icon={FileDown} loading={printingPdf === row.pedido_id} onClick={e => { e.stopPropagation(); handlePrintPdf(row.pedido_id, row.numero, row.erp_sucursal_id, cardKey, row.codigo); }}>PDF</Button>
                                            )}
                                            {verSecundarias && canActuar && !isBranch && stage === 'preparado' && (
                                                <Button
                                                    variant="secondary"
                                                    icon={CalendarClock}
                                                    onClick={e => { e.stopPropagation(); setProgramarModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, currentAt: row.entrega_programada_at ?? null, historial: row.entrega_programada_historial ?? [] }); }}
                                                >
                                                    {row.entrega_programada_at ? fmtEntrega(row.entrega_programada_at) : 'Programar'}
                                                </Button>
                                            )}
                                            {/* Entregué — conductor, junto a PDF para ahorrar espacio */}
                                            {pedidoRutaMap.has(claveParada(row.pedido_id, row.erp_sucursal_id)) && (() => {
                                                const { ruta, stop } = pedidoRutaMap.get(claveParada(row.pedido_id, row.erp_sucursal_id));
                                                const isConductorHere = !!(user?.id && ruta.conductor_id && user.id === ruta.conductor_id);
                                                if (!isConductorHere || !!stop?.entregado_at || ruta.status !== 'en_ruta') return null;
                                                return (
                                                    <Button variant="primary" icon={CheckCircle2} onClick={e => { e.stopPropagation(); handleEntregarStop(stop.id, ruta.id, stop.erp_sucursal_id); }}>Entregué</Button>
                                                );
                                            })()}
                                            {canIniciar      && <Button variant="primary" icon={Play}      loading={isLCBusy} onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}>Iniciar</Button>}
                                            {verSecundarias && canPausar && <Button variant="secondary" icon={Pause}     loading={isLCBusy} onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}>Pausar</Button>}
                                            {canFinalizar    && <Button variant="primary" icon={Flag}      loading={isLCBusy || busyAction === `finalizar_load_${cardKey}`} onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)}>Finalizar</Button>}
                                            {canReanudar     && <Button variant="primary" icon={RotateCcw} loading={isLCBusy} onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}>Reanudar</Button>}
                                            {canMarcarEnRuta && <Button variant="primary" icon={Truck} onClick={() => setCrearRutaOpen([`${row.pedido_id}__${row.erp_sucursal_id}`])}>Crear ruta</Button>}
                                            {(() => {
                                                const rutaActiva       = pedidoRutaMap.get(claveParada(row.pedido_id, row.erp_sucursal_id))?.ruta;
                                                const conductorEnRuta  = rutaActiva?.status === 'en_ruta' && !rutaActiva?.vuelta_base_at;
                                                if (!canActuar || isBranch || !faltan.hay || faltan.enCamino) return null;
                                                // Ya se pidió el reenvío: falta la ruta. Volver a ofrecer
                                                // «Reenviar caja» abría un segundo ciclo por las mismas cajas.
                                                if (faltan.porDespachar) return (
                                                    <Button variant="primary" icon={Truck} onClick={() => setCrearRutaOpen([])}>Crear ruta</Button>
                                                );
                                                /* Era un `div` con `role="img"` —que le promete
                                                   a un lector de pantalla una imagen— y con el
                                                   motivo escondido en `title`, o sea sólo para
                                                   quien tiene puntero. Es un aviso inline: eso
                                                   es `Notice` (§15.6), y el motivo se lee. */
                                                if (conductorEnRuta) return (
                                                    <Notice variant="neutral" icon={Truck} compact>
                                                        Esperando que el conductor vuelva a base
                                                    </Notice>
                                                );
                                                return (
                                                    <Button variant="primary" icon={Truck} loading={busyAction === 'reenvio'} onClick={() => setReenviarConfirmModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, cajas: faltan.cajas, electrolits: faltan.electrolits, productos: faltan.productosEspeciales, noReenviar: [] })}>Reenviar caja</Button>
                                                );
                                            })()}
                            </>);
                            const seccionesJSX = (<>
                                    {/* Lo que no llegó, dicho a la SALA. En cuanto terminaba
                                        de contar lo demás, el bloque de Recepción se cerraba y
                                        la tarjeta decía «Completado» a secas: nada le avisaba
                                        que todavía le debían una caja (pedido #178, Salud 4).
                                        Ya reenviado no hace falta: ese aviso lo da Recepción,
                                        con su botón para confirmar la llegada. */}
                                    {isBranch && faltan.hay && !faltan.enCamino && (
                                        <div className="px-3 pb-2">
                                            <Notice variant="danger" icon={PackageX} bloque>
                                                <strong>Pendiente — no llegó:</strong>{' '}
                                                {describirFaltantes(faltan).join(' · ')}.{' '}
                                                {faltan.porDespachar
                                                    ? 'Bodega ya preparó el reenvío: sale en la próxima ruta y te llega un aviso cuando salga.'
                                                    : 'Bodega tiene que reenviarlo; te llega un aviso cuando salga.'}
                                            </Notice>
                                        </div>
                                    )}

                                    {/* Entrega estimada — visible en sucursal cuando hay programación y el pedido no ha llegado.
                                        Era una franja a sangre pegada al borde de la tarjeta:
                                        el mismo aviso que los de recepción, con otra forma. Con
                                        aquéllos ya en `Notice`, dejarla así la hacía leer como
                                        otra clase de cosa. */}
                                    {isBranch && row.entrega_programada_at && stage !== 'erp' && stage !== 'contando' && (
                                        <div className="px-3 pb-2">
                                            <Notice variant="chart-3" icon={CalendarClock} compact>
                                                Entrega estimada: <strong>{fmtEntrega(row.entrega_programada_at)}</strong>
                                            </Notice>
                                        </div>
                                    )}

                                    {/* Recepción — mientras a ESTA sala le quede algo por contar */}
                                    {/* La sucursal sobre la que se recibe es la de ESTA tarjeta, no la
                                        de quien mira. Para quien tiene alcance «su sucursal» son la
                                        misma —su listado no trae otras—, pero el bloque además estaba
                                        condicionado a `isBranch`, así que un superusuario no podía
                                        recibir por nadie: los botones no existían para él. Se abre a
                                        `isSU`, que es la misma noción que reconoce la base
                                        (`auth_is_su`), y no a cualquiera con «Gestionar»: eso le daría
                                        a bodega un poder que nadie pidió.

                                        Cuándo hay algo que contar lo decide `hayRecepcionPendiente`,
                                        que está probada: escrito acá como `pedido_status === 'enviado'`
                                        el bloque desaparecía a mitad de la recepción. */}
                                    {(isBranch || isSU) && (row.erp_sucursal_id ?? erpSucursalId) && hayRecepcionPendiente({
                                        enviadoAt: row.enviado_at,
                                        pedidoStatus: row.pedido_status,
                                        pendientes: cardStats[cardKey]?.pendientes ?? 0,
                                        reenviosHistorial: row.reenvios_historial ?? [],
                                    }) && stage !== 'erp' && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <ReceptionActions
                                                canEdit={canEdit}
                                                llegadaOk={!!llegadaStatus[cardKey] || !!row.llegada_fisica_at}
                                                erpOk={!!erpStatus[cardKey] || !!row.recibido_erp_at}
                                                llegadaEmp={llegadaEmp}
                                                erpEmp={erpEmp}
                                                pendientesCount={cardStats[cardKey]?.pendientes ?? 0}
                                                onMarkLlegada={() => handleLlegada(row.pedido_id, sucDeLaTarjeta, cardKey)}
                                                onOpenRecibir={() => openModal(row.pedido_id, row.numero, row.codigo, sucDeLaTarjeta, cardKey)}
                                                onOpenReenvioModal={() => openReenvioModal(row.pedido_id, row.numero, row.codigo, sucDeLaTarjeta, cardKey)}
                                                onSegundaLlegada={() => handleSegundaLlegada(row.pedido_id, sucDeLaTarjeta, cardKey, row.reenvios_historial ?? [], row.falta_cajas ?? [], row.caja_map ?? {})}
                                                onApoyo={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: sucDeLaTarjeta, cardKey, tipo: 'recepcion' })}
                                                busy={busyAction}
                                                llegadaTipo={row.llegada_tipo}
                                                reenviosHistorial={row.reenvios_historial ?? []}
                                                faltaCajas={row.falta_cajas ?? []}
                                                cajasDanadas={row.cajas_danadas ?? []}
                                                reenvioBodygaAt={row.reenvio_bodega_at ?? null}
                                                segundaLlegadaAt={row.segunda_llegada_at ?? null}
                                                cajasEspeciales={row.cajas_especiales ?? []}
                                                hasFaltaItems={(items[cardKey] ?? []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0)}
                                            />
                                        </div>
                                    )}

                                    {/* Diferencias — sólo si ESTA sala reportó alguna. Colgaba de
                                        `pedido_status === 'parcial'`, que es del PEDIDO: en el #174
                                        una sola diferencia de Salud 5 pintaba «Diferencias — te toca
                                        resolver (0)» en Salud 4 y La Popular, que no tenían ninguna.
                                        `diferencias_reportadas_at` es por sala y coincide con tener
                                        un renglón con diferencia en 130 de 130 salas (medido el
                                        2026-09-17). */}
                                    {row.diferencias_reportadas_at && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <DifSection
                                                row={row}
                                                difItems={(items[cardKey] ?? []).filter(r => r.status === 'con_diferencia' || r.error_tipo)}
                                                eventos={eventosMap[cardKey] ?? []}
                                                devoluciones={devolucionesMap[cardKey] ?? []}
                                                isBranch={isBranch}
                                                busyAction={busyAction}
                                                empMap={empMap}
                                                readOnly={row.pedido_status === 'completado'}
                                                onNeedItems={() => fetchItems(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                                itemsLoaded={!!items[cardKey]}
                                                esSupervision={esSupervision}
                                                onDecidirDiferencia={(itemId, accion, tipo, nota) =>
                                                    handleDecidirDiferencia(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, itemId, accion, tipo, nota)
                                                }
                                                onConfirmarLlegada={(itemId) =>
                                                    handleConfirmarLlegadaDiferencia(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, itemId)
                                                }
                                                onPedirFoto={(item, opcion, nota) =>
                                                    setDevolverModal({
                                                        pedidoId: row.pedido_id,
                                                        sucId: erpSucursalId ?? row.erp_sucursal_id,
                                                        item, opcion, nota,
                                                    })
                                                }
                                                onCorregirBodega={(nota) =>
                                                    handleCorregirBodega(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, nota)
                                                }
                                                onConfirmarCorreccion={() =>
                                                    handleConfirmarCorreccion(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id)
                                                }
                                                onProbarDevolucion={(id) =>
                                                    handleProbarDevolucion(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, id)
                                                }
                                                onMoverDevolucion={(id) =>
                                                    handleMoverDevolucion(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, id)
                                                }
                                                onRecibirDevolucion={(id) =>
                                                    handleRecibirDevolucion(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, id)
                                                }
                                            />
                                        </div>
                                    )}

                                    {/* Resumen post-completado */}
                                    {row.pedido_status === 'completado' && row.llegada_tipo && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <PostCompletionSection
                                                row={row}
                                                cardKey={cardKey}
                                                difItems={(items[cardKey] ?? []).filter(r => r.status === 'con_diferencia' || r.error_tipo)}
                                                empMap={empMap}
                                                onNeedItems={() => fetchItems(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                                itemsLoaded={!!items[cardKey]}
                                            />
                                        </div>
                                    )}

                            </>);

                            if (vista === 'lista') return renderFilaLista({
                                row, cardKey, isExp, stage, etiqueta, tiempoEnEtapa, rtStop, rtCond,
                                prepApoyo, recepApoyo, faltan, difsDeLaSala,
                                datosJSX, accionesJSX, seccionesJSX,
                            });

                            return (
                                <motion.div
                                    key={cardKey}
                                    layout
                                    initial={{ opacity: 0, scale: 0.97 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                    /* La superficie sale del canónico. Estaba escrita a
                                       mano en la const `GLASS` —repetida en tres
                                       pestañas—, y por vivir en una constante de string
                                       el gate `vidrio-a-mano` no la veía. */
                                    data-surface="card"
                                    data-fila-pedido={cardKey}
                                    className={`select-none ${
                                        stage === 'pausado'
                                            ? 'ring-2 ring-warning/45 shadow-[var(--shadow-glow-warning-lg)]'
                                            : (hasObservacion(row) && row.pedido_status !== 'completado') || faltan.hay
                                                ? 'ring-2 ring-chart-4/45 shadow-[var(--shadow-glow-chart-4)]'
                                                : isFadedOut
                                                    ? 'opacity-80'
                                                    : ''
                                    }`}
                                    style={{ overflow: 'visible' }}
                                    /* Desplegar el pedido es la acción de la tarjeta:
                                       por `clickable()` gana foco, teclado y el gel del
                                       material, que un `onClick` suelto no da. */
                                    {...clickable(
                                        () => toggleExpand(cardKey, row.pedido_id, row.erp_sucursal_id),
                                        { label: `Pedido ${row.codigo ?? row.numero}` },
                                    )}
                                    aria-expanded={isExp}
                                >
                                    {/* ── Zona 1: quién y en qué está ──────────────────
                                        Rediseño 2026-10-06. La SALA es el título —es lo
                                        que se busca con la vista— y el código va al lado
                                        en gris: antes el título era `33-061026-1-S4` y
                                        la sala una pastilla chica. El estado se dice UNA
                                        vez, con su tiempo en la etapa; antes se repetía
                                        en la etiqueta, en la línea y en el pie. */}
                                    <div className="flex items-start gap-x-3 gap-y-1 px-3 pt-2.5 pb-1 flex-wrap">
                                        {/* `basis-64 grow`: en el teléfono el estado baja a
                                            su propio renglón en vez de apretar el nombre. */}
                                        <div className="min-w-0 basis-64 grow">
                                            <div className="flex items-baseline gap-2 flex-wrap">
                                                <span className="text-body-lg font-bold text-content leading-tight">
                                                    {ERP_NAMES[row.erp_sucursal_id] ?? `Sucursal ${row.erp_sucursal_id}`}
                                                </span>
                                                <span className="text-caption text-content-3 tabular-nums">{row.codigo ?? `#${row.numero}`}</span>
                                            </div>
                                            {row.notes && <p className="text-caption text-content-3 mt-0.5">{row.notes}</p>}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {/* El rótulo es de la SALA, no del pedido — `estadoDeLaSala`.
                                                Con `pedido_status`, el pedido 137 del 2026-08-24 ponía
                                                «En ruta» sobre Salud 2, que no se había ni empezado a
                                                preparar: el pedido sí iba en ruta, esa sala no. */}
                                            {stage === 'pausado' ? (
                                                <Badge variant="warning" tone="solid" uppercase={false} icon={Pause}>Pausado</Badge>
                                            ) : (
                                                <Badge variant={etiqueta.variant} uppercase={false}>{etiqueta.label}</Badge>
                                            )}
                                            {tiempoEnEtapa && (
                                                <span className={`text-caption font-semibold tabular-nums ${stage === 'pausado' ? 'text-warning-text' : 'text-content-2'}`}>
                                                    {tiempoEnEtapa}
                                                </span>
                                            )}
                                            <span className="hidden sm:inline text-caption text-content-3 tabular-nums">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                            {isExp ? <ChevronDown size={14} className="text-content-3" /> : <ChevronRight size={14} className="text-content-3" />}
                                        </div>
                                    </div>

                                    {/* Apoyo preparación (bodega) — el GEMELO de «Apoyo en
                                        recepción» de `LifecycleTimeline`: misma lista
                                        (`apoyoMap`, otro cubo), misma anatomía, y hasta el
                                        2026-08-15 dibujada distinto y con un bug propio.
                                        Leía `a.photo_url` a secas, que es la URL CRUDA: el
                                        bucket de fotos es privado, así que la que se puede
                                        pintar es la firmada y vive en `photo` (la pone
                                        `signPhotosDeep` en `usePedidosData`). O sea que
                                        estas caras salían como monigote gris mientras las
                                        de recepción, dos renglones abajo, salían bien.
                                        Ahora comparte el canónico con su gemelo: `Badge`
                                        neutro + `LiquidAvatar`. */}
                                    {prepApoyo.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
                                            <span className="text-caption font-semibold text-content-2 uppercase tracking-wide shrink-0">Prep:</span>
                                            {prepApoyo.map(a => (
                                                <Badge key={a.id} variant="neutral" uppercase={false} className="pl-1">
                                                    <AvatarConEstado emp={a} px={20} radio="rounded-full" marco="" />
                                                    {shortEmployeeName(a)}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}

                                    {/* ── Zona 2: el avance ──────────────────────────────
                                        Cerrada, una línea de puntos (`AvanceCompacto`);
                                        abierta, la línea completa con quién y a qué hora.
                                        Siempre abierta hacía cada tarjeta de ~270px. */}
                                    <div className={`px-3 ${isExp ? 'border-t border-divider pt-2 pb-1.5' : 'pt-1.5 pb-2'}`}>
                                        {!isExp
                                            ? <AvanceCompacto row={row} stage={stage} rutaStop={rtStop} />
                                            : <LifecycleTimeline row={row} stage={stage} creatorEmp={creator} iniciadorEmp={iniciador} finalizadorEmp={finalizador} enviadorEmp={enviador} llegadaEmp={llegadaEmp} conteoEmp={conteoEmp} reenvioEmp={reenvioEmp} erpEmp={erpEmp} difsEmp={difsEmp} corrConfEmp={corrConfEmp} receptionApoyo={recepApoyo} isBranch={isBranch} empMap={empMap} pauses={row.pauses ?? []} rutaStop={rtStop} rutaCondEmp={rtCond} />}
                                    </div>

                                    {/* ── Zona 3: datos y acciones — una sola fila ──────
                                        Izquierda, los datos de la sala (antes en dos y tres
                                        renglones sueltos). Derecha, las acciones: UNA
                                        principal —el siguiente paso del flujo— y el resto en
                                        gris. Antes cada botón tenía su color (naranja, rosa,
                                        morado, verde, rojo) y todos pesaban igual. Las
                                        condiciones de cada botón NO cambiaron. */}
                                    <div className="flex items-center gap-x-2 gap-y-2 px-3 pb-2.5 pt-2 border-t border-divider flex-wrap" onClick={e => e.stopPropagation()}>
                                      <div className="flex items-center gap-1 flex-wrap min-w-0">
                                        {datosJSX}
                                      </div>
                                        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                                            {accionesJSX}
                                        </div>
                                    </div>


                                    {seccionesJSX}

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden" onClick={e => e.stopPropagation()}>
                                                <ItemSections allItems={items[cardKey] ?? []} loading={loadingItems && !items[cardKey]} canEditMinMax={canEditMinMax} />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
    };

    return (
        <div className="space-y-4 p-4">

            {/* `Notice` y no una caja con su propio par bg/borde/texto: es el
                canónico del aviso inline (§15.6), y el botón de descarte va en
                su ranura `action`. La exclamación se va por §26.7 — el portal no
                festeja en el feedback del sistema; la lista de los tres sitios
                donde sí va es cerrada y esto no está en ella. */}
            <AnimatePresence>
                {newAlert && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}>
                        <Notice
                            variant="info"
                            icon={Send}
                            action={<Button variant="ghost" icon={X} iconOnly aria-label="Descartar aviso" onClick={() => setNewAlert(null)} />}
                        >
                            Pedido #{newAlert.numero} en camino a {branchName}
                        </Notice>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── FILTROS + CARDS SUCURSALES ─────────────────────────── */}
            <div>
                {/* Fila única: cards por sucursal (izq) + FilterPill (der) */}
                <div className="flex items-center gap-3 mb-3">
                <CarrilCards className="flex-1" ariaLabel="Pedidos por sucursal">
                    {/* Bodega / alcance todos: card clicable por sucursal */}
                    {!isBranch && sucursalCounts.map(({ id, name, total }) => {
                        const active = filterSuc === String(id);
                        return (
                            <StatCard
                                key={id}
                                icon={Building2} iconBg={active ? 'bg-surface-card' : 'bg-chart-3/10'} iconCls="text-chart-3-text"
                                label={name} sub="pedidos este mes"
                                value={total} valueCls={active ? 'text-chart-3-text' : 'text-content-2'}
                                tono="brand" active={active}
                                onClick={() => setFilterSuc(v => v === String(id) ? '' : String(id))}
                            />
                        );
                    })}
                    {/* Sucursal (BRANCH): card propia, solo informativa */}
                    {isBranch && sucursalCounts.length > 0 && (() => {
                        const own = sucursalCounts[0];
                        return (
                            <StatCard
                                icon={Building2} iconBg="bg-chart-3/10" iconCls="text-chart-3-text"
                                label={own.name} value={own.total} sub="pedidos este mes"
                            />
                        );
                    })()}
                </CarrilCards>
                    <div className="flex justify-end min-w-0">
                        <FilterPill isBranch={isBranch} filterSuc={filterSuc} setFilterSuc={setFilterSuc} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOptions={filterOptions} filterDate={filterDate} setFilterDate={setFilterDate} />
                    </div>
                </div>

                {/* §26.2 — «Sin pedidos activos» también salía cuando el
                    buscador o un filtro no encontraban nada, que es otro estado
                    y se arregla de otra forma: borrando el filtro, no
                    despachando un pedido. */}
                {filteredRows.length === 0 ? (
                    searchTerm.trim() ? (
                        <EmptyState
                            compact
                            icon={Search}
                            title="Sin resultados"
                            subtitle={`Ningún pedido coincide con "${searchTerm}".`}
                        />
                    ) : (
                        <EmptyState
                            compact
                            icon={Inbox}
                            iconClass="text-chart-1-text"
                            glowClass="bg-chart-1/30"
                            title="Sin pedidos activos"
                            subtitle={filterSuc || filterStatus
                                ? 'Ningún pedido cumple con los filtros aplicados.'
                                : undefined}
                        />
                    )
                ) : (
                    vista === 'lista' ? (
                        <div className="space-y-8">
                            {/* Los nombres de los pasos, UNA vez, alineados con los
                                puntos: antes se repetían en cada fila. Usa las
                                mismas columnas que la fila. */}
                            {/* Pegajoso: al bajar, los nombres de los pasos se quedan
                                a la vista. `data-pegajoso` le da fondo opaco (§15.1):
                                una superficie pegajosa tiene que tapar. */}
                            <div ref={(el) => { centinelaRef.current = el; listaRef.current = el; }} aria-hidden="true" className="h-0" />
                            <div ref={encabezadoRef} data-pegajoso data-pegado={pegado || undefined} style={{
                                    // Suelto, a 8px de la barra. Pegado, se mete 12px
                                    // DEBAJO de ella (tapa sus esquinas redondas) y toma
                                    // su ancho: se lee como la barra que se alarga.
                                    top: topEncabezado + (pegado ? -12 : 8),
                                    paddingTop: pegado ? 24 : undefined,
                                    marginLeft: pegado ? -alas.izq : 0,
                                    marginRight: pegado ? -alas.der : 0,
                                    // Lo que crece hacia afuera se devuelve como relleno:
                                    // las columnas no se mueven ni un píxel (pl-4 / pr-3).
                                    paddingLeft: pegado ? 16 + alas.izq : undefined,
                                    paddingRight: pegado ? 12 + alas.der : undefined,
                                    // `--thead-bg` es 97-98% opaco: con un botón azul
                                    // pasando por debajo, se alcanzaba a ver. El fondo
                                    // de la página debajo lo vuelve opaco del todo.
                                    background: 'linear-gradient(var(--thead-bg), var(--thead-bg)), var(--bg-page)',
                                }}
                                className={`hidden lg:grid lg:sticky z-tabs gap-x-5 pl-4 pr-3 pt-3 pb-2.5 transition-[border-radius,box-shadow,margin,padding] duration-[var(--dur-base)] lg:grid-cols-[9rem_minmax(24rem,1fr)_17rem_1rem] ${pegado ? 'rounded-b-xl rounded-t-none shadow-[var(--shadow-elevation-md)]' : 'rounded-xl shadow-[var(--shadow-elevation-sm)]'}`}>
                                <span className="self-end text-caption font-semibold text-content-2">Sala</span>
                                <EncabezadoDeAvance />
                                <span className="self-end text-caption font-semibold text-content-2">Estado</span>
                            </div>
                            {GRUPOS_LISTA.map(g => {
                                const filas = filteredRows.filter(r => grupoDeLaFila(r) === g.key);
                                if (!filas.length) return null;
                                // Dentro de «En camino», las salas de una misma ruta van
                                // juntas bajo el encabezado de su ruta: el conductor, las
                                // entregas y el mapa son de la RUTA, no de cada sala.
                                const porRuta = g.key === 'transito'
                                    ? Object.values(filas.reduce((acc, r) => {
                                        const ruta = pedidoRutaMap.get(claveParada(r.pedido_id, r.erp_sucursal_id))?.ruta ?? null;
                                        const k = ruta?.id ?? 'sin-ruta';
                                        (acc[k] ??= { ruta, filas: [] }).filas.push(r);
                                        return acc;
                                    }, {}))
                                    : null;
                                return (
                                    <section key={g.key} className="space-y-2" aria-label={g.label}>
                                        {/* Encabezado de sección con ícono, nombre, cuenta y una
                                            línea que la separa: antes era un rótulo gris chico y
                                            las secciones casi no se distinguían. */}
                                        <h3 className={`flex items-center gap-2.5 px-1 pt-1 text-body-sm font-bold ${g.tono}`}>
                                            <g.Icono size={16} aria-hidden="true" />
                                            {g.label}
                                            <span className="px-2 py-0.5 rounded-full bg-surface-card-hover text-caption font-semibold text-content-2 tabular-nums">{filas.length}</span>
                                            <span aria-hidden="true" className="flex-1 h-px bg-divider" />
                                        </h3>
                                        {porRuta ? porRuta.map(({ ruta, filas: fr }) => {
                                            const conductor = ruta?.conductor_id ? empMap.get(ruta.conductor_id) : null;
                                            const entregadas = (ruta?.ruta_pedidos ?? []).filter(rp => rp.entregado_at).length;
                                            return (
                                                <div key={ruta?.id ?? 'sin-ruta'} className="space-y-1.5">
                                                    <div className="flex items-center gap-2 px-2 pt-1 text-caption text-content-2 min-w-0">
                                                        <Truck size={13} className="text-chart-3-text shrink-0" aria-hidden="true" />
                                                        {ruta ? (
                                                            <>
                                                                <span className="font-bold text-content">Ruta #{ruta.numero}</span>
                                                                {conductor && <AvatarConEstado emp={conductor} px={18} radio="rounded-full" marco="" mostrarChip={false} />}
                                                                <span className="truncate">{shortEmployeeName(conductor || ruta.conductor_nombre)}</span>
                                                                <span className="text-content-3 tabular-nums">· {entregadas}/{(ruta.ruta_pedidos ?? []).length} entregadas</span>
                                                                <Button variant="ghost" size="xs" icon={MapIcon} className="ml-auto" onClick={() => setRutaMapOpen(ruta)}>Mapa</Button>
                                                            </>
                                                        ) : <span className="font-semibold">Sin ruta</span>}
                                                    </div>
                                                    {fr.map(r => renderSala(r))}
                                                </div>
                                            );
                                        }) : filas.map(r => renderSala(r))}
                                    </section>
                                );
                            })}
                        </div>
                    ) : (
                    <div className="space-y-3">
                    {renderGroups.map((group) => {
                        // Dentro de una ruta: no-entregadas primero (por orden), entregadas al fondo
                        const displayRows = group.isRuta
                            ? [...group.rows].sort((a, b) => {
                                const sa = pedidoRutaMap.get(claveParada(a.pedido_id, a.erp_sucursal_id))?.stop;
                                const sb = pedidoRutaMap.get(claveParada(b.pedido_id, b.erp_sucursal_id))?.stop;
                                const doneA = sa?.entregado_at ? 1 : 0;
                                const doneB = sb?.entregado_at ? 1 : 0;
                                if (doneA !== doneB) return doneA - doneB;
                                return (sa?.orden_entrega ?? 99) - (sb?.orden_entrega ?? 99);
                            })
                            : group.rows;
                        const cards = displayRows.map(row => renderSala(row));
                        if (group.isRuta) {
                            const { ruta, driverOnline: dl } = group;
                            const entregadas = ruta.ruta_pedidos.filter(rp => rp.entregado_at).length;
                            const total = ruta.ruta_pedidos.length;
                            const isConductorRuta = !!(user?.id && ruta.conductor_id && String(user.id) === String(ruta.conductor_id));
                            const pct = total > 0 ? Math.round((entregadas / total) * 100) : 0;
                            const isCompletada = ruta.status === 'completada';
                            const fmtT = (iso) => iso ? hora12(iso) : null;
                            const conductorEmp = ruta.conductor_id ? empMap.get(ruta.conductor_id) : null;
                            // El grupo de ruta ES una tarjeta, así que va por su
                            // `data-surface` y no copiando su color (§5.0.1). Estaba escrito
                            // `rounded-2xl border bg-surface-card` + una sombra de resplandor:
                            // los tokens eran los correctos y aun así quedaba fuera del
                            // material — sin desenfoque, sin el lente, sin el destello del
                            // canto al apuntarla y con un radio propio que no seguía al tema.
                            //
                            // Y el tinte va por `data-tono`, que es la única forma de marcarla:
                            // `[data-surface="card"]` fija borde y sombra y le gana por
                            // especificidad a cualquier `border-*` de Tailwind (§5.1) — o sea
                            // que el `border-chart-3/30` que había no pintaba nada. El
                            // resplandor lo reemplaza el anillo del tono, que es como el
                            // sistema marca una tarjeta por su estado.
                            return (
                                <div key={ruta.id} data-surface="card"
                                    data-tono={isCompletada ? undefined : 'chart-3'}
                                    className="overflow-hidden">
                                    {/* Header sin color — glass */}
                                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-divider bg-surface-card" onClick={e => e.stopPropagation()}>
                                        {/* Foto/icono conductor */}
                                        <div className="relative shrink-0">
                                            {conductorEmp
                                                ? <AvatarConEstado emp={conductorEmp} px={28} radio="rounded-full" marco="" />
                                                : <div data-surface={isCompletada ? 'card' : undefined} className={`w-7 h-7 rounded-xl flex items-center justify-center border ${isCompletada ? 'bg-surface-card-hover' : 'bg-chart-3/10 border-chart-3/30'}`}>
                                                    <Truck size={13} className={isCompletada ? 'text-content-3' : 'text-chart-3-text'} />
                                                  </div>
                                            }
                                            {dl && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-surface-card animate-pulse" />}
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-body font-black ${isCompletada ? 'text-content-2' : 'text-chart-3-text'}`}>Ruta #{ruta.numero}</span>
                                                {/* Eran un ✓ y un emoji 🟢 escritos como texto: el
                                                    emoji además cambia de dibujo según el sistema
                                                    y no toma el color del badge. */}
                                                {isCompletada
                                                    ? <Badge variant="success" size="sm" uppercase={false} icon={Check}>Completada{ruta.vuelta_base_at ? ` · ${fmtT(ruta.vuelta_base_at)}` : ''}</Badge>
                                                    : dl && <Badge variant="success" size="sm" uppercase={false} icon={Radio}>En vivo</Badge>
                                                }
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-label text-content-3 truncate">{shortEmployeeName(conductorEmp || ruta.conductor_nombre)}</span>
                                                <span className="text-caption text-content-3 tabular-nums whitespace-nowrap">{entregadas}/{total} entregas</span>
                                            </div>
                                        </div>
                                        {/* Acciones */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isConductorRuta && ruta.status === 'pendiente' && (
                                                <Button tone="chart-3" icon={Play} disabled={rutaOcupada === ruta.id} onClick={async () => {
                                                        if (rutaOcupada) return;
                                                        setRutaOcupada(ruta.id);
                                                        try {
                                                            const { error } = await iniciarRuta(ruta.id);
                                                            if (error) throw error;
                                                            loadActiveRutas();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo iniciar la ruta. Intenta de nuevo.', 'error'); }
                                                        finally { setRutaOcupada(null); }
                                                    }}>Iniciar</Button>
                                            )}
                                            {isConductorRuta && ruta.status === 'en_ruta' && entregadas === total && total > 0 && (
                                                <Button tone="chart-8" icon={Home} disabled={rutaOcupada === ruta.id} onClick={async () => {
                                                        if (rutaOcupada) return;
                                                        setRutaOcupada(ruta.id);
                                                        try {
                                                            const { error } = await completarRuta(ruta.id);
                                                            if (error) throw error;
                                                            loadActiveRutas(); loadActive();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo completar la ruta. Intenta de nuevo.', 'error'); }
                                                        finally { setRutaOcupada(null); }
                                                    }}>Base</Button>
                                            )}
                                            {!isCompletada && (
                                                <Button variant="secondary" icon={MapIcon} onClick={() => setRutaMapOpen(ruta)}>Mapa</Button>
                                            )}
                                        </div>
                                        {/* Barra de progreso solo cuando activa */}
                                        {!isCompletada && (
                                            <div className="hidden sm:block w-16 h-1.5 rounded-full bg-surface-card-hover overflow-hidden shrink-0">
                                                <div className="h-full bg-chart-3 rounded-full transition-all duration-[var(--dur-lento)]" style={{ width: `${pct}%` }} />
                                            </div>
                                        )}
                                    </div>
                                    {/* Cards hijas — con layout animation */}
                                    <div className="p-2.5 flex flex-col gap-2">
                                        <AnimatePresence initial={false} mode="popLayout">
                                            {cards}
                                        </AnimatePresence>
                                    </div>
                                </div>
                            );
                        }
                        return <div key="normal" className="space-y-2.5">{cards}</div>;
                    })}
                    </div>
                    )
                )}
            </div>

            {/* ── Modals ─────────────────────────────────────────────────── */}

            <LlegadaModal
                open={!!llegadaModal}
                onClose={() => setLlegadaModal(null)}
                onConfirm={handleLlegadaConfirm}
                items={llegadaModal?.rows ?? []}
                pedidoNumero={llegadaModal ? activeRows.find(r => r.pedido_id === llegadaModal.pedidoId)?.numero : null}
                cajaMap={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId)?.caja_map ?? {}) : {}}
                totalCajas={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId)?.total_cajas ?? 0) : 0}
                cajasElectrolit={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId && r.erp_sucursal_id === llegadaModal.sucId)?.cajas_electrolit ?? 0) : 0}
                cajasEspeciales={llegadaModal ? (activeRows.find(r => r.pedido_id === llegadaModal.pedidoId && r.erp_sucursal_id === llegadaModal.sucId)?.cajas_especiales ?? []) : []}
                draftKey={llegadaModal ? `llegada_${llegadaModal.pedidoId}_${llegadaModal.sucId}` : null}
            />

            <ReenvioLlegadaModal
                open={!!reenvioLlegadaModal}
                onClose={() => setReenvioLlegadaModal(null)}
                onConfirm={handleReenvioLlegadaConfirm}
                pedidoNumero={reenvioLlegadaModal ? activeRows.find(r => r.pedido_id === reenvioLlegadaModal.pedidoId)?.numero : null}
                cajasCiclo={reenvioLlegadaModal?.cajasCiclo      ?? []}
                electrolitCount={reenvioLlegadaModal?.electrolitCount ?? 0}
                especialesList={reenvioLlegadaModal?.especialesList   ?? []}
                cicloNum={reenvioLlegadaModal?.ciclo ?? 1}
                cajaMap={reenvioLlegadaModal?.cajaMap ?? {}}
            />

            <FinalizarCajasModal
                open={!!finalizarModal}
                onClose={() => setFinalizarModal(null)}
                onConfirm={handleFinalizarConCajas}
                items={finalizarModal?.rows}
                sucId={finalizarModal?.sucId}
                pedidoId={finalizarModal?.pedidoId}
                pedidoNumero={finalizarModal?.numero}
                paginas={finalizarModal?.paginas ?? null}
                draftKey={finalizarModal ? `finalizar_${finalizarModal.pedidoId}_${finalizarModal.sucId}` : null}
            />

            {anularModal && (
                <AnularModal
                    modal={anularModal}
                    onCancel={() => setAnularModal(null)}
                    onConfirm={handleAnular}
                    busy={busyAnular}
                />
            )}

            {pauseModal && (
                <PauseModal
                    modal={pauseModal}
                    history={pauseHistory}
                    kioskLunch={kioskLunch}
                    razonSel={pauseRazon}    setRazonSel={setPauseRazon}
                    comment={pauseComment}   setComment={setPauseComment}
                    onCancel={() => setPauseModal(null)}
                    onConfirm={confirmPause}
                    busy={busyLifecycle === `lc_${pauseModal.pedidoId}_${pauseModal.sucId}`}
                />
            )}

            <ApoioScanModal
                open={!!apoyoModal}
                onClose={() => setApoyoModal(null)}
                pedidoId={apoyoModal?.pedidoId}
                sucId={apoyoModal?.sucId}
                currentUserId={user?.id}
                tipo={apoyoModal?.tipo ?? 'preparacion'}
                existingApoyo={(apoyoMap[apoyoModal?.cardKey] ?? { preparacion: [], recepcion: [] })[apoyoModal?.tipo ?? 'preparacion'] ?? []}
                onSuccess={(emp) => handleApoyoSuccess(emp, apoyoModal?.cardKey, apoyoModal?.tipo ?? 'preparacion')}
            />

            {modal && (
                <RecepcionModal
                    open={!!modal}
                    onClose={() => setModal(null)}
                    pedido={modal.pedido}
                    sucursalId={modal.sucId}
                    sucursalNombre={branchName}
                    rows={modal.rows}
                    confirmados={modal.confirmados ?? []}
                    cajaDanada={modal.cajaDanada   ?? []}
                    cajaMap={modal.cajaMap         ?? {}}
                    paginaItems={modal.paginaItems  ?? {}}
                    paginas={modal.paginas ?? []}
                    hojasRecibidas={modal.hojasRecibidas ?? []}
                    faltaCajas={modal.faltaCajas     ?? []}
                    hasFaltaItems={modal.hasFaltaItems ?? false}
                    especialesLlegadas={modal.especialesLlegadas ?? {}}
                    cajasEspeciales={modal.cajasEspeciales ?? []}
                    itemsEnReenvio={modal.itemsEnReenvio ?? []}
                    itemsYaContados={modal.itemsYaContados ?? []}
                    /* Corregir un conteo NO cierra el modal —la sala puede
                       corregir varios— pero sí tiene que refrescar la tarjeta al
                       salir: la diferencia recién nacida vive en la sección de
                       Diferencias, que lee de la base. Y si nació una, bodega
                       tiene que enterarse: una diferencia que espera a que
                       alguien mire la pantalla no cierra el circuito. El aviso
                       lo escribe la base al ver `diferencias_reportadas_at`
                       (`avisar_camino_del_pedido`, 2026-09-28). */
                    onCorregido={async () => {
                        const { pedido, sucId, key } = modal;
                        const loaded = await fetchItems(key, pedido.id, sucId);
                        if ((loaded || []).some(r => r.status === 'con_diferencia')) {
                            await handleReportarDiferencias(pedido.id, sucId);
                        }
                        await loadActive();
                    }}
                    onConfirmed={async ({ hasDiff, allDone }) => {
                        const { pedido, sucId, key } = modal;
                        setModal(null);
                        // El ingreso al inventario quedó corriendo solo: se le
                        // pregunta cada tanto hasta que termine, para que la
                        // tarjeta pase a «en el inventario» sin recargar nada.
                        vigilarIngreso(pedido.id, sucId);
                        if (allDone) {
                            await handleMarkErp(pedido.id, sucId, key);
                            // Re-fetch items to get accurate con_diferencia count
                            const loaded = await fetchItems(key, pedido.id, sucId);
                            const realHasDiff = hasDiff || (loaded || []).some(r => r.status === 'con_diferencia');
                            if (realHasDiff) await handleReportarDiferencias(pedido.id, sucId);
                        } else {
                            // Partial box confirmed — reload items before active so DifSection gets fresh data
                            await fetchItems(key, pedido.id, sucId);
                        }
                        await loadActive();
                    }}
                />
            )}

            {/* ── Crear Ruta modal ───────────────────────────────────────────────── */}
            <CrearRutaModal
                open={crearRutaOpen !== null}
                initialKeys={crearRutaOpen ?? []}
                onClose={() => setCrearRutaOpen(null)}
                onCreated={() => { setCrearRutaOpen(null); loadActive(); }}
            />

            {rutaMapOpen && (
                <RutaMapModal
                    ruta={rutaMapOpen}
                    open={!!rutaMapOpen}
                    onClose={() => setRutaMapOpen(null)}
                    currentUserId={user?.id}
                />
            )}

            {/* ── Devolver a bodega ───────────────────────────────────────────
                El estado vive acá y no en el hook porque es puro formulario: se
                abre desde la fila de una diferencia y muere al enviarlo. */}
            {devolverModal && (
                /* El daño es lo único que no se puede proponer en la tarjeta:
                   necesita la foto, y la foto necesita un lugar donde elegirla.
                   El modal ya no pregunta motivo ni cantidad —eso lo resolvió la
                   decisión, y volver a preguntarlo sería ofrecer un número que
                   después se ignora—: pide la foto y la nota, y con eso propone. */
                <DevolverModal
                    open
                    soloEvidencia
                    onClose={() => setDevolverModal(null)}
                    item={devolverModal.item}
                    saving={busyAction === `dif_${devolverModal.item?.id}`}
                    onConfirm={async ({ nota, fotos = [] }) => {
                        const m = devolverModal;
                        setDevolverModal(null);
                        await handleProponerConFoto(m, { nota, fotos });
                    }}
                />
            )}

            <ProgramarEntregaModal
                open={!!programarModal}
                onClose={() => setProgramarModal(null)}
                numero={programarModal?.numero}
                currentAt={programarModal?.currentAt}
                historial={programarModal?.historial ?? []}
                empMap={empMap}
                onConfirm={handleProgramarEntrega}
                saving={savingProgramar}
            />

            {/* ── Confirmación Reenviar Caja ───────────────────────────────────────
                Era un diálogo de confirmación armado a mano dentro de un
                `LiquidModal`: encabezado, cuerpo y pie propios, sin salida por
                Escape y sin la hoja inferior que el canónico da en táctil.
                `ConfirmModal` ya estaba importado en este archivo y no lo usaba
                nadie — importarlo no es adoptarlo. */}
            {reenviarConfirmModal && (() => {
                const m = reenviarConfirmModal;
                const productos = m.productos ?? [];
                const noVa = (p) => m.noReenviar.includes(p.itemId);
                const aReenviar = productos.filter(p => !noVa(p));
                const aCancelar = productos.filter(noVa);
                const hayReenvio = m.cajas.length > 0 || m.electrolits > 0 || aReenviar.length > 0;
                const elegir = (p, va) => setReenviarConfirmModal(prev => prev && ({
                    ...prev,
                    noReenviar: va ? prev.noReenviar.filter(id => id !== p.itemId) : [...new Set([...prev.noReenviar, p.itemId])],
                }));
                // «Todas»: sólo sobre lo que se puede cancelar; lo parcial no entra.
                const cancelables = productos.filter(p => !p.parcial);
                return (
            <ConfirmModal
                isOpen
                onClose={() => setReenviarConfirmModal(null)}
                title={`Lo que no llegó del pedido #${m.numero}`}
                confirmText={!hayReenvio ? 'No reenviar' : aCancelar.length > 0 ? 'Confirmar' : 'Reenviar'}
                /* Reenviar no destruye nada. «No reenviar» sí es definitivo —
                   anula el traslado—, pero lo dice el texto de abajo; con
                   `isDestructive` el canónico rotula el botón «Eliminando…». */
                isDestructive={false}
                isProcessing={busyAction === 'reenvio'}
                message={(
                    <div className="space-y-3 text-left">
                        {(m.cajas.length > 0 || m.electrolits > 0) && (
                            <div className="space-y-1.5">
                                <p className="text-label font-semibold text-content-2 uppercase tracking-wide">Se reenvía</p>
                                {m.cajas.length > 0 && (
                                    <div className="flex items-center gap-2 text-body-sm text-content-2">
                                        <Box size={13} className="text-danger shrink-0" />
                                        <span>Caja{m.cajas.length > 1 ? 's' : ''}: {m.cajas.map(n => `#${n}`).join(', ')}</span>
                                    </div>
                                )}
                                {m.electrolits > 0 && (
                                    <div className="flex items-center gap-2 text-body-sm text-content-2">
                                        <Inbox size={13} className="text-warning shrink-0" />
                                        <span>{m.electrolits} Electrolit faltante{m.electrolits > 1 ? 's' : ''}</span>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* Una línea por PRODUCTO, con su decisión. Las cajas
                            numeradas llevan muchos productos y se reenvían
                            enteras; lo suelto —una caja especial— se puede
                            dejar de mandar. Decisión del usuario, 2026-09-17. */}
                        {productos.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <p className="text-label font-semibold text-content-2 uppercase tracking-wide">Cajas especiales</p>
                                    {cancelables.length > 1 && (
                                        <div className="flex items-center gap-1.5">
                                            <Button size="xs" variant="secondary" onClick={() => setReenviarConfirmModal(prev => prev && ({ ...prev, noReenviar: [] }))}>Reenviar todas</Button>
                                            <Button size="xs" variant="secondary" onClick={() => setReenviarConfirmModal(prev => prev && ({ ...prev, noReenviar: cancelables.map(p => p.itemId) }))}>No reenviar ninguna</Button>
                                        </div>
                                    )}
                                </div>
                                {productos.map(p => (
                                    <div key={p.itemId} className="space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Star size={13} className="text-chart-6-text shrink-0" />
                                            <span className="text-body-sm text-content-2 flex-1 min-w-0">
                                                {p.labels.join('–')}{p.producto ? ` · ${p.producto}` : ''}
                                            </span>
                                            <SegmentedControl
                                                size="sm"
                                                label={`Qué hacer con ${p.labels.join('–')}`}
                                                value={noVa(p) ? 'no' : 'si'}
                                                onChange={v => elegir(p, v === 'si')}
                                                options={[
                                                    { value: 'si', label: 'Reenviar' },
                                                    { value: 'no', label: 'No reenviar', tone: 'danger', disabled: p.parcial },
                                                ]}
                                            />
                                        </div>
                                        {p.parcial && (
                                            <p className="text-caption text-content-3 pl-5">
                                                Una de sus cajas sí llegó. Va en un solo traslado: no reenviarla regresaría también la que la sala tiene.
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {aCancelar.length > 0 && (
                            <Notice variant="warning" icon={AlertTriangle} bloque>
                                {aCancelar.map(p => p.labels.join('–')).join(', ')} no se reenvía: el producto regresa a bodega y la sala deja de verlo pendiente. No se puede deshacer.
                            </Notice>
                        )}
                    </div>
                )}
                onConfirm={() => {
                    setReenviarConfirmModal(null);
                    handleResolverFaltantes({
                        pedidoId: m.pedidoId, sucId: m.sucId, numero: m.numero,
                        cajas: m.cajas, electrolits: m.electrolits,
                        reenviarEspeciales: aReenviar.flatMap(p => p.labels.map(label => ({ label, producto: p.producto }))),
                        noReenviar: aCancelar.map(p => ({ labels: p.labels, producto: p.producto })),
                    });
                }}
            />
                );
            })()}
        </div>
    );
}
