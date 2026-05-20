import React, { useState, useEffect, useRef } from 'react';
import {
    Clock, Loader2, ChevronRight,
    AlertCircle, Lock, Camera, CameraOff, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';

// ── Animated aurora orb background ────────────────────────────────────────────
const AURORA_KF = `
@keyframes dr1{0%,100%{transform:translate(0,0)scale(1)}33%{transform:translate(80px,-60px)scale(1.12)}66%{transform:translate(-40px,70px)scale(0.93)}}
@keyframes dr2{0%,100%{transform:translate(0,0)scale(1)}40%{transform:translate(-100px,50px)scale(1.08)}75%{transform:translate(60px,-80px)scale(0.96)}}
@keyframes dr3{0%,100%{transform:translate(0,0)scale(1)}50%{transform:translate(55px,90px)scale(1.14)}}
@keyframes dr4{0%,100%{transform:translate(0,0)scale(1)}30%{transform:translate(-65px,-45px)scale(0.88)}70%{transform:translate(45px,55px)scale(1.09)}}
@keyframes dr5{0%,100%{transform:translate(0,0)scale(1)}45%{transform:translate(70px,-55px)scale(1.06)}85%{transform:translate(-30px,35px)scale(0.94)}}
@keyframes scan{0%{top:8%}50%{top:84%}100%{top:8%}}
`;

const ORBS = [
    { w:850, h:850, top:'-280px', left:'-180px',   color:'rgba(0,82,204,0.52)',   blur:70, anim:'dr1 20s ease-in-out infinite' },
    { w:750, h:750, bottom:'-220px', right:'-130px', color:'rgba(13,148,136,0.35)', blur:65, anim:'dr2 26s ease-in-out infinite' },
    { w:600, h:600, top:'35%', right:'12%',          color:'rgba(79,70,229,0.30)', blur:55, anim:'dr3 32s ease-in-out infinite' },
    { w:480, h:480, top:'18%', left:'22%',           color:'rgba(105,41,196,0.26)', blur:50, anim:'dr4 23s ease-in-out infinite' },
    { w:380, h:380, bottom:'18%', left:'8%',         color:'rgba(5,150,105,0.20)', blur:45, anim:'dr5 29s ease-in-out infinite' },
];

const AuroraBg = () => (
    <>
        <style>{AURORA_KF}</style>
        <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background:'#04081A' }}>
            {ORBS.map((o, i) => (
                <div key={i} className="absolute rounded-full" style={{
                    width: o.w, height: o.h,
                    top: o.top, bottom: o.bottom, left: o.left, right: o.right,
                    background: `radial-gradient(circle, ${o.color} 0%, transparent 70%)`,
                    filter: `blur(${o.blur}px)`,
                    animation: o.anim,
                }} />
            ))}
        </div>
    </>
);

// ── Floating-label input ───────────────────────────────────────────────────────
// label animates from inside the field to above it on focus/fill.
// No icon, no box — only a bottom border.
const FloatInput = React.forwardRef(({ label, wrapClass = '', inputClass = '', ...props }, ref) => (
    <div className={`relative group ${wrapClass}`}>
        <input
            ref={ref}
            {...props}
            placeholder=" "
            className={`peer w-full pt-7 pb-2.5 bg-transparent border-b border-white/20 focus:border-white/55
                        text-white outline-none font-bold transition-colors duration-200 ${inputClass}`}
        />
        <label className="
            absolute left-0 top-[1.35rem] text-white/45 text-[14px] font-medium pointer-events-none select-none
            transition-all duration-200
            peer-focus:top-1 peer-focus:text-[9px] peer-focus:font-black peer-focus:uppercase peer-focus:tracking-[0.20em] peer-focus:text-white/60
            peer-[:not(:placeholder-shown)]:top-1 peer-[:not(:placeholder-shown)]:text-[9px]
            peer-[:not(:placeholder-shown)]:font-black peer-[:not(:placeholder-shown)]:uppercase
            peer-[:not(:placeholder-shown)]:tracking-[0.20em]">
            {label}
        </label>
    </div>
));
FloatInput.displayName = 'FloatInput';

