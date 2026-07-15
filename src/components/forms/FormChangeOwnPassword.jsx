import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, CheckCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';

const FormChangeOwnPassword = ({ onClose }) => {
    const [newPass, setNewPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPw, setShowPw]   = useState(false);
    const [loading, setLoading] = useState(false);
    const [done, setDone]       = useState(false);

    const save = async () => {
        if (newPass.length < 8) { useToastStore.getState().showToast('Error', 'Mínimo 8 caracteres.', 'error'); return; }
        if (!/[A-Z]/.test(newPass)) { useToastStore.getState().showToast('Error', 'Debe incluir al menos una mayúscula.', 'error'); return; }
        if (!/[0-9]/.test(newPass)) { useToastStore.getState().showToast('Error', 'Debe incluir al menos un número.', 'error'); return; }
        if (newPass !== confirm) { useToastStore.getState().showToast('Error', 'Las contraseñas no coinciden.', 'error'); return; }
        setLoading(true);
        const { error } = await supabase.auth.updateUser({ password: newPass });
        setLoading(false);
        if (error) useToastStore.getState().showToast('Error', error.message, 'error');
        else { setDone(true); useToastStore.getState().showToast('Listo', 'Contraseña actualizada.', 'success'); setTimeout(onClose, 1200); }
    };

    if (done) return (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <CheckCircle size={28} className="text-emerald-500" strokeWidth={2} />
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Contraseña actualizada</p>
        </div>
    );

    return (
        <div className="flex flex-col gap-5 p-1">
            {[['Nueva contraseña', newPass, setNewPass, false], ['Confirmar contraseña', confirm, setConfirm, true]].map(([label, val, setter, isLast]) => (
                <div key={label}>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">{label}</label>
                    <div className="relative flex items-center">
                        <Lock size={15} strokeWidth={2.5} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                        <input
                            type={showPw ? 'text' : 'password'}
                            placeholder="Mín. 8 caracteres, 1 mayúscula y 1 número"
                            value={val}
                            onChange={e => setter(e.target.value)}
                            className="w-full pl-10 pr-10 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[16px] font-bold text-slate-700 outline-none transition-all hover:border-[#0052CC]/30 focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC]/50"
                        />
                        {isLast && (
                            <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 text-slate-500 hover:text-slate-600">
                                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                        )}
                    </div>
                </div>
            ))}
            <button type="button" onClick={save} disabled={loading || !newPass || !confirm}
                className="w-full h-[48px] bg-[#0052CC] hover:bg-[#003D99] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><KeyRound size={16} strokeWidth={2.5} /> Guardar Contraseña</>}
            </button>
        </div>
    );
};

export default FormChangeOwnPassword;
