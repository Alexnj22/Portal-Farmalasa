import React from 'react';
import { Paperclip } from 'lucide-react';
import { EVENT_TYPES } from '../../data/constants';

const FormNovedad = ({ formData, setFormData, branches, activeEmployee }) => {
    const requiresTarget = ['TRANSFER', 'SUPPORT'].includes(formData.type);
    const requiresNewRole = formData.type === 'PROMOTION';
    const isTemporal = ['VACATION', 'DISABILITY', 'SUPPORT', 'PERMISSION'].includes(formData.type);

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
            <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Tipo de Acción</label>
                <select
                    className="w-full border-2 border-slate-100 p-2.5 rounded-xl text-sm font-bold bg-slate-50 outline-none focus:border-blue-500 transition-all"
                    value={formData.type || ''}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                    <option value="">-- Seleccionar Acción --</option>
                    {Object.keys(EVENT_TYPES).map(key => (
                        <option key={key} value={key}>{EVENT_TYPES[key].label}</option>
                    ))}
                </select>
            </div>

            {requiresTarget && (
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <label className="text-[10px] font-black uppercase text-blue-400">Sucursal Destino</label>
                    <select
                        className="w-full border-none bg-transparent text-sm font-bold outline-none"
                        value={formData.targetBranchId || ''}
                        onChange={(e) => setFormData({ ...formData, targetBranchId: e.target.value })}
                    >
                        <option value="">Seleccionar Farmacia</option>
                        {branches.filter(b => b.id !== activeEmployee?.branchId).map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>
            )}

            {requiresNewRole && (
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                    <label className="text-[10px] font-black uppercase text-purple-400">Nuevo Cargo / Puesto</label>
                    <input
                        type="text"
                        placeholder="Escriba el nuevo cargo"
                        className="w-full border-none bg-transparent text-sm font-bold outline-none mt-1"
                        value={formData.newRole || ''}
                        onChange={(e) => setFormData({ ...formData, newRole: e.target.value })}
                    />
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-[10px] font-black uppercase text-slate-400">{isTemporal ? 'Desde' : 'Fecha'}</label>
                    <input
                        type="date"
                        className="w-full border p-2 rounded-lg text-sm"
                        value={formData.date || ''}
                        onChange={e => setFormData({ ...formData, date: e.target.value })}
                    />
                </div>
                {isTemporal && (
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400">Hasta</label>
                        <input
                            type="date"
                            className="w-full border p-2 rounded-lg text-sm"
                            value={formData.endDate || ''}
                            onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                        />
                    </div>
                )}
            </div>

            <div>
                <label className="text-[10px] font-black uppercase text-slate-400">Observaciones</label>
                <textarea
                    rows="2"
                    className="w-full border p-3 rounded-xl text-sm outline-none focus:border-blue-500"
                    placeholder="Detalles de la acción..."
                    value={formData.note || ''}
                    onChange={e => setFormData({ ...formData, note: e.target.value })}
                />
            </div>

            <div className="pt-4 border-t border-dashed">
                <div className="flex items-center gap-2 cursor-pointer group relative">
                    <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-blue-100 transition-colors">
                        <Paperclip size={16} className="text-slate-500 group-hover:text-blue-600" />
                    </div>
                    <div className="flex-1">
                        <p className="text-xs font-bold text-slate-700">Adjuntar Soporte Digital</p>
                        {formData.file ? (
                            <p className="text-[10px] text-blue-600 font-bold">✅ {formData.file.name}</p>
                        ) : (
                            <p className="text-[10px] text-slate-400">PDF o Imágenes (Opcional)</p>
                        )}
                    </div>
                    <input
                        type="file"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => setFormData({ ...formData, file: e.target.files?.[0] })}
                    />
                </div>
            </div>
        </div>
    );
};

export default FormNovedad;