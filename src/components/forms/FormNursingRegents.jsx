import React, { useMemo } from 'react';
import { Plus, Trash2, UploadCloud } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const FormNursingRegents = ({ formData, setFormData }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};
    const nursingRegents = legalData.nursingRegents || [];

    const possibleNurses = useMemo(() => {
        return employees.filter(emp => (emp.role || '').toUpperCase().includes('ENFERMER'));
    }, [employees]);

    const updateLegalField = (field, value) => {
        setFormData({
            ...formData,
            settings: { ...(formData.settings || {}), legal: { ...legalData, [field]: value } }
        });
    };

    const addNurse = () => updateLegalField('nursingRegents', [...nursingRegents, { id: Date.now(), employeeId: '', anualidadExp: '' }]);
    
    const removeNurse = (index) => {
        const newArr = [...nursingRegents];
        newArr.splice(index, 1);
        updateLegalField('nursingRegents', newArr);
    };

    const updateNurse = (index, field, value) => {
        const newArr = [...nursingRegents];
        newArr[index] = { ...newArr[index], [field]: value };
        updateLegalField('nursingRegents', newArr);
    };

    return (
        <div className="space-y-6">
            {/* PERMISO DEL ESTABLECIMIENTO */}
            <div className="bg-slate-50 border border-slate-200 p-5 rounded-[1.5rem]">
                <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-800 mb-4 border-b border-slate-200 pb-2">
                    Permiso de Servicios de Enfermería
                </h4>
                <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">N° Permiso</label>
                            <input type="text" className="w-full px-4 py-3 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-blue-400 transition-all text-[14px] font-mono font-semibold" value={legalData.nursingServicePermit || ""} onChange={(e) => updateLegalField('nursingServicePermit', e.target.value)} />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Vencimiento</label>
                            <input type="date" className="w-full px-4 py-3 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-blue-400 transition-all text-[14px] font-semibold" value={legalData.nursingServicePermitExp || ""} onChange={(e) => updateLegalField('nursingServicePermitExp', e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Permiso Físico (PDF/IMG)</label>
                        <div className="flex items-center gap-2 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-white px-4 py-3 hover:bg-blue-50 transition-colors">
                            <UploadCloud size={16} className="text-blue-500 shrink-0" />
                            <p className="text-[11px] font-semibold text-slate-500 truncate flex-1">{legalData.nursingServicePermitFile ? legalData.nursingServicePermitFile.name : legalData.nursingServicePermitUrl ? "Archivo adjunto" : "Subir archivo..."}</p>
                            <input type="file" accept="application/pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateLegalField('nursingServicePermitFile', e.target.files?.[0] || null)} />
                        </div>
                    </div>
                </div>
            </div>

            {/* ARREGLO DE ENFERMEROS */}
            <div>
                <div className="flex items-center justify-between mb-4 px-1">
                    <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800">Profesionales Asignados</h4>
                    <button type="button" onClick={addNurse} className="text-[10px] font-black bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 uppercase tracking-widest shadow-sm">
                        <Plus size={14} strokeWidth={2.5}/> Añadir Profesional
                    </button>
                </div>
                
                <div className="space-y-4">
                    {nursingRegents.map((nurse, index) => (
                        <div key={nurse.id || index} className="bg-white border border-slate-200 p-5 rounded-[1.5rem] relative group shadow-sm transition-all hover:shadow-md">
                            <button type="button" onClick={() => removeNurse(index)} className="absolute -top-3 -right-3 bg-white border border-red-200 text-red-500 p-2 rounded-full shadow-sm hover:bg-red-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100 z-10">
                                <Trash2 size={16} strokeWidth={2}/>
                            </button>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Colaborador</label>
                                    <select className="w-full px-4 py-3 rounded-[1rem] bg-slate-50 border border-slate-200 text-[14px] font-bold text-slate-800 outline-none focus:border-blue-400 focus:bg-white appearance-none" value={nurse.employeeId} onChange={(e) => updateNurse(index, 'employeeId', e.target.value)}>
                                        <option value="">-- Seleccionar Profesional --</option>
                                        {possibleNurses.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                                    </select>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                                    {/* Carnet */}
                                    <div>
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Carné JVQE (PDF/IMG)</label>
                                        <div className="flex items-center gap-2 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-white transition-colors">
                                            <UploadCloud size={14} className="text-slate-400 shrink-0" />
                                            <p className="text-[11px] font-semibold text-slate-600 truncate flex-1">{nurse.carneFile ? nurse.carneFile.name : nurse.carneUrl ? "Archivo guardado" : "Subir carné..."}</p>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateNurse(index, 'carneFile', e.target.files?.[0] || null)} />
                                        </div>
                                    </div>
                                    {/* Licencia */}
                                    <div>
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1.5 block">Licencia Regencia (PDF/IMG)</label>
                                        <div className="flex items-center gap-2 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-white transition-colors">
                                            <UploadCloud size={14} className="text-slate-400 shrink-0" />
                                            <p className="text-[11px] font-semibold text-slate-600 truncate flex-1">{nurse.licenciaFile ? nurse.licenciaFile.name : nurse.licenciaUrl ? "Archivo guardado" : "Subir licencia..."}</p>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateNurse(index, 'licenciaFile', e.target.files?.[0] || null)} />
                                        </div>
                                    </div>
                                </div>

                                {/* Anualidad y Fecha */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-amber-50/50 p-3 rounded-xl border border-amber-100">
                                    <div>
                                        <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest ml-1 mb-1.5 block">Recibo Anualidad (PDF)</label>
                                        <div className="flex items-center gap-2 cursor-pointer relative rounded-lg border border-amber-200 bg-white px-3 py-2 hover:bg-amber-50 transition-colors">
                                            <UploadCloud size={14} className="text-amber-500 shrink-0" />
                                            <p className="text-[11px] font-semibold text-amber-800 truncate flex-1">{nurse.anualidadFile ? nurse.anualidadFile.name : nurse.anualidadUrl ? "Archivo guardado" : "Subir recibo..."}</p>
                                            <input type="file" accept=".pdf,image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateNurse(index, 'anualidadFile', e.target.files?.[0] || null)} />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-black text-amber-700 uppercase tracking-widest ml-1 mb-1.5 block">Fecha Vencimiento Anualidad</label>
                                        <input type="date" className="w-full px-3 py-2 rounded-lg bg-white border border-amber-200 outline-none focus:border-amber-400 transition-all text-[12px] font-bold text-amber-900" value={nurse.anualidadExp || ""} onChange={(e) => updateNurse(index, 'anualidadExp', e.target.value)} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {nursingRegents.length === 0 && (
                        <div className="py-8 text-center border-2 border-dashed border-slate-200 rounded-[1.5rem] bg-slate-50/50">
                            <p className="text-[13px] font-bold text-slate-500">Sin profesionales asignados.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormNursingRegents;