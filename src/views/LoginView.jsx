import React, { useState, useEffect, useRef } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    ShoppingCart, Pill, AlertCircle
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, isAdmin, user } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, []);

    useEffect(() => {
        if (user) {
            if (isAdmin) setView('dashboard');
            else {
                setActiveEmployee(user);
                setView('employee-detail');
            }
        }
    }, [user, isAdmin, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        const code = inputRef.current?.value || '';

        if (!code.trim()) {
            setError('Por favor, ingresa tu código.');
            return;
        }

        setIsLoading(true);

        try {
            const success = await login(code);

            if (!success) {
                setError('Código inválido o no encontrado.');
                setIsLoading(false);
                if (inputRef.current) inputRef.current.value = '';
                inputRef.current?.focus();
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión. Intenta de nuevo.');
            setIsLoading(false);
            if (inputRef.current) inputRef.current.value = '';
            inputRef.current?.focus();
        }
    };

return (
        // 🚨 1. Contenedor Base: Flex column, centra horizontalmente
        <div className="relative flex flex-col items-center w-full min-h-[100dvh] px-5 
            pt-[max(env(safe-area-inset-top,32px),32px)] 
            pb-[max(env(safe-area-inset-bottom,32px),120px)] 
            landscape:pb-[max(env(safe-area-inset-bottom,32px),32px)]">

            {/* 🚨 2. LA MAGIA CONTRA EL CORTE: 'my-auto' en lugar de justify-center. 
                Si la pantalla es alta, lo centra. Si la acuestas, se va arriba y deja scrollear. */}
            <div className="w-full max-w-[460px] my-auto rounded-[3.5rem] p-8 md:p-12 relative bg-white/40 backdrop-blur-3xl backdrop-saturate-[200%] border border-white/60 shadow-[0_24px_60px_rgba(0,0,0,0.08),inset_0_2px_20px_rgba(255,255,255,0.8)] transition-all">

                <div className="flex flex-col items-center mb-8">
                    {/* 🚨 LOGO: forzamos bg-white y overflow-hidden para limpiar los bordes negros */}
                    <div className="w-20 h-20 bg-white backdrop-blur-md shadow-lg border border-white rounded-[1.75rem] flex items-center justify-center mb-6 overflow-hidden">
                        <img 
                            src="/LogoFLS.svg" 
                            alt="FarmaLasa" 
                            /* object-contain asegura que no se deforme */
                            className="w-16 h-16 object-contain drop-shadow-sm" 
                        />
                    </div>
                    <h3 className="text-[28px] md:text-[34px] font-black text-slate-800 tracking-tight leading-none mb-3 text-center">
                        Portal
                    </h3>
                    <p className="text-[10px] font-black text-[#007AFF]/80 uppercase tracking-[0.2em] text-center w-full">
                        Farmacias La Popular & La Salud
                    </p>
                </div>

                <form onSubmit={handleLogin} className="flex flex-col gap-5 relative">
                    <div className="relative group z-20 flex items-center">
                        <div className="absolute left-0 w-16 flex items-center justify-center pointer-events-none text-slate-400 group-focus-within:text-[#007AFF] transition-colors duration-300 z-30">
                            <ScanBarcode size={24} strokeWidth={2} />
                        </div>
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="CÓDIGO"
                            autoComplete="off"
                            spellCheck="false"
                            className="w-full pl-16 pr-6 py-5 bg-white/30 hover:bg-white/50 backdrop-blur-md border border-white/60 rounded-[1.75rem] text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-white focus:ring-4 focus:ring-[#007AFF]/15 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] transition-all text-xl tracking-[0.5em] font-black uppercase [-webkit-text-security:disc]"
                        />
                    </div>

                    {error && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="px-5 py-3.5 bg-red-50/50 backdrop-blur-md border border-red-200/80 rounded-[1.25rem] flex items-center gap-3">
                                <AlertCircle size={18} className="text-red-500 shrink-0" strokeWidth={2.5} />
                                <p className="text-red-600 text-[10px] font-black uppercase tracking-widest">{error}</p>
                            </div>
                        </div>
                    )}

                    <button type="submit" disabled={isLoading} className="w-full h-[64px] bg-gradient-to-b from-[#007AFF] to-[#005CE6] text-white rounded-[1.75rem] font-black text-[14px] uppercase tracking-widest shadow-lg flex items-center justify-center gap-2">
                        {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'Ingresar al Portal'}
                    </button>
                </form>

                <div className="flex items-center gap-4 my-8 opacity-60">
                    <div className="flex-1 h-px bg-slate-400/30"></div>
                </div>

                <button onClick={() => setView('timeclock')} className="w-full p-4 rounded-[2rem] bg-white/20 backdrop-blur-md border border-white/90 flex items-center justify-between shadow-sm active:scale-95 transition-transform">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-[1.25rem] bg-white text-slate-500 flex items-center justify-center border border-white shadow-sm">
                            <Clock size={20} strokeWidth={2.5} />
                        </div>
                        <div className="text-left">
                            <p className="text-[12px] font-black text-slate-700 uppercase tracking-widest">Terminal Kiosco</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] mt-1">Marcar entrada / salida</p>
                        </div>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white/80 border border-white flex items-center justify-center">
                        <ChevronRight size={16} className="text-slate-400" strokeWidth={3} />
                    </div>
                </button>
            </div>

            {/* 🚨 3. DOCK MÓVIL (Menú Flotante Inteligente) */}
            <div className="fixed z-40 flex items-center justify-center gap-3 p-3 transition-all duration-500 bg-white/40 backdrop-blur-3xl border border-white/60 rounded-[2rem] shadow-xl
                /* MODO VERTICAL (Abajo) */
                bottom-[max(env(safe-area-inset-bottom,24px),24px)] left-1/2 -translate-x-1/2 w-[90%] max-w-[360px] flex-row
                /* MODO HORIZONTAL (A la derecha, seguro del notch) */
                landscape:bottom-auto landscape:top-1/2 landscape:-translate-y-1/2 landscape:right-[max(env(safe-area-inset-right,24px),24px)] landscape:left-auto landscape:translate-x-0 landscape:w-auto landscape:flex-col
                lg:hidden
            ">
                <a href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php" target="_blank" rel="noopener noreferrer" className="flex-1 landscape:flex-none landscape:w-16 flex items-center justify-center gap-2 py-3.5 px-4 bg-white/60 hover:bg-white rounded-[1.5rem]">
                    <ShoppingCart size={18} strokeWidth={2.5} className="text-[#007AFF]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 landscape:hidden">Ventas</span>
                </a>
                <a href="https://farmalasa.com" target="_blank" rel="noopener noreferrer" className="flex-1 landscape:flex-none landscape:w-16 flex items-center justify-center gap-2 py-3.5 px-4 bg-white/60 hover:bg-white rounded-[1.5rem]">
                    <Pill size={18} strokeWidth={2.5} className="text-[#5856D6]" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 landscape:hidden">FarmaLasa</span>
                </a>
            </div>
        </div>
    );
};

export default LoginView;