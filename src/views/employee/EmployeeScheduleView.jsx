import React, { useState, useEffect, useMemo } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { ChevronLeft, ChevronRight, Coffee, Palmtree, Calendar, ArrowRight, Loader2, MessageSquare, Check, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { formatTime12h } from '../../utils/helpers';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import {
    fetchPublishedRosterForWeek, fetchEmployeeEventsByTypesUntil,
    fetchMyVacationPlansMultiYear, fetchPendingVacationChangeRequest,
} from '../../data/employeeSelfService';
import { updateVacationPlan } from '../../data/vacationPlans';
import { insertApprovalRequest } from '../../data/requests';

const DAYS = [
    { id: 1, name: 'Lunes',     short: 'LUN' },
    { id: 2, name: 'Martes',    short: 'MAR' },
    { id: 3, name: 'Miércoles', short: 'MIE' },
    { id: 4, name: 'Jueves',    short: 'JUE' },
    { id: 5, name: 'Viernes',   short: 'VIE' },
    { id: 6, name: 'Sábado',    short: 'SAB' },
    { id: 0, name: 'Domingo',   short: 'DOM' },
];

const EVENT_BADGE = {
    VACATION:   { label: 'Vacaciones',  color: 'bg-warning/10 text-warning-text border-warning/30' },
    DISABILITY: { label: 'Incapacidad', color: 'bg-danger/10 text-danger-text border-danger/30' },
    PERMIT:     { label: 'Permiso',     color: 'bg-chart-3/10 text-chart-3-text border-chart-3/30' },
};

const VACATION_STATUS = {
    DRAFT:            { label: 'Borrador',      color: 'bg-surface-card-hover text-content-3 border-divider' },
    PRE_APPROVED:     { label: 'Pre-aprobado',  color: 'bg-chart-1/10 text-chart-1-text border-chart-1/30' },
    CHANGE_REQUESTED: { label: 'Cambio solicitado', color: 'bg-warning/10 text-warning-text border-warning/30' },
    APPROVED:         { label: 'Aprobado',      color: 'bg-success/10 text-success-text border-success/30' },
    CONFIRMED:        { label: 'Confirmado',    color: 'bg-success/10 text-success-text border-success/30' },
};

const fmtDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

const getWeekStart = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
};

const toISO = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
};

