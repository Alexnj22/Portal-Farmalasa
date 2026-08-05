import React, { useState } from 'react';
import Button from '../common/Button';
import { Eye, EyeOff, KeyRound, Loader2, Lock, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useToastStore } from '../../store/toastStore';
import PortalInput from '../common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';

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
        if (error) useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
        else { setDone(true); useToastStore.getState().showToast('Listo', 'Contraseña actualizada.', 'success'); setTimeout(onClose, 1200); }
    };

    if (done) return (
        <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="w-14 h-14 rounded-full bg-success/10 border border-success/30 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-success" strokeWidth={2} />
            </div>
            <p className="text-label font-black uppercase tracking-widest text-success">Contraseña actualizada</p>
        </div>
    );

    return (
        <div className="flex flex-col gap-5 p-1">
            {[['Nueva contraseña', newPass, setNewPass, false], ['Confirmar contraseña', confirm, setConfirm, true]].map(([label, val, setter, isLast]) => (
                // El ojo de ver/ocultar sigue viviendo al lado del campo, pero
                // ahora es hermano del canónico y no un hijo posicionado sobre
                // un `<input>` a mano.
                <div key={label} className="relative">
                    <PortalInput
                        name={`pw-${isLast ? 'confirm' : 'new'}`}
                        label={label}
                        icon={Lock}
                        type={showPw ? 'text' : 'password'}
                        placeholder="Mín. 8 caracteres, 1 mayúscula y 1 número"
                        value={val}
                        onChange={e => setter(e.target.value)}
                        inputClassName={isLast ? 'pr-10' : ''}
                    />
                    {isLast && (
                        <div className="absolute right-2 bottom-1">
                            <Button variant="ghost" size="sm" iconOnly icon={showPw ? EyeOff : Eye}
                                aria-label={showPw ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                                onClick={() => setShowPw(v => !v)} />
                        </div>
                    )}
                </div>
            ))}
            <Button size="lg" disabled={loading || !newPass || !confirm} onClick={save}>{loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><KeyRound size={16} strokeWidth={2.5} /> Guardar Contraseña</>}</Button>
        </div>
    );
};

export default FormChangeOwnPassword;
