import React from 'react';
import { UploadCloud } from 'lucide-react';

const FormSrsPermit = ({ formData, setFormData }) => {
    const legalData = formData?.settings?.legal || {};

    const updateLegalField = (field, value) => {
        setFormData({
            ...formData,
            settings: {
                ...(formData.settings || {}),
                legal: { ...legalData, [field]: value }
            }
        });
    };

    return (
        <div className="space-y-5">
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                    N° Correlativo SRS
                </label>
                <input 
                    type="text" 
                    placeholder="Ej: F025-2024"
                    className="w-full px-4 py-3.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] focus:ring-4 focus:ring-[#007AFF]/10 transition-all font-mono text-[14px] text-slate-800 font-semibold placeholder:text-slate-300" 
                    value={legalData.srsPermit || ""} 
                    onChange={(e) => updateLegalField('srsPermit', e.target.value)} 
                />
            </div>
            
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-2 block">
                    Documento de Permiso Escaneado (PDF/IMG)
                </label>
                <div className="flex items-center gap-3 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 hover:bg-slate-50 hover:border-[#007AFF]/30 transition-colors group">
                    <div className="p-2 bg-emerald-50 rounded-lg group-hover:bg-emerald-100 transition-colors text-emerald-600">
                        <UploadCloud size={18} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                        {legalData.srsPermitFile ? (
                            <p className="text-[13px] text-emerald-700 font-bold truncate">{legalData.srsPermitFile.name}</p>
                        ) : legalData.srsPermitUrl ? (
                            <p className="text-[13px] text-slate-700 font-bold truncate">Reemplazar archivo actual...</p>
                        ) : (
                            <p className="text-[13px] text-slate-400 font-semibold">Clic para subir documento...</p>
                        )}
                    </div>
                    <input 
                        type="file" 
                        accept="application/pdf,image/*" 
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                        onChange={(e) => updateLegalField('srsPermitFile', e.target.files?.[0] || null)} 
                    />
                </div>
            </div>
        </div>
    );
};

export default FormSrsPermit;