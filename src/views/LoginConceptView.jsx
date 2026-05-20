import React, { useState, useEffect, useRef } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    AlertCircle, Lock, Camera, CameraOff, User as UserIcon, X,
    ShoppingCart, Pill,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';

// ─── Borderless labeled input for the white panel ─────────────────────────────
const FieldInput = React.forwardRef(({ label, children, ...props }, ref) => (
    <div className="group">
        <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 transition-colors duration-200 group-focus-within:text-[#0052CC]">
            {label}
        </label>
        <input
            ref={ref}
            {...props}
            className="w-full border-b-2 border-slate-200 focus:border-[#0052CC] bg-transparent py-3 text-slate-900 placeholder-slate-300 font-bold text-[16px] outline-none transition-colors duration-200"
        />
    </div>
));
FieldInput.displayName = 'FieldInput';

// ─── Left brand panel — solid cobalt identity ─────────────────────────────────
const BrandPanel = ({ onKioskClick }) => (
    <div className="relative hidden md:flex w-[44%] bg-[#0052CC] flex-col justify-between p-12 overflow-hidden select-none flex-shrink-0">

        {/* Dot grid texture */}
        <div className="absolute inset-0"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.13) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

        {/* Geometric circle accents */}
        <div className="absolute -right-40 -bottom-40 w-[520px] h-[520px] rounded-full border border-white/[0.09] pointer-events-none" />
        <div className="absolute -right-20 -bottom-20 w-[340px] h-[340px] rounded-full border border-white/[0.06] pointer-events-none" />
        <div className="absolute right-20 bottom-20 w-[160px] h-[160px] rounded-full border border-white/[0.05] pointer-events-none" />

        {/* Watermark large P */}
        <div className="absolute -bottom-8 -left-4 text-white/[0.04] font-black leading-none select-none pointer-events-none"
            style={{ fontSize: '340px', letterSpacing: '-0.05em' }}>P</div>

        {/* Top: logo + brand name */}
        <div className="relative z-10 flex items-center gap-3">
            <img src="/LogoFLS.svg" alt="FarmaLasa" className="w-10 h-10 object-contain opacity-90" />
            <div>
                <p className="text-white font-black text-[11px] uppercase tracking-[0.25em] leading-none">FarmaLasa</p>
                <p className="text-white/50 text-[9px] font-bold uppercase tracking-widest mt-0.5">Portal de Gestión</p>
            </div>
        </div>

        {/* Center: main identity */}
        <div className="relative z-10">
            <p className="text-white/45 text-[10px] font-black uppercase tracking-[0.35em] mb-4">Bienvenido al</p>
            <h1 className="text-white font-black leading-[0.88] tracking-[-0.03em] mb-6"
                style={{ fontSize: 'clamp(52px, 5.5vw, 82px)' }}>
                Portal
            </h1>
            <p className="text-white/55 text-[13px] font-medium leading-relaxed max-w-[200px]">
                Sistema integral para Farmacias La Popular y La Salud.
            </p>
        </div>

        {/* Bottom: kiosk link */}
        {!isMobileOrApp() && (
            <button onClick={onKioskClick}
                className="relative z-10 flex items-center gap-3 group w-fit active:opacity-70 transition-opacity">
                <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center
                               group-hover:bg-white/10 transition-colors duration-200">
                    <Clock size={16} className="text-white" strokeWidth={2} />
                </div>
                <div>
                    <p className="text-white/40 text-[8px] font-black uppercase tracking-widest">Acceso rápido a</p>
                    <p className="text-white font-black text-[13px]">Terminal Kiosco</p>
                </div>
                <ChevronRight size={15} className="text-white/30 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all duration-200 ml-1" strokeWidth={2.5} />
            </button>
        )}

        {/* External links — bottom right corner */}
        <div className="absolute bottom-8 right-8 flex flex-col items-end gap-2 z-10">
            {[
                { href: 'https://clientesdte.oss.com.sv/farma_salud/dashboard.php', label: 'Ventas' },
                { href: 'https://farmalasa.com', label: 'Web' },
            ].map(link => (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] font-black uppercase tracking-widest text-white/25 hover:text-white/60 transition-colors duration-200">
                    {link.label} →
                </a>
            ))}
        </div>
    </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
