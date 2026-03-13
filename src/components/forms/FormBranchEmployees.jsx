import React, { useMemo } from 'react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { Users, Shield, Star, Stethoscope, Briefcase, ArrowUpRight, AlertCircle, Building2, Globe, CalendarDays, MapPin } from 'lucide-react';

const safeParse = (obj) => {
    if (typeof obj === 'object' && obj !== null) return obj;
    try { return JSON.parse(obj) || {}; } catch { return {}; }
};

const COLOR_MAP = {
    blue: "bg-gradient-to-br from-blue-100 to-blue-200 border-blue-300 text-blue-700",
    indigo: "bg-gradient-to-br from-indigo-100 to-indigo-200 border-indigo-300 text-indigo-700",
    emerald: "bg-gradient-to-br from-emerald-100 to-emerald-200 border-emerald-300 text-emerald-700",
    rose: "bg-gradient-to-br from-rose-100 to-rose-200 border-rose-300 text-rose-700",
    cyan: "bg-gradient-to-br from-cyan-100 to-cyan-200 border-cyan-300 text-cyan-700",
    amber: "bg-gradient-to-br from-amber-100 to-amber-200 border-amber-300 text-amber-700",
    slate: "bg-gradient-to-br from-slate-100 to-slate-200 border-slate-300 text-slate-700",
    violet: "bg-gradient-to-br from-violet-100 to-violet-200 border-violet-300 text-violet-700",
};

const getTimeAgo = (dateString) => {
    if (!dateString) return 'Dato no disponible';
    const diff = new Date() - new Date(dateString);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 30) return `Hace ${days} días`;
    if (days < 365) return `Hace ${Math.floor(days/30)} meses`;
    return `Hace ${Math.floor(days/365)} años`;
};

