import React from 'react';
import FileField from '../common/FileField';
import PortalInput from '../../components/common/PortalInput';

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
            <PortalInput
                label="N° Correlativo SRS" name="srs-correlativo"
                placeholder="Ej: F025-2024"
                inputClassName="font-mono"
                value={legalData.srsPermit || ""}
                onChange={(e) => updateLegalField('srsPermit', e.target.value)}
            />
            
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