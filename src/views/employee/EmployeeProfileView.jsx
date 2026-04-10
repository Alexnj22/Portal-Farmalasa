import React, { useState, useEffect, useMemo } from 'react';
import {
    User, Phone, HeartPulse, Briefcase, KeyRound,
    Loader2, Clock, Edit3, Calendar, ArrowRightLeft, Sparkles
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { EVENT_TYPES } from '../../data/constants';
import GlassViewLayout from '../../components/GlassViewLayout';

const formatDate = (d) => d
    ? new Date(d + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

const EVENT_THEMES = {
    VACATION:    { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'border-emerald-500',  glow: 'hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)]' },
    PERMIT:      { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   dot: 'border-amber-500',    glow: 'hover:shadow-[0_8px_24px_rgba(245,158,11,0.12)]'  },
    DISABILITY:  { bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     dot: 'border-red-500',      glow: 'hover:shadow-[0_8px_24px_rgba(239,68,68,0.12)]'   },
    SHIFT_CHANGE:{ bg: 'bg-cyan-50',     text: 'text-cyan-700',    border: 'border-cyan-200',    dot: 'border-cyan-500',     glow: 'hover:shadow-[0_8px_24px_rgba(6,182,212,0.12)]'   },
    SALARY:      { bg: 'bg-indigo-50',   text: 'text-indigo-700',  border: 'border-indigo-200',  dot: 'border-indigo-500',   glow: 'hover:shadow-[0_8px_24px_rgba(99,102,241,0.12)]'  },
    TRANSFER:    { bg: 'bg-blue-50',     text: 'text-blue-700',    border: 'border-blue-200',    dot: 'border-blue-500',     glow: 'hover:shadow-[0_8px_24px_rgba(59,130,246,0.12)]'  },
    HIRING:      { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'border-emerald-500',  glow: 'hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)]' },
};
const DEFAULT_THEME = { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'border-[#007AFF]', glow: 'hover:shadow-[0_8px_24px_rgba(0,122,255,0.10)]' };

const StatCell = ({ label, value }) => (
    <div className="flex-1 flex flex-col items-center px-3 py-3.5 hover:bg-white/10 transition-colors duration-200 cursor-default group">
        <p className="text-[18px] font-black text-white leading-tight group-hover:scale-110 transition-transform duration-200">{value}</p>
        <p className="text-[9px] font-bold text-white/60 uppercase tracking-widest mt-0.5">{label}</p>
    </div>
);

const Field = ({ label, value }) => (
    <div className="p-3.5 rounded-2xl bg-white/60 backdrop-blur-sm border border-white/80 hover:bg-white/85 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200 cursor-default">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-0.5">{label}</p>
        <p className="text-[13px] font-bold text-slate-700 truncate">{value || 'No registrado'}</p>
    </div>
);

const SectionCard = ({ children, className = '' }) => (
    <div className={`bg-white/60 backdrop-blur-2xl border border-white/80 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.07)] hover:-translate-y-0.5 transition-all duration-300 ${className}`}>
        {children}
    </div>
);

const SectionLabel = ({ icon: Icon, label, color = 'text-slate-400' }) => (
    <p className={`text-[10px] font-black uppercase tracking-widest ${color} flex items-center gap-1.5 mb-3`}>
        <Icon size={10} /> {label}
    </p>
);

const EmployeeProfileView = ({ openModal }) => {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);

    const emp    = employees.find(e => String(e.id) === String(user?.id)) || user;
    const branch = branches.find(b => String(b.id) === String(emp?.branchId || emp?.branch_id));

    const [events, setEvents]           = useState([]);
    const [evLoading, setEvLoading]     = useState(true);
    const [activeCount, setActiveCount] = useState(0);

    useEffect(() => {
        if (!user?.id) return;
        const load = async () => {
            setEvLoading(true);
            const [{ data: evData }, { count }] = await Promise.all([
                supabase
                    .from('employee_events')
                    .select('id, type, date, note, metadata')
                    .eq('employee_id', user.id)
                    .order('date', { ascending: false })
                    .limit(30),
                supabase
                    .from('approval_requests')
                    .select('id', { count: 'exact', head: true })
                    .eq('employee_id', user.id)
                    .eq('status', 'PENDING'),
            ]);
            setEvents(evData || []);
            setActiveCount(count || 0);
            setEvLoading(false);
        };
        load();
    }, [user?.id]);

    const tenure = useMemo(() => {
        const hd = emp?.hire_date || emp?.hireDate;
        if (!hd) return '—';
        const h = new Date(hd + 'T12:00:00'), now = new Date();
        let y = now.getFullYear() - h.getFullYear();
        let m = now.getMonth() - h.getMonth();
        if (m < 0) { y--; m += 12; }
        if (y === 0 && m === 0) return 'Nuevo';
        return `${y > 0 ? `${y}a ` : ''}${m > 0 ? `${m}m` : ''}`.trim();
    }, [emp?.hire_date, emp?.hireDate]);

    const timeline = useMemo(() => {
        const hd = emp?.hire_date || emp?.hireDate;
        const synthetic = hd ? [{
            id: 'hiring-event', type: 'HIRING', date: hd, isSystem: true,
            note: `Inicio de labores. Sucursal: ${branch?.name || 'N/A'}`,
            metadata: {},
        }] : [];
        return [...events, ...synthetic].sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [events, emp?.hire_date, emp?.hireDate, branch]);

    if (!emp) return null;

    return (
        <GlassViewLayout icon={User} title="Mi Perfil">
            <div className="pt-4 md:pt-6 px-4 md:px-6 pb-10 flex flex-col lg:flex-row gap-5 items-start">

                {/* ── COLUMNA IZQUIERDA ── */}
                <div className="w-full lg:w-[360px] shrink-0 space-y-4">

                    {/* Profile hero card */}
                    <div className="relative overflow-hidden bg-gradient-to-br from-[#007AFF] to-[#0055CC] rounded-[2.5rem] shadow-[0_12px_40px_rgba(0,122,255,0.25)] hover:shadow-[0_20px_56px_rgba(0,122,255,0.35)] hover:-translate-y-1 transition-all duration-500 group/hero">
                        {/* Orbs decorativos */}
                        <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full -translate-y-20 translate-x-20 group-hover/hero:scale-110 transition-transform duration-700" />
                        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-12 -translate-x-12 group-hover/hero:scale-110 transition-transform duration-700" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/[0.03] rounded-full" />

                        <div className="relative z-10 p-7 pb-5 flex flex-col items-center text-center">
                            <div className="w-24 h-24 rounded-[1.75rem] overflow-hidden border-[3px] border-white/40 shadow-xl mb-4 group-hover/hero:border-white/60 group-hover/hero:shadow-2xl transition-all duration-500">
                                {emp.photo || emp.photo_url
                                    ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                                    : <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-black text-3xl">{emp.name?.charAt(0)}</div>
                                }
                            </div>
                            <p className="text-white font-black text-[22px] leading-tight tracking-tight">{emp.name}</p>
                            <p className="text-white/70 text-[12px] font-semibold mt-1">{emp.role || 'Empleado'}</p>
                            <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mt-0.5">{branch?.name}</p>
                            {emp.code && (
                                <span className="mt-3 bg-white/20 backdrop-blur-sm border border-white/30 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full hover:bg-white/30 transition-colors duration-200">
                                    CÓD: {emp.code}
                                </span>
                            )}
                        </div>

                        {/* Stats strip */}
                        <div className="relative z-10 border-t border-white/20 flex divide-x divide-white/20">
                            <StatCell label="Antigüedad"  value={tenure}          />
                            <StatCell label="Solicitudes" value={activeCount}     />
                            <StatCell label="Eventos"     value={timeline.length} />
                        </div>
                    </div>

                    {/* Botones de acción */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => openModal('editContact', emp)}
                            className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#007AFF] text-white text-[11px] font-black uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:bg-[#0066DD] hover:shadow-[0_8px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 transition-all duration-200 active:scale-95"
                        >
                            <Edit3 size={13} strokeWidth={2.5} /> Editar Perfil
                        </button>
                        <button
                            onClick={() => openModal('changeOwnPassword', {})}
                            className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/70 backdrop-blur-sm border border-white/80 text-amber-600 text-[11px] font-black uppercase tracking-widest shadow-sm hover:bg-amber-50 hover:border-amber-200 hover:shadow-[0_8px_20px_rgba(245,158,11,0.15)] hover:-translate-y-0.5 transition-all duration-200 active:scale-95"
                        >
                            <KeyRound size={13} /> Contraseña
                        </button>
                    </div>

                    {/* Contacto */}
                    <SectionCard>
                        <SectionLabel icon={Phone} label="Contacto" />
                        <div className="space-y-2">
                            <Field label="Correo / Usuario" value={emp.email || emp.username} />
                            <Field label="Celular"          value={emp.phone} />
                            <Field label="Documento (DUI)"  value={emp.dui} />
                            <Field label="Sucursal"         value={branch?.name} />
                        </div>
                    </SectionCard>

                    {/* Emergencia */}
                    {(emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type) && (
                        <div className="bg-red-50/70 backdrop-blur-2xl border border-red-100/70 rounded-[2rem] p-5 shadow-[0_4px_20px_rgba(239,68,68,0.05)] hover:shadow-[0_8px_32px_rgba(239,68,68,0.10)] hover:-translate-y-0.5 transition-all duration-300">
                            <SectionLabel icon={HeartPulse} label="Emergencia" color="text-red-500" />
                            <div className="space-y-2">
                                <Field label="Avisar a"            value={emp.emergency_contact_name} />
                                <Field label="Teléfono emergencia" value={emp.emergency_contact_phone} />
                                {emp.blood_type && <Field label="Tipo de sangre" value={emp.blood_type} />}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── COLUMNA DERECHA ── */}
                <div className="flex-1 min-w-0 space-y-4">

                    {/* Datos laborales */}
                    <SectionCard>
                        <SectionLabel icon={Briefcase} label="Información Laboral" />
                        <div className="grid grid-cols-2 gap-2.5">
                            <Field label="Fecha de ingreso"    value={emp.hire_date  ? formatDate(emp.hire_date)  : null} />
                            <Field label="Fecha de nacimiento" value={emp.birth_date ? formatDate(emp.birth_date) : null} />
                            {emp.contract_type && <Field label="Tipo de contrato" value={emp.contract_type} />}
                            {emp.weekly_hours   && <Field label="Horas semanales"  value={`${emp.weekly_hours}h`} />}
                        </div>
                    </SectionCard>

                    {/* Timeline */}
                    <SectionCard>
                        <div className="flex items-center justify-between mb-5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                                <Clock size={10} /> Historial de Eventos
                            </p>
                            <span className="text-[10px] font-black text-slate-500 bg-slate-100/80 backdrop-blur-sm border border-slate-200/60 px-2.5 py-1 rounded-full">
                                {timeline.length} eventos
                            </span>
                        </div>

                        {evLoading ? (
                            <div className="flex justify-center py-12 gap-2 text-slate-400">
                                <Loader2 size={18} className="animate-spin" />
                                <span className="text-[12px] font-medium">Cargando historial…</span>
                            </div>
                        ) : timeline.length === 0 ? (
                            <div className="flex flex-col items-center py-12 gap-3 text-slate-400">
                                <Clock size={36} strokeWidth={1} />
                                <p className="text-[13px] font-bold text-slate-500">Sin eventos registrados</p>
                            </div>
                        ) : (
                            <div className="relative border-l-[3px] border-slate-200/70 ml-3 space-y-4 pb-2">
                                {timeline.map((ev, idx) => {
                                    const theme = EVENT_THEMES[ev.type] || DEFAULT_THEME;
                                    const label = ev.type === 'HIRING'
                                        ? 'Contratación Inicial'
                                        : (EVENT_TYPES[ev.type]?.label || ev.type);
                                    const meta        = typeof ev.metadata === 'object' && ev.metadata ? ev.metadata : {};
                                    const isCancelled = meta.status === 'CANCELLED';
                                    const isEdited    = meta.status === 'SUPERSEDED';

                                    return (
                                        <div key={ev.id || `ev-${idx}`} className="relative pl-7 group/ev">
                                            <div className={`absolute -left-[10px] top-2 w-4 h-4 rounded-full bg-white border-[3px] shadow-sm group-hover/ev:scale-125 transition-transform duration-300 z-10 ${theme.dot}`} />

                                            <div className={`bg-white/60 backdrop-blur-xl rounded-2xl p-4 border border-white/80 transition-all duration-300 shadow-sm hover:-translate-y-0.5 ${theme.glow} ${isCancelled || isEdited ? 'opacity-50' : ''}`}>
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border ${theme.bg} ${theme.text} ${theme.border}`}>
                                                        {label}
                                                    </span>
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-md border border-slate-100/80">
                                                        {formatDate(ev.date)}
                                                    </span>
                                                </div>

                                                <p className="text-[12px] text-slate-700 leading-relaxed font-semibold">
                                                    {ev.note || 'Evento registrado.'}
                                                </p>

                                                {meta.endDate && (
                                                    <p className="text-[11px] text-slate-400 font-medium mt-1.5 flex items-center gap-1.5">
                                                        <Calendar size={10} /> Hasta: {formatDate(meta.endDate)}
                                                    </p>
                                                )}

                                                {meta.permissionDates?.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {meta.permissionDates.map((d, i) => (
                                                            <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-lg text-[10px] font-black">
                                                                {formatDate(d)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {meta.old_value && meta.new_value && (
                                                    <p className="text-[11px] font-medium text-slate-500 mt-2 bg-white/70 backdrop-blur-sm p-2 rounded-lg border border-slate-100/80 flex gap-2 items-center">
                                                        <span className="font-bold line-through opacity-70">{meta.old_value}</span>
                                                        <ArrowRightLeft size={10} />
                                                        <span className="font-bold text-[#007AFF]">{meta.new_value}</span>
                                                    </p>
                                                )}

                                                {(isCancelled || isEdited) && (
                                                    <span className={`mt-2 inline-block px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${isCancelled ? 'bg-red-100 text-red-500' : 'bg-slate-200 text-slate-500'}`}>
                                                        {isCancelled ? 'Cancelado' : 'Editado'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </SectionCard>
                </div>
            </div>
        </GlassViewLayout>
    );
};

export default EmployeeProfileView;
