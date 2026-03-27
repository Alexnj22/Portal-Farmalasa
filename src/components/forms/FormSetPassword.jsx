import React, { useState } from 'react';
import { KeyRound, Lock, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';

const FormSetPassword = ({ formData, onClose }) => {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const username = formData?.username || formData?.code?.toLowerCase() || '';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) { setError('Mínimo 6 caracteres.'); return; }
        if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }

        setLoading(true);
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('set-employee-password', {
                body: { username, password },
            });

            if (fnErr) {
                setError('Error de red: la función no respondió.');
            } else if (!data?.ok) {
                setError(`${data?.error || 'Error'}${data?.details ? ': ' + data.details : ''}`);
            } else {
                setDone(true);
                const { showToast } = useToastStore.getState();
                showToast?.('Contraseña establecida', `Acceso configurado para ${formData?.name || username}.`, 'success');
                setTimeout(onClose, 1200);
            }
        } catch (err) {
            setError(err?.message || 'Error de conexión.');
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-10 animate-in fade-in duration-300">
                <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                    <CheckCircle size={28} className="text-emerald-500" strokeWidth={2} />
                </div>
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Contraseña establecida</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-1 animate-in fade-in duration-300">
            {/* Email pill */}
            <div className="px-4 py-3 bg-[#007AFF]/5 border border-[#007AFF]/15 rounded-[1rem]">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Usuario del Portal</p>
                <p className="text-[13px] font-bold text-[#007AFF] truncate">{username}@farmalasa.app</p>
            </div>

            {/* Nueva contraseña */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">
                    Nueva Contraseña
                </label>
                <div className="relative flex items-center">
                    <Lock size={15} strokeWidth={2.5} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                    <input
                        type="password"
                        placeholder="Mínimo 6 caracteres"
                        value={password}
                        onChange={e => { setPassword(e.target.value); setError(''); }}
                        className="w-full pl-10 pr-4 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-bold text-slate-700 outline-none transition-all hover:border-[#007AFF]/30 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50"
                    />
                </div>
            </div>

            {/* Confirmar contraseña */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">
                    Confirmar Contraseña
                </label>
                <div className="relative flex items-center">
                    <Lock size={15} strokeWidth={2.5} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                    <input
                        type="password"
                        placeholder="Repite la contraseña"
                        value={confirm}
                        onChange={e => { setConfirm(e.target.value); setError(''); }}
                        className="w-full pl-10 pr-4 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-bold text-slate-700 outline-none transition-all hover:border-[#007AFF]/30 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50"
                    />
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="px-4 py-2.5 bg-red-50/80 border border-red-200/80 rounded-[0.9rem]">
                    <p className="text-[11px] font-black text-red-600">{error}</p>
                </div>
            )}

            {/* Submit */}
            <button
                type="submit"
                disabled={loading || !password || !confirm}
                className="w-full h-[48px] bg-[#007AFF] hover:bg-[#0066CC] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none"
            >
                {loading
                    ? <><Loader2 size={18} className="animate-spin" /> Guardando...</>
                    : <><KeyRound size={16} strokeWidth={2.5} /> Guardar Contraseña</>
                }
            </button>
        </form>
    );
};

export default FormSetPassword;
