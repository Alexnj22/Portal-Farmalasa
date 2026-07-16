import React from 'react';
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

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';
const PAGE_SIZE = 30;
const MINI_PAGE = 15;
const DONE_STATUSES = ['completado', 'parcial', 'anulado'];

const SUC_COLORS = {
    1: 'bg-blue-100 text-blue-700 border-blue-200',
    2: 'bg-violet-100 text-violet-700 border-violet-200',
    3: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    4: 'bg-amber-100 text-amber-700 border-amber-200',
    5: 'bg-rose-100 text-rose-700 border-rose-200',
    6: 'bg-slate-100 text-slate-600 border-slate-200',
    7: 'bg-teal-100 text-teal-700 border-teal-200',
};

const STAGE_CONFIG = {
    sin_iniciar: { label: 'Sin iniciar',     color: 'slate',   icon: Package      },
    preparando:  { label: 'En preparación',  color: 'blue',    icon: Activity     },
    pausado:     { label: 'Pausado',         color: 'amber',   icon: Pause        },
    preparado:   { label: 'Listo p/ envío',  color: 'violet',  icon: CheckCircle2 },
    transito:    { label: 'En tránsito',     color: 'indigo',  icon: Truck        },
    contando:    { label: 'Cajas recibidas', color: 'teal',    icon: PackageCheck },
    erp:         { label: 'Sis. Ventas',      color: 'emerald', icon: Database     },
};

