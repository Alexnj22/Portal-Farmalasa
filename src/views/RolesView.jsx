import React, { useState } from 'react';
import { ShieldCheck, Plus, Trash2, Award, Users, Search } from 'lucide-react';
import { useStaff } from '../context/StaffContext';

const RolesView = () => {
    const { roles, employees } = useStaff();
    const [newRole, setNewRole] = useState('');

    const getEmployeeCountByRole = (roleName) => {
        return employees.filter(e => e.role === roleName).length;
    };

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            <header>
                <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                    <ShieldCheck className="text-blue-600" /> Estructura de Cargos
                </h1>
                <p className="text-slate-500 text-sm font-medium">Define los niveles jerárquicos de la farmacia</p>
            </header>

            {/* Input para nuevo Rol */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <Award className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input 
                        type="text" 
                        placeholder="Ej: Regente Farmacéutico, Dependiente, Cajero..." 
                        className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                    />
                </div>
                <button 
                    className="w-full md:w-auto bg-slate-900 hover:bg-black text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                    <Plus size={16}/> Agregar Cargo
                </button>
            </div>

            {/* Lista de Roles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {roles.map((role, idx) => {
                    const count = getEmployeeCountByRole(role);
                    return (
                        <div key={idx} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-blue-300 transition-all">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all">
                                    <Users size={20}/>
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 uppercase text-xs tracking-tight">{role}</h4>
                                    <p className="text-[10px] text-slate-400 font-black uppercase">{count} Colaboradores</p>
                                </div>
                            </div>
                            <button className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                                <Trash2 size={18}/>
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 flex items-start gap-4">
                <ShieldCheck size={24} className="text-blue-600 mt-1"/>
                <div>
                    <h5 className="font-bold text-blue-900 text-sm">Nota de Seguridad</h5>
                    <p className="text-blue-700/70 text-xs leading-relaxed mt-1">
                        Los cargos definen la jerarquía en los reportes de asistencia. Asegúrese de que cada empleado tenga un cargo válido para generar correctamente la pre-nómina.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default RolesView;