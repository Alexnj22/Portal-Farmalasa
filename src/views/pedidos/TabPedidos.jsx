import React from 'react';
import { EmptyState } from '../../components/common/StateViews';
import Button from '../../components/common/Button';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import { SkeletonText } from '../../components/common/StateViews';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle,
    Truck, Pause, PackageCheck, PackageX, Play, Home,
    Database, Activity, TrendingDown,
    X, Send, CheckCheck, RotateCcw, Flag, ShieldAlert, UserCircle2,
    Coffee, Users, Clock, ClipboardList, Bell, MessageSquare,
    UserPlus, ScanLine, Inbox, AlertCircle, CheckSquare, FileDown, Box, Zap, Map as MapIcon,
    CalendarClock, Ban, Star, Search, Check,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { notifyBranch } from '../../utils/notify';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import RecepcionModal from './RecepcionModal';
import PedidoModal from './PedidoModal';
import LlegadaModal from './LlegadaModal';
import ReenvioLlegadaModal from './ReenvioLlegadaModal';
import FinalizarCajasModal from './FinalizarCajasModal';
import CrearRutaModal    from './CrearRutaModal';
import RutaMapModal      from './RutaMapModal';
import ProgramarEntregaModal from './ProgramarEntregaModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import ConfirmModal from '../../components/common/ConfirmModal';
import PeriodPicker from '../../components/common/PeriodPicker';
import { StageAnim } from './tabpedidos/StageAnims';
import EmpChip from './tabpedidos/EmpChip';
import StagePill from './tabpedidos/StagePill';
import SucPill from './tabpedidos/SucPill';
import PauseModal from './tabpedidos/PauseModal';
import AnularModal from './tabpedidos/AnularModal';
import ApoioScanModal from './tabpedidos/ApoioScanModal';
import { fmtMin, elapsed, fmtEntrega, fmtRelative, getBranchStage } from './tabpedidos/helpers';
import ItemSections from './tabpedidos/ItemSections';
import LifecycleTimeline from './tabpedidos/LifecycleTimeline';
import DifSection from './tabpedidos/DifSection';
import PostCompletionSection from './tabpedidos/PostCompletionSection';
import ReceptionActions from './tabpedidos/ReceptionActions';
import FilterPill from './tabpedidos/FilterPill';
import { fetchBodegaBranchId, updateRutaStatus } from '../../data/pedidos';
import { usePedidosData } from './tabpedidos/usePedidosData';

// ─── Constants ───────────────────────────────────────────────────────────────

const GLASS = 'rounded-2xl border border-divider bg-surface-card backdrop-blur-sm shadow-[var(--shadow-glow-brand)]';
const PAGE_SIZE = 30;
const MINI_PAGE = 15;
const DONE_STATUSES = ['completado', 'parcial', 'anulado'];

// La tabla de color por sucursal vivía duplicada acá y en
// `tabpedidos/constants.js`. Se queda la de constants (la usa `SucPill`, que
// es quien pinta el chip); ésta no la usaba nadie. (2026-07-28, D3.5)

// Mismo lifecycle de despacho por sucursal que TabEnCurso.jsx — mismo
// criterio: pausado/erp son severidad real (excepción/completado), el
// resto es categórico puro.
const STAGE_CONFIG = {
    sin_iniciar: { label: 'Sin iniciar',     color: 'neutral', icon: Package      },
    preparando:  { label: 'En preparación',  color: 'chart-1', icon: Activity     },
    pausado:     { label: 'Pausado',         color: 'warning', icon: Pause        },
    preparado:   { label: 'Listo p/ envío',  color: 'chart-3', icon: CheckCircle2 },
    transito:    { label: 'En tránsito',     color: 'chart-5', icon: Truck        },
    contando:    { label: 'Cajas recibidas', color: 'chart-7', icon: PackageCheck },
    erp:         { label: 'Sis. Ventas',      color: 'success', icon: Database     },
};