const COLOR_CLS = {
    slate:   { bg: 'bg-slate-100',  text: 'text-slate-500',   border: 'border-slate-200'   },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200'  },
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200'  },
    teal:    { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200'    },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
};

const PEDIDO_PILL  = { confirmado: 'bg-blue-100 text-blue-700 border-blue-200', enviado: 'bg-indigo-100 text-indigo-700 border-indigo-200', parcial: 'bg-amber-100 text-amber-700 border-amber-200', completado: 'bg-emerald-100 text-emerald-700 border-emerald-200', anulado: 'bg-red-100 text-red-600 border-red-200' };
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
            <div className="flex items-center justify-center py-20 gap-2 text-slate-500">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando pedidos…</span>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">

            <AnimatePresence>
                {newAlert && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-[12px] font-semibold shadow-sm">
                        <Send size={13} />¡Nuevo pedido #{newAlert.numero} en camino a {branchName}!
                        <button onClick={() => setNewAlert(null)} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={13} /></button>
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
                            <button
                                key={id}
                                onClick={() => setFilterSuc(v => v === String(id) ? '' : String(id))}
                                className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${
                                    active
                                        ? 'bg-indigo-50 border-indigo-300 shadow-md shadow-indigo-100/80 -translate-y-px'
                                        : 'bg-white border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/40'
                                }`}
                            >
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-white' : 'bg-indigo-50'}`}>
                                    <Building2 size={15} className="text-indigo-600" />
                                </div>
                                <div className="text-left">
                                    <div className={`text-[22px] font-black leading-none tabular-nums ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{total}</div>
                                    <div className="text-[10px] font-bold text-slate-600">{name}</div>
                                    <div className="text-[9px] text-slate-500">pedidos este mes</div>
                                </div>
                                {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                            </button>
                        );
                    })}
                    {/* Sucursal (BRANCH): card propia, solo informativa */}
                    {isBranch && sucursalCounts.length > 0 && (() => {
                        const own = sucursalCounts[0];
                        return (
                            <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[130px]">
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-50">
                                    <Building2 size={15} className="text-indigo-600" />
                                </div>
                                <div className="text-left">
                                    <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">{own.total}</div>
                                    <div className="text-[10px] font-bold text-slate-600">{own.name}</div>
                                    <div className="text-[9px] text-slate-500">pedidos este mes</div>
                                </div>
                            </div>
                        );
                    })()}
                    <div className="ml-auto">
                        <FilterPill isBranch={isBranch} filterSuc={filterSuc} setFilterSuc={setFilterSuc} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOptions={filterOptions} filterDate={filterDate} setFilterDate={setFilterDate} />
                    </div>
                </div>

                {filteredRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[260px] animate-in fade-in zoom-in-95 duration-700">
                        <div className="relative flex flex-col items-center text-center">
                            <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-20 bg-blue-400" />
                            <div className="relative z-10 w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-4 bg-white/70 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] text-blue-400">
                                <Inbox size={34} strokeWidth={1.5} />
                            </div>
                            <h3 className="font-bold text-[18px] text-slate-700 tracking-tight">Sin pedidos activos</h3>
                        </div>
                    </div>
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
                                            ? 'ring-2 ring-amber-400 shadow-[0_4px_20px_rgba(251,191,36,0.25)]'
                                            : hasObservacion(row) && row.pedido_status !== 'completado'
                                                ? 'ring-2 ring-orange-400 shadow-[0_4px_20px_rgba(249,115,22,0.18)]'
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
                                            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-white shrink-0 shadow-sm animate-pulse">
                                                ⏸ Pausado
                                            </span>
                                        )}
                                        <span className="text-[13px] font-black text-slate-800 tabular-nums shrink-0">
                                            {row.codigo ?? `#${row.numero}`}
                                        </span>
                                        <SucPill sucId={row.erp_sucursal_id} />
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[row.pedido_status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                            {PEDIDO_LABEL[row.pedido_status] ?? row.pedido_status}
                                        </span>
                                        <span className="ml-auto text-[10px] text-slate-500 tabular-nums shrink-0">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                        {isExp ? <ChevronDown size={13} className="text-slate-500 shrink-0" /> : <ChevronRight size={13} className="text-slate-500 shrink-0" />}
                                    </div>
                                    {row.notes && <p className="px-3 pb-1.5 text-[11px] text-slate-600 italic">{row.notes}</p>}

                                    {/* Stats pills */}
                                    {cardStats[cardKey] && (
                                        <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                {cardStats[cardKey].enviados} enviados
                                            </span>
                                            {(cardStats[cardKey].agotamiento ?? 0) > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                    {cardStats[cardKey].agotamiento} stock insuf.
                                                </span>
                                            )}
                                            {cardStats[cardKey].sinStock > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                    {cardStats[cardKey].sinStock} sin stock
                                                </span>
                                            )}
                                            {cardStats[cardKey].porRegla > 0 && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                    <AlertTriangle size={9} />{cardStats[cardKey].porRegla} por regla
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Apoyo preparación (bodega) */}
                                    {prepApoyo.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
                                            <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide shrink-0">Prep:</span>
                                            {prepApoyo.map(a => (
                                                <span key={a.id} className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-white border border-slate-200 shadow-sm">
                                                    {a.photo_url
                                                        ? <img src={a.photo_url} alt={a.name} className="w-5 h-5 rounded-full object-cover shrink-0" />
                                                        : <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center shrink-0"><UserCircle2 size={10} className="text-slate-500" /></span>
                                                    }
                                                    <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">{a.name}</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Lifecycle Timeline */}
                                    <div className="border-t border-slate-100 px-3 pt-2 pb-1.5">
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
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 tabular-nums shrink-0">
                                                <Box size={10} className="text-slate-500 shrink-0" />
                                                {row.total_cajas} caja{row.total_cajas !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                        {(row.cajas_electrolit ?? 0) > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 tabular-nums shrink-0">
                                                <Inbox size={10} className="text-slate-400 shrink-0" />
                                                {row.cajas_electrolit} Electrolit
                                            </span>
                                        )}
                                        {row.electrolit_ok === false && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                                <Zap size={8} className="shrink-0" />
                                                {(row.electrolit_faltantes ?? 0) > 0
                                                    ? `${row.electrolit_faltantes} Electrolit faltante${row.electrolit_faltantes > 1 ? 's' : ''}`
                                                    : 'Electrolit faltante'}
                                            </span>
                                        )}
                                        {(row.cajas_especiales ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 tabular-nums shrink-0">
                                                <Star size={10} className="text-slate-500 shrink-0" />
                                                {row.cajas_especiales.length} caja{row.cajas_especiales.length > 1 ? 's' : ''} especial{row.cajas_especiales.length > 1 ? 'es' : ''}
                                            </span>
                                        )}
                                        {(row.cajas_danadas ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
                                                <AlertTriangle size={8} /> Dañada{row.cajas_danadas.length > 1 ? 's' : ''}: {row.cajas_danadas.map(n => `#${n}`).join(', ')}
                                            </span>
                                        )}
                                        {(row.falta_cajas ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 shrink-0">
                                                <Package size={8} /> Faltante{row.falta_cajas.length > 1 ? 's' : ''}: {row.falta_cajas.map(n => `#${n}`).join(', ')}
                                            </span>
                                        )}
                                        {row.pedido_status === 'parcial' && !(row.cajas_danadas?.length > 0 || row.falta_cajas?.length > 0) && row.pedido_status !== 'completado' && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                                <ClipboardList size={8} /> Difs. pendientes
                                            </span>
                                        )}
                                        {elapsedPrep  && <span className="text-[10px] text-slate-600 tabular-nums">{elapsedPrep}</span>}
                                        {elapsedPause && (
                                            <span className="text-[10px] text-amber-700 font-semibold tabular-nums animate-pulse">
                                                {elapsedPause} en pausa
                                            </span>
                                        )}
                                        {elapsedTrans && <span className="text-[10px] text-indigo-600 tabular-nums">{elapsedTrans} en ruta</span>}
                                        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                                            {canApoyo && !isApoyoBodega && (
                                                <button
                                                    onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey, tipo: 'preparacion' })}
                                                    disabled={isLCBusy}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-[0.97] transition-all disabled:opacity-50"
                                                >
                                                    <UserPlus size={10} />Apoyo
                                                </button>
                                            )}
                                            {canActuar && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handlePrintPdf(row.pedido_id, row.numero, row.erp_sucursal_id, cardKey, row.codigo); }}
                                                    disabled={printingPdf === row.pedido_id}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-[0.97] transition-all disabled:opacity-50"
                                                >
                                                    {printingPdf === row.pedido_id ? <Loader2 size={10} className="animate-spin" /> : <FileDown size={10} />}PDF
                                                </button>
                                            )}
                                            {canActuar && !isBranch && stage === 'preparado' && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); setProgramarModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, currentAt: row.entrega_programada_at ?? null, historial: row.entrega_programada_historial ?? [] }); }}
                                                    className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl active:scale-[0.97] transition-all ${row.entrega_programada_at ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}`}
                                                >
                                                    <CalendarClock size={10} />
                                                    {row.entrega_programada_at ? fmtEntrega(row.entrega_programada_at) : 'Programar'}
                                                </button>
                                            )}
                                            {/* Entregué — conductor, junto a PDF para ahorrar espacio */}
                                            {pedidoRutaMap.has(row.pedido_id) && (() => {
                                                const { ruta, stop } = pedidoRutaMap.get(row.pedido_id);
                                                const isConductorHere = !!(user?.id && ruta.conductor_id && user.id === ruta.conductor_id);
                                                if (!isConductorHere || !!stop?.entregado_at || ruta.status !== 'en_ruta') return null;
                                                return (
                                                    <button onClick={e => { e.stopPropagation(); handleEntregarStop(stop.id, ruta.id, stop.erp_sucursal_id); }}
                                                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all shadow-sm">
                                                        <CheckCircle2 size={10} />Entregué
                                                    </button>
                                                );
                                            })()}
                                            {canIniciar      && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}   disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-blue-500    text-white hover:bg-blue-600    active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Play     size={10} fill="currentColor" />Iniciar</>}</button>}
                                            {canPausar       && <button onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}               disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-amber-400   text-white hover:bg-amber-500   active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Pause    size={10} fill="currentColor" />Pausar</>}</button>}
                                            {canFinalizar    && <button onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)} disabled={isLCBusy || busyAction === `finalizar_load_${cardKey}`} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-violet-500  text-white hover:bg-violet-600  active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{(isLCBusy || busyAction === `finalizar_load_${cardKey}`) ? <Loader2 size={11} className="animate-spin" /> : <><Flag size={10} />Finalizar</>}</button>}
                                            {canReanudar     && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}  disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><RotateCcw size={10} />Reanudar</>}</button>}
                                            {canAnular && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); const st = pedidoStageMap.get(row.pedido_id) ?? {}; setAnularModal({ pedidoId: row.pedido_id, numero: row.numero, requiresReason: !!(st.anyActive) }); }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-red-100 text-red-600 hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500 active:scale-[0.97] transition-all shadow-sm"
                                                >
                                                    <Ban size={10} />Anular
                                                </button>
                                            )}
                                            {canMarcarEnRuta && <button onClick={() => setCrearRutaOpen([])} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-[0.97] transition-all shadow-sm"><Truck size={10} />Crear Ruta</button>}
                                            {(() => {
                                                const hasElecFaltantes = (row.electrolit_faltantes ?? 0) > 0 && row.electrolit_ok !== true;
                                                const hasEspFaltantes  = Object.values(row.cajas_especiales_llegadas ?? {}).some(v => v === 'faltante');
                                                const hasPendingFalta  = (row.falta_cajas ?? []).length > 0 || hasElecFaltantes || hasEspFaltantes;
                                                const reenvioEnCamino  = (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at);
                                                const rutaActiva       = pedidoRutaMap.get(row.pedido_id)?.ruta;
                                                const conductorEnRuta  = rutaActiva?.status === 'en_ruta' && !rutaActiva?.vuelta_base_at;
                                                if (!canActuar || isBranch || !hasPendingFalta || reenvioEnCamino) return null;
                                                if (conductorEnRuta) return (
                                                    <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white/70 cursor-not-allowed" title="El conductor aún está en ruta. Esperá a que marque vuelta a base.">
                                                        <Truck size={10} className="text-slate-500" />Esperando vuelta conductor
                                                    </div>
                                                );
                                                const espFaltList = Object.entries(row.cajas_especiales_llegadas ?? {}).filter(([, v]) => v === 'faltante').map(([k]) => k);
                                                return (
                                                    <button onClick={() => setReenviarConfirmModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, cajas: row.falta_cajas ?? [], electrolits: hasElecFaltantes ? (row.electrolit_faltantes ?? 0) : 0, especiales: espFaltList })} disabled={busyAction === 'reenvio'} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm">
                                                        {busyAction === 'reenvio' ? <Loader2 size={10} className="animate-spin" /> : <><Truck size={10} />Reenviar caja</>}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    </div>


                                    {/* Entrega estimada — visible en sucursal cuando hay programación y el pedido no ha llegado */}
                                    {isBranch && row.entrega_programada_at && stage !== 'erp' && stage !== 'contando' && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-indigo-100 bg-indigo-50/60">
                                            <CalendarClock size={11} className="text-indigo-500 shrink-0" />
                                            <span className="text-[10px] font-semibold text-indigo-700">Entrega estimada:</span>
                                            <span className="text-[10px] font-bold text-indigo-600">{fmtEntrega(row.entrega_programada_at)}</span>
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
                                <div key={ruta.id} className={`rounded-2xl border overflow-hidden bg-white/70 shadow-[0_2px_16px_rgba(99,102,241,0.08)] ${isCompletada ? 'border-slate-200/80' : 'border-indigo-200/80'}`}>
                                    {/* Header sin color — glass */}
                                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100/80 bg-white/60" onClick={e => e.stopPropagation()}>
                                        {/* Foto/icono conductor */}
                                        <div className="relative shrink-0">
                                            {conductorEmp?.photo
                                                ? <img src={conductorEmp.photo} alt={conductorEmp.name} className="w-7 h-7 rounded-xl object-cover border border-slate-200" />
                                                : <div className={`w-7 h-7 rounded-xl flex items-center justify-center border ${isCompletada ? 'bg-slate-100 border-slate-200' : 'bg-indigo-50 border-indigo-100'}`}>
                                                    <Truck size={13} className={isCompletada ? 'text-slate-500' : 'text-indigo-600'} />
                                                  </div>
                                            }
                                            {dl && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />}
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[13px] font-black ${isCompletada ? 'text-slate-600' : 'text-indigo-800'}`}>Ruta #{ruta.numero}</span>
                                                {isCompletada
                                                    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                                                        ✓ Completada{ruta.vuelta_base_at ? ` · ${fmtT(ruta.vuelta_base_at)}` : ''}
                                                      </span>
                                                    : dl && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">🟢 En vivo</span>
                                                }
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-[11px] text-slate-500">{ruta.conductor_nombre}</span>
                                                <span className="text-[10px] text-slate-500 tabular-nums">{entregadas}/{total} entregas</span>
                                            </div>
                                        </div>
                                        {/* Acciones */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isConductorRuta && ruta.status === 'pendiente' && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'en_ruta', salida_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
                                                            loadActiveRutas();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo iniciar la ruta. Intenta de nuevo.', 'error'); }
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.97] transition-all shadow-sm"
                                                >
                                                    <Play size={9} fill="currentColor" />Iniciar
                                                </button>
                                            )}
                                            {isConductorRuta && ruta.status === 'en_ruta' && entregadas === total && total > 0 && (
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const { error } = await updateRutaStatus(ruta.id, { status: 'completada', vuelta_base_at: new Date().toISOString() });
                                                            if (error) throw error;
                                                            useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
                                                            loadActiveRutas(); loadActive();
                                                        } catch { useToastStore.getState().showToast('Error', 'No se pudo completar la ruta. Intenta de nuevo.', 'error'); }
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-700 text-white hover:bg-slate-800 active:scale-[0.97] transition-all shadow-sm"
                                                >
                                                    <Home size={9} />Base
                                                </button>
                                            )}
                                            {!isCompletada && (
                                                <button
                                                    onClick={() => setRutaMapOpen(ruta)}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 active:scale-[0.97] transition-all"
                                                >
                                                    <MapIcon size={9} />Mapa
                                                </button>
                                            )}
                                        </div>
                                        {/* Barra de progreso solo cuando activa */}
                                        {!isCompletada && (
                                            <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden shrink-0">
                                                <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
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
                    <div className="px-5 pt-5 pb-4 border-b border-white/40">
                        <h3 className="text-[15px] font-black text-slate-800">¿Confirmar reenvío?</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">Pedido #{reenviarConfirmModal.numero}</p>
                    </div>
                    <div className="px-5 py-4 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Pendiente de enviar:</p>
                        {reenviarConfirmModal.cajas.length > 0 && (
                            <div className="flex items-center gap-2 text-[12px] text-slate-700">
                                <Box size={13} className="text-rose-500 shrink-0" />
                                <span>Caja{reenviarConfirmModal.cajas.length > 1 ? 's' : ''}: {reenviarConfirmModal.cajas.map(n => `#${n}`).join(', ')}</span>
                            </div>
                        )}
                        {reenviarConfirmModal.electrolits > 0 && (
                            <div className="flex items-center gap-2 text-[12px] text-slate-700">
                                <Inbox size={13} className="text-amber-500 shrink-0" />
                                <span>{reenviarConfirmModal.electrolits} Electrolit faltante{reenviarConfirmModal.electrolits > 1 ? 's' : ''}</span>
                            </div>
                        )}
                        {reenviarConfirmModal.especiales.length > 0 && (
                            <div className="flex items-center gap-2 text-[12px] text-slate-700">
                                <Star size={13} className="text-violet-500 shrink-0" />
                                <span>Especial{reenviarConfirmModal.especiales.length > 1 ? 'es' : ''}: {reenviarConfirmModal.especiales.join(', ')}</span>
                            </div>
                        )}
                    </div>
                    <div className="px-5 pb-5 pt-2 flex gap-2 justify-end border-t border-white/40">
                        <button onClick={() => setReenviarConfirmModal(null)} className="text-[12px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100/80 transition-all">
                            Cancelar
                        </button>
                        <button
                            disabled={busyAction === 'reenvio'}
                            onClick={() => {
                                const { pedidoId, sucId, numero, cajas, electrolits, especiales } = reenviarConfirmModal;
                                setReenviarConfirmModal(null);
                                handleReenviarCaja(pedidoId, sucId, numero, cajas, electrolits, especiales);
                            }}
                            className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-2 rounded-xl bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm"
                        >
                            {busyAction === 'reenvio' ? <Loader2 size={12} className="animate-spin" /> : <><Truck size={12} />Confirmar reenvío</>}
                        </button>
                    </div>
                </PedidoModal>
            )}
        </div>
    );
}
