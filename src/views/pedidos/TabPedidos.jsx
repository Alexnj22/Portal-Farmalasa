import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle,
    Truck, Pause, PackageCheck, PackageX, Play,
    Database, Activity, TrendingDown,
    X, Send, CheckCheck, RotateCcw, Flag, ShieldAlert, UserCircle2,
    Coffee, Users, Clock, ClipboardList, Bell, MessageSquare,
    UserPlus, ScanLine, Inbox, AlertCircle, CheckSquare, FileDown, Box, Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import RecepcionModal from './RecepcionModal';
import PedidoModal from './PedidoModal';
import LlegadaModal from './LlegadaModal';
import ReenvioLlegadaModal from './ReenvioLlegadaModal';
import FinalizarCajasModal from './FinalizarCajasModal';
import CrearRutaModal from './CrearRutaModal';
import { ERP_NAMES } from '../../constants/erp';
import LiquidSelect from '../../components/common/LiquidSelect';
import PeriodPicker from '../../components/common/PeriodPicker';
import { printFromPedidoItems, buildPedidoCodigo, getPageGroups } from '../../utils/pedidoPrint';

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
    // Usar pauses (historial) como fuente primaria — más confiable que los campos de PSS
    const hasActivePause = (row.pauses ?? []).some(p => !p.reanudado_at);
    if (hasActivePause || (row.pausado_at && !row.reanudado_at)) return 'pausado';
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

function ApoioScanModal({ open, onClose, pedidoId, sucId, currentUserId, existingApoyo = [], onSuccess, tipo = 'preparacion' }) {
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
        if (existingApoyo.some(a => a.id === employee.id)) {
            useToastStore.getState().showToast(
                'Ya está de apoyo',
                `${employee.name} ya está registrado en este pedido.`,
                'warning'
            );
            onClose();
            return;
        }
        setLoading(true);
        try {
            const { error: e } = await supabase.from('pedido_apoyo').upsert(
                { pedido_id: pedidoId, erp_sucursal_id: sucId, employee_id: employee.id, registered_by: currentUserId, tipo },
                { onConflict: 'pedido_id,erp_sucursal_id,employee_id,tipo' }
            );
            if (e) throw e;
            useStaff.getState().appendAuditLog('PEDIDO_APOYO_REGISTRADO', pedidoId, { sucursal_id: sucId, employee_id: employee.id });
            onSuccess(employee);
            onClose();
        } catch (err) { setError(err?.message || 'Error al registrar apoyo.'); }
        finally  { setLoading(false); }
    }, [employee, existingApoyo, pedidoId, sucId, currentUserId, onSuccess, onClose]);

    return (
        <PedidoModal open={open} onClose={onClose}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center shadow-sm shrink-0">
                            <Users size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-[15px]">Apoyo — {tipo === 'recepcion' ? 'Recepción' : 'Preparación'}</h3>
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
    { key: 'stock_suc',  label: 'Stock sucursal', align: 'center', render: r => (
        <span className={`tabular-nums text-[11px] font-semibold ${(r.stock_packs_snapshot ?? 0) === 0 ? 'text-rose-500' : 'text-slate-600'}`}>
            {r.stock_packs_snapshot ?? '—'}
        </span>
    )},
    { key: 'motivo', label: 'Motivo', render: r => (
        <div className="flex flex-col gap-0.5">
            <span className="text-amber-600 text-[10px] font-semibold">Sin stock en bodega</span>
            <span className="text-slate-400 text-[9px]">Esperar reabastecimiento o generar un pedido manual</span>
        </div>
    )},
];

const COLS_REGLA = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresStock },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'stock_suc',  label: 'Stock sucursal', align: 'center', render: r => (
        <span className={`tabular-nums text-[11px] font-semibold ${(r.stock_packs_snapshot ?? 0) === 0 ? 'text-rose-500' : 'text-slate-600'}`}>
            {r.stock_packs_snapshot ?? '—'}
        </span>
    )},
    { key: 'regla',  label: 'Regla', render: fmtRegla },
    { key: 'motivo', label: 'Motivo', render: r => {
        const needed = r.max_qty_snapshot != null && r.stock_packs_snapshot != null
            ? Math.max(0, r.max_qty_snapshot - r.stock_packs_snapshot) : null;
        return (
            <div className="flex flex-col gap-0.5">
                <span className="text-rose-600 text-[10px] font-semibold">Necesidad baja</span>
                <span className="text-slate-400 text-[9px]">
                    {needed != null ? `Reponer ${needed} und. no alcanza el mín. de despacho` : 'Necesidad < 40% de la unidad mínima de despacho'}
                </span>
                <span className="text-slate-300 text-[9px]">Ajustar MAX o reducir el múltiplo en la regla</span>
            </div>
        );
    }},
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

// Extra indices (reenvío cycles) repeat the last two colors
const TL_DOT_BASE    = ['bg-blue-500','bg-blue-500','bg-violet-500','bg-indigo-500','bg-teal-500','bg-emerald-500','bg-amber-500','bg-purple-500'];
const TL_LINE_BASE   = ['bg-blue-300','bg-blue-300','bg-violet-300','bg-indigo-300','bg-teal-300','bg-emerald-300','bg-amber-300','bg-purple-300'];
const TL_BORDER_BASE = ['border-blue-400','border-blue-400','border-violet-400','border-indigo-400','border-teal-400','border-emerald-400','border-amber-400','border-purple-400'];
const tlDot    = (i) => TL_DOT_BASE[i]    ?? TL_DOT_BASE[TL_DOT_BASE.length - 1];
const tlLine   = (i) => TL_LINE_BASE[i]   ?? TL_LINE_BASE[TL_LINE_BASE.length - 1];
const tlBorder = (i) => TL_BORDER_BASE[i] ?? TL_BORDER_BASE[TL_BORDER_BASE.length - 1];
// box-shadow glow colors for active node — stays within dot bounds, no overflow
const TL_GLOW   = [
    'rgba(59,130,246',   // blue
    'rgba(59,130,246',
    'rgba(139,92,246',   // violet
    'rgba(99,102,241',   // indigo
    'rgba(20,184,166',   // teal
    'rgba(16,185,129',   // emerald
    'rgba(245,158,11',   // amber
    'rgba(168,85,247',   // purple
];
const tlGlow = (i) => TL_GLOW[i] ?? TL_GLOW[TL_GLOW.length - 1];

const TL_STAGE_IDX = { sin_iniciar: 0, preparando: 1, pausado: 1, preparado: 2, transito: 3, contando: 4, erp: 5 };

