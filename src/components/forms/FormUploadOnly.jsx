import React from 'react';
import { CheckCircle, Upload } from 'lucide-react';

const FormUploadOnly = ({ formData, setFormData }) => (
    <div className="space-y-4 text-center py-6">
        <div className="p-8 border-2 border-dashed border-divider rounded-2xl bg-surface-card-hover group hover:border-chart-1 transition-all">
            <input
                type="file"
                id="filePost"
                className="hidden"
                onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] })}
            />
            <label htmlFor="filePost" className="cursor-pointer block">
                {formData.file ? (
                    <div className="text-chart-1-text">
                        <CheckCircle size={48} className="mx-auto mb-2" />
                        <span className="font-bold text-sm">{formData.file.name}</span>
                    </div>
                ) : (
                    <div className="text-content-3">
                        <Upload size={48} className="mx-auto mb-2 opacity-20" />
                        <p className="text-sm font-bold text-content-2">Haz clic para subir soporte</p>
                        <p className="text-caption mt-1 italic">Vincular a acción seleccionada</p>
                    </div>
                )}
            </label>
        </div>
    </div>
);

export default FormUploadOnly;