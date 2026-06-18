import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle, Ban,
    Truck, Pause, PackageCheck, Play,
    Database, Activity, TrendingDown,
    X, Send, CheckCheck, RotateCcw, Flag,
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
    erp:         { label: 'En ERP',          color: 'emerald', icon: Database     },
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
const PEDIDO_LABEL = { confirmado: 'Por despachar', enviado: 'En camino', parcial: 'Con diferencias', completado: 'Completado', anulado: 'Anulado' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMin(min) {
    if (min == null || min < 0) return null;
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function elapsed(isoFrom, isoTo = null) {
    if (!isoFrom) return null;
    return Math.floor((new Date(isoTo ?? undefined) - new Date(isoFrom)) / 60_000);
}
function fmtRelative(iso) {
    if (!iso) return '—';
    const min = elapsed(iso);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
}
function getBranchStage(row, pedidoStatus) {
    if (!row) return 'sin_iniciar';
    if (row.recibido_erp_at)                            return 'erp';
    if (row.llegada_fisica_at)                          return 'contando';
    if (row.finalizado_at && pedidoStatus === 'enviado') return 'transito';
    if (row.finalizado_at)                              return 'preparado';
    if (row.pausado_at && !row.reanudado_at)            return 'pausado';
    if (row.iniciado_at)                                return 'preparando';
    return 'sin_iniciar';
}

// ─── Animations ──────────────────────────────────────────────────────────────

function MotorcycleAnim() {
    return (
        <motion.div className="shrink-0 text-indigo-500" animate={{ x: [0, 8, 0] }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}>
            <svg width="44" height="28" viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <motion.circle cx="12" cy="32" r="8" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ transformOrigin: '12px 32px' }} />
                <motion.circle cx="52" cy="32" r="8" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ transformOrigin: '52px 32px' }} />
                <path d="M12 24 L22 12 L38 12 L46 24 L52 24" />
                <path d="M32 12 L30 4 L46 4" />
                <path d="M38 12 L43 8 L51 8" />
                <circle cx="27" cy="8" r="4" fill="currentColor" opacity="0.5" />
                <path d="M27 12 L24 20 L34 20" />
                <motion.path d="M1 28 L7 28" stroke="currentColor" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 0.8, repeat: Infinity }} />
                <motion.path d="M0 33 L6 33" stroke="currentColor" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.1, 0.5, 0.1] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.12 }} />
                <motion.path d="M2 38 L8 38" stroke="currentColor" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.1, 0.4, 0.1] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.24 }} />
            </svg>
        </motion.div>
    );
}

