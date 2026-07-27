import React, { useState } from 'react';
import { KeyRound, Lock, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
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

        if (password.length < 8) { setError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(password)) { setError('Debe incluir al menos una letra mayúscula.'); return; }
        if (!/[0-9]/.test(password)) { setError('Debe incluir al menos un número.'); return; }
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
                <div className="w-14 h-14 rounded-full bg-success/10 border border-success/30 flex items-center justify-center">
                    <CheckCircle size={28} className="text-success" strokeWidth={2} />
                </div>
                <p className="text-[11px] font-black uppercase tracking-widest text-success">Contraseña establecida</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 p-1 animate-in fade-in duration-300">
            {/* Email pill */}
            <div className="px-4 py-3 bg-brand/5 border border-brand/15 rounded-[1rem]">
                <p className="text-[9px] font-black uppercase tracking-widest text-content-2 mb-0.5">Usuario del Portal</p>
                <p className="text-[13px] font-bold text-brand-text truncate">{username}@farmalasa.app</p>
            </div>

            {/* Nueva contraseña */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                    Nueva Contraseña
                </label>
                <div className="relative flex items-center">
                    <Lock size={15} strokeWidth={2.5} className="absolute left-3.5 text-content-3 pointer-events-none" />
                    <input
                        type="password"
                        placeholder="Mínimo 8 caracteres, 1 mayúscula y 1 número"
                        value={password}
                        onChange={e => { setPassword(e.target.value); setError(''); }}
                        className="w-full pl-10 pr-4 bg-surface-card border border-divider rounded-[1rem] h-[44px] text-[16px] font-bold text-content-2 outline-none transition-all hover:border-brand/30 focus:ring-4 focus:ring-brand/10 focus:border-brand/50"
                    />
                </div>
            </div>

            {/* Confirmar contraseña */}
            <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block">
                    Confirmar Contraseña
                </label>
                <div className="relative flex items-center">
                    <Lock size={15} strokeWidth={2.5} className="absolute left-3.5 text-content-3 pointer-events-none" />
                    <input
                        type="password"
                        placeholder="Repite la contraseña"
                        value={confirm}
                        onChange={e => { setConfirm(e.target.value); setError(''); }}
                        className="w-full pl-10 pr-4 bg-surface-card border border-divider rounded-[1rem] h-[44px] text-[16px] font-bold text-content-2 outline-none transition-all hover:border-brand/30 focus:ring-4 focus:ring-brand/10 focus:border-brand/50"
                    />
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 text-danger-text bg-danger/10 backdrop-blur-sm px-4 py-3 rounded-2xl border border-danger/30 shadow-[var(--shadow-glow-danger)] animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={18} className="shrink-0 text-danger" strokeWidth={2.5} />
                    <span className="text-[12px] font-bold leading-relaxed">{error}</span>
                </div>
            )}

            {/* Submit */}
            <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !password || !confirm}
                className="w-full h-[48px] bg-brand hover:bg-brand-hover disabled:bg-content-3 text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[var(--shadow-glow-brand)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none"
            >
                {loading
                    ? <><Loader2 size={18} className="animate-spin" /> Guardando...</>
                    : <><KeyRound size={16} strokeWidth={2.5} /> Guardar Contraseña</>
                }
            </button>
        </div>
    );
};

export default FormSetPassword;
