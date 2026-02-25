import React, { useState } from 'react';
import { 
    Building2, User, Lock, Clock, 
    ShieldCheck, ScanBarcode, Loader2, ChevronRight 
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login } = useAuth(); // ✅ Solo necesitamos AuthContext
    
    const [loginType, setLoginType] = useState('employee'); 
    const [inputValue, setInputValue] = useState(''); 
    const [passwordValue, setPasswordValue] = useState(''); 
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleTabSwitch = (type) => {
        if (loginType === type) return;
        setLoginType(type);
        setInputValue('');
        setPasswordValue('');
        setError('');
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');

        // Validación básica de campos vacíos
        if (!inputValue.trim()) {
            setError('Por favor, ingresa tu código o usuario.');
            return;
        }

        // (Opcional) Si quisieras validar contraseña para admin en el futuro:
        if (loginType === 'admin' && !passwordValue.trim()) {
             // Por ahora la BD no tiene passwords, pero dejamos la validación visual
             // setError('Ingresa tu contraseña.');
             // return;
        }

        setIsLoading(true);

        try {
            // ✅ LLAMADA REAL A SUPABASE
            // Pasamos el inputValue (Código/Email)
            const success = await login(inputValue); 
            
            if (success) {
                // Recuperamos el usuario recién guardado para saber a dónde redirigir
                // (Esto es necesario porque el estado 'user' de react puede tardar un tick en actualizarse)
                const storedUser = JSON.parse(localStorage.getItem('sb_user'));
                
                if (storedUser) {
                    if (storedUser.is_admin) {
                        setView('dashboard');
                    } else {
                        setActiveEmployee(storedUser);
                        setView('employee-detail');
                    }
                }
            } else {
                // Si login devuelve false, el AuthContext ya mostró alert, 
                // pero aquí mostramos error visual en el input
                setError('Credenciales no válidas.'); 
            }

        } catch (err) {
            console.error(err);
            setError('Error de conexión. Intenta de nuevo.');
        } finally {
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

            {/* CONTENEDOR PRINCIPAL */}
            <div className="w-full max-w-[480px] p-4 relative z-10">
                <div className="bg-white/50 backdrop-blur-[40px] backdrop-saturate-[150%] rounded-[2.5rem] border border-white/80 shadow-[0_24px_48px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,1)] p-8 md:p-10 relative">
                    
                    {/* ICONO Y TÍTULOS */}
                    <div className="flex flex-col items-center mb-8">
                        <div className="w-16 h-16 bg-gradient-to-b from-white to-white/60 shadow-[0_8px_16px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] border border-white/80 rounded-[1.25rem] flex items-center justify-center text-[#007AFF] mb-5">
                            <Building2 size={32} strokeWidth={1.5} />
                        </div>
                        <h1 className="text-[34px] font-bold text-slate-900 tracking-tight leading-none mb-2">
                            Portal
                        </h1>
                        <p className="text-[12px] font-bold text-slate-500 uppercase tracking-[0.15em] text-center w-full">
                            Farmacias La Popular y La Salud
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        
                        {/* TOGGLE iOS */}
                        <div className="bg-black/[0.05] p-1 rounded-[1.25rem] relative flex items-center">
                            <div 
                                className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-[1rem] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transform-gpu transition-transform duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                                style={{ transform: loginType === 'admin' ? 'translateX(100%)' : 'translateX(0)' }}
                            ></div>
                            
                            <button
                                type="button"
                                onClick={() => handleTabSwitch('employee')}
                                className={`flex-1 py-3 text-[14px] font-semibold transition-colors duration-200 z-10 flex items-center justify-center gap-2 ${loginType === 'employee' ? 'text-black' : 'text-black/50 hover:text-black/70'}`}
                            >
                                <ScanBarcode size={18} /> Código
                            </button>
                            <button
                                type="button"
                                onClick={() => handleTabSwitch('admin')}
                                className={`flex-1 py-3 text-[14px] font-semibold transition-colors duration-200 z-10 flex items-center justify-center gap-2 ${loginType === 'admin' ? 'text-black' : 'text-black/50 hover:text-black/70'}`}
                            >
                                <ShieldCheck size={18} /> Admin
                            </button>
                        </div>

                        {/* INPUTS */}
                        <div className="space-y-0">
                            
                            {/* INPUT 1: CÓDIGO O USUARIO */}
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 w-12 flex items-center justify-center pointer-events-none text-black/30 group-focus-within:text-[#007AFF] transition-colors">
                                    <ScanBarcode size={22} className={`absolute transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${loginType === 'employee' ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 -rotate-90'}`} />
                                    <User size={22} className={`absolute transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${loginType === 'admin' ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 rotate-90'}`} />
                                </div>
                                
                                <input
                                    type={loginType === 'employee' ? 'text' : 'text'} // Cambiado a text para ver qué escribes
                                    placeholder={loginType === 'employee' ? '...' : 'Usuario'}
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    className={`w-full pl-12 pr-4 py-4 bg-black/[0.04] border border-black/[0.04] rounded-[1.25rem] text-black placeholder-black/30 focus:outline-none focus:bg-white focus:border-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] transition-all duration-300 ${loginType === 'employee' ? 'text-xl tracking-widest font-bold uppercase' : 'text-[17px] font-medium tracking-normal'}`}
                                    autoComplete="off"
                                />
                            </div>

                            {/* INPUT 2: CONTRASEÑA ADMIN */}
                            <div 
                                className={`transform-gpu transition-all duration-400 ease-[cubic-bezier(0.25,0.8,0.25,1)] overflow-hidden ${loginType === 'admin' ? 'max-h-[100px] opacity-100 mt-4 translate-y-0' : 'max-h-0 opacity-0 mt-0 -translate-y-2 pointer-events-none'}`}
                            >
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-4 w-12 flex items-center justify-center pointer-events-none text-black/30 group-focus-within:text-[#007AFF] transition-colors">
                                        <Lock size={22} />
                                    </div>
                                    <input
                                        type="password"
                                        placeholder="Contraseña"
                                        value={passwordValue}
                                        onChange={(e) => setPasswordValue(e.target.value)}
                                        className="w-full pl-12 pr-4 py-4 bg-black/[0.04] border border-black/[0.04] rounded-[1.25rem] text-black text-[17px] font-medium placeholder-black/30 focus:outline-none focus:bg-white focus:border-white focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] transition-all duration-300"
                                    />
                                </div>
                            </div>
                            
                            {/* ALERTA DE ERROR */}
                            <div className={`transform-gpu transition-all duration-300 overflow-hidden ${error ? 'max-h-[50px] opacity-100 mt-4 translate-y-0' : 'max-h-0 opacity-0 mt-0 -translate-y-1'}`}>
                                <div className="p-3 bg-red-100/50 rounded-[1rem] flex items-center justify-center gap-2">
                                    <p className="text-red-600 text-[13px] font-semibold">{error}</p>
                                </div>
                            </div>
                        </div>

                        {/* BOTÓN INGRESO */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-[#007AFF] hover:bg-[#0066CC] active:scale-[0.98] text-white rounded-[1.25rem] font-semibold text-[17px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(0,122,255,0.2)]"
                        >
                            {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'Ingresar'}
                        </button>
                    </form>

                    {/* BOTÓN KIOSCO */}
                    <div className="mt-8 pt-8 border-t border-black/[0.05]">
                        <button 
                            onClick={handleGoToKiosk}
                            className="w-full p-4 rounded-[1.25rem] bg-white/40 hover:bg-white/70 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-white/50 transition-all flex items-center justify-between group active:scale-[0.98]"
                        >
                            <div className="flex items-center gap-4">
                                <div className="text-[#007AFF]">
                                    <Clock size={24} strokeWidth={1.5} />
                                </div>
                                <div className="text-left">
                                    <p className="text-[15px] font-semibold text-slate-900">Control de Asistencia</p>
                                    <p className="text-[12px] font-medium text-slate-500 mt-0.5">Terminal de marcaje rápido</p>
                                </div>
                            </div>
                            <ChevronRight size={20} className="text-black/30 group-hover:text-black/60 transition-colors" strokeWidth={2} />
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default LoginView;