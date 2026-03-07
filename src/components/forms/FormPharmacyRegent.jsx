import React, { useMemo } from 'react';
import { UploadCloud, Users } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const FormPharmacyRegent = ({ formData, setFormData, onClose }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};

    const possibleRegents = useMemo(() => {
        return employees.filter(emp => {
            const role = (emp.role || '').toUpperCase();
            return role.includes('REGENTE') && !role.includes('ENFERMER');
        });
    }, [employees]);

    const updateLegalField = (field, value) => {
        setFormData({
            ...formData,
            settings: {
                ...(formData.settings || {}),
                legal: { ...legalData, [field]: value }
            }
        });
    };

    if (possibleRegents.length === 0) {
        return (
            <div className="bg-red-50 border border-red-200 p-8 rounded-[2rem] flex flex-col items-center text-center mt-4 shadow-sm">
                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center text-red-500 mb-5">
                    <Users size={28} strokeWidth={1.5} />
                </div>
                <h3 className="text-[16px] font-black text-red-800 mb-2">Ningún Profesional Disponible</h3>
                <p className="text-[13px] font-medium text-red-600/90 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Regente Farmacéutico en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <button type="button" onClick={onClose} className="px-8 py-3 bg-red-600 text-white font-bold text-[11px] uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-500/30 active:scale-95">
                    Entendido, Cerrar
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                    Regente Asignado a la Sucursal
                </label>
                <select 
                    className="w-full px-4 py-3.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] focus:ring-4 focus:ring-[#007AFF]/10 transition-all font-semibold text-slate-800 cursor-pointer text-[14px] appearance-none"
                    value={legalData.regentEmployeeId || ""}
                    onChange={(e) => updateLegalField('regentEmployeeId', e.target.value)}
                >
                    <option value="">-- Sin Asignar --</option>
                    {possibleRegents.map(emp => (
                        <option key={emp.id} value={emp.id}>
                            {emp.name} {emp.branchId && String(emp.branchId) !== String(formData.id) ? `(Actual en otra sede)` : ''}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                    Fecha de Vencimiento Credencial JVQF
                </label>
                <input 
                    type="date" 
                    className="w-full px-4 py-3.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] focus:ring-4 focus:ring-[#007AFF]/10 transition-all text-[14px] text-slate-800 font-semibold" 
                    value={legalData.regentCredentialExp || ""} 
                    onChange={(e) => updateLegalField('regentCredentialExp', e.target.value)} 
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                        Credencial JVQF (PDF/IMG)
                    </label>
                    <div className="flex items-center gap-3 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 hover:bg-slate-50 hover:border-[#007AFF]/30 transition-colors group">
                        <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors text-[#007AFF]">
                            <UploadCloud size={16} strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                            {legalData.regentCredentialFile ? (
                                <p className="text-[11px] text-[#007AFF] font-bold truncate">{legalData.regentCredentialFile.name}</p>
                            ) : legalData.regentCredentialUrl ? (
                                <p className="text-[11px] text-emerald-600 font-bold truncate">Archivo guardado</p>
                            ) : (
                                <p className="text-[11px] text-slate-400 font-semibold">Subir archivo...</p>
                            )}
                        </div>
                        <input 
                            type="file" accept="application/pdf,image/*" 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            onChange={(e) => updateLegalField('regentCredentialFile', e.target.files?.[0] || null)} 
                        />
                    </div>
                </div>

                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                        Inscripción de Regencia (PDF)
                    </label>
                    <div className="flex items-center gap-3 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 hover:bg-slate-50 hover:border-[#007AFF]/30 transition-colors group">
                        <div className="p-2 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors text-purple-600">
                            <UploadCloud size={16} strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                            {legalData.regentInscriptionFile ? (
                                <p className="text-[11px] text-purple-700 font-bold truncate">{legalData.regentInscriptionFile.name}</p>
                            ) : legalData.regentInscriptionUrl ? (
                                <p className="text-[11px] text-emerald-600 font-bold truncate">Archivo guardado</p>
                            ) : (
                                <p className="text-[11px] text-slate-400 font-semibold">Subir archivo...</p>
                            )}
                        </div>
                        <input 
                            type="file" accept="application/pdf,image/*" 
                            className="absolute inset-0 opacity-0 cursor-pointer" 
                            onChange={(e) => updateLegalField('regentInscriptionFile', e.target.files?.[0] || null)} 
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FormPharmacyRegent;