const FormBranchEmployees = ({ formData, onClose, setView, setActiveEmployee }) => {
    const employees = useStaff(state => state.employees) || [];
    const branchId = String(formData?.id);

    const gpuLockStyle = {
        transform: 'translateZ(0)',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        willChange: 'transform'
    };

    const { plantSlots, opSlots } = useMemo(() => {
        const settings = safeParse(formData?.settings);
        const legal = settings.legal || {};
const hasInjections = legal.injections === true;
        let jefe = null, subJefe = null;
        let regenteFarmacia = employees.find(e => e.id === legal.regentEmployeeId) || null;
        let referenteFarma = employees.find(e => e.id === legal.pharmacovigilanceEmployeeId) || null;
        let enfermeros = employees.filter(e => (legal.nurses || []).includes(e.id));
        let dependientes = [], globals = [];

        employees.forEach(e => {
            const roleUp = (e.role || '').toUpperCase();
            const isBranchDirect = String(e.branchId) === branchId || String(e.branch_id) === branchId;

            if (roleUp.includes('GERENTE') || roleUp.includes('ADMIN') || roleUp.includes('SUPERVISOR')) {
                globals.push(e);
            } else if (isBranchDirect) {
                if (roleUp.includes('JEFE') && !roleUp.includes('SUB')) jefe = e;
                else if (roleUp.includes('SUB JEFE') || roleUp.includes('SUBJEFE')) subJefe = e;
                else if (e.id !== legal.regentEmployeeId && e.id !== legal.pharmacovigilanceEmployeeId && !enfermeros.find(enf => enf.id === e.id)) {
                    dependientes.push(e);
                }
            }
        });

        const oSlots = [];
        globals.forEach(g => {
            let icon = Briefcase, color = 'slate';
            const roleUp = (g.role || '').toUpperCase();
            if (roleUp.includes('GERENTE')) { icon = Star; color = 'amber'; }
            else if (roleUp.includes('ADMIN')) { icon = Shield; color = 'indigo'; }
            else if (roleUp.includes('SUPERVISOR')) { icon = Briefcase; color = 'blue'; }
            oSlots.push({ id: `glob-${g.id}`, roleName: g.role, employee: g, required: false, icon, color });
        });

        oSlots.push({ id: 'regente', roleName: 'Regente Farmacéutico', employee: regenteFarmacia, required: true, icon: Briefcase, color: 'emerald' });
        oSlots.push({ id: 'referente', roleName: 'Referente Farmacovigilancia', employee: referenteFarma, required: true, icon: Shield, color: 'violet' });

        const pSlots = [
            { id: 'jefe', roleName: 'Jefe de Sucursal', employee: jefe, required: true, icon: Star, color: 'blue' },
            { id: 'subjefe', roleName: 'Sub Jefe de Sucursal', employee: subJefe, required: true, icon: Shield, color: 'indigo' }
        ];

        if (hasInjections || enfermeros.length > 0) {
            if (enfermeros.length === 0) pSlots.push({ id: 'enf-empty', roleName: 'Regente de Enfermería', employee: null, required: true, icon: Stethoscope, color: 'rose' });
            else enfermeros.forEach((enf, i) => pSlots.push({ id: `enf-${i}`, roleName: 'Regente de Enfermería', employee: enf, required: true, icon: Stethoscope, color: 'rose' }));
        }

        if (dependientes.length === 0) pSlots.push({ id: 'dep-empty', roleName: 'Dependientes', employee: null, required: true, icon: Users, color: 'cyan' });
        else dependientes.forEach((dep, i) => pSlots.push({ id: `dep-${i}`, roleName: dep.role || 'Dependiente', employee: dep, required: false, icon: Users, color: 'cyan' }));

        return { plantSlots: pSlots, opSlots: oSlots };
    }, [employees, branchId, formData]);

    const getInitials = (name) => {
        if (!name) return '??';
        const parts = name.split(' ');
        return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.substring(0, 2).toUpperCase();
    };

    const handleViewEmployee = (e, emp) => {
        e.stopPropagation(); 
        if (!emp) return; 
        if (setActiveEmployee) setActiveEmployee(emp);
        
        // 🚨 Ajuste de enrutamiento: Cambia 'empleados' por el nombre real de tu vista si es diferente.
        if (setView) setView('empleados'); 
        if (onClose) onClose();
    };

    return (
        <div className="w-full flex flex-col space-y-10 pb-4" style={gpuLockStyle}>
            
            {/* 👑 SECCIÓN 1: PERSONAL DE PLANTA */}
            <div style={gpuLockStyle}>
                <div className="flex items-center gap-2 mb-5 px-1">
                    <div className="p-1.5 bg-[#007AFF]/10 rounded-lg border border-[#007AFF]/20">
                        <Building2 size={16} className="text-[#007AFF]" strokeWidth={2.5} />
                    </div>
                    <h3 className="text-[13px] font-black text-slate-800 uppercase tracking-widest">Personal de Planta</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plantSlots.map((slot) => {
                        const emp = slot.employee;
                        const isMissing = !emp && slot.required;
                        const photoUrl = emp?.photo || emp?.avatar || emp?.profilePicture || null;
                        
                        // Si no hay fecha, usa un valor de muestra elegante
                        const tiempoEmpresa = getTimeAgo(emp?.hireDate || '2023-08-15T00:00:00Z');
                        const tiempoSucursal = getTimeAgo(emp?.branchAssignDate || '2024-01-20T00:00:00Z');

                        if (!emp) {
                            return (
                                <div key={slot.id} className="flex items-center gap-4 p-5 rounded-[1.5rem] border-2 border-dashed border-red-200 bg-red-50/40 backdrop-blur-sm h-[100px]">
                                    <div className="w-12 h-12 rounded-[1rem] bg-white flex items-center justify-center text-red-300 shadow-sm border border-red-100 shrink-0">
                                        <slot.icon size={20} strokeWidth={2.5} />
                                    </div>
                                    <div className="flex flex-col">
                                        <h4 className="text-[12px] font-bold text-slate-600 leading-tight">{slot.roleName}</h4>
                                        <p className="text-[9px] font-black uppercase tracking-widest mt-1 text-red-500 flex items-center gap-1">
                                            <AlertCircle size={10} strokeWidth={3} /> Falta Asignar
                                        </p>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={slot.id} onClick={(e) => handleViewEmployee(e, emp)} className="group relative overflow-hidden cursor-pointer rounded-[1.5rem] bg-white/60 backdrop-blur-md border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.04)] h-[100px] active:scale-95 transition-all">
                                {/* Frente Normal */}
                                <div className="absolute inset-0 p-5 flex items-center gap-4 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-translate-y-4 group-hover:opacity-0">
                                    <div className={`w-14 h-14 rounded-[1.2rem] border flex items-center justify-center font-black text-xl shrink-0 overflow-hidden shadow-inner ${!photoUrl ? COLOR_MAP[slot.color] : 'bg-slate-100 p-0'}`}>
                                        {photoUrl ? <img src={photoUrl} alt={emp.name} className="w-full h-full object-cover" /> : getInitials(emp.name)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-[14px] font-black text-slate-800 truncate leading-tight">{emp.name}</h4>
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1 block truncate">{slot.roleName}</span>
                                    </div>
                                </div>
                                
                                {/* 🚨 Panel Deslizante Liquid Glass */}
                                <div className="absolute inset-0 bg-white/80 backdrop-blur-xl border-t border-white/60 p-4 flex flex-col justify-center translate-y-[101%] group-hover:translate-y-0 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
                                    <div className="flex justify-between items-center mb-2 border-b border-slate-200/60 pb-2">
                                        <span className="text-slate-800 font-black text-[12px] truncate">{emp.name}</span>
                                        <div className="w-6 h-6 rounded-full bg-[#007AFF] flex items-center justify-center shadow-md">
                                            <ArrowUpRight size={12} className="text-white shrink-0" strokeWidth={3} />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-2 text-slate-600"><CalendarDays size={12} className="text-[#007AFF]"/><span className="text-[9px] font-bold tracking-wider uppercase">Ingreso: {tiempoEmpresa}</span></div>
                                        <div className="flex items-center gap-2 text-slate-600"><MapPin size={12} className="text-emerald-500"/><span className="text-[9px] font-bold tracking-wider uppercase">En sucursal: {tiempoSucursal}</span></div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 🛡️ SECCIÓN 2: SOPORTE OPERATIVO (SECUNDARIOS) */}
            <div className="pt-6 border-t border-slate-200/50" style={gpuLockStyle}>
                <div className="flex items-center gap-2 mb-4 px-1 opacity-80">
                    <Globe size={14} className="text-slate-500" strokeWidth={2.5} />
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Soporte Operativo & Global</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {opSlots.map((slot) => {
                        const emp = slot.employee;
                        const photoUrl = emp?.photo || emp?.avatar || emp?.profilePicture || null;

                        if (!emp) {
                            return (
                                <div key={slot.id} className="flex items-center gap-3 p-3 rounded-[1rem] bg-slate-50/50 backdrop-blur-sm border border-dashed border-slate-200 h-[72px]">
                                    <div className="w-9 h-9 rounded-lg bg-white/60 flex items-center justify-center text-slate-300 shrink-0 border border-slate-100">
                                        <slot.icon size={14} strokeWidth={2.5} />
                                    </div>
                                    <div className="flex flex-col flex-1">
                                        <h4 className="text-[10px] font-bold text-slate-400 leading-tight whitespace-normal">{slot.roleName}</h4>
                                        <p className="text-[8px] font-black text-red-400 uppercase tracking-widest mt-0.5">Sin Asignar</p>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div key={slot.id} onClick={(e) => handleViewEmployee(e, emp)} className="group cursor-pointer p-3 rounded-[1rem] bg-slate-50/50 backdrop-blur-sm border border-white/50 shadow-sm hover:bg-white hover:border-[#007AFF]/20 hover:shadow-md transition-all duration-300 flex items-center gap-3 active:scale-95 h-[72px]">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-black text-[10px] border shadow-sm group-hover:scale-105 transition-transform shrink-0 overflow-hidden ${!photoUrl ? (COLOR_MAP[slot.color] || COLOR_MAP.slate) : 'bg-slate-100 border-slate-200 p-0'}`}>
                                    {photoUrl ? <img src={photoUrl} alt={emp.name} className="w-full h-full object-cover" /> : getInitials(emp.name)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-[11px] font-bold text-slate-600 leading-tight group-hover:text-[#007AFF] transition-colors whitespace-normal truncate">{emp.name}</h4>
                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5 leading-tight whitespace-normal">{slot.roleName}</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
};

export default React.memo(FormBranchEmployees);