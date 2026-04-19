import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft, MessageCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

const SUPPORT_PHONE = '50370153222';

const AccessDeniedView = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
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

    const handleWhatsApp = () => {
        const role = roleName || user?.systemRole || 'desconocido';
        const msg = `Hola, estoy intentando acceder al portal, no tengo acceso, mi cargo es "${role}", muchas gracias.`;
        window.open(`https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(msg)}`, '_blank');
    };

    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[65vh] text-center px-6 overflow-hidden">

            {/* Ambient blob */}
            <div className="absolute w-[40vw] h-[40vw] bg-violet-400/8 rounded-full blur-[100px] animate-pulse pointer-events-none" style={{ animationDuration: '5s' }} />

            {/* Pulsing rings + icon */}
            <div className="relative mb-10 animate-in zoom-in-75 duration-700 fill-mode-both">
                <span className="absolute inset-0 m-auto w-24 h-24 rounded-full bg-violet-400/15 animate-ping" style={{ animationDuration: '2.5s' }} />
                <span className="absolute -inset-6 rounded-full bg-violet-300/8 animate-ping" style={{ animationDuration: '3.5s', animationDelay: '0.8s' }} />
                <div className="relative w-24 h-24 rounded-[2rem] bg-white border border-violet-100 shadow-[0_16px_48px_rgba(139,92,246,0.12)] flex items-center justify-center">
                    <Lock size={38} className="text-violet-300" strokeWidth={1.2} />
                </div>
            </div>

            {/* Text */}
            <div className="relative animate-in fade-in slide-in-from-bottom-3 duration-500 fill-mode-both" style={{ animationDelay: '150ms' }}>
                <h1 className="text-[32px] font-black text-slate-900 tracking-tight leading-none mb-2">
                    Acceso denegado
                </h1>
                <p className="text-[14px] text-slate-500 font-medium leading-relaxed mb-8">
                    No tienes permiso para ver este módulo.
                </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500 fill-mode-both" style={{ animationDelay: '280ms' }}>
                <button
                    onClick={() => navigate(-1)}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white border border-slate-200 text-slate-700 text-[13px] font-black hover:bg-slate-50 active:scale-95 transition-all"
                >
                    <ArrowLeft size={14} strokeWidth={2.5} />
                    Volver
                </button>

                <button
                    onClick={handleWhatsApp}
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-[#25D366] text-white text-[13px] font-black hover:bg-[#1fb855] active:scale-95 transition-all shadow-[0_6px_20px_rgba(37,211,102,0.25)]"
                >
                    <MessageCircle size={14} strokeWidth={2.5} />
                    Contactar soporte
                </button>
            </div>
        </div>
    );
};

export default AccessDeniedView;
