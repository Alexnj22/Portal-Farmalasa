import React from 'react';
import { webpSignedUrl } from '../../utils/storageFiles';
import { User, ShieldCheck } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore'; // ✅ Corregido para usar Zustand
import { shortEmployeeName, employeeInitials } from '../../utils/nameUtils';

const FormRoleEmployees = ({ formData }) => {
    const { employees, branches = [] } = useStaff();
    const role = formData?.role;
    // Debajo del nombre iba el código de carné. Dejó de ir porque ese código es
    // la contraseña del portal (`login()` entra con él), y esta lista la abre
    // cualquiera que pueda ver un cargo. La sucursal dice lo mismo que hacía
    // falta saber acá —dónde está esa persona— y no es una credencial.
    const nombreSala = React.useMemo(
        () => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches],
    );

    if (!role) return null;

    // Filtramos los empleados que tienen asignado este cargo exacto
    const employeesInRole = employees.filter(e => e.role === role.name);

    return (
        <div className="flex flex-col w-full">
            {/* Header Interno Decorativo */}
            <div className="relative p-8 md:p-10 pb-8 overflow-hidden bg-gradient-to-b from-brand/5 to-transparent border-b border-divider rounded-t-[2.5rem]">
                <div className="absolute top-0 right-0 w-64 h-64 bg-brand/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                <div className="relative flex items-center gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-brand text-white flex items-center justify-center shadow-[var(--shadow-glow-brand)] shrink-0">
                        <ShieldCheck size={32} strokeWidth={1.5} />
                    </div>
                    <div>
                        <h3 className="text-title-lg md:text-display font-black text-content uppercase tracking-tighter leading-none mb-1.5 pr-8">
                            {role.name}
                        </h3>
                        <p className="text-caption md:text-label font-black text-brand-text uppercase tracking-widest flex items-center gap-1.5">
                            Personal Asignado ({employeesInRole.length})
                        </p>
                    </div>
                </div>
            </div>

            {/* Lista de Empleados */}
            <div className="p-8 md:p-10 space-y-3 bg-surface-card-hover/30 rounded-b-[2.5rem]">
                {employeesInRole.length > 0 ? (
                    employeesInRole.map(emp => (
                        <div 
                            key={emp.id} 
                            data-surface="card" className="flex items-center justify-between p-4 group hover:border-brand/30 transition-all"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-surface-card-hover border-2 border-border-card shadow-sm overflow-hidden flex-shrink-0 flex items-center justify-center font-bold text-content-3">
                                    {emp.photo ? (
                                        <img src={webpSignedUrl(emp.photo)} className="w-full h-full object-cover" alt="Perfil" />
                                    ) : (
                                        employeeInitials(emp)
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold text-content text-body-lg md:text-subtitle leading-tight group-hover:text-brand-text transition-colors">
                                        {shortEmployeeName(emp)}
                                    </p>
                                    <p className="text-micro md:text-caption font-black text-content-2 uppercase tracking-widest mt-0.5">
                                        {nombreSala[emp.branch_id] || 'SIN SUCURSAL'}
                                    </p>
                                </div>
                            </div>
                            
                            <div className="px-3 py-1.5 md:px-4 md:py-2 bg-surface-card-hover text-content-2 rounded-xl text-micro md:text-micro font-black uppercase tracking-widest border border-divider group-hover:bg-brand/5 group-hover:text-brand-text group-hover:border-brand/20 transition-all">
                                Activo
                            </div>
                        </div>
                    ))
                ) : (
                    <div data-surface="card" data-tono="dashed" className="text-center py-12">
                        <User className="mx-auto text-content-3 mb-4" size={40} strokeWidth={1.5} />
                        <p className="text-content-3 font-bold text-subtitle">No hay empleados asignados.</p>
                        <p className="text-caption text-content-2 mt-1.5 uppercase tracking-widest font-bold px-4">
                            Puedes asignar este cargo desde la edición del perfil de empleado.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormRoleEmployees;