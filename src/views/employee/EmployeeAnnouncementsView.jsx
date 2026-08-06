import React, { useMemo, useState, memo, useRef, useCallback, useEffect } from 'react';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import FilterBar from '../../components/common/FilterBar';
import ViewTabBar from '../../components/common/ViewTabBar';
import SegmentedControl from '../../components/common/SegmentedControl';
import { Bell, Globe, Building2, User, CheckCircle2, Flame, Clock, Search, X, ChevronLeft, ChevronRight, RefreshCw, Palmtree, FileText, DollarSign, FileCheck, Stethoscope, CalendarDays, ArrowLeftRight, Sparkles, ChevronsRight, Pencil } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import GlassViewLayout from '../../components/GlassViewLayout';
import { smartFilter } from '../../utils/searchUtils';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { clickable } from '../../utils/clickable';
import { formatMoney } from '../../utils/formatNumber';

const TABS = [
    { key: 'UNREAD', label: 'Sin Leer' },
    { key: 'READ',   label: 'Leídos'   },
];

const REQUEST_DETAIL_ICONS = {
    VACATION: Palmtree, PERMIT: FileText, SHIFT_CHANGE: RefreshCw,
    ADVANCE: DollarSign, CERTIFICATE: FileCheck, DISABILITY: Stethoscope,
};