function BoxStackAnim() {
    return (
        <div className="relative w-10 h-9 shrink-0">
            <motion.div className="absolute bottom-0 left-0 w-9 h-4 rounded-md bg-blue-200 border border-blue-300 shadow-sm" animate={{ y: [0, -1, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: 0.3, ease: 'easeInOut' }} />
            <motion.div className="absolute bottom-[14px] left-1 w-7 h-3.5 rounded bg-blue-300 border border-blue-400" animate={{ y: [0, -2, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: 0.1, ease: 'easeInOut' }} />
            <motion.div className="absolute bottom-[25px] left-2 w-5 h-3 rounded bg-blue-400 border border-blue-500" animate={{ y: [0, -2, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: 0.0, ease: 'easeInOut' }} />
            <motion.div className="absolute bottom-[34px] left-3 w-3 h-2.5 rounded bg-blue-500 border border-blue-600" animate={{ y: [0, -3, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: -0.1, ease: 'easeInOut' }} />
        </div>
    );
}

function PausedAnim() {
    return (
        <div className="flex items-center gap-1 shrink-0">
            <motion.div className="w-2 h-6 rounded-sm bg-amber-400" animate={{ scaleY: [1, 0.6, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }} />
            <motion.div className="w-2 h-6 rounded-sm bg-amber-400" animate={{ scaleY: [1, 0.6, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: 0.15 }} />
        </div>
    );
}

function VioletGlow() {
    return (
        <motion.div animate={{ opacity: [0.4, 1, 0.4], scale: [0.92, 1.08, 0.92] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}>
            <CheckCircle2 size={24} className="text-violet-500" />
        </motion.div>
    );
}

function ScanAnim() {
    return (
        <div className="relative w-8 h-8 overflow-hidden shrink-0">
            <PackageCheck size={28} className="text-teal-500" />
            <motion.div className="absolute left-0 right-0 h-0.5 bg-teal-400/80 rounded-full shadow-sm shadow-teal-300" animate={{ top: ['8%', '88%', '8%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
    );
}

function PingDot({ color = 'blue', size = 'sm' }) {
    const sz = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5';
    const dot = { blue: 'bg-blue-500', amber: 'bg-amber-400', violet: 'bg-violet-500', teal: 'bg-teal-500', indigo: 'bg-indigo-500', emerald: 'bg-emerald-500' }[color] ?? 'bg-blue-500';
    return (
        <span className={`relative flex shrink-0 ${sz}`}>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dot} opacity-60`} />
            <span className={`relative inline-flex rounded-full ${sz} ${dot}`} />
        </span>
    );
}

function StageAnim({ stage }) {
    if (stage === 'transito')   return <MotorcycleAnim />;
    if (stage === 'preparando') return <BoxStackAnim />;
    if (stage === 'pausado')    return <PausedAnim />;
    if (stage === 'preparado')  return <VioletGlow />;
    if (stage === 'contando')   return <ScanAnim />;
    if (stage === 'erp')        return <PingDot color="emerald" size="lg" />;
    return null;
}

// ─── Stage pill ───────────────────────────────────────────────────────────────

function StagePill({ stage }) {
    const cfg = STAGE_CONFIG[stage], colors = COLOR_CLS[cfg.color], Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
            <Icon size={10} /> {cfg.label}
        </span>
    );
}

// ─── Sucursal pill ────────────────────────────────────────────────────────────

function SucPill({ sucId }) {
    const cls = SUC_COLORS[sucId] ?? 'bg-slate-100 text-slate-600 border-slate-200';
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${cls}`}>
            <Building2 size={11} />
            {ERP_NAMES[sucId] ?? `Suc. ${sucId}`}
        </span>
    );
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({ item }) {
    const hasDiff = item.cantidad_asignada !== item.cantidad_recibida && item.cantidad_recibida != null;
    const isOk    = item.status === 'recibido' && !hasDiff;
    return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${hasDiff ? 'bg-amber-50/60 border-amber-100' : isOk ? 'bg-emerald-50/40 border-emerald-100' : 'bg-slate-50/60 border-slate-100'}`}>
            <Package size={11} className="text-slate-400 shrink-0" />
            <span className="flex-1 min-w-0 font-medium text-slate-700 truncate">{item.products?.nombre ?? `Prod. ${item.erp_product_id}`}</span>
            {item.products?.es_antibiotico && <span className="text-[9px] font-semibold text-red-500 bg-red-50 border border-red-200 px-1.5 rounded-full shrink-0">Abx</span>}
            <div className="flex items-center gap-1 shrink-0 tabular-nums text-slate-500">
                <span>{item.cantidad_asignada}</span>
                {hasDiff && <><span className="text-amber-400">→</span><span className="font-bold text-amber-600">{item.cantidad_recibida}</span></>}
                {isOk && <CheckCircle2 size={11} className="text-emerald-500" />}
            </div>
        </div>
    );
}

// ─── Reception actions ────────────────────────────────────────────────────────

function ReceptionActions({ pedidoId, sucId, sucName, llegadaOk, erpOk, items, onMarkLlegada, onOpenRecibir, onMarkErp, busy }) {
    return (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Recepción</div>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${llegadaOk ? 'bg-emerald-50/40 border-emerald-100' : 'bg-blue-50/40 border-blue-100'}`}>
                <PackageCheck size={13} className={llegadaOk ? 'text-emerald-500' : 'text-blue-500'} />
                <span className={llegadaOk ? 'text-emerald-700' : 'text-blue-700'}>{llegadaOk ? 'Llegada física confirmada' : 'Paso 1 — Confirmar llegada de cajas'}</span>
                {!llegadaOk && <button onClick={onMarkLlegada} disabled={busy === 'llegada'} className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50">{busy === 'llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar'}</button>}
            </div>
            {llegadaOk && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] ${erpOk ? 'bg-emerald-50/40 border-emerald-100' : 'bg-teal-50/40 border-teal-100'}`}>
                    <Activity size={13} className={erpOk ? 'text-emerald-500' : 'text-teal-500'} />
                    <span className={erpOk ? 'text-emerald-700' : 'text-slate-700'}>{erpOk ? 'Ítems confirmados' : `Paso 2 — Contar ítems (${items?.filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0).length ?? 0} pendientes)`}</span>
                    {!erpOk && <button onClick={onOpenRecibir} disabled={!items?.some(r => r.status === 'pendiente' && r.cantidad_asignada > 0)} className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-teal-500 text-white hover:bg-teal-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">Recibir</button>}
                </div>
            )}
            {llegadaOk && items?.filter(r => r.status === 'recibido').length > 0 && !erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/40 border-violet-100 text-[11px]">
                    <Database size={13} className="text-violet-500" />
                    <span className="text-violet-700">Paso 3 — Marcar ingresado al ERP</span>
                    <button onClick={onMarkErp} disabled={busy === 'erp'} className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 active:scale-95 transition-all disabled:opacity-50">{busy === 'erp' ? <Loader2 size={10} className="animate-spin" /> : 'Marcar ERP'}</button>
                </div>
            )}
            {erpOk && <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium px-1"><CheckCheck size={12} />Recepción completa</div>}
        </div>
    );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

function FilterPill({ isBranch, filterSuc, setFilterSuc, filterStatus, setFilterStatus, filterOptions }) {
    const hasActive = (filterSuc !== 'all') || (filterStatus !== 'all');
    const clearAll = () => { setFilterSuc('all'); setFilterStatus('all'); };

    const statusBtn = (key, label) => (
        <button
            onClick={() => setFilterStatus(v => v === key ? 'all' : key)}
            className={`flex items-center gap-1 px-3 h-8 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-200 whitespace-nowrap shrink-0 ${
                filterStatus === key
                    ? key === 'confirmado' ? 'bg-blue-100 border-blue-200 text-blue-700 shadow-sm'
                      : key === 'enviado'  ? 'bg-indigo-100 border-indigo-200 text-indigo-700 shadow-sm'
                      : 'bg-slate-100 border-slate-200 text-slate-700 shadow-sm'
                    : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-50 hover:border-slate-200 hover:text-slate-600'
            }`}
        >
            {label}
            {filterStatus === key && <X size={9} strokeWidth={3} />}
        </button>
    );

    return (
        <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 hover:border-slate-200 overflow-visible shrink-0">

            {/* Sucursal selector */}
            {!isBranch && (
                <>
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible" style={{ width: '155px' }}>
                            <LiquidSelect value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} placeholder="Todas" icon={Building2} compact bare />
                        </div>
                        {filterSuc !== 'all' && (
                            <button onClick={() => setFilterSuc('all')} className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                </>
            )}

            {/* Status toggles */}
            <div className="flex items-center gap-1 px-2">
                {statusBtn('confirmado', 'Pendientes')}
                {statusBtn('enviado', 'En camino')}
            </div>

            {/* Clear all */}
            {hasActive && (
                <>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                    <button onClick={clearAll} className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 shrink-0 hover:scale-110">
                        <X size={11} strokeWidth={3} />
                    </button>
                </>
            )}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabPedidos({ searchTerm = '' }) {
    const { user, getScope } = useAuth();
    const isBranch = getScope('pedidos') === 'BRANCH';

    const [erpSucursalId, setErpSucursalId] = useState(null);
    const [branchName,    setBranchName]    = useState('');
    const [filterSuc,     setFilterSuc]     = useState('all');
    const [filterStatus,  setFilterStatus]  = useState('all');

    const [activeRows,  setActiveRows]  = useState([]);
    const [history,     setHistory]     = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [loadingHist, setLoadingHist] = useState(false);
    const [hasMore,     setHasMore]     = useState(false);
    const [histPage,    setHistPage]    = useState(0);

    // Expansion: store {key, pedidoId, sucId} so we never parse strings
    const [expanded,     setExpanded]     = useState(null); // key string
    const [expandedMeta, setExpandedMeta] = useState(null); // {pedidoId, sucId}
    const expandedMetaRef = useRef(null);
    useEffect(() => { expandedMetaRef.current = expandedMeta; }, [expandedMeta]);

    const [items,         setItems]         = useState({});
    const [loadingItems,  setLoadingItems]  = useState(false);
    const [llegadaStatus, setLlegadaStatus] = useState({});
    const [erpStatus,     setErpStatus]     = useState({});
    const [busyAction,    setBusyAction]    = useState(null);
    const [busyLifecycle, setBusyLifecycle] = useState(null);
    const [modal,         setModal]         = useState(null);
    const [newAlert,      setNewAlert]      = useState(null);

    // ── Resolve branch employee ERP sucursal ──────────────────────────────────

    useEffect(() => {
        if (!isBranch || !user?.id) return;
        (async () => {
            const { data: emp } = await supabase.from('employees').select('branch_id').eq('id', user.id).maybeSingle();
            if (!emp?.branch_id) return;
            const { data: mapRow } = await supabase.from('erp_sucursal_map').select('erp_sucursal_id').eq('branch_id', emp.branch_id).eq('es_bodega', false).maybeSingle();
            if (!mapRow) return;
            setErpSucursalId(mapRow.erp_sucursal_id);
            setFilterSuc(mapRow.erp_sucursal_id);
            setBranchName(ERP_NAMES[mapRow.erp_sucursal_id] ?? `Sucursal ${mapRow.erp_sucursal_id}`);
        })();
    }, [isBranch, user?.id]);

    // ── Load active ───────────────────────────────────────────────────────────

    const loadActive = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_pedidos_en_curso');
        if (!error) setActiveRows(data ?? []);
    }, []);

    // ── Load history ──────────────────────────────────────────────────────────

    const loadHistory = useCallback(async (page = 0, suc = 'all') => {
        if (page === 0) setLoadingHist(true);
        let q = supabase.from('pedidos').select('id, numero, created_at, status, notes, enviado_at, sucursal_ids').in('status', DONE_STATUSES).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (suc !== 'all' && suc) q = q.contains('sucursal_ids', [suc]);
        const { data } = await q;
        const rows = data || [];
        if (page === 0) { setHistory(rows); setHistPage(0); } else { setHistory(prev => [...prev, ...rows]); setHistPage(page); }
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
    }, []); // eslint-disable-line

    const prevFilterRef = useRef('all');
    useEffect(() => {
        if (filterSuc === prevFilterRef.current) return;
        prevFilterRef.current = filterSuc;
        loadHistory(0, filterSuc);
    }, [filterSuc, loadHistory]);

    // ── Realtime ──────────────────────────────────────────────────────────────

    useEffect(() => {
        const ch = supabase.channel('tab-pedidos-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (payload) => {
                loadActive();
                const s = payload.new?.status;
                if (s && DONE_STATUSES.includes(s)) loadHistory(0, filterSuc);
                if (isBranch && s === 'enviado') {
                    const ids = payload.new?.sucursal_ids ?? [];
                    if (erpSucursalId && ids.includes(erpSucursalId)) {
                        setNewAlert({ numero: payload.new.numero });
                        setTimeout(() => setNewAlert(null), 8000);
                    }
                }
                const meta = expandedMetaRef.current;
                const affectedId = payload.new?.id ?? payload.old?.id;
                if (meta && meta.pedidoId === affectedId) fetchItems(expanded, meta.pedidoId, meta.sucId);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedido_sucursal_status' }, () => { loadActive(); })
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, [loadActive, loadHistory, filterSuc, isBranch, erpSucursalId]); // eslint-disable-line

    // ── Fetch items — takes pedidoId/sucId directly (no string parsing) ───────

    const fetchItems = useCallback(async (key, pedidoId, sucId) => {
        if (!pedidoId) return;
        setLoadingItems(true);
        // For branch users opening active cards, sucId is the ERP sucursal
        const sucFilter = sucId ?? (isBranch && erpSucursalId ? erpSucursalId : null);

        let itemsQ = supabase.from('pedido_items')
            .select('id, erp_sucursal_id, erp_product_id, cantidad_asignada, cantidad_recibida, status, nota_diferencia, received_at, lotes_asignados, sin_stock, revision_minmax, products ( nombre, es_antibiotico )')
            .eq('pedido_id', pedidoId)
            .range(0, 999);
        if (sucFilter) itemsQ = itemsQ.eq('erp_sucursal_id', sucFilter);

        // Only fetch lifecycle for branch reception or when we have a specific sucursal
        const lcPromise = (sucFilter && isBranch)
            ? supabase.from('pedido_sucursal_status').select('recibido_erp_at, llegada_fisica_at').eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucFilter).maybeSingle()
            : Promise.resolve({ data: null });

        const [{ data: itemRows }, { data: lcRow }] = await Promise.all([itemsQ, lcPromise]);
        setItems(prev => ({ ...prev, [key]: itemRows || [] }));
        if (lcRow) {
            setErpStatus(prev => ({ ...prev, [key]: !!lcRow.recibido_erp_at }));
            setLlegadaStatus(prev => ({ ...prev, [key]: !!lcRow.llegada_fisica_at }));
        }
        setLoadingItems(false);
    }, [isBranch, erpSucursalId]);

    const toggleExpand = useCallback(async (key, pedidoId, sucId) => {
        if (expanded === key) { setExpanded(null); setExpandedMeta(null); return; }
        setExpanded(key);
        setExpandedMeta({ pedidoId, sucId });
        if (!items[key]) await fetchItems(key, pedidoId, sucId);
    }, [expanded, items, fetchItems]);

    // ── Lifecycle handler ─────────────────────────────────────────────────────

    const handleLifecycle = useCallback(async (pedidoId, sucId, stage) => {
        const key = `lc_${pedidoId}_${sucId}`;
        setBusyLifecycle(key);
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: stage, p_user_id: user?.id ?? null, p_razon: null });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, pedidoId, { sucursal_id: sucId });
            loadActive();
        } catch (e) { console.error('Lifecycle error:', e); } finally { setBusyLifecycle(null); }
    }, [user, loadActive]);

    // ── Reception handlers ────────────────────────────────────────────────────

    const handleLlegada = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) return;
        setBusyAction('llegada');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'confirmar_llegada', p_user_id: user?.id ?? null });
            useStaff.getState().appendAuditLog('PEDIDO_LLEGADA_CONFIRMADA', pedidoId, { sucursal_id: sucId });
            setLlegadaStatus(prev => ({ ...prev, [key]: true }));
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [busyAction, user]);

    const handleMarkErp = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) return;
        setBusyAction('erp');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'recibir_erp', p_user_id: user?.id ?? null });
            useStaff.getState().appendAuditLog('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: sucId });
            setErpStatus(prev => ({ ...prev, [key]: true }));
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [busyAction, user]);

    const openModal = useCallback((pedidoId, numero, sucId, key) => {
        const rows = (items[key] || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0);
        if (!rows.length) return;
        setModal({ pedido: { id: pedidoId, numero }, sucId, key, rows });
    }, [items]);

    // ── Filter active rows ────────────────────────────────────────────────────

    const searchLower = searchTerm.toLowerCase();

    let filteredRows = activeRows;
    if (filterSuc !== 'all' && filterSuc) filteredRows = filteredRows.filter(r => r.erp_sucursal_id === Number(filterSuc));
    if (filterStatus !== 'all')            filteredRows = filteredRows.filter(r => r.pedido_status === filterStatus);
    if (searchLower)                       filteredRows = filteredRows.filter(r => String(r.numero).includes(searchLower) || (r.notes ?? '').toLowerCase().includes(searchLower));

    const STAGE_ORDER = { preparando: 0, transito: 1, contando: 2, pausado: 3, preparado: 4, sin_iniciar: 5, erp: 6 };
    filteredRows = [...filteredRows].sort((a, b) => {
        const sa = STAGE_ORDER[getBranchStage(a, a.pedido_status)] ?? 5;
        const sb = STAGE_ORDER[getBranchStage(b, b.pedido_status)] ?? 5;
        return sa !== sb ? sa - sb : new Date(b.created_at) - new Date(a.created_at);
    });

    const filteredHistory = history.filter(p => {
        if (searchLower && !String(p.numero).includes(searchLower) && !(p.notes ?? '').toLowerCase().includes(searchLower)) return false;
        return true;
    });

    const filterOptions = [{ value: 'all', label: 'Todas' }, ...ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` }))];

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

            <AnimatePresence>
                {newAlert && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-[12px] font-semibold shadow-sm">
                        <Send size={13} />¡Nuevo pedido #{newAlert.numero} en camino a {branchName}!
                        <button onClick={() => setNewAlert(null)} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={13} /></button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── ACTIVE SECTION ──────────────────────────────────────────── */}
            <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                    </span>
                    <span className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">En curso</span>
                    {filteredRows.length > 0 && (
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                            {filteredRows.length}
                        </span>
                    )}
                    {/* Filter pill — right side */}
                    <div className="ml-auto">
                        <FilterPill
                            isBranch={isBranch}
                            filterSuc={filterSuc} setFilterSuc={setFilterSuc}
                            filterStatus={filterStatus} setFilterStatus={setFilterStatus}
                            filterOptions={filterOptions}
                        />
                    </div>
                </div>

                {filteredRows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-300">
                        <CheckCircle2 size={28} className="opacity-50" />
                        <p className="text-[12px] text-slate-400">No hay pedidos activos.</p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {filteredRows.map(row => {
                            const stage   = getBranchStage(row, row.pedido_status);
                            const cardKey = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isExp   = expanded === cardKey;
                            const lcKey   = `lc_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isLCBusy = busyLifecycle === lcKey;
                            const isPaused = stage === 'pausado';

                            // Bodega action flags (ALL scope only)
                            const canIniciar   = !isBranch && stage === 'sin_iniciar' && row.pedido_status === 'confirmado';
                            const canPausar    = !isBranch && stage === 'preparando'  && row.pedido_status === 'confirmado';
                            const canReanudar  = !isBranch && stage === 'pausado';
                            const canFinalizar = !isBranch && stage === 'preparando'  && row.pedido_status === 'confirmado';

                            return (
                                <motion.div key={cardKey} layout className={`${GLASS} overflow-hidden ${isPaused ? 'ring-1 ring-amber-300' : ''}`}>

                                    {/* Card header */}
                                    <button onClick={() => toggleExpand(cardKey, row.pedido_id, row.erp_sucursal_id)} className="w-full text-left">
                                        <div className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
                                            <span className="text-[13px] font-black text-slate-700 tabular-nums shrink-0">#{row.numero}</span>
                                            <SucPill sucId={row.erp_sucursal_id} />
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[row.pedido_status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                                {PEDIDO_LABEL[row.pedido_status] ?? row.pedido_status}
                                            </span>
                                            <span className="ml-auto text-[10px] text-slate-500 tabular-nums shrink-0">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                            {isExp ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                                        </div>
                                        {row.notes && <p className="px-4 pb-2 text-[11px] text-slate-400 italic text-left">{row.notes}</p>}
                                    </button>

                                    {/* Stage + animation + action buttons */}
                                    <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                                        <StagePill stage={stage} />
                                        <StageAnim stage={stage} />

                                        {/* Time details */}
                                        {stage === 'preparando' && row.iniciado_at && (
                                            <span className="text-[10px] text-slate-500 tabular-nums">{fmtMin(Math.max(0, elapsed(row.iniciado_at) - (row.min_pausado_total ?? 0)))}</span>
                                        )}
                                        {stage === 'pausado' && row.pausado_at && (
                                            <span className="text-[10px] text-amber-600 font-medium">{fmtMin(elapsed(row.pausado_at))} pausado</span>
                                        )}
                                        {stage === 'transito' && row.finalizado_at && (
                                            <span className="text-[10px] text-indigo-500 tabular-nums">{fmtMin(elapsed(row.finalizado_at))} en ruta</span>
                                        )}

                                        {/* Action buttons — always visible, stage-appropriate */}
                                        {(canIniciar || canPausar || canReanudar || canFinalizar) && (
                                            <div className="ml-auto flex items-center gap-2 flex-wrap">
                                                {canIniciar && (
                                                    <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar')} disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm shadow-blue-200">
                                                        {isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><Play size={11} fill="currentColor" />Iniciar</>}
                                                    </button>
                                                )}
                                                {canPausar && (
                                                    <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'pausar')} disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-amber-400 text-white hover:bg-amber-500 active:scale-95 transition-all disabled:opacity-50 shadow-sm shadow-amber-200">
                                                        {isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><Pause size={11} fill="currentColor" />Pausar</>}
                                                    </button>
                                                )}
                                                {canFinalizar && (
                                                    <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'finalizar')} disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-violet-500 text-white hover:bg-violet-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm shadow-violet-200">
                                                        {isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><Flag size={11} />Finalizar</>}
                                                    </button>
                                                )}
                                                {canReanudar && (
                                                    <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')} disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm shadow-emerald-200">
                                                        {isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><RotateCcw size={11} />Reanudar</>}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Expanded: items + reception */}
                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                                {loadingItems ? (
                                                    <div className="flex justify-center py-4 border-t border-slate-100"><Loader2 size={16} className="animate-spin text-slate-300" /></div>
                                                ) : (
                                                    <>
                                                        {(items[cardKey]?.length ?? 0) > 0 && (
                                                            <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Ítems ({items[cardKey].length})</div>
                                                                {items[cardKey].map(item => <ItemRow key={item.id} item={item} />)}
                                                            </div>
                                                        )}
                                                        {isBranch && erpSucursalId && row.pedido_status === 'enviado' && (
                                                            <ReceptionActions
                                                                pedidoId={row.pedido_id} sucId={erpSucursalId} sucName={branchName}
                                                                llegadaOk={!!llegadaStatus[cardKey]} erpOk={!!erpStatus[cardKey]}
                                                                items={items[cardKey]}
                                                                onMarkLlegada={() => handleLlegada(row.pedido_id, erpSucursalId, cardKey)}
                                                                onOpenRecibir={() => openModal(row.pedido_id, row.numero, erpSucursalId, cardKey)}
                                                                onMarkErp={() => handleMarkErp(row.pedido_id, erpSucursalId, cardKey)}
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

            {/* ── HISTORY SECTION ─────────────────────────────────────────── */}
            <div>
                <div className="flex items-center gap-2 mb-3 mt-2">
                    <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">Historial</span>
                    {filteredHistory.length > 0 && (
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{filteredHistory.length}{hasMore ? '+' : ''}</span>
                    )}
                </div>

                {loadingHist ? (
                    <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-slate-300" /></div>
                ) : filteredHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-1 text-slate-300">
                        <TrendingDown size={24} className="opacity-50" />
                        <p className="text-[12px] text-slate-400">Sin historial.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredHistory.map(pedido => {
                            const histKey   = `hist_${pedido.id}`;
                            const isExp     = expanded === histKey;
                            const isAnu     = pedido.status === 'anulado';
                            const isDiff    = pedido.status === 'parcial';
                            const cardItems = items[histKey] || [];
                            const diffItems = cardItems.filter(i => i.cantidad_asignada !== i.cantidad_recibida && i.cantidad_recibida != null);

                            return (
                                <motion.div key={pedido.id} layout className={`${GLASS} overflow-hidden ${isAnu ? 'opacity-70' : ''}`}>
                                    <button onClick={() => toggleExpand(histKey, pedido.id, null)} className="w-full text-left">
                                        <div className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
                                            <span className={`text-[13px] font-black tabular-nums shrink-0 ${isAnu ? 'line-through text-slate-400' : 'text-slate-700'}`}>#{pedido.numero}</span>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[pedido.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>{PEDIDO_LABEL[pedido.status] ?? pedido.status}</span>
                                            {isDiff && <PingDot color="amber" />}
                                            <span className="ml-auto text-[10px] text-slate-500 shrink-0">{fmtDate(pedido.created_at)}</span>
                                            {isExp ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                                        </div>
                                        {pedido.notes && <p className="px-4 pb-1.5 text-[11px] text-slate-400 italic text-left">{pedido.notes}</p>}
                                    </button>

                                    {(pedido.sucursal_ids?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-2">
                                            {(pedido.sucursal_ids ?? []).map(sid => <SucPill key={sid} sucId={sid} />)}
                                        </div>
                                    )}

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                                {loadingItems ? (
                                                    <div className="flex justify-center py-4 border-t border-slate-100"><Loader2 size={16} className="animate-spin text-slate-300" /></div>
                                                ) : (
                                                    <div className="border-t border-slate-100 px-4 py-3">
                                                        {diffItems.length > 0 && (
                                                            <div className="mb-3 p-3 rounded-xl bg-amber-50/70 border border-amber-100">
                                                                <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold text-amber-700 uppercase tracking-wide"><AlertTriangle size={11} />{diffItems.length} diferencia{diffItems.length !== 1 ? 's' : ''}</div>
                                                                <div className="space-y-1">{diffItems.map(item => <ItemRow key={item.id} item={item} />)}</div>
                                                            </div>
                                                        )}
                                                        {cardItems.length > 0 ? (
                                                            <>
                                                                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Todos los ítems ({cardItems.length})</div>
                                                                <div className="space-y-1.5">{cardItems.map(item => <ItemRow key={item.id} item={item} />)}</div>
                                                            </>
                                                        ) : (
                                                            <p className="text-[11px] text-slate-400 text-center py-2">Sin ítems.</p>
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

                {hasMore && !searchLower && (
                    <button onClick={() => loadHistory(histPage + 1, filterSuc)} className="mt-3 w-full py-2.5 rounded-2xl border border-slate-200/70 bg-white/60 text-[12px] text-slate-600 font-medium hover:bg-white/80 transition-all">
                        Cargar más pedidos
                    </button>
                )}
            </div>

            {modal && (
                <RecepcionModal open={!!modal} onClose={() => setModal(null)} pedido={modal.pedido} sucursalId={modal.sucId} sucursalNombre={branchName} rows={modal.rows} onConfirmed={() => { setModal(null); fetchItems(modal.key, modal.pedido.id, modal.sucId); }} />
            )}
        </div>
    );
}
