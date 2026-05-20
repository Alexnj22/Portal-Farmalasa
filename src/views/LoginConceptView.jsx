import React, { useState, useEffect, useRef } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    AlertCircle, Lock, Camera, CameraOff, User as UserIcon, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';

// ─── Shared inline-style tokens ─────────────────────────────────────────────
const S = {
    bg:        { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' },
    bgFocus:   { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(0,82,204,0.50)', boxShadow: '0 0 0 3px rgba(0,82,204,0.12)' },
    card:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 40px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)' },
    ghost:     { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' },
    ghostHov:  { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' },
    iconBox:   { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 0 40px rgba(0,82,204,0.20)' },
    btn:       { background: 'linear-gradient(135deg, #0052CC 0%, #003D99 100%)', boxShadow: '0 0 30px rgba(0,82,204,0.40), 0 8px 20px rgba(0,82,204,0.22)' },
    errBox:    { background: 'rgba(239,68,68,0.08)',  border: '1px solid rgba(239,68,68,0.18)' },
    okBox:     { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' },
    infoBox:   { background: 'rgba(0,82,204,0.08)',   border: '1px solid rgba(0,82,204,0.18)' },
    scanErr:   { background: 'rgba(239,68,68,0.10)',  border: '1px solid rgba(239,68,68,0.20)', color: 'rgb(248,113,113)' },
    scanNorm:  { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.40)' },
};

// ─── Dark input component ─────────────────────────────────────────────────────
const DarkInput = React.forwardRef(({ icon, className = '', ...props }, ref) => (
    <div className="relative flex items-center group">
        {icon && (
            <div className="absolute left-0 top-0 bottom-0 w-12 flex items-center justify-center pointer-events-none z-10 transition-colors duration-200"
                style={{ color: 'rgba(255,255,255,0.30)' }}>
                {icon}
            </div>
        )}
        <input
            ref={ref}
            {...props}
            className={`w-full ${icon ? 'pl-12' : 'pl-4'} pr-4 py-4 rounded-[1.25rem] text-white placeholder-white/25 focus:outline-none transition-all duration-200 ${className}`}
            style={S.bg}
            onFocus={e => { Object.assign(e.target.style, S.bgFocus); props.onFocus?.(e); }}
            onBlur={e => { Object.assign(e.target.style, S.bg); props.onBlur?.(e); }}
        />
    </div>
));
DarkInput.displayName = 'DarkInput';

// ─── Ambient background ───────────────────────────────────────────────────────
const AmbientBg = () => (
    <>
        <div className="fixed inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 72% 14%, rgba(0,82,204,0.16) 0%, transparent 52%), radial-gradient(ellipse at 18% 88%, rgba(105,41,196,0.11) 0%, transparent 52%), #050E1F' }} />
        <div className="fixed top-[-200px] right-[-80px] w-[600px] h-[600px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(0,82,204,0.13) 0%, transparent 70%)' }} />
        <div className="fixed bottom-[-150px] left-[-60px] w-[500px] h-[500px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(105,41,196,0.09) 0%, transparent 70%)' }} />
    </>
);

// ─── Main component ───────────────────────────────────────────────────────────
const LoginConceptView = ({ setView, setActiveEmployee, onExitConcept }) => {
    const { login, loginWithUsername, isAdmin, user, completePasswordChange } = useAuth();

    const [isLoading, setIsLoading]     = useState(false);
    const [error, setError]             = useState('');
    const [loginMode, setLoginMode]     = useState('code');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changePassError, setChangePassError] = useState('');
    const [changePassLoading, setChangePassLoading] = useState(false);
    const [mustChangePwd, setMustChangePwd]     = useState(false);
    const [pendingUserLocal, setPendingUserLocal] = useState(null);
    const [scannerActive, setScannerActive]     = useState(false);
    const [scanFeedback, setScanFeedback]       = useState(null);

    const inputRef       = useRef(null);
    const usernameRef    = useRef(null);
    const userPasswordRef = useRef(null);
    const loginModeRef   = useRef(loginMode);
    const videoRef       = useRef(null);
    const scannerRef     = useRef(null);
    const streamRef      = useRef(null);
    const cooldownRef    = useRef(false);

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
                if (!cancelled) { stopCameraSafely(); setScannerActive(false); setError('No se pudo acceder a la cámara. Verifica los permisos.'); }
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
        } catch { setError('Error de conexión. Intenta de nuevo.'); setIsLoading(false); }
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
                setError('Código inválido. Intenta de nuevo.'); setIsLoading(false); inputRef.current?.focus();
            }
        } catch { setError('Error de conexión. Intenta de nuevo.'); setIsLoading(false); if (inputRef.current) inputRef.current.value = ''; inputRef.current?.focus(); }
    };

    const handleChangePassword = async () => {
        setChangePassError('');
        if (newPassword.length < 8) { setChangePassError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(newPassword)) { setChangePassError('Debe incluir al menos una letra mayúscula.'); return; }
        if (!/[0-9]/.test(newPassword)) { setChangePassError('Debe incluir al menos un número.'); return; }
        if (newPassword !== confirmPassword) { setChangePassError('Las contraseñas no coinciden.'); return; }
        setChangePassLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
            if (error) { setChangePassError(error.message); setChangePassLoading(false); return; }
            completePasswordChange(pendingUserLocal);
            setMustChangePwd(false); setPendingUserLocal(null); setNewPassword(''); setConfirmPassword('');
        } catch { setChangePassError('Error de conexión. Intenta de nuevo.'); }
        setChangePassLoading(false);
    };

    // ── Change password screen ────────────────────────────────────────────────
    if (mustChangePwd) {
        return (
            <div className="relative flex items-center justify-center w-full min-h-[100dvh] px-5 overflow-hidden">
                <AmbientBg />
                <div className="relative w-full max-w-[400px] rounded-[2.5rem] p-8 flex flex-col gap-6
                               animate-in fade-in slide-in-from-bottom-4 duration-500"
                    style={S.card}>
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1"
                            style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)' }}>
                            <Lock size={20} className="text-amber-400" />
                        </div>
                        <h3 className="text-[20px] font-black text-white tracking-tight text-center">
                            Cambia tu contraseña
                        </h3>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-center"
                            style={{ color: 'rgba(255,255,255,0.30)' }}>
                            Es tu primer acceso — establece una contraseña personal.
                        </p>
                    </div>
                    <form id="chpwd" onSubmit={e => { e.preventDefault(); handleChangePassword(); }} className="flex flex-col gap-3">
                        <DarkInput type="password" placeholder="Nueva contraseña (mín. 8 caracteres)"
                            value={newPassword} onChange={e => { setNewPassword(e.target.value); setChangePassError(''); }}
                            icon={<Lock size={15} strokeWidth={2} />} />
                        <DarkInput type="password" placeholder="Confirmar contraseña"
                            value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setChangePassError(''); }}
                            icon={<Lock size={15} strokeWidth={2} />} />
                    </form>
                    {changePassError && (
                        <div className="px-4 py-2.5 rounded-[0.875rem]" style={S.errBox}>
                            <p className="text-red-400 text-[11px] font-black">{changePassError}</p>
                        </div>
                    )}
                    <button type="submit" form="chpwd" onClick={handleChangePassword}
                        disabled={changePassLoading || !newPassword || !confirmPassword}
                        className="w-full h-[48px] rounded-[1.25rem] font-black text-[11px] uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-[transform,opacity] duration-200 active:scale-[0.98] disabled:opacity-40"
                        style={S.btn}>
                        {changePassLoading ? <Loader2 size={16} className="animate-spin" /> : 'Guardar contraseña'}
                    </button>
                </div>
            </div>
        );
    }

    // ── Main login screen ─────────────────────────────────────────────────────
    return (
        <div className="relative flex items-center justify-center w-full min-h-[100dvh] overflow-hidden">
            <AmbientBg />

            {/* ── Exit concept button ── */}
            <button
                onClick={onExitConcept}
                className="fixed top-5 right-5 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
                style={{ color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}>
                <X size={11} strokeWidth={2.5} />
                Diseño original
            </button>

            {/* ── Desktop brand links (right rail) ── */}
            <div className="fixed right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-2 z-30">
                {[
                    { href: 'https://clientesdte.oss.com.sv/farma_salud/dashboard.php', label: 'Ventas DTE' },
                    { href: 'https://farmalasa.com', label: 'FarmaLasa.com' },
                ].map(link => (
                    <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                        className="px-4 py-2 rounded-[0.875rem] text-[10px] font-black uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
                        style={{ color: 'rgba(255,255,255,0.30)', ...S.ghost }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; Object.assign(e.currentTarget.style, S.ghostHov); }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.30)'; Object.assign(e.currentTarget.style, S.ghost); }}>
                        {link.label}
                    </a>
                ))}
            </div>

            {/* ── Main card ── */}
            <div className="relative w-full max-w-[420px] mx-5 rounded-[2.5rem] px-8 py-9
                           animate-in fade-in slide-in-from-bottom-4 duration-500"
                style={S.card}>

                {/* Logo + title */}
                <div className="flex flex-col items-center mb-8 gap-3">
                    <div className="w-[68px] h-[68px] rounded-[1.5rem] flex items-center justify-center" style={S.iconBox}>
                        <img src="/LogoFLS.svg" alt="FarmaLasa" className="w-12 h-12 object-contain" />
                    </div>
                    <div className="text-center">
                        <h1 className="text-white font-black text-[30px] tracking-tight leading-none mb-1">Portal</h1>
                        <p className="text-[9px] font-bold uppercase tracking-[0.30em]"
                            style={{ color: 'rgba(255,255,255,0.28)' }}>
                            Farmacias La Popular & La Salud
                        </p>
                    </div>
                </div>

                {/* Mode tabs */}
                <div className="flex rounded-[1.25rem] p-1 mb-5 gap-0.5"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    {[{ key: 'code', label: 'Carné' }, { key: 'username', label: 'Usuario' }].map(tab => (
                        <button key={tab.key} type="button"
                            onClick={() => { handleStopScannerBtn(); setLoginMode(tab.key); setError(''); }}
                            className="flex-1 py-2 text-[9px] font-black uppercase tracking-widest rounded-[0.875rem] transition-all duration-200"
                            style={loginMode === tab.key
                                ? { background: '#0052CC', color: 'white', boxShadow: '0 4px 12px rgba(0,82,204,0.45)' }
                                : { color: 'rgba(255,255,255,0.32)' }}>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Form */}
                <form onSubmit={loginMode === 'username' ? handleUsernameLogin : handleLogin}
                    className="flex flex-col gap-3">

                    {loginMode === 'code' ? (
                        <div className="flex flex-col gap-3">
                            {/* Code input + camera toggle */}
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <div className="absolute left-0 top-0 bottom-0 w-12 flex items-center justify-center pointer-events-none z-10"
                                        style={{ color: 'rgba(255,255,255,0.28)' }}>
                                        <ScanBarcode size={20} strokeWidth={1.75} />
                                    </div>
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        placeholder="CÓDIGO"
                                        autoComplete="off"
                                        spellCheck="false"
                                        className="w-full pl-12 pr-4 py-4 rounded-[1.25rem] text-white placeholder-white/20 text-base tracking-[0.4em] font-black uppercase [-webkit-text-security:disc] focus:outline-none transition-all duration-200"
                                        style={S.bg}
                                        onFocus={e => Object.assign(e.target.style, S.bgFocus)}
                                        onBlur={e => Object.assign(e.target.style, S.bg)}
                                    />
                                </div>
                                <button type="button"
                                    onClick={() => {
                                        if (scannerActive) { handleStopScannerBtn(); }
                                        else { if (inputRef.current) inputRef.current.value = ''; setScanFeedback(null); cooldownRef.current = false; setScannerActive(true); }
                                    }}
                                    className="shrink-0 w-[52px] h-[52px] rounded-[1.125rem] flex items-center justify-center transition-all duration-200 active:scale-[0.97]"
                                    style={scannerActive ? S.scanErr : S.scanNorm}
                                    onMouseEnter={e => { if (!scannerActive) { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; } }}
                                    onMouseLeave={e => { if (!scannerActive) Object.assign(e.currentTarget.style, S.scanNorm); }}>
                                    {scannerActive ? <CameraOff size={20} strokeWidth={1.75} /> : <Camera size={20} strokeWidth={1.75} />}
                                </button>
                            </div>

                            {/* Camera viewport */}
                            {scannerActive && (
                                <div className="animate-in fade-in duration-300 flex flex-col gap-2">
                                    <div className="relative w-full h-[200px] rounded-[1.25rem] overflow-hidden"
                                        style={{ background: '#000', border: '1px solid rgba(255,255,255,0.06)' }}>
                                        <style>{`@keyframes scan{0%{top:8%}50%{top:84%}100%{top:8%}}`}</style>
                                        <div style={{ position:'absolute',left:'5%',right:'5%',height:'2px',background:'rgba(0,82,204,0.90)',animation:'scan 2s ease-in-out infinite',zIndex:10,boxShadow:'0 0 10px rgba(0,82,204,0.70)' }} />
                                        <div style={{position:'absolute',top:10,left:10,width:16,height:16,borderTop:'2px solid rgba(0,82,204,0.80)',borderLeft:'2px solid rgba(0,82,204,0.80)',borderRadius:'3px 0 0 0',zIndex:11}} />
                                        <div style={{position:'absolute',top:10,right:10,width:16,height:16,borderTop:'2px solid rgba(0,82,204,0.80)',borderRight:'2px solid rgba(0,82,204,0.80)',borderRadius:'0 3px 0 0',zIndex:11}} />
                                        <div style={{position:'absolute',bottom:10,left:10,width:16,height:16,borderBottom:'2px solid rgba(0,82,204,0.80)',borderLeft:'2px solid rgba(0,82,204,0.80)',borderRadius:'0 0 0 3px',zIndex:11}} />
                                        <div style={{position:'absolute',bottom:10,right:10,width:16,height:16,borderBottom:'2px solid rgba(0,82,204,0.80)',borderRight:'2px solid rgba(0,82,204,0.80)',borderRadius:'0 0 3px 0',zIndex:11}} />
                                        <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                                    </div>
                                    <div className="flex items-center justify-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[#0052CC] animate-pulse" />
                                        <span className="text-[9px] font-bold uppercase tracking-widest"
                                            style={{ color: 'rgba(255,255,255,0.30)' }}>Apunta al código de barras</span>
                                    </div>
                                </div>
                            )}

                            {/* Scan feedback */}
                            {scanFeedback && (
                                <div className="p-2.5 rounded-[1rem] text-center animate-in zoom-in-95 duration-200"
                                    style={scanFeedback.status === 'error' ? S.errBox : scanFeedback.status === 'success' ? S.okBox : S.infoBox}>
                                    <p className={`text-[11px] font-bold flex items-center justify-center gap-1 ${
                                        scanFeedback.status === 'error' ? 'text-red-400' :
                                        scanFeedback.status === 'success' ? 'text-emerald-400' : 'text-blue-400'}`}>
                                        {scanFeedback.status === 'reading' && <Loader2 size={11} className="animate-spin" />}
                                        {scanFeedback.message}
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3 animate-in fade-in duration-300">
                            <DarkInput ref={usernameRef} id="username" name="username" type="text"
                                placeholder="nombre.apellido" autoComplete="username"
                                className="text-[14px] font-bold"
                                icon={<UserIcon size={18} strokeWidth={1.75} />} />
                            <DarkInput ref={userPasswordRef} id="password" name="password" type="password"
                                placeholder="Contraseña" autoComplete="current-password"
                                className="text-[14px] font-bold"
                                icon={<Lock size={18} strokeWidth={1.75} />} />
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="px-4 py-3 rounded-[1rem] flex items-center gap-2 animate-in fade-in duration-200"
                            style={S.errBox}>
                            <AlertCircle size={15} className="text-red-400 shrink-0" strokeWidth={2} />
                            <p className="text-red-400 text-[10px] font-black uppercase tracking-widest">{error}</p>
                        </div>
                    )}

                    {/* Submit */}
                    <button type="submit" disabled={isLoading}
                        className="w-full h-[56px] rounded-[1.5rem] font-black text-[13px] uppercase tracking-widest text-white flex items-center justify-center gap-2 transition-[transform,opacity] duration-200 active:scale-[0.97] disabled:opacity-50 mt-1"
                        style={S.btn}>
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : 'Ingresar al Portal'}
                    </button>
                </form>

                {/* Kiosk shortcut */}
                {!isMobileOrApp() && (
                    <button onClick={() => setView('timeclock')}
                        className="mt-4 w-full flex items-center justify-between px-4 py-3.5 rounded-[1.5rem] transition-all duration-200 active:scale-[0.97] group"
                        style={S.ghost}
                        onMouseEnter={e => Object.assign(e.currentTarget.style, S.ghostHov)}
                        onMouseLeave={e => Object.assign(e.currentTarget.style, S.ghost)}>
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-[0.875rem] flex items-center justify-center"
                                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <Clock size={15} strokeWidth={1.75} style={{ color: 'rgba(255,255,255,0.38)' }} />
                            </div>
                            <div className="text-left">
                                <p className="text-[11px] font-black uppercase tracking-widest"
                                    style={{ color: 'rgba(255,255,255,0.48)' }}>Terminal Kiosco</p>
                                <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5"
                                    style={{ color: 'rgba(255,255,255,0.20)' }}>Marcar entrada / salida</p>
                            </div>
                        </div>
                        <ChevronRight size={14} strokeWidth={2.5} style={{ color: 'rgba(255,255,255,0.20)' }} />
                    </button>
                )}

                {/* Bottom branding */}
                <p className="text-center mt-6 text-[9px] font-bold uppercase tracking-widest"
                    style={{ color: 'rgba(255,255,255,0.14)' }}>
                    Portal Farmalasa &copy; {new Date().getFullYear()}
                </p>
            </div>
        </div>
    );
};

export default LoginConceptView;