function PauseBadge({ pause, isPaused }) {
    const mins    = pause ? elapsed(pause.pausado_at, pause.reanudado_at ?? undefined) : null;
    const isActive = isPaused && !pause?.reanudado_at;
    return (
        <div className="group/pb relative">
            <motion.span
                className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-px rounded whitespace-nowrap shadow-sm leading-tight cursor-default ${
                    isActive ? 'bg-amber-400 text-white' : 'bg-white text-amber-600 border border-amber-300'
                }`}
                animate={isActive ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
                transition={isActive ? { duration: 1.2, repeat: Infinity } : undefined}
            >
                ⏸ {fmtMin(mins) ?? '—'}
            </motion.span>
            {pause && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-[200] hidden group-hover/pb:block pointer-events-none">
                    <div className="bg-slate-900/90 text-white rounded-xl px-2.5 py-2 shadow-xl flex flex-col gap-0.5 min-w-max">
                        <div className="text-[9px] font-bold capitalize">{pause.razon ?? 'Pausa'}</div>
                        <div className="text-[8px] text-slate-300">Inicio: <span className="text-white font-semibold">{fmtHM(pause.pausado_at) || '—'}</span></div>
                        <div className="text-[8px] text-slate-300">
                            Fin:{' '}
                            {pause.reanudado_at
                                ? <span className="text-white font-semibold">{fmtHM(pause.reanudado_at)}</span>
                                : <span className="text-amber-300 font-semibold">En curso</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function LifecycleTimeline({ row, stage, creatorEmp, iniciadorEmp, finalizadorEmp, enviadorEmp, llegadaEmp, conteoEmp, reenvioEmp, erpEmp, difsEmp, corrConfEmp, receptionApoyo = [], isBranch = false, empMap = new Map(), pauses = [] }) {
    const hasPause  = (row.min_pausado_total ?? 0) > 0;
    const isPaused  = stage === 'pausado';
    const activeIdx = TL_STAGE_IDX[stage] ?? 0;
    const hasDif    = !!row.diferencias_reportadas_at;

    const nodes = [
        { key: 'confirmado', label: 'Confirmado', time: row.created_at,        emp: creatorEmp    },
        { key: 'iniciado',   label: 'Inicio',     time: row.iniciado_at,       emp: iniciadorEmp  },
        { key: 'preparado',  label: 'Listo',      time: row.finalizado_at,     emp: finalizadorEmp },
        { key: 'enviado',    label: 'En Ruta',    time: row.enviado_at,        emp: enviadorEmp    },
        { key: 'llegada',    label: 'Llegada',    time: row.llegada_fisica_at, emp: llegadaEmp,    apoyo: receptionApoyo },
        { key: 'erp',        label: 'Finalizado', time: row.recibido_erp_at,   emp: erpEmp,        apoyo: receptionApoyo },
    ];
    if (row.falta_caja_at) {
        // Label descriptivo según tipo
        const problemaLabel = row.llegada_tipo === 'mixto'      ? 'Dañada + Falta'
                            : row.llegada_tipo === 'caja_danada' ? 'Caja dañada'
                            :                                       'Falta caja';
        nodes.push({ key: 'falta_caja', label: problemaLabel, time: row.falta_caja_at, emp: llegadaEmp });

        // Ciclos de reenvío desde reenvios_historial (nuevo)
        const historial = row.reenvios_historial ?? [];
        if (historial.length > 0) {
            historial.forEach((ciclo, i) => {
                const lbl = historial.length > 1 ? `Reenvío ${ciclo.ciclo}` : 'Reenvío';
                nodes.push({ key: `reenvio_${i}`, label: lbl, time: ciclo.sent_at, emp: reenvioEmp });
                if (ciclo.arrived_at) {
                    const llegadaLbl    = historial.length > 1 ? `Llegada R.${ciclo.ciclo}` : '2ª Llegada';
                    const segLlegadaEmp = ciclo.arrived_por ? empMap.get(ciclo.arrived_por) ?? null : null;
                    nodes.push({ key: `seg_llegada_${i}`, label: llegadaLbl, time: ciclo.arrived_at, emp: segLlegadaEmp });
                }
            });
        } else {
            // Compat con pedidos anteriores sin reenvios_historial
            if (row.reenvio_bodega_at) nodes.push({ key: 'reenvio', label: 'Reenvío', time: row.reenvio_bodega_at, emp: reenvioEmp });
            if (row.segunda_llegada_at) nodes.push({ key: 'seg_llegada', label: '2ª Llegada', time: row.segunda_llegada_at });
        }
    }
    if (hasDif) {
        nodes.push({ key: 'diferencias', label: 'Diferencias', time: row.diferencias_reportadas_at, emp: difsEmp });
        nodes.push({ key: 'corregido',   label: 'Corregido',   time: row.confirmado_correccion_at,  emp: corrConfEmp });
    }

    return (
        /* overflow-visible so box-shadow glow never gets clipped */
        <div className="flex items-start w-full pb-1 pt-0.5" style={{ overflow: 'visible' }}>
            {nodes.map((node, idx) => {
                // Nodes appended after the main sequence (Diferencias, Corregido) are "done"
                // purely based on whether they have a timestamp, regardless of activeIdx
                const isExtraNode = idx >= 6;
                const isDone      = node.time != null && (isExtraNode || idx < activeIdx);
                const isActive    = !isExtraNode && idx === activeIdx;
                const isPausedDot = isActive && isPaused;
                const isFuture    = !isDone && !isActive;
                const nextNode    = nodes[idx + 1];

                // Elapsed time between this node and the next (completed segment)
                const segElapsed = isDone && nextNode?.time
                    ? fmtMin(elapsed(node.time, nextNode.time))
                    : null;

                // Glow animation for active dot — uses box-shadow (no overflow)
                const glowColor = tlGlow(idx);
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
                                        isDone      ? `${tlDot(idx)} shadow-sm` :
                                        isPausedDot ? 'bg-amber-400 shadow-md' :
                                        isActive    ? `bg-white border-2 ${tlBorder(idx)}` :
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
                                            className={`w-2 h-2 rounded-full ${tlDot(idx)}`}
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
                            {/* Apoyo avatar stack */}
                            {node.apoyo?.length > 0 && (
                                <div className="flex justify-center mt-0.5" style={{ paddingLeft: node.apoyo.length > 1 ? 6 : 0 }}>
                                    {node.apoyo.slice(0, 3).map((a, i) => (
                                        a.photo_url
                                            ? <img key={a.id} src={a.photo_url} title={a.name} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: i }} className="w-5 h-5 rounded-full object-cover border-2 border-white shadow-sm shrink-0 relative" alt="" />
                                            : <span key={a.id} title={a.name} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: i }} className="w-5 h-5 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center shrink-0 relative"><UserCircle2 size={10} className="text-slate-500" /></span>
                                    ))}
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
                                        className={`absolute top-0 left-0 h-0.5 rounded-full ${tlLine(idx)}`}
                                        initial={{ width: '0%' }}
                                        animate={{ width: isDone && nextNode?.time ? '100%' : isDone ? '100%' : '50%' }}
                                        transition={{ duration: 0.6, ease: 'easeOut', delay: idx * 0.08 }}
                                    />
                                )}
                                {/* Pause badges — above the line */}
                                {node.key === 'iniciado' && hasPause && (
                                    <div className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5" style={{ top: -14 }}>
                                        {pauses.length > 0
                                            ? pauses.map((p, i) => (
                                                <PauseBadge key={i} pause={p} isPaused={isPaused && i === pauses.length - 1} />
                                            ))
                                            : <PauseBadge pause={null} isPaused={isPaused} />
                                        }
                                    </div>
                                )}
                                {/* Elapsed time — below the line; hidden for the other side's steps */}
                                {segElapsed && (() => {
                                    const isBodegaSrc   = ['confirmado','iniciado','preparado'].includes(node.key);
                                    const isSucursalSrc = node.key === 'llegada' || node.key.startsWith('seg_llegada');
                                    const show = isBranch ? !isBodegaSrc : !isSucursalSrc;
                                    return show ? (
                                        <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap" style={{ top: 4 }}>
                                            <span className="text-[9px] font-semibold text-slate-600 tabular-nums">{segElapsed}</span>
                                        </div>
                                    ) : null;
                                })()}
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

// ─── Diferencias section ─────────────────────────────────────────────────────

const ERROR_TIPO_LABEL = {
    faltante:     { label: 'Faltante',        color: 'bg-red-100 text-red-700 border-red-200'           },
    sobrante:     { label: 'Sobrante',        color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    danado:       { label: 'Dañado',          color: 'bg-orange-100 text-orange-700 border-orange-200'   },
    vencido:      { label: 'Vencido',         color: 'bg-purple-100 text-purple-700 border-purple-200'   },
    presentacion: { label: 'Pres. distinta',  color: 'bg-blue-100 text-blue-700 border-blue-200'         },
    otro:         { label: 'Otro',            color: 'bg-slate-100 text-slate-600 border-slate-200'      },
    diferencia:   { label: 'Diferencia',      color: 'bg-amber-100 text-amber-700 border-amber-200'      },
};

const RESOLUCION_OPTS = {
    faltante:     [['envio_fisico','Enviar producto'],['ajuste_sistema','Ajuste en sistema']],
    sobrante:     [['aceptar_sobrante','Sucursal queda con sobrante'],['devolver_bodega','Devolver a bodega']],
    danado:       [['devolucion_aceptada','Aceptar devolución'],['devolucion_negada','Negar devolución']],
    vencido:      [['devolucion_aceptada','Aceptar devolución'],['devolucion_negada','Negar devolución']],
    presentacion: [['ajuste_sistema','Ajuste en sistema'],['aceptar_dif_pres','Aceptar dif. presentación']],
    otro:         [['resuelto','Resuelto'],['no_aplica','Sin solución']],
};

const RESOLUCION_LABEL = {
    envio_fisico:        'Enviar producto',
    ajuste_sistema:      'Ajuste en sistema',
    aceptar_sobrante:    'Sucursal queda con sobrante',
    devolver_bodega:     'Devolver a bodega',
    devolucion_aceptada: 'Devolución aceptada',
    devolucion_negada:   'Devolución negada',
    aceptar_dif_pres:    'Dif. presentación aceptada',
    resuelto:            'Resuelto',
    no_aplica:           'Sin solución',
};

const EVENTO_LABEL = {
    resolucion_propuesta:  'propuso resolución',
    resolucion_confirmada: 'confirmó resolución',
    resolucion_rechazada:  'rechazó resolución',
};

const DIF_MAX = 3;

function DifSection({ row, difItems = [], eventos = [], isBranch, busyAction, empMap = new Map(), onResolver }) {
    const [tipoSel,    setTipoSel]    = React.useState({});
    const [notaSel,    setNotaSel]    = React.useState({});
    const [rejectOpen, setRejectOpen] = React.useState({});
    const [notaRec,    setNotaRec]    = React.useState({});
    const [showAll,    setShowAll]    = React.useState(false);

    const allConfirmed  = difItems.length > 0 && difItems.every(r => r.resolucion_status === 'confirmada');
    const visibleItems  = showAll ? difItems : difItems.slice(0, DIF_MAX);
    const hiddenCount   = difItems.length - DIF_MAX;

    return (
        <div className="border-t border-amber-100 bg-gradient-to-b from-amber-50/40 to-white px-4 py-3 space-y-3">
            <div className="flex items-center gap-1.5">
                <AlertCircle size={12} className="text-amber-500 shrink-0" />
                <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
                    {allConfirmed ? 'Diferencias resueltas ✓' : `Diferencias — pendiente resolución${difItems.length > 1 ? ` (${difItems.length})` : ''}`}
                </span>
            </div>

            {visibleItems.map(item => {
                const opts    = RESOLUCION_OPTS[item.error_tipo] ?? [['resuelto','Resuelto'],['no_aplica','Sin solución']];
                const selTipo = tipoSel[item.id] ?? opts[0]?.[0] ?? '';
                const isBusy  = busyAction === `res_${item.id}`;
                const et      = ERROR_TIPO_LABEL[item.error_tipo];
                const res     = item.resolucion_status;
                const qtyDiff = item.cantidad_recibida !== null && item.cantidad_recibida !== item.cantidad_asignada;

                const resueltoEmp   = item.resuelto_por       ? empMap.get(item.resuelto_por)       : null;
                const confirmadoEmp = item.confirmado_suc_por ? empMap.get(item.confirmado_suc_por)  : null;
                const rechazadoEmp  = item.rechazado_por      ? empMap.get(item.rechazado_por)       : null;

                const borderCls = res === 'confirmada' ? 'border-emerald-200 bg-emerald-50/30'
                                : res === 'rechazada'  ? 'border-red-200 bg-red-50/20'
                                : res === 'propuesta'  ? 'border-violet-200 bg-violet-50/20'
                                :                        'border-amber-200 bg-white';

                return (
                    <div key={item.id} className={`rounded-xl border overflow-hidden ${borderCls}`}>
                        {/* Item header */}
                        <div className="flex items-center gap-2 px-3 py-2">
                            <span className="flex-1 text-[11px] font-semibold text-slate-700 truncate">{item.products?.nombre}</span>
                            {et && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${et.color}`}>{et.label}</span>}
                            {res === 'confirmada' && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
                            {res === 'rechazada'  && <X size={13} className="text-red-500 shrink-0" />}
                        </div>

                        {/* Qty diff */}
                        {qtyDiff && (
                            <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[10px] text-slate-500">
                                <span>Sistema: <strong className="text-slate-700">{item.cantidad_asignada}</strong></span>
                                <span className="text-slate-300">→</span>
                                <span>Físico: <strong className={item.cantidad_recibida < item.cantidad_asignada ? 'text-red-600' : 'text-emerald-600'}>{item.cantidad_recibida}</strong></span>
                            </div>
                        )}

                        <div className="px-3 pb-3 space-y-2">

                            {/* ── Estado: null o rechazada — BODEGA propone ── */}
                            {(!res || res === 'rechazada') && !isBranch && (
                                <>
                                    {res === 'rechazada' && (
                                        <div className="flex items-start gap-1.5 text-[10px] bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-100">
                                            <X size={10} className="text-red-500 mt-0.5 shrink-0" />
                                            <div>
                                                <span className="font-semibold text-red-700">Rechazado</span>
                                                {rechazadoEmp && <span className="text-red-600"> por {rechazadoEmp.name?.split(' ')[0]}</span>}
                                                {item.nota_rechazo && <p className="text-red-600 italic">{item.nota_rechazo}</p>}
                                            </div>
                                        </div>
                                    )}
                                    <LiquidSelect
                                        value={selTipo}
                                        onChange={v => setTipoSel(p => ({ ...p, [item.id]: v }))}
                                        options={opts.map(([v, l]) => ({ value: v, label: l }))}
                                        compact
                                        clearable={false}
                                    />
                                    <div className="flex gap-2">
                                        <input
                                            type="text" placeholder="Nota (opcional)…"
                                            value={notaSel[item.id] ?? ''}
                                            onChange={e => setNotaSel(p => ({ ...p, [item.id]: e.target.value }))}
                                            className="flex-1 text-[10px] border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-violet-400 bg-white placeholder-slate-300"
                                        />
                                        <button
                                            onClick={() => onResolver(item.id, 'proponer', selTipo, notaSel[item.id] || null)}
                                            disabled={isBusy || !selTipo}
                                            className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 shrink-0 active:scale-95 transition-all"
                                        >
                                            {isBusy ? <Loader2 size={10} className="animate-spin" /> : res === 'rechazada' ? 'Volver a proponer' : 'Proponer'}
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* ── Estado: null — SUCURSAL espera ── */}
                            {!res && isBranch && (
                                <p className="text-[10px] text-slate-400 italic">Esperando resolución de bodega…</p>
                            )}

                            {/* ── Estado: propuesta — mostrar propuesta ── */}
                            {res === 'propuesta' && (
                                <>
                                    <div className="flex items-start gap-1.5 text-[10px] bg-violet-50 rounded-lg px-2.5 py-1.5 border border-violet-100">
                                        <div className="flex-1">
                                            <span className="font-semibold text-violet-800">{RESOLUCION_LABEL[item.resolucion_tipo] ?? item.resolucion_tipo}</span>
                                            {resueltoEmp && <span className="text-violet-600"> — {resueltoEmp.name?.split(' ')[0]}</span>}
                                            {item.resolucion_nota && <p className="text-violet-600 italic">{item.resolucion_nota}</p>}
                                        </div>
                                    </div>
                                    {isBranch && (
                                        rejectOpen[item.id] ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text" placeholder="Razón del rechazo…" autoFocus
                                                    value={notaRec[item.id] ?? ''}
                                                    onChange={e => setNotaRec(p => ({ ...p, [item.id]: e.target.value }))}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') onResolver(item.id, 'rechazar', null, notaRec[item.id] || null);
                                                        if (e.key === 'Escape') setRejectOpen(p => ({ ...p, [item.id]: false }));
                                                    }}
                                                    className="flex-1 text-[10px] border border-red-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-red-400 bg-white placeholder-slate-300"
                                                />
                                                <button
                                                    onClick={() => onResolver(item.id, 'rechazar', null, notaRec[item.id] || null)}
                                                    disabled={isBusy}
                                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 shrink-0 active:scale-95 transition-all"
                                                >
                                                    {isBusy ? <Loader2 size={10} className="animate-spin" /> : 'Rechazar'}
                                                </button>
                                                <button onClick={() => setRejectOpen(p => ({ ...p, [item.id]: false }))} className="text-[10px] text-slate-400 hover:text-slate-600 px-1">✕</button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => onResolver(item.id, 'confirmar', null, null)}
                                                    disabled={isBusy}
                                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 active:scale-95 transition-all"
                                                >
                                                    {isBusy ? <Loader2 size={10} className="animate-spin" /> : '✓ Confirmar'}
                                                </button>
                                                <button
                                                    onClick={() => setRejectOpen(p => ({ ...p, [item.id]: true }))}
                                                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 active:scale-95 transition-all"
                                                >
                                                    Rechazar
                                                </button>
                                            </div>
                                        )
                                    )}
                                    {!isBranch && (
                                        <p className="text-[10px] text-slate-400 italic">Esperando confirmación de sucursal…</p>
                                    )}
                                </>
                            )}

                            {/* ── Estado: rechazada — SUCURSAL espera ── */}
                            {res === 'rechazada' && isBranch && (
                                <div className="text-[10px] bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-100 space-y-0.5">
                                    <div>
                                        <span className="font-semibold text-red-700">Rechazada</span>
                                        {rechazadoEmp && <span className="text-red-600"> por {rechazadoEmp.name?.split(' ')[0]}</span>}
                                    </div>
                                    {item.nota_rechazo && <p className="text-red-600 italic">{item.nota_rechazo}</p>}
                                    <p className="text-slate-400">Esperando nueva propuesta de bodega…</p>
                                </div>
                            )}

                            {/* ── Estado: confirmada ── */}
                            {res === 'confirmada' && (
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-emerald-700">
                                    <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                                    <strong>{RESOLUCION_LABEL[item.resolucion_tipo] ?? item.resolucion_tipo}</strong>
                                    {confirmadoEmp && <span className="text-emerald-600">— {confirmadoEmp.name?.split(' ')[0]}</span>}
                                    {item.resolucion_nota && <span className="text-emerald-600 italic">· {item.resolucion_nota}</span>}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* ── Actividad ── */}
            {eventos.length > 0 && (
                <div className="border-t border-amber-100 pt-2 space-y-1.5">
                    <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">Actividad</p>
                    {eventos.map(ev => {
                        const emp       = ev.hecho_por ? empMap.get(ev.hecho_por) : null;
                        const itemName  = difItems.find(d => d.id === ev.pedido_item_id)?.products?.nombre;
                        return (
                            <div key={ev.id} className="flex items-start gap-2 text-[10px] text-slate-600">
                                <span className="text-slate-400 shrink-0 tabular-nums">{fmtRelative(ev.created_at)}</span>
                                <span>
                                    <strong className="text-slate-700">{emp?.name?.split(' ')[0] ?? '—'}</strong>{' '}
                                    {EVENTO_LABEL[ev.tipo] ?? ev.tipo}
                                    {ev.resolucion_tipo && <em className="text-slate-500"> ({RESOLUCION_LABEL[ev.resolucion_tipo] ?? ev.resolucion_tipo})</em>}
                                    {itemName && <span className="text-slate-400"> · {itemName}</span>}
                                    {ev.nota && <span className="text-slate-500 italic"> — {ev.nota}</span>}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {hiddenCount > 0 && (
                <button onClick={() => setShowAll(s => !s)}
                    className="w-full text-[10px] font-semibold text-amber-600 hover:text-amber-800 py-1 rounded-lg hover:bg-amber-50 transition-all text-center">
                    {showAll ? 'Ver menos ↑' : `Ver todas las diferencias (${difItems.length}) ↓`}
                </button>
            )}
        </div>
    );
}

// ─── Reception actions ────────────────────────────────────────────────────────

function ReceptionActions({ llegadaOk, erpOk, onMarkLlegada, onOpenRecibir, onOpenReenvioModal, onSegundaLlegada, onApoyo, busy, llegadaEmp, erpEmp, cardApoyo = [], pendientesCount = 0, llegadaTipo, reenviosHistorial = [], faltaCajas = [], cajasDanadas = [], hasFaltaItems = false, reenvioBodygaAt = null, segundaLlegadaAt = null }) {
    const empChip = (emp) => emp ? (
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
            {emp.photo_url
                ? <img src={emp.photo_url} className="w-4 h-4 rounded-full object-cover border border-white shadow-sm" alt="" />
                : <UserCircle2 size={12} className="text-slate-400" />}
            {emp.name?.split(' ')[0]}
        </span>
    ) : null;

    const apoyoChips = cardApoyo.length > 0 ? (
        <div className="flex items-center gap-0.5">
            {cardApoyo.slice(0, 4).map((a, i) => (
                a.photo_url
                    ? <img key={a.id} src={a.photo_url} title={a.name} style={{ marginLeft: i > 0 ? -5 : 0 }} className="w-4 h-4 rounded-full object-cover border-2 border-white shadow-sm shrink-0" alt="" />
                    : <span key={a.id} title={a.name} style={{ marginLeft: i > 0 ? -5 : 0 }} className="w-4 h-4 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center shrink-0"><UserCircle2 size={9} className="text-slate-500" /></span>
            ))}
        </div>
    ) : null;

    const apoyoBtn = (
        <button onClick={onApoyo} className="flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 active:scale-95 transition-all shrink-0">
            <UserPlus size={10} />Apoyo
        </button>
    );

    // Estado de reenvíos — ciclo pendiente de llegada
    // Fallback para pedidos viejos: si no hay historial pero reenvio_bodega_at está seteado, sintetizar un ciclo virtual
    const cicloEnCamino = reenviosHistorial.find(c => c.sent_at && !c.arrived_at)
        ?? (reenvioBodygaAt && !segundaLlegadaAt && faltaCajas.length > 0
            ? { sent_at: reenvioBodygaAt, cajas: faltaCajas, ciclo: 1, _legacy: true }
            : null);
    const hasFaltaPendiente  = faltaCajas.length > 0;
    const hasDanadaPendiente = cajasDanadas.length > 0;

    // ¿Cuántos ciclos de reenvío se han completado? (todos tienen arrived_at)
    // Para pedidos viejos: "resuelto" cuando segunda_llegada_at está seteado
    const todosReenviosResueltos = reenviosHistorial.length > 0
        ? reenviosHistorial.every(c => c.arrived_at)
        : !!segundaLlegadaAt;

    return (
        <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Recepción</div>

            {/* Paso 1: Llegada — solo visible cuando aún no confirmada */}
            {!llegadaOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-blue-50/40 border-blue-100 text-[11px]">
                    <PackageCheck size={13} className="text-blue-500" />
                    <span className="text-blue-700">Paso 1 — Confirmar llegada de cajas</span>
                    <button onClick={onMarkLlegada} disabled={busy === 'llegada'} className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50">
                        {busy === 'llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar'}
                    </button>
                </div>
            )}

            {/* Badges compactos: cajas dañadas + faltantes */}
            {llegadaOk && (hasDanadaPendiente || (hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos)) && (
                <div className="flex flex-wrap gap-1.5">
                    {hasDanadaPendiente && cajasDanadas.map(n => (
                        <span key={`d${n}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-[10px] font-semibold text-amber-700">
                            <AlertTriangle size={9} />#{n} dañada
                        </span>
                    ))}
                    {hasFaltaPendiente && !cicloEnCamino && !todosReenviosResueltos && faltaCajas.map(n => (
                        <span key={`f${n}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 border border-rose-200 text-[10px] font-semibold text-rose-700">
                            <PackageX size={9} />#{n} no llegó
                        </span>
                    ))}
                </div>
            )}

            {/* Banner: reenvío en camino — mostrar por cada ciclo activo */}
            {llegadaOk && cicloEnCamino && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-indigo-50/40 border-indigo-100 text-[11px]">
                    <Truck size={12} className="text-indigo-400 shrink-0" />
                    <span className="text-indigo-700">
                        {reenviosHistorial.length > 1 ? `Reenvío ${cicloEnCamino.ciclo} en camino` : 'Reenvío en camino'} — caja{cicloEnCamino.cajas?.length > 1 ? 's' : ''} {(cicloEnCamino.cajas ?? []).map(n => `#${n}`).join(', ')}
                    </span>
                    <button onClick={onSegundaLlegada} disabled={!!busy}
                        className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50 shrink-0">
                        {busy === 'segunda_llegada' ? <Loader2 size={10} className="animate-spin" /> : 'Confirmar llegada'}
                    </button>
                </div>
            )}

            {/* Revisar items del reenvío (después de confirmar la segunda llegada) */}
            {llegadaOk && todosReenviosResueltos && !hasFaltaPendiente && hasFaltaItems && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/40 border-violet-100 text-[11px]">
                    <Database size={13} className="text-violet-500" />
                    <span className="text-violet-700">Revisar caja del reenvío en Sistema de Ventas</span>
                    <button onClick={onOpenReenvioModal} disabled={!!busy}
                        className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 active:scale-95 transition-all disabled:opacity-50">
                        Revisar
                    </button>
                </div>
            )}

            {/* Paso 2: Confirmar en Sistema de Ventas */}
            {llegadaOk && !erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-violet-50/40 border-violet-100 text-[11px]">
                    <Database size={13} className="text-violet-500" />
                    <span className="text-violet-700">
                        Paso 2 — Confirmar en Sistema de Ventas {pendientesCount > 0 ? `(${pendientesCount})` : ''}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {apoyoChips}
                        {apoyoBtn}
                        <button onClick={onOpenRecibir} disabled={!!busy}
                            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 active:scale-95 transition-all disabled:opacity-50">
                            Confirmar
                        </button>
                    </div>
                </div>
            )}

            {/* Completado en ERP */}
            {erpOk && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-emerald-50/40 border-emerald-100 text-[11px]">
                    <Database size={13} className="text-emerald-500" />
                    <span className="text-emerald-700">Confirmado en Sistema de Ventas</span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {empChip(erpEmp)}
                        {apoyoChips}
                    </div>
                </div>
            )}
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
    const hasActive   = (!isBranch && filterSuc !== '') || filterStatus !== 'all' || dateDirty;
    const clearAll    = () => { setFilterSuc(''); setFilterStatus('all'); setFilterDate(defaultDate); };

    const statusBtn = (key, label, activeClass = 'bg-blue-600 text-white border-blue-600') => (
        <button
            onClick={() => setFilterStatus(v => v === key ? 'all' : key)}
            className={`flex items-center gap-1 text-[11px] px-3 py-1 rounded-full border font-medium transition-colors whitespace-nowrap shrink-0 ${
                filterStatus === key
                    ? activeClass
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
            }`}
        >
            {label}{filterStatus === key && <X size={9} strokeWidth={3} className="ml-0.5" />}
        </button>
    );

    return (
        <div className="group flex items-center gap-0 h-14 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 hover:border-slate-200 overflow-visible shrink-0">

            {/* Sucursal (solo bodega) */}
            {!isBranch && (
                <>
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible" style={{ width: '150px' }}>
                            <LiquidSelect value={filterSuc} onChange={v => setFilterSuc(v)} options={filterOptions} placeholder="Todas" icon={Building2} compact bare />
                        </div>
                        {filterSuc !== '' && (
                            <button onClick={() => setFilterSuc('')} title="Quitar sucursal" className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
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
                    <button onClick={() => setFilterDate(defaultDate)} title="Quitar fecha" className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                        <X size={9} strokeWidth={3} />
                    </button>
                )}
            </div>

            <div className="h-5 w-px bg-slate-100 shrink-0" />

            {/* Estado */}
            <div className="flex items-center gap-1 px-2 py-1.5">
                {statusBtn('confirmado', 'Pendientes')}
                {statusBtn('enviado',    'En camino')}
                <div className="h-3.5 w-px bg-slate-100 mx-0.5 shrink-0" />
                {statusBtn('observacion','Con observación', 'bg-amber-500 text-white border-amber-500')}
                {statusBtn('completado', 'Completados',     'bg-emerald-600 text-white border-emerald-600')}
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
    const canEdit  = hasPermission('pedidos', 'can_edit');

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
    const [eventosMap,    setEventosMap]    = useState({});
    const [loadingItems,  setLoadingItems]  = useState(false);
    const [llegadaStatus, setLlegadaStatus] = useState({});
    const [erpStatus,     setErpStatus]     = useState({});
    const [busyAction,    setBusyAction]    = useState(null);
    const [busyLifecycle, setBusyLifecycle] = useState(null);
    const [crearRutaOpen, setCrearRutaOpen] = useState(false);
    const [modal,         setModal]         = useState(null);
    const [llegadaModal,       setLlegadaModal]       = useState(null); // { pedidoId, sucId, key, rows }
    const [reenvioLlegadaModal,setReenvioLlegadaModal] = useState(null); // { pedidoId, sucId, key, ciclo, cajasCiclo }
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
        if (error) return [];
        setActiveRows(data ?? []);
        const rows = data ?? [];
        const stats = {};
        rows.forEach(row => {
            stats[`act_${row.pedido_id}_${row.erp_sucursal_id}`] = { enviados: 0, sinStock: 0, porRegla: 0 };
        });
        const ids = [...new Set(rows.map(r => r.pedido_id))];
        if (ids.length) {
            const { data: statRows } = await supabase.rpc('get_pedido_item_stats', { p_pedido_ids: ids });
            (statRows ?? []).forEach(s => {
                const k = `act_${s.pedido_id}_${s.erp_sucursal_id}`;
                stats[k] = { enviados: s.enviados, sinStock: s.sin_stock, porRegla: s.por_regla, pendientes: s.pendientes ?? 0 };
            });
        }
        setCardStats(stats);
        return rows;
    }, []);

    useEffect(() => {
        (async () => {
            setLoading(true);
            await loadActive();
            setLoading(false);
        })();
    }, []); // eslint-disable-line

    // Auto-load items for pedidos parciales so DifSection always shows item details
    useEffect(() => {
        const parciales = activeRows.filter(r => r.pedido_status === 'parcial');
        if (!parciales.length) return;
        parciales.forEach(r => {
            const key = `act_${r.pedido_id}_${r.erp_sucursal_id}`;
            if (!items[key]) fetchItems(key, r.pedido_id, r.erp_sucursal_id);
        });
    }, [activeRows]); // eslint-disable-line

    // Batch-load apoyo for ALL users whenever activeRows changes (branch + bodega)
    useEffect(() => {
        if (!activeRows.length) return;
        (async () => {
            const ids = [...new Set(activeRows.map(r => r.pedido_id))];
            if (!ids.length) return;
            let q = supabase.from('pedido_apoyo')
                .select('pedido_id, erp_sucursal_id, employee_id, tipo, employees(name, photo_url)')
                .in('pedido_id', ids);
            // Branch: filter to their sucursal only; bodega: load all sucursales
            if (isBranch && erpSucursalId) q = q.eq('erp_sucursal_id', erpSucursalId);
            const { data } = await q;
            if (!data) return;
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
    }, [isBranch, erpSucursalId, activeRows]); // eslint-disable-line

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
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedido_item_eventos' }, (payload) => {
                const { pedido_id, erp_sucursal_id } = payload.new ?? {};
                if (!pedido_id) return;
                const key = `act_${pedido_id}_${erp_sucursal_id}`;
                fetchItems(key, pedido_id, erp_sucursal_id);
                loadActive();
            })
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, [loadActive, isBranch, erpSucursalId]); // eslint-disable-line

    // ── Fetch items ───────────────────────────────────────────────────────────

    const fetchItems = useCallback(async (key, pedidoId, sucId) => {
        if (!pedidoId) return;
        setLoadingItems(true);
        const sucFilter = sucId ?? (isBranch && erpSucursalId ? erpSucursalId : null);

        const ITEMS_SELECT = `
            id, erp_sucursal_id, erp_product_id, cantidad_asignada, cantidad_recibida,
            status, nota_diferencia, error_tipo, received_at, received_by, lotes_asignados,
            sin_stock, revision_minmax, falta_caja, caja_especial,
            factor, dispatch_tipo, dispatch_factor,
            max_qty_snapshot, stock_packs_snapshot,
            resolucion_status, resolucion_tipo, resolucion_nota,
            resuelto_por, resuelto_at, confirmado_suc_por, confirmado_suc_at,
            rechazado_por, rechazado_at, nota_rechazo,
            products ( nombre, es_antibiotico, laboratorios ( nombre ) ),
            presentaciones!erp_presentacion_id ( tipo )
        `;

        // Paginated fetch — pedidos con >1000 items existen en producción
        const PAGE = 1000;
        let allItemRows = [], from = 0;
        while (true) {
            let q = supabase.from('pedido_items').select(ITEMS_SELECT)
                .eq('pedido_id', pedidoId).range(from, from + PAGE - 1);
            if (sucFilter) q = q.eq('erp_sucursal_id', sucFilter);
            const { data: page } = await q;
            if (!page || page.length === 0) break;
            allItemRows = allItemRows.concat(page);
            if (page.length < PAGE) break;
            from += PAGE;
        }

        const lcPromise = (sucFilter && isBranch)
            ? supabase.from('pedido_sucursal_status').select('recibido_erp_at, llegada_fisica_at').eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucFilter).maybeSingle()
            : Promise.resolve({ data: null });

        let apoyoQ = supabase.from('pedido_apoyo')
            .select('id, employee_id, tipo, employees(name, photo_url)')
            .eq('pedido_id', pedidoId);
        if (sucFilter) apoyoQ = apoyoQ.eq('erp_sucursal_id', sucFilter);

        // Paginated eventos fetch (cap-safe)
        let evBase = supabase.from('pedido_item_eventos')
            .select('id, pedido_item_id, tipo, resolucion_tipo, nota, hecho_por, created_at')
            .eq('pedido_id', pedidoId).order('created_at', { ascending: true });
        if (sucFilter) evBase = evBase.eq('erp_sucursal_id', sucFilter);
        let allEvRows = [], evFrom = 0;
        while (true) {
            const { data: evPage } = await evBase.range(evFrom, evFrom + 999);
            if (!evPage || evPage.length === 0) break;
            allEvRows = allEvRows.concat(evPage);
            if (evPage.length < 1000) break;
            evFrom += 1000;
        }

        const [{ data: lcRow }, { data: apoyoRows }] = await Promise.all([lcPromise, apoyoQ]);
        const resolved = allItemRows;
        setItems(prev => ({ ...prev, [key]: resolved }));
        setEventosMap(prev => ({ ...prev, [key]: allEvRows }));
        const apoyoByTipo = { preparacion: [], recepcion: [] };
        (apoyoRows || []).forEach(r => {
            const t = r.tipo ?? 'preparacion';
            if (!apoyoByTipo[t]) apoyoByTipo[t] = [];
            apoyoByTipo[t].push({ id: r.employee_id, ...r.employees });
        });
        setApoyoMap(prev => ({ ...prev, [key]: apoyoByTipo }));
        if (lcRow) {
            setErpStatus(prev => ({ ...prev, [key]: !!lcRow.recibido_erp_at }));
            setLlegadaStatus(prev => ({ ...prev, [key]: !!lcRow.llegada_fisica_at }));
        }
        setLoadingItems(false);
        return resolved;
    }, [isBranch, erpSucursalId]);

    const toggleExpand = useCallback(async (key, pedidoId, sucId) => {
        if (expanded === key) { setExpanded(null); setExpandedMeta(null); return; }
        setExpanded(key);
        setExpandedMeta({ pedidoId, sucId });
        if (!items[key]) await fetchItems(key, pedidoId, sucId);
    }, [expanded, items, fetchItems]);

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    const handleLifecycle = useCallback(async (pedidoId, sucId, stage, razon = null, numero = null) => {
        const key = `lc_${pedidoId}_${sucId}`;
        setBusyLifecycle(key);
        try {
            const { error } = await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: stage, p_user_id: user?.id ?? null, p_razon: razon });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_LIFECYCLE_${stage.toUpperCase()}`, pedidoId, { sucursal_id: sucId, razon });
            loadActive();
            if (stage === 'iniciar' && numero != null) {
                supabase.from('erp_sucursal_map').select('branch_id, nombre').eq('erp_sucursal_id', sucId).maybeSingle().then(({ data: m }) => {
                    if (!m?.branch_id) return;
                    supabase.from('announcements').insert({ title: `Pedido #${numero} en preparación`, message: `Bodega ha iniciado la preparación de tu pedido #${numero}. Te avisaremos cuando salga en camino.`, target_type: 'BRANCH', target_value: [m.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'NORMAL' }).catch(() => {});
                    supabase.functions.invoke('send-push-notification', { body: { title: `Pedido #${numero} en preparación`, message: `Bodega está preparando tu pedido. Te avisamos cuando salga.`, url: '/pedidos', target_type: 'BRANCH', target_value: [m.branch_id] } }).catch(() => {});
                }).catch(() => {});
            }
        } catch (e) { console.error('Lifecycle error:', e); } finally { setBusyLifecycle(null); }
    }, [user, loadActive]);

    const [printingPdf, setPrintingPdf] = useState(null);
    const handlePrintPdf = useCallback(async (pedidoId, pedidoNumero, sucId, cardKey, codigo) => {
        setPrintingPdf(pedidoId);
        try {
            let rows = items[cardKey];
            if (!rows) rows = await fetchItems(cardKey, pedidoId, sucId);
            await printFromPedidoItems(pedidoNumero, [[sucId, rows ?? []]], {}, codigo ?? `${pedidoNumero}`);
        } catch (e) { console.error('PDF error:', e); } finally { setPrintingPdf(null); }
    }, [items, fetchItems]);

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

    const handleApoyoSuccess = useCallback((emp, cardKey, tipo = 'preparacion') => {
        setApoyoMap(prev => {
            const existing = prev[cardKey] ?? { preparacion: [], recepcion: [] };
            const bucket   = existing[tipo] ?? [];
            if (bucket.find(e => e.id === emp.id)) return prev;
            return { ...prev, [cardKey]: { ...existing, [tipo]: [...bucket, { id: emp.id, name: emp.name, photo_url: emp.photo_url }] } };
        });
        loadActive();
    }, [loadActive]);

    // ── Reception ─────────────────────────────────────────────────────────────

    const openFinalizarModal = useCallback(async (pedidoId, sucId, numero, key) => {
        if (busyAction) return;
        setBusyAction(`finalizar_load_${key}`);
        const [rowsResult, pssResult] = await Promise.all([
            items[key] ? Promise.resolve(items[key]) : fetchItems(key, pedidoId, sucId),
            supabase.from('pedido_sucursal_status').select('paginas')
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle(),
        ]);
        setBusyAction(null);
        setFinalizarModal({
            pedidoId, sucId, numero, key,
            rows:    rowsResult ?? [],
            paginas: pssResult.data?.paginas ?? null,
        });
    }, [busyAction, items, fetchItems]);

    const handleFinalizarConCajas = useCallback(async ({ totalCajas, cajaMap, paginaItems }) => {
        if (!finalizarModal) return;
        const { pedidoId, sucId } = finalizarModal;
        const allRows = finalizarModal.rows ?? [];
        // Contar cajas Electrolit: solo los que despachan por CAJA (625ml)
        const cajasElectrolit = allRows
            .filter(r =>
                (r.products?.nombre ?? '').toLowerCase().includes('electrolit') &&
                (r.dispatch_tipo ?? '').toUpperCase() === 'CAJA'
            )
            .reduce((sum, r) => sum + Math.round((r.cantidad_asignada ?? 0) / (Number(r.dispatch_factor) || 1)), 0);

        // Cajas especiales: E1, E2… por unidad
        let eCounter = 1;
        const cajasEspeciales = allRows
            .filter(r => r.caja_especial === true && (r.cantidad_asignada ?? 0) > 0)
            .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
            .flatMap(r => Array.from({ length: r.cantidad_asignada }, () => ({
                label: `E${eCounter++}`,
                erp_product_id: r.erp_product_id,
                product_name:   r.products?.nombre ?? '',
            })));

        setFinalizarModal(null);
        setBusyAction('finalizar');
        try {
            // Si hay una pausa activa (ej: apoyo finalizando mientras el principal almuerza),
            // auto-reanudar primero — idempotente si no hay pausa activa
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'reanudar', p_user_id: user?.id ?? null,
            }).catch(() => {});
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'finalizar', p_user_id: user?.id ?? null,
            });
            await supabase.from('pedido_sucursal_status')
                .update({ total_cajas: totalCajas, caja_map: cajaMap, pagina_items: paginaItems, cajas_electrolit: cajasElectrolit, cajas_especiales: cajasEspeciales })
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);
            useStaff.getState().appendAuditLog('PEDIDO_FINALIZADO', pedidoId, { totalCajas, cajasElectrolit, cajasEspeciales: cajasEspeciales.length, cajas: Object.keys(cajaMap).length });
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [finalizarModal, user, loadActive]);

    const handleLlegada = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) return;
        let rows = items[key];
        if (!rows) {
            setBusyAction('llegada');
            rows = await fetchItems(key, pedidoId, sucId);
            setBusyAction(null);
        }
        setLlegadaModal({ pedidoId, sucId, key, rows: rows ?? [] });
    }, [busyAction, items, fetchItems]);

    const handleLlegadaConfirm = useCallback(async ({ cajasOk, cajasDanadas, cajasFaltantes, nota, electrolitFaltantes = null, especialesLlegadas = null, cajasExtra = 0, cajasExtraNotas = null }) => {
        if (!llegadaModal) return;
        const { pedidoId, sucId, key, rows } = llegadaModal;
        setLlegadaModal(null);
        setBusyAction('llegada');
        try {
            // 1. Determinar tipo global
            const hasFalta  = cajasFaltantes.length > 0;
            const hasDanada = cajasDanadas.length > 0;
            const tipo = hasFalta && hasDanada ? 'mixto'
                       : hasFalta              ? 'falta_caja'
                       : hasDanada             ? 'caja_danada'
                       :                         'completa';

            // 2. Marcar items de cajas faltantes como falta_caja: true
            if (hasFalta) {
                const { data: pss } = await supabase
                    .from('pedido_sucursal_status')
                    .select('caja_map, pagina_items')
                    .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
                    .maybeSingle();
                const cajaMapDb     = pss?.caja_map    ?? {};
                const paginaItemsDb = pss?.pagina_items ?? {};

                let missingIds = [];
                if (Object.keys(paginaItemsDb).length > 0) {
                    const missingPages = cajasFaltantes.flatMap(n => cajaMapDb[String(n)] ?? []);
                    missingIds = missingPages.flatMap(p => paginaItemsDb[String(p)] ?? []);
                } else {
                    const pageGroups = getPageGroups(rows);
                    missingIds = cajasFaltantes.flatMap(n => pageGroups[n - 1]?.ids ?? []);
                }
                if (missingIds.length > 0) {
                    await supabase.from('pedido_items').update({ falta_caja: true }).in('id', missingIds);
                }
            }

            // 3. Confirmar llegada física
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'confirmar_llegada', p_user_id: user?.id ?? null,
            });

            // 4. Guardar metadata de llegada
            await supabase.from('pedido_sucursal_status').update({
                llegada_tipo:  tipo,
                llegada_nota:  nota || null,
                falta_cajas:   cajasFaltantes,
                cajas_danadas: cajasDanadas,
                ...((hasFalta || hasDanada) ? { falta_caja_at: new Date().toISOString() } : {}),
                ...(electrolitFaltantes !== null ? {
                    electrolit_ok:        electrolitFaltantes === 0,
                    electrolit_faltantes: electrolitFaltantes,
                } : {}),
                ...(especialesLlegadas !== null ? { cajas_especiales_llegadas: especialesLlegadas } : {}),
            }).eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);

            useStaff.getState().appendAuditLog('PEDIDO_LLEGADA_CONFIRMADA', pedidoId, { tipo, cajasFaltantes, cajasDanadas, cajasExtra, cajasExtraNotas });
            setLlegadaStatus(prev => ({ ...prev, [key]: true }));

            // 5a. Notificar bodega si hay problema en cajas físicas
            if (tipo !== 'completa') {
                supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const parts = [];
                    if (cajasDanadas.length > 0)  parts.push(`caja${cajasDanadas.length > 1 ? 's' : ''} dañada${cajasDanadas.length > 1 ? 's' : ''} ${cajasDanadas.map(n => `#${n}`).join(', ')}`);
                    if (cajasFaltantes.length > 0) parts.push(`caja${cajasFaltantes.length > 1 ? 's' : ''} faltante${cajasFaltantes.length > 1 ? 's' : ''} ${cajasFaltantes.map(n => `#${n}`).join(', ')}`);
                    const title   = `Problema en llegada — ${branchName}`;
                    const message = `${branchName} reporta: ${parts.join(' y ')}.${nota ? ' ' + nota : ''}`;
                    supabase.from('announcements').insert({ title, message, target_type: 'BRANCH', target_value: [b.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'HIGH' }).catch(() => {});
                    supabase.functions.invoke('send-push-notification', { body: { title, message, url: '/pedidos', target_type: 'BRANCH', target_value: [b.branch_id] } }).catch(() => {});
                }).catch(() => {});
            }

            // 5b. Notificar bodega si faltan cajas de Electrolit
            if ((electrolitFaltantes ?? 0) > 0) {
                supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const cnt = electrolitFaltantes;
                    const title   = `Electrolit faltante — ${branchName}`;
                    const message = `${branchName} reporta ${cnt} caja${cnt > 1 ? 's' : ''} de Electrolit que no llegaron.`;
                    supabase.from('announcements').insert({ title, message, target_type: 'BRANCH', target_value: [b.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'HIGH' }).catch(() => {});
                    supabase.functions.invoke('send-push-notification', { body: { title, message, url: '/pedidos', target_type: 'BRANCH', target_value: [b.branch_id] } }).catch(() => {});
                }).catch(() => {});
            }

            // 5c. Notificar si cajas de más
            if (cajasExtra > 0) {
                supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const notas = cajasExtraNotas ? Object.values(cajasExtraNotas).filter(Boolean) : [];
                    const title   = `Cajas de más — ${branchName}`;
                    const message = `${branchName} reporta ${cajasExtra} caja${cajasExtra > 1 ? 's' : ''} extra no esperada${cajasExtra > 1 ? 's' : ''}.${notas.length ? ' ' + notas.join(', ') : ''}`;
                    supabase.from('announcements').insert({ title, message, target_type: 'BRANCH', target_value: [b.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'MEDIUM' }).catch(() => {});
                    supabase.functions.invoke('send-push-notification', { body: { title, message, url: '/pedidos', target_type: 'BRANCH', target_value: [b.branch_id] } }).catch(() => {});
                }).catch(() => {});
            }

            // 5d. Notificar si faltan cajas especiales
            if (especialesLlegadas && Object.values(especialesLlegadas).some(v => v === 'faltante')) {
                supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle().then(({ data: b }) => {
                    if (!b?.branch_id) return;
                    const faltanE = Object.entries(especialesLlegadas).filter(([, v]) => v === 'faltante').map(([k]) => k);
                    const title   = `Caja especial faltante — ${branchName}`;
                    const message = `${branchName} reporta caja${faltanE.length > 1 ? 's' : ''} especial${faltanE.length > 1 ? 'es' : ''} no recibida${faltanE.length > 1 ? 's' : ''}: ${faltanE.join(', ')}.`;
                    supabase.from('announcements').insert({ title, message, target_type: 'BRANCH', target_value: [b.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'HIGH' }).catch(() => {});
                    supabase.functions.invoke('send-push-notification', { body: { title, message, url: '/pedidos', target_type: 'BRANCH', target_value: [b.branch_id] } }).catch(() => {});
                }).catch(() => {});
            }

            await loadActive();
            await fetchItems(key, pedidoId, sucId);
        } catch (e) { console.error('llegada confirm:', e); } finally { setBusyAction(null); }
    }, [llegadaModal, user, branchName, loadActive, fetchItems]);

    const handleReenviarCaja = useCallback(async (pedidoId, sucId, numero, cajasFaltantes) => {
        setBusyAction('reenvio');
        try {
            const now = new Date().toISOString();
            // Leer historial actual para calcular ciclo
            const { data: pss } = await supabase.from('pedido_sucursal_status')
                .select('reenvios_historial')
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle();
            const historial = pss?.reenvios_historial ?? [];
            const ciclo     = historial.length + 1;
            const nuevoCiclo = { ciclo, cajas: cajasFaltantes, sent_at: now, sent_by: user?.id ?? null, arrived_at: null, arrived_tipo: null, cajas_ok: [], cajas_danadas: [], cajas_aun_faltantes: [] };

            await supabase.from('pedido_sucursal_status')
                .update({
                    reenvio_bodega_at:  now,
                    reenvio_por:        user?.id ?? null,
                    reenvios_historial: [...historial, nuevoCiclo],
                })
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);

            useStaff.getState().appendAuditLog('PEDIDO_REENVIO_CAJA', pedidoId, { sucursal_id: sucId, ciclo, cajas: cajasFaltantes });

            supabase.from('erp_sucursal_map').select('branch_id').eq('erp_sucursal_id', sucId).maybeSingle().then(({ data: m }) => {
                if (!m?.branch_id) return;
                const cajasStr = cajasFaltantes.map(n => `#${n}`).join(', ');
                supabase.from('announcements').insert({ title: `Reenvío en camino — pedido #${numero}`, message: `La caja ${cajasStr} del pedido #${numero} ya salió de bodega. Confirma la llegada cuando la recibas.`, target_type: 'BRANCH', target_value: [m.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'HIGH' }).catch(() => {});
                supabase.functions.invoke('send-push-notification', { body: { title: `Caja ${cajasStr} en camino`, message: 'La caja faltante ya salió de bodega.', url: '/pedidos', target_type: 'BRANCH', target_value: [m.branch_id] } }).catch(() => {});
            }).catch(() => {});
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [user, loadActive]);

    // Abre el modal de confirmación de llegada de reenvío (sustituye el botón ciego anterior)
    const handleSegundaLlegada = useCallback((pedidoId, sucId, key, reenviosHistorial, faltaCajasLegacy = [], cajaMap = {}) => {
        const historial = reenviosHistorial ?? [];
        const cicloIdx  = historial.findIndex(c => !c.arrived_at);
        const ciclo     = cicloIdx >= 0 ? historial[cicloIdx] : historial[historial.length - 1];
        if (!ciclo) {
            if (faltaCajasLegacy.length > 0) {
                setReenvioLlegadaModal({ pedidoId, sucId, key, ciclo: 1, cajasCiclo: faltaCajasLegacy, historial: [], cajaMap });
            }
            return;
        }
        setReenvioLlegadaModal({
            pedidoId, sucId, key,
            ciclo:      ciclo.ciclo,
            cajasCiclo: ciclo.cajas ?? [],
            historial,
            cajaMap,
        });
    }, []);

    const handleReenvioLlegadaConfirm = useCallback(async ({ cajasOk, cajasDanadas, cajasFaltantes, nota }) => {
        if (!reenvioLlegadaModal) return;
        const { pedidoId, sucId, key, ciclo, historial } = reenvioLlegadaModal;
        setReenvioLlegadaModal(null);
        setBusyAction('segunda_llegada');
        try {
            const now = new Date().toISOString();
            const hasFalta = cajasFaltantes.length > 0;
            const arrived_tipo = hasFalta && cajasDanadas.length > 0 ? 'mixto'
                               : hasFalta                            ? 'falta_caja'
                               : cajasDanadas.length > 0             ? 'caja_danada'
                               :                                        'ok';

            // Actualizar el ciclo correspondiente en el historial
            const nuevoHistorial = historial.map(c =>
                c.ciclo === ciclo
                    ? { ...c, arrived_at: now, arrived_tipo, arrived_por: user?.id ?? null, cajas_ok: cajasOk, cajas_danadas: cajasDanadas, cajas_aun_faltantes: cajasFaltantes, nota: nota || null }
                    : c
            );

            await supabase.from('pedido_sucursal_status').update({
                segunda_llegada_at: now,
                reenvios_historial: nuevoHistorial,
                // Siempre actualizar falta_cajas: vacío si todo llegó, o las cajas aún pendientes
                falta_cajas: hasFalta ? cajasFaltantes : [],
            }).eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);

            useStaff.getState().appendAuditLog('PEDIDO_REENVIO_LLEGADA', pedidoId, { ciclo, arrived_tipo, cajasOk, cajasDanadas, cajasFaltantes });

            // Cargar mapa de páginas → ítems una sola vez
            const { data: pss } = await supabase.from('pedido_sucursal_status')
                .select('caja_map, pagina_items')
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle();
            const cajaMapDb     = pss?.caja_map    ?? {};
            const paginaItemsDb = pss?.pagina_items ?? {};

            const getItemIds = (cajas) => {
                if (!Object.keys(paginaItemsDb).length) return [];
                return cajas.flatMap(n => (cajaMapDb[String(n)] ?? []).flatMap(p => paginaItemsDb[String(p)] ?? []));
            };

            // Limpiar falta_caja en ítems de cajas que SÍ llegaron (OK o dañadas)
            const cajasLlegaron = [...cajasOk, ...cajasDanadas];
            if (cajasLlegaron.length > 0) {
                const llegadaIds = getItemIds(cajasLlegaron);
                if (llegadaIds.length > 0) {
                    await supabase.from('pedido_items').update({ falta_caja: false }).in('id', llegadaIds);
                }
            }

            // Mantener falta_caja: true solo en cajas que AÚN no llegaron
            if (hasFalta) {
                const mIds = getItemIds(cajasFaltantes);
                if (mIds.length > 0) await supabase.from('pedido_items').update({ falta_caja: true }).in('id', mIds);

                // Notificar bodega para nuevo reenvío
                supabase.from('erp_sucursal_map').select('branch_id').eq('erp_sucursal_id', sucId).maybeSingle().then(({ data: m }) => {
                    if (!m?.branch_id) return;
                    const cajasStr = cajasFaltantes.map(n => `#${n}`).join(', ');
                    supabase.from('announcements').insert({ title: `Aún falta caja — reenvío ${ciclo}`, message: `${branchName} reporta que la caja ${cajasStr} aún no llegó en el reenvío ${ciclo}. Se requiere otro envío.`, target_type: 'BRANCH', target_value: [m.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'HIGH' }).catch(() => {});
                }).catch(() => {});
            }

            await loadActive();
            await fetchItems(key, pedidoId, sucId);
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [reenvioLlegadaModal, user, branchName, loadActive, fetchItems]);

    const handleMarkErp = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) return;
        setBusyAction('erp');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'recibir_erp', p_user_id: user?.id ?? null });
            useStaff.getState().appendAuditLog('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: sucId });
            setErpStatus(prev => ({ ...prev, [key]: true }));
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [busyAction, user, loadActive]);

    const openModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = items[key] ?? await fetchItems(key, pedidoId, sucId);
        const rows = (loaded || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0 && !r.falta_caja);
        if (!rows.length) return;
        const activeRow  = activeRows.find(r => r.pedido_id === pedidoId && r.erp_sucursal_id === sucId);
        // cajas_danadas y falta_cajas son ahora arrays independientes (soporta 'mixto')
        const cajaDanada = activeRow?.cajas_danadas ?? [];
        const faltaCajas = activeRow?.falta_cajas   ?? [];
        const cajaMap    = activeRow?.caja_map       ?? {};

        // Load pagina_items + cajas_recibidas only when caja_map is available
        let paginaItems = {}, cajasRecibidas = [];
        if (Object.keys(cajaMap).length > 0) {
            const { data: pss } = await supabase.from('pedido_sucursal_status')
                .select('pagina_items, cajas_recibidas')
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle();
            paginaItems    = pss?.pagina_items    ?? {};
            cajasRecibidas = pss?.cajas_recibidas ?? [];
        }

        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada, cajaMap, paginaItems, cajasRecibidas, faltaCajas });
    }, [items, fetchItems, activeRows]);

    const openReenvioModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = items[key] ?? await fetchItems(key, pedidoId, sucId);
        const rows = (loaded || []).filter(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
        if (!rows.length) return;
        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada: [] });
    }, [items, fetchItems]);

    const handleReportarDiferencias = useCallback(async (pedidoId, sucId) => {
        supabase.rpc('update_pedido_sucursal_lifecycle', {
            p_pedido_id: pedidoId, p_sucursal_id: sucId,
            p_stage: 'reportar_diferencias', p_user_id: user?.id ?? null,
        }).catch(e => console.error('lifecycle reportar_diferencias:', e));
        useStaff.getState().appendAuditLog('PEDIDO_DIFERENCIAS_REPORTADAS', pedidoId, { sucursal_id: sucId });
    }, [user]);

    const handleCorregirBodega = useCallback(async (pedidoId, sucId, nota) => {
        setBusyAction('corr_bodega');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'corregir_bodega', p_user_id: user?.id ?? null, p_nota: nota || null,
            });
            useStaff.getState().appendAuditLog('PEDIDO_CORREGIDO_BODEGA', pedidoId, { sucursal_id: sucId, nota });
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [user, loadActive]);

    const handleConfirmarCorreccion = useCallback(async (pedidoId, sucId) => {
        setBusyAction('confirmar_corr');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', {
                p_pedido_id: pedidoId, p_sucursal_id: sucId,
                p_stage: 'confirmar_correccion', p_user_id: user?.id ?? null,
            });
            useStaff.getState().appendAuditLog('PEDIDO_CORRECCION_CONFIRMADA', pedidoId, { sucursal_id: sucId });
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [user, loadActive]);

    const handleResolverItem = useCallback(async (pedidoId, sucId, itemId, action, tipo, nota) => {
        setBusyAction(`res_${itemId}`);
        try {
            const { error } = await supabase.rpc('resolve_pedido_item', {
                p_item_id: itemId, p_action: action,
                p_user_id: user?.id ?? null,
                p_tipo:    tipo ?? null,
                p_nota:    nota ?? null,
            });
            if (error) throw error;
            useStaff.getState().appendAuditLog(`PEDIDO_RESOLUCION_${action.toUpperCase()}`, pedidoId, { item_id: itemId, tipo, nota });
            const key = `act_${pedidoId}_${sucId}`;
            await Promise.all([loadActive(), fetchItems(key, pedidoId, sucId)]);
        } catch (e) { console.error('resolverItem:', e); } finally { setBusyAction(null); }
    }, [user, loadActive, fetchItems]);

    // ── Derived ───────────────────────────────────────────────────────────────

    const searchLower   = useMemo(() => searchTerm.toLowerCase(), [searchTerm]);
    const filterOptions = useMemo(() => ERP_ORDER.map(id => ({ value: id, label: ERP_NAMES[id] ?? `Suc. ${id}` })), []);

    const hasObservacion = useCallback((r) =>
        r.pedido_status === 'parcial' ||
        (r.llegada_tipo && r.llegada_tipo !== 'completa') ||
        (r.falta_cajas?.length  > 0) ||
        (r.cajas_danadas?.length > 0),
    []);

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
        if (filterSuc) rows = rows.filter(r => r.erp_sucursal_id === Number(filterSuc));

        if (filterStatus === 'completado') {
            rows = rows.filter(r => r.pedido_status === 'completado');
        } else if (filterStatus === 'observacion') {
            rows = rows.filter(r => hasObservacion(r) && r.pedido_status !== 'completado');
        } else if (filterStatus !== 'all') {
            rows = rows.filter(r => r.pedido_status === filterStatus);
        } else {
            // Por defecto ocultar completados; los con observación siempre visibles
            rows = rows.filter(r => r.pedido_status !== 'completado');
        }

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
    }, [activeRows, filterSuc, filterStatus, filterDate, searchLower, hasObservacion]); // eslint-disable-line

    const sucursalCounts = useMemo(() => {
        const [desde, hasta] = (filterDate ?? '').split('|');
        return ERP_ORDER.map(id => {
            const rows = activeRows.filter(r => {
                if (r.erp_sucursal_id !== id) return false;
                const d = r.created_at?.slice(0, 10);
                return (!desde || d >= desde) && (!hasta || d <= hasta);
            });
            return { id, name: ERP_NAMES[id] ?? `Suc. ${id}`, total: rows.length };
        }).filter(s => s.total > 0);
    }, [activeRows, filterDate]);

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
                                    <div className="text-[9px] text-slate-400">pedidos este mes</div>
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
                                    <div className="text-[9px] text-slate-400">pedidos este mes</div>
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
                    <div className="space-y-2.5">
                        {filteredRows.map(row => {
                            const stage      = getBranchStage(row, row.pedido_status);
                            const cardKey    = `act_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isExp      = expanded === cardKey;
                            const lcKey      = `lc_${row.pedido_id}_${row.erp_sucursal_id}`;
                            const isLCBusy   = busyLifecycle === lcKey;

                            const pedidoStages = pedidoStageMap.get(row.pedido_id) ?? {};
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

                            // Apoyo puede finalizar incluso si el principal pausó (auto-reanuda en handleFinalizarConCajas)
                            const canFinalizar = canActuar && !isBranch
                                && (stage === 'preparando' || (stage === 'pausado' && isApoyoBodega));

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

                            const isDone     = row.pedido_status === 'completado' || row.pedido_status === 'parcial';
                            // Solo fade cuando completado: parcial queda visible (pendiente corrección)
                            const isFadedOut = row.pedido_status === 'completado' && !!row.recibido_erp_at;  // sutil: solo baja un poco la opacidad

                            return (
                                <div
                                    key={cardKey}
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

                                    {/* Apoyo preparación (bodega) */}
                                    {prepApoyo.length > 0 && (
                                        <div className="flex items-center gap-1.5 px-3 pb-1.5 flex-wrap">
                                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">Prep:</span>
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
                                        <LifecycleTimeline row={row} stage={stage} creatorEmp={creator} iniciadorEmp={iniciador} finalizadorEmp={finalizador} enviadorEmp={enviador} llegadaEmp={llegadaEmp} conteoEmp={conteoEmp} reenvioEmp={reenvioEmp} erpEmp={erpEmp} difsEmp={difsEmp} corrConfEmp={corrConfEmp} receptionApoyo={recepApoyo} isBranch={isBranch} empMap={empMap} pauses={row.pauses ?? []} />
                                    </div>

                                    {/* Actions + status strip */}
                                    <div className="flex items-center gap-2 px-3 pb-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                        <StagePill stage={stage} />
                                        {row.total_cajas > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 tabular-nums shrink-0">
                                                <Box size={10} className="text-slate-500 shrink-0" />
                                                {row.total_cajas} caja{row.total_cajas !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                        {(row.cajas_electrolit ?? 0) > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-black px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 border border-sky-200 tabular-nums shrink-0">
                                                <Inbox size={10} className="text-sky-500 shrink-0" />
                                                {row.cajas_electrolit} Electrolit
                                            </span>
                                        )}
                                        {row.electrolit_ok === false && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                                                <Zap size={8} className="shrink-0" />
                                                {(row.electrolit_faltantes ?? 0) > 0
                                                    ? `${row.electrolit_faltantes} Electrolit faltante${row.electrolit_faltantes > 1 ? 's' : ''}`
                                                    : 'Electrolit faltante'}
                                            </span>
                                        )}
                                        {(row.cajas_especiales ?? []).length > 0 && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 shrink-0">
                                                {row.cajas_especiales.length} caja{row.cajas_especiales.length > 1 ? 's' : ''} especial{row.cajas_especiales.length > 1 ? 'es' : ''}
                                            </span>
                                        )}
                                        {hasObservacion(row) && row.pedido_status !== 'completado' && (
                                            (row.cajas_danadas?.length > 0 || row.falta_cajas?.length > 0 || row.pedido_status === 'parcial') && (<>
                                                <span className="h-3.5 w-px bg-slate-200 mx-0.5 shrink-0" />
                                                {(row.cajas_danadas ?? []).length > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 shrink-0">
                                                        <AlertTriangle size={8} /> Dañada{row.cajas_danadas.length > 1 ? 's' : ''}: {row.cajas_danadas.map(n => `#${n}`).join(', ')}
                                                    </span>
                                                )}
                                                {(row.falta_cajas ?? []).length > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                                                        <Package size={8} /> Faltante{row.falta_cajas.length > 1 ? 's' : ''}: {row.falta_cajas.map(n => `#${n}`).join(', ')}
                                                    </span>
                                                )}
                                                {row.pedido_status === 'parcial' && !(row.cajas_danadas?.length > 0 || row.falta_cajas?.length > 0) && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 shrink-0">
                                                        <ClipboardList size={8} /> Difs. pendientes
                                                    </span>
                                                )}
                                            </>)
                                        )}
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
                                                    onClick={() => setApoyoModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, cardKey, tipo: 'preparacion' })}
                                                    disabled={isLCBusy}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    <UserPlus size={10} />Apoyo
                                                </button>
                                            )}
                                            {canActuar && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handlePrintPdf(row.pedido_id, row.numero, row.erp_sucursal_id, cardKey, row.codigo); }}
                                                    disabled={printingPdf === row.pedido_id}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 active:scale-95 transition-all disabled:opacity-50"
                                                >
                                                    {printingPdf === row.pedido_id ? <Loader2 size={10} className="animate-spin" /> : <FileDown size={10} />}PDF
                                                </button>
                                            )}
                                            {canIniciar      && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}   disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-blue-500    text-white hover:bg-blue-600    active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Play     size={10} fill="currentColor" />Iniciar</>}</button>}
                                            {canPausar       && <button onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}               disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-amber-400   text-white hover:bg-amber-500   active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Pause    size={10} fill="currentColor" />Pausar</>}</button>}
                                            {canFinalizar    && <button onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)} disabled={isLCBusy || busyAction === `finalizar_load_${cardKey}`} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-violet-500  text-white hover:bg-violet-600  active:scale-95 transition-all disabled:opacity-50 shadow-sm">{(isLCBusy || busyAction === `finalizar_load_${cardKey}`) ? <Loader2 size={11} className="animate-spin" /> : <><Flag size={10} />Finalizar</>}</button>}
                                            {canReanudar     && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}  disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><RotateCcw size={10} />Reanudar</>}</button>}
                                            {canMarcarEnRuta && <button onClick={() => setCrearRutaOpen(true)} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all shadow-sm"><Truck size={10} />Crear Ruta</button>}
                                            {canActuar && !isBranch && (row.falta_cajas ?? []).length > 0 && !(row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at) && (
                                                // Mostrar "Reenviar caja" cuando hay cajas faltantes y no hay un ciclo en camino sin confirmar
                                                <button onClick={() => handleReenviarCaja(row.pedido_id, row.erp_sucursal_id, row.numero, row.falta_cajas ?? [])} disabled={busyAction === 'reenvio'} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-rose-500 text-white hover:bg-rose-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">
                                                    {busyAction === 'reenvio' ? <Loader2 size={10} className="animate-spin" /> : <><Truck size={10} />Reenviar caja</>}
                                                </button>
                                            )}
                                        </div>
                                    </div>

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

                                    {/* Diferencias — visible cuando parcial */}
                                    {row.pedido_status === 'parcial' && (
                                        <div onClick={e => e.stopPropagation()}>
                                            <DifSection
                                                row={row}
                                                difItems={(items[cardKey] ?? []).filter(r => r.status === 'con_diferencia' || r.error_tipo)}
                                                eventos={eventosMap[cardKey] ?? []}
                                                isBranch={isBranch}
                                                busyAction={busyAction}
                                                empMap={empMap}
                                                onResolver={(itemId, action, tipo, nota) =>
                                                    handleResolverItem(row.pedido_id, erpSucursalId ?? row.erp_sucursal_id, itemId, action, tipo, nota)
                                                }
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
                                </div>
                            );
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
            />

            <ReenvioLlegadaModal
                open={!!reenvioLlegadaModal}
                onClose={() => setReenvioLlegadaModal(null)}
                onConfirm={handleReenvioLlegadaConfirm}
                pedidoNumero={reenvioLlegadaModal ? activeRows.find(r => r.pedido_id === reenvioLlegadaModal.pedidoId)?.numero : null}
                cajasCiclo={reenvioLlegadaModal?.cajasCiclo ?? []}
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
            />

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
                    faltaCajas={modal.faltaCajas   ?? []}
                    onConfirmed={async ({ hasDiff, allDone }) => {
                        const { pedido, sucId, key } = modal;
                        setModal(null);
                        if (allDone) {
                            await handleMarkErp(pedido.id, sucId, key);
                            // Re-fetch items to get accurate con_diferencia count
                            const loaded = await fetchItems(key, pedido.id, sucId);
                            const realHasDiff = hasDiff || (loaded || []).some(r => r.status === 'con_diferencia');
                            if (realHasDiff) await handleReportarDiferencias(pedido.id, sucId);
                            supabase.from('erp_sucursal_map').select('branch_id').eq('es_bodega', true).maybeSingle().then(({ data: b }) => {
                                if (!b?.branch_id) return;
                                const title   = realHasDiff
                                    ? `Problemas en pedido #${pedido.numero} — ${branchName}`
                                    : `Pedido #${pedido.numero} confirmado — ${branchName}`;
                                const message = realHasDiff
                                    ? `${branchName} reporta diferencias en la recepción del pedido #${pedido.numero}. Revisá y marcalo como corregido.`
                                    : `${branchName} confirmó la recepción del pedido #${pedido.numero} sin novedades.`;
                                supabase.from('announcements').insert({ title, message, target_type: 'BRANCH', target_value: [b.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: realHasDiff ? 'HIGH' : 'NORMAL' }).catch(() => {});
                                supabase.functions.invoke('send-push-notification', { body: { title, message, url: '/pedidos', target_type: 'BRANCH', target_value: [b.branch_id] } }).catch(() => {});
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
                open={crearRutaOpen}
                onClose={() => setCrearRutaOpen(false)}
                onCreated={() => { setCrearRutaOpen(false); loadActive(); }}
            />
        </div>
    );
}
