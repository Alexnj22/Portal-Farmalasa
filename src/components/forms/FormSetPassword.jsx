import React, { useState } from 'react';
import Button from '../common/Button';
import { KeyRound, Lock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import PortalInput from '../common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';

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
            setError(mensajeAmigable(err, 'Error de conexión.'));
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-10 animate-in fade-in duration-300">
                <div className="w-14 h-14 rounded-full bg-success/10 border border-success/30 flex items-center justify-center">
                    <CheckCircle2 size={28} className="text-success" strokeWidth={2} />
                </div>
                <p className="text-label font-black uppercase tracking-widest text-success">Contraseña establecida</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 p-1 animate-in fade-in duration-300">
            {/* Email pill */}
            <div className="px-4 py-3 bg-brand/5 border border-brand/15 rounded-2xl">
                <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-0.5">Usuario del Portal</p>
                <p className="text-body font-bold text-brand-text truncate">{username}@farmalasa.app</p>
            </div>

            {/* Nueva contraseña */}
            <PortalInput
                name="password"
                label="Nueva Contraseña"
                icon={Lock}
                type="password"
                placeholder="Mínimo 8 caracteres, 1 mayúscula y 1 número"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
            />

            {/* Confirmar contraseña */}
            <PortalInput
                name="confirm"
                label="Confirmar Contraseña"
                icon={Lock}
                type="password"
                placeholder="Repite la contraseña"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
            />

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 text-danger-text bg-danger/10 backdrop-blur-sm px-4 py-3 rounded-2xl border border-danger/30 shadow-[var(--shadow-glow-danger)] animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={18} className="shrink-0 text-danger" strokeWidth={2.5} />
                    <span className="text-body-sm font-bold leading-relaxed">{error}</span>
                </div>
            )}

            {/* Submit */}
            <Button size="lg" disabled={loading || !password || !confirm} onClick={handleSubmit}>{loading
                    ? <><Loader2 size={18} className="animate-spin" /> Guardando...</>
                    : <><KeyRound size={16} strokeWidth={2.5} /> Guardar Contraseña</>
                }</Button>
        </div>
    );
};

export default FormSetPassword;
