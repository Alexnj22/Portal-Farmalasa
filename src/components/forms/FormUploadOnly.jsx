import React from 'react';
import FileField from '../common/FileField';

const FormUploadOnly = ({ formData, setFormData }) => (
    <div className="py-4">
        <FileField
            label="Soporte"
            accept=".pdf,image/*"
            file={formData.file}
            onChange={f => setFormData({ ...formData, file: f })}
            hint="Se vincula a la acción seleccionada"
        />
    </div>
);

export default FormUploadOnly;
