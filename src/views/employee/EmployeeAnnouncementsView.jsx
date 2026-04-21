import React, { useMemo, useState, memo, useRef, useCallback, useEffect } from 'react';
import { Bell, Globe, Building2, User, CheckCircle2, Flame, Clock, Search, X, ChevronLeft, ChevronRight, RefreshCw, Palmtree, FileText, DollarSign, FileCheck, Stethoscope, CalendarDays, ArrowLeftRight, Sparkles, ChevronsRight, Pencil } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import GlassViewLayout from '../../components/GlassViewLayout';

const TABS = [
    { key: 'UNREAD', label: 'Sin Leer' },
    { key: 'READ',   label: 'Leídos'   },
];

const REQUEST_DETAIL_ICONS = {
    VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw,
    ADVANCE: DollarSign, CERTIFICATE: FileCheck, DISABILITY: Stethoscope,
};

const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'short', day: '2-digit', month: 'short' }) : null;

const AnnouncementCard = memo(({ ann, userId, onRead }) => {
    const isRead = (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(userId)
    );
    // True if this user read a previous version before the last edit
    const wasReadBefore = !!ann.editedAt && (ann.prevReadBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(userId)
    );

    const isUrgent = ann.priority === 'URGENT';
    const meta = ann.metadata || null;

    const badgeEl = ann.targetType === 'GLOBAL'
        ? <span className="flex items-center gap-1.5 text-[#007AFF] bg-[#007AFF]/10 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-[#007AFF]/20"><Globe size={11} strokeWidth={2} /> Global</span>
        : ann.targetType === 'BRANCH'
        ? <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-emerald-200/50"><Building2 size={11} strokeWidth={2} /> Sucursal</span>
        : <span className="flex items-center gap-1.5 text-orange-600 bg-orange-50 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border border-orange-200/50"><User size={11} strokeWidth={2} /> Personal</span>;

    return (
        <div
            className={`p-6 rounded-[2.5rem] border flex flex-col gap-4 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu cursor-pointer hover:-translate-y-1 ${
                isUrgent && !isRead
                    ? 'border-red-300 shadow-[0_8px_30px_rgba(239,68,68,0.12)] hover:shadow-[0_12px_40px_rgba(239,68,68,0.2)] bg-white/90 backdrop-blur-xl'
                    : isUrgent && isRead
                    ? 'border-red-200 shadow-sm hover:shadow-md bg-white/80 backdrop-blur-xl'
                    : isRead
                    ? 'border-slate-200/70 shadow-sm hover:shadow-md bg-white/80 backdrop-blur-xl'
                    : 'border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] bg-white/60 backdrop-blur-2xl'
            }`}
            onClick={() => { if (!isRead) onRead(ann.id); }}
        >
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRead ? 'bg-slate-300' : isUrgent ? 'bg-red-500' : 'bg-[#007AFF]'}`} />
                {isUrgent && (
                    <span className={`flex items-center gap-1 text-white bg-red-500 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest shadow-sm shadow-red-500/30 ${!isRead ? 'animate-pulse' : ''}`}>
                        <Flame size={11} strokeWidth={2.5} /> Urgente
                    </span>
                )}
                {wasReadBefore && (
                    <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest">
                        <Pencil size={10} strokeWidth={2.5} /> Actualización
                    </span>
                )}
                {badgeEl}
            </div>

            {/* Title + message */}
            <div>
                <h4 className={`font-black text-[16px] leading-tight mb-1.5 tracking-tight ${isRead ? 'text-slate-600' : 'text-slate-800'}`}>
                    {ann.title}
                </h4>
                <p className={`text-[13px] leading-relaxed font-medium whitespace-pre-wrap ${isRead ? 'text-slate-500' : 'text-slate-600'}`}>
                    {ann.message}
                </p>
            </div>

            {/* Detalle del metadata según tipo de solicitud */}
            {meta?.requestType && (
                <div className={`rounded-2xl border p-3 space-y-2 ${
                    meta.status === 'APPROVED' ? 'bg-emerald-50/60 border-emerald-200/60' : 'bg-red-50/60 border-red-200/60'
                }`}>
                    {/* Cambio de turno */}
                    {meta.requestType === 'SHIFT_CHANGE' && (
                        <>
                            {meta.targetEmployeeName && (
                                <div className="flex items-center gap-2">
                                    <ArrowLeftRight size={12} className="text-cyan-500 flex-shrink-0" strokeWidth={2.5} />
                                    <span className="text-[12px] font-black text-slate-700">Con: {meta.targetEmployeeName}</span>
                                </div>
                            )}
                            {meta.date && (
                                <div className="flex items-center gap-2">
                                    <CalendarDays size={12} className="text-slate-400 flex-shrink-0" strokeWidth={2} />
                                    <span className="text-[12px] font-bold text-slate-600">{fmtDate(meta.date)}</span>
                                </div>
                            )}
                            {(meta.myShift || meta.targetShift) && (
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                    <div className="bg-white/70 border border-slate-100 rounded-xl p-2">
                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Tu turno</p>
                                        <p className="text-[11px] font-black text-slate-700">{meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}</p>
                                    </div>
                                    <div className="bg-cyan-50 border border-cyan-100 rounded-xl p-2">
                                        <p className="text-[8px] font-black text-cyan-600 uppercase tracking-widest mb-0.5">Turno de {meta.targetEmployeeName?.split(' ')[0] || 'compañero'}</p>
                                        <p className="text-[11px] font-black text-slate-700">{meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}</p>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Vacaciones */}
                    {meta.requestType === 'VACATION' && meta.startDate && (
                        <div className="flex items-center gap-2">
                            <CalendarDays size={12} className="text-amber-500 flex-shrink-0" strokeWidth={2} />
                            <span className="text-[12px] font-bold text-slate-700">
                                {fmtDate(meta.startDate)}
                                {meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                            </span>
                        </div>
                    )}

                    {/* Permiso */}
                    {meta.requestType === 'PERMIT' && meta.permissionDates?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {meta.permissionDates.map(d => (
                                <span key={d} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 border border-purple-200 text-purple-700">
                                    {fmtDate(d)}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Incapacidad */}
                    {meta.requestType === 'DISABILITY' && meta.startDate && (
                        <div className="flex items-center gap-2">
                            <CalendarDays size={12} className="text-red-400 flex-shrink-0" strokeWidth={2} />
                            <span className="text-[12px] font-bold text-slate-700">
                                {fmtDate(meta.startDate)}
                                {meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                                {meta.days && <span className="text-slate-500 ml-1">({meta.days} días)</span>}
                            </span>
                        </div>
                    )}

                    {/* Anticipo */}
                    {meta.requestType === 'ADVANCE' && meta.amount && (
                        <div className="flex items-center gap-2">
                            <DollarSign size={12} className="text-emerald-500 flex-shrink-0" strokeWidth={2} />
                            <span className="text-[12px] font-bold text-slate-700">${Number(meta.amount).toLocaleString('es-VE')}</span>
                        </div>
                    )}

                    {/* Constancia */}
                    {meta.requestType === 'CERTIFICATE' && meta.certificateType && (
                        <div className="flex items-center gap-2">
                            <FileCheck size={12} className="text-blue-500 flex-shrink-0" strokeWidth={2} />
                            <span className="text-[12px] font-bold text-slate-700">
                                {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Clock size={11} />
                    {new Date(ann.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {ann.editedAt && (
                        <span className="text-amber-500 flex items-center gap-1">
                            · <Pencil size={9} strokeWidth={2.5} />
                            editado {new Date(ann.editedAt).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
                        </span>
                    )}
                </p>
                {isRead && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        <CheckCircle2 size={10} strokeWidth={2.5} /> Leído
                    </span>
                )}
            </div>
        </div>
    );
});

// Posición y estilo de cada carta del stack (índice 0 = inmediatamente detrás)
const STACK_CONFIGS = [
    { dy: 11, rot: -2.2, scale: 0.955, opacity: 0.72 },
    { dy: 22, rot:  3.5, scale: 0.910, opacity: 0.54 },
    { dy: 32, rot: -2.8, scale: 0.865, opacity: 0.38 },
    { dy: 41, rot:  1.8, scale: 0.820, opacity: 0.24 },
    { dy: 49, rot: -1.0, scale: 0.775, opacity: 0.13 },
];

// ─────────────────────────────────────────────────────────────────────────────
// UnreadStack — mazo interactivo con teclado, stack real y animación de lectura
// ─────────────────────────────────────────────────────────────────────────────
const UnreadStack = memo(({ list, userId, onRead }) => {
    const [dismissed, setDismissed] = useState(() => new Set());
    const [pendingReads, setPendingReads] = useState([]); // [{ id, timeoutId }]
    const [undoKey, setUndoKey] = useState(0); // sube en cada confirm para resetear la animación countdown
    // 'idle' | 'check' | 'out'
    const [phase, setPhase] = useState('idle');

    const active      = list.filter(a => !dismissed.has(a.id));
    const current     = active[0];
    const stackBehind = active.slice(1, 6); // máximo 5 cartas visibles detrás
    const total       = list.length;
    const doneCount   = total - active.length;
    const urgentLeft  = active.filter(a => a.priority === 'URGENT').length;
    const canGoBack   = pendingReads.length > 0;

    // Al desmontar: cancela timers y dispara onRead inmediatamente.
    // Esto evita que al volver a la tab aparezcan cartas "fantasma" que aún no
    // fueron marcadas como leídas (la ventana de undo termina al salir de la vista).
    const pendingReadsRef = useRef(pendingReads);
    pendingReadsRef.current = pendingReads;
    const onReadRef = useRef(onRead);
    onReadRef.current = onRead;

    useEffect(() => {
        return () => {
            pendingReadsRef.current.forEach(p => {
                clearTimeout(p.timeoutId);
                onReadRef.current(p.id);
            });
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleBack = useCallback(() => {
        if (pendingReads.length === 0) return;
        const last = pendingReads[pendingReads.length - 1];
        clearTimeout(last.timeoutId);
        setDismissed(prev => { const n = new Set(prev); n.delete(last.id); return n; });
        setPendingReads(prev => prev.slice(0, -1));
    }, [pendingReads]);

    const handleConfirm = useCallback(() => {
        if (phase !== 'idle' || !current) return;
        const cardId = current.id;
        setPhase('check');
        // 'check' dura 220ms, luego 'out' (carta vuela). Al llegar a 'out' las cartas
        // de fondo se ocultan (0.12s), y a los 160ms la nueva carta ya entra limpia.
        setTimeout(() => setPhase('out'), 220);
        setTimeout(() => {
            setDismissed(prev => new Set([...prev, cardId]));
            setPhase('idle');
            setUndoKey(k => k + 1);
            // onRead se llama después de 5s — ventana para deshacer
            const timeoutId = setTimeout(() => {
                onRead(cardId);
                setPendingReads(prev => prev.filter(p => p.id !== cardId));
            }, 5000);
            setPendingReads(prev => [...prev, { id: cardId, timeoutId }]);
        }, 380);
    }, [phase, current, onRead]);

    // Teclado: Enter / → / ↓ / Espacio → confirmar  |  ← → retroceder
    useEffect(() => {
        const handler = (e) => {
            if (['Enter', 'ArrowRight', 'ArrowDown', ' '].includes(e.key)) {
                e.preventDefault();
                handleConfirm();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handleBack();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleConfirm, handleBack]);

    // ── Todos leídos ──
    if (!current) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700">
                <div className="relative flex flex-col items-center text-center">
                    <div className="absolute top-0 w-52 h-52 rounded-full blur-[80px] opacity-40 bg-emerald-400 -translate-y-10" />
                    <div className="relative z-10 w-28 h-28 rounded-[2.2rem] flex items-center justify-center mb-6 bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-[0_20px_60px_rgba(16,185,129,0.45)] hover:scale-105 transition-transform duration-500">
                        <Sparkles size={44} strokeWidth={1.6} />
                    </div>
                    <h3 className="font-black text-[26px] text-slate-800 tracking-tight mb-2">¡Todo al día!</h3>
                    <p className="font-medium text-[14px] text-slate-500 max-w-[260px] leading-relaxed">
                        Leíste todos tus avisos. Nada se te escapa.
                    </p>
                </div>
            </div>
        );
    }

    const isUrgent = current.priority === 'URGENT';
    const meta     = current.metadata || null;

    // Estilos de la tarjeta frontal según fase de animación
    // fill-mode: both en 'idle' garantiza opacity:0 desde el primer frame (sin flash blanco)
    const cardStyle = (() => {
        if (phase === 'out') return {
            animation: 'none',
            transform: 'translateY(-110px) rotate(-8deg) scale(0.65)',
            opacity: 0,
            transition: 'transform 0.18s cubic-bezier(0.4,0,1,1), opacity 0.14s ease',
        };
        if (phase === 'check') return {
            animation: 'none',
            transform: 'scale(1.02)',
            transition: 'transform 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        };
        return {
            animation: 'card-enter 0.32s cubic-bezier(0.34,1.56,0.64,1) both',
        };
    })();

    const badgeEl = current.targetType === 'GLOBAL'
        ? <span className="flex items-center gap-1.5 text-[#007AFF] bg-[#007AFF]/10 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-[#007AFF]/20"><Globe size={10} strokeWidth={2.5}/> Global</span>
        : current.targetType === 'BRANCH'
        ? <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-emerald-200/60"><Building2 size={10} strokeWidth={2.5}/> Sucursal</span>
        : <span className="flex items-center gap-1.5 text-orange-700 bg-orange-50 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-orange-200/60"><User size={10} strokeWidth={2.5}/> Personal</span>;

    return (
        <div className="flex flex-col items-center w-full">
            <style>{`
                @keyframes undo-shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
                @keyframes card-enter  { from { transform: translateY(22px) scale(0.94); } to { transform: translateY(0) scale(1); } }
            `}</style>

            {/* ── Contador + progreso ── */}
            <div className="mb-10 flex flex-col items-center gap-3 select-none">
                <div className="flex items-center gap-4">
                    <div className="text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] mb-0.5">Sin leer</p>
                        <span
                            className="text-[72px] font-black leading-none tracking-tighter transition-all duration-500"
                            style={{
                                fontVariantNumeric: 'tabular-nums',
                                background: isUrgent
                                    ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                                    : 'linear-gradient(135deg, #007AFF, #5856D6)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            {active.length}
                        </span>
                    </div>
                    {urgentLeft > 0 && (
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-white bg-red-500 px-3 py-1.5 rounded-full shadow-[0_4px_14px_rgba(239,68,68,0.4)] animate-pulse self-center">
                            <Flame size={11} strokeWidth={2.5} /> {urgentLeft} urgente{urgentLeft !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                {total > 1 && (
                    <div className="flex items-center gap-2">
                        {Array.from({ length: Math.min(total, 10) }).map((_, i) => {
                            const done = i < doneCount;
                            const cur  = i === doneCount;
                            return (
                                <div key={i} className={`rounded-full transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                                    done ? 'w-2.5 h-2.5 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' :
                                    cur  ? 'w-8   h-2.5 ' + (isUrgent ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-[#007AFF] shadow-[0_0_8px_rgba(0,122,255,0.5)]') :
                                           'w-2.5 h-2.5 bg-slate-200'
                                }`} />
                            );
                        })}
                        {total > 10 && <span className="text-[9px] font-black text-slate-400">+{total - 10}</span>}
                    </div>
                )}
            </div>

            {/* ── Stack ── */}
            <div
                className="relative w-full max-w-[520px]"
                style={{ paddingBottom: `${Math.min(stackBehind.length, 5) * 10 + 14}px` }}
            >
                {/* ── Cartas de fondo (de atrás hacia adelante) ── */}
                {/* Se ocultan durante la fase 'out' para que no quede una caja blanca expuesta */}
                {[...stackBehind].reverse().map((_, reversedIdx) => {
                    const idx = stackBehind.length - 1 - reversedIdx;
                    const cfg = STACK_CONFIGS[idx];
                    const exiting = phase === 'out';
                    return (
                        <div
                            key={idx}
                            style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: '2.5rem',
                                background: 'white',
                                border: '1px solid rgba(203,213,225,0.65)',
                                boxShadow: `0 ${4 + idx * 3}px ${20 + idx * 8}px rgba(0,0,0,${0.04 + idx * 0.015})`,
                                opacity: exiting ? 0 : cfg.opacity,
                                transform: `translateY(${cfg.dy}px) rotate(${cfg.rot}deg) scale(${cfg.scale})`,
                                transition: exiting
                                    ? 'opacity 0.12s ease'
                                    : 'transform 0.42s cubic-bezier(0.34,1.56,0.64,1), opacity 0.38s ease',
                                zIndex: 4 - idx,
                                pointerEvents: 'none',
                                transformOrigin: 'center bottom',
                            }}
                        />
                    );
                })}

                {/* ── Tarjeta frontal ── */}
                <div
                    key={current.id}
                    className="relative"
                    style={{ zIndex: 10, ...cardStyle }}
                >
                    {/* Overlay de lectura confirmada */}
                    {phase === 'check' && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[2.5rem] bg-emerald-500/12 backdrop-blur-[3px] animate-in fade-in duration-150 pointer-events-none">
                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-[0_12px_40px_rgba(16,185,129,0.55)] animate-in zoom-in-50 duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
                                <CheckCircle2 size={40} strokeWidth={2} className="text-white" />
                            </div>
                            <p className="mt-3 text-[11px] font-black text-emerald-700 uppercase tracking-widest animate-in fade-in slide-in-from-bottom-1 duration-200 delay-75">Leído</p>
                        </div>
                    )}

                    <div
                        className={`rounded-[2.5rem] border flex flex-col transition-all duration-500 group/card hover:-translate-y-1.5 ${
                            phase === 'check'
                                ? 'border-emerald-300 shadow-[0_16px_60px_rgba(16,185,129,0.25),0_0_0_2px_rgba(16,185,129,0.2)] bg-white'
                                : isUrgent
                                ? 'border-red-200/70   shadow-[0_4px_6px_rgba(0,0,0,0.04),0_12px_40px_rgba(239,68,68,0.10),0_24px_60px_rgba(0,0,0,0.07)] hover:shadow-[0_8px_10px_rgba(0,0,0,0.05),0_20px_60px_rgba(239,68,68,0.18),0_32px_80px_rgba(0,0,0,0.1)] bg-white'
                                : 'border-slate-200/50 shadow-[0_4px_6px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.07),0_24px_60px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_10px_rgba(0,0,0,0.05),0_20px_60px_rgba(0,0,0,0.11),0_32px_80px_rgba(0,0,0,0.08)] bg-white'
                        }`}
                    >
                        <div className="p-7 flex flex-col gap-5">
                            {/* Badges + fecha */}
                            <div className="flex flex-wrap items-center gap-2">
                                {isUrgent && (
                                    <span className="flex items-center gap-1.5 text-white bg-gradient-to-r from-red-500 to-red-600 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-[0_3px_10px_rgba(239,68,68,0.4)] animate-pulse">
                                        <Flame size={11} strokeWidth={2.5}/> Urgente
                                    </span>
                                )}
                                {badgeEl}
                                <span className="ml-auto text-[10px] font-bold text-slate-400 flex items-center gap-1 flex-shrink-0">
                                    <Clock size={10} strokeWidth={2}/>
                                    {new Date(current.date).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                            </div>

                            {/* Título + mensaje */}
                            <div>
                                <h4 className="font-black text-[20px] leading-tight mb-2.5 tracking-tight text-slate-900">
                                    {current.title}
                                </h4>
                                <p className="text-[13px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                                    {current.message}
                                </p>
                            </div>

                            {/* Metadata solicitud */}
                            {meta?.requestType && (
                                <div className={`rounded-2xl border p-4 space-y-2.5 ${
                                    meta.status === 'APPROVED'
                                        ? 'bg-gradient-to-br from-emerald-50 to-teal-50/40 border-emerald-200/70'
                                        : 'bg-gradient-to-br from-red-50 to-orange-50/40 border-red-200/70'
                                }`}>
                                    {meta.requestType === 'SHIFT_CHANGE' && (<>
                                        {meta.targetEmployeeName && (
                                            <div className="flex items-center gap-2">
                                                <ArrowLeftRight size={12} className="text-cyan-500 flex-shrink-0" strokeWidth={2.5}/>
                                                <span className="text-[12px] font-black text-slate-700">Con: {meta.targetEmployeeName}</span>
                                            </div>
                                        )}
                                        {meta.date && (
                                            <div className="flex items-center gap-2">
                                                <CalendarDays size={12} className="text-slate-400 flex-shrink-0" strokeWidth={2}/>
                                                <span className="text-[12px] font-bold text-slate-600">{fmtDate(meta.date)}</span>
                                            </div>
                                        )}
                                        {(meta.myShift || meta.targetShift) && (
                                            <div className="grid grid-cols-2 gap-2 pt-0.5">
                                                <div className="bg-white/80 border border-slate-100 rounded-xl p-2.5">
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Tu turno</p>
                                                    <p className="text-[12px] font-black text-slate-700">{meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}</p>
                                                </div>
                                                <div className="bg-cyan-50/80 border border-cyan-100 rounded-xl p-2.5">
                                                    <p className="text-[8px] font-black text-cyan-600 uppercase tracking-widest mb-1">Turno de {meta.targetEmployeeName?.split(' ')[0] || 'compañero'}</p>
                                                    <p className="text-[12px] font-black text-slate-700">{meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}</p>
                                                </div>
                                            </div>
                                        )}
                                    </>)}
                                    {meta.requestType === 'VACATION' && meta.startDate && (
                                        <div className="flex items-center gap-2">
                                            <CalendarDays size={12} className="text-amber-500 flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-[12px] font-bold text-slate-700">
                                                {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                                            </span>
                                        </div>
                                    )}
                                    {meta.requestType === 'PERMIT' && meta.permissionDates?.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {meta.permissionDates.map(d => (
                                                <span key={d} className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-purple-100 border border-purple-200 text-purple-700">{fmtDate(d)}</span>
                                            ))}
                                        </div>
                                    )}
                                    {meta.requestType === 'DISABILITY' && meta.startDate && (
                                        <div className="flex items-center gap-2">
                                            <CalendarDays size={12} className="text-red-400 flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-[12px] font-bold text-slate-700">
                                                {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                                                {meta.days && <span className="text-slate-500 ml-1.5">({meta.days} días)</span>}
                                            </span>
                                        </div>
                                    )}
                                    {meta.requestType === 'ADVANCE' && meta.amount && (
                                        <div className="flex items-center gap-2">
                                            <DollarSign size={12} className="text-emerald-500 flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-[12px] font-bold text-slate-700">${Number(meta.amount).toLocaleString('es-VE')}</span>
                                        </div>
                                    )}
                                    {meta.requestType === 'CERTIFICATE' && meta.certificateType && (
                                        <div className="flex items-center gap-2">
                                            <FileCheck size={12} className="text-blue-500 flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-[12px] font-bold text-slate-700">
                                                {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Botón confirmar */}
                        <div className="px-7 pb-7">
                            <button
                                onClick={handleConfirm}
                                disabled={phase !== 'idle'}
                                className={`w-full py-4 rounded-2xl font-black text-[14px] uppercase tracking-[0.14em] transition-all duration-300 flex items-center justify-center gap-3 disabled:opacity-60 hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.98] group/btn ${
                                    isUrgent
                                        ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-[0_8px_28px_rgba(239,68,68,0.38)] hover:shadow-[0_14px_36px_rgba(239,68,68,0.52)]'
                                        : 'bg-gradient-to-r from-[#007AFF] to-[#5856D6] text-white shadow-[0_8px_28px_rgba(0,122,255,0.35)] hover:shadow-[0_14px_36px_rgba(0,122,255,0.50)]'
                                }`}
                            >
                                <CheckCircle2 size={19} strokeWidth={2.5} className="group-hover/btn:scale-110 transition-transform duration-200"/>
                                {active.length === 1 ? '¡Listo, estoy al día!' : 'Entendido · Siguiente'}
                                {active.length > 1 && <ChevronsRight size={17} strokeWidth={2.5} className="group-hover/btn:translate-x-1 transition-transform duration-200"/>}
                            </button>
                        </div>
                    </div>

                    {/* Atajos de teclado */}
                    <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1.5 mt-4 select-none opacity-40 hover:opacity-70 transition-opacity duration-300">
                        {[['↵', 'Enter'], ['→', ''], ['Space', '']].map(([key, label]) => (
                            <div key={key} className="flex items-center gap-1.5">
                                <kbd className="px-2 py-0.5 rounded-md bg-white/80 border border-slate-200 text-[10px] font-black text-slate-600 shadow-[0_1px_3px_rgba(0,0,0,0.1),inset_0_-1px_0_rgba(0,0,0,0.08)] font-mono leading-none">
                                    {key}
                                </kbd>
                                {label && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>}
                            </div>
                        ))}
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">— confirmar</span>
                        <span className="text-slate-300">·</span>
                        <kbd className="px-2 py-0.5 rounded-md bg-white/80 border border-slate-200 text-[10px] font-black text-slate-600 shadow-[0_1px_3px_rgba(0,0,0,0.1),inset_0_-1px_0_rgba(0,0,0,0.08)] font-mono leading-none">←</kbd>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">— retroceder</span>
                    </div>
                </div>
            </div>

            {/* ── Botón retroceder / deshacer con countdown ── */}
            {canGoBack && (
                <div className="mt-5 flex items-center justify-center animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <button
                        onClick={handleBack}
                        className="relative flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full overflow-hidden border border-amber-200 bg-amber-50 text-amber-700 shadow-[0_4px_16px_rgba(245,158,11,0.18)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.32)] hover:-translate-y-0.5 transition-all duration-200 active:scale-95"
                    >
                        {/* barra de countdown que se encoge en 5s */}
                        <div
                            key={undoKey}
                            className="absolute inset-0 bg-amber-100/80"
                            style={{ transformOrigin: 'left center', animation: 'undo-shrink 5s linear forwards' }}
                        />
                        <ChevronLeft size={14} strokeWidth={2.5} className="relative z-10 flex-shrink-0" />
                        <span className="relative z-10 text-[10px] font-black uppercase tracking-widest">
                            {pendingReads.length > 1
                                ? `Retroceder · ${pendingReads.length} disponibles`
                                : '¿Lo pasaste por error? — Retroceder'}
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
});

const EmployeeAnnouncementsView = () => {
    const { user } = useAuth();
    const announcements = useStaffStore(s => s.announcements);
    const employees     = useStaffStore(s => s.employees);
    const markAnnouncementAsRead = useStaffStore(s => s.markAnnouncementAsRead);

    const [tab, setTab]                   = useState('UNREAD');
    const [typeFilter, setTypeFilter]     = useState('ALL');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const [searchQuery, setSearchQuery]   = useState('');
    const [showOldRead, setShowOldRead]   = useState(false);
    const searchInputRef                  = useRef(null);
    const isStoreLoading = employees.length === 0 && announcements.length === 0;
    const currentYM = new Date().toISOString().slice(0, 7);

    const readCheck = (ann) => (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(user?.id)
    );

    const myAnnouncements = useMemo(() => {
        if (!user) return [];
        return (announcements || []).filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            return (
                a.targetType === 'GLOBAL' ||
                (a.targetType === 'BRANCH' && (a.targetValue || []).includes(String(user.branchId))) ||
                (a.targetType === 'EMPLOYEE' && (a.targetValue || []).includes(String(user.id)))
            );
        }).sort((a, b) => {
            // Urgentes primero, luego más antiguos (orden cronológico para el stack sin leer)
            const aUrgent = a.priority === 'URGENT' ? 0 : 1;
            const bUrgent = b.priority === 'URGENT' ? 0 : 1;
            if (aUrgent !== bUrgent) return aUrgent - bUrgent;
            return new Date(a.date) - new Date(b.date);
        });
    }, [announcements, user]);

    const byTab = useMemo(() => {
        let list = myAnnouncements;
        if (tab === 'UNREAD') {
            list = list.filter(a => !readCheck(a));
        } else if (tab === 'READ') {
            list = list.filter(a => readCheck(a));
            if (!showOldRead) list = list.filter(a => (a.date || '').slice(0, 7) === currentYM);
            // Leídos: urgentes primero, luego más recientes
            list = [...list].sort((a, b) => {
                const aUrgent = a.priority === 'URGENT' ? 0 : 1;
                const bUrgent = b.priority === 'URGENT' ? 0 : 1;
                if (aUrgent !== bUrgent) return aUrgent - bUrgent;
                return new Date(b.date) - new Date(a.date);
            });
        }
        return list;
    }, [myAnnouncements, tab, user?.id, showOldRead, currentYM]);

    // Subfiltros disponibles para la tab READ
    const readFilters = useMemo(() => {
        if (tab !== 'READ') return [];
        const list = byTab;
        return [
            { key: 'ALL',      label: 'Todos',     icon: null,      count: list.length },
            { key: 'URGENT',   label: 'Urgentes',  icon: Flame,     count: list.filter(a => a.priority === 'URGENT').length },
            { key: 'GLOBAL',   label: 'Global',    icon: Globe,     count: list.filter(a => a.targetType === 'GLOBAL').length },
            { key: 'BRANCH',   label: 'Sucursal',  icon: Building2, count: list.filter(a => a.targetType === 'BRANCH').length },
            { key: 'EMPLOYEE', label: 'Personal',  icon: User,      count: list.filter(a => a.targetType === 'EMPLOYEE').length },
        ].filter(f => f.key === 'ALL' || f.count > 0);
    }, [tab, byTab]);

    const filtered = useMemo(() => {
        let list = byTab;
        if (typeFilter === 'URGENT') list = list.filter(a => a.priority === 'URGENT');
        else if (typeFilter !== 'ALL') list = list.filter(a => a.targetType === typeFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(a =>
                a.title?.toLowerCase().includes(q) || a.message?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [byTab, typeFilter, searchQuery]);

    const hasOldRead = useMemo(() =>
        myAnnouncements.some(a => readCheck(a) && (a.date || '').slice(0, 7) !== currentYM)
    , [myAnnouncements, user?.id, currentYM]);

    const handleRead = (id) => {
        if (user?.id) markAnnouncementAsRead(id, user.id);
    };

    const filtersContent = (
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 overflow-hidden w-max max-w-full transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
            {/* Search mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchMode ? 'max-w-[600px] opacity-100 px-3 gap-2' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0'}`}>
                <Search size={16} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Buscar avisos..."
                    className="bg-transparent border-none outline-none text-[13px] font-bold text-slate-700 w-[200px] sm:w-[280px] placeholder:text-slate-400"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="p-1 text-slate-400 hover:text-red-500 transition-all active:scale-95 shrink-0">
                        <X size={14} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={() => { setIsSearchMode(false); setSearchQuery(''); }} className="w-9 h-9 rounded-full hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all hover:shadow-md hover:text-[#007AFF] ml-1">
                    <ChevronRight size={16} strokeWidth={2.5} />
                </button>
            </div>
            {/* Tab mode */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0' : 'max-w-[700px] opacity-100 pl-2 pr-2 md:pr-3 gap-1 md:gap-1.5'}`}>
                {TABS.map(t => {
                    const isActive = tab === t.key;
                    return (
                        <button key={t.key} onClick={() => { setTab(t.key); setTypeFilter('ALL'); }}
                            className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap border shrink-0 ${
                                isActive ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]' : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                            }`}
                        >
                            {t.label}
                        </button>
                    );
                })}

                {/* Subfiltros READ — aparecen deslizándose cuando tab === 'READ' y hay opciones */}
                <div className={`flex items-center gap-1 shrink-0 transform-gpu transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                    tab === 'READ' && readFilters.length > 1
                        ? 'max-w-[360px] opacity-100'
                        : 'max-w-0 opacity-0 pointer-events-none'
                }`}>
                    <div className="w-px h-6 bg-slate-200/60 mx-1 shrink-0" />
                    {readFilters.map(({ key, label, icon: Icon }) => {
                        const isActive = typeFilter === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setTypeFilter(key)}
                                className={`flex items-center gap-1 px-2.5 h-8 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-200 whitespace-nowrap border shrink-0 ${
                                    key === 'URGENT'
                                        ? isActive
                                            ? 'bg-red-500 text-white border-red-500 shadow-[0_3px_8px_rgba(239,68,68,0.35)] scale-[1.02]'
                                            : 'bg-transparent text-red-500 border-red-200/60 hover:bg-red-50 hover:-translate-y-0.5'
                                        : isActive
                                        ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                        : 'bg-transparent text-slate-500 border-transparent hover:bg-white/70 hover:text-slate-700 hover:-translate-y-0.5'
                                }`}
                            >
                                {Icon && <Icon size={10} strokeWidth={2.5} />}
                                {label}
                            </button>
                        );
                    })}
                </div>

                <div className="w-px h-6 bg-slate-200/60 mx-1 shrink-0" />
                <button onClick={() => { setIsSearchMode(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
                    className={`relative w-9 h-9 md:w-10 md:h-10 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 active:scale-95`}>
                    <Search size={15} strokeWidth={2.5} />
                    {searchQuery && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={Bell} title="Mis Avisos" filtersContent={filtersContent} transparentBody={true}>
            <div className="pb-8">
                {isStoreLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-in fade-in duration-300">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="animate-pulse bg-white/60 backdrop-blur-md border border-white/60 rounded-[2.5rem] p-6 space-y-4">
                                <div className="flex gap-2">
                                    <div className="bg-slate-200/80 rounded-full h-4 w-4" />
                                    <div className="bg-slate-200/80 rounded-md h-4 w-20" />
                                </div>
                                <div className="space-y-2">
                                    <div className="bg-slate-200/80 rounded-full h-5 w-3/4" />
                                    <div className="bg-slate-200/80 rounded-full h-3 w-full" />
                                    <div className="bg-slate-200/80 rounded-full h-3 w-2/3" />
                                </div>
                                <div className="bg-slate-200/80 rounded-full h-2 w-full" />
                                <div className="pt-3 border-t border-white/60 flex justify-between">
                                    <div className="bg-slate-200/80 rounded-full h-3 w-24" />
                                    <div className="bg-slate-200/80 rounded-full h-3 w-12" />
                                </div>
                            </div>
                        ))}
                    </div>

                ) : tab === 'UNREAD' ? (
                    /* ── Mazo interactivo para Sin Leer ── */
                    filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700">
                            <div className="relative flex flex-col items-center text-center">
                                <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-25 bg-emerald-400" />
                                <div className="relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] text-emerald-500">
                                    <CheckCircle2 size={40} strokeWidth={1.5} />
                                </div>
                                <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">Todo al día</h3>
                                <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">No tienes avisos sin leer. ¡Estás al día!</p>
                            </div>
                        </div>
                    ) : (
                        <UnreadStack list={filtered} userId={user?.id} onRead={handleRead} />
                    )

                ) : (
                    <>
                    {/* Botón "Ver anteriores" — siempre visible en tab READ cuando hay avisos de otros meses */}
                    {(hasOldRead || showOldRead) && (
                        <div className="flex justify-end mb-4">
                            <button
                                onClick={() => setShowOldRead(v => !v)}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/70 backdrop-blur-sm border border-white/80 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-white hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 active:scale-95 shadow-sm"
                            >
                                <Clock size={12} strokeWidth={2.5} />
                                {showOldRead ? 'Solo este mes' : 'Ver anteriores'}
                            </button>
                        </div>
                    )}

                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center min-h-[360px] animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
                            <div className="relative group flex flex-col items-center text-center">
                                <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-25 bg-slate-400" />
                                <div className="relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/80 border border-white/90 shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-[0_16px_50px_rgba(0,0,0,0.12)] text-slate-400 transform-gpu overflow-hidden">
                                    {searchQuery ? <Search size={40} strokeWidth={1.5} /> : <CheckCircle2 size={40} strokeWidth={1.5} />}
                                </div>
                                <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">
                                    {searchQuery ? 'Sin resultados' : 'Sin leídos este mes'}
                                </h3>
                                <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                                    {searchQuery
                                        ? `Ningún aviso coincide con "${searchQuery}".`
                                        : hasOldRead
                                        ? 'No has leído avisos este mes. Pulsa "Ver anteriores" para ver los de meses previos.'
                                        : 'Aún no has marcado ningún aviso como leído.'}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                            {filtered.map(ann => (
                                <AnnouncementCard
                                    key={ann.id}
                                    ann={ann}
                                    userId={user?.id}
                                    onRead={handleRead}
                                />
                            ))}
                        </div>
                    )}
                    </>
                )}
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeAnnouncementsView;
