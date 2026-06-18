import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle,
    Truck, Pause, PackageCheck, Play,
    Database, Activity, TrendingDown,
    X, Send, CheckCheck, RotateCcw, Flag, ShieldAlert, UserCircle2,
    Coffee, Users, Clock, ClipboardList, Bell, MessageSquare,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import ModalShell from '../../components/common/ModalShell';
import RecepcionModal from './RecepcionModal';
import { ERP_NAMES } from '../../constants/erp';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ───────────────────────────────────────────────────────────────

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
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

const PAUSE_REASONS = [
    { key: 'almuerzo',     label: 'Almuerzo',             icon: Coffee,        maxUses: 1    },
    { key: 'personal',     label: 'Falta de personal',    icon: Users,         maxUses: null },
    { key: 'insumos',      label: 'Espera de insumos',    icon: Clock,         maxUses: null },
    { key: 'reunion',      label: 'Reunión de turno',     icon: ClipboardList, maxUses: null },
    { key: 'interrupcion', label: 'Interrupción externa', icon: Bell,          maxUses: null },
    { key: 'otro',         label: 'Otro…',                icon: MessageSquare, maxUses: null, requiresComment: true },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMin(min) {
    if (min == null || isNaN(min) || min < 0) return null;
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60), m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function elapsed(isoFrom, isoTo = null) {
    if (!isoFrom) return null;
    const from = new Date(isoFrom);
    const to   = isoTo ? new Date(isoTo) : new Date();
    if (isNaN(from) || isNaN(to)) return null;
    return Math.floor((to - from) / 60_000);
}
function fmtRelative(iso) {
    if (!iso) return '—';
    const min = elapsed(iso);
    if (min == null) return '—';
    if (min < 1)  return 'ahora';
    if (min < 60) return `hace ${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24)   return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
}
function getBranchStage(row, pedidoStatus) {
    if (!row) return 'sin_iniciar';
    if (row.recibido_erp_at)                             return 'erp';
    if (row.llegada_fisica_at)                           return 'contando';
    if (row.finalizado_at && pedidoStatus === 'enviado') return 'transito';
    if (row.finalizado_at)                               return 'preparado';
    if (row.pausado_at && !row.reanudado_at)             return 'pausado';
    if (row.iniciado_at)                                 return 'preparando';
    return 'sin_iniciar';
}

// solicitado = need in presentation units before dispatch rounding
function calcSolicitado(row) {
    if (row.max_qty_snapshot == null || row.stock_packs_snapshot == null) return null;
    const factor = row.factor || 1;
    const needUnits = row.max_qty_snapshot - row.stock_packs_snapshot * factor;
    return Math.max(0, Math.ceil(needUnits / factor));
}

function fmtRegla(row) {
    if (!row.dispatch_tipo) return <span className="text-slate-400">—</span>;
    const tipos = { caja: 'CAJA', blister: 'BLISTER', multiplo: 'UND ×', multiplo_unidades: 'UND ×', solo_cajas: 'SOLO CAJAS' };
    const base  = tipos[row.dispatch_tipo] ?? row.dispatch_tipo.toUpperCase();
    const showFactor = row.dispatch_factor > 1 && !['solo_cajas'].includes(row.dispatch_tipo);
    return (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {base}{showFactor ? ` ${row.dispatch_factor}` : ''}
        </span>
    );
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
                <motion.path d="M1 28 L7 28" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 0.8, repeat: Infinity }} />
                <motion.path d="M0 33 L6 33" strokeWidth="1.5" animate={{ x: [-3, 0, -3], opacity: [0.1, 0.5, 0.1] }} transition={{ duration: 0.8, repeat: Infinity, delay: 0.12 }} />
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
            <motion.div className="absolute left-0 right-0 h-0.5 bg-teal-400/80 rounded-full" animate={{ top: ['8%', '88%', '8%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
    );
}

function PingDot({ color = 'blue', size = 'sm' }) {
    const sz  = size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5';
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

// ─── Employee chip ────────────────────────────────────────────────────────────

function EmpChip({ emp, label }) {
    if (!emp) return null;
    return (
        <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 font-medium shrink-0">
            <span className="text-slate-400 text-[9px] uppercase tracking-wide">{label}</span>
            {emp.photo
                ? <img src={emp.photo} alt={emp.name} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm" />
                : <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center"><UserCircle2 size={12} className="text-slate-400" /></span>
            }
            <span className="text-slate-600">{emp.name?.split(' ')[0] ?? '—'}</span>
        </span>
    );
}

// ─── Pills ────────────────────────────────────────────────────────────────────

function StagePill({ stage }) {
    const cfg = STAGE_CONFIG[stage], colors = COLOR_CLS[cfg.color], Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${colors.bg} ${colors.text} ${colors.border}`}>
            <Icon size={10} /> {cfg.label}
        </span>
    );
}

