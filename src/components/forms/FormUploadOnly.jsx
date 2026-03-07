import React from 'react';
import { CheckCircle, Upload } from 'lucide-react';

const FormUploadOnly = ({ formData, setFormData }) => (
    <div className="space-y-4 text-center py-6">
        <div className="p-8 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 group hover:border-blue-400 transition-all">
            <input
                type="file"
                id="filePost"
                className="hidden"
                onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] })}
            />
            <label htmlFor="filePost" className="cursor-pointer block">
                {formData.file ? (
                    <div className="text-blue-600 animate-bounce">
                        <CheckCircle size={48} className="mx-auto mb-2" />
                        <span className="font-bold text-sm">{formData.file.name}</span>
                    </div>
                ) : (
                    <div className="text-slate-400">
                        <Upload size={48} className="mx-auto mb-2 opacity-20" />
                        <p className="text-sm font-bold text-slate-600">Haz clic para subir soporte</p>
                        <p className="text-[10px] mt-1 italic">Vincular a acción seleccionada</p>
                    </div>
                )}
            </label>
        </div>
    </div>
);

export default FormUploadOnly;