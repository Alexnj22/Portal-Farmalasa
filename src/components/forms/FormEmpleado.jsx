import React from 'react';
import { Shield, User, Briefcase, CreditCard, Camera } from 'lucide-react';
import { formatDuiMask } from '../../utils/helpers';

const formatPhoneMask = (value) => {
    if (!value) return '';
    const cleaned = value.replace(/\D/g, '').substring(0, 8);
    const match = cleaned.match(/^(\d{0,4})(\d{0,4})$/);
    if (match) {
        return !match[2] ? match[1] : `${match[1]}-${match[2]}`;
    }
    return value;
};

const FormEmpleado = ({ formData, setFormData, branches, roles }) => {
    const handlePhotoUpload = (e) => {
        const file = e.target.files?.[0];
        if (file) setFormData({ ...formData, photo: file });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-6 items-center bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <div className="relative group">
                    <div className="h-28 w-28 rounded-full bg-slate-100 border-4 border-white shadow-lg overflow-hidden flex items-center justify-center">
                        {formData.photo ? (
                            <img src={formData.photo instanceof File ? URL.createObjectURL(formData.photo) : formData.photo} className="w-full h-full object-cover" alt="Perfil" />
                        ) : (
                            <User size={40} className="text-slate-300" />
                        )}
                    </div>
                    <label className="absolute bottom-0 right-0 p-2 bg-blue-600 text-white rounded-full shadow-lg cursor-pointer hover:bg-blue-700 transition-all border-2 border-white">
                        <Camera size={14} />
                        <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                    </label>
                </div>
                <div className="flex-1 w-full">
                    <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <div>
                            <span className="block text-xs font-black text-slate-700 uppercase">Privilegios Admin</span>
                            <span className="block text-[10px] text-slate-400 font-medium">Gestión de personal</span>
                        </div>
                        <button 
                            type="button" 
                            onClick={() => setFormData({ ...formData, isAdmin: !formData.isAdmin })} 
                            className={`w-12 h-6 rounded-full transition-colors relative ${formData.isAdmin ? 'bg-blue-600' : 'bg-slate-300'}`}
                        >
                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${formData.isAdmin ? 'translate-x-7' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800">
                <h4 className="text-[10px] font-black text-blue-400 uppercase mb-4 flex items-center gap-2"><Shield size={14} /> Credenciales</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Código</label>
                        <input 
                            placeholder="Ex: EMP001" 
                            className="w-full bg-slate-800 text-white p-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                            value={formData.code || ''} 
                            onChange={e => setFormData({ ...formData, code: e.target.value })} 
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Usuario</label>
                        <input 
                            placeholder="usuario" 
                            className="w-full bg-slate-800 text-white p-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                            value={formData.username || ''} 
                            onChange={e => setFormData({ ...formData, username: e.target.value })} 
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Contraseña</label>
                        <input 
                            type="password" 
                            placeholder="••••••••" 
                            className="w-full bg-slate-800 text-white p-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500" 
                            value={formData.password || ''} 
                            onChange={e => setFormData({ ...formData, password: e.target.value })} 
                        />
                    </div>
                </div>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-slate-200">
                <h4 className="text-[10px] font-black text-slate-400 uppercase mb-4 flex items-center gap-2"><User size={14} /> Identificación</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input 
                        placeholder="Nombre Completo" 
                        className="border-2 border-slate-100 p-3 rounded-2xl text-sm focus:border-blue-500 outline-none" 
                        value={formData.name || ''} 
                        onChange={e => setFormData({ ...formData, name: e.target.value })} 
                    />
                    <input 
                        placeholder="DUI" 
                        className="border-2 border-slate-100 p-3 rounded-2xl text-sm focus:border-blue-500 outline-none" 
                        value={formData.dui || ''} 
                        onChange={e => setFormData({ ...formData, dui: formatDuiMask(e.target.value) })} 
                        maxLength={10} 
                    />
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Nacimiento</label>
                        <input 
                            type="date" 
                            className="w-full border-2 border-slate-100 p-3 rounded-2xl text-sm" 
                            value={formData.birthDate || ''} 
                            onChange={e => setFormData({ ...formData, birthDate: e.target.value })} 
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Teléfono</label>
                        <input 
                            placeholder="7777-7777" 
                            className="w-full border-2 border-slate-100 p-3 rounded-2xl text-sm" 
                            value={formData.phone || ''} 
                            onChange={e => setFormData({ ...formData, phone: formatPhoneMask(e.target.value) })} 
                        />
                    </div>
                </div>
            </div>

            <div className="bg-blue-50 p-5 rounded-3xl border border-blue-100">
                <h4 className="text-[10px] font-black text-blue-800 uppercase mb-4 flex items-center gap-2"><Briefcase size={14} /> Ubicación Laboral</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <select 
                        className="border-2 border-white p-3 rounded-2xl text-sm bg-white" 
                        value={formData.branchId || ''} 
                        onChange={e => setFormData({ ...formData, branchId: e.target.value })}
                    >
                        <option value="">Sucursal</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <select 
                        className="border-2 border-white p-3 rounded-2xl text-sm bg-white" 
                        value={formData.role || ''} 
                        onChange={e => setFormData({ ...formData, role: e.target.value })}
                    >
                        <option value="">Cargo</option>
                        {/* ✅ CORRECCIÓN AQUÍ: Iteramos usando r.id y r.name */}
                        {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                    </select>
                </div>
            </div>

            <div className="bg-slate-50 p-5 rounded-3xl border border-slate-200">
                <h4 className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2"><CreditCard size={14} /> Finanzas y Nómina</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input 
                        placeholder="AFP" 
                        className="border-2 border-white p-3 rounded-2xl text-sm" 
                        value={formData.afpName || ''} 
                        onChange={e => setFormData({ ...formData, afpName: e.target.value })} 
                    />
                    <input 
                        placeholder="NUP" 
                        className="border-2 border-white p-3 rounded-2xl text-sm" 
                        value={formData.afpNumber || ''} 
                        onChange={e => setFormData({ ...formData, afpNumber: e.target.value })} 
                    />
                    <input 
                        placeholder="ISSS" 
                        className="border-2 border-white p-3 rounded-2xl text-sm" 
                        value={formData.isssNumber || ''} 
                        onChange={e => setFormData({ ...formData, isssNumber: e.target.value })} 
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <input 
                        placeholder="Banco" 
                        className="border-2 border-white p-3 rounded-2xl text-sm" 
                        value={formData.bankName || ''} 
                        onChange={e => setFormData({ ...formData, bankName: e.target.value })} 
                    />
                    <input 
                        placeholder="Cuenta" 
                        className="border-2 border-white p-3 rounded-2xl text-sm" 
                        value={formData.accountNumber || ''} 
                        onChange={e => setFormData({ ...formData, accountNumber: e.target.value })} 
                    />
                </div>
            </div>
        </div>
    );
};

export default FormEmpleado;