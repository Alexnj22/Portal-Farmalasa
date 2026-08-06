import React, { useState, useEffect } from 'react';
import Button from '../components/common/Button';
import { ShieldOff, LogOut, MessageCircle, Loader2 } from 'lucide-react';
import { fetchRoleName } from '../data/permissions';
import { useAuth } from '../context/AuthContext';

const SUPPORT_PHONE = '50370153222';

const NoAccessView = () => {
    const { user, logout } = useAuth();
    const [loggingOut, setLoggingOut] = useState(false);
    const [roleName, setRoleName] = useState('');

    useEffect(() => {
        const roleId = user?.roleId ?? (Number.isInteger(user?.role) ? user?.role : null);
        if (roleId) {
            fetchRoleName(roleId)
                .then(({ data }) => { if (data?.name) setRoleName(data.name); });
        } else if (user?.systemRole) {
            setRoleName(user.systemRole); // eslint-disable-line react-hooks/set-state-in-effect -- fallback síncrono cuando no hay roleId que resolver por fetch
        }
    }, [user?.roleId, user?.role, user?.systemRole]);

    const handleLogout = () => {
        setLoggingOut(true);
        // logout() llama setUser(null) de inmediato — la UI navega sola
        logout();
    };

    const handleWhatsApp = () => {
        const role = roleName || user?.systemRole || 'desconocido';
        const msg = `Hola, estoy intentando acceder al portal, no tengo acceso, mi cargo es "${role}", muchas gracias.`;
        window.open(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(msg)}`, '_blank');
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-surface-page z-sidebar overflow-hidden">

            {/* Ambient blobs */}
            <div className="absolute top-[-15%] left-[-10%] w-[60vw] h-[60vw] bg-danger/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
            <div className="absolute bottom-[-20%] right-[-10%] w-[55vw] h-[55vw] bg-danger/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />

            {/* Card */}
            <div className="relative z-base flex flex-col items-center text-center max-w-sm w-full px-6 animate-in fade-in zoom-in-95 duration-[var(--dur-lento)]">

                {/* Pulsing rings + icon */}
                <div className="relative mb-10">
                    <span className="absolute inset-0 m-auto w-28 h-28 rounded-full bg-danger/15 animate-ping" style={{ animationDuration: '2.5s' }} />
                    <span className="absolute -inset-6 rounded-full bg-danger/10 animate-ping" style={{ animationDuration: '3.5s', animationDelay: '0.6s' }} />
                    <div className="relative w-28 h-28 rounded-header bg-surface-card border border-danger/30 shadow-[var(--shadow-glow-danger)] flex items-center justify-center">
                        <ShieldOff size={48} className="text-danger" strokeWidth={1.5} />
                    </div>
                </div>

                {/* Text */}
                <div className="animate-in fade-in slide-in-from-bottom-3 duration-[var(--dur-lento)] fill-mode-both" style={{ animationDelay: '150ms' }}>
                    <h1 className="text-display-lg font-black text-content tracking-tight leading-none mb-3">
                        Sin acceso
                    </h1>
                    <p className="text-subtitle text-content-3 font-medium leading-relaxed mb-8">
                        Tu cuenta no tiene módulos habilitados.
                    </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col items-center gap-3 w-full animate-in fade-in slide-in-from-bottom-3 duration-[var(--dur-lento)] fill-mode-both" style={{ animationDelay: '300ms' }}>
                    {/* WhatsApp support */}
                    <Button
                        size="lg"
                        variant="ghost"
                        className="w-full"
                        icon={MessageCircle}
                        onClick={handleWhatsApp}
                    >Contacta con soporte</Button>

                    {/* Logout */}
                    <Button variant="secondary" disabled={loggingOut} onClick={handleLogout}>{loggingOut
                            ? <Loader2 size={14} className="animate-spin" />
                            : <LogOut size={14} strokeWidth={2.5} />
                        }
                        {loggingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}</Button>
                </div>
            </div>
        </div>
    );
};

export default NoAccessView;
