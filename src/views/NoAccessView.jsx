import React, { useState, useEffect } from 'react';
import { ShieldOff, LogOut, MessageCircle, Loader2 } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const SUPPORT_PHONE = '50370153222';

const NoAccessView = () => {
    const { user, logout } = useAuth();
    const [loggingOut, setLoggingOut] = useState(false);
    const [roleName, setRoleName] = useState('');

    useEffect(() => {
        const roleId = user?.roleId ?? (Number.isInteger(user?.role) ? user?.role : null);
        if (roleId) {
            supabase.from('roles').select('name').eq('id', roleId).single()
                .then(({ data }) => { if (data?.name) setRoleName(data.name); });
        } else if (user?.systemRole) {
            setRoleName(user.systemRole);
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
        <div className="fixed inset-0 flex items-center justify-center bg-[#F2F2F7] z-50 overflow-hidden">

            {/* Ambient blobs */}
            <div className="absolute top-[-15%] left-[-10%] w-[60vw] h-[60vw] bg-red-400/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
            <div className="absolute bottom-[-20%] right-[-10%] w-[55vw] h-[55vw] bg-rose-300/10 rounded-full blur-[120px] animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />

            {/* Card */}
            <div className="relative z-10 flex flex-col items-center text-center max-w-sm w-full px-6 animate-in fade-in zoom-in-95 duration-700">

                {/* Pulsing rings + icon */}
                <div className="relative mb-10">
                    <span className="absolute inset-0 m-auto w-28 h-28 rounded-full bg-red-400/15 animate-ping" style={{ animationDuration: '2.5s' }} />
                    <span className="absolute -inset-6 rounded-full bg-red-300/8 animate-ping" style={{ animationDuration: '3.5s', animationDelay: '0.6s' }} />
                    <div className="relative w-28 h-28 rounded-[2.5rem] bg-white border border-red-100 shadow-[0_20px_60px_rgba(239,68,68,0.15)] flex items-center justify-center">
                        <ShieldOff size={48} className="text-red-300" strokeWidth={1.2} />
                    </div>
                </div>

                {/* Text */}
                <div className="animate-in fade-in slide-in-from-bottom-3 duration-500 fill-mode-both" style={{ animationDelay: '150ms' }}>
                    <h1 className="text-[36px] font-black text-slate-900 tracking-tight leading-none mb-3">
                        Sin acceso
                    </h1>
                    <p className="text-[15px] text-slate-500 font-medium leading-relaxed mb-8">
                        Tu cuenta no tiene módulos habilitados.
                    </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col items-center gap-3 w-full animate-in fade-in slide-in-from-bottom-3 duration-500 fill-mode-both" style={{ animationDelay: '300ms' }}>
                    {/* WhatsApp support */}
                    <button
                        onClick={handleWhatsApp}
                        className="w-full inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-[#25D366] text-white text-[13px] font-black hover:bg-[#1fb855] active:scale-95 transition-all shadow-[0_8px_24px_rgba(37,211,102,0.3)] hover:shadow-[0_12px_32px_rgba(37,211,102,0.4)]"
                    >
                        <MessageCircle size={15} strokeWidth={2.5} />
                        Contacta con soporte
                    </button>

                    {/* Logout */}
                    <button
                        onClick={handleLogout}
                        disabled={loggingOut}
                        className="w-full inline-flex items-center justify-center gap-2 px-7 py-3 rounded-full bg-white border border-slate-200 text-slate-600 text-[13px] font-black hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-60"
                    >
                        {loggingOut
                            ? <Loader2 size={14} className="animate-spin" />
                            : <LogOut size={14} strokeWidth={2.5} />
                        }
                        {loggingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NoAccessView;
