import React, { useState, useEffect, useRef } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    ShoppingCart, Pill, AlertCircle, Lock, Camera, CameraOff, User as UserIcon
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, loginWithUsername, isAdmin, user } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [loginMode, setLoginMode] = useState('code');
    const inputRef = useRef(null);
    const [scannerActive, setScannerActive] = useState(false);
    const scannerRef = useRef(null);
    const usernameRef = useRef(null);
    const userPasswordRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
    }, []);

    // Cleanup: detener cámara al desmontar el componente
    useEffect(() => {
        return () => {
            const s = scannerRef.current;
            scannerRef.current = null;
            if (s) { try { s.reset(); } catch {} }
        };
    }, []);

    // Inicializar scanner cuando scannerActive pasa a true (el video ya está en el DOM)
    useEffect(() => {
        if (!scannerActive) return;
        let cancelled = false;
        (async () => {
            try {
                const { BrowserMultiFormatReader } = await import('@zxing/browser');
                if (cancelled) return;
                const codeReader = new BrowserMultiFormatReader();
                scannerRef.current = codeReader;
                const videoEl = document.getElementById('qr-video');
                await codeReader.decodeFromVideoDevice(undefined, videoEl, async (result) => {
                    if (!result) return;
                    const s = scannerRef.current;
                    scannerRef.current = null;
                    if (s) { try { s.reset(); } catch {} }
                    setScannerActive(false);
                    setIsLoading(true);
                    const success = await login(result.getText().trim().toUpperCase());
                    if (!success) {
                        setError('Código no encontrado. Intenta de nuevo.');
                        setIsLoading(false);
                    }
                });
            } catch {
                if (!cancelled) {
                    setScannerActive(false);
                    setError('No se pudo acceder a la cámara.');
                }
            }
        })();
        return () => {
            cancelled = true;
            const s = scannerRef.current;
            scannerRef.current = null;
            if (s) { try { s.reset(); } catch {} }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scannerActive]);

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

    const stopScanner = () => {
        const s = scannerRef.current;
        scannerRef.current = null;
        if (s) { try { s.reset(); } catch {} }
        setScannerActive(false);
    };

    const handleUsernameLogin = async (e) => {
        e.preventDefault();
        setError('');
        const username = usernameRef.current?.value?.trim() || '';
        const password = userPasswordRef.current?.value || '';
        if (!username || !password) {
            setError('Ingresa usuario y contraseña.');
            return;
        }
        setIsLoading(true);
        try {
            const result = await loginWithUsername(username, password);
            if (!result.ok) {
                setError(result.error || 'Credenciales inválidas.');
                setIsLoading(false);
                if (userPasswordRef.current) userPasswordRef.current.value = '';
                userPasswordRef.current?.focus();
            }
        } catch {
            setError('Error de conexión. Intenta de nuevo.');
            setIsLoading(false);
        }
    };

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

            {/* 🚨 RESTAURADO: DOCK LATERAL DERECHO (Desktop) */}
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

            {/* 🚨 2. LA MAGIA CONTRA EL CORTE: 'my-auto' en lugar de justify-center. */}
            <div className="w-full max-w-[460px] my-auto rounded-[3.5rem] p-8 md:p-12 relative bg-white/40 backdrop-blur-3xl backdrop-saturate-[200%] border border-white/60 shadow-[0_24px_60px_rgba(0,0,0,0.08),inset_0_2px_20px_rgba(255,255,255,0.8)] transition-all">

                <div className="flex flex-col items-center mb-8">
                    <div className="w-20 h-20 flex items-center justify-center mb-6">
                        <img
                            src="/LogoFLS.svg"
                            alt="FarmaLasa"
                            className="w-20 h-20 object-contain"
                            style={{ background: 'transparent' }}
                        />
                    </div>
                    <h3 className="text-[28px] md:text-[34px] font-black text-slate-800 tracking-tight leading-none mb-3 text-center">
                        Portal
                    </h3>
                    <p className="text-[10px] font-black text-[#007AFF]/80 uppercase tracking-[0.2em] text-center w-full">
                        Farmacias La Popular & La Salud
                    </p>
                </div>

                {/* TAB TOGGLE: Carné / Usuario */}
                <div className="flex bg-white/30 backdrop-blur-md border border-white/60 rounded-[2rem] p-1.5 mb-6 shadow-[inset_0_2px_8px_rgba(0,0,0,0.02)]">
                    <button
                        type="button"
                        onClick={() => { stopScanner(); setLoginMode('code'); setError(''); }}
                        className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-[1.5rem] transition-all duration-300 ${loginMode === 'code' ? 'bg-white text-[#007AFF] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        Carné
                    </button>
                    <button
                        type="button"
                        onClick={() => { stopScanner(); setLoginMode('username'); setError(''); }}
                        className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-[1.5rem] transition-all duration-300 ${loginMode === 'username' ? 'bg-white text-[#007AFF] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        Usuario
                    </button>
                </div>

                <form onSubmit={loginMode === 'username' ? handleUsernameLogin : handleLogin} className="flex flex-col gap-5 relative">
                    {loginMode === 'code' ? (
                        <div className="flex flex-col gap-3">
                            <div className="relative group z-20 flex items-center gap-2">
                                <div className="relative flex-1 flex items-center">
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
                                <button
                                    type="button"
                                    onClick={() => scannerActive ? stopScanner() : setScannerActive(true)}
                                    title={scannerActive ? 'Cerrar cámara' : 'Escanear carné con cámara'}
                                    className={`shrink-0 w-[58px] h-[58px] flex items-center justify-center rounded-[1.5rem] border backdrop-blur-md shadow-sm transition-all duration-300 active:scale-95 ${
                                        scannerActive
                                            ? 'bg-red-50/80 border-red-200/60 text-red-400 hover:bg-red-100 hover:text-red-500'
                                            : 'bg-white/40 border-white/60 text-slate-400 hover:bg-white hover:text-[#007AFF] hover:border-[#007AFF]/20'
                                    }`}
                                >
                                    {scannerActive
                                        ? <CameraOff size={20} strokeWidth={2} />
                                        : <Camera size={20} strokeWidth={2} />
                                    }
                                </button>
                            </div>

                            {scannerActive && (
                                <div className="animate-in fade-in slide-in-from-top-2 duration-300 flex flex-col gap-2">
                                    {/* Visor con esquinas decorativas */}
                                    <div className="relative w-full h-[260px] rounded-[1.5rem] overflow-hidden bg-black border border-black/20">
                                        <style>{`@keyframes scan{0%{top:8%}50%{top:84%}100%{top:8%}}`}</style>
                                        {/* Línea de escaneo */}
                                        <div style={{
                                            position: 'absolute', left: '5%', right: '5%',
                                            height: '2px', background: 'rgba(0,122,255,0.9)',
                                            animation: 'scan 2s ease-in-out infinite',
                                            zIndex: 10, boxShadow: '0 0 10px rgba(0,122,255,0.7)'
                                        }} />
                                        {/* Esquinas decorativas */}
                                        <div style={{position:'absolute',top:12,left:12,width:22,height:22,borderTop:'3px solid #007AFF',borderLeft:'3px solid #007AFF',borderRadius:'4px 0 0 0',zIndex:11}} />
                                        <div style={{position:'absolute',top:12,right:12,width:22,height:22,borderTop:'3px solid #007AFF',borderRight:'3px solid #007AFF',borderRadius:'0 4px 0 0',zIndex:11}} />
                                        <div style={{position:'absolute',bottom:12,left:12,width:22,height:22,borderBottom:'3px solid #007AFF',borderLeft:'3px solid #007AFF',borderRadius:'0 0 0 4px',zIndex:11}} />
                                        <div style={{position:'absolute',bottom:12,right:12,width:22,height:22,borderBottom:'3px solid #007AFF',borderRight:'3px solid #007AFF',borderRadius:'0 0 4px 0',zIndex:11}} />
                                        <video id="qr-video" className="w-full h-full object-cover" autoPlay playsInline muted />
                                    </div>
                                    {/* Instrucción con fondo semitransparente */}
                                    <div className="flex items-center justify-center gap-2 px-3 py-2 bg-black/10 backdrop-blur-sm rounded-[1rem] mt-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#007AFF] animate-pulse shrink-0" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center">
                                            Apunta al código de barras de tu carné
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="relative group flex items-center">
                                <div className="absolute left-0 w-14 flex items-center justify-center pointer-events-none text-slate-400 group-focus-within:text-[#007AFF] transition-colors duration-300 z-10">
                                    <UserIcon size={20} strokeWidth={2} />
                                </div>
                                <input
                                    ref={usernameRef}
                                    type="text"
                                    placeholder="nombre.apellido"
                                    autoComplete="username"
                                    className="w-full pl-14 pr-5 py-4 bg-white/30 hover:bg-white/50 backdrop-blur-md border border-white/60 rounded-[1.5rem] text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-white focus:ring-4 focus:ring-[#007AFF]/15 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] transition-all text-[14px] font-bold"
                                />
                            </div>
                            <div className="relative group flex items-center">
                                <div className="absolute left-0 w-14 flex items-center justify-center pointer-events-none text-slate-400 group-focus-within:text-[#007AFF] transition-colors duration-300 z-10">
                                    <Lock size={20} strokeWidth={2} />
                                </div>
                                <input
                                    ref={userPasswordRef}
                                    type="password"
                                    placeholder="Contraseña"
                                    autoComplete="current-password"
                                    className="w-full pl-14 pr-5 py-4 bg-white/30 hover:bg-white/50 backdrop-blur-md border border-white/60 rounded-[1.5rem] text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-white focus:ring-4 focus:ring-[#007AFF]/15 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)] transition-all text-[14px] font-bold"
                                />
                            </div>
                        </div>
                    )}

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

                {/* 🚨 DIVISOR Y BOTÓN KIOSCO: Solo se renderizan si es una PC */}
                {!isMobileOrApp() && (
                    <>
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
                    </>
                )}
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