import React, { useState } from 'react';
import { ShieldCheck, Award, Users, AlertTriangle, User, ChevronRight, Edit3 } from 'lucide-react';
// IMPORTANTE: Ajusta esta ruta si tu ConfirmModal está en otra carpeta
import ConfirmModal from '../../components/common/ConfirmModal'; 

const StaffCard = ({ employee, roleLabel, icon: Icon, colorTheme, onClick, isMissing, missingText, missingSub }) => {
    const themeMap = {
        blue: 'bg-blue-50 text-[#007AFF] border-blue-100',
        purple: 'bg-purple-50 text-purple-600 border-purple-100',
        emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        slate: 'bg-slate-100 text-slate-600 border-slate-200',
        red: 'bg-red-50 text-red-500 border-red-100'
    };

    if (isMissing) {
        return (
            <div onClick={onClick} className="flex items-center justify-between p-4 bg-red-50/50 border border-red-200 rounded-[1.5rem] cursor-pointer hover:shadow-md hover:border-red-300 transition-all group">
                <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-[1rem] flex items-center justify-center font-black text-xl shrink-0 border shadow-sm ${themeMap.red}`}>
                        <AlertTriangle size={20} strokeWidth={2.5}/>
                    </div>
                    <div>
                        <p className="text-[14px] font-bold text-red-800 leading-tight">{missingText}</p>
                        <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mt-0.5">{missingSub}</p>
                    </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-red-400 shadow-sm group-hover:bg-red-500 group-hover:text-white transition-colors">
                    <Edit3 size={14} strokeWidth={2.5}/>
                </div>
            </div>
        );
    }

    return (
        <div onClick={() => onClick(employee)} className="flex items-center justify-between p-4 bg-white/60 border border-white rounded-[1.5rem] shadow-sm cursor-pointer hover:shadow-md hover:border-[#007AFF]/30 transition-all group">
            <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-[1rem] flex items-center justify-center font-black text-xl shrink-0 border shadow-sm ${themeMap[colorTheme]}`}>
                    {employee.photo ? (
                        <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover rounded-[1rem]" />
                    ) : (
                        employee.name.charAt(0)
                    )}
                </div>
                <div>
                    <p className="text-[15px] font-bold text-slate-800 leading-tight group-hover:text-[#007AFF] transition-colors">{employee.name}</p>
                    <p className={`text-[10px] font-black uppercase tracking-widest mt-0.5 ${colorTheme === 'slate' ? 'text-slate-500' : themeMap[colorTheme].split(' ')[1]}`}>
                        {roleLabel || employee.role}
                    </p>
                </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-[#007AFF] group-hover:border-blue-200 transition-all">
                <ChevronRight size={16} strokeWidth={2.5}/>
            </div>
        </div>
    );
};

const TabStaff = ({ liveBranch, currentStaff, employees, goToProfile, openModal }) => {
    
    // ✅ ESTADO PARA CONTROLAR EL MODAL DE INFORMACIÓN
    const [infoAlert, setInfoAlert] = useState({ isOpen: false, title: '', message: '' });

    // Buscar Jefatura y Subjefatura
    const jefeEmp = currentStaff.find(e => {
        const r = String(e.role || '').toLowerCase();
        return r.includes('jefe') && !r.includes('subjefe');
    });

    const subjefeEmp = currentStaff.find(e => {
        const r = String(e.role || '').toLowerCase();
        return r.includes('subjefe');
    });

    // Extraer Roles Regulatorios
    const legalData = liveBranch?.settings?.legal || {};
    const regentEmp = employees.find(e => String(e.id) === String(legalData.regentEmployeeId));
    const referentEmp = employees.find(e => String(e.id) === String(legalData.farmacovigilanciaId));
    const nursingRegents = legalData.nursingRegents || [];

    // Extraer Resto del Equipo
    const generalStaff = currentStaff.filter(e => e.id !== jefeEmp?.id && e.id !== subjefeEmp?.id);

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative">
            
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/60 pb-6">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Organigrama de Sede</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Personal asignado a {liveBranch?.name}</p>
                </div>
                <div className="px-4 py-2 bg-blue-50 text-[#007AFF] rounded-xl border border-blue-100 shadow-sm flex items-center gap-2 font-black text-[11px] uppercase tracking-widest">
                    <Users size={16} strokeWidth={2.5}/> Personal Total: {currentStaff.length}
                </div>
            </div>

            {/* SECCIÓN 1: JEFATURA Y SUBJEFATURA */}
            <div className="space-y-4">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 ml-2">
                    <Award size={16} className="text-slate-400"/> Jefatura y Subjefatura
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Tarjeta Jefe */}
                    {jefeEmp ? (
                        <StaffCard employee={jefeEmp} roleLabel="Jefe de Sucursal" colorTheme="blue" onClick={goToProfile} />
                    ) : (
                        <StaffCard 
                            isMissing 
                            missingText="Falta Jefe/a de Sucursal" 
                            missingSub="Asignar desde Empleados" 
                            onClick={() => setInfoAlert({ 
                                isOpen: true, 
                                title: "Asignación de Jefatura", 
                                message: "Para asignar un Jefe, ve al Módulo de Empleados, edita el perfil del trabajador deseado y asígnale el cargo 'Jefe/a de Sala' seleccionando esta sucursal." 
                            })} 
                        />
                    )}

                    {/* Tarjeta Subjefe */}
                    {subjefeEmp ? (
                        <StaffCard employee={subjefeEmp} roleLabel="Subjefe de Sucursal" colorTheme="blue" onClick={goToProfile} />
                    ) : (
                        <StaffCard 
                            isMissing 
                            missingText="Falta Subjefe/a" 
                            missingSub="Asignar desde Empleados" 
                            onClick={() => setInfoAlert({ 
                                isOpen: true, 
                                title: "Asignación de Subjefatura", 
                                message: "Para asignar un Subjefe, ve al Módulo de Empleados, edita el perfil del trabajador deseado y asígnale el cargo 'Subjefe/a de Sala' seleccionando esta sucursal." 
                            })} 
                        />
                    )}
                </div>
            </div>

            {/* SECCIÓN 2: RESPONSABILIDAD REGULATORIA (SRS) */}
            <div className="space-y-4 pt-4 border-t border-white/60">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-[#007AFF] flex items-center gap-2 ml-2">
                    <ShieldCheck size={16}/> Área Regulatoria
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    
                    {regentEmp ? (
                        <StaffCard employee={regentEmp} roleLabel="Regente Farmacéutico" colorTheme="blue" onClick={goToProfile} />
                    ) : (
                        <StaffCard isMissing missingText="Falta Regente" missingSub="Requerido por SRS" onClick={() => openModal('editPharmacyRegent', liveBranch)} />
                    )}

                    {referentEmp ? (
                        <StaffCard employee={referentEmp} roleLabel="Farmacovigilancia" colorTheme="emerald" onClick={goToProfile} />
                    ) : (
                        <StaffCard isMissing missingText="Falta Referente" missingSub="Requerido por SRS" onClick={() => openModal('editPharmacovigilance', liveBranch)} />
                    )}

                    {nursingRegents.length > 0 ? (
                        nursingRegents.map((nurse, i) => {
                            const nEmp = employees.find(e => String(e.id) === String(nurse.employeeId));
                            if (!nEmp) return null;
                            return <StaffCard key={i} employee={nEmp} roleLabel="Regente de Enfermería" colorTheme="purple" onClick={goToProfile} />
                        })
                    ) : (
                        <StaffCard isMissing missingText="Falta Enfermero/a" missingSub="Req. si se inyecta" onClick={() => openModal('editNursingRegents', liveBranch)} />
                    )}
                </div>
            </div>

            {/* SECCIÓN 3: EQUIPO OPERATIVO GENERAL */}
            <div className="space-y-4 pt-4 border-t border-white/60">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2 ml-2">
                    <Users size={16} className="text-slate-400"/> Equipo Operativo
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {generalStaff.length > 0 ? (
                        generalStaff.map(emp => <StaffCard key={emp.id} employee={emp} colorTheme="slate" onClick={goToProfile} />)
                    ) : (
                        <div className="col-span-full p-8 border-2 border-dashed border-slate-200 rounded-[1.5rem] flex flex-col items-center justify-center text-slate-400 bg-white/40">
                            <User size={32} strokeWidth={1.5} className="mb-2"/>
                            <p className="text-[12px] font-bold uppercase tracking-widest">Sin personal operativo asignado</p>
                            <p className="text-[10px] font-semibold mt-1">Asigna dependientes y cajeros desde sus perfiles.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ✅ EL CONFIRM MODAL CIVILIZADO */}
            {infoAlert.isOpen && (
                <ConfirmModal 
                    isOpen={infoAlert.isOpen}
                    title={infoAlert.title}
                    message={infoAlert.message}
                    onClose={() => setInfoAlert({ isOpen: false, title: '', message: '' })}
                    onConfirm={() => setInfoAlert({ isOpen: false, title: '', message: '' })}
                    confirmText="Entendido"
                    hideCancel={true} // Si tu modal soporta ocultar el botón de cancelar, esto lo deja súper limpio
                />
            )}
        </div>
    );
};

export default TabStaff;