// ── Main component ─────────────────────────────────────────────────────────────
const LoginConceptView = ({ setView, setActiveEmployee, onExitConcept }) => {
    const { login, loginWithUsername, isAdmin, user, completePasswordChange } = useAuth();

    const [isLoading, setIsLoading]               = useState(false);
    const [error, setError]                       = useState('');
    const [loginMode, setLoginMode]               = useState('code');
    const [newPassword, setNewPassword]           = useState('');
    const [confirmPassword, setConfirmPassword]   = useState('');
    const [changePassError, setChangePassError]   = useState('');
    const [changePassLoading, setChangePassLoading] = useState(false);
    const [mustChangePwd, setMustChangePwd]       = useState(false);
    const [pendingUserLocal, setPendingUserLocal] = useState(null);
    const [scannerActive, setScannerActive]       = useState(false);
    const [scanFeedback, setScanFeedback]         = useState(null);

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
                    setScanFeedback({ status: 'reading', message: 'Verificando...' });
                    setIsLoading(true);
                    const success = await login(scannedCode);
                    if (!success) {
                        if (inputRef.current) inputRef.current.value = '';
                        setScanFeedback({ status: 'error', message: 'Inválido. Reabriendo cámara...' });
                        setIsLoading(false);
                        setTimeout(() => {
                            if (loginModeRef.current === 'code') { setScanFeedback(null); setScannerActive(true); }
                        }, 1000);
                    } else {
                        setScanFeedback({ status: 'success', message: '¡Acceso concedido!' });
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
        } catch { setError('Error de conexión.'); setIsLoading(false); if (inputRef.current) inputRef.current.value = ''; }
    };

    const handleChangePassword = async () => {
        setChangePassError('');
        if (newPassword.length < 8)        { setChangePassError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(newPassword))    { setChangePassError('Incluye una mayúscula.'); return; }
        if (!/[0-9]/.test(newPassword))    { setChangePassError('Incluye un número.'); return; }
        if (newPassword !== confirmPassword){ setChangePassError('Las contraseñas no coinciden.'); return; }
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
            <div className="relative flex items-center justify-center w-full min-h-[100dvh] px-8 overflow-hidden">
                <AuroraBg />
                <div className="relative z-10 w-full max-w-[380px] animate-in fade-in slide-in-from-bottom-3 duration-500">
                    <div className="flex flex-col items-center mb-10 gap-3 text-center">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center"
                            style={{ background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.22)' }}>
                            <Lock size={20} className="text-amber-400" />
                        </div>
                        <h2 className="text-white font-black text-[26px] tracking-tight">Nueva contraseña</h2>
                        <p className="text-white/40 text-[12px]">Primer acceso — establece tu contraseña personal.</p>
                    </div>
                    <div className="flex flex-col gap-9">
                        <FloatInput label="Nueva contraseña (mín. 8 caracteres)" type="password"
                            value={newPassword} onChange={e => { setNewPassword(e.target.value); setChangePassError(''); }} />
                        <FloatInput label="Confirmar contraseña" type="password"
                            value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setChangePassError(''); }} />
                    </div>
                    {changePassError && (
                        <p className="mt-5 text-red-300 text-[12px] font-bold flex items-center gap-1.5">
                            <AlertCircle size={13} /> {changePassError}
                        </p>
                    )}
                    <button onClick={handleChangePassword}
                        disabled={changePassLoading || !newPassword || !confirmPassword}
                        className="mt-10 w-full h-[52px] bg-white hover:bg-white/90 text-slate-900 font-black text-[12px] uppercase tracking-[0.18em] rounded-[1.25rem] flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] disabled:opacity-40 shadow-[0_8px_30px_rgba(0,0,0,0.30)]">
                        {changePassLoading ? <Loader2 size={16} className="animate-spin text-slate-700" /> : 'Guardar contraseña'}
                    </button>
                </div>
            </div>
        );
    }

    // ── Main login ────────────────────────────────────────────────────────────
    return (
        <div className="relative flex flex-col items-center justify-center w-full min-h-[100dvh] overflow-hidden px-6 py-10">
            <AuroraBg />

            {/* Exit button */}
            <button onClick={onExitConcept}
                className="fixed top-5 right-5 z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
                style={{ color:'rgba(255,255,255,0.35)', border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.07)', backdropFilter:'blur(12px)' }}
                onMouseEnter={e => { e.currentTarget.style.color='rgba(255,255,255,0.80)'; e.currentTarget.style.background='rgba(255,255,255,0.14)'; }}
                onMouseLeave={e => { e.currentTarget.style.color='rgba(255,255,255,0.35)'; e.currentTarget.style.background='rgba(255,255,255,0.07)'; }}>
                <X size={11} strokeWidth={2.5} /> Diseño original
            </button>

            {/* ── Form — no card, floats in the aurora ── */}
            <div className="relative z-10 flex flex-col items-center w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-3 duration-700">

                {/* Logo + wordmark */}
                <div className="flex flex-col items-center mb-12 gap-4">
                    <div className="relative w-16 h-16 flex items-center justify-center">
                        {/* soft glow behind logo */}
                        <div className="absolute inset-0 rounded-2xl"
                            style={{ background:'rgba(0,82,204,0.50)', filter:'blur(28px)', transform:'scale(1.8)' }} />
                        <img src="/LogoFLS.svg" alt="FarmaLasa" className="relative w-14 h-14 object-contain" />
                    </div>
                    <div className="text-center">
                        <h1 className="text-white font-black text-[38px] tracking-[-0.025em] leading-none">Portal</h1>
                        <p className="text-white/30 text-[9px] font-black uppercase tracking-[0.35em] mt-2">
                            Farmacias La Popular & La Salud
                        </p>
                    </div>
                </div>

                {/* Tab toggle — frosted track, white active pill */}
                <div className="flex w-full rounded-[1.5rem] p-1 mb-10 gap-0.5"
                    style={{ background:'rgba(255,255,255,0.07)', backdropFilter:'blur(10px)', border:'1px solid rgba(255,255,255,0.09)' }}>
                    {[{ key:'code', label:'Carné' }, { key:'username', label:'Usuario' }].map(tab => (
                        <button key={tab.key} type="button"
                            onClick={() => { handleStopScannerBtn(); setLoginMode(tab.key); setError(''); }}
                            className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-[1.25rem] transition-all duration-300 ${
                                loginMode === tab.key
                                    ? 'bg-white/88 text-slate-900 shadow-sm'
                                    : 'text-white/40 hover:text-white/70'
                            }`}>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Form */}
                <form onSubmit={loginMode === 'username' ? handleUsernameLogin : handleLogin}
                    className="w-full flex flex-col gap-9">

                    {loginMode === 'code' ? (
                        <div className="flex flex-col gap-6">

                            {/* Code field + camera button side by side */}
                            <div className="flex items-end gap-3">
                                <FloatInput
                                    ref={inputRef}
                                    label="Código de Carné"
                                    type="text"
                                    autoComplete="off"
                                    spellCheck="false"
                                    wrapClass="flex-1"
                                    inputClass="tracking-[0.35em] [-webkit-text-security:disc] text-[20px]"
                                />
                                <button type="button"
                                    onClick={() => {
                                        if (scannerActive) { handleStopScannerBtn(); }
                                        else { if (inputRef.current) inputRef.current.value = ''; setScanFeedback(null); cooldownRef.current = false; setScannerActive(true); }
                                    }}
                                    className="mb-3 w-[46px] h-[46px] rounded-[0.75rem] flex items-center justify-center transition-all duration-200 active:scale-[0.97] flex-shrink-0"
                                    style={scannerActive
                                        ? { background:'rgba(239,68,68,0.14)', border:'1px solid rgba(239,68,68,0.22)', color:'rgb(252,165,165)' }
                                        : { background:'rgba(255,255,255,0.09)', border:'1px solid rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.50)' }}
                                    onMouseEnter={e => { if (!scannerActive) { e.currentTarget.style.background='rgba(255,255,255,0.17)'; e.currentTarget.style.color='white'; } }}
                                    onMouseLeave={e => { if (!scannerActive) { e.currentTarget.style.background='rgba(255,255,255,0.09)'; e.currentTarget.style.color='rgba(255,255,255,0.50)'; } }}>
                                    {scannerActive ? <CameraOff size={18} strokeWidth={1.75} /> : <Camera size={18} strokeWidth={1.75} />}
                                </button>
                            </div>

                            {/* Camera viewport */}
                            {scannerActive && (
                                <div className="animate-in fade-in duration-300 flex flex-col gap-2">
                                    <div className="relative w-full h-[200px] rounded-[1rem] overflow-hidden"
                                        style={{ background:'#000', border:'1px solid rgba(255,255,255,0.07)' }}>
                                        <div style={{position:'absolute',left:'5%',right:'5%',height:'2px',background:'rgba(0,82,204,0.90)',animation:'scan 2s ease-in-out infinite',zIndex:10,boxShadow:'0 0 10px rgba(0,82,204,0.70)'}} />
                                        <div style={{position:'absolute',top:10,left:10,width:16,height:16,borderTop:'2px solid rgba(0,82,204,0.80)',borderLeft:'2px solid rgba(0,82,204,0.80)',borderRadius:'3px 0 0 0',zIndex:11}} />
                                        <div style={{position:'absolute',top:10,right:10,width:16,height:16,borderTop:'2px solid rgba(0,82,204,0.80)',borderRight:'2px solid rgba(0,82,204,0.80)',borderRadius:'0 3px 0 0',zIndex:11}} />
                                        <div style={{position:'absolute',bottom:10,left:10,width:16,height:16,borderBottom:'2px solid rgba(0,82,204,0.80)',borderLeft:'2px solid rgba(0,82,204,0.80)',borderRadius:'0 0 0 3px',zIndex:11}} />
                                        <div style={{position:'absolute',bottom:10,right:10,width:16,height:16,borderBottom:'2px solid rgba(0,82,204,0.80)',borderRight:'2px solid rgba(0,82,204,0.80)',borderRadius:'0 0 3px 0',zIndex:11}} />
                                        <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                                    </div>
                                    <p className="text-center text-white/30 text-[9px] font-bold uppercase tracking-widest">
                                        Apunta al código de barras
                                    </p>
                                </div>
                            )}

                            {/* Scan feedback */}
                            {scanFeedback && (
                                <div className={`flex items-center gap-1.5 text-[12px] font-bold animate-in fade-in duration-200 ${
                                    scanFeedback.status === 'error'   ? 'text-red-300' :
                                    scanFeedback.status === 'success' ? 'text-emerald-300' : 'text-blue-200'
                                }`}>
                                    {scanFeedback.status === 'reading' && <Loader2 size={13} className="animate-spin" />}
                                    {scanFeedback.message}
                                </div>
                            )}
                        </div>

                    ) : (
                        <div className="flex flex-col gap-9 animate-in fade-in duration-300">
                            <FloatInput ref={usernameRef} label="Usuario"
                                id="username" name="username" type="text" autoComplete="username" />
                            <FloatInput ref={userPasswordRef} label="Contraseña"
                                id="password" name="password" type="password" autoComplete="current-password" />
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 text-red-300 animate-in fade-in duration-200">
                            <AlertCircle size={14} className="shrink-0" strokeWidth={2} />
                            <p className="text-[12px] font-bold">{error}</p>
                        </div>
                    )}

                    {/* Submit — WHITE button (inverted from every convention) */}
                    <button type="submit" disabled={isLoading}
                        className="w-full h-[54px] bg-white hover:bg-white/90 text-slate-900 font-black text-[12px] uppercase tracking-[0.18em] rounded-[1.25rem] flex items-center justify-center gap-2.5 transition-[background-color,transform] duration-200 active:scale-[0.97] disabled:opacity-50 shadow-[0_12px_36px_rgba(0,0,0,0.30)]">
                        {isLoading
                            ? <Loader2 size={18} className="animate-spin text-slate-600" />
                            : 'Ingresar al Portal'
                        }
                    </button>
                </form>

                {/* Kiosk link */}
                {!isMobileOrApp() && (
                    <button onClick={() => setView('timeclock')}
                        className="mt-9 flex items-center gap-2 transition-colors duration-200 active:opacity-60"
                        style={{ color:'rgba(255,255,255,0.28)' }}
                        onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.60)'}
                        onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.28)'}>
                        <Clock size={13} strokeWidth={2} />
                        <span className="text-[11px] font-bold">Terminal Kiosco</span>
                        <ChevronRight size={11} strokeWidth={2.5} />
                    </button>
                )}

                <p className="mt-10 text-[9px] font-bold uppercase tracking-widest"
                    style={{ color:'rgba(255,255,255,0.12)' }}>
                    Portal Farmalasa &copy; {new Date().getFullYear()}
                </p>
            </div>
        </div>
    );
};

export default LoginConceptView;
