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
        if (newPass.length < 6) { useToastStore.getState().showToast('Error', 'Mínimo 6 caracteres.', 'error'); return; }
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
                            placeholder="Mínimo 6 caracteres"
                            value={val}
                            onChange={e => setter(e.target.value)}
                            className="w-full pl-10 pr-10 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-bold text-slate-700 outline-none transition-all hover:border-[#007AFF]/30 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50"
                        />
                        {isLast && (
                            <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 text-slate-400 hover:text-slate-600">
                                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                        )}
                    </div>
                </div>
            ))}
            <button type="button" onClick={save} disabled={loading || !newPass || !confirm}
                className="w-full h-[48px] bg-[#007AFF] hover:bg-[#0066CC] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><KeyRound size={16} strokeWidth={2.5} /> Guardar Contraseña</>}
            </button>
        </div>
    );
};

export default FormChangeOwnPassword;
