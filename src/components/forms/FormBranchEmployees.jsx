import React, { useMemo } from 'react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { Users, Shield, Star, Stethoscope, Briefcase, ArrowUpRight, AlertCircle, Building2, Globe } from 'lucide-react';

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

const FormBranchEmployees = ({ formData, onClose, setView, setActiveEmployee }) => {
    const employees = useStaff(state => state.employees) || [];
    const branchId = String(formData?.id);

    const { plantSlots, opSlots } = useMemo(() => {
        const settings = safeParse(formData?.settings);
        const legal = settings.legal || {};
        
        const hasInjections = settings.services?.inyecciones || settings.services?.injections || false;

        let jefe = null;
        let subJefe = null;
        let regenteFarmacia = employees.find(e => e.id === legal.regentEmployeeId) || null;
        let referenteFarma = employees.find(e => e.id === legal.pharmacovigilanceEmployeeId) || null;
        let enfermeros = employees.filter(e => (legal.nurses || []).includes(e.id));
        let dependientes = [];
        let globals = [];

        employees.forEach(e => {
            const roleUp = (e.role || '').toUpperCase();
            const isBranchDirect = String(e.branchId) === branchId || String(e.branch_id) === branchId;

            if (roleUp.includes('GERENTE') || roleUp.includes('ADMIN') || roleUp.includes('SUPERVISOR')) {
                globals.push(e);
            } 
            else if (isBranchDirect) {
                if (roleUp.includes('JEFE') && !roleUp.includes('SUB')) jefe = e;
                else if (roleUp.includes('SUB JEFE') || roleUp.includes('SUBJEFE')) subJefe = e;
                else if (e.id !== legal.regentEmployeeId && e.id !== legal.pharmacovigilanceEmployeeId && !enfermeros.find(enf => enf.id === e.id)) {
                    dependientes.push(e);
                }
            }
        });

        const oSlots = [];
        globals.forEach(g => {
            let icon = Briefcase;
            let color = 'slate';
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
            if (enfermeros.length === 0) {
                pSlots.push({ id: 'enf-empty', roleName: 'Regente de Enfermería', employee: null, required: true, icon: Stethoscope, color: 'rose' });
            } else {
                enfermeros.forEach((enf, i) => {
                    pSlots.push({ id: `enf-${i}`, roleName: 'Regente de Enfermería', employee: enf, required: true, icon: Stethoscope, color: 'rose' });
                });
            }
        }

        if (dependientes.length === 0) {
            pSlots.push({ id: 'dep-empty', roleName: 'Dependientes', employee: null, required: true, icon: Users, color: 'cyan' });
        } else {
            dependientes.forEach((dep, i) => {
                pSlots.push({ id: `dep-${i}`, roleName: dep.role || 'Dependiente', employee: dep, required: false, icon: Users, color: 'cyan' });
            });
        }

        return { plantSlots: pSlots, opSlots: oSlots };
    }, [employees, branchId, formData]);

    const getInitials = (name) => {
        if (!name) return '??';
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    const handleViewEmployee = (emp) => {
        if (!emp) return; 
        if (setActiveEmployee) setActiveEmployee(emp);
        if (setView) setView('employee-detail'); 
        if (onClose) onClose();
    };

    return (
        <div className="w-full flex flex-col animate-in fade-in duration-300 space-y-8">
            
            {/* SECCIÓN 1: SOPORTE OPERATIVO */}
            <div>
                <div className="flex items-center gap-2 mb-4 px-1">
                    <Globe size={16} className="text-[#007AFF]" strokeWidth={2.5} />
                    <h3 className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Soporte Operativo & Global</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {opSlots.map((slot) => {
                        const emp = slot.employee;
                        const isMissing = !emp && slot.required;
                        
                        // 🚨 Buscamos la foto en las propiedades más comunes
                        const photoUrl = emp?.photo || emp?.avatar || emp?.profilePicture || null;

                        if (!emp) {
                            return (
                                <div key={slot.id} className="flex items-center gap-3 p-3 rounded-[1.2rem] bg-slate-50/50 border-2 border-dashed border-slate-300 opacity-80 h-full">
                                    <div className="w-10 h-10 rounded-[1rem] bg-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                                        <slot.icon size={16} strokeWidth={2.5} />
                                    </div>
                                    <div className="flex flex-col flex-1">
                                        <h4 className="text-[11px] font-bold text-slate-500 leading-tight whitespace-normal">{slot.roleName}</h4>
                                        <p className="text-[9px] font-black text-red-500 uppercase tracking-widest mt-0.5 flex items-center gap-1">
                                            <AlertCircle size={10} strokeWidth={3} /> No Asignado
                                        </p>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div 
                                key={slot.id} 
                                onClick={() => handleViewEmployee(emp)}
                                className="group cursor-pointer p-3 rounded-[1.2rem] bg-white/50 border border-white/90 shadow-[0_2px_10px_rgba(0,0,0,0.02),inset_0_1px_5px_rgba(255,255,255,0.8)] hover:bg-white hover:border-[#007AFF]/30 hover:shadow-md transition-all duration-300 flex items-center gap-3 active:scale-95 h-full"
                            >
                                {/* 🚨 AVATAR O FOTO (OPERATIVO) */}
                                <div className={`w-10 h-10 rounded-[1rem] flex items-center justify-center font-black text-xs border shadow-sm group-hover:scale-105 transition-transform shrink-0 overflow-hidden ${!photoUrl ? (COLOR_MAP[slot.color] || COLOR_MAP.slate) : 'bg-slate-100 border-slate-200 p-0'}`}>
                                    {photoUrl ? (
                                        <img src={photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                                    ) : (
                                        getInitials(emp.name)
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-[12px] font-bold text-slate-700 leading-tight group-hover:text-[#007AFF] transition-colors whitespace-normal">{emp.name}</h4>
                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1 leading-tight whitespace-normal">
                                        {slot.roleName}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* SECCIÓN 2: PERSONAL DE PLANTA */}
            <div className="pt-6 border-t border-slate-200/50">
                <div className="flex items-center gap-2 mb-4 px-1">
                    <Building2 size={16} className="text-[#007AFF]" strokeWidth={2.5} />
                    <h3 className="text-[11px] font-black text-slate-700 uppercase tracking-widest">Personal de Planta</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {plantSlots.map((slot) => {
                        const emp = slot.employee;
                        const isMissing = !emp && slot.required;
                        
                        // 🚨 Buscamos la foto en las propiedades más comunes
                        const photoUrl = emp?.photo || emp?.avatar || emp?.profilePicture || null;

                        if (!emp) {
                            return (
                                <div key={slot.id} className="flex items-center gap-4 p-4 rounded-[1.5rem] border-2 border-dashed border-slate-300 bg-slate-50/50 opacity-80 h-[88px]">
                                    <div className="w-12 h-12 rounded-[1rem] bg-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                                        <slot.icon size={20} strokeWidth={2.5} />
                                    </div>
                                    <div className="flex flex-col">
                                        <h4 className="text-[13px] font-bold text-slate-500 whitespace-normal">{slot.roleName}</h4>
                                        <p className={`text-[9px] font-black uppercase tracking-widest mt-1 flex items-center gap-1.5 ${isMissing ? 'text-red-500' : 'text-slate-400'}`}>
                                            {isMissing && <AlertCircle size={12} strokeWidth={3} />}
                                            {isMissing ? 'No Asignado' : 'Opcional'}
                                        </p>
                                    </div>
                                </div>
                            );
                        }

                        return (
                            <div 
                                key={slot.id} 
                                onClick={() => handleViewEmployee(emp)}
                                className="group cursor-pointer p-4 rounded-[1.5rem] bg-white/60 backdrop-blur-md border border-white/90 shadow-[0_4px_20px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)] hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(0,122,255,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-white transition-all duration-300 flex items-center gap-4 h-[88px] active:scale-95"
                            >
                                {/* 🚨 AVATAR O FOTO (PLANTA) */}
                                <div className={`w-12 h-12 rounded-[1rem] border flex items-center justify-center font-black text-lg shadow-inner group-hover:scale-105 transition-transform duration-300 shrink-0 overflow-hidden ${!photoUrl ? (COLOR_MAP[slot.color] || COLOR_MAP.slate) : 'bg-slate-100 border-slate-200 p-0'}`}>
                                    {photoUrl ? (
                                        <img src={photoUrl} alt={emp.name} className="w-full h-full object-cover" />
                                    ) : (
                                        getInitials(emp.name)
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <h4 className="text-[14px] font-black text-slate-800 leading-tight group-hover:text-[#007AFF] transition-colors whitespace-normal">{emp.name}</h4>
                                    <div className="flex items-center gap-2 mt-1.5">
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 whitespace-normal">
                                            {slot.roleName}
                                        </span>
                                    </div>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-[#007AFF] group-hover:text-white transition-colors shadow-sm shrink-0">
                                    <ArrowUpRight size={16} strokeWidth={2.5} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default FormBranchEmployees;