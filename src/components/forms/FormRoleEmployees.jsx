import React from 'react';
import { User, ShieldCheck } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore'; // ✅ Corregido para usar Zustand

const FormRoleEmployees = ({ formData }) => {
    const { employees } = useStaff();
    const role = formData?.role;

    if (!role) return null;

    // Filtramos los empleados que tienen asignado este cargo exacto
    const employeesInRole = employees.filter(e => e.role === role.name);

    return (
        <div className="flex flex-col w-full">
            {/* Header Interno Decorativo */}
            <div className="relative p-8 md:p-10 pb-8 overflow-hidden bg-gradient-to-b from-[#007AFF]/5 to-transparent border-b border-slate-100/50 rounded-t-[2.5rem]">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#007AFF]/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="relative flex items-center gap-5">
                    <div className="w-16 h-16 rounded-[1.2rem] bg-[#007AFF] text-white flex items-center justify-center shadow-[0_8px_20px_rgba(0,122,255,0.3)] shrink-0">
                        <ShieldCheck size={32} strokeWidth={1.5} />
                    </div>
                    <div>
                        <h3 className="text-[22px] md:text-[26px] font-black text-slate-800 uppercase tracking-tighter leading-none mb-1.5 pr-8">
                            {role.name}
                        </h3>
                        <p className="text-[10px] md:text-[11px] font-black text-[#007AFF] uppercase tracking-widest flex items-center gap-1.5">
                            Personal Asignado ({employeesInRole.length})
                        </p>
                    </div>
                </div>
            </div>

            {/* Lista de Empleados */}
            <div className="p-8 md:p-10 space-y-3 bg-slate-50/30 rounded-b-[2.5rem]">
                {employeesInRole.length > 0 ? (
                    employeesInRole.map(emp => (
                        <div 
                            key={emp.id} 
                            className="flex items-center justify-between p-4 bg-white rounded-[1.5rem] border border-slate-100 shadow-sm group hover:border-[#007AFF]/30 hover:shadow-md transition-all"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-[1rem] bg-slate-100 border-2 border-white shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center font-bold text-slate-400">
                                    {emp.photo ? (
                                        <img src={emp.photo} className="w-full h-full object-cover" alt="Perfil" />
                                    ) : (
                                        emp.name.charAt(0)
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-[14px] md:text-[15px] leading-tight group-hover:text-[#007AFF] transition-colors">
                                        {emp.name}
                                    </p>
                                    <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
                                        {emp.code || 'SIN CÓDIGO'}
                                    </p>
                                </div>
                            </div>
                            
                            <div className="px-3 py-1.5 md:px-4 md:py-2 bg-slate-50 text-slate-400 rounded-xl text-[8px] md:text-[9px] font-black uppercase tracking-widest border border-slate-100 group-hover:bg-[#007AFF]/5 group-hover:text-[#007AFF] group-hover:border-[#007AFF]/20 transition-all">
                                Activo
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="text-center py-12 bg-white/60 backdrop-blur-md rounded-[2rem] border-2 border-dashed border-slate-200">
                        <User className="mx-auto text-slate-300 mb-4" size={40} strokeWidth={1.5} />
                        <p className="text-slate-500 font-bold text-[15px]">No hay colaboradores asignados.</p>
                        <p className="text-[10px] text-slate-400 mt-1.5 uppercase tracking-widest font-bold px-4">
                            Puedes asignar este cargo desde la edición del perfil de empleado.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormRoleEmployees;