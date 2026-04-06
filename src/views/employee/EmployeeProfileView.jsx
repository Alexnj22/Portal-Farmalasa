import React, { useState } from 'react';
import { User, Phone, HeartPulse, Briefcase, KeyRound, Check, X, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';

const Field = ({ label, value }) => (
    <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/60 border border-white/80">
        <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-0.5">{label}</p>
            <p className="text-[13px] font-bold text-slate-700 truncate">{value || 'No registrado'}</p>
        </div>
    </div>
);

const EmployeeProfileView = () => {
    const { user } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);
    const updateEmployee = useStaffStore(s => s.updateEmployee);

    const emp    = employees.find(e => String(e.id) === String(user?.id)) || user;
    const branch = branches.find(b => String(b.id) === String(emp?.branchId));

    // Formulario edición
    const [editing, setEditing]   = useState(false);
    const [form, setForm]         = useState({});
    const [isSaving, setIsSaving] = useState(false);

    // Cambio de contraseña
    const [showPassModal, setShowPassModal] = useState(false);
    const [newPass, setNewPass]     = useState('');
    const [confirm, setConfirm]     = useState('');
    const [showPw, setShowPw]       = useState(false);
    const [isSavingPw, setIsSavingPw] = useState(false);

    const startEdit = () => {
        setForm({
            phone:                   emp.phone || '',
            emergency_contact_name:  emp.emergency_contact_name || '',
            emergency_contact_phone: emp.emergency_contact_phone || '',
        });
        setEditing(true);
    };

    const saveEdit = async () => {
        setIsSaving(true);
        await updateEmployee(emp.id, form);
        setIsSaving(false);
        setEditing(false);
        useToastStore.getState().showToast('Guardado', 'Perfil actualizado.', 'success');
    };

    const savePassword = async () => {
        if (newPass.length < 6) {
            useToastStore.getState().showToast('Error', 'La contraseña debe tener al menos 6 caracteres.', 'error');
            return;
        }
        if (newPass !== confirm) {
            useToastStore.getState().showToast('Error', 'Las contraseñas no coinciden.', 'error');
            return;
        }
        setIsSavingPw(true);
        const { error } = await supabase.auth.updateUser({ password: newPass });
        setIsSavingPw(false);
        if (error) {
            useToastStore.getState().showToast('Error', error.message, 'error');
        } else {
            useToastStore.getState().showToast('Listo', 'Contraseña actualizada.', 'success');
            setShowPassModal(false); setNewPass(''); setConfirm('');
        }
    };

    if (!emp) return null;

    return (
        <div className="px-4 pt-4 pb-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-[18px] font-black text-slate-800 flex items-center gap-2">
                    <User size={18} className="text-[#007AFF]" strokeWidth={2.5} /> Mi Perfil
                </h2>
                <div className="flex gap-2">
                    <button onClick={() => setShowPassModal(true)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-white/70 border border-white/80 rounded-full text-[10px] font-black uppercase tracking-widest text-amber-600 shadow-sm hover:bg-amber-50 transition-all active:scale-95"
                    >
                        <KeyRound size={11} /> Contraseña
                    </button>
                    {!editing && (
                        <button onClick={startEdit}
                            className="flex items-center gap-1.5 px-3 py-2 bg-[#007AFF] rounded-full text-[10px] font-black uppercase tracking-widest text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:bg-[#0066DD] transition-all active:scale-95"
                        >
                            Editar
                        </button>
                    )}
                </div>
            </div>

            {/* Foto + nombre */}
            <div className="relative overflow-hidden bg-gradient-to-br from-[#007AFF] to-[#0055CC] rounded-[2rem] p-6 shadow-[0_8px_30px_rgba(0,122,255,0.25)] flex items-center gap-4">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-10 translate-x-10" />
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white/40 shadow-md flex-shrink-0 relative z-10">
                    {emp.photo || emp.photo_url
                        ? <img src={emp.photo || emp.photo_url} className="w-full h-full object-cover" alt="" />
                        : <div className="w-full h-full bg-white/20 flex items-center justify-center text-white font-black text-xl">{emp.name?.charAt(0)}</div>
                    }
                </div>
                <div className="relative z-10">
                    <p className="text-white font-black text-[18px] leading-tight">{emp.name}</p>
                    <p className="text-white/70 text-[11px] font-bold mt-0.5">{emp.role || 'Empleado'}</p>
                    <p className="text-white/50 text-[10px] font-bold uppercase tracking-widest mt-0.5">CÓD: {emp.code || 'S/N'}</p>
                </div>
            </div>

            {/* Formulario editable */}
            {editing ? (
                <div className="bg-white/70 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 space-y-4 animate-in fade-in duration-200">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Información editable</p>
                    {[
                        { key: 'phone',                   label: 'Celular',                placeholder: '0412-000-0000' },
                        { key: 'emergency_contact_name',  label: 'Contacto de emergencia', placeholder: 'Nombre y apellido' },
                        { key: 'emergency_contact_phone', label: 'Teléfono de emergencia', placeholder: '0412-000-0000' },
                    ].map(({ key, label, placeholder }) => (
                        <div key={key}>
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
                            <input
                                value={form[key]}
                                onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                                placeholder={placeholder}
                                className="w-full px-4 py-3 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 transition-all"
                            />
                        </div>
                    ))}
                    <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditing(false)}
                            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-500 text-[12px] font-medium hover:bg-slate-50 transition-all"
                        >Cancelar</button>
                        <button onClick={saveEdit} disabled={isSaving}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#007AFF] text-white text-[12px] font-bold disabled:opacity-50 transition-all active:scale-95"
                        >
                            {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} strokeWidth={2.5} />}
                            Guardar
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {/* Info de contacto */}
                    <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Phone size={10} /> Contacto</p>
                        <Field label="Correo" value={emp.email || emp.username} />
                        <Field label="Celular" value={emp.phone} />
                        <Field label="Documento (DUI)" value={emp.dui} />
                        <Field label="Sucursal" value={branch?.name} />
                    </div>

                    {/* Emergencia */}
                    {(emp.emergency_contact_name || emp.emergency_contact_phone || emp.blood_type) && (
                        <div className="bg-red-50/60 backdrop-blur-xl border border-red-100/60 rounded-[2rem] p-5 space-y-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-red-500 flex items-center gap-1.5"><HeartPulse size={10} /> Emergencia</p>
                            <Field label="Avisar a" value={emp.emergency_contact_name} />
                            <Field label="Teléfono emergencia" value={emp.emergency_contact_phone} />
                            {emp.blood_type && <Field label="Tipo de sangre" value={emp.blood_type} />}
                        </div>
                    )}

                    {/* Datos laborales */}
                    <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Briefcase size={10} /> Información Laboral</p>
                        <Field label="Fecha de ingreso" value={emp.hire_date ? new Date(emp.hire_date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : null} />
                        <Field label="Fecha de nacimiento" value={emp.birth_date ? new Date(emp.birth_date + 'T12:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'long', year: 'numeric' }) : null} />
                    </div>
                </>
            )}

            {/* Modal cambio de contraseña */}
            {showPassModal && (
                <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={() => setShowPassModal(false)}>
                    <div className="w-full max-w-sm bg-white/90 backdrop-blur-2xl rounded-[2rem] p-6 space-y-4 shadow-2xl animate-in slide-in-from-bottom-4 duration-300" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <p className="text-[14px] font-black text-slate-800 flex items-center gap-2">
                                <KeyRound size={15} className="text-amber-500" /> Nueva contraseña
                            </p>
                            <button onClick={() => setShowPassModal(false)} className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 transition-all">
                                <X size={15} />
                            </button>
                        </div>
                        {[
                            { val: newPass, set: setNewPass, label: 'Nueva contraseña' },
                            { val: confirm, set: setConfirm, label: 'Confirmar contraseña' },
                        ].map(({ val, set, label }) => (
                            <div key={label} className="relative">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</p>
                                <input
                                    type={showPw ? 'text' : 'password'}
                                    value={val} onChange={e => set(e.target.value)}
                                    className="w-full px-4 py-3 pr-10 rounded-[1.25rem] border border-slate-200 bg-white text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 focus:border-[#007AFF]/50 transition-all"
                                />
                                <button onClick={() => setShowPw(v => !v)} className="absolute right-3 bottom-3 text-slate-400 hover:text-slate-600">
                                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                        ))}
                        <button onClick={savePassword} disabled={isSavingPw || !newPass || !confirm}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-[1.25rem] bg-[#007AFF] text-white font-black text-[12px] uppercase tracking-widest disabled:opacity-50 transition-all active:scale-[0.98]"
                        >
                            {isSavingPw ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                            Actualizar contraseña
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmployeeProfileView;
