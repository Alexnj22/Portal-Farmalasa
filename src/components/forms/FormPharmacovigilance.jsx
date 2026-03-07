import React, { useMemo } from 'react';
import { UploadCloud, Users } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';

const FormPharmacovigilance = ({ formData, setFormData, onClose }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};

    const possibleReferents = useMemo(() => {
        return employees.filter(emp => (emp.role || '').toUpperCase().includes('REFERENTE'));
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

    if (possibleReferents.length === 0) {
        return (
            <div className="bg-amber-50 border border-amber-200 p-8 rounded-[2rem] flex flex-col items-center text-center mt-4 shadow-sm">
                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center text-amber-500 mb-5">
                    <Users size={28} strokeWidth={1.5} />
                </div>
                <h3 className="text-[16px] font-black text-amber-800 mb-2">Ningún Referente Disponible</h3>
                <p className="text-[13px] font-medium text-amber-700/90 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Referente de Farmacovigilancia en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <button type="button" onClick={onClose} className="px-8 py-3 bg-amber-500 text-white font-bold text-[11px] uppercase tracking-widest rounded-xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/30 active:scale-95">
                    Entendido, Cerrar
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                    Referente Técnico Asignado
                </label>
                <select 
                    className="w-full px-4 py-3.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-purple-400 focus:ring-4 focus:ring-purple-500/10 transition-all font-semibold text-slate-800 cursor-pointer text-[14px] appearance-none"
                    value={legalData.farmacovigilanciaId || ""}
                    onChange={(e) => updateLegalField('farmacovigilanciaId', e.target.value)}
                >
                    <option value="">-- Sin Asignar --</option>
                    {possibleReferents.map(emp => (
                        <option key={emp.id} value={emp.id}>
                            {emp.name} {emp.branchId && String(emp.branchId) !== String(formData.id) ? `(Actual en otra sede)` : ''}
                        </option>
                    ))}
                </select>
                <p className="mt-3 ml-1 text-[11px] text-slate-500 font-medium leading-relaxed">
                    El referente elabora y envía los reportes semestrales a la Dirección General.
                </p>
            </div>

            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                    Autorización de la SRS (PDF/IMG)
                </label>
                <div className="flex items-center gap-3 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 hover:bg-purple-50 hover:border-purple-200 transition-colors group">
                    <div className="p-2 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors text-purple-600">
                        <UploadCloud size={18} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                        {legalData.farmacovigilanciaAuthFile ? (
                            <p className="text-[13px] text-purple-700 font-bold truncate">{legalData.farmacovigilanciaAuthFile.name}</p>
                        ) : legalData.farmacovigilanciaAuthUrl ? (
                            <p className="text-[13px] text-emerald-600 font-bold truncate">Archivo guardado en servidor</p>
                        ) : (
                            <p className="text-[13px] text-slate-400 font-semibold">Clic para subir documento...</p>
                        )}
                    </div>
                    <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                        onChange={(e) => updateLegalField('farmacovigilanciaAuthFile', e.target.files?.[0] || null)} 
                    />
                </div>
            </div>
        </div>
    );
};

export default FormPharmacovigilance;