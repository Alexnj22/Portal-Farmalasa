import React, { useState, useEffect, useRef } from 'react';
import { 
    Building2, Clock, ScanBarcode, Loader2, ChevronRight, 
    ExternalLink, ShoppingCart, Pill 
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

const LoginView = ({ setView, setActiveEmployee }) => {
    // ✅ AHORA IMPORTAMOS isAdmin Y user DESDE EL CONTEXTO
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

    // ✅ EFECTO PARA REDIRIGIR DESPUÉS DEL LOGIN EXITOSO
    // Se ejecuta automáticamente cuando 'user' cambia después de hacer login()
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

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        if (!inputValue.trim()) {
            setError('Por favor, ingresa tu código de empleado.');
            return;
        }

        setIsLoading(true);

        try {
            const success = await login(inputValue); 
            
            if (!success) {
                setError('Código no válido o empleado no encontrado.'); 
                setIsLoading(false); // Solo quitamos el loading si falla
            }
            // Si tiene éxito, no quitamos el loading porque el useEffect de arriba
            // se encargará de cambiar la vista inmediatamente.

        } catch (err) {
            console.error(err);
            setError('Error de conexión. Intenta de nuevo.');
            setIsLoading(false);
        }
    };

    const handleGoToKiosk = () => {
        setView('timeclock');
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center relative font-sans bg-[#F2F2F7] overflow-hidden">
            
            {/* FONDO MESH GRADIENT */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[0%] w-[60vw] h-[60vw] bg-[#007AFF]/15 rounded-full filter blur-[100px] mix-blend-multiply animate-pulse" style={{animationDuration: '8s'}}></div>
                <div className="absolute bottom-[-10%] right-[0%] w-[50vw] h-[50vw] bg-[#5856D6]/15 rounded-full filter blur-[100px] mix-blend-multiply animate-pulse" style={{animationDuration: '10s', animationDelay: '2s'}}></div>
            </div>

            {/* BOTONES LIQUID GLASS A LA DERECHA */}
            <div className="absolute left-[calc(50%+260px)] top-1/2 -translate-y-1/2 flex-col gap-6 z-20 hidden md:flex">
                
                {/* Botón Ventas */}
                <a 
                    href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="group relative flex flex-col items-center justify-center w-24 h-24 rounded-[2rem] bg-white/40 backdrop-blur-xl border border-white/60 shadow-[0_8px_32px_rgba(0,122,255,0.15)] hover:shadow-[0_16px_48px_rgba(0,122,255,0.25)] transition-all duration-500 hover:-translate-y-2 overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-white/60 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                    <ShoppingCart size={28} className="text-[#007AFF] relative z-10 mb-2 group-hover:scale-110 transition-transform duration-300" strokeWidth={1.5} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#007AFF] relative z-10">Ventas</span>
                    <ExternalLink size={12} className="absolute top-3 right-3 text-[#007AFF]/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </a>

                {/* Botón Farmalasa */}
                <a 
                    href="https://farmalasa.com" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="group relative flex flex-col items-center justify-center w-24 h-24 rounded-[2rem] bg-white/40 backdrop-blur-xl border border-white/60 shadow-[0_8px_32px_rgba(88,86,214,0.15)] hover:shadow-[0_16px_48px_rgba(88,86,214,0.25)] transition-all duration-500 hover:-translate-y-2 overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-white/60 opacity-50 group-hover:opacity-100 transition-opacity"></div>
                    <Pill size={28} className="text-[#5856D6] relative z-10 mb-2 group-hover:scale-110 transition-transform duration-300" strokeWidth={1.5} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#5856D6] relative z-10">FarmaLasa</span>
                    <ExternalLink size={12} className="absolute top-3 right-3 text-[#5856D6]/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                </a>

            </div>

            {/* CONTENEDOR PRINCIPAL */}
            <div className="w-full max-w-[480px] p-4 relative z-10 flex flex-col items-center">
                
                <div className="bg-white/60 backdrop-blur-[40px] backdrop-saturate-[150%] rounded-[2.5rem] border border-white/80 shadow-[0_24px_48px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,1)] p-8 md:p-10 relative w-full">
                    
                    {/* ICONO Y TÍTULOS */}
                    <div className="flex flex-col items-center mb-10">
                        <div className="w-16 h-16 bg-gradient-to-b from-white to-white/60 shadow-[0_12px_24px_rgba(0,122,255,0.15),inset_0_1px_0_rgba(255,255,255,1)] border border-white/80 rounded-[1.25rem] flex items-center justify-center text-[#007AFF] mb-5 relative overflow-hidden group">
                             <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                            <Building2 size={32} strokeWidth={1.5} className="relative z-10"/>
                        </div>
                        <h1 className="text-[34px] font-bold text-slate-900 tracking-tight leading-none mb-2 text-center">
                            Portal Empleados
                        </h1>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.15em] text-center w-full">
                            Farmacias La Popular & La Salud
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="flex flex-col relative pb-6">
                        
                        {/* INPUT CÓDIGO (CON PROFUNDIDAD) */}
                        <div className="relative group z-20">
                            <div className="absolute inset-y-0 left-0 pl-4 w-12 flex items-center justify-center pointer-events-none text-black/30 group-focus-within:text-[#007AFF] transition-colors">
                                <ScanBarcode size={22} className="transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] opacity-100 scale-100 rotate-0" />
                            </div>
                            
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="INGRESA TU CÓDIGO"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-black/[0.03] border border-black/[0.05] rounded-[1.25rem] text-black placeholder-black/30 focus:outline-none focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_4px_16px_rgba(0,122,255,0.1),inset_0_1px_0_rgba(255,255,255,1)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] transition-all duration-300 text-lg md:text-xl tracking-[0.2em] font-black uppercase text-center"
                                autoComplete="off"
                            />
                        </div>
                        
                        {/* CONTENEDOR DE ERROR DINÁMICO */}
                        <div 
                            className={`absolute left-0 right-0 top-full z-10 transform-gpu transition-all duration-300 ease-in-out ${error ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-4 pointer-events-none'}`}
                        >
                            <div className="p-3 mt-2 bg-red-100/80 backdrop-blur-md rounded-[1rem] border border-red-200/50 flex items-center justify-center shadow-[0_8px_16px_rgba(239,68,68,0.15)]">
                                <p className="text-red-600 text-[12px] font-bold uppercase tracking-wide text-center leading-tight">{error}</p>
                            </div>
                        </div>

                        {/* BOTÓN INGRESO */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className={`w-full py-4 bg-[#007AFF] hover:bg-[#0066CC] active:scale-[0.98] text-white rounded-[1.25rem] font-semibold text-[17px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(0,122,255,0.25),inset_0_1px_0_rgba(255,255,255,0.2)] transform-gpu duration-300 ease-in-out z-20 relative hover:-translate-y-[1px] ${error ? 'mt-[4.5rem]' : 'mt-6'}`}
                        >
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'Ingresar'}
                        </button>
                    </form>

                    {/* ✅ BOTÓN KIOSCO - PROFUNDIDAD EXTREMA LIQUID GLASS */}
                    <div className="mt-8 pt-8 border-t border-black/[0.05] relative">
                        {/* Sombra de resplandor de fondo para dar la ilusión de que levita mucho */}
                        <div className="absolute inset-0 bg-[#007AFF]/5 blur-2xl rounded-full scale-90 translate-y-4"></div>
                        
                        <button 
                            onClick={handleGoToKiosk}
                            className="relative overflow-hidden w-full p-4 md:p-5 rounded-[1.75rem] bg-white/60 backdrop-blur-xl shadow-[0_16px_40px_rgba(0,0,0,0.1),inset_0_2px_4px_rgba(255,255,255,1),inset_0_-2px_4px_rgba(0,0,0,0.02)] border border-white hover:bg-white/80 hover:shadow-[0_24px_50px_rgba(0,122,255,0.2),inset_0_2px_4px_rgba(255,255,255,1)] hover:border-[#007AFF]/40 transition-all duration-500 flex items-center justify-between group active:scale-95 hover:-translate-y-2 z-10"
                        >
                            {/* Reflejo estilo cristal animado */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/80 to-white/0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>

                            <div className="flex items-center gap-4 relative z-10">
                                {/* Icono con profundidad interna */}
                                <div className="w-12 h-12 rounded-[1.25rem] bg-gradient-to-b from-[#007AFF]/10 to-[#007AFF]/20 shadow-[inset_0_2px_4px_rgba(255,255,255,0.5),inset_0_-2px_4px_rgba(0,122,255,0.1)] text-[#007AFF] flex items-center justify-center group-hover:bg-[#007AFF] group-hover:text-white group-hover:shadow-[0_8px_16px_rgba(0,122,255,0.4),inset_0_2px_4px_rgba(255,255,255,0.3)] transition-all duration-500 transform-gpu group-hover:scale-105 border border-[#007AFF]/20">
                                    <Clock size={22} strokeWidth={2.5} className="group-hover:animate-pulse" />
                                </div>
                                <div className="text-left">
                                    <p className="text-[15px] font-black text-slate-800 uppercase tracking-widest group-hover:text-[#007AFF] transition-colors duration-300">Terminal Kiosco</p>
                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 group-hover:text-slate-500 transition-colors duration-300">Marcaje Rápido</p>
                                </div>
                            </div>
                            <ChevronRight size={24} className="text-[#007AFF]/30 group-hover:text-[#007AFF] group-hover:translate-x-2 transition-all duration-500 relative z-10" strokeWidth={3} />
                        </button>
                    </div>

                </div>

            </div>
            
            {/* VERSIÓN MÓVIL DE LOS BOTONES EXTERNOS */}
            <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 z-20 md:hidden px-4">
                <a 
                    href="https://clientesdte.oss.com.sv/farma_salud/dashboard.php" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/40 backdrop-blur-xl border border-white/60 shadow-lg text-[#007AFF]"
                >
                    <ShoppingCart size={18} strokeWidth={2} />
                    <span className="text-[11px] font-black uppercase tracking-widest">Ventas</span>
                </a>
                <a 
                    href="https://farmalasa.com" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-white/40 backdrop-blur-xl border border-white/60 shadow-lg text-[#5856D6]"
                >
                    <Pill size={18} strokeWidth={2} />
                    <span className="text-[11px] font-black uppercase tracking-widest">FarmaLasa</span>
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