function SucPill({ sucId }) {
    const cls = SUC_COLORS[sucId] ?? 'bg-slate-100 text-slate-600 border-slate-200';
    return (
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0 ${cls}`}>
            <Building2 size={11} /> {ERP_NAMES[sucId] ?? `Suc. ${sucId}`}
        </span>
    );
}

// ─── Pause Modal ──────────────────────────────────────────────────────────────

function PauseModal({ modal, history, kioskLunch, razonSel, setRazonSel, comment, setComment, onCancel, onConfirm, busy }) {
    const alreadyHadAlmuerzo = history.some(h => h.razon?.toLowerCase().includes('almuerzo'));
    const reason = PAUSE_REASONS.find(r => r.key === razonSel);
    const canConfirm = !(reason?.requiresComment && !comment.trim());

    return (
        <ModalShell open={true} onClose={onCancel}>
            <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4">
                <div>
                    <h3 className="font-bold text-slate-800 text-[16px]">¿Por qué pausas este despacho?</h3>
                    <p className="text-[12px] text-slate-400 mt-0.5">{ERP_NAMES[modal.sucId] ?? `Sucursal ${modal.sucId}`}</p>
                </div>

                {kioskLunch && (
                    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-700">
                        <Coffee size={15} className="text-teal-500 shrink-0" />
                        <div>
                            <p className="text-[12px] font-semibold">Almuerzo detectado en el kiosko</p>
                            <p className="text-[10px] text-teal-600">Tu marcaje de salida a almuerzo se registró hoy.</p>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                    {PAUSE_REASONS.map(opt => {
                        const Icon = opt.icon;
                        const isUsed = opt.maxUses === 1 && alreadyHadAlmuerzo;
                        const isSelected = razonSel === opt.key;
                        return (
                            <button
                                key={opt.key}
                                disabled={isUsed}
                                onClick={() => !isUsed && setRazonSel(opt.key)}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-medium transition-all text-left ${
                                    isUsed    ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed' :
                                    isSelected ? 'border-amber-400 bg-amber-50 text-amber-800 shadow-sm' :
                                                 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                <Icon size={15} className={isUsed ? 'text-slate-300' : isSelected ? 'text-amber-600' : 'text-slate-400'} />
                                <div>
                                    <div>{opt.label}</div>
                                    {isUsed && <div className="text-[10px] text-slate-400">Ya registrado</div>}
                                </div>
                            </button>
                        );
                    })}
                </div>

                <div>
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
                        {reason?.requiresComment ? 'Describe la razón *' : 'Comentario (opcional)'}
                    </label>
                    <textarea
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        placeholder={reason?.requiresComment ? 'Describe la razón…' : 'Añade un comentario…'}
                        rows={2}
                        className="w-full text-[13px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 bg-white resize-none transition-colors"
                    />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                    <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors">
                        Cancelar
                    </button>
                    <button
                        disabled={!canConfirm || busy}
                        onClick={onConfirm}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 text-[13px] transition-colors disabled:opacity-50"
                    >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
                        Confirmar pausa
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}

// ─── Item sections inside expanded card ──────────────────────────────────────

function renderLab(row) {
    return <span className="text-slate-400 text-[11px] whitespace-nowrap">{row.products?.laboratorios?.nombre ?? '—'}</span>;
}
function renderProd(row) {
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-slate-700">{row.products?.nombre ?? `Prod. ${row.erp_product_id}`}</span>
            {row.products?.es_antibiotico && <span className="text-[9px] px-1.5 rounded-full bg-red-50 border border-red-200 text-red-500 font-semibold shrink-0">Abx</span>}
        </div>
    );
}
function renderPresentacion(row) {
    const tipo   = row.dispatch_tipo;
    const factor = row.dispatch_factor || row.factor || 1;
    const TIPO_LABELS = { caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja' };
    if (!tipo) {
        if (factor > 1) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">×{factor} unid</span>;
        return <span className="text-slate-400 text-[11px]">Unidad</span>;
    }
    const label      = TIPO_LABELS[tipo] ?? tipo;
    const showFactor = factor > 1 && ['caja','blister','solo_cajas'].includes(tipo);
    return (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            {label}{showFactor ? ` ×${factor}` : ''}{['multiplo','multiplo_unidades'].includes(tipo) ? ` ×${factor}` : ''}
        </span>
    );
}
const renderSolicitado = r => {
    const sol = calcSolicitado(r);
    return sol != null
        ? <span className="tabular-nums text-slate-500">{sol}</span>
        : <span className="text-slate-300">—</span>;
};

const COLS_ENVIADOS = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'asig',       label: 'Enviado',    align: 'center', render: r => <span className="font-bold tabular-nums">{r.cantidad_asignada}</span> },
    { key: 'rec',        label: 'Recibido',   align: 'center', render: r => {
        if (r.cantidad_recibida == null) return <span className="text-slate-400">—</span>;
        const diff = r.cantidad_recibida - r.cantidad_asignada;
        return (
            <span className={`font-bold tabular-nums ${diff < 0 ? 'text-amber-600' : diff > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                {r.cantidad_recibida}{diff !== 0 && <span className="text-[10px] ml-0.5">({diff > 0 ? '+' : ''}{diff})</span>}
            </span>
        );
    }},
    { key: 'status', label: 'Estado', render: r => (
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.status === 'recibido'       ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            r.status === 'con_diferencia' ? 'bg-amber-50   text-amber-700   border-amber-200'   :
                                            'bg-slate-50   text-slate-500   border-slate-200'
        }`}>
            {r.status === 'recibido' ? 'Recibido' : r.status === 'con_diferencia' ? 'Diferencia' : 'Pendiente'}
        </span>
    )},
];

const COLS_SIN_STOCK = [
    { key: 'lab',        label: 'Laboratorio',  render: renderLab },
    { key: 'prod',       label: 'Producto',     render: renderProd },
    { key: 'pres',       label: 'Presentación', render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'motivo',     label: 'Motivo', render: () => <span className="text-amber-600 text-[11px]">Sin stock en bodega</span> },
];

const COLS_REGLA = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'regla',      label: 'Regla',         render: fmtRegla },
    { key: 'motivo',     label: 'Motivo', render: () => <span className="text-rose-600 text-[11px]">Necesidad &lt; 40% de la unidad mínima de despacho</span> },
];

function ItemSection({ label, count, badgeCls, rows, columns, noteEl, defaultOpen = false }) {
    const [open,  setOpen]  = useState(defaultOpen);
    const [page,  setPage]  = useState(0);
    const totalPages = Math.ceil(rows.length / MINI_PAGE);
    const pageRows   = rows.slice(page * MINI_PAGE, (page + 1) * MINI_PAGE);

    if (!count) return null;

    return (
        <div className="border-t border-slate-100">
            <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50/50 transition-colors">
                <span className="text-[11px] font-semibold text-slate-700 flex-1">{label}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${badgeCls}`}>{count}</span>
                {open ? <ChevronDown size={12} className="text-slate-400 shrink-0" /> : <ChevronRight size={12} className="text-slate-400 shrink-0" />}
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-3">
                            {noteEl}
                            <DataTable
                                columns={columns}
                                minWidth="400px"
                                footer={totalPages > 1 ? (
                                    <div className="flex items-center justify-between w-full">
                                        <span className="text-[10px] text-slate-400">{rows.length} registros · p. {page + 1}/{totalPages}</span>
                                        <div className="flex gap-1">
                                            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="w-6 h-6 text-[12px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30">‹</button>
                                            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="w-6 h-6 text-[12px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30">›</button>
                                        </div>
                                    </div>
                                ) : undefined}
                            >
                                {pageRows.map((row, idx) => (
                                    <DataRow key={row.id ?? idx} index={idx}>
                                        {columns.map(col => (
                                            <DataCell key={col.key} align={col.align ?? 'left'}>
                                                {col.render ? col.render(row) : row[col.key]}
                                            </DataCell>
                                        ))}
                                    </DataRow>
                                ))}
                            </DataTable>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ItemSections({ allItems, loading }) {
    if (loading) return <div className="flex justify-center py-5 border-t border-slate-100"><Loader2 size={16} className="animate-spin text-slate-300" /></div>;

    const enviados = allItems.filter(i => i.cantidad_asignada > 0);
    const sinStock = allItems.filter(i => i.sin_stock);
    const porRegla = allItems.filter(i => i.revision_minmax);
    const total    = enviados.length + sinStock.length + porRegla.length;

    if (total === 0) return <div className="border-t border-slate-100 py-4 text-center text-[11px] text-slate-400">Sin ítems.</div>;

    return (
        <>
            <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50/60 flex items-center gap-5 flex-wrap">
                <span className="text-[11px] text-slate-500">Solicitados <strong className="text-slate-700">{total}</strong></span>
                <span className="text-[11px] text-slate-500">Enviados <strong className="text-emerald-600">{enviados.length}</strong></span>
                {sinStock.length > 0 && <span className="text-[11px] text-slate-500">Sin inventario <strong className="text-amber-600">{sinStock.length}</strong></span>}
                {porRegla.length > 0 && <span className="text-[11px] text-slate-500">Revisar regla <strong className="text-rose-600">{porRegla.length}</strong></span>}
            </div>
            <ItemSection label="Productos enviados" count={enviados.length} badgeCls="bg-emerald-50 text-emerald-700 border-emerald-200" rows={enviados} columns={COLS_ENVIADOS} defaultOpen={true} />
            <ItemSection label="Sin inventario en bodega" count={sinStock.length} badgeCls="bg-amber-50 text-amber-700 border-amber-200" rows={sinStock} columns={COLS_SIN_STOCK} noteEl={<p className="text-[10px] text-amber-600/80">No se incluyeron por falta de stock en bodega al momento del despacho.</p>} />
            <ItemSection
                label="Revisar regla de despacho" count={porRegla.length} badgeCls="bg-rose-50 text-rose-700 border-rose-200" rows={porRegla} columns={COLS_REGLA}
                noteEl={<div className="flex items-start gap-2 text-[10px] text-rose-600/80 bg-rose-50/60 border border-rose-100 rounded-xl px-3 py-2"><ShieldAlert size={12} className="mt-0.5 shrink-0 text-rose-500" />La cantidad requerida no alcanzó el 40% de la unidad mínima de despacho. Ajusta la regla o los MIN/MAX del producto para que se incluya en el próximo pedido.</div>}
            />
        </>
    );
}