const LoginConceptView = ({ setView, setActiveEmployee, onExitConcept }) => {
    const { login, loginWithUsername, isAdmin, user, completePasswordChange } = useAuth();

    const [isLoading, setIsLoading]           = useState(false);
    const [error, setError]                   = useState('');
    const [loginMode, setLoginMode]           = useState('code');
    const [newPassword, setNewPassword]       = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changePassError, setChangePassError] = useState('');
    const [changePassLoading, setChangePassLoading] = useState(false);
    const [mustChangePwd, setMustChangePwd]   = useState(false);
    const [pendingUserLocal, setPendingUserLocal] = useState(null);
    const [scannerActive, setScannerActive]   = useState(false);
    const [scanFeedback, setScanFeedback]     = useState(null);

    const inputRef        = useRef(null);
    const usernameRef     = useRef(null);
    const userPasswordRef = useRef(null);
    const loginModeRef    = useRef(loginMode);
    const videoRef        = useRef(null);
    const scannerRef      = useRef(null);
    const streamRef       = useRef(null);
    const cooldownRef     = useRef(false);

    useEffect(() => { loginModeRef.current = loginMode; }, [loginMode]);

    useEffect(() => {
        if (loginMode === 'code' && inputRef.current && !scannerActive) inputRef.current.focus();
        else if (loginMode === 'username' && usernameRef.current) usernameRef.current.focus();
    }, [loginMode, scannerActive]);

    const stopCameraSafely = () => {
        if (scannerRef.current) { try { scannerRef.current.reset(); } catch {} scannerRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (videoRef.current?.srcObject) {
            try {
                videoRef.current.srcObject.getTracks().forEach(t => t.stop());
                videoRef.current.srcObject = null;
                videoRef.current.src = '';
                videoRef.current.removeAttribute('src');
            } catch {}
        }
    };

    useEffect(() => () => stopCameraSafely(), []);

    useEffect(() => {
        if (!scannerActive) return;
        let cancelled = false;
        let isWarmup = true;
        const warmupTimer = setTimeout(() => { isWarmup = false; }, 500);

        (async () => {
            try {
                const { BrowserMultiFormatReader } = await import('@zxing/browser');
                const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
                if (cancelled) return;
                const hints = new Map();
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
                    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.QR_CODE,
                ]);
                hints.set(DecodeHintType.TRY_HARDER, true);
                const codeReader = new BrowserMultiFormatReader(hints);
                scannerRef.current = codeReader;
                await new Promise(r => setTimeout(r, 300));
                if (cancelled || !videoRef.current) return;
                cooldownRef.current = false;
                await codeReader.decodeFromVideoDevice(undefined, videoRef.current, async (result) => {
                    if (!result || cooldownRef.current || isWarmup || cancelled) return;
                    cooldownRef.current = true;
                    const scannedCode = result.getText().trim().toUpperCase();
                    if (inputRef.current) inputRef.current.value = scannedCode;
                    if (videoRef.current?.srcObject) streamRef.current = videoRef.current.srcObject;
                    stopCameraSafely();
                    setScannerActive(false);
                    setScanFeedback({ status: 'reading', code: scannedCode, message: 'Verificando...' });
                    setIsLoading(true);
                    const success = await login(scannedCode);
                    if (!success) {
                        if (inputRef.current) inputRef.current.value = '';
                        setScanFeedback({ status: 'error', code: scannedCode, message: 'Inválido. Reabriendo cámara...' });
                        setIsLoading(false);
                        setTimeout(() => {
                            if (loginModeRef.current === 'code') { setScanFeedback(null); setScannerActive(true); }
                        }, 1000);
                    } else {
                        setScanFeedback({ status: 'success', code: scannedCode, message: '¡Acceso concedido!' });
                    }
                });
            } catch {
                if (!cancelled) { stopCameraSafely(); setScannerActive(false); setError('No se pudo acceder a la cámara.'); }
            }
        })();

        return () => { cancelled = true; clearTimeout(warmupTimer); stopCameraSafely(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scannerActive]);

    useEffect(() => {
        if (user) {
            if (isAdmin) setView('dashboard');
            else { setActiveEmployee(user); setView('employee-detail'); }
        }
    }, [user, isAdmin, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(''), 4000); return () => clearTimeout(t); }
    }, [error]);

    const handleStopScannerBtn = () => {
        cooldownRef.current = false; stopCameraSafely(); setScannerActive(false); setScanFeedback(null);
    };

    const handleUsernameLogin = async (e) => {
        e.preventDefault(); setError('');
        const username = usernameRef.current?.value?.trim() || '';
        const password = userPasswordRef.current?.value || '';
        if (!username || !password) { setError('Ingresa usuario y contraseña.'); return; }
        setIsLoading(true);
        try {
            const result = await loginWithUsername(username, password);
            if (!result.ok) {
                setError(result.error || 'Credenciales inválidas.'); setIsLoading(false);
                if (userPasswordRef.current) userPasswordRef.current.value = '';
                userPasswordRef.current?.focus();
            } else if (result.mustChangePassword) {
                setPendingUserLocal(result.user); setMustChangePwd(true); setIsLoading(false);
            } else { setIsLoading(false); }
        } catch { setError('Error de conexión.'); setIsLoading(false); }
    };

    const handleLogin = async (e) => {
        e.preventDefault(); setError('');
        const code = inputRef.current?.value || '';
        if (!code.trim()) { setError('Por favor, ingresa tu código.'); return; }
        setIsLoading(true);
        try {
            const success = await login(code);
            if (!success) {
                if (inputRef.current) inputRef.current.value = '';
                setError('Código inválido.'); setIsLoading(false); inputRef.current?.focus();
            }
        } catch {
            setError('Error de conexión.'); setIsLoading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const handleChangePassword = async () => {
        setChangePassError('');
        if (newPassword.length < 8) { setChangePassError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(newPassword)) { setChangePassError('Debe incluir una letra mayúscula.'); return; }
        if (!/[0-9]/.test(newPassword)) { setChangePassError('Debe incluir un número.'); return; }
        if (newPassword !== confirmPassword) { setChangePassError('Las contraseñas no coinciden.'); return; }
        setChangePassLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
            if (error) { setChangePassError(error.message); setChangePassLoading(false); return; }
            completePasswordChange(pendingUserLocal);
            setMustChangePwd(false); setPendingUserLocal(null); setNewPassword(''); setConfirmPassword('');
        } catch { setChangePassError('Error de conexión.'); }
        setChangePassLoading(false);
    };

    // ── Change password ───────────────────────────────────────────────────────
    if (mustChangePwd) {
        return (
            <div className="flex w-full min-h-[100dvh]">
                <BrandPanel onKioskClick={() => setView('timeclock')} />
                <div className="flex-1 flex items-center justify-center px-8 md:px-14 bg-white">
                    <div className="w-full max-w-sm">
                        <div className="mb-10">
                            <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
                                <Lock size={18} className="text-amber-500" />
                            </div>
                            <h2 className="text-slate-900 font-black text-[26px] tracking-tight leading-none mb-2">
                                Nueva contraseña
                            </h2>
                            <p className="text-slate-400 text-[13px]">Primer acceso — establece tu contraseña personal.</p>
                        </div>
                        <form id="chpwd" onSubmit={e => { e.preventDefault(); handleChangePassword(); }} className="flex flex-col gap-7">
                            <FieldInput label="Nueva contraseña (mín. 8 caracteres)"
                                type="password" value={newPassword} onChange={e => { setNewPassword(e.target.value); setChangePassError(''); }} />
                            <FieldInput label="Confirmar contraseña"
                                type="password" value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setChangePassError(''); }} />
                        </form>
                        {changePassError && (
                            <p className="mt-4 text-red-500 text-[12px] font-bold flex items-center gap-1.5">
                                <AlertCircle size={13} /> {changePassError}
                            </p>
                        )}
                        <button type="submit" form="chpwd" onClick={handleChangePassword}
                            disabled={changePassLoading || !newPassword || !confirmPassword}
                            className="mt-8 w-full h-[54px] bg-[#0052CC] hover:bg-[#003D99] text-white font-black text-[12px] uppercase tracking-[0.18em] flex items-center justify-center gap-2 transition-colors duration-200 active:scale-[0.98] disabled:opacity-50"
                            style={{ borderRadius: '0.625rem' }}>
                            {changePassLoading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar contraseña'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Main login ────────────────────────────────────────────────────────────
    return (
        <div className="flex w-full min-h-[100dvh]">
            <BrandPanel onKioskClick={() => setView('timeclock')} />

            {/* ── Right: form panel (pure white) ── */}
            <div className="flex-1 flex flex-col justify-center px-8 md:px-14 lg:px-16 py-12 bg-white overflow-y-auto relative">

                {/* Exit concept */}
                <button onClick={onExitConcept}
                    className="absolute top-5 right-5 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-200 hover:text-slate-700 hover:border-slate-300 transition-all duration-200 active:scale-[0.97]">
                    <X size={10} strokeWidth={2.5} /> Diseño original
                </button>

                {/* Mobile: show logo (left panel hidden on mobile) */}
                <div className="flex items-center gap-2.5 mb-10 md:hidden">
                    <img src="/LogoFLS.svg" alt="FarmaLasa" className="w-9 h-9 object-contain" />
                    <div>
                        <p className="text-[#0052CC] font-black text-[11px] uppercase tracking-[0.2em]">Portal</p>
                        <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest">FarmaLasa</p>
                    </div>
                </div>

                <div className="w-full max-w-sm">
                    {/* Heading */}
                    <div className="mb-10">
                        <h2 className="text-slate-900 font-black text-[30px] tracking-tight leading-none mb-2.5">
                            Ingresa al Portal
                        </h2>
                        <p className="text-slate-400 text-[13px] font-medium leading-relaxed">
                            Usa tu carné de empleado o tus credenciales de usuario.
                        </p>
                    </div>

                    {/* Tab toggle — underline style */}
                    <div className="flex gap-7 mb-9 border-b border-slate-100">
                        {[{ key: 'code', label: 'Carné' }, { key: 'username', label: 'Usuario' }].map(tab => (
                            <button key={tab.key} type="button"
                                onClick={() => { handleStopScannerBtn(); setLoginMode(tab.key); setError(''); }}
                                className={`pb-4 text-[11px] font-black uppercase tracking-[0.18em] border-b-2 -mb-px transition-all duration-200 ${
                                    loginMode === tab.key
                                        ? 'border-[#0052CC] text-[#0052CC]'
                                        : 'border-transparent text-slate-400 hover:text-slate-600'
                                }`}>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Form */}
                    <form onSubmit={loginMode === 'username' ? handleUsernameLogin : handleLogin}
                        className="flex flex-col gap-7">

                        {loginMode === 'code' ? (
                            <div className="flex flex-col gap-5">
                                {/* Code input + camera button */}
                                <div className="group">
                                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 transition-colors duration-200 group-focus-within:text-[#0052CC]">
                                        Código de Carné
                                    </label>
                                    <div className="flex items-end gap-3">
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            placeholder="— — — — — —"
                                            autoComplete="off"
                                            spellCheck="false"
                                            className="flex-1 border-b-2 border-slate-200 focus:border-[#0052CC] bg-transparent py-3 text-slate-900 placeholder-slate-300 font-black text-[20px] tracking-[0.35em] uppercase [-webkit-text-security:disc] outline-none transition-colors duration-200"
                                        />
                                        <button type="button"
                                            onClick={() => {
                                                if (scannerActive) { handleStopScannerBtn(); }
                                                else { if (inputRef.current) inputRef.current.value = ''; setScanFeedback(null); cooldownRef.current = false; setScannerActive(true); }
                                            }}
                                            className={`mb-1 w-11 h-11 rounded-[0.625rem] flex items-center justify-center transition-all duration-200 active:scale-[0.97] flex-shrink-0 ${
                                                scannerActive
                                                    ? 'bg-red-50 text-red-400 hover:bg-red-100'
                                                    : 'bg-[#0052CC]/6 text-[#0052CC]/50 hover:bg-[#0052CC]/10 hover:text-[#0052CC]'
                                            }`}>
                                            {scannerActive ? <CameraOff size={18} strokeWidth={2} /> : <Camera size={18} strokeWidth={2} />}
                                        </button>
                                    </div>
                                </div>

                                {/* Camera viewport */}
                                {scannerActive && (
                                    <div className="animate-in fade-in duration-300">
                                        <div className="relative w-full h-[220px] rounded-[0.75rem] overflow-hidden bg-black">
                                            <style>{`@keyframes scan{0%{top:8%}50%{top:84%}100%{top:8%}}`}</style>
                                            <div style={{ position:'absolute',left:'5%',right:'5%',height:'2px',background:'rgba(0,82,204,0.90)',animation:'scan 2s ease-in-out infinite',zIndex:10,boxShadow:'0 0 10px rgba(0,82,204,0.70)' }} />
                                            <div style={{position:'absolute',top:10,left:10,width:16,height:16,borderTop:'2px solid #0052CC',borderLeft:'2px solid #0052CC',borderRadius:'3px 0 0 0',zIndex:11}} />
                                            <div style={{position:'absolute',top:10,right:10,width:16,height:16,borderTop:'2px solid #0052CC',borderRight:'2px solid #0052CC',borderRadius:'0 3px 0 0',zIndex:11}} />
                                            <div style={{position:'absolute',bottom:10,left:10,width:16,height:16,borderBottom:'2px solid #0052CC',borderLeft:'2px solid #0052CC',borderRadius:'0 0 0 3px',zIndex:11}} />
                                            <div style={{position:'absolute',bottom:10,right:10,width:16,height:16,borderBottom:'2px solid #0052CC',borderRight:'2px solid #0052CC',borderRadius:'0 0 3px 0',zIndex:11}} />
                                            <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                                        </div>
                                        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest text-center mt-3">
                                            Apunta al código de barras de tu carné
                                        </p>
                                    </div>
                                )}

                                {/* Scan feedback */}
                                {scanFeedback && (
                                    <div className={`flex items-center gap-2 text-[12px] font-bold ${
                                        scanFeedback.status === 'error'   ? 'text-red-500' :
                                        scanFeedback.status === 'success' ? 'text-emerald-600' : 'text-[#0052CC]'
                                    }`}>
                                        {scanFeedback.status === 'reading' && <Loader2 size={13} className="animate-spin" />}
                                        {scanFeedback.message}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-7 animate-in fade-in duration-300">
                                <FieldInput ref={usernameRef} label="Usuario"
                                    id="username" name="username" type="text"
                                    placeholder="nombre.apellido" autoComplete="username" />
                                <FieldInput ref={userPasswordRef} label="Contraseña"
                                    id="password" name="password" type="password"
                                    placeholder="••••••••" autoComplete="current-password" />
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="flex items-center gap-2 text-red-500 animate-in fade-in duration-200">
                                <AlertCircle size={14} className="shrink-0" strokeWidth={2.5} />
                                <p className="text-[12px] font-bold">{error}</p>
                            </div>
                        )}

                        {/* Submit — rectangle, not pill */}
                        <button type="submit" disabled={isLoading}
                            className="w-full h-[54px] bg-[#0052CC] hover:bg-[#003D99] text-white font-black text-[12px] uppercase tracking-[0.18em] flex items-center justify-center gap-2.5 transition-[background-color,transform] duration-200 active:scale-[0.98] disabled:opacity-60"
                            style={{ borderRadius: '0.625rem' }}>
                            {isLoading
                                ? <Loader2 size={18} className="animate-spin" />
                                : <><span>Ingresar al Portal</span><ChevronRight size={16} strokeWidth={2.5} /></>
                            }
                        </button>
                    </form>

                    {/* Mobile: kiosk link below form */}
                    {!isMobileOrApp() && (
                        <button onClick={() => setView('timeclock')}
                            className="md:hidden mt-8 w-full flex items-center justify-between py-4 border-t border-slate-100 group">
                            <span className="text-slate-400 text-[12px] font-bold group-hover:text-slate-600 transition-colors">
                                Terminal Kiosco — Marcar entrada / salida
                            </span>
                            <ChevronRight size={15} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </button>
                    )}

                    {/* External links — mobile bottom */}
                    <div className="flex items-center gap-5 mt-10 md:hidden">
                        {[
                            { href: 'https://clientesdte.oss.com.sv/farma_salud/dashboard.php', label: 'Ventas', Icon: ShoppingCart },
                            { href: 'https://farmalasa.com', label: 'FarmaLasa', Icon: Pill },
                        ].map(({ href, label, Icon }) => (
                            <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                                <Icon size={13} strokeWidth={2} />
                                <span className="text-[11px] font-bold">{label}</span>
                            </a>
                        ))}
                    </div>

                    {/* Footer */}
                    <p className="mt-12 text-[9px] font-bold uppercase tracking-widest text-slate-300">
                        Portal Farmalasa &copy; {new Date().getFullYear()}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LoginConceptView;
