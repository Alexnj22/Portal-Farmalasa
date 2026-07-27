import React from 'react';
import FileField from '../common/FileField';

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
                <label className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-2 block">
                    N° Correlativo SRS
                </label>
                <input 
                    type="text" 
                    placeholder="Ej: F025-2024"
 className="w-full px-4 py-3.5 rounded-2xl bg-surface-card border border-divider focus:border-brand transition-all font-mono text-body-xl text-content font-semibold placeholder:text-content-3"
                    value={legalData.srsPermit || ""} 
                    onChange={(e) => updateLegalField('srsPermit', e.target.value)} 
                />
            </div>
            
            <FileField
                label="Documento de Permiso Escaneado (PDF/IMG)"
                accept="application/pdf,image/*"
                file={legalData.srsPermitFile}
                url={legalData.srsPermitUrl}
                onChange={f => updateLegalField('srsPermitFile', f)}
                hint="PDF o imagen — soltalo acá o hacé clic"
            />
        </div>
    );
};

export default FormSrsPermit;