// ─── Reception actions ────────────────────────────────────────────────────────

function ReceptionActions({ pedidoId, sucId, llegadaOk, erpOk, items, onMarkLlegada, onOpenRecibir, onMarkErp, busy }) {
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
    const hasActive = filterSuc !== 'all' || filterStatus !== 'all';
    const clearAll  = () => { setFilterSuc('all'); setFilterStatus('all'); };

    const statusBtn = (key, label) => (
        <button
            onClick={() => setFilterStatus(v => v === key ? 'all' : key)}
            className={`flex items-center gap-1 px-3 h-8 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-200 whitespace-nowrap shrink-0 ${
                filterStatus === key
                    ? (key === 'confirmado' ? 'bg-blue-100 border-blue-200 text-blue-700 shadow-sm'
                      : 'bg-indigo-100 border-indigo-200 text-indigo-700 shadow-sm')
                    : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-50 hover:border-slate-200 hover:text-slate-600'
            }`}
        >
            {label}{filterStatus === key && <X size={9} strokeWidth={3} className="ml-0.5" />}
        </button>
    );

    return (
        <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 hover:border-slate-200 overflow-visible shrink-0">
            {!isBranch && (
                <>
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible" style={{ width: '155px' }}>
                            <LiquidSelect value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} placeholder="Todas" icon={Building2} compact bare />
                        </div>
                        {filterSuc !== 'all' && (
                            <button onClick={() => setFilterSuc('all')} className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                </>
            )}
            <div className="flex items-center gap-1 px-2">
                {statusBtn('confirmado', 'Pendientes')}
                {statusBtn('enviado', 'En camino')}
            </div>
            {hasActive && (
                <>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                    <button onClick={clearAll} className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 shrink-0">
                        <X size={11} strokeWidth={3} />
                    </button>
                </>
            )}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabPedidos({ searchTerm = '' }) {
    const { user, getScope, hasPermission } = useAuth();
    const isBranch = getScope('pedidos') === 'BRANCH';
    const canEdit  = hasPermission('pedidos_en_curso', 'can_edit');

    // Employee store for name/photo lookups
    const storeEmployees = useStaff(s => s.employees);
    const empMap = useMemo(() => {
        const m = new Map();
        (storeEmployees || []).forEach(e => m.set(e.id, e));
        return m;
    }, [storeEmployees]);

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

    const [expanded,     setExpanded]     = useState(null);
    const [expandedMeta, setExpandedMeta] = useState(null);
    const expandedMetaRef = useRef(null);
    useEffect(() => { expandedMetaRef.current = expandedMeta; }, [expandedMeta]);

    const [items,         setItems]         = useState({});
    const [loadingItems,  setLoadingItems]  = useState(false);
    const [llegadaStatus, setLlegadaStatus] = useState({});
    const [erpStatus,     setErpStatus]     = useState({});
    const [busyAction,    setBusyAction]    = useState(null);
    const [busyLifecycle, setBusyLifecycle] = useState(null);
    const [busyEnvio,     setBusyEnvio]     = useState(null);
    const [modal,         setModal]         = useState(null);
    const [newAlert,      setNewAlert]      = useState(null);

    // Pause modal
    const [pauseModal,   setPauseModal]   = useState(null);
    const [pauseHistory, setPauseHistory] = useState([]);
    const [pauseRazon,   setPauseRazon]   = useState('almuerzo');
    const [pauseComment, setPauseComment] = useState('');
    const [kioskLunch,   setKioskLunch]   = useState(false);

    // ── Branch ERP ────────────────────────────────────────────────────────────

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

    // ── Loaders ───────────────────────────────────────────────────────────────

    const loadActive = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_pedidos_en_curso');
        if (!error) setActiveRows(data ?? []);
    }, []);

    const loadHistory = useCallback(async (page = 0, suc = 'all') => {
        if (page === 0) setLoadingHist(true);
        let q = supabase.from('pedidos').select('id, numero, created_at, status, notes, enviado_at, sucursal_ids, created_by').in('status', DONE_STATUSES).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (suc !== 'all' && suc) q = q.contains('sucursal_ids', [suc]);
        const { data } = await q;
        const rows = data || [];
        if (page === 0) { setHistory(rows); setHistPage(0); } else { setHistory(prev => [...prev, ...rows]); setHistPage(page); }
        setHasMore(rows.length === PAGE_SIZE);
        if (page === 0) setLoadingHist(false);
    }, []);

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

    // ── Fetch items ───────────────────────────────────────────────────────────

    const fetchItems = useCallback(async (key, pedidoId, sucId) => {
        if (!pedidoId) return;
        setLoadingItems(true);
        const sucFilter = sucId ?? (isBranch && erpSucursalId ? erpSucursalId : null);

        let itemsQ = supabase.from('pedido_items')
            .select(`
                id, erp_sucursal_id, erp_product_id, cantidad_asignada, cantidad_recibida,
                status, nota_diferencia, received_at, lotes_asignados,
                sin_stock, revision_minmax,
                factor, dispatch_tipo, dispatch_factor,
                max_qty_snapshot, stock_packs_snapshot,
                products ( nombre, es_antibiotico, laboratorios ( nombre ) )
            `)
            .eq('pedido_id', pedidoId)
            .range(0, 999);
        if (sucFilter) itemsQ = itemsQ.eq('erp_sucursal_id', sucFilter);

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

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    const handleLifecycle = useCallback(async (pedidoId, sucId, stage, razon = null) => {
        const key = `lc_${pedidoId}_${sucId}`;
        setBusyLifecycle(key);
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: stage, p_user_id: user?.id ?? null, p_razon: razon });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, pedidoId, { sucursal_id: sucId, razon });
            loadActive();
        } catch (e) { console.error('Lifecycle error:', e); } finally { setBusyLifecycle(null); }
    }, [user, loadActive]);

    const handleMarcarEnRuta = useCallback(async (pedidoId) => {
        setBusyEnvio(pedidoId);
        try {
            const { error } = await supabase.rpc('marcar_pedido_enviado', { p_pedido_id: pedidoId, p_enviado_por: user?.id ?? null });
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_MARCAR_EN_RUTA', pedidoId, {});
            loadActive();
            loadHistory(0, filterSuc);
        } catch (e) { console.error('Envío error:', e); } finally { setBusyEnvio(null); }
    }, [user, loadActive, loadHistory, filterSuc]);

    const openPauseModal = useCallback(async (pedidoId, sucId) => {
        try {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [{ data: histData }, { data: punchData }] = await Promise.all([
                supabase.from('pedido_pausa_historial').select('razon').eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId),
                user?.id
                    ? supabase.from('attendance').select('type, timestamp').eq('employee_id', user.id).in('type', ['OUT_LUNCH', 'IN_LUNCH']).gte('timestamp', todayStart.toISOString()).order('timestamp', { ascending: false }).limit(10)
                    : Promise.resolve({ data: [] }),
            ]);

            const history = histData ?? [];
            const punches = punchData ?? [];
            const onKioskLunch = punches.length > 0 && punches[0].type === 'OUT_LUNCH';
            const alreadyUsedAlmuerzo = history.some(h => h.razon?.toLowerCase().includes('almuerzo'));

            setKioskLunch(onKioskLunch);
            setPauseHistory(history);
            setPauseRazon(onKioskLunch && !alreadyUsedAlmuerzo ? 'almuerzo' : 'personal');
            setPauseComment('');
            setPauseModal({ pedidoId, sucId });
        } catch (e) {
            console.error('openPauseModal error:', e);
            // Abre el modal aunque falle la detección de kiosko
            setPauseHistory([]);
            setKioskLunch(false);
            setPauseRazon('personal');
            setPauseComment('');
            setPauseModal({ pedidoId, sucId });
        }
    }, [user?.id]);

    const confirmPause = useCallback(async () => {
        if (!pauseModal) return;
        const reason = PAUSE_REASONS.find(r => r.key === pauseRazon);
        let razon = reason?.label ?? pauseRazon;
        if (pauseComment.trim()) razon += ` — ${pauseComment.trim()}`;
        await handleLifecycle(pauseModal.pedidoId, pauseModal.sucId, 'pausar', razon);
        setPauseModal(null);
    }, [pauseModal, pauseRazon, pauseComment, handleLifecycle]);

    // ── Reception ─────────────────────────────────────────────────────────────

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

    // ── Derived ───────────────────────────────────────────────────────────────

    const searchLower   = searchTerm.toLowerCase();
    const filterOptions = [{ value: 'all', label: 'Todas' }, ...ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` }))];

    // Group activeRows by pedido to detect if ALL sucursales for a pedido are preparado
    const pedidoStageMap = useMemo(() => {
        const map = new Map(); // pedidoId → { allPreparado, anyPreparando }
        activeRows.forEach(row => {
            const stage = getBranchStage(row, row.pedido_status);
            const prev  = map.get(row.pedido_id) ?? { allFinalized: true, anyActive: false };
            map.set(row.pedido_id, {
                allFinalized: prev.allFinalized && !!row.finalizado_at,
                anyActive:    prev.anyActive || (!!row.iniciado_at && !row.finalizado_at),
            });
        });
        return map;
    }, [activeRows]);

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

    const filteredHistory = history.filter(p =>
        !searchLower || String(p.numero).includes(searchLower) || (p.notes ?? '').toLowerCase().includes(searchLower)
    );

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

            {/* ── EN CURSO ──────────────────────────────────────────────── */}
            <div>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                    </span>
                    <span className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">En curso</span>
                    {filteredRows.length > 0 && <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">{filteredRows.length}</span>}
                    <div className="ml-auto">
                        <FilterPill isBranch={isBranch} filterSuc={filterSuc} setFilterSuc={setFilterSuc} filterStatus={filterStatus} setFilterStatus={setFilterStatus} filterOptions={filterOptions} />
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
                            const stage      = getBranchStage(row, row.pedido_status);
                            const cardKey    = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isExp      = expanded === cardKey;
                            const lcKey      = `lc_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isLCBusy   = busyLifecycle === lcKey;
                            const isEnvioBusy = busyEnvio === row.pedido_id;

                            const pedidoStages = pedidoStageMap.get(row.pedido_id) ?? {};
                            const canActuar = canEdit || !isBranch; // admin/bodega

                            const canIniciar       = canActuar && !isBranch && stage === 'sin_iniciar' && row.pedido_status === 'confirmado';
                            const canPausar        = canActuar && !isBranch && stage === 'preparando';
                            const canReanudar      = canActuar && !isBranch && stage === 'pausado';
                            const canFinalizar     = canActuar && !isBranch && stage === 'preparando';
                            // Botón aparece por sucursal cuando esa ya está lista (preparado), sin esperar a las demás
                            const canMarcarEnRuta  = canActuar && !isBranch && stage === 'preparado' && row.pedido_status === 'confirmado';

                            const creator  = row.created_by  ? empMap.get(row.created_by)  : null;
                            const iniciador = row.iniciado_por ? empMap.get(row.iniciado_por) : null;

                            const elapsedPrep  = stage === 'preparando' ? fmtMin(Math.max(0, (elapsed(row.iniciado_at) ?? 0) - (row.min_pausado_total ?? 0))) : null;
                            const elapsedPause = stage === 'pausado'    ? fmtMin(elapsed(row.pausado_at)) : null;
                            const elapsedTrans = stage === 'transito'   ? fmtMin(elapsed(row.finalizado_at)) : null;

                            return (
                                <motion.div key={cardKey} layout className={`${GLASS} overflow-hidden ${stage === 'pausado' ? 'ring-1 ring-amber-300' : ''}`}>

                                    {/* Header — clickable to expand */}
                                    <button onClick={() => toggleExpand(cardKey, row.pedido_id, row.erp_sucursal_id)} className="w-full text-left">
                                        <div className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
                                            <span className="text-[13px] font-black text-slate-700 tabular-nums shrink-0">#{row.numero}</span>
                                            <SucPill sucId={row.erp_sucursal_id} />
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[row.pedido_status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>{PEDIDO_LABEL[row.pedido_status] ?? row.pedido_status}</span>
                                            <span className="ml-auto text-[10px] text-slate-500 tabular-nums shrink-0">{fmtRelative(row.enviado_at ?? row.created_at)}</span>
                                            {isExp ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
                                        </div>
                                        {row.notes && <p className="px-4 pb-2 text-[11px] text-slate-400 italic text-left">{row.notes}</p>}
                                    </button>

                                    {/* Employee chips — creator + initiator */}
                                    {(creator || iniciador) && (
                                        <div className="flex items-center gap-4 px-4 pb-2.5 flex-wrap">
                                            {creator   && <EmpChip emp={creator}   label="Generó" />}
                                            {iniciador && <EmpChip emp={iniciador} label="Inició" />}
                                        </div>
                                    )}

                                    {/* Stage strip */}
                                    <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                                        <StagePill stage={stage} />
                                        <StageAnim stage={stage} />
                                        {elapsedPrep  && <span className="text-[10px] text-slate-500 tabular-nums">{elapsedPrep}</span>}
                                        {elapsedPause && <span className="text-[10px] text-amber-600 font-medium">{elapsedPause} pausado</span>}
                                        {elapsedTrans && <span className="text-[10px] text-indigo-500 tabular-nums">{elapsedTrans} en ruta</span>}

                                        <div className="ml-auto flex items-center gap-2 flex-wrap">
                                            {canIniciar      && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar')}       disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-blue-500    text-white hover:bg-blue-600    active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><Play     size={11} fill="currentColor" />Iniciar</>}</button>}
                                            {canPausar       && <button onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}                  disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-amber-400   text-white hover:bg-amber-500   active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><Pause    size={11} fill="currentColor" />Pausar</>}</button>}
                                            {canFinalizar    && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'finalizar')}     disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-violet-500  text-white hover:bg-violet-600  active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><Flag     size={11} />Finalizar</>}</button>}
                                            {canReanudar     && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}     disabled={isLCBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={12} className="animate-spin" /> : <><RotateCcw size={11} />Reanudar</>}</button>}
                                            {canMarcarEnRuta && <button onClick={() => handleMarcarEnRuta(row.pedido_id)}                                   disabled={isEnvioBusy} className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isEnvioBusy ? <Loader2 size={12} className="animate-spin" /> : <><Truck size={11} />Marcar en Ruta</>}</button>}
                                        </div>
                                    </div>

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                                <ItemSections allItems={items[cardKey] ?? []} loading={loadingItems && !items[cardKey]} />
                                                {isBranch && erpSucursalId && row.pedido_status === 'enviado' && (
                                                    <ReceptionActions
                                                        pedidoId={row.pedido_id} sucId={erpSucursalId}
                                                        llegadaOk={!!llegadaStatus[cardKey]} erpOk={!!erpStatus[cardKey]}
                                                        items={items[cardKey]}
                                                        onMarkLlegada={() => handleLlegada(row.pedido_id, erpSucursalId, cardKey)}
                                                        onOpenRecibir={() => openModal(row.pedido_id, row.numero, erpSucursalId, cardKey)}
                                                        onMarkErp={() => handleMarkErp(row.pedido_id, erpSucursalId, cardKey)}
                                                        busy={busyAction}
                                                    />
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

            {/* ── HISTORIAL ─────────────────────────────────────────────── */}
            <div>
                <div className="flex items-center gap-2 mb-3 mt-2">
                    <span className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">Historial</span>
                    {filteredHistory.length > 0 && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{filteredHistory.length}{hasMore ? '+' : ''}</span>}
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
                            const histKey = `hist_${pedido.id}`;
                            const isExp   = expanded === histKey;
                            const creator = pedido.created_by ? empMap.get(pedido.created_by) : null;

                            return (
                                <motion.div key={pedido.id} layout className={`${GLASS} overflow-hidden ${pedido.status === 'anulado' ? 'opacity-70' : ''}`}>
                                    <button onClick={() => toggleExpand(histKey, pedido.id, null)} className="w-full text-left">
                                        <div className="flex items-center gap-2.5 px-4 py-3 flex-wrap">
                                            <span className={`text-[13px] font-black tabular-nums shrink-0 ${pedido.status === 'anulado' ? 'line-through text-slate-400' : 'text-slate-700'}`}>#{pedido.numero}</span>
                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${PEDIDO_PILL[pedido.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>{PEDIDO_LABEL[pedido.status] ?? pedido.status}</span>
                                            {creator && <EmpChip emp={creator} label="Por" />}
                                            <span className="ml-auto text-[10px] text-slate-500 shrink-0">{fmtDate(pedido.created_at)}</span>
                                            {isExp ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                                        </div>
                                    </button>

                                    {(pedido.sucursal_ids?.length ?? 0) > 0 && (
                                        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-2">
                                            {(pedido.sucursal_ids ?? []).map(sid => <SucPill key={sid} sucId={sid} />)}
                                        </div>
                                    )}

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                                                <ItemSections allItems={items[histKey] ?? []} loading={loadingItems && !items[histKey]} />
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

            {/* ── Modals ─────────────────────────────────────────────────── */}

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

            {modal && (
                <RecepcionModal open={!!modal} onClose={() => setModal(null)} pedido={modal.pedido} sucursalId={modal.sucId} sucursalNombre={branchName} rows={modal.rows} onConfirmed={() => { setModal(null); fetchItems(modal.key, modal.pedido.id, modal.sucId); }} />
            )}
        </div>
    );
}
