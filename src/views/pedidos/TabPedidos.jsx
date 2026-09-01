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
    CalendarClock, Ban, Star, Search, Radio, RefreshCw,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { notifyBranch } from '../../utils/notify';
import { shortEmployeeName } from '../../utils/nameUtils';
import ConfirmModal from '../../components/common/ConfirmModal';
import SucPill from './tabpedidos/SucPill';
import { fmtMin, elapsed, fmtEntrega, fmtRelative, getBranchStage, hayRecepcionPendiente, estadoDeLaSala, claveParada, puedePrepararse, puedeDespacharse } from './tabpedidos/helpers';
import ItemSections from './tabpedidos/ItemSections';
import LifecycleTimeline from './tabpedidos/LifecycleTimeline';
import DifSection from './tabpedidos/DifSection';
import PostCompletionSection from './tabpedidos/PostCompletionSection';
import ReceptionActions from './tabpedidos/ReceptionActions';
import FilterPill from './tabpedidos/FilterPill';
import { fetchBodegaBranchId, updateRutaStatus } from '../../data/pedidos';
import { avisarSalidaALasSalas } from '../../utils/avisoSalidaPedido';
import { usePedidosData } from './tabpedidos/usePedidosData';
import { clickable } from '../../utils/clickable';
import { esCargoDeSupervision } from '../../utils/decisionDiferencia';
import { dialogoDiferido } from '../../utils/dialogoDiferido';
import { electrolitFueraDeEspeciales } from '../../utils/cajasEspeciales';

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
export default function TabPedidos({ searchTerm = '' }) {
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
        handleReenviarCaja,
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

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="py-20"><SkeletonText lines={5} /></div>
        );
    }

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
                        const cards = displayRows.map(row => {
                            const stage      = getBranchStage(row);
                            const estadoSala = estadoDeLaSala(row);
                            const cardKey    = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
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

                            const apoyoBucket  = apoyoMap[cardKey] ?? { preparacion: [], recepcion: [] };
                            const prepApoyo    = apoyoBucket.preparacion ?? [];
                            const recepApoyo   = apoyoBucket.recepcion   ?? [];

                            const canFinalizar = canActuar && !isBranch && stage === 'preparando';

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

                            // Anular SÍ es del pedido —se anula entero, no una sala— así que
                            // acá `pedido_status` es lo correcto: si alguna sala ya salió, el
                            // pedido no se anula. Es la única de estas guardas que se queda.
                            const canAnular = canActuar && !isBranch
                                && row.pedido_status === 'confirmado'
                                && !(pedidoStageMap.get(row.pedido_id)?.anyFinalized);

                            // Solo fade cuando completado: parcial queda visible (pendiente corrección)
                            const isFadedOut = row.pedido_status === 'completado' && !!row.recibido_erp_at;  // sutil: solo baja un poco la opacidad

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
                                    className={`select-none ${
                                        stage === 'pausado'
                                            ? 'ring-2 ring-warning/45 shadow-[var(--shadow-glow-warning-lg)]'
                                            : hasObservacion(row) && row.pedido_status !== 'completado'
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
                                    {/* Header */}
                                    <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                                        {stage === 'pausado' && (
                                            <Badge variant="warning" tone="solid" uppercase={false} icon={Pause}>Pausado</Badge>
                                        )}
                                        <span className="text-body font-black text-content tabular-nums shrink-0">
                                            {row.codigo ?? `#${row.numero}`}
                                        </span>
                                        <SucPill sucId={row.erp_sucursal_id} />
                                        {/* El rótulo es de la SALA, no del pedido — `estadoDeLaSala`.
                                            Con `pedido_status`, el pedido 137 del 2026-08-24 ponía
                                            «En ruta» sobre Salud 2, que no se había ni empezado a
                                            preparar: el pedido sí iba en ruta, esa sala no. */}
                                        <Badge
                                            variant={PEDIDO_BADGE[estadoSala]?.variant ?? 'neutral'}
                                            uppercase={false}
                                            className="shrink-0"
                                        >
                                            {PEDIDO_BADGE[estadoSala]?.label ?? estadoSala}
                                        </Badge>
                                        <span className="ml-auto text-caption text-content-3 tabular-nums shrink-0">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                        {isExp ? <ChevronDown size={13} className="text-content-3 shrink-0" /> : <ChevronRight size={13} className="text-content-3 shrink-0" />}
                                    </div>
                                    {row.notes && <p className="px-3 pb-1.5 text-label text-content-2 italic">{row.notes}</p>}

                                    {/* Stats pills */}
                                    {cardStats[cardKey] && (
                                        <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                            <Badge uppercase={false}>{cardStats[cardKey].enviados} enviados</Badge>
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
                                        </div>
                                    )}

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

                                    {/* Lifecycle Timeline */}
                                    <div className="border-t border-divider px-3 pt-2 pb-1.5">
                                        {(() => {
                                            // La parada de ESTA tarjeta. El mapa de rutas vivas va
                                            // por (pedido, sala) —`claveParada`— pero olvida las
                                            // rutas de ayer, así que el paso «Entregado» amanecía en
                                            // blanco. `entregaMap` es el registro del pedido: va por
                                            // (pedido, sucursal) y no caduca. La ruta viva manda
                                            // porque se actualiza en el momento en que el conductor
                                            // marca la entrega.
                                            //
                                            // El `?? rutaInfo?.stop` que cerraba esta cadena era el
                                            // último resto de la llave por pedido: le prestaba a esta
                                            // tarjeta la parada de OTRA sala, y por eso el nodo
                                            // «Entregado» de Salud 2 mostraba la cara del conductor
                                            // de Salud 1 (pedido 137, 2026-08-24). Sin parada propia
                                            // el nodo va vacío, que es la verdad.
                                            const rutaInfo = pedidoRutaMap.get(claveParada(row.pedido_id, sucDeLaTarjeta));
                                            const entrega  = entregaMap[cardKey] ?? null;
                                            const rtStop   = rutaInfo?.stop ?? entrega ?? null;
                                            const condId   = rutaInfo?.ruta?.conductor_id ?? entrega?.ruta?.conductor_id ?? null;
                                            const rtCond   = condId ? empMap.get(condId) ?? null : null;
                                            return (
                                                <LifecycleTimeline row={row} stage={stage} creatorEmp={creator} iniciadorEmp={iniciador} finalizadorEmp={finalizador} enviadorEmp={enviador} llegadaEmp={llegadaEmp} conteoEmp={conteoEmp} reenvioEmp={reenvioEmp} erpEmp={erpEmp} difsEmp={difsEmp} corrConfEmp={corrConfEmp} receptionApoyo={recepApoyo} isBranch={isBranch} empMap={empMap} pauses={row.pauses ?? []} rutaStop={rtStop} rutaCondEmp={rtCond} />
                                            );
                                        })()}
                                    </div>

                                    {/* Actions + status strip */}
                                    <div className="flex items-center gap-2 px-3 pb-2 flex-wrap" onClick={e => e.stopPropagation()}>
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
                                            <Badge variant="danger" icon={Package} uppercase={false}>Faltante{row.falta_cajas.length > 1 ? 's' : ''}: {row.falta_cajas.map(n => `#${n}`).join(', ')}</Badge>
                                        )}
                                        {row.pedido_status === 'parcial' && !(row.cajas_danadas?.length > 0 || row.falta_cajas?.length > 0) && row.pedido_status !== 'completado' && (
                                            <Badge icon={ClipboardList} uppercase={false}>Difs. pendientes</Badge>
                                        )}
                                        {elapsedPrep  && <span className="text-caption text-content-2 tabular-nums">{elapsedPrep}</span>}
                                        {elapsedPause && (
                                            <span className="text-caption text-warning-text font-semibold tabular-nums animate-pulse">
                                                {elapsedPause} en pausa
                                            </span>
                                        )}
                                        {elapsedTrans && <span className="text-caption text-chart-3-text tabular-nums">{elapsedTrans} en ruta</span>}
                                        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
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
                                            {canApoyo && (
                                                <Button variant="secondary" icon={UserPlus} disabled={isLCBusy} onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey, tipo: 'preparacion' })}>Apoyo</Button>
                                            )}
                                            {/* `icon` + `loading` del canónico, en vez de armar
                                                el intercambio ícono/spinner a mano en cada
                                                botón: `Button` ya lo hace, y además apaga el
                                                click y marca `aria-busy` mientras corre. */}
                                            {canActuar && canDownload && (
                                                <Button variant="secondary" icon={FileDown} loading={printingPdf === row.pedido_id} onClick={e => { e.stopPropagation(); handlePrintPdf(row.pedido_id, row.numero, row.erp_sucursal_id, cardKey, row.codigo); }}>PDF</Button>
                                            )}
                                            {canActuar && !isBranch && stage === 'preparado' && (
                                                <Button
                                                    size="sm"
                                                    tone="chart-3"
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
                                                    <Button tone="success" icon={CheckCircle2} onClick={e => { e.stopPropagation(); handleEntregarStop(stop.id, ruta.id, stop.erp_sucursal_id); }}>Entregué</Button>
                                                );
                                            })()}
                                            {canIniciar      && <Button tone="chart-1" icon={Play}      loading={isLCBusy} onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}>Iniciar</Button>}
                                            {canPausar       && <Button tone="warning" icon={Pause}     loading={isLCBusy} onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}>Pausar</Button>}
                                            {canFinalizar    && <Button tone="chart-6" icon={Flag}      loading={isLCBusy || busyAction === `finalizar_load_${cardKey}`} onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)}>Finalizar</Button>}
                                            {canReanudar     && <Button tone="success" icon={RotateCcw} loading={isLCBusy} onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}>Reanudar</Button>}
                                            {canAnular && (
                                                <Button variant="destructive" icon={Ban} onClick={e => { e.stopPropagation(); const st = pedidoStageMap.get(row.pedido_id) ?? {}; setAnularModal({ pedidoId: row.pedido_id, numero: row.numero, requiresReason: !!(st.anyActive) }); }}>Anular</Button>
                                            )}
                                            {canMarcarEnRuta && <Button tone="chart-3" icon={Truck} onClick={() => setCrearRutaOpen([])}>Crear ruta</Button>}
                                            {(() => {
                                                const hasElecFaltantes = (row.electrolit_faltantes ?? 0) > 0 && row.electrolit_ok !== true;
                                                const hasEspFaltantes  = Object.values(row.cajas_especiales_llegadas ?? {}).some(v => v === 'faltante');
                                                const hasPendingFalta  = (row.falta_cajas ?? []).length > 0 || hasElecFaltantes || hasEspFaltantes;
                                                const reenvioEnCamino  = (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at);
                                                const rutaActiva       = pedidoRutaMap.get(claveParada(row.pedido_id, row.erp_sucursal_id))?.ruta;
                                                const conductorEnRuta  = rutaActiva?.status === 'en_ruta' && !rutaActiva?.vuelta_base_at;
                                                if (!canActuar || isBranch || !hasPendingFalta || reenvioEnCamino) return null;
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
                                                const espFaltList = Object.entries(row.cajas_especiales_llegadas ?? {}).filter(([, v]) => v === 'faltante').map(([k]) => k);
                                                return (
                                                    <Button variant="destructive" icon={Truck} loading={busyAction === 'reenvio'} onClick={() => setReenviarConfirmModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, cajas: row.falta_cajas ?? [], electrolits: hasElecFaltantes ? (row.electrolit_faltantes ?? 0) : 0, especiales: espFaltList })}>Reenviar caja</Button>
                                                );
                                            })()}
                                        </div>
                                    </div>


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
                                                hasFaltaItems={(items[cardKey] ?? []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0)}
                                            />
                                        </div>
                                    )}

                                    {/* Diferencias — visible cuando parcial o completado con diffs en historial */}
                                    {(row.pedido_status === 'parcial' || (row.pedido_status === 'completado' && (items[cardKey] ?? []).some(r => r.error_tipo))) && (
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

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden" onClick={e => e.stopPropagation()}>
                                                <ItemSections allItems={items[cardKey] ?? []} loading={loadingItems && !items[cardKey]} canEditMinMax={canEditMinMax} />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        });
                        if (group.isRuta) {
                            const { ruta, driverOnline: dl } = group;
                            const entregadas = ruta.ruta_pedidos.filter(rp => rp.entregado_at).length;
                            const total = ruta.ruta_pedidos.length;
                            const isConductorRuta = !!(user?.id && ruta.conductor_id && String(user.id) === String(ruta.conductor_id));
                            const pct = total > 0 ? Math.round((entregadas / total) * 100) : 0;
                            const isCompletada = ruta.status === 'completada';
                            const fmtT = (iso) => iso ? new Date(iso).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true }) : null;
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
                                            {conductorEmp?.photo
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
                                                <span className="text-label text-content-3">{shortEmployeeName(conductorEmp || ruta.conductor_nombre)}</span>
                                                <span className="text-caption text-content-3 tabular-nums">{entregadas}/{total} entregas</span>
                                            </div>
                                        </div>
                                        {/* Acciones */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isConductorRuta && ruta.status === 'pendiente' && (
                                                <Button tone="chart-3" icon={Play} disabled={rutaOcupada === ruta.id} onClick={async () => {
                                                        if (rutaOcupada) return;
                                                        setRutaOcupada(ruta.id);
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'en_ruta', salida_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
                                                            await avisarSalidaALasSalas(ruta.ruta_pedidos ?? [], ruta.conductor_nombre);
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
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'completada', vuelta_base_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
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
                                            <div className="w-16 h-1.5 rounded-full bg-surface-card-hover overflow-hidden shrink-0">
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
                items={finalizarModal?.rows ?? []}
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
                    cajaDanada={modal.cajaDanada   ?? []}
                    cajaMap={modal.cajaMap         ?? {}}
                    paginaItems={modal.paginaItems  ?? {}}
                    paginas={modal.paginas ?? []}
                    hojasRecibidas={modal.hojasRecibidas ?? []}
                    faltaCajas={modal.faltaCajas     ?? []}
                    hasFaltaItems={modal.hasFaltaItems ?? false}
                    especialesLlegadas={modal.especialesLlegadas ?? {}}
                    itemsEnReenvio={modal.itemsEnReenvio ?? []}
                    itemsYaContados={modal.itemsYaContados ?? []}
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
                            fetchBodegaBranchId().then(({ data: b }) => {
                                if (!b?.branch_id) return;
                                const title   = realHasDiff
                                    ? `Problemas en pedido #${pedido.numero} — ${branchName}`
                                    : `Pedido #${pedido.numero} confirmado — ${branchName}`;
                                const message = realHasDiff
                                    ? `${branchName} reporta diferencias en la recepción del pedido #${pedido.numero}. Revisa y márcalo como corregido.`
                                    : `${branchName} confirmó la recepción del pedido #${pedido.numero} sin novedades.`;
                                // Con diferencias = accionable (push); sin novedades = solo campana
                                notifyBranch(b.branch_id, { type: realHasDiff ? 'PEDIDO_PROBLEMA' : 'PEDIDO_TRACKING', title, body: message, link: '/pedidos', push: realHasDiff });
                            }).catch(() => {});
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
            {reenviarConfirmModal && (
            <ConfirmModal
                isOpen
                onClose={() => setReenviarConfirmModal(null)}
                title={`¿Reenviar lo que falta del pedido #${reenviarConfirmModal.numero}?`}
                confirmText="Reenviar"
                /* Reenviar una caja no destruye nada: es pedirle a bodega que
                   mande de nuevo lo que no llegó. Con `isDestructive` el
                   canónico rotula el botón «Eliminando…» mientras corre. */
                isDestructive={false}
                isProcessing={busyAction === 'reenvio'}
                message={(
                    <div className="space-y-2 text-left">
                        <p className="text-label font-semibold text-content-2 uppercase tracking-wide">Pendiente de enviar</p>
                        {reenviarConfirmModal.cajas.length > 0 && (
                            <div className="flex items-center gap-2 text-body-sm text-content-2">
                                <Box size={13} className="text-danger shrink-0" />
                                <span>Caja{reenviarConfirmModal.cajas.length > 1 ? 's' : ''}: {reenviarConfirmModal.cajas.map(n => `#${n}`).join(', ')}</span>
                            </div>
                        )}
                        {reenviarConfirmModal.electrolits > 0 && (
                            <div className="flex items-center gap-2 text-body-sm text-content-2">
                                <Inbox size={13} className="text-warning shrink-0" />
                                <span>{reenviarConfirmModal.electrolits} Electrolit faltante{reenviarConfirmModal.electrolits > 1 ? 's' : ''}</span>
                            </div>
                        )}
                        {reenviarConfirmModal.especiales.length > 0 && (
                            <div className="flex items-center gap-2 text-body-sm text-content-2">
                                <Star size={13} className="text-chart-6-text shrink-0" />
                                <span>Especial{reenviarConfirmModal.especiales.length > 1 ? 'es' : ''}: {reenviarConfirmModal.especiales.join(', ')}</span>
                            </div>
                        )}
                    </div>
                )}
                onConfirm={() => {
                    const { pedidoId, sucId, numero, cajas, electrolits, especiales } = reenviarConfirmModal;
                    setReenviarConfirmModal(null);
                    handleReenviarCaja(pedidoId, sucId, numero, cajas, electrolits, especiales);
                }}
            />
            )}
        </div>
    );
}
