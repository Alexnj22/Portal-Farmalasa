import React, { useState, useEffect, useRef } from 'react';
import {
    Building2, Clock, ScanBarcode, Loader2, ChevronRight,
    ExternalLink, ShoppingCart, Pill, AlertCircle
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, isAdmin, user } = useAuth();

    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    useEffect(() => {
        if (user) {
            if (isAdmin) {
                setView('dashboard');
            } else {
                setActiveEmployee(user);
                setView('employee-detail');
            }
        }
    }, [user, isAdmin, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => {
                setError('');
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        if (!inputValue.trim()) {
            setError('Por favor, ingresa tu código.');
            return;
        }

        setIsLoading(true);

        try {
            const success = await login(inputValue);

            if (!success) {
                setError('Código inválido o no encontrado.');
                setIsLoading(false);
            }
        } catch (err) {
            console.error(err);
            setError('Error de conexión. Intenta de nuevo.');
            setIsLoading(false);
        }
    };

    const handleGoToKiosk = () => {
        setView('timeclock');
    };

    // 🚨 CLASES MAESTRAS LIQUIDGLASS EXTREMO
    const glassPanelClass = "bg-white/40 backdrop-blur-3xl backdrop-saturate-[200%] border border-white/50 shadow-[0_20px_50px_rgba(0,0,0,0.05),inset_0_2px_20px_rgba(255,255,255,0.5)]";
    const glassHoverClass = "transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/60 hover:border-white hover:shadow-[0_30px_60px_rgba(0,122,255,0.15),inset_0_2px_20px_rgba(255,255,255,1)] hover:-translate-y-2";

    return (
        // 🚨 CRÍTICO: bg-transparent para que tu GlobalBackground de App.js se vea perfectamente
<div className="min-h-[100dvh] w-full flex items-center justify-center relative font-sans bg-transparent overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
            {/* Si por alguna razón el GlobalBackground no cubre esta vista, dejamos tu código exacto como capa base aquí */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] bg-[#007AFF]/10 rounded-full filter blur-[120px] animate-ambient-drift" />
                <div className="absolute top-[10%] right-[-10%] w-[55vw] h-[55vw] bg-[#5856D6]/10 rounded-full filter blur-[120px] animate-ambient-drift-reverse" />
                <div
                    className="absolute bottom-[-20%] left-[20%] w-[70vw] h-[70vw] bg-[#34C759]/5 rounded-full filter blur-[140px] animate-ambient-drift"
                    style={{ animationDelay: "3s" }}
                />
            </div>

            {/* 🚨 WIDGETS LATERALES (Liquidglass con levitación extrema) */}
            <div className="absolute left-[calc(50%+280px)] top-1/2 -translate-y-1/2 flex-col gap-6 z-20 hidden lg:flex">
                <a
                    href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group flex flex-col items-center justify-center w-[110px] h-[110px] rounded-[2.5rem] ${glassPanelClass} ${glassHoverClass} hover:scale-105`}
                >
                    <ShoppingCart size={32} className="text-[#007AFF] relative z-10 mb-2 transition-transform duration-500 group-hover:scale-110 group-hover:-translate-y-1" strokeWidth={1.5} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 relative z-10 group-hover:text-[#007AFF] transition-colors">Ventas</span>
                    <ExternalLink size={14} className="absolute top-4 right-4 text-[#007AFF]/40 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-500" />
                </a>

                <a
                    href="https://farmalasa.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group flex flex-col items-center justify-center w-[110px] h-[110px] rounded-[2.5rem] ${glassPanelClass} ${glassHoverClass} hover:scale-105`}
                >
                    <Pill size={32} className="text-[#5856D6] relative z-10 mb-2 transition-transform duration-500 group-hover:scale-110 group-hover:-translate-y-1" strokeWidth={1.5} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 relative z-10 group-hover:text-[#5856D6] transition-colors">FarmaLasa</span>
                    <ExternalLink size={14} className="absolute top-4 right-4 text-[#5856D6]/40 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 group-hover:-translate-y-1 transition-all duration-500" />
                </a>
            </div>

            {/* 🚨 CONTENEDOR PRINCIPAL */}
            <div className="w-full max-w-[460px] p-5 relative z-10 flex flex-col items-center">

                {/* 🚨 TARJETA MAESTRA: Ahora reacciona al hover general para dar sensación de objeto 3D flotante */}
                <div className={`w-full rounded-[3.5rem] p-8 md:p-12 relative transition-all duration-1000 ease-[cubic-bezier(0.23,1,0.32,1)] bg-white/40 backdrop-blur-3xl backdrop-saturate-[200%] border border-white/60 shadow-[0_24px_60px_rgba(0,0,0,0.08),inset_0_2px_20px_rgba(255,255,255,0.8)] hover:bg-white/50 hover:border-white hover:shadow-[0_40px_80px_rgba(0,122,255,0.12),inset_0_2px_30px_rgba(255,255,255,1)] hover:-translate-y-1`}>

                    {/* ICONO Y TÍTULOS */}
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-16 h-16 bg-white/60 backdrop-blur-md shadow-[0_10px_25px_rgba(0,122,255,0.2),inset_0_2px_5px_rgba(255,255,255,1)] border border-white rounded-[1.5rem] flex items-center justify-center text-[#007AFF] mb-6 relative group transition-all duration-500 hover:scale-110 hover:shadow-[0_15px_35px_rgba(0,122,255,0.3)] hover:-translate-y-1">
                            <Building2 size={30} strokeWidth={2} className="relative z-10" />
                        </div>
                        <h3 className="text-[28px] md:text-[34px] font-black text-slate-800 tracking-tight leading-none mb-3 text-center">
                            Portal
                        </h3>
                        <p className="text-[10px] font-black text-[#007AFF]/80 uppercase tracking-[0.2em] text-center w-full">
                            Farmacias La Popular & La Salud
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="flex flex-col gap-5 relative">

                        {/* 🚨 INPUT CÓDIGO CRISTALINO */}
                        <div className="relative group z-20">
                            <div className="absolute inset-y-0 left-0 pl-6 w-16 flex items-center justify-center pointer-events-none text-slate-400 group-focus-within:text-[#007AFF] transition-colors duration-300">
                                <ScanBarcode size={24} strokeWidth={2} />
                            </div>

                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="CÓDIGO"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                className="w-full pl-16 pr-6 py-5 bg-white/30 hover:bg-white/50 backdrop-blur-md border border-white/60 rounded-[1.75rem] text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-white focus:ring-4 focus:ring-[#007AFF]/15 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] focus:shadow-[0_10px_30px_rgba(0,122,255,0.1),inset_0_2px_10px_rgba(255,255,255,1)] transition-all duration-500 text-lg md:text-xl tracking-[0.15em] font-black uppercase"
                                autoComplete="off"
                            />
                        </div>

                        {/* 🚨 CONTENEDOR DE ERROR */}
                        {error && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="px-5 py-3.5 bg-red-50/50 backdrop-blur-md border border-red-200/80 rounded-[1.25rem] flex items-center gap-3 shadow-[0_8px_20px_rgba(239,68,68,0.15),inset_0_1px_5px_rgba(255,255,255,1)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_25px_rgba(239,68,68,0.25),inset_0_1px_5px_rgba(255,255,255,1)] hover:bg-white/90 hover:border-red-300">
                                    <AlertCircle size={18} className="text-red-500 shrink-0 transition-transform duration-300 hover:scale-110" strokeWidth={2.5} />
                                    <p className="text-red-600 text-[10px] font-black uppercase tracking-widest leading-tight mt-0.5">{error}</p>
                                </div>
                            </div>
                        )}

                        {/* 🚨 BOTÓN INGRESO GLOSSY */}
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

                    {/* 🚨 SEPARADOR */}
                    <div className="flex items-center gap-4 my-8 opacity-60">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-400/30 to-slate-400/30"></div>
                    </div>

                    {/* 🚨 BOTÓN KIOSCO (Panel flotante interactivo) */}
                    <button
                        onClick={handleGoToKiosk}
                        className={`w-full p-4 rounded-[2rem] bg-white/20 backdrop-blur-md border border-white/90 flex items-center justify-between group cursor-pointer transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/60 hover:border-white hover:shadow-[0_15px_35px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.8)] hover:-translate-y-1 active:scale-95`}
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

            {/* 🚨 VERSIÓN MÓVIL DE LOS BOTONES EXTERNOS */}
            <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3 z-20 lg:hidden px-5">
                <a
                    href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-[1.5rem] ${glassPanelClass} active:scale-95 transition-transform`}
                >
                    <ShoppingCart size={16} strokeWidth={2.5} className="text-[#007AFF]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Ventas</span>
                </a>
                <a
                    href="https://farmalasa.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-[1.5rem] ${glassPanelClass} active:scale-95 transition-transform`}
                >
                    <Pill size={16} strokeWidth={2.5} className="text-[#5856D6]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">FarmaLasa</span>
                </a>
            </div>

            <style>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>
    );
};

export default LoginView;