const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { weekday: 'short', day: '2-digit', month: 'short' }) : null;

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
        ? <Badge variant="info" icon={Globe}>Global</Badge>
        : ann.targetType === 'BRANCH'
        ? <Badge variant="success" icon={Building2}>Sucursal</Badge>
        : ann.targetType === 'ROLE'
        ? <Badge variant="chart-3" icon={User}>Cargo</Badge>
        : <Badge variant="chart-4" icon={User}>Personal</Badge>;

    return (
        <div
            data-surface="card" data-tono={isUrgent ? 'danger' : undefined}
                    className="p-6 flex flex-col gap-4 transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] group relative transform-gpu cursor-pointer"
            {...clickable(() => { if (!isRead) onRead(ann.id); })}
        >
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRead ? 'bg-content-3' : isUrgent ? 'bg-danger' : 'bg-brand'}`} />
                {isUrgent && (
                    <Badge variant="danger" tone="solid" icon={Flame}>Urgente</Badge>
                )}
                {wasReadBefore && (
                    <Badge variant="warning" icon={Pencil}>Actualización</Badge>
                )}
                {badgeEl}
            </div>

            {/* Title + message */}
            <div>
                <h4 className={`font-black text-body-xl leading-tight mb-1.5 tracking-tight ${isRead ? 'text-content-2' : 'text-content'}`}>
                    {ann.title}
                </h4>
                <p className={`text-body leading-relaxed font-medium whitespace-pre-wrap ${isRead ? 'text-content-3' : 'text-content-2'}`}>
                    {ann.message}
                </p>
            </div>

            {/* Detalle del metadata según tipo de solicitud */}
            {meta?.requestType && (
                <div className={`rounded-2xl border p-3 space-y-2 ${
                    meta.status === 'APPROVED' ? 'bg-success/10 border-success/30' : 'bg-danger/10 border-danger/30'
                }`}>
                    {/* Cambio de turno */}
                    {meta.requestType === 'SHIFT_CHANGE' && (
                        <>
                            {meta.targetEmployeeName && (
                                <div className="flex items-center gap-2">
                                    <ArrowLeftRight size={12} className="text-chart-9-text flex-shrink-0" strokeWidth={2.5} />
                                    <span className="text-body-sm font-black text-content-2">Con: {meta.targetEmployeeName}</span>
                                </div>
                            )}
                            {meta.date && (
                                <div className="flex items-center gap-2">
                                    <CalendarDays size={12} className="text-content-3 flex-shrink-0" strokeWidth={2} />
                                    <span className="text-body-sm font-bold text-content-2">{fmtDate(meta.date)}</span>
                                </div>
                            )}
                            {(meta.myShift || meta.targetShift) && (
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                    <div className="bg-surface-card border border-border-card rounded-xl p-2">
                                        <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5">Tu turno</p>
                                        <p className="text-label font-black text-content-2">{meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}</p>
                                    </div>
                                    <div className="bg-chart-9/10 border border-chart-9/20 rounded-xl p-2">
                                        <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-0.5">Turno de {meta.targetEmployeeName?.split(' ')[0] || 'compañero'}</p>
                                        <p className="text-label font-black text-content-2">{meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}</p>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Vacaciones */}
                    {meta.requestType === 'VACATION' && meta.startDate && (
                        <div className="flex items-center gap-2">
                            <CalendarDays size={12} className="text-warning flex-shrink-0" strokeWidth={2} />
                            <span className="text-body-sm font-bold text-content-2">
                                {fmtDate(meta.startDate)}
                                {meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                            </span>
                        </div>
                    )}

                    {/* Permiso */}
                    {meta.requestType === 'PERMIT' && meta.permissionDates?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {meta.permissionDates.map(d => (
                                <Badge key={d} variant="chart-3" uppercase={false}>{fmtDate(d)}</Badge>
                            ))}
                        </div>
                    )}

                    {/* Incapacidad */}
                    {meta.requestType === 'DISABILITY' && meta.startDate && (
                        <div className="flex items-center gap-2">
                            <CalendarDays size={12} className="text-danger flex-shrink-0" strokeWidth={2} />
                            <span className="text-body-sm font-bold text-content-2">
                                {fmtDate(meta.startDate)}
                                {meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                                {meta.days && <span className="text-content-3 ml-1">({meta.days} días)</span>}
                            </span>
                        </div>
                    )}

                    {/* Anticipo */}
                    {meta.requestType === 'ADVANCE' && meta.amount && (
                        <div className="flex items-center gap-2">
                            <DollarSign size={12} className="text-success flex-shrink-0" strokeWidth={2} />
                            <span className="text-body-sm font-bold text-content-2">{formatMoney(meta.amount)}</span>
                        </div>
                    )}

                    {/* Constancia */}
                    {meta.requestType === 'CERTIFICATE' && meta.certificateType && (
                        <div className="flex items-center gap-2">
                            <FileCheck size={12} className="text-chart-1-text flex-shrink-0" strokeWidth={2} />
                            <span className="text-body-sm font-bold text-content-2">
                                {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-1 border-t border-divider">
                <p className="text-caption font-bold text-content-2 uppercase tracking-widest flex items-center gap-1.5">
                    <Clock size={11} />
                    {new Date(ann.date).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {ann.editedAt && (
                        <span className="text-warning flex items-center gap-1">
                            · <Pencil size={9} strokeWidth={2.5} />
                            editado {new Date(ann.editedAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                        </span>
                    )}
                </p>
                {isRead && (
                    <Badge variant="success" icon={CheckCircle2} uppercase={false}>Leído</Badge>
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
const UnreadStack = memo(({ list, onRead }) => {
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
    useEffect(() => { pendingReadsRef.current = pendingReads; }, [pendingReads]);
    const onReadRef = useRef(onRead);
    useEffect(() => { onReadRef.current = onRead; }, [onRead]);

    useEffect(() => {
        return () => {
            pendingReadsRef.current.forEach(p => {
                clearTimeout(p.timeoutId);
                onReadRef.current(p.id);
            });
        };
    }, []);

    const handleBack = useCallback(() => {
        if (pendingReads.length === 0) return;
        const last = pendingReads[pendingReads.length - 1];
        clearTimeout(last.timeoutId);
        setDismissed(prev => { const n = new Set(prev); n.delete(last.id); return n; });
        setPendingReads(prev => prev.slice(0, -1));
    }, [pendingReads]);

    /* eslint-disable react-hooks/preserve-manual-memoization -- el compiler no puede re-optimizar este useCallback (setTimeout anidados con closures), la memoización manual sigue funcionando igual */
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
    /* eslint-enable react-hooks/preserve-manual-memoization */

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
            <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)]">
                <div className="relative flex flex-col items-center text-center">
                    <div className="absolute top-0 w-52 h-52 rounded-full blur-[80px] opacity-40 bg-success -translate-y-10" />
                    <div className="relative z-base w-28 h-28 rounded-modal flex items-center justify-center mb-6 bg-gradient-to-br from-success to-chart-9 text-white shadow-[var(--shadow-glow-success)] hover:scale-105 transition-transform duration-[var(--dur-lento)]">
                        <Sparkles size={40} strokeWidth={1.5} />
                    </div>
                    <h3 className="font-black text-display text-content tracking-tight mb-2">¡Todo al día!</h3>
                    <p className="font-medium text-body-lg text-content-3 max-w-[260px] leading-relaxed">
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
            transition: 'transform 0.2s var(--ease-spring)',
        };
        return {
            animation: 'card-enter 0.32s var(--ease-spring) both',
        };
    })();

    const badgeEl = current.targetType === 'GLOBAL'
        ? <Badge variant="info" icon={Globe}>Global</Badge>
        : current.targetType === 'BRANCH'
        ? <Badge variant="success" icon={Building2}>Sucursal</Badge>
        : current.targetType === 'ROLE'
        ? <Badge variant="chart-3" icon={User}>Cargo</Badge>
        : <Badge variant="chart-4" icon={User}>Personal</Badge>;

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
                        <p className="text-micro font-black text-content-3 uppercase tracking-[0.3em] mb-0.5">Sin leer</p>
                        <span
                            className="text-[72px] font-black leading-none tracking-tighter transition-all duration-[var(--dur-lento)]"
                            style={{
                                fontVariantNumeric: 'tabular-nums',
                                background: isUrgent
                                    ? 'linear-gradient(135deg, var(--danger), color-mix(in srgb, var(--danger) 70%, black))'
                                    : 'linear-gradient(135deg, var(--brand), var(--brand-purple))',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                            }}
                        >
                            {active.length}
                        </span>
                    </div>
                    {urgentLeft > 0 && (
                        <Badge variant="danger" tone="solid" icon={Flame} uppercase={false}>{urgentLeft} urgente{urgentLeft !== 1 ? 's' : ''}</Badge>
                    )}
                </div>
                {total > 1 && (
                    <div className="flex items-center gap-2">
                        {Array.from({ length: Math.min(total, 10) }).map((_, i) => {
                            const done = i < doneCount;
                            const cur  = i === doneCount;
                            return (
                                <div key={i} className={`rounded-full transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] ${
                                    done ? 'w-2.5 h-2.5 bg-success shadow-[var(--shadow-glow-chart-9-sm)]' :
                                    cur  ? 'w-8   h-2.5 ' + (isUrgent ? 'bg-danger shadow-[var(--shadow-glow-danger-md)]' : 'bg-brand shadow-[var(--shadow-glow-brand-md)]') :
                                           'w-2.5 h-2.5 bg-surface-card-hover'
                                }`} />
                            );
                        })}
                        {total > 10 && <span className="text-micro font-black text-content-3">+{total - 10}</span>}
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
                                border: '1px solid var(--border-card)',
                                boxShadow: idx === 0 ? 'var(--shadow-elevation-sm)' : idx === 1 ? 'var(--shadow-elevation-md)' : 'var(--shadow-elevation-lg)',
                                opacity: exiting ? 0 : cfg.opacity,
                                transform: `translateY(${cfg.dy}px) rotate(${cfg.rot}deg) scale(${cfg.scale})`,
                                transition: exiting
                                    ? 'opacity 0.12s ease'
                                    : 'transform 0.42s var(--ease-spring), opacity 0.38s ease',
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
                        <div className="absolute inset-0 z-content flex flex-col items-center justify-center rounded-header bg-success/12 backdrop-blur-[3px] animate-in fade-in duration-[var(--dur-fast)] pointer-events-none">
                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-success to-chart-9 flex items-center justify-center shadow-[var(--shadow-glow-success)] animate-in zoom-in-50 duration-[var(--dur-base)] ease-[var(--ease-spring)]">
                                <CheckCircle2 size={40} strokeWidth={2} className="text-white" />
                            </div>
                            <p className="mt-3 text-label font-black text-success-text uppercase tracking-widest animate-in fade-in slide-in-from-bottom-1 duration-[var(--dur-base)] delay-75">Leído</p>
                        </div>
                    )}

                    <div
                        className={`rounded-header border flex flex-col transition-all duration-[var(--dur-lento)] group/card hover:translate-y-[var(--lift-card)] ${
                            phase === 'check'
                                ? 'border-success/50 shadow-[var(--shadow-glow-success-lg)] bg-surface-card'
                                : isUrgent
                                ? 'border-danger/30   shadow-[var(--shadow-glow-danger-lg)] hover:shadow-[var(--shadow-glow-danger-lg)] bg-surface-card'
                                : 'border-divider shadow-[var(--shadow-elevation-xl)] hover:shadow-[var(--shadow-elevation-xl)] bg-surface-card'
                        }`}
                    >
                        <div className="p-7 flex flex-col gap-5">
                            {/* Badges + fecha */}
                            <div className="flex flex-wrap items-center gap-2">
                                {isUrgent && (
                                    <Badge variant="danger" tone="solid" icon={Flame}>Urgente</Badge>
                                )}
                                {badgeEl}
                                <span className="ml-auto text-caption font-bold text-content-3 flex items-center gap-1 flex-shrink-0">
                                    <Clock size={10} strokeWidth={2}/>
                                    {new Date(current.date).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                            </div>

                            {/* Título + mensaje */}
                            <div>
                                <h4 className="font-black text-title leading-tight mb-2.5 tracking-tight text-content">
                                    {current.title}
                                </h4>
                                <p className="text-body leading-relaxed text-content-2 whitespace-pre-wrap">
                                    {current.message}
                                </p>
                            </div>

                            {/* Metadata solicitud */}
                            {meta?.requestType && (
                                <div className={`rounded-2xl border p-4 space-y-2.5 ${
                                    meta.status === 'APPROVED'
                                        ? 'bg-gradient-to-br from-success/10 to-chart-9/10 border-success/30'
                                        : 'bg-gradient-to-br from-danger/10 to-chart-4/10 border-danger/30'
                                }`}>
                                    {meta.requestType === 'SHIFT_CHANGE' && (<>
                                        {meta.targetEmployeeName && (
                                            <div className="flex items-center gap-2">
                                                <ArrowLeftRight size={12} className="text-chart-9-text flex-shrink-0" strokeWidth={2.5}/>
                                                <span className="text-body-sm font-black text-content-2">Con: {meta.targetEmployeeName}</span>
                                            </div>
                                        )}
                                        {meta.date && (
                                            <div className="flex items-center gap-2">
                                                <CalendarDays size={12} className="text-content-3 flex-shrink-0" strokeWidth={2}/>
                                                <span className="text-body-sm font-bold text-content-2">{fmtDate(meta.date)}</span>
                                            </div>
                                        )}
                                        {(meta.myShift || meta.targetShift) && (
                                            <div className="grid grid-cols-2 gap-2 pt-0.5">
                                                <div className="bg-surface-card border border-border-card rounded-xl p-2.5">
                                                    <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Tu turno</p>
                                                    <p className="text-body-sm font-black text-content-2">{meta.myShift && meta.myShift !== 'No especificado' ? meta.myShift : '—'}</p>
                                                </div>
                                                <div className="bg-chart-9/10 border border-chart-9/20 rounded-xl p-2.5">
                                                    <p className="text-micro font-black text-chart-9-text uppercase tracking-widest mb-1">Turno de {meta.targetEmployeeName?.split(' ')[0] || 'compañero'}</p>
                                                    <p className="text-body-sm font-black text-content-2">{meta.targetShift && meta.targetShift !== 'No especificado' ? meta.targetShift : '—'}</p>
                                                </div>
                                            </div>
                                        )}
                                    </>)}
                                    {meta.requestType === 'VACATION' && meta.startDate && (
                                        <div className="flex items-center gap-2">
                                            <CalendarDays size={12} className="text-warning flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-body-sm font-bold text-content-2">
                                                {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                                            </span>
                                        </div>
                                    )}
                                    {meta.requestType === 'PERMIT' && meta.permissionDates?.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {meta.permissionDates.map(d => (
                                                <Badge key={d} variant="chart-3" uppercase={false}>{fmtDate(d)}</Badge>
                                            ))}
                                        </div>
                                    )}
                                    {meta.requestType === 'DISABILITY' && meta.startDate && (
                                        <div className="flex items-center gap-2">
                                            <CalendarDays size={12} className="text-danger flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-body-sm font-bold text-content-2">
                                                {fmtDate(meta.startDate)}{meta.endDate && meta.endDate !== meta.startDate && <> — {fmtDate(meta.endDate)}</>}
                                                {meta.days && <span className="text-content-3 ml-1.5">({meta.days} días)</span>}
                                            </span>
                                        </div>
                                    )}
                                    {meta.requestType === 'ADVANCE' && meta.amount && (
                                        <div className="flex items-center gap-2">
                                            <DollarSign size={12} className="text-success flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-body-sm font-bold text-content-2">{formatMoney(meta.amount)}</span>
                                        </div>
                                    )}
                                    {meta.requestType === 'CERTIFICATE' && meta.certificateType && (
                                        <div className="flex items-center gap-2">
                                            <FileCheck size={12} className="text-chart-1-text flex-shrink-0" strokeWidth={2}/>
                                            <span className="text-body-sm font-bold text-content-2">
                                                {{ LABORAL: 'Constancia Laboral', SALARIO: 'Constancia de Salario', BANCARIA: 'Constancia Bancaria' }[meta.certificateType] || meta.certificateType}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Botón confirmar */}
                        <div className="px-7 pb-7">
                            <Button
                                onClick={handleConfirm}
                                disabled={phase !== 'idle'}
                                size="lg"
                                className="w-full"
                                variant={isUrgent ? 'destructive' : 'primary'}
                                icon={CheckCircle2}
                            >
                                {active.length === 1 ? 'Listo, estoy al día' : 'Entendido · Siguiente'}
                                {active.length > 1 && <ChevronsRight size={16} strokeWidth={2.5} className="inline ml-2 -mt-0.5"/>}
                            </Button>
                        </div>
                    </div>

                    {/* Atajos de teclado */}
                    <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1.5 mt-4 select-none opacity-40 hover:opacity-70 transition-opacity duration-[var(--dur-slow)]">
                        {[['↵', 'Enter'], ['→', ''], ['Space', '']].map(([key, label]) => (
                            <div key={key} className="flex items-center gap-1.5">
                                <kbd className="px-2 py-0.5 rounded-md bg-surface-card border border-divider text-caption font-black text-content-2 shadow-[var(--shadow-glass-1)] font-mono leading-none">
                                    {key}
                                </kbd>
                                {label && <span className="text-micro font-bold text-content-2 uppercase tracking-widest">{label}</span>}
                            </div>
                        ))}
                        <span className="text-micro font-bold text-content-2 uppercase tracking-widest">— confirmar</span>
                        <span className="text-content-3">·</span>
                        <kbd className="px-2 py-0.5 rounded-md bg-surface-card border border-divider text-caption font-black text-content-2 shadow-[var(--shadow-glass-1)] font-mono leading-none">←</kbd>
                        <span className="text-micro font-bold text-content-2 uppercase tracking-widest">— retroceder</span>
                    </div>
                </div>
            </div>

            {/* ── Botón retroceder / deshacer con countdown ── */}
            {canGoBack && (
                <div className="mt-5 flex items-center justify-center animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-slow)]">
                    <button
                        onClick={handleBack}
                        className="relative flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-btn overflow-hidden border border-warning/30 bg-warning/10 text-warning-text shadow-[var(--shadow-glow-warning)] hover:shadow-[var(--shadow-glow-warning)] hover:translate-y-[var(--lift-hover)] transition-all duration-[var(--dur-base)] active:scale-[0.97]"
                    >
                        {/* barra de countdown que se encoge en 5s */}
                        <div
                            key={undoKey}
                            className="absolute inset-0 bg-warning/10"
                            style={{ transformOrigin: 'left center', animation: 'undo-shrink 5s linear forwards' }}
                        />
                        <ChevronLeft size={14} strokeWidth={2.5} className="relative z-base flex-shrink-0" />
                        <span className="relative z-base text-caption font-black uppercase tracking-widest">
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
    const roles = useStaffStore(s => s.roles || []);
    const employees     = useStaffStore(s => s.employees);
    const markAnnouncementAsRead = useStaffStore(s => s.markAnnouncementAsRead);

    const [tab, setTab]                   = useState('UNREAD');
    const [typeFilter, setTypeFilter]     = useState('ALL');
    const [searchQuery, setSearchQuery]   = useState('');
    const [showOldRead, setShowOldRead]   = useState(false);
    // Acá vivían `isSearchMode`, `searchInputRef` y un `useSearchToggle`
    // propio. Al pasar la barra a `ViewTabBar` quedaron los tres huérfanos —
    // que es la prueba de que eran duplicado del canónico, no personalización.
    const isStoreLoading = employees.length === 0 && announcements.length === 0;
    const currentYM = new Date().toISOString().slice(0, 7);

    const readCheck = useCallback((ann) => (ann.readBy || []).some(r =>
        String(typeof r === 'object' ? r.employeeId : r) === String(user?.id)
    ), [user?.id]);

    const myAnnouncements = useMemo(() => {
        if (!user) return [];
        return (announcements || []).filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            return announcementAppliesToUser(a, user, roles);
        }).sort((a, b) => {
            // Urgentes primero, luego más antiguos (orden cronológico para el stack sin leer)
            const aUrgent = a.priority === 'URGENT' ? 0 : 1;
            const bUrgent = b.priority === 'URGENT' ? 0 : 1;
            if (aUrgent !== bUrgent) return aUrgent - bUrgent;
            return new Date(a.date) - new Date(b.date);
        });
    }, [announcements, user, roles]);

    const byTab = useMemo(() => {
        let list = myAnnouncements;
        if (tab === 'UNREAD') {
            list = list.filter(a => !readCheck(a));
        } else if (tab === 'READ') {
            list = list.filter(a => readCheck(a));
            if (!showOldRead) list = list.filter(a => (a.date || '').slice(0, 7) === currentYM);
            // Leídos: día más reciente primero; dentro del mismo día urgentes antes; mismo día+urgencia → hora más reciente
            list = [...list].sort((a, b) => {
                const aDay = (a.date || '').slice(0, 10);
                const bDay = (b.date || '').slice(0, 10);
                if (bDay > aDay) return 1;
                if (bDay < aDay) return -1;
                const aUrgent = a.priority === 'URGENT' ? 0 : 1;
                const bUrgent = b.priority === 'URGENT' ? 0 : 1;
                if (aUrgent !== bUrgent) return aUrgent - bUrgent;
                return new Date(b.date) - new Date(a.date);
            });
        }
        return list;
    }, [myAnnouncements, tab, showOldRead, currentYM, readCheck]);

    // Subfiltros disponibles para la tab READ
    const readFilters = useMemo(() => {
        if (tab !== 'READ') return [];
        const list = byTab;
        return [
            { key: 'ALL',      label: 'Todos',     icon: null,      count: list.length },
            { key: 'URGENT',   label: 'Urgentes',  icon: Flame,     count: list.filter(a => a.priority === 'URGENT').length },
            { key: 'GLOBAL',   label: 'Global',    icon: Globe,     count: list.filter(a => a.targetType === 'GLOBAL').length },
            { key: 'BRANCH',   label: 'Sucursal',  icon: Building2, count: list.filter(a => a.targetType === 'BRANCH').length },
            { key: 'ROLE',     label: 'Cargo',     icon: User,      count: list.filter(a => a.targetType === 'ROLE').length },
            { key: 'EMPLOYEE', label: 'Personal',  icon: User,      count: list.filter(a => a.targetType === 'EMPLOYEE').length },
        ].filter(f => f.key === 'ALL' || f.count > 0);
    }, [tab, byTab]);

    const filteredRaw = useMemo(() => {
        let list = byTab;
        if (typeFilter === 'URGENT') list = list.filter(a => a.priority === 'URGENT');
        else if (typeFilter !== 'ALL') list = list.filter(a => a.targetType === typeFilter);
        if (!searchQuery.trim()) return { filtered: list, isAnnFuzzy: false };
        const { results, isFuzzy } = smartFilter(searchQuery, list, a => [a.title, a.message]);
        return { filtered: results, isAnnFuzzy: isFuzzy };
    }, [byTab, typeFilter, searchQuery]);
    const { filtered, isAnnFuzzy } = filteredRaw;

    const hasOldRead = useMemo(() =>
        myAnnouncements.some(a => readCheck(a) && (a.date || '').slice(0, 7) !== currentYM)
    , [myAnnouncements, currentYM, readCheck]);

    const handleRead = (id) => {
        if (user?.id) markAnnouncementAsRead(id, user.id);
    };

    // §16.9 — la barra estaba REESCRITA A MANO, como en otras doce vistas: su
    // propio `useSearchToggle`, sus dos mitades colapsables con `inert`, su
    // punto rojo de "hay búsqueda activa" y su botón de lupa. Todo eso lo da
    // `ViewTabBar` con el contrato de §24 (Escape cierra Y limpia; clic afuera
    // cierra solo si está vacío) y, de regalo, el colapso táctil en hoja
    // inferior que esta copia no tenía.
    //
    // Los subfiltros de "Leídos" son un uno-de-N: `SegmentedControl`, que los
    // anuncia como grupo. Antes eran botones sueltos con `inert` y un `max-w-0`
    // que los escondía a medias. Y hasta el 2026-07-30 vivían en
    // `trailingActions`, o sea en la píldora del HEADER — pero filtran, así que
    // su sitio es `FilterBar` (§17).
    const filtersContent = (
        <ViewTabBar
            tabs={TABS.map(t => ({ key: t.key, label: t.label }))}
            activeTab={tab}
            onTabChange={k => { setTab(k); setTypeFilter('ALL'); }}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder="Buscar avisos…"
        />
    );

    const filtrosCuerpo = tab === 'READ' && readFilters.length > 1 ? (
        <FilterBar
            onClear={() => setTypeFilter('ALL')}
            activeCount={typeFilter !== 'ALL' ? 1 : 0}
        >
            <FilterBar.Section active={typeFilter !== 'ALL'} onClear={() => setTypeFilter('ALL')} label="tipo">
                {/* `readFilters` es dinámico: van de 2 a 6 según lo que haya
                    recibido el empleado. `FilterBar.Opciones` elige el control por
                    la cantidad, así que ya no hay un caso en que seis segmentos se
                    coman la píldora. */}
                <FilterBar.Opciones
                    label="Filtrar por tipo"
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={readFilters.map(({ key, label, icon }) => ({ value: key, label, icon }))}
                />
            </FilterBar.Section>
        </FilterBar>
    ) : null;

    return (
        <GlassViewLayout icon={Bell} title="Mis Avisos" filtersContent={filtersContent} transparentBody={true}>
            <div className="pb-8">
                {filtrosCuerpo && <div className="flex justify-end mb-4">{filtrosCuerpo}</div>}
                {isStoreLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} data-surface="card" className="animate-stagger-child p-6 space-y-4" style={{ '--stagger-delay': `${i * 55}ms` }}>
                                <div className="flex gap-2">
                                    <div className="skeleton rounded-full h-4 w-4" />
                                    <div className="skeleton rounded-md h-4 w-20" />
                                </div>
                                <div className="space-y-2">
                                    <div className="skeleton rounded-full h-5 w-3/4" />
                                    <div className="skeleton rounded-full h-3 w-full" />
                                    <div className="skeleton rounded-full h-3 w-2/3" />
                                </div>
                                <div className="skeleton rounded-full h-2 w-full" />
                                <div className="pt-3 border-t border-border-card flex justify-between">
                                    <div className="skeleton rounded-full h-3 w-24" />
                                    <div className="skeleton rounded-full h-3 w-12" />
                                </div>
                            </div>
                        ))}
                    </div>

                ) : tab === 'UNREAD' ? (
                    /* ── Mazo interactivo para Sin Leer ── */
                    <>
                    {isAnnFuzzy && searchQuery && (
                        <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{searchQuery}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                    )}
                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)]">
                            <div className="relative flex flex-col items-center text-center">
                                <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-25 bg-success" />
                                <div className="relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card backdrop-blur-xl border border-border-card shadow-[var(--shadow-elevation-md)] text-success">
                                    <CheckCircle2 size={40} strokeWidth={1.5} />
                                </div>
                                <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">Todo al día</h3>
                                <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">No tienes avisos sin leer. ¡Estás al día!</p>
                            </div>
                        </div>
                    ) : (
                        <UnreadStack list={filtered} userId={user?.id} onRead={handleRead} />
                    )}
                    </>

                ) : (
                    <>
                    {/* Botón "Ver anteriores" — siempre visible en tab READ cuando hay avisos de otros meses */}
                    {(hasOldRead || showOldRead) && (
                        <div className="flex justify-end mb-4">
                            <Button variant="secondary" icon={Clock} onClick={() => setShowOldRead(v => !v)}>{showOldRead ? 'Solo este mes' : 'Ver anteriores'}</Button>
                        </div>
                    )}

                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center min-h-[360px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-[var(--ease-spring)]">
                            <div className="relative group flex flex-col items-center text-center">
                                <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-25 bg-content-3" />
                                <div className="relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-[var(--dur-lento)] group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] text-content-3 transform-gpu overflow-hidden">
                                    {searchQuery ? <Search size={40} strokeWidth={1.5} /> : <CheckCircle2 size={40} strokeWidth={1.5} />}
                                </div>
                                <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                                    {searchQuery ? 'Sin resultados' : 'Sin leídos este mes'}
                                </h3>
                                <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
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
