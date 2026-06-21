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
    UserPlus, ScanLine, Inbox,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import RecepcionModal from './RecepcionModal';
import PedidoModal from './PedidoModal';
import { ERP_NAMES } from '../../constants/erp';
import LiquidSelect from '../../components/common/LiquidSelect';
import PeriodPicker from '../../components/common/PeriodPicker';

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
    return Math.max(0, Math.ceil(row.max_qty_snapshot - row.stock_packs_snapshot));
}

function fmtRegla(row) {
    if (!row.dispatch_tipo) return <span className="text-slate-400">—</span>;
    const tipos = { caja: 'CAJA', blister: 'BLISTER', multiplo: 'UND ×', multiplo_unidades: 'UND ×', solo_cajas: 'SOLO CAJAS' };
    const base  = tipos[row.dispatch_tipo] ?? row.dispatch_tipo.toUpperCase();
    const showFactor = row.dispatch_factor > 1
        && !['solo_cajas'].includes(row.dispatch_tipo)
        && !row.dispatch_tipo.includes(String(row.dispatch_factor));
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
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 font-medium shrink-0">
            <span className="text-slate-500 text-[10px] uppercase tracking-wide">{label}</span>
            {emp.photo
                ? <img src={emp.photo} alt={emp.name} className="w-5 h-5 rounded-full object-cover border border-white shadow-sm" />
                : <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center"><UserCircle2 size={12} className="text-slate-500" /></span>
            }
            <span className="text-slate-800 font-semibold">{emp.name?.split(' ')[0] ?? '—'}</span>
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
    const reason     = PAUSE_REASONS.find(r => r.key === razonSel);
    const canConfirm = !(reason?.requiresComment && !comment.trim());

    return (
        <PedidoModal onClose={onCancel}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shadow-sm shrink-0">
                            <Pause size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-[15px]">Pausar despacho</h3>
                            <p className="text-[12px] text-slate-600 mt-0.5">{ERP_NAMES[modal.sucId] ?? `Sucursal ${modal.sucId}`}</p>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="space-y-4">
                    {kioskLunch && (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-teal-50 border border-teal-200">
                            <Coffee size={15} className="text-teal-500 shrink-0" />
                            <div>
                                <p className="text-[12px] font-semibold text-teal-800">Almuerzo detectado en el kiosko</p>
                                <p className="text-[11px] text-teal-600">Tu marcaje de salida a almuerzo se registró hoy.</p>
                            </div>
                        </div>
                    )}

                    <div>
                        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-2">¿Por qué pausas?</p>
                        <div className="grid grid-cols-2 gap-2">
                            {PAUSE_REASONS.map(opt => {
                                const Icon     = opt.icon;
                                const isUsed   = opt.maxUses === 1 && alreadyHadAlmuerzo;
                                const isSel    = razonSel === opt.key;
                                return (
                                    <button
                                        key={opt.key}
                                        disabled={isUsed}
                                        onClick={() => !isUsed && setRazonSel(opt.key)}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-medium transition-all text-left ${
                                            isUsed ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed' :
                                            isSel  ? 'border-amber-400 bg-amber-50 text-amber-800 shadow-sm' :
                                                     'border-slate-200 text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <Icon size={15} className={isUsed ? 'text-slate-300' : isSel ? 'text-amber-600' : 'text-slate-500'} />
                                        <div>
                                            <div>{opt.label}</div>
                                            {isUsed && <div className="text-[10px] text-slate-400">Ya registrado</div>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">
                            {reason?.requiresComment ? 'Describe la razón *' : 'Comentario (opcional)'}
                        </label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder={reason?.requiresComment ? 'Describe la razón…' : 'Añade un comentario…'}
                            rows={2}
                            className="w-full text-[13px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 bg-white resize-none transition-colors text-slate-700"
                        />
                    </div>
                </PedidoModal.Body>

                <PedidoModal.Footer>
                    <div className="flex justify-end gap-2">
                        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-[13px] font-medium transition-colors">
                            Cancelar
                        </button>
                        <button
                            disabled={!canConfirm || busy}
                            onClick={onConfirm}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 text-[13px] transition-colors disabled:opacity-50 shadow-sm"
                        >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
                            Confirmar pausa
                        </button>
                    </div>
                </PedidoModal.Footer>
        </PedidoModal>
    );
}

// ─── Apoyo scanner modal ──────────────────────────────────────────────────────

function ApoioScanModal({ open, onClose, pedidoId, sucId, currentUserId, onSuccess }) {
    const [displayDots, setDisplayDots] = useState(0);
    const [employee,    setEmployee]    = useState(null);
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [manualWarn,  setManualWarn]  = useState(false);

    const bufferRef   = useRef('');
    const lastTimeRef = useRef(0);
    const timerRef    = useRef(null);
    const isManRef    = useRef(false);

    useEffect(() => {
        if (!open) {
            bufferRef.current  = '';
            lastTimeRef.current = 0;
            isManRef.current   = false;
            setDisplayDots(0);
            setEmployee(null);
            setError('');
            setManualWarn(false);
        }
    }, [open]);

    const lookupPin = useCallback(async (code) => {
        setLoading(true);
        setError('');
        try {
            const { data } = await supabase
                .from('employees')
                .select('id, name, photo_url')
                .eq('kiosk_pin', code.toUpperCase().trim())
                .maybeSingle();
            if (data) { setEmployee(data); setManualWarn(false); }
            else       setError('No se encontró ningún empleado con ese carnet.');
        } catch { setError('Error al buscar empleado.'); }
        finally   { setLoading(false); }
    }, []);

    useEffect(() => {
        if (!open) return;
        const handleKey = (e) => {
            if (e.key === 'Escape') return;
            const now = Date.now();
            const gap = now - lastTimeRef.current;
            lastTimeRef.current = now;

            if (e.key === 'Enter') {
                const buf = bufferRef.current;
                bufferRef.current = '';
                setDisplayDots(0);
                clearTimeout(timerRef.current);
                if (buf.length >= 3 && !isManRef.current) lookupPin(buf);
                isManRef.current = false;
                return;
            }
            if (e.key.length !== 1) return;

            if (bufferRef.current.length > 0 && gap > 80) {
                // Manual typing detected
                isManRef.current = true;
                setManualWarn(true);
                setEmployee(null);
                bufferRef.current = e.key;
                setDisplayDots(1);
            } else {
                if (bufferRef.current.length === 0) isManRef.current = false;
                bufferRef.current += e.key;
                setDisplayDots(bufferRef.current.length);
            }

            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                bufferRef.current = '';
                isManRef.current  = false;
                setDisplayDots(0);
            }, 500);
        };
        document.addEventListener('keydown', handleKey, { capture: true });
        return () => { document.removeEventListener('keydown', handleKey, { capture: true }); clearTimeout(timerRef.current); };
    }, [open, lookupPin]);

    const confirmApoyo = useCallback(async () => {
        if (!employee) return;
        setLoading(true);
        try {
            const { error: e } = await supabase.from('pedido_apoyo').upsert(
                { pedido_id: pedidoId, erp_sucursal_id: sucId, employee_id: employee.id, registered_by: currentUserId },
                { onConflict: 'pedido_id,erp_sucursal_id,employee_id' }
            );
            if (e) throw e;
            useStaff.getState().appendAuditLog('PEDIDO_APOYO_REGISTRADO', pedidoId, { sucursal_id: sucId, employee_id: employee.id });
            onSuccess(employee);
            onClose();
        } catch { setError('Error al registrar apoyo.'); }
        finally  { setLoading(false); }
    }, [employee, pedidoId, sucId, currentUserId, onSuccess, onClose]);

    return (
        <PedidoModal open={open} onClose={onClose}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center shadow-sm shrink-0">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-[15px]">Registrar apoyo</h3>
                            <p className="text-[12px] text-slate-600 mt-0.5">Escanea el carnet del empleado</p>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="space-y-4">
                    {!employee && (
                        <div className="flex flex-col items-center gap-3 py-3">
                            <div className="relative w-16 h-16 rounded-2xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center">
                                <motion.div
                                    className="absolute inset-0 rounded-2xl border-2 border-blue-400 pointer-events-none"
                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                    transition={{ duration: 1.6, repeat: Infinity }}
                                />
                                <ScanLine size={28} className="text-blue-500" />
                                {loading && (
                                    <div className="absolute inset-0 rounded-2xl bg-white/80 flex items-center justify-center">
                                        <Loader2 size={18} className="animate-spin text-blue-500" />
                                    </div>
                                )}
                            </div>

                            {displayDots > 0 && (
                                <div className="flex gap-1.5 h-3 items-center">
                                    {Array.from({ length: Math.min(displayDots, 10) }).map((_, i) => (
                                        <motion.div key={i}
                                            className="w-2 h-2 rounded-full bg-blue-400"
                                            initial={{ scale: 0 }}
                                            animate={{ scale: 1 }}
                                            transition={{ type: 'spring', stiffness: 600, delay: i * 0.02 }}
                                        />
                                    ))}
                                    {displayDots > 10 && <span className="text-[10px] text-blue-400">+{displayDots - 10}</span>}
                                </div>
                            )}

                            <p className="text-[12px] text-slate-600 text-center">
                                Apunta el escáner al código de barras<br />del carnet del empleado
                            </p>
                        </div>
                    )}

                    {employee && (
                        <motion.div
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200"
                        >
                            {employee.photo_url
                                ? <img src={employee.photo_url} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" alt="" />
                                : <div className="w-12 h-12 rounded-full bg-emerald-200 flex items-center justify-center shrink-0"><UserCircle2 size={24} className="text-emerald-600" /></div>
                            }
                            <div>
                                <p className="font-bold text-emerald-800 text-[14px]">{employee.name}</p>
                                <p className="text-[11px] text-emerald-600 mt-0.5">Confirma para registrar como apoyo</p>
                            </div>
                        </motion.div>
                    )}

                    {manualWarn && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
                            <ShieldAlert size={14} className="shrink-0 text-red-500" />
                            Solo se acepta escaneo. No se permite ingreso manual del teclado.
                        </div>
                    )}
                    {error && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
                            <AlertTriangle size={14} className="shrink-0 text-red-500" />
                            {error}
                        </div>
                    )}
                </PedidoModal.Body>

                <PedidoModal.Footer>
                    <div className="flex justify-between gap-2">
                        <button onClick={() => { setEmployee(null); setDisplayDots(0); setError(''); setManualWarn(false); bufferRef.current = ''; }}
                            className="px-3 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-[12px] transition-colors">
                            Limpiar
                        </button>
                        <div className="flex gap-2">
                            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-[13px] font-medium transition-colors">
                                Cancelar
                            </button>
                            {employee && (
                                <button onClick={confirmApoyo} disabled={loading}
                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 text-[13px] transition-colors disabled:opacity-50 shadow-sm"
                                >
                                    {loading ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
                                    Confirmar
                                </button>
                            )}
                        </div>
                    </div>
                </PedidoModal.Footer>
        </PedidoModal>
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
// Para la sección "Revisar regla": muestra la unidad de stock (lo que pidió la sucursal),
// no la unidad de despacho. Así "Solicitado=4" lee como "4 Unidad", no "4 CAJA".
function renderPresStock(row) {
    const factor     = row.factor || 1;
    const dispFactor = row.dispatch_factor || factor;
    if (factor === dispFactor || !row.dispatch_tipo) return renderPresentacion(row);
    return (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            {factor <= 1 ? 'Unidad' : `×${factor} unid`}
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
    { key: 'pres',       label: 'Presentación',  render: renderPresStock },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'regla',      label: 'Regla',         render: fmtRegla },
    { key: 'motivo',     label: 'Motivo', render: () => <span className="text-rose-600 text-[11px]">Necesidad &lt; 40% de la unidad mínima de despacho</span> },
];

function ItemSection({ label, count, badgeCls, rows, columns, noteEl }) {
    const [open,     setOpen]     = useState(false);
    const [page,     setPage]     = useState(1);
    const [pageSize, setPageSize] = useState(MINI_PAGE);

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const pageRows   = rows.slice((page - 1) * pageSize, page * pageSize);

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
                                footer={
                                    <TablePagination
                                        page={page}
                                        totalPages={totalPages}
                                        onPageChange={p => setPage(p)}
                                        pageSize={pageSize}
                                        onPageSizeChange={sz => { setPageSize(sz); setPage(1); }}
                                        total={rows.length}
                                        unit="productos"
                                    />
                                }
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

// ─── Lifecycle Timeline ───────────────────────────────────────────────────────

function fmtHM(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

const TL_DOT    = ['bg-blue-500','bg-blue-500','bg-violet-500','bg-indigo-500','bg-teal-500','bg-emerald-500'];
const TL_LINE   = ['bg-blue-300','bg-blue-300','bg-violet-300','bg-indigo-300','bg-teal-300','bg-emerald-300'];
const TL_BORDER = ['border-blue-400','border-blue-400','border-violet-400','border-indigo-400','border-teal-400','border-emerald-400'];
// box-shadow glow colors for active node — stays within dot bounds, no overflow
const TL_GLOW   = [
    'rgba(59,130,246',   // blue
    'rgba(59,130,246',
    'rgba(139,92,246',   // violet
    'rgba(99,102,241',   // indigo
    'rgba(20,184,166',   // teal
    'rgba(16,185,129',   // emerald
];

const TL_STAGE_IDX = { sin_iniciar: 0, preparando: 1, pausado: 1, preparado: 2, transito: 3, contando: 4, erp: 5 };

function LifecycleTimeline({ row, stage, creatorEmp, iniciadorEmp }) {
    const hasPause  = (row.min_pausado_total ?? 0) > 0;
    const isPaused  = stage === 'pausado';
    const activeIdx = TL_STAGE_IDX[stage] ?? 0;

    const nodes = [
        { key: 'confirmado', label: 'Confirmado', time: row.created_at,        emp: creatorEmp   },
        { key: 'iniciado',   label: 'Inicio',     time: row.iniciado_at,       emp: iniciadorEmp },
        { key: 'preparado',  label: 'Listo',      time: row.finalizado_at,     emp: null         },
        { key: 'enviado',    label: 'En Ruta',    time: row.enviado_at,        emp: null         },
        { key: 'llegada',    label: 'Llegada',    time: row.llegada_fisica_at, emp: null         },
        { key: 'erp',        label: 'Finalizado', time: row.recibido_erp_at,   emp: null         },
    ];

    return (
        /* overflow-visible so box-shadow glow never gets clipped */
        <div className="flex items-start w-full pb-1 pt-0.5" style={{ overflow: 'visible' }}>
            {nodes.map((node, idx) => {
                const isDone      = node.time != null && idx < activeIdx;
                const isActive    = idx === activeIdx;
                const isPausedDot = isActive && isPaused;
                const isFuture    = !isDone && !isActive;
                const nextNode    = nodes[idx + 1];

                // Elapsed time between this node and the next (completed segment)
                const segElapsed = isDone && nextNode?.time
                    ? fmtMin(elapsed(node.time, nextNode.time))
                    : null;

                // Glow animation for active dot — uses box-shadow (no overflow)
                const glowColor = TL_GLOW[idx];
                const activeAnimate = isActive && !isPausedDot ? {
                    scale: 1, opacity: 1,
                    boxShadow: [
                        `0 0 0 0px ${glowColor},0.5)`,
                        `0 0 0 7px ${glowColor},0)`,
                        `0 0 0 0px ${glowColor},0.5)`,
                    ],
                } : { scale: 1, opacity: 1, boxShadow: '0 0 0 0px rgba(0,0,0,0)' };

                return (
                    <React.Fragment key={node.key}>
                        {/* Node */}
                        <div className="flex flex-col items-center shrink-0" style={{ width: 48 }}>
                            {/* Dot */}
                            <div className="flex items-center justify-center w-6 h-6">
                                <motion.div
                                    className={`w-4 h-4 rounded-full flex items-center justify-center z-10 ${
                                        isDone      ? `${TL_DOT[idx]} shadow-sm` :
                                        isPausedDot ? 'bg-amber-400 shadow-md' :
                                        isActive    ? `bg-white border-2 ${TL_BORDER[idx]}` :
                                                      'bg-slate-100 border border-slate-200'
                                    }`}
                                    initial={{ scale: 0.5, opacity: 0 }}
                                    animate={activeAnimate}
                                    transition={isActive && !isPausedDot ? {
                                        scale:      { type: 'spring', stiffness: 350, damping: 24, delay: idx * 0.06 },
                                        opacity:    { delay: idx * 0.06, duration: 0.3 },
                                        boxShadow:  { duration: 2, repeat: Infinity, ease: 'easeOut' },
                                    } : { type: 'spring', stiffness: 350, damping: 24, delay: idx * 0.06 }}
                                >
                                    {isDone && (
                                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                            <polyline points="1.5,4.5 3.5,6.5 7.5,2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                    {isActive && !isPausedDot && (
                                        <motion.div
                                            className={`w-2 h-2 rounded-full ${TL_DOT[idx]}`}
                                            animate={{ scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }}
                                            transition={{ duration: 1.4, repeat: Infinity }}
                                        />
                                    )}
                                    {isPausedDot && (
                                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                                            <rect x="1.5" y="1.5" width="2.5" height="6" rx="0.6" fill="white" />
                                            <rect x="5" y="1.5" width="2.5" height="6" rx="0.6" fill="white" />
                                        </svg>
                                    )}
                                </motion.div>
                            </div>

                            {/* Label */}
                            <span className={`text-[9px] font-semibold text-center leading-tight ${isFuture ? 'text-slate-400' : 'text-slate-700'}`}>
                                {isPausedDot ? 'Pausado' : node.label}
                            </span>

                            {/* Time */}
                            <span className="text-[8px] text-slate-500 tabular-nums leading-tight text-center mt-px">
                                {fmtHM(node.time) || <span className="text-slate-200">——</span>}
                            </span>

                            {/* Responsible person mini-avatar */}
                            {node.emp && (
                                <div className="flex flex-col items-center gap-0.5 mt-1">
                                    {node.emp.photo
                                        ? <img src={node.emp.photo} className="w-7 h-7 rounded-full object-cover border-2 border-white shadow-md shrink-0" alt="" />
                                        : <span className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center shrink-0"><UserCircle2 size={13} className="text-slate-500" /></span>
                                    }
                                    <span className="text-[9px] text-slate-600 leading-tight font-medium text-center">{node.emp.name?.split(' ')[0]}</span>
                                </div>
                            )}
                        </div>

                        {/* Connector */}
                        {idx < nodes.length - 1 && (
                            <div className="relative flex-1 min-w-[8px] self-start" style={{ marginTop: 15 }}>
                                {/* Track */}
                                <div className="h-0.5 w-full bg-slate-200 rounded-full" />
                                {/* Fill */}
                                {(isDone || (isActive && node.time)) && (
                                    <motion.div
                                        className={`absolute top-0 left-0 h-0.5 rounded-full ${TL_LINE[idx]}`}
                                        initial={{ width: '0%' }}
                                        animate={{ width: isDone && nextNode?.time ? '100%' : isDone ? '100%' : '50%' }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: idx * 0.08 }}
                                    />
                                )}
                                {/* Pause badge — above the line */}
                                {node.key === 'iniciado' && hasPause && (
                                    <div className="absolute left-1/2 -translate-x-1/2 z-10" style={{ top: -14 }}>
                                        <motion.span
                                            className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-px rounded whitespace-nowrap shadow-sm leading-tight ${
                                                isPaused ? 'bg-amber-400 text-white' : 'bg-white text-amber-600 border border-amber-300'
                                            }`}
                                            animate={isPaused ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
                                            transition={isPaused ? { duration: 1.2, repeat: Infinity } : undefined}
                                        >
                                            ⏸ {fmtMin(row.min_pausado_total)}
                                        </motion.span>
                                    </div>
                                )}
                                {/* Elapsed time — below the line */}
                                {segElapsed && (
                                    <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap" style={{ top: 4 }}>
                                        <span className="text-[9px] font-semibold text-slate-600 tabular-nums">{segElapsed}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// ─── Item sections ────────────────────────────────────────────────────────────

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
            <ItemSection label="Productos enviados" count={enviados.length} badgeCls="bg-emerald-50 text-emerald-700 border-emerald-200" rows={enviados} columns={COLS_ENVIADOS} />
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

function currentMonthRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const fini = `${y}-${pad(m + 1)}-01`;
    const last = new Date(y, m + 1, 0);
    const ffin = `${y}-${pad(m + 1)}-${pad(last.getDate())}`;
    return `${fini}|${ffin}`;
}

function FilterPill({ isBranch, filterSuc, setFilterSuc, filterStatus, setFilterStatus, filterOptions, filterDate, setFilterDate }) {
    const defaultDate = currentMonthRange();
    const dateDirty   = filterDate !== defaultDate;
    const hasActive   = filterSuc !== '' || filterStatus !== 'all' || dateDirty;
    const clearAll    = () => { setFilterSuc(''); setFilterStatus('all'); setFilterDate(defaultDate); };

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

            {/* Sucursal */}
            {!isBranch && (
                <>
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible" style={{ width: '155px' }}>
                            <LiquidSelect value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} placeholder="Todas" icon={Building2} compact bare />
                        </div>
                        {filterSuc !== '' && (
                            <button onClick={() => setFilterSuc('')} className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>
                    <div className="h-5 w-px bg-slate-100 shrink-0" />
                </>
            )}

            {/* Fecha */}
            <div className="flex items-center">
                <div className="px-2 py-2 overflow-visible">
                    <PeriodPicker value={filterDate} onChange={setFilterDate} />
                </div>
                {dateDirty && (
                    <button onClick={() => setFilterDate(defaultDate)} className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0">
                        <X size={9} strokeWidth={3} />
                    </button>
                )}
            </div>

            <div className="h-5 w-px bg-slate-100 shrink-0" />

            {/* Estado */}
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
    const [filterSuc,     setFilterSuc]     = useState('');
    const [filterStatus,  setFilterStatus]  = useState('all');
    const [filterDate,    setFilterDate]    = useState(() => currentMonthRange());

    const [activeRows,  setActiveRows]  = useState([]);
    const [loading,     setLoading]     = useState(true);

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

    // Apoyo
    const [apoyoMap,   setApoyoMap]   = useState({}); // cardKey → [{id, name, photo_url}]
    const [apoyoModal, setApoyoModal] = useState(null); // { pedidoId, sucId, cardKey }

    // Card stats (for collapsed pill display)
    const [cardStats,  setCardStats]  = useState({}); // cardKey → { enviados, sinStock, porRegla }

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
        if (error) return;
        setActiveRows(data ?? []);
        const rows = data ?? [];
        // Initialize all cards with zeros (server-side aggregation — no row limit issues)
        const stats = {};
        rows.forEach(row => {
            stats[`act_${row.pedido_id}_${row.erp_sucursal_id}`] = { enviados: 0, sinStock: 0, porRegla: 0 };
        });
        const ids = [...new Set(rows.map(r => r.pedido_id))];
        if (ids.length) {
            const { data: statRows } = await supabase.rpc('get_pedido_item_stats', { p_pedido_ids: ids });
            (statRows ?? []).forEach(s => {
                const k = `act_${s.pedido_id}_${s.erp_sucursal_id}`;
                stats[k] = { enviados: s.enviados, sinStock: s.sin_stock, porRegla: s.por_regla };
            });
        }
        setCardStats(stats);
    }, []);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await loadActive();
            setLoading(false);
        })();
    }, []); // eslint-disable-line

    // ── Realtime ──────────────────────────────────────────────────────────────

    useEffect(() => {
        const ch = supabase.channel('tab-pedidos-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (payload) => {
                loadActive();
                const s = payload.new?.status;
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
    }, [loadActive, isBranch, erpSucursalId]); // eslint-disable-line

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

        let apoyoQ = supabase.from('pedido_apoyo')
            .select('id, employee_id, employees(name, photo_url)')
            .eq('pedido_id', pedidoId);
        if (sucFilter) apoyoQ = apoyoQ.eq('erp_sucursal_id', sucFilter);

        const [{ data: itemRows }, { data: lcRow }, { data: apoyoRows }] = await Promise.all([itemsQ, lcPromise, apoyoQ]);
        setItems(prev => ({ ...prev, [key]: itemRows || [] }));
        setApoyoMap(prev => ({ ...prev, [key]: (apoyoRows || []).map(r => ({ id: r.employee_id, ...r.employees })) }));
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
        } catch (e) { console.error('Envío error:', e); } finally { setBusyEnvio(null); }
    }, [user, loadActive]);

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
        await handleLifecycle(pauseModal.pedidoId, pauseModal.sucId, 'pausar', razon);
        setPauseModal(null);
    }, [pauseModal, pauseRazon, pauseComment, handleLifecycle]);

    const handleApoyoSuccess = useCallback((emp, cardKey) => {
        setApoyoMap(prev => {
            const existing = prev[cardKey] ?? [];
            if (existing.find(e => e.id === emp.id)) return prev;
            return { ...prev, [cardKey]: [...existing, { id: emp.id, name: emp.name, photo_url: emp.photo_url }] };
        });
    }, []);

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

    const searchLower   = useMemo(() => searchTerm.toLowerCase(), [searchTerm]);
    const filterOptions = useMemo(() => ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` })), []);

    // Group activeRows by pedido to detect if ALL sucursales for a pedido are preparado
    const pedidoStageMap = useMemo(() => {
        const map = new Map();
        activeRows.forEach(row => {
            const prev = map.get(row.pedido_id) ?? { allFinalized: true, anyActive: false };
            map.set(row.pedido_id, {
                allFinalized: prev.allFinalized && !!row.finalizado_at,
                anyActive:    prev.anyActive || (!!row.iniciado_at && !row.finalizado_at),
            });
        });
        return map;
    }, [activeRows]);

    const STAGE_ORDER = { preparando: 0, transito: 1, contando: 2, pausado: 3, preparado: 4, sin_iniciar: 5, erp: 6 };

    const filteredRows = useMemo(() => {
        let rows = activeRows;
        if (filterSuc)              rows = rows.filter(r => r.erp_sucursal_id === Number(filterSuc));
        if (filterStatus !== 'all') rows = rows.filter(r => r.pedido_status === filterStatus);
        if (filterDate) {
            const [desde, hasta] = filterDate.split('|');
            rows = rows.filter(r => {
                const d = r.created_at?.slice(0, 10);
                return (!desde || d >= desde) && (!hasta || d <= hasta);
            });
        }
        if (searchLower) rows = rows.filter(r => String(r.numero).includes(searchLower) || (r.notes ?? '').toLowerCase().includes(searchLower));
        return [...rows].sort((a, b) => {
            const sa = STAGE_ORDER[getBranchStage(a, a.pedido_status)] ?? 5;
            const sb = STAGE_ORDER[getBranchStage(b, b.pedido_status)] ?? 5;
            return sa !== sb ? sa - sb : new Date(b.created_at) - new Date(a.created_at);
        });
    }, [activeRows, filterSuc, filterStatus, filterDate, searchLower]); // eslint-disable-line

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

                            const cardApoyo = apoyoMap[cardKey] ?? [];

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

                            return (
                                <div
                                    key={cardKey}
                                    className={`${GLASS} cursor-pointer select-none ${
                                        stage === 'pausado'
                                            ? 'ring-2 ring-amber-400 shadow-[0_4px_20px_rgba(251,191,36,0.25)]'
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
                                        {isExp ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                                    </div>
                                    {row.notes && <p className="px-3 pb-1.5 text-[11px] text-slate-600 italic">{row.notes}</p>}

                                    {/* Stats pills */}
                                    {cardStats[cardKey] && (
                                        <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                                                {cardStats[cardKey].enviados} enviados
                                            </span>
                                            {cardStats[cardKey].sinStock > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200">
                                                    {cardStats[cardKey].sinStock} sin stock
                                                </span>
                                            )}
                                            {cardStats[cardKey].porRegla > 0 && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">
                                                    <AlertTriangle size={9} />{cardStats[cardKey].porRegla} por regla
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Apoyo display */}
                                    {cardApoyo.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 pb-1 flex-wrap">
                                            <span className="text-[10px] text-slate-500 uppercase tracking-wide shrink-0">Apoyo</span>
                                            {cardApoyo.map(a => (
                                                a.photo_url
                                                    ? <img key={a.id} src={a.photo_url} title={a.name} className="w-5 h-5 rounded-full object-cover border-2 border-white shadow-sm" alt="" />
                                                    : <span key={a.id} title={a.name} className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center"><UserCircle2 size={11} className="text-slate-500" /></span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Lifecycle Timeline */}
                                    <div className="border-t border-slate-100 px-3 pt-2 pb-1.5">
                                        <LifecycleTimeline row={row} stage={stage} creatorEmp={creator} iniciadorEmp={iniciador} />
                                    </div>

                                    {/* Actions + status strip */}
                                    <div className="flex items-center gap-2 px-3 pb-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                        <StagePill stage={stage} />
                                        {elapsedPrep  && <span className="text-[10px] text-slate-600 tabular-nums">{elapsedPrep}</span>}
                                        {elapsedPause && (
                                            <span className="text-[10px] text-amber-700 font-semibold tabular-nums animate-pulse">
                                                {elapsedPause} en pausa
                                            </span>
                                        )}
                                        {elapsedTrans && <span className="text-[10px] text-indigo-600 tabular-nums">{elapsedTrans} en ruta</span>}
                                        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                                            {canApoyo && (
                                                <button
                                                    onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey })}
                                                    disabled={isLCBusy}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    <UserPlus size={10} />Apoyo
                                                </button>
                                            )}
                                            {canIniciar      && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar')}   disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-blue-500    text-white hover:bg-blue-600    active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Play     size={10} fill="currentColor" />Iniciar</>}</button>}
                                            {canPausar       && <button onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}               disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-amber-400   text-white hover:bg-amber-500   active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Pause    size={10} fill="currentColor" />Pausar</>}</button>}
                                            {canFinalizar    && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'finalizar')} disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-violet-500  text-white hover:bg-violet-600  active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Flag     size={10} />Finalizar</>}</button>}
                                            {canReanudar     && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}  disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><RotateCcw size={10} />Reanudar</>}</button>}
                                            {canMarcarEnRuta && <button onClick={() => handleMarcarEnRuta(row.pedido_id)}                               disabled={isEnvioBusy} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isEnvioBusy ? <Loader2 size={11} className="animate-spin" /> : <><Truck size={10} />En Ruta</>}</button>}
                                        </div>
                                    </div>

                                    <AnimatePresence>
                                        {isExp && (
                                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden" onClick={e => e.stopPropagation()}>
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
                                </div>
                            );
                        })}
                    </div>
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

            <ApoioScanModal
                open={!!apoyoModal}
                onClose={() => setApoyoModal(null)}
                pedidoId={apoyoModal?.pedidoId}
                sucId={apoyoModal?.sucId}
                currentUserId={user?.id}
                onSuccess={(emp) => handleApoyoSuccess(emp, apoyoModal?.cardKey)}
            />

            {modal && (
                <RecepcionModal open={!!modal} onClose={() => setModal(null)} pedido={modal.pedido} sucursalId={modal.sucId} sucursalNombre={branchName} rows={modal.rows} onConfirmed={() => { setModal(null); fetchItems(modal.key, modal.pedido.id, modal.sucId); }} />
            )}
        </div>
    );
}