const EmployeeScheduleView = () => {
    const { user } = useAuth();
    const shifts = useStaffStore(s => s.shifts);
    const holidays = useStaffStore(s => s.holidays);
    const employees = useStaffStore(s => s.employees);

    const [weekOffset, setWeekOffset] = useState(0);
    const [scheduleData, setScheduleData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [activeEvents, setActiveEvents] = useState([]);

    // Vacation plan state
    const [myVacations, setMyVacations] = useState([]);
    const [loadingVacations, setLoadingVacations] = useState(false);
    const [pendingRequest, setPendingRequest] = useState(null); // existing pending approval_request

    // Change request form
    const [showChangeForm, setShowChangeForm] = useState(false);
    const [changeTarget, setChangeTarget] = useState(null); // the vacation_plan being changed
    const [reqStart, setReqStart] = useState('');
    const [reqEnd, setReqEnd] = useState('');
    const [reqNote, setReqNote] = useState('');
    const [submittingReq, setSubmittingReq] = useState(false);

    const emp = employees.find(e => String(e.id) === String(user?.id));

    const weekStart = useMemo(() => {
        const base = getWeekStart(new Date());
        base.setDate(base.getDate() + weekOffset * 7);
        return base;
    }, [weekOffset]);

    const weekStartISO = useMemo(() => toISO(weekStart), [weekStart]);
    const isCurrentWeek = weekOffset === 0;

    // Load week roster
    useEffect(() => {
        if (!user?.id) return;
        if (isCurrentWeek && emp?.weeklySchedule) {
            setScheduleData(emp.weeklySchedule);
            return;
        }
        setIsLoading(true);
        setScheduleData(null);
        fetchPublishedRosterForWeek(user.id, weekStartISO)
            .then(({ data }) => {
                setScheduleData(data?.schedule_data || {});
                setIsLoading(false);
            });
    }, [user?.id, weekStartISO, isCurrentWeek, emp?.weeklySchedule]);

    // Load active events (confirmed day-level events)
    useEffect(() => {
        if (!user?.id) return;
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        fetchEmployeeEventsByTypesUntil(user.id, toISO(weekEnd))
            .then(({ data }) => setActiveEvents(data || []));
    }, [user?.id, weekStartISO, weekStart]);

    // Load vacation plans (PRE_APPROVED, CHANGE_REQUESTED, APPROVED, CONFIRMED)
    useEffect(() => {
        if (!user?.id) return;
        setLoadingVacations(true);
        const currentYear = new Date().getFullYear();
        fetchMyVacationPlansMultiYear(user.id, [currentYear, currentYear + 1])
            .then(({ data }) => {
                setMyVacations(data || []);
                setLoadingVacations(false);
            });

        // Check for existing pending change request
        fetchPendingVacationChangeRequest(user.id)
            .then(({ data }) => setPendingRequest(data || null));
    }, [user?.id]);

    const today = useMemo(() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
    }, []);

    const days = useMemo(() => {
        return DAYS.map((d, idx) => {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + idx);
            const dateISO = toISO(date);
            const isToday = date.getTime() === today.getTime();

            const rawShift = scheduleData?.[d.id] ?? scheduleData?.[String(d.id)];
            const shiftId = typeof rawShift === 'object' ? rawShift?.shiftId : rawShift;
            const shift = shiftId && shiftId !== 'LIBRE'
                ? shifts.find(s => String(s.id) === String(shiftId))
                : null;

            const event = activeEvents.find(ev => {
                const meta = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                const start = meta.startDate || ev.date;
                const end = meta.endDate || ev.date;
                return dateISO >= start && dateISO <= end;
            });

            return { ...d, date, dateISO, isToday, shift, event };
        });
    }, [weekStart, scheduleData, shifts, activeEvents, today]);

    const weekLabel = useMemo(() => {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        const fmt = (d) => d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
        return `${fmt(weekStart)} — ${fmt(end)}`;
    }, [weekStart]);

    const handleOpenChangeForm = (vp) => {
        setChangeTarget(vp);
        setReqStart('');
        setReqEnd('');
        setReqNote('');
        setShowChangeForm(true);
    };

    const handleSubmitChange = async () => {
        if (!reqStart || !reqEnd || !changeTarget) return;
        setSubmittingReq(true);
        try {
            // Mark vacation_plan as CHANGE_REQUESTED, save requested dates
            const { error: planErr } = await updateVacationPlan(changeTarget.id, {
                status: 'CHANGE_REQUESTED',
                change_requested_start: reqStart,
                change_requested_end: reqEnd,
                updated_at: new Date().toISOString(),
            });
            if (planErr) throw planErr;

            // Create approval_request
            const { data: req, error: reqErr } = await insertApprovalRequest({
                employee_id: user.id,
                type: 'VACATION_CHANGE',
                status: 'PENDING',
                note: reqNote.trim() || null,
                metadata: {
                    vacation_plan_id: changeTarget.id,
                    year: changeTarget.year,
                    requested_start: reqStart,
                    requested_end: reqEnd,
                    original_start: changeTarget.start_date,
                    original_end: changeTarget.end_date,
                },
            });
            if (reqErr) throw reqErr;

            setPendingRequest(req);
            setMyVacations(prev => prev.map(v =>
                v.id === changeTarget.id
                    ? { ...v, status: 'CHANGE_REQUESTED', change_requested_start: reqStart, change_requested_end: reqEnd }
                    : v
            ));
            setShowChangeForm(false);
            setChangeTarget(null);
        } catch (err) {
            console.error('handleSubmitChange:', err);
        } finally {
            setSubmittingReq(false);
        }
    };

    return (
        <div className="px-4 pt-4 pb-6 space-y-4">
            {/* Navegación de semana */}
            <div className="flex items-center justify-between bg-surface-card backdrop-blur-xl border border-border-card rounded-card px-4 py-3 shadow-sm">
                <Button variant="secondary" icon={ChevronLeft} iconOnly onClick={() => setWeekOffset(v => v - 1)} />
                <div className="text-center">
                    <p className="text-body font-black text-content">{weekLabel}</p>
                    {isCurrentWeek && (
                        <span className="text-micro font-black uppercase tracking-widest text-brand-text">Semana actual</span>
                    )}
                </div>
                <Button variant="secondary" icon={ChevronRight} iconOnly onClick={() => setWeekOffset(v => v + 1)} />
            </div>

            {isLoading ? (
                <div className="space-y-2 animate-in fade-in duration-300">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="rounded-card border border-border-card bg-surface-card backdrop-blur-md p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl skeleton flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <div className="skeleton rounded-full h-3 w-24" />
                                    <div className="skeleton rounded-full h-5 w-32" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    {days.map(d => (
                        <div
                            key={d.id}
                            className={`rounded-card border p-4 transition-all ${
                                d.isToday
                                    ? 'bg-brand/5 border-brand/30 shadow-[var(--shadow-ring-brand)]'
                                    : 'bg-surface-card backdrop-blur-md border-border-card'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center flex-shrink-0 ${
                                    d.isToday ? 'bg-brand text-white' : 'bg-surface-card-hover text-content-2'
                                }`}>
                                    <span className="text-micro font-black uppercase tracking-widest leading-none opacity-70">{d.short}</span>
                                    <span className="text-body-xl font-black leading-tight">{d.date.getDate()}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    {d.event ? (
                                        <span className={`text-caption font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${EVENT_BADGE[d.event.type]?.color || 'bg-surface-card-hover text-content-2 border-divider'}`}>
                                            {EVENT_BADGE[d.event.type]?.label || d.event.type}
                                        </span>
                                    ) : d.shift ? (
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <p className="text-micro font-black text-content-2 uppercase tracking-widest">Entrada</p>
                                                <p className="text-subtitle font-black text-content">{formatTime12h(d.shift.start)}</p>
                                            </div>
                                            <Coffee size={12} className="text-chart-4-text flex-shrink-0" />
                                            <div>
                                                <p className="text-micro font-black text-content-2 uppercase tracking-widest">Salida</p>
                                                <p className="text-subtitle font-black text-content">{formatTime12h(d.shift.end)}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-content-3">
                                            <Palmtree size={15} strokeWidth={1.5} />
                                            <span className="text-body font-bold">Día libre</span>
                                        </div>
                                    )}
                                </div>
                                {d.isToday && (
                                    <Badge variant="info" tone="solid" size="sm">Hoy</Badge>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Mis Vacaciones ── */}
            <div className="rounded-card border border-border-card bg-surface-card backdrop-blur-xl p-5 space-y-3">
                <p className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5">
                    <Palmtree size={10} /> Mis Vacaciones
                </p>

                {loadingVacations ? (
                    <div className="space-y-2">
                        <div className="skeleton rounded-2xl h-16 w-full" />
                    </div>
                ) : myVacations.length === 0 ? (
                    <p className="text-body-sm text-content-3 font-medium text-center py-3">
                        No hay vacaciones programadas aún.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {myVacations.map(vp => {
                            const meta = VACATION_STATUS[vp.status] || VACATION_STATUS.PRE_APPROVED;
                            const canRequest = vp.status === 'PRE_APPROVED' && !pendingRequest;
                            return (
                                <div key={vp.id} className="bg-surface-card border border-border-card rounded-2xl p-4 space-y-2">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <Calendar size={13} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                                            <div>
                                                <p className="text-label font-black text-content-2">
                                                    {fmtDate(vp.start_date)}
                                                    <ArrowRight size={9} className="inline mx-1 text-content-3" strokeWidth={2.5} />
                                                    {fmtDate(vp.end_date)}
                                                </p>
                                                <p className="text-micro text-content-3 font-medium">{vp.days} días · {vp.year}</p>
                                            </div>
                                        </div>
                                        <span className={`text-micro font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${meta.color}`}>
                                            {meta.label}
                                        </span>
                                    </div>

                                    {/* Requested change info */}
                                    {vp.status === 'CHANGE_REQUESTED' && vp.change_requested_start && (
                                        <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
                                            <MessageSquare size={11} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                                            <p className="text-caption text-warning-text font-bold">
                                                Cambio solicitado: {fmtDate(vp.change_requested_start)} → {fmtDate(vp.change_requested_end)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Solicitar cambio button */}
                                    {canRequest && (
                                        <Button icon={MessageSquare} onClick={() => handleOpenChangeForm(vp)}>Solicitar cambio de fechas</Button>
                                    )}
                                    {pendingRequest && vp.status === 'CHANGE_REQUESTED' && (
                                        <p className="text-caption text-warning font-bold text-center">Solicitud enviada — pendiente de aprobación</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Change request form modal */}
            {showChangeForm && changeTarget && (
                <div className="fixed inset-0 z-sidebar flex items-end justify-center bg-scrim backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-6 shadow-2xl space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between">
                            <p className="text-body-lg font-black text-content">Solicitar cambio de vacaciones</p>
                            <Button variant="secondary" icon={X} iconOnly onClick={() => setShowChangeForm(false)} />
                        </div>

                        <div className="bg-surface-card-hover border border-divider rounded-2xl px-4 py-3">
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-1">Fechas actuales</p>
                            <p className="text-body-sm font-bold text-content-2">
                                {fmtDate(changeTarget.start_date)} → {fmtDate(changeTarget.end_date)}
                            </p>
                        </div>

                        <div>
                            <p className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 ml-1">Nuevas fechas solicitadas</p>
                            <RangeDatePicker
                                startDate={reqStart}
                                endDate={reqEnd}
                                onRangeChange={(s, e) => { setReqStart(s || ''); setReqEnd(e || ''); }}
                                holidays={holidays || []}
                                defaultDays={changeTarget.days || 15}
                                label="Seleccionar fechas"
                            />
                        </div>

                        <div>
                            <p className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 ml-1">Motivo (opcional)</p>
                            <textarea
                                value={reqNote}
                                onChange={e => setReqNote(e.target.value)}
                                placeholder="Explica el motivo del cambio…"
                                rows={2}
                                className="w-full px-4 py-3 bg-surface-card border border-border-card focus:bg-surface-card focus:border-brand/30 rounded-2xl text-body-xl outline-none font-bold text-content-2 transition-all placeholder-content-3 placeholder:font-normal resize-none"
                            />
                        </div>

                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => setShowChangeForm(false)}>Cancelar</Button>
                            <Button disabled={!reqStart || !reqEnd || submittingReq} onClick={handleSubmitChange}>{submittingReq
                                    ? <><Loader2 size={13} className="animate-spin" /> Enviando…</>
                                    : <><Check size={13} strokeWidth={3} /> Enviar solicitud</>
                                }</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmployeeScheduleView;
