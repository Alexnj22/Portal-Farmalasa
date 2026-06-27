import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { tokenMatch, smartFilter } from '../../utils/searchUtils';
import { supabase } from '../../supabaseClient';
import {
    Loader2, ChevronDown, ChevronRight, CheckCircle2,
    Package, Building2, AlertTriangle,
    Truck, Pause, PackageCheck, PackageX, Play, Home,
    Database, Activity, TrendingDown,
    X, Send, CheckCheck, RotateCcw, Flag, ShieldAlert, UserCircle2,
    Coffee, Users, Clock, ClipboardList, Bell, MessageSquare,
    UserPlus, ScanLine, Inbox, AlertCircle, CheckSquare, FileDown, Box, Zap, Map as MapIcon,
    CalendarClock, Ban, Star, Search,
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
import CrearRutaModal    from './CrearRutaModal';
import RutaMapModal      from './RutaMapModal';
import ProgramarEntregaModal from './ProgramarEntregaModal';
import { ERP_NAMES } from '../../constants/erp';
import LiquidSelect from '../../components/common/LiquidSelect';
import PeriodPicker from '../../components/common/PeriodPicker';
import { printFromPedidoItems, buildPedidoCodigo, getExactPageGroups } from '../../utils/pedidoPrint';

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
const PEDIDO_LABEL = { confirmado: 'Por despachar', enviado: 'En ruta', parcial: 'Con diferencias', completado: 'Completado', anulado: 'Anulado' };

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
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
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
function fmtEntrega(iso) {
    if (!iso) return null;
    const d   = new Date(iso);
    const hoy = new Date();
    const man = new Date(hoy); man.setDate(hoy.getDate() + 1);
    const time = d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (d.toDateString() === hoy.toDateString()) return `Hoy ${time}`;
    if (d.toDateString() === man.toDateString()) return `Mañana ${time}`;
    return d.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
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

// ─── Anular Modal ────────────────────────────────────────────────────────────

function AnularModal({ modal, onCancel, onConfirm, busy }) {
    const [motivo, setMotivo] = useState('');
    const canConfirm = !modal?.requiresReason || motivo.trim().length >= 5;

    return (
        <PedidoModal onClose={onCancel}>
            <PedidoModal.Header>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center shadow-sm shrink-0">
                        <Ban size={20} className="text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 text-[15px]">Anular pedido</h3>
                        <p className="text-[12px] text-slate-600 mt-0.5">#{modal?.numero}</p>
                    </div>
                </div>
            </PedidoModal.Header>

            <PedidoModal.Body className="space-y-4">
                {modal?.requiresReason ? (
                    <>
                        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                            <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-[12px] text-amber-800">
                                Este pedido ya fue iniciado. Se anulará la preparación en curso y todos los ítems pendientes.
                            </p>
                        </div>
                        <div>
                            <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">
                                Motivo de anulación *
                            </label>
                            <textarea
                                value={motivo}
                                onChange={e => setMotivo(e.target.value)}
                                placeholder="Describe el motivo de la anulación…"
                                rows={3}
                                className="w-full text-[13px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-red-400 bg-white resize-none transition-colors text-slate-700"
                            />
                            {motivo.trim().length > 0 && motivo.trim().length < 5 && (
                                <p className="text-[10px] text-red-500 mt-1">Mínimo 5 caracteres.</p>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
                        <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                        <p className="text-[12px] text-red-800">
                            ¿Confirmas que deseas anular el pedido <strong>#{modal?.numero}</strong>?<br />
                            Esta acción no se puede deshacer.
                        </p>
                    </div>
                )}
            </PedidoModal.Body>

            <PedidoModal.Footer>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-[13px] font-medium transition-colors">
                        Cancelar
                    </button>
                    <button
                        disabled={!canConfirm || busy}
                        onClick={() => onConfirm(modal?.requiresReason ? motivo.trim() : null)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 text-[13px] transition-colors disabled:opacity-50 shadow-sm"
                    >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                        Anular pedido
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
            {row.products?.es_antibiotico && <span className="text-[9px] px-1.5 rounded-full bg-red-50 border border-red-200 text-red-500 font-semibold shrink-0">Bajo Receta</span>}
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

const COLS_AGOTAMIENTO = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'enviado',    label: 'Enviado',    align: 'center', render: r => <span className="font-bold tabular-nums text-slate-700">{r.cantidad_asignada}</span> },
    { key: 'falto',      label: 'Faltó',      align: 'center', render: r => {
        const sol = calcSolicitado(r);
        const falto = sol != null ? Math.max(0, sol - (r.cantidad_asignada ?? 0)) : null;
        return falto != null
            ? <span className="font-bold tabular-nums text-orange-600">{falto}</span>
            : <span className="text-slate-400">—</span>;
    }},
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

function sortedPresRegla(presentations) {
    return [...new Map((presentations || []).map(p => [p.factor, p])).values()]
        .filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor);
}
function formatUnitsRegla(units, presentations) {
    const n = Math.round(Number(units));
    if (n === 0) return '0 und';
    const pres = sortedPresRegla(presentations);
    if (!pres.length) return `${n} und`;
    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) { parts.push(`${Math.floor(rem / factor)} ${tipo.trim()}`); rem %= factor; }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n} und`;
}

const COLS_REGLA = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresStock },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'stock_suc',  label: 'Stock sucursal', align: 'center', render: r => {
        const packs  = r.stock_packs_snapshot ?? null;
        const factor = Number(r.factor) || 1;
        const units  = packs != null ? Math.round(packs * factor) : null;
        const txt    = units != null ? formatUnitsRegla(units, r.presentations) : null;
        return (
            <span className={`tabular-nums text-[11px] font-semibold ${(units ?? 0) === 0 ? 'text-rose-500' : 'text-slate-600'}`}>
                {txt ?? '—'}
            </span>
        );
    }},
    { key: 'regla',  label: 'Regla', render: fmtRegla },
    { key: 'motivo', label: 'Motivo', render: r => {
        const factor  = Number(r.factor) || 1;
        const needed  = r.max_qty_snapshot != null && r.stock_packs_snapshot != null
            ? Math.max(0, r.max_qty_snapshot - r.stock_packs_snapshot) : null;
        const needUnd = needed != null ? Math.ceil(needed * factor) : null;
        return (
            <div className="flex flex-col gap-0.5">
                <span className="text-rose-600 text-[10px] font-semibold">Necesidad baja</span>
                <span className="text-slate-400 text-[9px]">
                    {needUnd != null ? `Reponer ${needUnd} und. no alcanza el mín. de despacho` : 'Necesidad < 40% de la unidad mínima de despacho'}
                </span>
                <span className="text-slate-300 text-[9px]">Ajustar MAX o reducir el múltiplo en la regla</span>
            </div>
        );
    }},
];

function ItemSection({ label, count, badgeCls, rows, columns, noteEl }) {
    const [open,        setOpen]        = useState(false);
    const [page,        setPage]        = useState(1);
    const [pageSize,    setPageSize]    = useState(MINI_PAGE);
    const [search,      setSearch]      = useState('');
    const [searchOpen,  setSearchOpen]  = useState(false);
    const searchRef = useRef(null);

    const filteredRows = useMemo(() => {
        if (!search.trim()) return rows;
        const { results } = smartFilter(search, rows, r => [
            r.products?.nombre ?? r.product_name ?? '',
            r.products?.laboratorios?.nombre ?? '',
        ]);
        return results;
    }, [rows, search]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const pageRows   = filteredRows.slice((page - 1) * pageSize, page * pageSize);

    if (!count) return null;

    const openSearch = (e) => {
        e.stopPropagation();
        if (!open) setOpen(true);
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 80);
    };
    const closeSearch = (e) => {
        e?.stopPropagation();
        setSearchOpen(false);
        setSearch('');
        setPage(1);
    };

    return (
        <div className="border-t border-slate-100">
            <div className="flex items-center gap-1 pr-2 hover:bg-slate-50/50 transition-colors">
                <button onClick={() => setOpen(v => !v)} className="flex-1 flex items-center gap-2 px-4 py-2.5 text-left">
                    <span className="text-[11px] font-semibold text-slate-700 flex-1">{label}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${search ? 'bg-blue-50 text-blue-700 border-blue-200' : badgeCls}`}>
                        {search ? `${filteredRows.length}/${count}` : count}
                    </span>
                </button>
                <AnimatePresence mode="wait">
                    {searchOpen ? (
                        <motion.div key="input" initial={{ width: 0, opacity: 0 }} animate={{ width: 160, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden shrink-0">
                            <div className="relative flex items-center">
                                <Search size={10} className="absolute left-2 text-slate-400 pointer-events-none" />
                                <input
                                    ref={searchRef}
                                    value={search}
                                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                                    onKeyDown={e => e.key === 'Escape' && closeSearch()}
                                    placeholder="Buscar…"
                                    className="w-full pl-6 pr-5 py-1 text-[10px] bg-white border border-blue-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-400 text-slate-700 placeholder:text-slate-400 shadow-sm"
                                />
                                <button onClick={closeSearch} className="absolute right-1.5 text-slate-400 hover:text-slate-600">
                                    <X size={9} />
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.button key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={openSearch} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors shrink-0">
                            <Search size={12} />
                        </motion.button>
                    )}
                </AnimatePresence>
                <button onClick={() => setOpen(v => !v)} className="p-1.5 shrink-0">
                    {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
                </button>
            </div>
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
                                        filteredTotal={search ? filteredRows.length : undefined}
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
    return new Date(iso).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Todos los nodos activos/completados en un solo color indigo
const tlDot    = () => 'bg-indigo-500';
const tlLine   = () => 'bg-indigo-300';
const tlBorder = () => 'border-indigo-400';
const tlGlow   = () => 'rgba(99,102,241';

// ruta_entregado se inserta en índice 4; Llegada→5, Finalizado→6, extras→≥7
const TL_STAGE_IDX = { sin_iniciar: 0, preparando: 1, pausado: 1, preparado: 2, transito: 3, contando: 5, erp: 6 };

function PauseBadge({ pause, isPaused, empMap = new Map() }) {
    const mins     = pause ? elapsed(pause.pausado_at, pause.reanudado_at ?? undefined) : null;
    const isActive = isPaused && !pause?.reanudado_at;
    const empName  = (id) => { const e = empMap.get(id); return e ? `${e.first_names} ${e.last_names}`.trim() : null; };
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
                        <div className="text-[8px] text-slate-300">
                            Pausó: <span className="text-white font-semibold">{fmtHM(pause.pausado_at) || '—'}</span>
                            {empName(pause.pausado_por) && <span className="text-slate-400"> · {empName(pause.pausado_por)}</span>}
                        </div>
                        <div className="text-[8px] text-slate-300">
                            Reanudó:{' '}
                            {pause.reanudado_at
                                ? <>
                                    <span className="text-white font-semibold">{fmtHM(pause.reanudado_at)}</span>
                                    {empName(pause.reanudado_por) && <span className="text-slate-400"> · {empName(pause.reanudado_por)}</span>}
                                  </>
                                : <span className="text-amber-300 font-semibold">En curso</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function LifecycleTimeline({ row, stage, creatorEmp, iniciadorEmp, finalizadorEmp, enviadorEmp, llegadaEmp, conteoEmp, reenvioEmp, erpEmp, difsEmp, corrConfEmp, receptionApoyo = [], isBranch = false, empMap = new Map(), pauses = [], rutaStop = null, rutaCondEmp = null }) {
    const hasPause  = (row.min_pausado_total ?? 0) > 0;
    const isPaused  = stage === 'pausado';
    const activeIdx = TL_STAGE_IDX[stage] ?? 0;
    const hasDif    = !!row.diferencias_reportadas_at;

    // Quién entregó: preferir entregado_por lookup, fallback al conductor
    const entregadorEmp = rutaStop?.entregado_por
        ? (empMap.get(rutaStop.entregado_por) ?? rutaCondEmp)
        : rutaCondEmp;
    const nodes = [
        { key: 'confirmado',     label: 'Confirmado', time: row.created_at,           emp: creatorEmp    },
        { key: 'iniciado',       label: 'Inicio',     time: row.iniciado_at,          emp: iniciadorEmp  },
        { key: 'preparado',      label: 'Listo',      time: row.finalizado_at,        emp: finalizadorEmp },
        { key: 'enviado',        label: 'En Ruta',    time: row.enviado_at,           emp: enviadorEmp    },
        { key: 'ruta_entregado', label: 'Entregado',  time: rutaStop?.entregado_at ?? null, emp: entregadorEmp, isRutaNode: true },
        { key: 'llegada',        label: 'Llegada',    time: row.llegada_fisica_at,    emp: llegadaEmp,    apoyo: receptionApoyo },
        { key: 'erp',            label: 'Finalizado', time: row.recibido_erp_at,      emp: erpEmp,        apoyo: receptionApoyo },
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
                const isExtraNode  = idx >= 7;
                // ruta_entregado es "done" cuando tiene timestamp, sin depender de activeIdx
                const isDone       = node.time != null && (isExtraNode || node.isRutaNode || idx < activeIdx);
                const isActive     = !isExtraNode && !node.isRutaNode && idx === activeIdx;
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

                            {/* Time — muestra fecha si es de otro día */}
                            {(() => {
                                const t = node.time ? new Date(node.time) : null;
                                const isToday = t && t.toDateString() === new Date().toDateString();
                                const dateLabel = t && !isToday
                                    ? t.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })
                                    : null;
                                return (
                                    <span className="tabular-nums leading-tight text-center mt-px flex flex-col items-center">
                                        {dateLabel && <span className="text-[9px] text-slate-900 font-bold leading-none mb-0.5">{dateLabel}</span>}
                                        <span className="text-[10px] text-slate-600 whitespace-nowrap">{fmtHM(node.time) || <span className="text-slate-200">——</span>}</span>
                                    </span>
                                );
                            })()}

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
                                                <PauseBadge key={i} pause={p} isPaused={isPaused && i === pauses.length - 1} empMap={empMap} />
                                            ))
                                            : <PauseBadge pause={null} isPaused={isPaused} empMap={empMap} />
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

    const enviados    = allItems.filter(i => i.cantidad_asignada > 0);
    const agotamiento = allItems.filter(i => i.agotamiento);
    const sinStock    = allItems.filter(i => i.sin_stock);
    const porRegla    = allItems.filter(i => i.revision_minmax);
    const total       = allItems.length;

    if (total === 0) return <div className="border-t border-slate-100 py-4 text-center text-[11px] text-slate-400">Sin ítems.</div>;

    return (
        <>
            <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50/60 flex items-center gap-5 flex-wrap">
                <span className="text-[11px] text-slate-500">Solicitados <strong className="text-slate-700">{total}</strong></span>
                <span className="text-[11px] text-slate-500">Enviados <strong className="text-emerald-600">{enviados.length}</strong></span>
                {agotamiento.length > 0 && <span className="text-[11px] text-slate-500">Stock insuficiente <strong className="text-orange-600">{agotamiento.length}</strong></span>}
                {sinStock.length > 0 && <span className="text-[11px] text-slate-500">Sin inventario <strong className="text-amber-600">{sinStock.length}</strong></span>}
                {porRegla.length > 0 && <span className="text-[11px] text-slate-500">Revisar regla <strong className="text-rose-600">{porRegla.length}</strong></span>}
            </div>
            <ItemSection label="Productos enviados" count={enviados.length} badgeCls="bg-emerald-50 text-emerald-700 border-emerald-200" rows={enviados} columns={COLS_ENVIADOS} />
            <ItemSection
                label="Stock insuficiente en bodega" count={agotamiento.length} badgeCls="bg-orange-50 text-orange-700 border-orange-200" rows={agotamiento} columns={COLS_AGOTAMIENTO}
                noteEl={<p className="text-[10px] text-orange-600/80">Bodega tenía stock pero no alcanzó para cubrir la necesidad completa. Se envió lo disponible; el faltante quedará pendiente para el próximo pedido.</p>}
            />
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
                {statusBtn('enviado',    'En ruta')}
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
    const [rutaMapOpen,   setRutaMapOpen]   = useState(null); // ruta obj para RutaMapModal

    // Rutas activas: mapa pedidoId → { ruta, stop, driverOnline }
    const [pedidoRutaMap, setPedidoRutaMap] = useState(new Map());

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

    // ── Cargar rutas activas ──────────────────────────────────────────────────

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
            stats[`act_${row.pedido_id}_${row.erp_sucursal_id}`] = { enviados: 0, sinStock: 0, porRegla: 0, agotamiento: 0 };
        });
        const ids = [...new Set(rows.map(r => r.pedido_id))];
        if (ids.length) {
            const { data: statRows } = await supabase.rpc('get_pedido_item_stats', { p_pedido_ids: ids });
            (statRows ?? []).forEach(s => {
                const k = `act_${s.pedido_id}_${s.erp_sucursal_id}`;
                stats[k] = { enviados: s.enviados, sinStock: s.sin_stock, porRegla: s.por_regla, agotamiento: s.agotamiento ?? 0, pendientes: s.pendientes ?? 0 };
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
                loadActiveRutas(); // rutas/ruta_pedidos pueden no estar en la pub; pedidos sí
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
    }, [loadActive, isBranch, erpSucursalId]); // eslint-disable-line (loadActiveRutas es estable [])

    // ── Rutas activas: mapa pedidoId → { ruta, stop, driverOnline } ──────────
    const loadingRutasRef = useRef(false);
    const loadActiveRutas = useCallback(async () => {
        if (loadingRutasRef.current) return;
        loadingRutasRef.current = true;
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const { data } = await supabase.from('rutas')
            .select(`id, numero, conductor_id, conductor_nombre, status, salida_at, vuelta_base_at,
                     ruta_pedidos(id, pedido_id, erp_sucursal_id, orden_entrega, entregado_at, entregado_por)`)
            .or(`status.in.(pendiente,en_ruta),and(status.eq.completada,created_at.gte.${todayStart.toISOString()})`)
            .order('created_at', { ascending: false });
        if (!data?.length) { setPedidoRutaMap(new Map()); loadingRutasRef.current = false; return; }

        const rutaIds = data.map(r => r.id);
        const allStops = data.flatMap(r => r.ruta_pedidos ?? []);
        const sucIds   = [...new Set(allStops.map(s => s.erp_sucursal_id))];

        const [{ data: locs }, { data: sucData }] = await Promise.all([
            supabase.from('ruta_locations').select('ruta_id, updated_at').in('ruta_id', rutaIds),
            sucIds.length
                ? supabase.from('erp_sucursal_map').select('erp_sucursal_id, branch:branches!inner(name)').in('erp_sucursal_id', sucIds)
                : Promise.resolve({ data: [] }),
        ]);

        const onlineMap  = Object.fromEntries((locs ?? []).map(l => {
            const ageMin = (Date.now() - new Date(l.updated_at).getTime()) / 60000;
            return [l.ruta_id, ageMin < 3];
        }));
        const sucNameMap = Object.fromEntries((sucData ?? []).map(s => [s.erp_sucursal_id, s.branch?.name]));

        const map = new Map();
        data.forEach(ruta => {
            const enriched = (ruta.ruta_pedidos ?? []).map(s => ({
                ...s, suc_name: sucNameMap[s.erp_sucursal_id] ?? `Suc. ${s.erp_sucursal_id}`,
            }));
            enriched.forEach(stop => {
                map.set(stop.pedido_id, { ruta: { ...ruta, ruta_pedidos: enriched }, stop, driverOnline: onlineMap[ruta.id] ?? false });
            });
        });
        setPedidoRutaMap(map);
        loadingRutasRef.current = false;
    }, []);

    useEffect(() => { loadActiveRutas(); }, [loadActiveRutas]);
    useEffect(() => {
        const ch = supabase.channel('pedido-rutas-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rutas' }, () => { loadActiveRutas(); loadActive(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ruta_pedidos' }, () => { loadActiveRutas(); loadActive(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ruta_locations' }, loadActiveRutas)
            .subscribe();
        return () => supabase.removeChannel(ch);
    }, [loadActiveRutas, loadActive]); // eslint-disable-line

    // ── GPS background persistente — conductor con ruta en_ruta ──────────────
    // Corre independiente del RutaMapModal: pantalla apagada o modal cerrado
    const bgGpsWatchRef    = useRef(null);
    const bgGpsIntervalRef = useRef(null);
    const bgGpsPosRef      = useRef(null);
    useEffect(() => {
        // Solo activo si el usuario es conductor de una ruta en_ruta hoy
        const entry = [...pedidoRutaMap.values()]
            .find(v => v.ruta.conductor_id && String(v.ruta.conductor_id) === String(user?.id) && v.ruta.status === 'en_ruta');

        if (!entry) {
            // Limpiar si ya no hay ruta activa
            if (bgGpsWatchRef.current !== null) {
                navigator.geolocation?.clearWatch(bgGpsWatchRef.current);
                bgGpsWatchRef.current = null;
            }
            if (bgGpsIntervalRef.current) { clearInterval(bgGpsIntervalRef.current); bgGpsIntervalRef.current = null; }
            return;
        }

        const rutaId = entry.ruta.id;
        const isNative = !!(window.Capacitor?.isNativePlatform?.());

        const startBg = async () => {
            try {
                if (isNative) {
                    // eslint-disable-next-line
                    const { BackgroundGeolocation } = await import(/* @vite-ignore */ '@capacitor-community/background-geolocation');
                    bgGpsWatchRef.current = await BackgroundGeolocation.addWatcher(
                        { backgroundTitle: 'Ruta activa', backgroundMessage: 'Rastreando tu posición.', requestPermissions: true, stale: false, distanceFilter: 20 },
                        (loc) => { if (loc) bgGpsPosRef.current = { lat: loc.latitude, lng: loc.longitude }; }
                    );
                } else if (navigator.geolocation) {
                    bgGpsWatchRef.current = navigator.geolocation.watchPosition(
                        (p) => { bgGpsPosRef.current = { lat: p.coords.latitude, lng: p.coords.longitude }; },
                        (err) => console.warn('[BG-GPS]', err.code),
                        { enableHighAccuracy: true, maximumAge: 10000 },
                    );
                }
                // Escribir a DB cada 30s
                bgGpsIntervalRef.current = setInterval(async () => {
                    const pos = bgGpsPosRef.current;
                    if (!pos) return;
                    await supabase.from('ruta_locations')
                        .upsert({ ruta_id: rutaId, lat: pos.lat, lng: pos.lng, updated_at: new Date().toISOString() }, { onConflict: 'ruta_id' })
                        .then(() => {}, () => {});
                }, 30_000);
            } catch (e) { console.warn('[BG-GPS] start error:', e); }
        };

        startBg();
        return () => {
            if (bgGpsWatchRef.current !== null) {
                if (isNative) {
                    // eslint-disable-next-line
                    import(/* @vite-ignore */ '@capacitor-community/background-geolocation')
                        .then(({ BackgroundGeolocation }) => BackgroundGeolocation.removeWatcher({ id: bgGpsWatchRef.current }))
                        .catch(() => {});
                } else {
                    navigator.geolocation?.clearWatch(bgGpsWatchRef.current);
                }
                bgGpsWatchRef.current = null;
            }
            if (bgGpsIntervalRef.current) { clearInterval(bgGpsIntervalRef.current); bgGpsIntervalRef.current = null; }
        };
    }, [pedidoRutaMap, user?.id]); // eslint-disable-line

    // ── Fetch items ───────────────────────────────────────────────────────────

    const fetchItems = useCallback(async (key, pedidoId, sucId) => {
        if (!pedidoId) return;
        setLoadingItems(true);
        const sucFilter = sucId ?? (isBranch && erpSucursalId ? erpSucursalId : null);

        const ITEMS_SELECT = `
            id, erp_sucursal_id, erp_product_id, cantidad_asignada, cantidad_recibida,
            status, nota_diferencia, error_tipo, received_at, received_by, lotes_asignados, agotamiento,
            sin_stock, revision_minmax, falta_caja, caja_especial,
            factor, dispatch_tipo, dispatch_factor,
            max_qty_snapshot, stock_packs_snapshot,
            resolucion_status, resolucion_tipo, resolucion_nota,
            resuelto_por, resuelto_at, confirmado_suc_por, confirmado_suc_at,
            rechazado_por, rechazado_at, nota_rechazo,
            products ( nombre, es_antibiotico, laboratorios ( nombre ), product_precios ( factor, activo, presentaciones!id_presentacion ( tipo ) ), dispatch_rules ( dispatch_label ) ),
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
        const resolved = allItemRows.map(row => ({
            ...row,
            presentations: (row.products?.product_precios || [])
                .filter(pp => pp.activo !== false)
                .map(pp => ({ factor: pp.factor, tipo: pp.presentaciones?.tipo }))
                .filter(p => p.tipo && p.factor >= 1),
            tiene_dispatch_label: !!(row.products?.dispatch_rules?.[0]?.dispatch_label),
        }));
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
            const emp    = empMap.get(user?.id);
            const entry  = { programada_at: newIso, registrado_at: new Date().toISOString(), por: user?.id ?? null, nombre: emp?.name ?? null };
            const newHist = [...(historial ?? []), entry];
            const { error } = await supabase.from('pedido_sucursal_status')
                .update({ entrega_programada_at: newIso, entrega_programada_historial: newHist })
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);
            if (error) throw error;
            useStaff.getState().appendAuditLog('PEDIDO_ENTREGA_PROGRAMADA', pedidoId, { sucursal_id: sucId, entrega_at: newIso });
            setProgramarModal(null);
            await loadActive();
        } catch (e) { console.error(e); } finally { setSavingProgramar(false); }
    }, [programarModal, user, empMap, loadActive]);

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

    const handleAnular = useCallback(async (motivo = null) => {
        if (!anularModal) return;
        setBusyAnular(true);
        try {
            const { error } = await supabase.rpc('anular_pedido', {
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
            useToastStore.getState().showToast('Error al anular', e.message ?? 'Ocurrió un error.', 'error');
        } finally {
            setBusyAnular(false);
        }
    }, [anularModal, user, loadActive]);

    // ── Reception ─────────────────────────────────────────────────────────────

    const openFinalizarModal = useCallback(async (pedidoId, sucId, numero, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
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
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
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
                } else if (Object.keys(cajaMapDb).length > 0) {
                    // pagina_items vacío (pedido legacy) — recomputar con el mismo método del PDF y persistir
                    const pageGroups = await getExactPageGroups(sucId, rows);
                    const recomputed = {};
                    pageGroups.forEach((pg, idx) => { recomputed[String(idx + 1)] = pg.ids; });
                    await supabase.from('pedido_sucursal_status')
                        .update({ pagina_items: recomputed })
                        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId);
                    const missingPages = cajasFaltantes.flatMap(n => cajaMapDb[String(n)] ?? []);
                    missingIds = missingPages.flatMap(p => recomputed[String(p)] ?? []);
                } else {
                    // Sin caja_map ni pagina_items — conservador: bloquear todos los ítems pendientes
                    const { data: allPending } = await supabase
                        .from('pedido_items').select('id')
                        .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).eq('status', 'pendiente');
                    missingIds = (allPending || []).map(r => r.id);
                }
                if (missingIds.length > 0) {
                    await supabase.from('pedido_items').update({ falta_caja: true }).in('id', missingIds);
                }
            }

            // 2b. Marcar items de Electrolit faltantes como falta_caja: true
            if ((electrolitFaltantes ?? 0) > 0 && rows.length > 0) {
                const faltaElecItems = rows
                    .filter(r => (r.products?.nombre ?? '').toLowerCase().includes('electrolit') && !r.falta_caja && r.status !== 'recibido')
                    .slice(0, electrolitFaltantes);
                if (faltaElecItems.length > 0) {
                    await supabase.from('pedido_items').update({ falta_caja: true }).in('id', faltaElecItems.map(r => r.id));
                }
            }

            // 2c. Marcar items de cajas especiales faltantes como falta_caja: true
            if (especialesLlegadas && Object.values(especialesLlegadas).some(v => v === 'faltante') && rows.length > 0) {
                const faltaLabels = new Set(Object.entries(especialesLlegadas).filter(([, v]) => v === 'faltante').map(([k]) => k));
                let ec = 1;
                const faltaIds = new Set();
                [...rows]
                    .filter(r => r.caja_especial && (r.cantidad_asignada ?? 0) > 0 && r.status !== 'recibido')
                    .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
                    .forEach(r => {
                        for (let i = 0; i < (r.cantidad_asignada ?? 1); i++) {
                            if (faltaLabels.has(`E${ec}`)) faltaIds.add(r.id);
                            ec++;
                        }
                    });
                if (faltaIds.size > 0) {
                    await supabase.from('pedido_items').update({ falta_caja: true }).in('id', [...faltaIds]);
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

    const handleReenviarCaja = useCallback(async (pedidoId, sucId, numero, cajasFaltantes, electrolitsFaltantes = 0, especialesFaltantes = []) => {
        setBusyAction('reenvio');
        try {
            const now = new Date().toISOString();
            // Leer historial actual para calcular ciclo
            const { data: pss } = await supabase.from('pedido_sucursal_status')
                .select('reenvios_historial')
                .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId).maybeSingle();
            const historial = pss?.reenvios_historial ?? [];
            const ciclo     = historial.length + 1;
            const nuevoCiclo = { ciclo, cajas: cajasFaltantes, electrolits: electrolitsFaltantes, especiales: especialesFaltantes, sent_at: now, sent_by: user?.id ?? null, arrived_at: null, arrived_tipo: null, cajas_ok: [], cajas_danadas: [], cajas_aun_faltantes: [] };

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
                setReenvioLlegadaModal({ pedidoId, sucId, key, ciclo: 1, cajasCiclo: faltaCajasLegacy, electrolitCount: 0, especialesList: [], historial: [], cajaMap });
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
                .select('caja_map, pagina_items, cajas_recibidas, cajas_danadas')
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
            }

            // Limpiar falta_caja en electrolits si llegaron en este reenvío
            if (electrolitCount > 0 && electrolitOk) {
                const { data: faltaElec } = await supabase.from('pedido_items')
                    .select('id, products(nombre)')
                    .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
                    .eq('falta_caja', true).eq('status', 'pendiente');
                const elecIds = (faltaElec || []).filter(r => (r.products?.nombre ?? '').toLowerCase().includes('electrolit')).map(r => r.id);
                if (elecIds.length > 0) await supabase.from('pedido_items').update({ falta_caja: false }).in('id', elecIds);
            }

            // Limpiar falta_caja en especiales que llegaron en este reenvío
            const espLlegaron = (especialesList ?? []).filter(l => !especialesAun.includes(l));
            if (espLlegaron.length > 0) {
                // Los especiales que llegaron: limpiar falta_caja en sus items correspondientes
                const { data: faltaEsp } = await supabase.from('pedido_items')
                    .select('id')
                    .eq('pedido_id', pedidoId).eq('erp_sucursal_id', sucId)
                    .eq('falta_caja', true).eq('status', 'pendiente').eq('caja_especial', true);
                // Calcular cuáles items corresponden a las especiales que llegaron
                // Por simplicidad limpiar todos los especiales con falta si todos llegaron; si aún hay faltantes dejar falta_caja
                if (especialesAun.length === 0 && (faltaEsp ?? []).length > 0) {
                    await supabase.from('pedido_items').update({ falta_caja: false }).in('id', faltaEsp.map(r => r.id));
                }
            }

            // Notificar bodega si aún hay pendientes de reenvío
            const hayAunPendiente = hasFalta || !electrolitOk || especialesAun.length > 0;
            if (hayAunPendiente) {
                supabase.from('erp_sucursal_map').select('branch_id').eq('erp_sucursal_id', sucId).maybeSingle().then(({ data: m }) => {
                    if (!m?.branch_id) return;
                    const partes = [];
                    if (hasFalta) partes.push(`Cajas: ${cajasFaltantes.map(n => `#${n}`).join(', ')}`);
                    if (!electrolitOk) partes.push('Electrolit aún pendiente');
                    if (especialesAun.length > 0) partes.push(`Especiales: ${especialesAun.join(', ')}`);
                    supabase.from('announcements').insert({ title: `Aún hay pendientes — reenvío ${ciclo}`, message: `${branchName} reporta que aún no llegó: ${partes.join(' | ')}. Se requiere otro envío.`, target_type: 'BRANCH', target_value: [m.branch_id], read_by: [], is_archived: false, created_by: user?.id ?? null, priority: 'HIGH' }).catch(() => {});
                }).catch(() => {});
            }

            await loadActive();
            const freshItems = await fetchItems(key, pedidoId, sucId);

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
                    cajasRecibidas: pss?.cajas_recibidas ?? [],
                    faltaCajas:     hasFalta ? cajasFaltantes : [],
                    hasFaltaItems:  hasFaltaItemsNow,
                });
            }
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [reenvioLlegadaModal, user, branchName, loadActive, fetchItems, activeRows]);

    const handleEntregarStop = useCallback(async (stopId, rutaId, sucId) => {
        try {
            const { error } = await supabase.from('ruta_pedidos')
                .update({ entregado_at: new Date().toISOString(), entregado_por: user?.id })
                .eq('id', stopId);
            if (error) throw error;
            useStaff.getState().appendAuditLog('RUTA_PARADA_ENTREGADA', stopId, { sucursal_id: sucId });
            const { data: mapa } = await supabase.from('erp_sucursal_map')
                .select('branch_id').eq('erp_sucursal_id', sucId).maybeSingle();
            if (mapa?.branch_id) {
                supabase.from('announcements').insert({
                    title: 'Conductor llegó a tu sucursal',
                    message: 'Confirma la recepción de tu pedido.',
                    target_type: 'BRANCH', target_value: [mapa.branch_id],
                    read_by: [], is_archived: false, created_by: user?.id, priority: 'HIGH',
                }).then(() => {}, () => {});
            }
            loadActiveRutas();
        } catch (e) { console.error(e); }
    }, [user, loadActiveRutas]);

    const handleMarkErp = useCallback(async (pedidoId, sucId, key) => {
        if (busyAction) { useToastStore.getState().showToast('Espera', 'Hay una operación en curso, intenta de nuevo.', 'info'); return; }
        setBusyAction('erp');
        try {
            await supabase.rpc('update_pedido_sucursal_lifecycle', { p_pedido_id: pedidoId, p_sucursal_id: sucId, p_stage: 'recibir_erp', p_user_id: user?.id ?? null });
            useStaff.getState().appendAuditLog('PEDIDO_LIFECYCLE_RECIBIR_ERP', pedidoId, { sucursal_id: sucId });
            setErpStatus(prev => ({ ...prev, [key]: true }));
            await loadActive();
        } catch (e) { console.error(e); } finally { setBusyAction(null); }
    }, [busyAction, user, loadActive]);

    const openModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = await fetchItems(key, pedidoId, sucId);
        const rows = (loaded || []).filter(r => r.status === 'pendiente' && r.cantidad_asignada > 0 && !r.falta_caja);
        if (!rows.length) return;
        const hasFaltaItems = (loaded || []).some(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
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

        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada, cajaMap, paginaItems, cajasRecibidas, faltaCajas, hasFaltaItems });
    }, [fetchItems, activeRows]);

    const openReenvioModal = useCallback(async (pedidoId, numero, codigo, sucId, key) => {
        const loaded = await fetchItems(key, pedidoId, sucId);
        const rows = (loaded || []).filter(r => r.falta_caja && r.status === 'pendiente' && r.cantidad_asignada > 0);
        if (!rows.length) return;
        setModal({ pedido: { id: pedidoId, numero, codigo }, sucId, key, rows, cajaDanada: [] });
    }, [fetchItems]);

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

        if (filterStatus === 'completado') {
            rows = rows.filter(r => r.pedido_status === 'completado');
        } else if (filterStatus === 'observacion') {
            rows = rows.filter(r => hasObservacion(r) && r.pedido_status !== 'completado');
        } else if (filterStatus !== 'all') {
            rows = rows.filter(r => r.pedido_status === filterStatus);
        } else {
            // Ocultar completados sin problemas; mantener los que tienen diferencias/observación
            rows = rows.filter(r => r.pedido_status !== 'completado' || hasObservacion(r));
        }

        if (filterDate) {
            const [desde, hasta] = filterDate.split('|');
            rows = rows.filter(r => {
                const d = r.created_at?.slice(0, 10);
                return (!desde || d >= desde) && (!hasta || d <= hasta);
            });
        }
        if (searchLower) rows = rows.filter(r => String(r.numero).includes(searchLower) || tokenMatch(searchLower, r.notes));
        const uid = String(user?.id ?? '');
        return [...rows].sort((a, b) => {
            // 1. Mío primero — lo inicié o lo creé yo
            const mineA = uid && (String(a.iniciado_por) === uid || String(a.created_by) === uid);
            const mineB = uid && (String(b.iniciado_por) === uid || String(b.created_by) === uid);
            if (mineA !== mineB) return mineA ? -1 : 1;
            // 2. Stage
            const stageA = getBranchStage(a, a.pedido_status);
            const stageB = getBranchStage(b, b.pedido_status);
            const baseA = STAGE_ORDER[stageA] ?? 5;
            const baseB = STAGE_ORDER[stageB] ?? 5;
            const sa = (hasObservacion(a) && baseA > 0 && baseA < 7) ? 6 : baseA;
            const sb = (hasObservacion(b) && baseB > 0 && baseB < 7) ? 6 : baseB;
            // 3. Fecha más reciente
            return sa !== sb ? sa - sb : new Date(b.created_at) - new Date(a.created_at);
        });
    }, [activeRows, filterSuc, filterStatus, filterDate, searchLower, hasObservacion, user]); // eslint-disable-line

    const sucursalCounts = useMemo(() => {
        const [desde, hasta] = (filterDate ?? '').split('|');
        // branch: solo muestra su propia sucursal en las cards de stats
        const baseRows = (isBranch && erpSucursalId)
            ? activeRows.filter(r => r.erp_sucursal_id === erpSucursalId)
            : activeRows;
        return ERP_ORDER.map(id => {
            const rows = baseRows.filter(r => {
                if (r.erp_sucursal_id !== id) return false;
                const d = r.created_at?.slice(0, 10);
                return (!desde || d >= desde) && (!hasta || d <= hasta);
            });
            return { id, name: ERP_NAMES[id] ?? `Suc. ${id}`, total: rows.length };
        }).filter(s => s.total > 0);
    }, [activeRows, filterDate, isBranch, erpSucursalId]); // eslint-disable-line

    // Rutas únicas derivadas del pedidoRutaMap (para el header de grupo)
    const uniqueActiveRutas = useMemo(() => {
        const seen = new Map();
        pedidoRutaMap.forEach(({ ruta, driverOnline }) => {
            if (!seen.has(ruta.id)) seen.set(ruta.id, { ...ruta, _driverOnline: driverOnline });
        });
        return [...seen.values()];
    }, [pedidoRutaMap]);

    // Agrupa filteredRows: rutas primero (con sus rows hijas), luego normales
    const renderGroups = useMemo(() => {
        const groups = [];
        const addedRutas = new Set();
        const normalRows = [];
        for (const row of filteredRows) {
            const ri = pedidoRutaMap.get(row.pedido_id);
            if (ri) {
                if (!addedRutas.has(ri.ruta.id)) {
                    addedRutas.add(ri.ruta.id);
                    const rutaRows = filteredRows.filter(r => pedidoRutaMap.get(r.pedido_id)?.ruta.id === ri.ruta.id);
                    groups.push({ isRuta: true, ruta: ri.ruta, driverOnline: ri.driverOnline, rows: rutaRows });
                }
            } else {
                normalRows.push(row);
            }
        }
        if (normalRows.length) groups.push({ isRuta: false, ruta: null, rows: normalRows });
        // Ruta donde soy conductor va al tope
        const uid = String(user?.id ?? '');
        groups.sort((a, b) => {
            if (!a.isRuta || !b.isRuta) return 0;
            const aMe = uid && String(a.ruta?.conductor_id) === uid;
            const bMe = uid && String(b.ruta?.conductor_id) === uid;
            return aMe === bMe ? 0 : aMe ? -1 : 1;
        });
        return groups;
    }, [filteredRows, pedidoRutaMap, user]);

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

                            const canFinalizar = canActuar && !isBranch && stage === 'preparando';

                            const canApoyo = !isBranch && ['sin_iniciar','preparando','pausado'].includes(stage);

                            const canAnular = canActuar && !isBranch
                                && row.pedido_status === 'confirmado'
                                && !(pedidoStageMap.get(row.pedido_id)?.anyFinalized);

                            const isDone     = row.pedido_status === 'completado' || row.pedido_status === 'parcial';
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
                                        {isExp ? <ChevronDown size={13} className="text-slate-400 shrink-0" /> : <ChevronRight size={13} className="text-slate-400 shrink-0" />}
                                    </div>
                                    {row.notes && <p className="px-3 pb-1.5 text-[11px] text-slate-600 italic">{row.notes}</p>}

                                    {/* Stats pills */}
                                    {cardStats[cardKey] && (
                                        <div className="flex items-center gap-1 px-3 pb-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                                                {cardStats[cardKey].enviados} enviados
                                            </span>
                                            {(cardStats[cardKey].agotamiento ?? 0) > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200">
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
                                            {canActuar && !isBranch && stage === 'preparado' && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); setProgramarModal({ pedidoId: row.pedido_id, sucId: row.erp_sucursal_id, numero: row.numero, currentAt: row.entrega_programada_at ?? null, historial: row.entrega_programada_historial ?? [] }); }}
                                                    className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl active:scale-95 transition-all ${row.entrega_programada_at ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'}`}
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
                                                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all shadow-sm">
                                                        <CheckCircle2 size={10} />Entregué
                                                    </button>
                                                );
                                            })()}
                                            {canIniciar      && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'iniciar', null, row.numero)}   disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-blue-500    text-white hover:bg-blue-600    active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Play     size={10} fill="currentColor" />Iniciar</>}</button>}
                                            {canPausar       && <button onClick={() => openPauseModal(row.pedido_id, row.erp_sucursal_id)}               disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-amber-400   text-white hover:bg-amber-500   active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><Pause    size={10} fill="currentColor" />Pausar</>}</button>}
                                            {canFinalizar    && <button onClick={() => openFinalizarModal(row.pedido_id, row.erp_sucursal_id, row.numero, cardKey)} disabled={isLCBusy || busyAction === `finalizar_load_${cardKey}`} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-violet-500  text-white hover:bg-violet-600  active:scale-95 transition-all disabled:opacity-50 shadow-sm">{(isLCBusy || busyAction === `finalizar_load_${cardKey}`) ? <Loader2 size={11} className="animate-spin" /> : <><Flag size={10} />Finalizar</>}</button>}
                                            {canReanudar     && <button onClick={() => handleLifecycle(row.pedido_id, row.erp_sucursal_id, 'reanudar')}  disabled={isLCBusy}    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">{isLCBusy ? <Loader2 size={11} className="animate-spin" /> : <><RotateCcw size={10} />Reanudar</>}</button>}
                                            {canAnular && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); const st = pedidoStageMap.get(row.pedido_id) ?? {}; setAnularModal({ pedidoId: row.pedido_id, numero: row.numero, requiresReason: !!(st.anyActive) }); }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-red-100 text-red-600 hover:bg-red-500 hover:text-white border border-red-200 hover:border-red-500 active:scale-95 transition-all shadow-sm"
                                                >
                                                    <Ban size={10} />Anular
                                                </button>
                                            )}
                                            {canMarcarEnRuta && <button onClick={() => setCrearRutaOpen(true)} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 transition-all shadow-sm"><Truck size={10} />Crear Ruta</button>}
                                            {(() => {
                                                const hasElecFaltantes = (row.electrolit_faltantes ?? 0) > 0 && row.electrolit_ok === false;
                                                const hasEspFaltantes  = Object.values(row.cajas_especiales_llegadas ?? {}).some(v => v === 'faltante');
                                                const hasPendingFalta  = (row.falta_cajas ?? []).length > 0 || hasElecFaltantes || hasEspFaltantes;
                                                const reenvioEnCamino  = (row.reenvios_historial ?? []).some(c => c.sent_at && !c.arrived_at);
                                                if (!canActuar || isBranch || !hasPendingFalta || reenvioEnCamino) return null;
                                                const espFaltList = Object.entries(row.cajas_especiales_llegadas ?? {}).filter(([, v]) => v === 'faltante').map(([k]) => k);
                                                return (
                                                    <button onClick={() => handleReenviarCaja(row.pedido_id, row.erp_sucursal_id, row.numero, row.falta_cajas ?? [], hasElecFaltantes ? (row.electrolit_faltantes ?? 0) : 0, espFaltList)} disabled={busyAction === 'reenvio'} className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-rose-500 text-white hover:bg-rose-600 active:scale-95 transition-all disabled:opacity-50 shadow-sm">
                                                        {busyAction === 'reenvio' ? <Loader2 size={10} className="animate-spin" /> : <><Truck size={10} />Reenviar caja</>}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    </div>

                                    {/* Badge de entregado (solo cuando ya fue confirmado) */}
                                    {pedidoRutaMap.has(row.pedido_id) && !!pedidoRutaMap.get(row.pedido_id)?.stop?.entregado_at && (
                                        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-emerald-100 bg-emerald-50/70" onClick={e => e.stopPropagation()}>
                                            <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                            <span className="text-[10px] font-bold text-emerald-700">Entregado en sucursal</span>
                                            <span className="text-[10px] text-emerald-500 tabular-nums">
                                                · {new Date(pedidoRutaMap.get(row.pedido_id).stop.entregado_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                            </span>
                                        </div>
                                    )}

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
                                                <span className="text-[10px] text-slate-400 tabular-nums">{entregadas}/{total} entregas</span>
                                            </div>
                                        </div>
                                        {/* Acciones */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isConductorRuta && ruta.status === 'pendiente' && (
                                                <button
                                                    onClick={async () => {
                                                        await supabase.from('rutas').update({ status: 'en_ruta', salida_at: new Date().toISOString() }).eq('id', ruta.id);
                                                        useStaff.getState().appendAuditLog('RUTA_INICIADA', ruta.id, {});
                                                        loadActiveRutas();
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
                                                >
                                                    <Play size={9} fill="currentColor" />Iniciar
                                                </button>
                                            )}
                                            {isConductorRuta && ruta.status === 'en_ruta' && entregadas === total && total > 0 && (
                                                <button
                                                    onClick={async () => {
                                                        await supabase.from('rutas').update({ status: 'completada', vuelta_base_at: new Date().toISOString() }).eq('id', ruta.id);
                                                        useStaff.getState().appendAuditLog('RUTA_COMPLETADA', ruta.id, {});
                                                        loadActiveRutas(); loadActive();
                                                    }}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-700 text-white hover:bg-slate-800 active:scale-95 transition-all shadow-sm"
                                                >
                                                    <Home size={9} />Base
                                                </button>
                                            )}
                                            {!isCompletada && (
                                                <button
                                                    onClick={() => setRutaMapOpen(ruta)}
                                                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 active:scale-95 transition-all"
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
        </div>
    );
}
