import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle, Ban,
    Truck, Pause, PackageCheck,
    Database, Activity, TrendingDown,
    RefreshCw, PackagePlus, X, Send, CheckCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import RecepcionModal from './RecepcionModal';
import { ERP_NAMES } from '../../constants/erp';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ───────────────────────────────────────────────────────────────

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const PAGE_SIZE = 30;
const ACTIVE_STATUSES = ['confirmado', 'enviado'];
const DONE_STATUSES   = ['completado', 'parcial', 'anulado'];

const STAGE_CONFIG = {
    sin_iniciar: { label: 'Sin iniciar',      color: 'slate',   icon: Package      },
    preparando:  { label: 'En preparación',   color: 'blue',    icon: Activity     },
    pausado:     { label: 'Pausado',          color: 'amber',   icon: Pause        },
    preparado:   { label: 'Listo p/ envío',   color: 'violet',  icon: CheckCircle2 },
    transito:    { label: 'En tránsito',      color: 'indigo',  icon: Truck        },
    contando:    { label: 'Cajas recibidas',  color: 'teal',    icon: PackageCheck },
    erp:         { label: 'En ERP',           color: 'emerald', icon: Database     },
};

const COLOR_CLS = {
    slate:   { bg: 'bg-slate-100',   text: 'text-slate-500',   border: 'border-slate-200'   },
    blue:    { bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200'    },
    amber:   { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200'   },
    violet:  { bg: 'bg-violet-50',   text: 'text-violet-700',  border: 'border-violet-200'  },
    indigo:  { bg: 'bg-indigo-50',   text: 'text-indigo-700',  border: 'border-indigo-200'  },
    teal:    { bg: 'bg-teal-50',     text: 'text-teal-700',    border: 'border-teal-200'    },
    emerald: { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
};

const PEDIDO_PILL = {
    confirmado: 'bg-blue-100 text-blue-700 border-blue-200',
    enviado:    'bg-indigo-100 text-indigo-700 border-indigo-200',
    parcial:    'bg-amber-100 text-amber-700 border-amber-200',
    completado: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    anulado:    'bg-red-100 text-red-600 border-red-200',
};

const PEDIDO_LABEL = {
    confirmado: 'Por despachar',
    enviado:    'En camino',
    parcial:    'Con diferencias',
    completado: 'Completado',
    anulado:    'Anulado',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function fmtMin(min) {
    if (min == null || min < 0) return null;
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function elapsed(isoFrom, isoTo = null) {
    if (!isoFrom) return null;
    const from = new Date(isoFrom);
    const to   = isoTo ? new Date(isoTo) : new Date();
    return Math.floor((to - from) / 60_000);
}

function fmtRelative(iso) {
    if (!iso) return '—';
    const min = elapsed(iso);
    if (min < 1)   return 'ahora';
    if (min < 60)  return `hace ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24)    return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
}

function getBranchStage(row, pedidoStatus) {
    if (!row) return 'sin_iniciar';
    if (row.recibido_erp_at)                              return 'erp';
    if (row.llegada_fisica_at)                            return 'contando';
    if (row.finalizado_at && pedidoStatus === 'enviado')  return 'transito';
    if (row.finalizado_at)                                return 'preparado';
    if (row.pausado_at && !row.reanudado_at)              return 'pausado';
    if (row.iniciado_at)                                  return 'preparando';
    return 'sin_iniciar';
}

// ─── Animations ──────────────────────────────────────────────────────────────

function MotorcycleAnim() {
    return (
        <motion.div
            className="text-indigo-400"
            animate={{ x: [0, 6, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        >
            <svg width="26" height="16" viewBox="0 0 52 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="26" r="6" />
                <circle cx="42" cy="26" r="6" />
                <path d="M10 20 L18 10 L30 10 L38 20 L42 20" />
                <path d="M26 10 L24 4 L36 4" />
                <path d="M30 10 L34 7 L40 7" />
                <circle cx="22" cy="7" r="3" fill="currentColor" opacity="0.6" />
                <path d="M22 10 L20 16 L28 16" />
                {/* motion lines */}
                <motion.path
                    d="M2 22 L6 22"
                    opacity="0.4"
                    animate={{ opacity: [0.2, 0.7, 0.2], x: [-2, 0, -2] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                />
                <motion.path
                    d="M1 26 L5 26"
                    opacity="0.3"
                    animate={{ opacity: [0.1, 0.5, 0.1], x: [-2, 0, -2] }}
                    transition={{ duration: 0.9, repeat: Infinity, delay: 0.15 }}
                />
            </svg>
        </motion.div>
    );
}

function BoxStackAnim() {
    return (
        <div className="relative w-6 h-5 shrink-0">
            <motion.div
                className="absolute bottom-0 left-0 w-5 h-3 rounded bg-blue-200 border border-blue-300"
                animate={{ y: [0, -1, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: 0.2, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute bottom-[9px] left-0.5 w-4 h-2.5 rounded bg-blue-300 border border-blue-400"
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: 0, ease: 'easeInOut' }}
            />
            <motion.div
                className="absolute bottom-[17px] left-1 w-3 h-2 rounded bg-blue-400 border border-blue-500"
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: 0.1, ease: 'easeInOut' }}
            />
        </div>
    );
}

function PingDot({ color = 'blue' }) {
    const dot = {
        blue:   'bg-blue-500',
        amber:  'bg-amber-400',
        violet: 'bg-violet-500',
        teal:   'bg-teal-500',
        indigo: 'bg-indigo-500',
        emerald:'bg-emerald-500',
    }[color] ?? 'bg-blue-500';
    return (
        <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dot} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dot}`} />
        </span>
    );
}

function ScanAnim() {
    return (
        <div className="relative w-5 h-5 overflow-hidden shrink-0">
            <PackageCheck size={18} className="text-teal-500" />
            <motion.div
                className="absolute left-0 right-0 h-0.5 bg-teal-400/70 rounded-full"
                animate={{ top: ['10%', '85%', '10%'] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
        </div>
    );
}

function VioletGlow() {
    return (
        <motion.div
            animate={{ opacity: [0.5, 1, 0.5], scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
            <CheckCircle2 size={16} className="text-violet-500" />
        </motion.div>
    );
}

function StageAnim({ stage }) {
    if (stage === 'transito')   return <MotorcycleAnim />;
    if (stage === 'preparando') return <BoxStackAnim />;
    if (stage === 'pausado')    return <PingDot color="amber" />;
    if (stage === 'preparado')  return <VioletGlow />;
    if (stage === 'contando')   return <ScanAnim />;
    if (stage === 'erp')        return <PingDot color="emerald" />;
    return null;
}

// ─── SucursalRow (one row in active card) ────────────────────────────────────

function SucursalRow({ row, pedidoStatus }) {
    const stage  = getBranchStage(row, pedidoStatus);
    const cfg    = STAGE_CONFIG[stage];
    const colors = COLOR_CLS[cfg.color];
    const Icon   = cfg.icon;
    const isPaused = stage === 'pausado';

    return (
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border ${
            isPaused ? 'bg-amber-50/70 border-amber-100' : 'bg-slate-50/60 border-slate-100'
        }`}>
            <Building2 size={11} className="text-slate-400 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-600 w-[74px] shrink-0 truncate">
                {ERP_NAMES[row.erp_sucursal_id] ?? `Suc. ${row.erp_sucursal_id}`}
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
                <Icon size={10} />
                {cfg.label}
            </span>
            <StageAnim stage={stage} />
            {stage === 'preparando' && row?.iniciado_at && (
                <span className="ml-auto text-[9px] text-slate-400 tabular-nums shrink-0">
                    {fmtMin(Math.max(0, elapsed(row.iniciado_at) - (row.min_pausado_total ?? 0)))}
                </span>
            )}
            {stage === 'pausado' && row?.pausado_at && (
                <span className="ml-auto text-[9px] text-amber-500 font-medium shrink-0">
                    {fmtMin(elapsed(row.pausado_at))}
                </span>
            )}
            {stage === 'transito' && row?.finalizado_at && (
                <span className="ml-auto text-[9px] text-indigo-400 tabular-nums shrink-0">
                    {fmtMin(elapsed(row.finalizado_at))} en ruta
                </span>
            )}
        </div>
    );
}

// ─── ItemRow (expanded items) ─────────────────────────────────────────────────

function ItemRow({ item }) {
    const hasDiff = item.cantidad_asignada !== item.cantidad_recibida && item.cantidad_recibida != null;
    const isOk    = item.status === 'recibido' && !hasDiff;
    const isPend  = item.status === 'pendiente';
    return (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border text-[11px] ${
            hasDiff  ? 'bg-amber-50/60 border-amber-100' :
            isOk     ? 'bg-emerald-50/40 border-emerald-100' :
                       'bg-slate-50/60 border-slate-100'
        }`}>
            <Package size={11} className="mt-0.5 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-700 line-clamp-1">
                    {item.products?.nombre ?? `Prod. ${item.erp_product_id}`}
                </span>
                {item.products?.es_antibiotico && (
                    <span className="ml-1.5 text-[9px] font-semibold text-red-500 bg-red-50 border border-red-200 px-1.5 rounded-full">Abx</span>
                )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-slate-500 tabular-nums">
                    {item.cantidad_asignada}
                </span>
                {hasDiff && (
                    <>
                        <span className="text-amber-400">→</span>
                        <span className="font-bold text-amber-600 tabular-nums">{item.cantidad_recibida}</span>
                    </>
                )}
                {isOk && <CheckCircle2 size={11} className="text-emerald-500" />}
                {isPend && <span className="text-[9px] text-slate-400">pend.</span>}
            </div>
        </div>
    );
}

// ─── ReceptionActions (for branch employees on active/sent pedidos) ──────────

function ReceptionActions({ pedidoId, pedido, sucId, sucName, llegadaOk, erpOk, items, onMarkLlegada, onOpenRecibir, onMarkErp, busy }) {
    return (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Recepción</div>

            {/* Step 1: Confirmar llegada física */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${
                llegadaOk ? 'bg-emerald-50/40 border-emerald-100' : 'bg-blue-50/40 border-blue-100'
            }`}>
                <PackageCheck size={13} className={llegadaOk ? 'text-emerald-500' : 'text-blue-500'} />
                <span className={llegadaOk ? 'text-emerald-700' : 'text-blue-700'}>
                    {llegadaOk ? 'Llegada física confirmada' : 'Paso 1 — Confirmar llegada de cajas'}
                </span>
                {!llegadaOk && (
                    <button
                        onClick={onMarkLlegada}
                        disabled={busy}
                        className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50"
                    >
                        {busy === 'llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar'}
                    </button>
                )}
            </div>

            {/* Step 2: Contar ítems */}
            {llegadaOk && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${
                    erpOk ? 'bg-emerald-50/40 border-emerald-100' : items?.filter(r => r.status === 'recibido').length > 0 ? 'bg-teal-50/40 border-teal-100' : 'bg-amber-50/40 border-amber-100'
                }`}>
                    <Activity size={13} className={erpOk ? 'text-emerald-500' : 'text-teal-500'} />
                    <span className={erpOk ? 'text-emerald-700' : 'text-slate-700'}>
                        {erpOk
                            ? 'Ítems confirmados'
                            : `Paso 2 — Contar ítems (${items?.filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0).length ?? 0} pendientes)`}
                    </span>
                    {!erpOk && (
                        <button
                            onClick={onOpenRecibir}
                            disabled={!items?.some(r => r.status === 'pendiente' && r.cantidad_asignada > 0)}
                            className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-teal-500 text-white hover:bg-teal-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Recibir
                        </button>
                    )}
                </div>
            )}

            {/* Step 3: Ingresar al ERP */}
            {llegadaOk && items?.filter(r => r.status === 'recibido').length > 0 && !erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/40 border-violet-100 text-[11px]">
                    <Database size={13} className="text-violet-500" />
                    <span className="text-violet-700">Paso 3 — Marcar ingresado al ERP</span>
                    <button
                        onClick={onMarkErp}
                        disabled={busy === 'erp'}
                        className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 active:scale-95 transition-all disabled:opacity-50"
                    >
                        {busy === 'erp' ? <Loader2 size={10} className="animate-spin" /> : 'Marcar ERP'}
                    </button>
                </div>
            )}

            {erpOk && (
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium px-1">
                    <CheckCheck size={12} />
                    Recepción completa — ingresado al ERP
                </div>
            )}
        </div>
    );
}

// ─── LotePills ────────────────────────────────────────────────────────────────

function LotePills({ lotes }) {
    if (!lotes?.length) return null;
    const today = new Date();
    return (
        <div className="flex flex-wrap gap-1 mt-0.5">
            {lotes.map((l, i) => {
                const fv       = l.fecha_vencimiento ? new Date(l.fecha_vencimiento) : null;
                const daysLeft = fv ? Math.floor((fv - today) / 86_400_000) : null;
                const expCls   = daysLeft === null ? 'text-slate-400'
                    : daysLeft < 30  ? 'text-red-500 font-semibold'
                    : daysLeft < 90  ? 'text-amber-500'
                    : 'text-emerald-600';
                return (
                    <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                        <span className="text-slate-500 font-medium">{l.lote || '—'}</span>
                        {fv && <span className={expCls}>{new Date(l.fecha_vencimiento).toLocaleDateString('es-SV', { month: 'short', year: '2-digit' })}</span>}
                    </span>
                );
            })}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabPedidos({ searchTerm = '' }) {
    const { user, getScope } = useAuth();
    const isBranch = getScope('pedidos') === 'BRANCH';

    // Scope / sucursal resolution
    const [erpSucursalId, setErpSucursalId] = useState(null); // branch employee's ERP id
    const [branchName,    setBranchName]    = useState('');
    const [filterSuc,     setFilterSuc]     = useState('all'); // 'all' or Number

    // Data
    const [activeRows,   setActiveRows]   = useState([]);  // from get_pedidos_en_curso
    const [history,      setHistory]      = useState([]);  // from pedidos table
    const [loading,      setLoading]      = useState(true);
    const [loadingHist,  setLoadingHist]  = useState(false);
    const [hasMore,      setHasMore]      = useState(false);
    const [histPage,     setHistPage]     = useState(0);

    // Expansion
    const [expanded,      setExpanded]      = useState(null);
    const [items,         setItems]         = useState({});    // { pedidoId: [item,…] }
    const [loadingItems,  setLoadingItems]  = useState(false);
    const [firmas,        setFirmas]        = useState({});
    const [extras,        setExtras]        = useState({});
    const [llegadaStatus, setLlegadaStatus] = useState({});   // { pedidoId: bool }
    const [erpStatus,     setErpStatus]     = useState({});   // { pedidoId: bool }
    const [busyAction,    setBusyAction]    = useState(null); // 'llegada'|'erp'

    // Reception modal
    const [modal,         setModal]         = useState(null);
    const [newAlert,      setNewAlert]      = useState(null);

    const expandedRef = useRef(null);
    useEffect(() => { expandedRef.current = expanded; }, [expanded]);

    // ── Resolve branch employee's ERP sucursal ────────────────────────────────

    useEffect(() => {
        if (!isBranch || !user?.id) return;
        (async () => {
            const { data: emp } = await supabase
                .from('employees')
                .select('branch_id')
                .eq('id', user.id)
                .maybeSingle();
            if (!emp?.branch_id) return;

            const { data: mapRow } = await supabase
                .from('erp_sucursal_map')
                .select('erp_sucursal_id')
                .eq('branch_id', emp.branch_id)
                .eq('es_bodega', false)
                .maybeSingle();
            if (!mapRow) return;

            setErpSucursalId(mapRow.erp_sucursal_id);
            setFilterSuc(mapRow.erp_sucursal_id);
            setBranchName(ERP_NAMES[mapRow.erp_sucursal_id] ?? `Sucursal ${mapRow.erp_sucursal_id}`);
        })();
    }, [isBranch, user?.id]);

    // ── Load active pedidos ───────────────────────────────────────────────────

    const loadActive = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_pedidos_en_curso');
        if (!error) setActiveRows(data ?? []);
    }, []);

    // ── Load history ──────────────────────────────────────────────────────────

    const loadHistory = useCallback(async (page = 0, suc = 'all') => {
        if (page === 0) setLoadingHist(true);
        let q = supabase
            .from('pedidos')
            .select('id, numero, created_at, status, notes, enviado_at, sucursal_ids')
            .in('status', DONE_STATUSES)
            .order('created_at', { ascending: false })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (suc !== 'all' && suc) q = q.contains('sucursal_ids', [suc]);
        const { data } = await q;
        const rows = data || [];
        if (page === 0) {
            setHistory(rows);
            setHistPage(0);
        } else {
            setHistory(prev => [...prev, ...rows]);
            setHistPage(page);
        }
        setHasMore(rows.length === PAGE_SIZE);
        if (page === 0) setLoadingHist(false);
    }, []);

    // ── Initial load ──────────────────────────────────────────────────────────

    useEffect(() => {
        (async () => {
            setLoading(true);
            await Promise.all([loadActive(), loadHistory(0, 'all')]);
            setLoading(false);
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Filter change reloads history ─────────────────────────────────────────

    const prevFilterRef = useRef('all');
    useEffect(() => {
        if (filterSuc === prevFilterRef.current) return;
        prevFilterRef.current = filterSuc;
        loadHistory(0, filterSuc);
    }, [filterSuc, loadHistory]);

    // ── Realtime ──────────────────────────────────────────────────────────────

    useEffect(() => {
        const ch = supabase
            .channel('tab-pedidos-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (payload) => {
                loadActive();
                const newStatus = payload.new?.status;
                if (newStatus && DONE_STATUSES.includes(newStatus)) loadHistory(0, filterSuc);
                if (isBranch && payload.new?.status === 'enviado') {
                    const ids = payload.new?.sucursal_ids ?? [];
                    if (erpSucursalId && ids.includes(erpSucursalId)) {
                        setNewAlert({ numero: payload.new.numero });
                        setTimeout(() => setNewAlert(null), 8000);
                    }
                }
                // Reload expanded card items if affected
                const cur = expandedRef.current;
                const affectedId = payload.new?.id ?? payload.old?.id;
                if (cur && cur === affectedId) fetchItems(cur);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_sucursal_status' }, () => {
                loadActive();
            })
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, [loadActive, loadHistory, filterSuc, isBranch, erpSucursalId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Fetch items for expanded card ─────────────────────────────────────────

    const fetchItems = useCallback(async (pedidoId) => {
        setLoadingItems(true);
        const sucFilter = isBranch && erpSucursalId ? erpSucursalId : null;

        let itemsQ = supabase
            .from('pedido_items')
            .select(`
                id, erp_sucursal_id, erp_product_id,
                cantidad_asignada, cantidad_recibida,
                status, nota_diferencia, error_tipo, received_at, lotes_asignados,
                sin_stock, revision_minmax,
                products ( nombre, es_antibiotico ),
                presentaciones ( tipo )
            `)
            .eq('pedido_id', pedidoId)
            .range(0, 999);
        if (sucFilter) itemsQ = itemsQ.eq('erp_sucursal_id', sucFilter);

        const [{ data: itemRows }, { data: firmaRows }, { data: extraRows }, { data: lcRow }] = await Promise.all([
            itemsQ,
            supabase
                .from('pedido_recepcion_firmas')
                .select('employee_id, created_at, employees:employee_id ( id, name, photo_url )')
                .eq('pedido_id', pedidoId)
                .eq('erp_sucursal_id', sucFilter ?? 0),
            supabase
                .from('pedido_recepcion_extras')
                .select('id, erp_product_id, cantidad, nota, created_at, products:erp_product_id ( nombre )')
                .eq('pedido_id', pedidoId)
                .eq('erp_sucursal_id', sucFilter ?? 0),
            sucFilter
                ? supabase
                    .from('pedido_sucursal_status')
                    .select('recibido_erp_at, llegada_fisica_at')
                    .eq('pedido_id', pedidoId)
                    .eq('erp_sucursal_id', sucFilter)
                    .maybeSingle()
                : Promise.resolve({ data: null }),
        ]);

        setItems(prev => ({ ...prev, [pedidoId]: itemRows || [] }));
        if (sucFilter) {
            setFirmas(prev => ({ ...prev, [pedidoId]: (firmaRows || []).map(f => f.employees).filter(Boolean) }));
            setExtras(prev => ({ ...prev, [pedidoId]: extraRows || [] }));
            setErpStatus(prev => ({ ...prev, [pedidoId]: !!lcRow?.recibido_erp_at }));
            setLlegadaStatus(prev => ({ ...prev, [pedidoId]: !!lcRow?.llegada_fisica_at }));
        }
        setLoadingItems(false);
    }, [isBranch, erpSucursalId]);

    const toggleExpand = useCallback(async (pedidoId) => {
        if (expanded === pedidoId) { setExpanded(null); return; }
        setExpanded(pedidoId);
        if (!items[pedidoId]) await fetchItems(pedidoId);
    }, [expanded, items, fetchItems]);

    // ── Reception handlers ────────────────────────────────────────────────────

    const handleLlegada = useCallback(async (pedidoId) => {
        if (busyAction || !erpSucursalId) return;
        setBusyAction('llegada');
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id:   pedidoId,
                p_sucursal_id: erpSucursalId,
                p_stage:       'confirmar_llegada',
                p_user_id:     user?.id ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_LLEGADA_CONFIRMADA', pedidoId, { sucursal_id: erpSucursalId });
            setLlegadaStatus(prev => ({ ...prev, [pedidoId]: true }));
        } catch (e) {
            console.error('Error llegada:', e);
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, erpSucursalId, user]);

    const handleMarkErp = useCallback(async (pedidoId) => {
        if (busyAction || !erpSucursalId) return;
        setBusyAction('erp');
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id:   pedidoId,
                p_sucursal_id: erpSucursalId,
                p_stage:       'recibir_erp',
                p_user_id:     user?.id ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: erpSucursalId });
            setErpStatus(prev => ({ ...prev, [pedidoId]: true }));
        } catch (e) {
            console.error('Error ERP:', e);
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, erpSucursalId, user]);

    const openModal = useCallback((pedidoId, numero) => {
        const rows = (items[pedidoId] || []).filter(
            r => r.status === 'pendiente' && r.cantidad_asignada > 0
        );
        if (!rows.length) return;
        setModal({ pedido: { id: pedidoId, numero }, rows });
    }, [items]);

    const handleConfirmed = useCallback(async ({ hasDiff }) => {
        const pedidoId = modal?.pedido?.id;
        if (!pedidoId) return;
        setModal(null);
        await fetchItems(pedidoId);
    }, [modal, fetchItems]);

    // ── Group active rows into pedido objects ─────────────────────────────────

    const activePedidosMap = activeRows.reduce((acc, row) => {
        if (!acc[row.pedido_id]) {
            acc[row.pedido_id] = {
                pedido_id:  row.pedido_id,
                numero:     row.numero,
                created_at: row.created_at,
                status:     row.pedido_status,
                notes:      row.notes,
                enviado_at: row.enviado_at,
                sucursales: [],
            };
        }
        acc[row.pedido_id].sucursales.push(row);
        return acc;
    }, {});

    let activePedidos = Object.values(activePedidosMap)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Apply sucursal filter to active pedidos
    if (filterSuc !== 'all' && filterSuc) {
        activePedidos = activePedidos
            .filter(p => p.sucursales.some(s => s.erp_sucursal_id === Number(filterSuc)))
            .map(p => ({
                ...p,
                sucursales: isBranch
                    ? p.sucursales.filter(s => s.erp_sucursal_id === Number(filterSuc))
                    : p.sucursales,
            }));
    }

    // Apply search
    const searchLower = searchTerm.toLowerCase();
    const filteredActive = activePedidos.filter(p => {
        if (!searchLower) return true;
        return String(p.numero).includes(searchLower) || (p.notes ?? '').toLowerCase().includes(searchLower);
    });

    const filteredHistory = history.filter(p => {
        if (!searchLower) return true;
        return String(p.numero).includes(searchLower) || (p.notes ?? '').toLowerCase().includes(searchLower);
    });

    // ── Sucursal filter pill options ──────────────────────────────────────────

    const filterOptions = [
        { value: 'all', label: 'Todas las sucursales' },
        ...ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` })),
    ];

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 gap-2 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-[14px]">Cargando pedidos…</span>
            </div>
        );
    }

    return (
        <div className="space-y-4 p-4">

            {/* New alert banner */}
            <AnimatePresence>
                {newAlert && (
                    <motion.div
                        initial={{ opacity: 0, y: -16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -16 }}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-[12px] font-semibold shadow-sm"
                    >
                        <Send size={13} />
                        ¡Nuevo pedido #{newAlert.numero} en camino a {branchName}!
                        <button onClick={() => setNewAlert(null)} className="ml-auto text-indigo-400 hover:text-indigo-600">
                            <X size={13} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Filter pill */}
            {!isBranch && (
                <div className="flex items-center gap-0 rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm overflow-hidden h-9 w-fit">
                    <span className="pl-3.5 pr-2.5 text-[11px] text-slate-500 font-medium whitespace-nowrap shrink-0">Sucursal</span>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                    <div className="pl-1 pr-1">
                        <LiquidSelect
                            value={filterSuc}
                            onChange={v => setFilterSuc(v)}
                            options={filterOptions}
                            compact
                        />
                    </div>
                </div>
            )}
            {isBranch && branchName && (
                <div className="flex items-center gap-2 w-fit px-3.5 py-1.5 rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm text-[11px] text-slate-600 font-medium">
                    <Building2 size={12} className="text-slate-400" />
                    {branchName}
                </div>
            )}

            {/* ── ACTIVE SECTION ─────────────────────────────────────────── */}

            <div>
                <div className="flex items-center gap-2 mb-3">
                    <div className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                    </div>
                    <span className="text-[12px] font-bold text-slate-600 uppercase tracking-wide">En curso</span>
                    {filteredActive.length > 0 && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                            {filteredActive.length}
                        </span>
                    )}
                    <button
                        onClick={loadActive}
                        className="ml-auto flex items-center gap-1 text-[10px] text-slate-400 hover:text-blue-600 transition-colors"
                    >
                        <RefreshCw size={11} />
                        Refrescar
                    </button>
                </div>

                {filteredActive.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-300">
                        <CheckCircle2 size={28} className="opacity-50" />
                        <p className="text-[12px] text-slate-400">No hay pedidos activos.</p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {filteredActive.map(pedido => {
                            const isExp = expanded === pedido.pedido_id;
                            const anyPaused = pedido.sucursales.some(s => s.pausado_at && !s.reanudado_at);
                            const isInTransit = pedido.status === 'enviado';

                            // Determine card-level dominant stage for background glow
                            const cardRingCls = anyPaused
                                ? 'ring-1 ring-amber-300'
                                : isInTransit
                                    ? 'ring-1 ring-indigo-200'
                                    : '';

                            return (
                                <motion.div
                                    key={pedido.pedido_id}
                                    layout
                                    className={`${GLASS} ${cardRingCls} overflow-hidden`}
                                >
                                    {/* Card header */}
                                    <button
                                        onClick={() => toggleExpand(pedido.pedido_id)}
                                        className="w-full text-left"
                                    >
                                        <div className="flex items-center gap-2.5 px-4 py-3">
                                            <span className="text-[14px] font-black text-slate-700 tabular-nums shrink-0">
                                                #{pedido.numero}
                                            </span>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[pedido.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                                {PEDIDO_LABEL[pedido.status] ?? pedido.status}
                                            </span>

                                            {/* Dominant animation based on pedido state */}
                                            <div className="flex items-center gap-1.5">
                                                {isInTransit && <MotorcycleAnim />}
                                                {!isInTransit && anyPaused && <PingDot color="amber" />}
                                                {!isInTransit && !anyPaused && pedido.sucursales.some(s => s.iniciado_at && !s.finalizado_at) && <BoxStackAnim />}
                                            </div>

                                            <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                                                {fmtRelative(pedido.enviado_at ?? pedido.created_at)}
                                            </span>
                                            {isExp
                                                ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                                                : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                                        </div>
                                        {pedido.notes && (
                                            <p className="px-4 pb-1.5 text-[11px] text-slate-400 italic text-left">{pedido.notes}</p>
                                        )}
                                    </button>

                                    {/* Sucursales grid */}
                                    <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
                                        {pedido.sucursales
                                            .sort((a, b) => a.erp_sucursal_id - b.erp_sucursal_id)
                                            .map(suc => (
                                                <SucursalRow
                                                    key={suc.erp_sucursal_id}
                                                    row={suc}
                                                    pedidoStatus={pedido.status}
                                                />
                                            ))}
                                    </div>

                                    {/* Progress bar for enviado */}
                                    {pedido.status === 'enviado' && (() => {
                                        const total    = pedido.sucursales.length;
                                        const done     = pedido.sucursales.filter(s => s.recibido_erp_at).length;
                                        const pctDone  = Math.round((done / total) * 100);
                                        return (
                                            <div className="border-t border-slate-100 px-4 py-2">
                                                <div className="flex justify-between mb-1">
                                                    <span className="text-[9px] text-slate-400 font-medium">Recepción</span>
                                                    <span className="text-[9px] text-slate-500 font-semibold tabular-nums">{done}/{total}</span>
                                                </div>
                                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <motion.div
                                                        className="h-full bg-emerald-500 rounded-full"
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${pctDone}%` }}
                                                        transition={{ duration: 0.6, ease: 'easeOut' }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Expanded section */}
                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.22 }}
                                                className="overflow-hidden"
                                            >
                                                {loadingItems ? (
                                                    <div className="flex justify-center py-4 border-t border-slate-100">
                                                        <Loader2 size={16} className="animate-spin text-slate-300" />
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Items list */}
                                                        {items[pedido.pedido_id]?.length > 0 && (
                                                            <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                                                    Ítems ({items[pedido.pedido_id].length})
                                                                </div>
                                                                {items[pedido.pedido_id].map(item => (
                                                                    <ItemRow key={item.id} item={item} />
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Reception actions for branch employees */}
                                                        {isBranch && erpSucursalId && pedido.status === 'enviado' && (
                                                            <ReceptionActions
                                                                pedidoId={pedido.pedido_id}
                                                                pedido={pedido}
                                                                sucId={erpSucursalId}
                                                                sucName={branchName}
                                                                llegadaOk={!!llegadaStatus[pedido.pedido_id]}
                                                                erpOk={!!erpStatus[pedido.pedido_id]}
                                                                items={items[pedido.pedido_id]}
                                                                onMarkLlegada={() => handleLlegada(pedido.pedido_id)}
                                                                onOpenRecibir={() => openModal(pedido.pedido_id, pedido.numero)}
                                                                onMarkErp={() => handleMarkErp(pedido.pedido_id)}
                                                                busy={busyAction}
                                                            />
                                                        )}
                                                    </>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── HISTORY SECTION ───────────────────────────────────────── */}

            <div>
                <div className="flex items-center gap-2 mb-3 mt-2">
                    <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">Historial</span>
                    {filteredHistory.length > 0 && (
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                            {filteredHistory.length}{hasMore ? '+' : ''}
                        </span>
                    )}
                </div>

                {loadingHist ? (
                    <div className="flex justify-center py-8">
                        <Loader2 size={18} className="animate-spin text-slate-300" />
                    </div>
                ) : filteredHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-1 text-slate-300">
                        <TrendingDown size={24} className="opacity-50" />
                        <p className="text-[12px] text-slate-400">Sin historial.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredHistory.map(pedido => {
                            const isExp   = expanded === pedido.id;
                            const isAnu   = pedido.status === 'anulado';
                            const isDiff  = pedido.status === 'parcial';
                            const itemsForPedido = items[pedido.id] || [];
                            const diffItems = itemsForPedido.filter(
                                i => i.cantidad_asignada !== i.cantidad_recibida && i.cantidad_recibida != null
                            );

                            return (
                                <motion.div
                                    key={pedido.id}
                                    layout
                                    className={`${GLASS} overflow-hidden ${isAnu ? 'opacity-70' : ''}`}
                                >
                                    <button
                                        onClick={() => toggleExpand(pedido.id)}
                                        className="w-full text-left"
                                    >
                                        <div className="flex items-center gap-2.5 px-4 py-3">
                                            <span className={`text-[13px] font-black tabular-nums shrink-0 ${isAnu ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                                #{pedido.numero}
                                            </span>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[pedido.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                                {PEDIDO_LABEL[pedido.status] ?? pedido.status}
                                            </span>
                                            {isDiff && <PingDot color="amber" />}
                                            <span className="ml-auto text-[10px] text-slate-400 shrink-0">
                                                {fmtDate(pedido.created_at)}
                                            </span>
                                            {isExp
                                                ? <ChevronDown size={13} className="text-slate-400 shrink-0" />
                                                : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                                        </div>
                                        {pedido.notes && (
                                            <p className="px-4 pb-1.5 text-[11px] text-slate-400 italic text-left">{pedido.notes}</p>
                                        )}
                                    </button>

                                    {/* Sucursal chips row */}
                                    {(pedido.sucursal_ids?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-2">
                                            {(pedido.sucursal_ids ?? []).map(sid => (
                                                <span key={sid} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-500">
                                                    {ERP_NAMES[sid] ?? `Suc. ${sid}`}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Expanded section */}
                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.22 }}
                                                className="overflow-hidden"
                                            >
                                                {loadingItems ? (
                                                    <div className="flex justify-center py-4 border-t border-slate-100">
                                                        <Loader2 size={16} className="animate-spin text-slate-300" />
                                                    </div>
                                                ) : (
                                                    <div className="border-t border-slate-100 px-4 py-3">
                                                        {/* Diferencias highlight */}
                                                        {diffItems.length > 0 && (
                                                            <div className="mb-3 p-3 rounded-xl bg-amber-50/70 border border-amber-100">
                                                                <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
                                                                    <AlertTriangle size={11} />
                                                                    {diffItems.length} diferencia{diffItems.length !== 1 ? 's' : ''}
                                                                </div>
                                                                <div className="space-y-1">
                                                                    {diffItems.map(item => (
                                                                        <ItemRow key={item.id} item={item} />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* All items */}
                                                        {itemsForPedido.length > 0 ? (
                                                            <>
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                                                    Todos los ítems ({itemsForPedido.length})
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    {itemsForPedido.map(item => (
                                                                        <ItemRow key={item.id} item={item} />
                                                                    ))}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <p className="text-[11px] text-slate-400 text-center py-2">Sin ítems cargados.</p>
                                                        )}
                                                    </div>
                                                )}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </div>
                )}

                {/* Load more */}
                {hasMore && !searchLower && (
                    <button
                        onClick={() => loadHistory(histPage + 1, filterSuc)}
                        className="mt-3 w-full py-2.5 rounded-2xl border border-slate-200/70 bg-white/60 text-[12px] text-slate-500 font-medium hover:bg-white/80 transition-all"
                    >
                        Cargar más pedidos
                    </button>
                )}
            </div>

            {/* Reception modal */}
            {modal && (
                <RecepcionModal
                    open={!!modal}
                    onClose={() => setModal(null)}
                    pedido={modal.pedido}
                    sucursalId={erpSucursalId}
                    sucursalNombre={branchName}
                    rows={modal.rows}
                    onConfirmed={handleConfirmed}
                />
            )}
        </div>
    );
}
