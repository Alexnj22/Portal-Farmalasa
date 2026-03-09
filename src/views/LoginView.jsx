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
        // 🚨 1. ENVOLTORIO PRINCIPAL: Permite scroll (overflow-y-auto) en lugar de ocultarlo.
        // Ocupa el 100% de la pantalla usando min-h-[100dvh].
        <div className="relative min-h-[100dvh] w-full font-sans bg-transparent overflow-x-hidden overflow-y-auto selection:bg-[#007AFF]/30">
            
            {/* 🚨 2. FONDO AMBIENTAL: Cambiado a 'fixed inset-0'. 
                Esto asegura que las nubes nunca se muevan aunque el usuario haga scroll, 
                cubriendo el 100% de la pantalla física. */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-[#007AFF]/10 rounded-full filter blur-[120px] animate-ambient-drift" />
                <div className="absolute top-[10%] right-[-10%] w-[55vw] h-[55vw] bg-[#5856D6]/10 rounded-full filter blur-[120px] animate-ambient-drift-reverse" />
                <div
                    className="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] bg-[#34C759]/5 rounded-full filter blur-[140px] animate-ambient-drift"
                    style={{ animationDelay: "3s" }}
                />
            </div>

            {/* DOCK LATERAL DERECHO (Desktop) - Cambiado a fixed para que se ancle a la pantalla */}
            <div className="fixed right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col items-end gap-6 z-30 p-5 rounded-[3rem] bg-white/30 backdrop-blur-2xl border border-white/60 shadow-[0_30px_60px_rgba(0,0,0,0.08),inset_0_2px_20px_rgba(255,255,255,0.8)] animate-in fade-in slide-in-from-right-8 duration-700 hover:bg-white/50 hover:shadow-[0_50px_100px_rgba(0,0,0,0.12),inset_0_2px_30px_rgba(255,255,255,1)] hover:border-white/80 hover:scale-[1.02] transition-all cursor-default">
                
                <a href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php" target="_blank" rel="noopener noreferrer" className="group flex items-center h-16 rounded-[1.5rem] bg-white/50 hover:bg-white border border-transparent hover:border-white/90 shadow-sm hover:shadow-[0_15px_30px_rgba(0,122,255,0.2)] transition-all duration-500 overflow-hidden active:scale-95">
                    <div className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]">
                        <div className="overflow-hidden flex items-center justify-start">
                            <span className="text-[#007AFF] text-[10px] font-black uppercase tracking-widest whitespace-nowrap pl-5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">Ventas</span>
                        </div>
                    </div>
                    <div className="w-16 h-16 flex items-center justify-center shrink-0">
                        <ShoppingCart size={24} className="text-slate-500 group-hover:text-[#007AFF] transition-colors duration-300 group-hover:scale-110" strokeWidth={1.5} />
                    </div>
                </a>

                <div className="w-10 h-[2px] bg-white/50 mr-3 rounded-full transition-all duration-300 group-hover:bg-white/80" />

                <a href="https://farmalasa.com" target="_blank" rel="noopener noreferrer" className="group flex items-center h-16 rounded-[1.5rem] bg-white/50 hover:bg-white border border-transparent hover:border-white/90 shadow-sm hover:shadow-[0_15px_30px_rgba(88,86,214,0.2)] transition-all duration-500 overflow-hidden active:scale-95">
                    <div className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]">
                        <div className="overflow-hidden flex items-center justify-start">
                            <span className="text-[#5856D6] text-[10px] font-black uppercase tracking-widest whitespace-nowrap pl-5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">Farmalasa</span>
                        </div>
                    </div>
                    <div className="w-16 h-16 flex items-center justify-center shrink-0">
                        <Pill size={24} className="text-slate-500 group-hover:text-[#5856D6] transition-colors duration-300 group-hover:scale-110" strokeWidth={1.5} />
                    </div>
                </a>
            </div>

            {/* 🚨 3. CONTENEDOR CENTRAL: Layout flexible perfecto. 
                - flex-col + min-h-[100dvh]: Da espacio para crecer.
                - Padding protector inteligente: pt usa safe-area, pb empuja el contenido hacia arriba para que no lo tape el Dock Móvil. */}
            <div className="relative z-10 flex flex-col items-center w-full min-h-[100dvh] px-5 pt-[max(env(safe-area-inset-top,24px),24px)] pb-[calc(max(env(safe-area-inset-bottom,24px),24px)+100px)]">

                {/* 🚨 my-auto: El truco definitivo. Si la pantalla es alta, lo centra. Si la pantalla es baja (teléfono acostado), lo pone arriba y permite scroll hacia abajo. */}
                <div className="w-full max-w-[460px] my-auto rounded-[3.5rem] p-8 md:p-12 relative transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] bg-white/40 backdrop-blur-3xl backdrop-saturate-[200%] border border-white/60 shadow-[0_24px_60px_rgba(0,0,0,0.08),inset_0_2px_20px_rgba(255,255,255,0.8)] hover:bg-white/50 hover:border-white hover:shadow-[0_40px_80px_rgba(0,122,255,0.12),inset_0_2px_30px_rgba(255,255,255,1)] hover:-translate-y-1">

                    <div className="flex flex-col items-center mb-8">
                        <div className="w-20 h-20 bg-white/60 backdrop-blur-md shadow-[0_10px_25px_rgba(0,122,255,0.2),inset_0_2px_5px_rgba(255,255,255,1)] border border-white rounded-[1.75rem] flex items-center justify-center mb-6 relative group transition-all duration-500 hover:scale-110 hover:shadow-[0_15px_35px_rgba(0,122,255,0.3)] hover:-translate-y-1">
                            <img 
                                src="/LogoFLS.svg" 
                                alt="FarmaLasa" 
                                className="w-12 h-12 relative z-10 drop-shadow-sm transition-transform duration-500 group-hover:scale-105" 
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
                        {/* CAJA DE CÓDIGO BLINDADA */}
                        <div className="relative group z-20 flex items-center">
                            <div className="absolute left-0 w-16 flex items-center justify-center pointer-events-none text-slate-400 group-focus-within:text-[#007AFF] transition-colors duration-300 z-30">
                                <ScanBarcode size={24} strokeWidth={2} />
                            </div>
                            <input
                                ref={inputRef}
                                type="text"
                                name="acceso_seguro_fls"
                                placeholder="CÓDIGO"
                                onContextMenu={(e) => e.preventDefault()}
                                onCopy={(e) => e.preventDefault()}
                                onPaste={(e) => e.preventDefault()}
                                onCut={(e) => e.preventDefault()}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => e.preventDefault()}
                                autoComplete="off"
                                spellCheck="false"
                                className="w-full pl-16 pr-6 py-5 bg-white/30 hover:bg-white/50 backdrop-blur-md border border-white/60 rounded-[1.75rem] text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-white focus:ring-4 focus:ring-[#007AFF]/15 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] focus:shadow-[0_10px_30px_rgba(0,122,255,0.1),inset_0_2px_10px_rgba(255,255,255,1)] transition-all duration-500 text-xl tracking-[0.5em] font-black uppercase [-webkit-text-security:disc] select-none"
                            />
                        </div>

                        {error && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="px-5 py-3.5 bg-red-50/50 backdrop-blur-md border border-red-200/80 rounded-[1.25rem] flex items-center gap-3 shadow-[0_8px_20px_rgba(239,68,68,0.15),inset_0_1px_5px_rgba(255,255,255,1)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_25px_rgba(239,68,68,0.25),inset_0_1px_5px_rgba(255,255,255,1)] hover:bg-white/90 hover:border-red-300">
                                    <AlertCircle size={18} className="text-red-500 shrink-0 transition-transform duration-300 hover:scale-110" strokeWidth={2.5} />
                                    <p className="text-red-600 text-[10px] font-black uppercase tracking-widest leading-tight mt-0.5">{error}</p>
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full h-[64px] mt-1 bg-gradient-to-b from-[#007AFF] to-[#005CE6] hover:from-[#0066CC] hover:to-[#004BB3] active:scale-[0.98] text-white rounded-[1.75rem] font-black text-[14px] uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_10px_25px_rgba(0,122,255,0.3),inset_0_2px_5px_rgba(255,255,255,0.3)] duration-500 hover:-translate-y-1 hover:shadow-[0_15px_35px_rgba(0,122,255,0.4),inset_0_2px_5px_rgba(255,255,255,0.4)] relative overflow-hidden group/btn"
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'Ingresar al Portal'}
                            </span>
                        </button>
                    </form>

                    <div className="flex items-center gap-4 my-8 opacity-60">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-400/30 to-slate-400/30"></div>
                    </div>

                    <button
                        onClick={() => setView('timeclock')}
                        className="w-full p-4 rounded-[2rem] bg-white/20 backdrop-blur-md border border-white/90 flex items-center justify-between group cursor-pointer transition-all duration-500 hover:bg-white/60 hover:border-white hover:shadow-[0_15px_35px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.8)] hover:-translate-y-1 active:scale-95"
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-[1.25rem] bg-white text-slate-500 flex items-center justify-center group-hover:bg-[#007AFF] group-hover:text-white transition-all duration-500 shadow-[0_4px_10px_rgba(0,0,0,0.05)] border border-white group-hover:shadow-[0_8px_20px_rgba(0,122,255,0.3)] group-hover:scale-110 group-hover:-translate-y-0.5">
                                <Clock size={20} strokeWidth={2.5} />
                            </div>
                            <div className="text-left">
                                <p className="text-[12px] font-black text-slate-700 uppercase tracking-widest group-hover:text-[#007AFF] transition-colors duration-300">Terminal Kiosco</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] mt-1 group-hover:text-[#007AFF]/60 transition-colors duration-300">Marcar entrada / salida</p>
                            </div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-white/80 border border-white shadow-sm flex items-center justify-center group-hover:bg-[#007AFF]/10 group-hover:border-[#007AFF]/20 transition-all duration-500">
                            <ChevronRight size={16} className="text-slate-400 group-hover:text-[#007AFF] group-hover:translate-x-0.5 transition-all duration-300" strokeWidth={3} />
                        </div>
                    </button>

                </div>
            </div>

            {/* DOCK INFERIOR FLOTANTE (Móvil) - Cambiado a Fixed para no romper el scroll */}
            <div className="fixed bottom-[max(env(safe-area-inset-bottom,24px),24px)] left-1/2 -translate-x-1/2 flex items-center justify-center gap-3 p-3 z-30 w-[90%] max-w-[360px] lg:hidden bg-white/20 backdrop-blur-3xl backdrop-saturate-[300%] border border-white/60 rounded-[2rem] shadow-[0_24px_60px_rgba(0,0,0,0.08),inset_0_2px_20px_rgba(255,255,255,0.8)] animate-in slide-in-from-bottom-8 duration-700">
                <a href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php" target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-white/50 hover:bg-white rounded-[1.5rem] transition-all duration-300 active:scale-95 shadow-sm border border-transparent hover:border-white/90 hover:shadow-[0_5px_15px_rgba(0,122,255,0.15)] group">
                    <ShoppingCart size={16} strokeWidth={2.5} className="text-[#007AFF] group-hover:scale-110 transition-transform" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 group-hover:text-[#007AFF] transition-colors">Ventas</span>
                </a>
                <a href="https://farmalasa.com" target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-white/50 hover:bg-white rounded-[1.5rem] transition-all duration-300 active:scale-95 shadow-sm border border-transparent hover:border-white/90 hover:shadow-[0_5px_15px_rgba(88,86,214,0.15)] group">
                    <Pill size={16} strokeWidth={2.5} className="text-[#5856D6] group-hover:scale-110 transition-transform" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 group-hover:text-[#5856D6] transition-colors">FarmaLasa</span>
                </a>
            </div>

        </div>
    );
};

export default LoginView;