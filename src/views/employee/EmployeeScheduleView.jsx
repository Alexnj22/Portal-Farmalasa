import React, { useState, useEffect, useMemo } from 'react';
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
    VACATION:   { label: 'Vacaciones',  color: 'bg-warning/10 text-amber-700 border-warning/30' },
    DISABILITY: { label: 'Incapacidad', color: 'bg-danger/10 text-red-700 border-danger/30' },
    PERMIT:     { label: 'Permiso',     color: 'bg-purple-100 text-purple-700 border-purple-200' },
};

const VACATION_STATUS = {
    DRAFT:            { label: 'Borrador',      color: 'bg-surface-card-hover text-content-3 border-slate-200' },
    PRE_APPROVED:     { label: 'Pre-aprobado',  color: 'bg-blue-100 text-blue-700 border-blue-200' },
    CHANGE_REQUESTED: { label: 'Cambio solicitado', color: 'bg-warning/10 text-amber-700 border-warning/30' },
    APPROVED:         { label: 'Aprobado',      color: 'bg-success/10 text-emerald-700 border-success/30' },
    CONFIRMED:        { label: 'Confirmado',    color: 'bg-success/10 text-emerald-700 border-success/30' },
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
            <div className="flex items-center justify-between bg-surface-card backdrop-blur-xl border border-border-card rounded-[1.75rem] px-4 py-3 shadow-sm">
                <button
                    onClick={() => setWeekOffset(v => v - 1)}
                    className="p-2 rounded-xl hover:bg-surface-card-hover text-content-3 transition-all active:scale-[0.97]"
                >
                    <ChevronLeft size={18} strokeWidth={2.5} />
                </button>
                <div className="text-center">
                    <p className="text-[13px] font-black text-content">{weekLabel}</p>
                    {isCurrentWeek && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-brand">Semana actual</span>
                    )}
                </div>
                <button
                    onClick={() => setWeekOffset(v => v + 1)}
                    className="p-2 rounded-xl hover:bg-surface-card-hover text-content-3 transition-all active:scale-[0.97]"
                >
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>

            {isLoading ? (
                <div className="space-y-2 animate-in fade-in duration-300">
                    {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="rounded-[1.75rem] border border-border-card bg-surface-card backdrop-blur-md p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-[1rem] skeleton flex-shrink-0" />
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
                            className={`rounded-[1.75rem] border p-4 transition-all ${
                                d.isToday
                                    ? 'bg-brand/5 border-brand/30 shadow-[0_0_0_1px_rgba(0,82,204,0.15)]'
                                    : 'bg-surface-card backdrop-blur-md border-border-card'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-12 h-12 rounded-[1rem] flex flex-col items-center justify-center flex-shrink-0 ${
                                    d.isToday ? 'bg-brand text-white' : 'bg-surface-card-hover text-content-2'
                                }`}>
                                    <span className="text-[8px] font-black uppercase tracking-widest leading-none opacity-70">{d.short}</span>
                                    <span className="text-[16px] font-black leading-tight">{d.date.getDate()}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    {d.event ? (
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${EVENT_BADGE[d.event.type]?.color || 'bg-surface-card-hover text-content-2 border-slate-200'}`}>
                                            {EVENT_BADGE[d.event.type]?.label || d.event.type}
                                        </span>
                                    ) : d.shift ? (
                                        <div className="flex items-center gap-3">
                                            <div>
                                                <p className="text-[9px] font-black text-content-2 uppercase tracking-widest">Entrada</p>
                                                <p className="text-[15px] font-black text-content">{formatTime12h(d.shift.start)}</p>
                                            </div>
                                            <Coffee size={12} className="text-orange-400 flex-shrink-0" />
                                            <div>
                                                <p className="text-[9px] font-black text-content-2 uppercase tracking-widest">Salida</p>
                                                <p className="text-[15px] font-black text-content">{formatTime12h(d.shift.end)}</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2 text-content-3">
                                            <Palmtree size={15} strokeWidth={1.5} />
                                            <span className="text-[13px] font-bold">Día libre</span>
                                        </div>
                                    )}
                                </div>
                                {d.isToday && (
                                    <span className="flex-shrink-0 text-[9px] font-black uppercase tracking-widest bg-brand text-white px-2 py-0.5 rounded-full animate-pulse">
                                        Hoy
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Mis Vacaciones ── */}
            <div className="rounded-[1.75rem] border border-border-card bg-surface-card backdrop-blur-xl p-5 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5">
                    <Palmtree size={10} /> Mis Vacaciones
                </p>

                {loadingVacations ? (
                    <div className="space-y-2">
                        <div className="skeleton rounded-2xl h-16 w-full" />
                    </div>
                ) : myVacations.length === 0 ? (
                    <p className="text-[12px] text-content-3 font-medium text-center py-3">
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
                                                <p className="text-[11px] font-black text-content-2">
                                                    {fmtDate(vp.start_date)}
                                                    <ArrowRight size={9} className="inline mx-1 text-content-3" strokeWidth={2.5} />
                                                    {fmtDate(vp.end_date)}
                                                </p>
                                                <p className="text-[9px] text-content-3 font-medium">{vp.days} días · {vp.year}</p>
                                            </div>
                                        </div>
                                        <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border ${meta.color}`}>
                                            {meta.label}
                                        </span>
                                    </div>

                                    {/* Requested change info */}
                                    {vp.status === 'CHANGE_REQUESTED' && vp.change_requested_start && (
                                        <div className="flex items-center gap-2 bg-warning/10 border border-warning/60 rounded-xl px-3 py-2">
                                            <MessageSquare size={11} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                                            <p className="text-[10px] text-amber-700 font-bold">
                                                Cambio solicitado: {fmtDate(vp.change_requested_start)} → {fmtDate(vp.change_requested_end)}
                                            </p>
                                        </div>
                                    )}

                                    {/* Solicitar cambio button */}
                                    {canRequest && (
                                        <button
                                            onClick={() => handleOpenChangeForm(vp)}
                                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-brand/20 bg-brand/5 text-brand text-[10px] font-black uppercase tracking-widest hover:bg-brand/10 transition-all"
                                        >
                                            <MessageSquare size={11} strokeWidth={2.5} /> Solicitar cambio de fechas
                                        </button>
                                    )}
                                    {pendingRequest && vp.status === 'CHANGE_REQUESTED' && (
                                        <p className="text-[10px] text-warning font-bold text-center">Solicitud enviada — pendiente de aprobación</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Change request form modal */}
            {showChangeForm && changeTarget && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-surface-card backdrop-blur-xl border border-border-card rounded-[2rem] p-6 shadow-2xl space-y-4 animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center justify-between">
                            <p className="text-[14px] font-black text-content">Solicitar cambio de vacaciones</p>
                            <button onClick={() => setShowChangeForm(false)} className="p-1.5 rounded-xl hover:bg-surface-card-hover text-content-3 transition-all">
                                <X size={16} strokeWidth={2.5} />
                            </button>
                        </div>

                        <div className="bg-surface-card-hover border border-slate-100 rounded-2xl px-4 py-3">
                            <p className="text-[9px] font-black text-content-2 uppercase tracking-widest mb-1">Fechas actuales</p>
                            <p className="text-[12px] font-bold text-content-2">
                                {fmtDate(changeTarget.start_date)} → {fmtDate(changeTarget.end_date)}
                            </p>
                        </div>

                        <div>
                            <p className="text-[10px] font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 ml-1">Nuevas fechas solicitadas</p>
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
                            <p className="text-[10px] font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 ml-1">Motivo (opcional)</p>
                            <textarea
                                value={reqNote}
                                onChange={e => setReqNote(e.target.value)}
                                placeholder="Explica el motivo del cambio…"
                                rows={2}
                                className="w-full px-4 py-3 bg-surface-card border border-border-card focus:bg-white focus:border-brand/30 rounded-2xl text-[16px] outline-none font-bold text-content-2 transition-all placeholder-slate-400 placeholder:font-normal resize-none"
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowChangeForm(false)}
                                className="flex-1 py-3 rounded-2xl border border-slate-200 text-content-3 text-[11px] font-black uppercase tracking-widest hover:bg-surface-card-hover transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSubmitChange}
                                disabled={!reqStart || !reqEnd || submittingReq}
                                className="flex-1 py-3 rounded-2xl bg-brand text-white text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-brand-hover transition-all"
                            >
                                {submittingReq
                                    ? <><Loader2 size={13} className="animate-spin" /> Enviando…</>
                                    : <><Check size={13} strokeWidth={3} /> Enviar solicitud</>
                                }
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmployeeScheduleView;