const COLOR_CLS = {
    neutral: { bg: 'bg-surface-card-hover',  text: 'text-content-3',   border: 'border-border-card'   },
    warning: { bg: 'bg-warning/10',   text: 'text-warning-text',   border: 'border-warning/30'   },
    success: { bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30' },
    'chart-1': { bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30' },
    'chart-3': { bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30' },
    'chart-5': { bg: 'bg-chart-5/10', text: 'text-chart-5-text', border: 'border-chart-5/30' },
    'chart-7': { bg: 'bg-chart-7/10', text: 'text-chart-7-text', border: 'border-chart-7/30' },
};

const PEDIDO_PILL  = { confirmado: 'bg-chart-1/10 text-chart-1-text border-chart-1/30', enviado: 'bg-chart-3/10 text-chart-3-text border-chart-3/30', parcial: 'bg-warning/10 text-warning-text border-warning/30', completado: 'bg-success/10 text-success-text border-success/30', anulado: 'bg-danger/10 text-danger-text border-danger/30' };
const PEDIDO_LABEL = { confirmado: 'Por despachar', enviado: 'En ruta', parcial: 'Con diferencias', completado: 'Completado', anulado: 'Anulado' };

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
    const {
        user, isBranch, canEdit,
        erpSucursalId, branchName,
        filterSuc, setFilterSuc,
        filterStatus, setFilterStatus,
        filterDate, setFilterDate,
        activeRows,
        loading,
        expanded,
        items,
        eventosMap,
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
        handleResolverItem,
        filterOptions,
        hasObservacion,
        pedidoStageMap,
        filteredRows,
        sucursalCounts,
        renderGroups,
    } = usePedidosData({ searchTerm });

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="py-20"><SkeletonText lines={5} /></div>
        );
    }

    return (
        <div className="space-y-4 p-4">

            <AnimatePresence>
                {newAlert && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-chart-3/10 border border-chart-3/30 text-chart-3-text text-body-sm font-semibold shadow-sm">
                        <Send size={13} />¡Nuevo pedido #{newAlert.numero} en camino a {branchName}!
                        <Button variant="ghost" icon={X} iconOnly onClick={() => setNewAlert(null)} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── FILTROS + CARDS SUCURSALES ─────────────────────────── */}
            <div>
                {/* Fila única: cards por sucursal (izq) + FilterPill (der) */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    {/* Bodega / alcance todos: card clicable por sucursal */}
                    {!isBranch && sucursalCounts.map(({ id, name, total }) => {
                        const active = filterSuc === String(id);
                        return (
                            <StatCard
                                key={id}
                                icon={Building2} iconBg={active ? 'bg-surface-card' : 'bg-chart-3/10'} iconCls="text-chart-3-text"
                                label={name} sub="pedidos este mes"
                                value={total} valueCls={active ? 'text-chart-3-text' : 'text-content-2'}
                                active={active}
                                activeBg="bg-chart-3/10 border-chart-3/40 shadow-md"
                                onClick={() => setFilterSuc(v => v === String(id) ? '' : String(id))}
                            />
                        );
                    })}
                    {/* Sucursal (BRANCH): card propia, solo informativa */}
                    {isBranch && sucursalCounts.length > 0 && (() => {
                        const own = sucursalCounts[0];
                        return (
                            <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-divider bg-surface-card min-w-[130px]">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-chart-3/10">
                                    <Building2 size={15} className="text-chart-3-text" />
                                </div>
                                <div className="text-left">
                                    <div className="text-title-lg font-black leading-none tabular-nums text-content-2">{own.total}</div>
                                    <div className="text-caption font-bold text-content-2">{own.name}</div>
                                    <div className="text-micro text-content-3">pedidos este mes</div>
                                </div>
                            </div>
                        );
                    })()}
                    <div className="ml-auto">
                        <FilterPill isBranch={isBranch} filterSuc={filterSuc} setFilterSuc={setFilterSuc} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOptions={filterOptions} filterDate={filterDate} setFilterDate={setFilterDate} />
                    </div>
                </div>

                {filteredRows.length === 0 ? (
                    <EmptyState
                        compact
                        icon={Inbox}
                        iconClass="text-chart-1-text"
                        glowClass="bg-chart-1/30"
                        title="Sin pedidos activos"
                    />
                ) : (
                    <div className="space-y-3">
                    {renderGroups.map((group) => {
                        // Dentro de una ruta: no-entregadas primero (por orden), entregadas al fondo
                        const displayRows = group.isRuta
                            ? [...group.rows].sort((a, b) => {
                                const sa = pedidoRutaMap.get(a.pedido_id)?.stop;
                                const sb = pedidoRutaMap.get(b.pedido_id)?.stop;
                                const doneA = sa?.entregado_at ? 1 : 0;
                                const doneB = sb?.entregado_at ? 1 : 0;
                                if (doneA !== doneB) return doneA - doneB;
                                return (sa?.orden_entrega ?? 99) - (sb?.orden_entrega ?? 99);
                            })
                            : group.rows;
                        const cards = displayRows.map(row => {
                            const stage      = getBranchStage(row, row.pedido_status);
                            const cardKey    = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isExp      = expanded === cardKey;
                            const lcKey      = `lc_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isLCBusy   = busyLifecycle === lcKey;

                            const canActuar = canEdit && !isBranch; // GESTIONAR + Alcance TODOS

                            const canIniciar       = canActuar && !isBranch && stage === 'sin_iniciar' && row.pedido_status === 'confirmado';
                            const canPausar        = canActuar && !isBranch && stage === 'preparando';
                            const canReanudar      = canActuar && !isBranch && stage === 'pausado';
                            // Botón aparece por sucursal cuando esa ya está lista (preparado), sin esperar a las demás
                            const canMarcarEnRuta  = canActuar && !isBranch && stage === 'preparado' && row.pedido_status === 'confirmado';

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
                            const isApoyoBodega = prepApoyo.some(a => a.id === user?.id);

                            const canFinalizar = canActuar && !isBranch && stage === 'preparando';

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

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
                                    className={`${GLASS} cursor-pointer select-none ${
                                        stage === 'pausado'
                                            ? 'ring-2 ring-warning/45 shadow-[var(--shadow-glow-chart-7-lg)]'
                                            : hasObservacion(row) && row.pedido_status !== 'completado'
                                                ? 'ring-2 ring-chart-4/45 shadow-[var(--shadow-glow-chart-4)]'
                                                : isFadedOut
                                                    ? 'opacity-80'
                                                    : ''
                                    }`}
                                    style={{ overflow: 'visible' }}
                                    onClick={() => toggleExpand(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                >
                                    {/* Header */}
                                    <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
                                        {stage === 'pausado' && (
                                            <Badge variant="warning" tone="solid" uppercase={false}>⏸ Pausado</Badge>
                                        )}
                                        <span className="text-body font-black text-content tabular-nums shrink-0">
                                            {row.codigo ?? `#${row.numero}`}
                                        </span>
                                        <SucPill sucId={row.erp_sucursal_id} />
                                        <span className={`text-caption font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[row.pedido_status] ?? 'bg-surface-card-hover text-content-2 border-divider'}`}>
                                            {PEDIDO_LABEL[row.pedido_status] ?? row.pedido_status}
                                        </span>
                                        <span className="ml-auto text-caption text-content-3 tabular-nums shrink-0">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                        {isExp ? <ChevronDown size={13} className="text-content-3 shrink-0" /> : <ChevronRight size={13} className="text-content-3 shrink-0" />}
                                    </div>
                                    {row.notes && <p className="px-3 pb-1.5 text-label text-content-2 italic">{row.notes}</p>}

                                    {/* Stats pills */}
                                    {cardStats[cardKey] && (
                                        <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                            <Badge uppercase={false}>{cardStats[cardKey].enviados} enviados</Badge>
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

                                    {/* Apoyo preparación (bodega) */}
                                    {prepApoyo.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
                                            <span className="text-caption font-semibold text-content-2 uppercase tracking-wide shrink-0">Prep:</span>
                                            {prepApoyo.map(a => (
                                                <span key={a.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-surface-card border border-divider shadow-sm">
                                                    {a.photo_url
                                                        ? <img src={a.photo_url} alt={a.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                                                        : <span className="w-5 h-5 rounded-full bg-surface-card-hover flex items-center justify-center shrink-0"><UserCircle2 size={10} className="text-content-3" /></span>
                                                    }
                                                    <span className="text-label font-semibold text-content-2 whitespace-nowrap">{a.name}</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Lifecycle Timeline */}
                                    <div className="border-t border-divider px-3 pt-2 pb-1.5">
                                        {(() => {
                                            const rutaInfo = pedidoRutaMap.get(row.pedido_id);
                                            const rtStop   = rutaInfo?.stop ?? null;
                                            const rtCond   = rutaInfo?.ruta?.conductor_id ? empMap.get(rutaInfo.ruta.conductor_id) ?? null : null;
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
                                        {(row.cajas_electrolit ?? 0) > 0 && (
                                            <Badge icon={Inbox} uppercase={false}>{row.cajas_electrolit} Electrolit</Badge>
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
                                            {canApoyo && !isApoyoBodega && (
                                                <Button variant="secondary" icon={UserPlus} disabled={isLCBusy} onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey, tipo: 'preparacion' })}>Apoyo</Button>
                                            )}
                                            {canActuar && (
                                                <Button variant="secondary" disabled={printingPdf === row.pedido_id} onClick={e => { e.stopPropagation(); handlePrintPdf(row.pedido_id, row.numero, row.erp_sucursal_id, cardKey, row.codigo); }}>{printingPdf === row.pedido_id ? <Loader2 size={10} className="animate-spin" /> : <FileDown size={10} />}PDF</Button>
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
                                            {pedidoRutaMap.has(row.pedido_id) && (() => {
                                                const { ruta, stop } = pedidoRutaMap.get(row.pedido_id);
                                                const isConductorHere = !!(user?.id && ruta.conductor_id && user.id === ruta.conductor_id);
                                                if (!isConductorHere || !!stop?.entregado_at || ruta.status !== 'en_ruta') return null;
                                                return (
                                                    <Button tone="success" icon={CheckCircle2} onClick={e => { e.stopPropagation(); handleEntregarStop(stop.id, ruta.id, stop.erp_sucursal_id); }}>Entregué</Button>
                                                );
                                            })()}
                                            {canIniciar      && <Button tone="chart-1" disabled={isLCBusy} onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}>{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Play     size={10} fill="currentColor" />Iniciar</>}</Button>}
                                            {canPausar       && <Button tone="warning" disabled={isLCBusy} onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}>{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Pause    size={10} fill="currentColor" />Pausar</>}</Button>}
                                            {canFinalizar    && <Button tone="chart-6" disabled={isLCBusy || busyAction === `finalizar_load_${cardKey}`} onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)}>{(isLCBusy || busyAction === `finalizar_load_${cardKey}`) ? <Loader2 size={11} className="animate-spin" /> : <><Flag size={10} />Finalizar</>}</Button>}
                                            {canReanudar     && <Button tone="success" disabled={isLCBusy} onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}>{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><RotateCcw size={10} />Reanudar</>}</Button>}
                                            {canAnular && (
                                                <Button variant="destructive" icon={Ban} onClick={e => { e.stopPropagation(); const st = pedidoStageMap.get(row.pedido_id) ?? {}; setAnularModal({ pedidoId: row.pedido_id, numero: row.numero, requiresReason: !!(st.anyActive) }); }}>Anular</Button>
                                            )}
                                            {canMarcarEnRuta && <Button tone="chart-3" icon={Truck} onClick={() => setCrearRutaOpen([])}>Crear Ruta</Button>}
                                            {(() => {
                                                const hasElecFaltantes = (row.electrolit_faltantes ?? 0) > 0 && row.electrolit_ok !== true;
                                                const hasEspFaltantes  = Object.values(row.cajas_especiales_llegadas ?? {}).some(v => v === 'faltante');
                                                const hasPendingFalta  = (row.falta_cajas ?? []).length > 0 || hasElecFaltantes || hasEspFaltantes;
                                                const reenvioEnCamino  = (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at);
                                                const rutaActiva       = pedidoRutaMap.get(row.pedido_id)?.ruta;
                                                const conductorEnRuta  = rutaActiva?.status === 'en_ruta' && !rutaActiva?.vuelta_base_at;
                                                if (!canActuar || isBranch || !hasPendingFalta || reenvioEnCamino) return null;
                                                if (conductorEnRuta) return (
                                                    <div className="flex items-center gap-1 text-caption font-semibold text-content-3 px-2.5 py-1.5 rounded-xl border border-divider bg-surface-card cursor-not-allowed" title="El conductor aún está en ruta. Esperá a que marque vuelta a base.">
                                                        <Truck size={10} className="text-content-3" />Esperando vuelta conductor
                                                    </div>
                                                );
                                                const espFaltList = Object.entries(row.cajas_especiales_llegadas ?? {}).filter(([, v]) => v === 'faltante').map(([k]) => k);
                                                return (
                                                    <Button variant="destructive" disabled={busyAction === 'reenvio'} onClick={() => setReenviarConfirmModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, cajas: row.falta_cajas ?? [], electrolits: hasElecFaltantes ? (row.electrolit_faltantes ?? 0) : 0, especiales: espFaltList })}>{busyAction === 'reenvio' ? <Loader2 size={10} className="animate-spin" /> : <><Truck size={10} />Reenviar caja</>}</Button>
                                                );
                                            })()}
                                        </div>
                                    </div>


                                    {/* Entrega estimada — visible en sucursal cuando hay programación y el pedido no ha llegado */}
                                    {isBranch && row.entrega_programada_at && stage !== 'erp' && stage !== 'contando' && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-chart-3/30 bg-chart-3/10">
                                            <CalendarClock size={11} className="text-chart-3-text shrink-0" />
                                            <span className="text-caption font-semibold text-chart-3-text">Entrega estimada:</span>
                                            <span className="text-caption font-bold text-chart-3-text">{fmtEntrega(row.entrega_programada_at)}</span>
                                        </div>
                                    )}

                                    {/* Recepción — enviado, o parcial con reenvío aún en camino */}
                                    {isBranch && erpSucursalId && (row.pedido_status === 'enviado' || (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at)) && stage !== 'erp' && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <ReceptionActions
                                                llegadaOk={!!llegadaStatus[cardKey] || !!row.llegada_fisica_at}
                                                erpOk={!!erpStatus[cardKey] || !!row.recibido_erp_at}
                                                llegadaEmp={llegadaEmp}
                                                erpEmp={erpEmp}
                                                cardApoyo={recepApoyo}
                                                pendientesCount={cardStats[cardKey]?.pendientes ?? 0}
                                                onMarkLlegada={() => handleLlegada(row.pedido_id, erpSucursalId, cardKey)}
                                                onOpenRecibir={() => openModal(row.pedido_id, row.numero, row.codigo, erpSucursalId, cardKey)}
                                                onOpenReenvioModal={() => openReenvioModal(row.pedido_id, row.numero, row.codigo, erpSucursalId, cardKey)}
                                                onSegundaLlegada={() => handleSegundaLlegada(row.pedido_id, erpSucursalId, cardKey, row.reenvios_historial ?? [], row.falta_cajas ?? [], row.caja_map ?? {})}
                                                onApoyo={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: erpSucursalId, cardKey, tipo: 'recepcion' })}
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
                                                isBranch={isBranch}
                                                busyAction={busyAction}
                                                empMap={empMap}
                                                readOnly={row.pedido_status === 'completado'}
                                                onNeedItems={() => fetchItems(cardKey, row.pedido_id, row.erp_sucursal_id)}
                                                itemsLoaded={!!items[cardKey]}
                                                onResolver={(itemId, action, tipo, nota) =>
                                                    handleResolverItem(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, itemId, action, tipo, nota)
                                                }
                                                onCorregirBodega={(nota) =>
                                                    handleCorregirBodega(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, nota)
                                                }
                                                onConfirmarCorreccion={() =>
                                                    handleConfirmarCorreccion(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id)
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
                                                <ItemSections allItems={items[cardKey] ?? []} loading={loadingItems && !items[cardKey]} />
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
                            return (
                                <div key={ruta.id} className={`rounded-2xl border overflow-hidden bg-surface-card shadow-[var(--shadow-glow-chart-3-md)] ${isCompletada ? 'border-border-card' : 'border-chart-3/30'}`}>
                                    {/* Header sin color — glass */}
                                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-divider bg-surface-card" onClick={e => e.stopPropagation()}>
                                        {/* Foto/icono conductor */}
                                        <div className="relative shrink-0">
                                            {conductorEmp?.photo
                                                ? <img src={conductorEmp.photo} alt={conductorEmp.name} className="w-7 h-7 rounded-xl object-cover border border-divider" />
                                                : <div className={`w-7 h-7 rounded-xl flex items-center justify-center border ${isCompletada ? 'bg-surface-card-hover border-border-card' : 'bg-chart-3/10 border-chart-3/30'}`}>
                                                    <Truck size={13} className={isCompletada ? 'text-content-3' : 'text-chart-3-text'} />
                                                  </div>
                                            }
                                            {dl && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-surface-card animate-pulse" />}
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-body font-black ${isCompletada ? 'text-content-2' : 'text-chart-3-text'}`}>Ruta #{ruta.numero}</span>
                                                {isCompletada
                                                    ? <Badge variant="success" size="sm" uppercase={false}>✓ Completada{ruta.vuelta_base_at ? ` · ${fmtT(ruta.vuelta_base_at)}` : ''}</Badge>
                                                    : dl && <Badge variant="success" size="sm" uppercase={false}>🟢 En vivo</Badge>
                                                }
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-label text-content-3">{ruta.conductor_nombre}</span>
                                                <span className="text-caption text-content-3 tabular-nums">{entregadas}/{total} entregas</span>
                                            </div>
                                        </div>
                                        {/* Acciones */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isConductorRuta && ruta.status === 'pendiente' && (
                                                <Button tone="chart-3" icon={Play} onClick={async () => {
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'en_ruta', salida_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
                                                            loadActiveRutas();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo iniciar la ruta. Intenta de nuevo.', 'error'); }
                                                    }}>Iniciar</Button>
                                            )}
                                            {isConductorRuta && ruta.status === 'en_ruta' && entregadas === total && total > 0 && (
                                                <Button tone="chart-8" icon={Home} onClick={async () => {
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'completada', vuelta_base_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
                                                            loadActiveRutas(); loadActive();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo completar la ruta. Intenta de nuevo.', 'error'); }
                                                    }}>Base</Button>
                                            )}
                                            {!isCompletada && (
                                                <Button variant="secondary" icon={MapIcon} onClick={() => setRutaMapOpen(ruta)}>Mapa</Button>
                                            )}
                                        </div>
                                        {/* Barra de progreso solo cuando activa */}
                                        {!isCompletada && (
                                            <div className="w-16 h-1.5 rounded-full bg-surface-card-hover overflow-hidden shrink-0">
                                                <div className="h-full bg-chart-3 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
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
                    cajasRecibidas={modal.cajasRecibidas ?? []}
                    faltaCajas={modal.faltaCajas     ?? []}
                    hasFaltaItems={modal.hasFaltaItems ?? false}
                    especialesLlegadas={modal.especialesLlegadas ?? {}}
                    onConfirmed={async ({ hasDiff, allDone }) => {
                        const { pedido, sucId, key } = modal;
                        setModal(null);
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
                                    ? `${branchName} reporta diferencias en la recepción del pedido #${pedido.numero}. Revisá y marcalo como corregido.`
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

            {/* ── Confirmación Reenviar Caja ─────────────────────────────────────── */}
            {reenviarConfirmModal && (
                <PedidoModal open onClose={() => setReenviarConfirmModal(null)} maxWidth="max-w-xs">
                    <div className="px-5 pt-5 pb-4 border-b border-border-card">
                        <h3 className="text-subtitle font-black text-content">¿Confirmar reenvío?</h3>
                        <p className="text-label text-content-3 mt-0.5">Pedido #{reenviarConfirmModal.numero}</p>
                    </div>
                    <div className="px-5 py-4 space-y-2">
                        <p className="text-label font-semibold text-content-2 uppercase tracking-wide mb-1">Pendiente de enviar:</p>
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
                    <div className="px-5 pb-5 pt-2 flex gap-2 justify-end border-t border-border-card">
                        <Button variant="secondary" onClick={() => setReenviarConfirmModal(null)}>Cancelar</Button>
                        <Button variant="destructive" disabled={busyAction === 'reenvio'} onClick={() => {
                                const { pedidoId, sucId, numero, cajas, electrolits, especiales } = reenviarConfirmModal;
                                setReenviarConfirmModal(null);
                                handleReenviarCaja(pedidoId, sucId, numero, cajas, electrolits, especiales);
                            }}>{busyAction === 'reenvio' ? <Loader2 size={12} className="animate-spin" /> : <><Truck size={12} />Confirmar reenvío</>}</Button>
                    </div>
                </PedidoModal>
            )}
        </div>
    );
}
