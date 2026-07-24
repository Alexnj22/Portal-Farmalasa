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
                <label className="text-[10px] font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">
                    N° Correlativo SRS
                </label>
                <input 
                    type="text" 
                    placeholder="Ej: F025-2024"
                    className="w-full px-4 py-3.5 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono text-[16px] text-content font-semibold placeholder:text-content-3" 
                    value={legalData.srsPermit || ""} 
                    onChange={(e) => updateLegalField('srsPermit', e.target.value)} 
                />
            </div>
            
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">
                    Documento de Permiso Escaneado (PDF/IMG)
                </label>
                <div className="flex items-center gap-3 cursor-pointer relative rounded-[1rem] border border-slate-200 bg-white px-4 py-3.5 hover:bg-surface-card-hover hover:border-brand/30 transition-colors group">
                    <div className="p-2 bg-success/10 rounded-lg group-hover:bg-success/10 transition-colors text-success">
                        <UploadCloud size={18} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                        {legalData.srsPermitFile ? (
                            <p className="text-[13px] text-emerald-700 font-bold truncate">{legalData.srsPermitFile.name}</p>
                        ) : legalData.srsPermitUrl ? (
                            <p className="text-[13px] text-content-2 font-bold truncate">Reemplazar archivo actual...</p>
                        ) : (
                            <p className="text-[13px] text-content-3 font-semibold">Clic para subir documento...</p>
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