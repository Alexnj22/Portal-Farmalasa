import React from 'react';
import FileField from '../common/FileField';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../common/LiquidSelect';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { OPCIONES_CATEGORIA_SRS } from '@nucleo/utils/edicionDeSucursal';

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative focus-within:z-sidebar">
                    <label className={rotuloCampo('text-content-3')}>Categoría SRS</label>
                    <LiquidSelect
                        value={legalData.srsCategoria || ""}
                        onChange={(val) => updateLegalField('srsCategoria', val || '')}
                        options={OPCIONES_CATEGORIA_SRS}
                        placeholder="Sin categoría"
                    />
                </div>
                <PortalInput
                    label="Nº de Inscripción SRS" name="srs-inscripcion"
                    placeholder="Ej: 0123"
                    inputClassName="font-mono"
                    value={legalData.srsInscripcion || ""}
                    onChange={(e) => updateLegalField('srsInscripcion', e.target.value)}
                />
            </div>

            <FileField
                label="Documento de Permiso Escaneado (PDF/IMG)"
                accept="application/pdf,image/*"
                file={legalData.srsPermitFile}
                url={legalData.srsPermitUrl}
                onChange={f => updateLegalField('srsPermitFile', f)}
                hint="PDF o imagen — suéltalo aquí o haz clic"
            />
        </div>
    );
};

export default FormSrsPermit;