import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    ShoppingCart, Pill, AlertCircle, Lock, Camera,
    User as UserIcon, Sparkles, ArrowRight, X, CheckCircle2,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';

const SCAN_WAIT_MS = 10_000;

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, loginWithUsername, hasPermission, user, completePasswordChange } = useAuth();

    const [isLoading,         setIsLoading]         = useState(false);
    const [error,             setError]             = useState('');
    const [loginMode,         setLoginMode]         = useState('code');
    const [codeKey,           setCodeKey]           = useState(0);
    const [userKey,           setUserKey]           = useState(0);
    const [newPassword,       setNewPassword]       = useState('');
    const [confirmPassword,   setConfirmPassword]   = useState('');
    const [changePassError,   setChangePassError]   = useState('');
    const [changePassLoading, setChangePassLoading] = useState(false);
    const [mustChangePwd,     setMustChangePwd]     = useState(false);
    const [pendingUserLocal,  setPendingUserLocal]  = useState(null);
    const [scannerActive,     setScannerActive]     = useState(false);
    const [scanFeedback,      setScanFeedback]      = useState(null);
    const [mounted,           setMounted]           = useState(false);
    const [leaving,           setLeaving]           = useState(false);

    // ── Scan-pending state ────────────────────────────────────────────────────
    const [scanPending,    setScanPending]    = useState(true);
    const [scanCountdown,  setScanCountdown]  = useState(SCAN_WAIT_MS / 1000);
    const scanInputRef    = useRef(null);
    const scanPendingRef  = useRef(true);
    const countdownRef    = useRef(null);
    const scanTimeoutRef  = useRef(null);

    const exitScanPending = useCallback(() => {
        if (!scanPendingRef.current) return;
        scanPendingRef.current = false;
        clearTimeout(scanTimeoutRef.current);
        clearInterval(countdownRef.current);
        setScanPending(false);
        setTimeout(() => { const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }, 0);
    }, []);

    // Start countdown on mount
    useEffect(() => {
        setMounted(false); // will be set true when form appears
        const start = Date.now();
        countdownRef.current = setInterval(() => {
            const elapsed = Date.now() - start;
            const remaining = Math.max(0, Math.ceil((SCAN_WAIT_MS - elapsed) / 1000));
            setScanCountdown(remaining);
        }, 200);
        scanTimeoutRef.current = setTimeout(() => exitScanPending(), SCAN_WAIT_MS);
        // Auto-focus hidden scan input
        const t = setTimeout(() => scanInputRef.current?.focus(), 100);
        return () => {
            clearTimeout(t);
            clearTimeout(scanTimeoutRef.current);
            clearInterval(countdownRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Refs for form ─────────────────────────────────────────────────────────
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
        if (!scanPending) {
            const t = setTimeout(() => setMounted(true), 50);
            return () => clearTimeout(t);
        }
    }, [scanPending]);

    useEffect(() => {
        if (scanPending) return;
        const t = setTimeout(() => {
            if (loginMode === 'code' && inputRef.current && !scannerActive) inputRef.current.focus();
            else if (loginMode === 'username' && usernameRef.current) usernameRef.current.focus();
        }, 60);
        return () => clearTimeout(t);
    }, [loginMode, scannerActive, scanPending]);

    const stopCameraSafely = () => {
        if (scannerRef.current) { try { scannerRef.current.reset(); } catch {} scannerRef.current = null; }
        if (streamRef.current)  { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (videoRef.current?.srcObject) {
            try { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; videoRef.current.src = ''; videoRef.current.removeAttribute('src'); } catch {}
        }
    };
    useEffect(() => () => stopCameraSafely(), []);

    useEffect(() => {
        if (!scannerActive) return;
        let cancelled = false, isWarmup = true;
        const warmupTimer = setTimeout(() => { isWarmup = false; }, 500);
        (async () => {
            try {
                const { BrowserMultiFormatReader } = await import('@zxing/browser');
                const { DecodeHintType, BarcodeFormat }  = await import('@zxing/library');
                if (cancelled) return;
                const hints = new Map();
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.QR_CODE]);
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
                    stopCameraSafely(); setScannerActive(false);
                    setScanFeedback({ status: 'reading', code: scannedCode, message: 'Verificando...' });
                    setIsLoading(true);
                    const loginResult = await login(scannedCode);
                    if (!loginResult.ok) {
                        if (inputRef.current) inputRef.current.value = '';
                        setScanFeedback({ status: 'error', code: scannedCode, message: loginResult.error || 'Inválido. Reabriendo cámara...' });
                        setIsLoading(false);
                        setTimeout(() => { if (loginModeRef.current === 'code') { setScanFeedback(null); setScannerActive(true); } }, 1000);
                    } else { setScanFeedback({ status: 'success', code: scannedCode, message: '¡Acceso concedido!' }); }
                });
            } catch { if (!cancelled) { stopCameraSafely(); setScannerActive(false); setError('No se pudo acceder a la cámara. Verifica los permisos.'); } }
        })();
        return () => { cancelled = true; clearTimeout(warmupTimer); stopCameraSafely(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scannerActive]);

    useEffect(() => {
        if (user) { if (hasPermission('staff_list', 'can_view') || hasPermission('overview', 'can_view')) setView('dashboard'); else { setActiveEmployee(user); setView('employee-detail'); } }
    }, [user, hasPermission, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(''), 4000); return () => clearTimeout(t); }
    }, [error]);

    const handleStopScannerBtn = () => { cooldownRef.current = false; stopCameraSafely(); setScannerActive(false); setScanFeedback(null); };

    const switchMode = (mode) => {
        if (mode === loginMode) return;
        handleStopScannerBtn();
        setLoginMode(mode);
        setError('');
        if (mode === 'code')     setCodeKey(k => k + 1);
        if (mode === 'username') setUserKey(k => k + 1);
    };

    const goToKiosko = () => {
        setLeaving(true);
        setTimeout(() => setView('timeclock'), 320);
    };

    // ── Scan-pending submit ───────────────────────────────────────────────────
    const handleScanPendingSubmit = async (e) => {
        e?.preventDefault();
        const code = scanInputRef.current?.value?.trim().toUpperCase() ?? '';
        if (!code) return;

        exitScanPending();
        setScanFeedback({ status: 'reading', code, message: 'Verificando...' });
        setIsLoading(true);

        let timedOut = false;
        const timeout = new Promise((_, rej) => setTimeout(() => { timedOut = true; rej(new Error('timeout')); }, 12_000));
        try {
            const result = await Promise.race([login(code), timeout]);
            if (timedOut) return;
            if (!result.ok) {
                setScanFeedback({ status: 'error', code, message: result.error || 'Código inválido.' });
                setTimeout(() => setScanFeedback(null), 2000);
            } else {
                setScanFeedback({ status: 'success', code, message: '¡Acceso concedido!' });
            }
        } catch {
            setScanFeedback({ status: 'error', code, message: timedOut ? 'Sin respuesta del servidor. Intenta manualmente.' : 'Error de conexión.' });
            setTimeout(() => setScanFeedback(null), 2500);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUsernameLogin = async (e) => {
        e.preventDefault(); setError('');
        const username = usernameRef.current?.value?.trim() || '';
        const password = userPasswordRef.current?.value || '';
        if (!username || !password) { setError('Ingresa usuario y contraseña.'); return; }
        setIsLoading(true);
        try {
            const result = await loginWithUsername(username, password);
            if (!result.ok) { setError(result.error || 'Credenciales inválidas.'); setIsLoading(false); if (userPasswordRef.current) userPasswordRef.current.value = ''; userPasswordRef.current?.focus(); }
            else if (result.mustChangePassword) { setPendingUserLocal(result.user); setMustChangePwd(true); setIsLoading(false); }
            else { setIsLoading(false); }
        } catch { setError('Error de conexión. Intenta de nuevo.'); setIsLoading(false); }
    };

    const handleLogin = async (e) => {
        e.preventDefault(); setError('');
        const code = inputRef.current?.value || '';
        if (!code.trim()) { setError('Por favor, ingresa tu código.'); return; }
        setIsLoading(true);
        try {
            const result = await login(code);
            if (!result.ok) { if (inputRef.current) inputRef.current.value = ''; setError(result.error || 'Código inválido. Intenta de nuevo.'); setIsLoading(false); inputRef.current?.focus(); }
        } catch { setError('Error de conexión. Intenta de nuevo.'); setIsLoading(false); if (inputRef.current) inputRef.current.value = ''; inputRef.current?.focus(); }
    };

    const handleChangePassword = async () => {
        setChangePassError('');
        if (newPassword.length < 8)              { setChangePassError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(newPassword))          { setChangePassError('Debe incluir al menos una mayúscula.'); return; }
        if (!/[0-9]/.test(newPassword))          { setChangePassError('Debe incluir al menos un número.'); return; }
        if (newPassword !== confirmPassword)      { setChangePassError('Las contraseñas no coinciden.'); return; }
        setChangePassLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: newPassword, data: { must_change_password: false } });
            if (error) { setChangePassError(error.message); setChangePassLoading(false); return; }
            completePasswordChange(pendingUserLocal); setMustChangePwd(false); setPendingUserLocal(null); setNewPassword(''); setConfirmPassword('');
        } catch { setChangePassError('Error de conexión. Intenta de nuevo.'); }
        setChangePassLoading(false);
    };

    /* ─── Shared styles ─────────────────────────────────────────────────────── */

    const inputCls = [
        'w-full',
        'bg-white/[0.22] hover:bg-white/[0.32]',
        'backdrop-blur-md',
        'border border-white/65 hover:border-white/80',
        'text-slate-800 placeholder-slate-400/80',
        'outline-none',
        'focus:bg-white/[0.58] focus:border-white/90',
        'focus:shadow-[inset_0_2px_10px_rgba(0,0,0,0.04),0_0_0_3px_rgba(255,255,255,0.38)]',
        'transition-all duration-250',
        'font-bold',
    ].join(' ');

    /* ─── Sub-components ─────────────────────────────────────────────────────── */

    const AmbientBG = () => (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="animate-ambient-drift absolute rounded-full"
                style={{ width:'80vw', height:'80vw', top:'-22%', left:'-18%', background:'radial-gradient(circle, rgba(110,70,230,0.36) 0%, rgba(130,80,240,0.14) 45%, transparent 70%)', filter:'blur(44px)' }} />
            <div className="animate-ambient-drift-reverse absolute rounded-full"
                style={{ width:'70vw', height:'70vw', bottom:'-20%', right:'-16%', background:'radial-gradient(circle, rgba(60,100,240,0.28) 0%, rgba(80,140,255,0.10) 45%, transparent 70%)', filter:'blur(52px)', animationDuration:'22s' }} />
            <div className="animate-ambient-drift absolute rounded-full"
                style={{ width:'50vw', height:'50vw', top:'40%', right:'-8%', background:'radial-gradient(circle, rgba(160,90,255,0.18) 0%, transparent 65%)', filter:'blur(40px)', animationDuration:'18s', animationDelay:'-7s' }} />
            {[{s:16,t:'11%',l:'7%',d:'6.5s',dl:'0s'},{s:10,t:'19%',l:'79%',d:'9s',dl:'1.2s'},{s:20,t:'66%',l:'11%',d:'7.5s',dl:'2.5s'},{s:12,t:'73%',l:'83%',d:'10s',dl:'0.7s'},{s:8,t:'37%',l:'4%',d:'5.5s',dl:'3.2s'},{s:22,t:'81%',l:'61%',d:'8.5s',dl:'4.0s'}].map((p,i)=>(
                <div key={i} className="absolute rounded-full"
                    style={{ width:p.s, height:p.s, top:p.t, left:p.l, background:'rgba(255,255,255,0.48)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.88)', boxShadow:'inset 0 1px 2px rgba(255,255,255,1)', animation:`lgn-p${i%2+1} ${p.d} ease-in-out ${p.dl} infinite` }} />
            ))}
        </div>
    );

    const TabBar = () => (
        <div className="flex bg-white/[0.20] backdrop-blur-md border border-white/55 rounded-[2rem] p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.04)]">
            {[['code','Carné'],['username','Usuario']].map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => switchMode(mode)}
                    className={`relative flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-[1.5rem] transition-all duration-300 overflow-hidden group ${loginMode === mode ? 'bg-white text-[#0052CC] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    {loginMode === mode && (
                        <span className="absolute inset-0 overflow-hidden rounded-[1.5rem] pointer-events-none">
                            <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-[#0052CC]/8 to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
                        </span>
                    )}
                    {label}
                </button>
            ))}
        </div>
    );

    const GlassButton = ({ type = 'submit', onClick, disabled, children, height = 'h-[54px]', tabIndex }) => (
        <button type={type} onClick={onClick} disabled={disabled} tabIndex={tabIndex}
            className={`relative overflow-hidden group w-full ${height}
                bg-gradient-to-b from-[#0052CC]/72 to-[#003D99]/78
                backdrop-blur-xl
                border border-white/22 hover:border-white/36
                text-white rounded-[1.5rem] font-black text-[13px] uppercase tracking-widest
                shadow-[0_6px_22px_rgba(0,82,204,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]
                hover:shadow-[0_12px_36px_rgba(0,82,204,0.44),inset_0_1px_0_rgba(255,255,255,0.24)]
                flex items-center justify-center gap-2 transition-all duration-200
                active:scale-[0.97] disabled:opacity-55 disabled:shadow-none disabled:cursor-not-allowed`}>
            <span className="absolute inset-0 overflow-hidden rounded-[1.5rem] pointer-events-none">
                <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.16] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
            </span>
            {children}
        </button>
    );

    const ScannerView = () => (
        <div style={{ animation: 'scannerReveal 450ms cubic-bezier(0.23,1,0.32,1) both' }} className="flex flex-col gap-2.5">
            <div className="relative w-full overflow-hidden border border-white/[0.14] shadow-[0_20px_60px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.14)]"
                style={{ height: 224, borderRadius: '1.5rem' }}>
                <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm" />
                <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />
                <style>{`
                    @keyframes scan-ln{0%{top:10%}50%{top:88%}100%{top:10%}}
                    @keyframes scannerReveal{from{opacity:0;transform:scaleY(0.72) translateY(-12px);filter:blur(6px);transform-origin:top center;}to{opacity:1;transform:scaleY(1) translateY(0);filter:blur(0);transform-origin:top center;}}
                `}</style>
                <div style={{ position:'absolute', left:'8%', right:'8%', height:'2px', background:'linear-gradient(90deg, transparent, rgba(0,82,204,0.95), transparent)', animation:'scan-ln 2s ease-in-out infinite', zIndex:10, boxShadow:'0 0 18px rgba(0,82,204,0.75), 0 0 50px rgba(0,82,204,0.25)' }} />
                {[
                    { top:14, left:14, bTop:'2.5px solid rgba(0,82,204,0.90)', bLeft:'2.5px solid rgba(0,82,204,0.90)', br:'5px 0 0 0' },
                    { top:14, right:14, bTop:'2.5px solid rgba(0,82,204,0.90)', bRight:'2.5px solid rgba(0,82,204,0.90)', br:'0 5px 0 0' },
                    { bottom:14, left:14, bBottom:'2.5px solid rgba(0,82,204,0.90)', bLeft:'2.5px solid rgba(0,82,204,0.90)', br:'0 0 0 5px' },
                    { bottom:14, right:14, bBottom:'2.5px solid rgba(0,82,204,0.90)', bRight:'2.5px solid rgba(0,82,204,0.90)', br:'0 0 5px 0' },
                ].map((c,i) => (
                    <div key={i} style={{ position:'absolute', top:c.top, left:c.left, right:c.right, bottom:c.bottom, width:26, height:26, borderTop:c.bTop, borderLeft:c.bLeft, borderRight:c.bRight, borderBottom:c.bBottom, borderRadius:c.br, zIndex:11, filter:'drop-shadow(0 0 5px rgba(0,82,204,0.55))' }} />
                ))}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-white/15 rounded-xl"
                    style={{ width:'62%', height:'52%' }} />
                <div style={{ position:'absolute', inset:0, borderRadius:'1.5rem', background:'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.35) 100%)', pointerEvents:'none' }} />
                <div style={{ position:'absolute', inset:0, borderRadius:'1.5rem', border:'1px solid rgba(255,255,255,0.07)', boxShadow:'inset 0 0 32px rgba(0,0,0,0.30)', pointerEvents:'none' }} />
            </div>
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.22] backdrop-blur-xl border border-white/55 rounded-[1.25rem] shadow-[0_4px_14px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.85)]">
                <div className="relative shrink-0">
                    <div className="w-2 h-2 rounded-full bg-[#0052CC]" />
                    <div className="absolute inset-0 rounded-full bg-[#0052CC]/40 animate-ping" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Apunta el escáner al código de barras</p>
            </div>
        </div>
    );

    const ScanFeedback = () => scanFeedback ? (
        <div className={`p-3 rounded-2xl text-center animate-in zoom-in-95 duration-200 ${
            scanFeedback.status==='error'   ? 'bg-red-50/55 border border-red-200' :
            scanFeedback.status==='success' ? 'bg-emerald-50/55 border border-emerald-200' :
            'bg-[#0052CC]/6 border border-[#0052CC]/22'}`}>
            {scanFeedback.code && <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Código: <span>{scanFeedback.code}</span></p>}
            <p className={`text-[12px] font-bold flex items-center justify-center gap-1.5 ${scanFeedback.status==='error'?'text-red-600':scanFeedback.status==='success'?'text-emerald-600':'text-[#0052CC]'}`}>
                {scanFeedback.status==='reading'&&<Loader2 size={12} className="animate-spin"/>}{scanFeedback.message}
            </p>
        </div>
    ) : null;

    const ErrorPill = () => error ? (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200 px-4 py-3 bg-red-50/50 backdrop-blur-md border border-red-200/80 rounded-[1.25rem] flex items-center gap-3">
            <AlertCircle size={15} className="text-red-500 shrink-0" strokeWidth={2.5} />
            <p className="text-red-600 text-[10px] font-black uppercase tracking-widest">{error}</p>
        </div>
    ) : null;

    const CameraToggleBtn = ({ compact, hidden: tabHidden }) => (
        <button
            type="button"
            tabIndex={tabHidden ? -1 : undefined}
            onClick={() => {
                if (scannerActive) { handleStopScannerBtn(); }
                else { if (inputRef.current) inputRef.current.value = ''; setScanFeedback(null); cooldownRef.current = false; setScannerActive(true); }
            }}
            className={[
                'shrink-0 flex items-center justify-center rounded-[1.25rem] border backdrop-blur-md',
                'transition-all duration-300 active:scale-[0.93]',
                compact ? 'w-[44px] h-[44px]' : 'w-[52px] h-[52px]',
                scannerActive
                    ? 'bg-red-500/[0.15] border-red-400/45 text-red-400 shadow-[0_0_18px_rgba(239,68,68,0.18),inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-red-500/[0.25] hover:shadow-[0_0_28px_rgba(239,68,68,0.28),inset_0_1px_0_rgba(255,255,255,0.60)]'
                    : 'bg-white/[0.28] border-white/60 text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-white/[0.55] hover:border-white/85 hover:text-[#0052CC] hover:shadow-[0_6px_18px_rgba(0,0,0,0.07),inset_0_1px_0_rgba(255,255,255,0.95)]',
            ].join(' ')}
        >
            {scannerActive
                ? <X size={compact ? 15 : 17} strokeWidth={2.5} />
                : <Camera size={compact ? 16 : 18} strokeWidth={2} />}
        </button>
    );

    const CodeForm = ({ compact = false, isHidden = false }) => {
        const tid = isHidden ? -1 : undefined;
        return (
            <div className="flex flex-col gap-3">
                <div className="relative group z-20 flex items-center gap-2 animate-input-reveal" style={{'--ir-delay':'0ms'}}>
                    <div className="relative flex-1 flex items-center">
                        <ScanBarcode size={compact?18:22} strokeWidth={2} className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-30" />
                        <input ref={inputRef} id={isHidden?undefined:'login-code'} name="login-code" type="text" placeholder="CÓDIGO"
                            tabIndex={tid} autoComplete="off" spellCheck="false"
                            className={`${inputCls} ${compact?'pl-11 pr-4 py-3 text-sm':'pl-14 pr-5 py-4 text-lg'} rounded-[1.5rem] tracking-[0.45em] uppercase [-webkit-text-security:disc]`} />
                    </div>
                    <CameraToggleBtn compact={compact} hidden={isHidden} />
                </div>
                {!isHidden && scannerActive && <ScannerView />}
                {!isHidden && <ScanFeedback />}
            </div>
        );
    };

    const UsernameForm = ({ compact = false, isHidden = false }) => {
        const tid = isHidden ? -1 : undefined;
        return (
            <div className="flex flex-col gap-3">
                {[
                    { ref:usernameRef, id:'username', type:'text', placeholder:'nombre.apellido', autoComplete:'username', Icon:UserIcon },
                    { ref:userPasswordRef, id:'password', type:'password', placeholder:'Contraseña', autoComplete:'current-password', Icon:Lock },
                ].map(({ ref, id, type, placeholder, autoComplete, Icon }, i) => (
                    <div key={i} className="relative group flex items-center animate-input-reveal" style={{'--ir-delay':`${i * 80}ms`}}>
                        <Icon size={compact?16:18} strokeWidth={2} className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-10" />
                        <input ref={ref} id={isHidden?undefined:id} name={id} type={type} placeholder={placeholder}
                            tabIndex={tid} autoComplete={autoComplete}
                            className={`${inputCls} ${compact?'pl-11 pr-4 py-3 text-[13px]':'pl-12 pr-5 py-4 text-[14px]'} rounded-[1.5rem]`} />
                    </div>
                ))}
            </div>
        );
    };

    const FormPanel = ({ compact }) => {
        const isUsername = loginMode === 'username';
        const btnH = compact ? 'h-[46px]' : 'h-[54px]';
        const gap  = compact ? 'gap-3' : 'gap-4';

        return (
            <div className="w-full overflow-hidden">
                <div style={{
                    display: 'flex',
                    width: '200%',
                    alignItems: 'flex-start',
                    transform: isUsername ? 'translateX(-50%)' : 'translateX(0%)',
                    transition: 'transform 520ms cubic-bezier(0.23, 1, 0.32, 1)',
                    willChange: 'transform',
                }}>
                    <div key={codeKey} style={{ width: '50%', minWidth: 0 }}>
                        <form onSubmit={handleLogin} className={`flex flex-col ${gap}`}>
                            <CodeForm compact={compact} isHidden={isUsername} />
                            {!isUsername && <ErrorPill />}
                            <div className="animate-input-reveal" style={{'--ir-delay':'90ms'}}>
                                <GlassButton height={btnH} disabled={isLoading || isUsername} tabIndex={isUsername ? -1 : undefined}>
                                    {isLoading && !isUsername
                                        ? <Loader2 size={compact?16:20} className="animate-spin" />
                                        : 'Ingresar al Portal'}
                                </GlassButton>
                            </div>
                        </form>
                    </div>

                    <div key={userKey} style={{ width: '50%', minWidth: 0 }}>
                        <form onSubmit={handleUsernameLogin} className={`flex flex-col ${gap}`}>
                            <UsernameForm compact={compact} isHidden={!isUsername} />
                            {isUsername && <ErrorPill />}
                            <div className="animate-input-reveal" style={{'--ir-delay':'170ms'}}>
                                <GlassButton height={btnH} disabled={isLoading || !isUsername} tabIndex={!isUsername ? -1 : undefined}>
                                    {isLoading && isUsername
                                        ? <Loader2 size={compact?16:20} className="animate-spin" />
                                        : 'Ingresar al Portal'}
                                </GlassButton>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        );
    };

    /* ══════════════════════════════════════════════════════
       SCAN-PENDING VIEW  (first 10 seconds)
    ══════════════════════════════════════════════════════ */
    const ScanPendingView = ({ compact }) => (
        <div className="flex flex-col items-center gap-5 animate-in fade-in duration-400">
            {/* Hidden input: captures hardware scanner */}
            <form onSubmit={handleScanPendingSubmit} className="sr-only">
                <input
                    ref={scanInputRef}
                    type="password"
                    autoComplete="off"
                    spellCheck="false"
                    tabIndex={0}
                    onBlur={() => setTimeout(() => scanInputRef.current?.focus(), 80)}
                />
            </form>

            {/* Icon */}
            <div className="relative">
                <div className="absolute -inset-4 rounded-full blur-2xl opacity-30 bg-[#0052CC] animate-pulse" />
                <div className={`relative flex items-center justify-center rounded-[1.75rem] bg-white/[0.28] backdrop-blur-xl border border-white/70 shadow-[0_8px_32px_rgba(0,82,204,0.18),inset_0_2px_0_rgba(255,255,255,0.95)] ${compact ? 'w-16 h-16' : 'w-20 h-20'}`}>
                    {isLoading
                        ? <Loader2 size={compact?28:36} className="text-[#0052CC] animate-spin" strokeWidth={2} />
                        : scanFeedback?.status === 'success'
                            ? <CheckCircle2 size={compact?28:36} className="text-emerald-500" strokeWidth={2} />
                            : scanFeedback?.status === 'error'
                                ? <AlertCircle size={compact?28:36} className="text-red-500" strokeWidth={2} />
                                : <ScanBarcode size={compact?28:36} className="text-[#0052CC]" strokeWidth={1.8} />
                    }
                </div>
            </div>

            {/* Text */}
            <div className="text-center">
                {scanFeedback ? (
                    <>
                        {scanFeedback.code && <p className="text-[9px] font-black uppercase tracking-widest text-slate-400/70 mb-1">Código: {scanFeedback.code}</p>}
                        <p className={`text-[13px] font-bold ${scanFeedback.status==='error'?'text-red-600':scanFeedback.status==='success'?'text-emerald-600':'text-[#0052CC]'}`}>
                            {scanFeedback.message}
                        </p>
                    </>
                ) : (
                    <>
                        <p className={`font-black text-slate-700 ${compact ? 'text-[15px]' : 'text-[17px]'}`}>
                            {isLoading ? 'Verificando...' : 'Escanea tu carné'}
                        </p>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                            {isLoading ? 'Por favor espera' : 'Pasa el código de barras por el lector'}
                        </p>
                    </>
                )}
            </div>

            {/* Countdown progress bar */}
            {!isLoading && !scanFeedback && (
                <div className="w-full max-w-[200px] flex flex-col items-center gap-1.5">
                    <div className="w-full h-[3px] bg-white/30 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[#0052CC]/60 rounded-full transition-all duration-200"
                            style={{ width: `${(scanCountdown / (SCAN_WAIT_MS / 1000)) * 100}%` }}
                        />
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        Ingreso manual en {scanCountdown}s
                    </p>
                </div>
            )}

            {/* Manual fallback link */}
            {!isLoading && (
                <button
                    type="button"
                    onClick={exitScanPending}
                    className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-[#0052CC] transition-colors flex items-center gap-1.5 px-4 py-2 rounded-xl hover:bg-white/30"
                >
                    Ingresar manualmente <ChevronRight size={11} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );

    /* ══════════════════════════════════════════════════════
       CHANGE PASSWORD SCREEN
    ══════════════════════════════════════════════════════ */
    if (mustChangePwd) {
        return (
            <div className="relative flex items-center justify-center w-full min-h-[100dvh] overflow-hidden"
                style={{ background:'radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%)' }}>
                <AmbientBG />
                <div className={`relative z-10 w-full max-w-[420px] mx-5 transition-all duration-600 ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 translate-y-0 scale-100':'opacity-0 translate-y-6 scale-[0.96]'}`}>
                    <div className="rounded-[2.5rem] p-8 bg-white/[0.20] backdrop-blur-[48px] backdrop-saturate-[200%] border border-white/[0.85] shadow-[0_32px_80px_rgba(0,0,0,0.12),inset_0_2px_0_rgba(255,255,255,0.95)] flex flex-col gap-6">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/28 to-transparent pointer-events-none rounded-[2.5rem]" />
                        <div className="relative flex flex-col items-center gap-3">
                            <div className="w-14 h-14 rounded-[1.25rem] bg-amber-400/10 border border-amber-300/40 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                                <Lock size={22} className="text-amber-500" strokeWidth={2} />
                            </div>
                            <h3 className="text-[22px] font-black text-slate-800 tracking-tight text-center">Cambia tu contraseña</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Primer acceso — establece una contraseña personal</p>
                        </div>
                        <form id="cpf" onSubmit={e=>{e.preventDefault();handleChangePassword();}} className="relative flex flex-col gap-3">
                            {[{ph:'Nueva contraseña (mín. 8 caracteres)',v:newPassword,s:e=>{setNewPassword(e.target.value);setChangePassError('');}},{ph:'Confirmar contraseña',v:confirmPassword,s:e=>{setConfirmPassword(e.target.value);setChangePassError('');}}].map((f,i)=>(
                                <div key={i} className="relative group flex items-center">
                                    <Lock size={15} strokeWidth={2.5} className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-10" />
                                    <input type="password" placeholder={f.ph} value={f.v} onChange={f.s} className={`${inputCls} pl-11 pr-4 py-3.5 text-[13px] rounded-[1.25rem]`} />
                                </div>
                            ))}
                            {changePassError && <div className="px-4 py-2.5 bg-red-50/60 border border-red-200/80 rounded-[1rem] flex items-center gap-2"><AlertCircle size={14} className="text-red-500 shrink-0" strokeWidth={2.5}/><p className="text-[11px] font-black text-red-600">{changePassError}</p></div>}
                            <GlassButton type="submit" disabled={changePassLoading||!newPassword||!confirmPassword} height="h-[52px]">
                                {changePassLoading?<Loader2 size={18} className="animate-spin"/>:'Guardar contraseña'}
                            </GlassButton>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════
       MOBILE LAYOUT
    ══════════════════════════════════════════════════════ */
    const MobileLayout = () => (
        <div className="flex flex-col items-center justify-between min-h-[100dvh] w-full px-5 py-8 gap-4">
            <div className={`flex flex-col items-center gap-2 transition-all duration-700 delay-[80ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted||scanPending?'opacity-100 translate-y-0':'opacity-0 -translate-y-4'}`}>
                <div className="relative">
                    <div className="absolute -inset-3 rounded-[2rem] blur-xl opacity-40 bg-gradient-to-tr from-violet-500/60 to-blue-400/40" />
                    <div className="relative w-16 h-16 rounded-[1.5rem] bg-white/[0.55] backdrop-blur-xl border border-white/85 flex items-center justify-center shadow-[0_8px_24px_rgba(110,70,220,0.18),inset_0_2px_0_rgba(255,255,255,1)]">
                        <img src="/Logo192.png" alt="FarmaLasa" className="w-10 h-10 object-contain" />
                    </div>
                </div>
                <div className="text-center mt-1">
                    <p className="font-black text-[20px] text-slate-800 tracking-tight leading-none">Portal Farmalasa</p>
                    <p className="text-[9px] font-black text-[#0052CC]/70 uppercase tracking-[0.22em] mt-1">Sistema de Gestión</p>
                </div>
            </div>

            <div className={`relative w-full max-w-[420px] transition-all duration-700 delay-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted||scanPending?'opacity-100 scale-100 translate-y-0':'opacity-0 scale-[0.94] translate-y-5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-[2.5rem]" />
                <div className="rounded-[2.5rem] p-5 bg-white/[0.20] backdrop-blur-[48px] backdrop-saturate-[200%] border border-white/[0.82] shadow-[0_24px_60px_rgba(0,0,0,0.10),inset_0_2px_0_rgba(255,255,255,0.90)] flex flex-col gap-4">
                    {scanPending ? (
                        <ScanPendingView compact />
                    ) : (
                        <>
                            <TabBar />
                            <FormPanel compact />
                        </>
                    )}
                    {!isMobileOrApp() && !scanPending && (
                        <>
                            <div className="h-px bg-white/40 mx-2" />
                            <button type="button" onClick={goToKiosko}
                                className="group w-full p-3 rounded-[1.5rem] bg-white/[0.18] backdrop-blur-md border border-white/65 flex items-center justify-between transition-all duration-250 active:scale-[0.97] hover:bg-white/[0.35] hover:border-white/85 hover:shadow-[0_6px_20px_rgba(0,0,0,0.07)]">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-[0.875rem] bg-white/50 border border-white/75 flex items-center justify-center group-hover:bg-white transition-colors shadow-sm">
                                        <Clock size={15} className="text-slate-500 group-hover:text-[#0052CC] transition-colors" strokeWidth={2.2} />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Terminal Kiosco</p>
                                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
                                    </div>
                                </div>
                                <div className="w-7 h-7 rounded-full bg-white/55 border border-white/75 flex items-center justify-center group-hover:bg-[#0052CC] group-hover:border-transparent transition-all duration-200">
                                    <ArrowRight size={12} className="text-slate-400 group-hover:text-white transition-colors" strokeWidth={2.5} />
                                </div>
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className={`flex gap-2 transition-all duration-700 delay-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted||scanPending?'opacity-100 translate-y-0':'opacity-0 translate-y-4'}`}>
                {[
                    {href:'https://clientesdte.oss.com.sv/farma_salud/dashboard.php',Icon:ShoppingCart,label:'Ventas',color:'#0052CC'},
                    {href:'https://farmalasa.com',Icon:Pill,label:'FarmaLasa',color:'#6929C4'},
                ].map(({href,Icon,label,color})=>(
                    <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                        className="group flex items-center gap-2 px-4 py-2.5 bg-white/[0.22] hover:bg-white/[0.50] backdrop-blur-md border border-white/55 hover:border-white/85 rounded-[1.25rem] transition-all duration-200 active:scale-[0.97] hover:scale-[1.03] hover:-translate-y-0.5">
                        <Icon size={14} strokeWidth={2} style={{color}} className="transition-transform duration-200 group-hover:scale-110" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-700 transition-colors">{label}</span>
                    </a>
                ))}
            </div>
        </div>
    );

    /* ══════════════════════════════════════════════════════
       DESKTOP LAYOUT
    ══════════════════════════════════════════════════════ */
    const DesktopLayout = () => (
        <div className="relative flex items-center justify-center w-full min-h-[100dvh] px-6 py-10">
            <div className={`relative w-full max-w-[480px] z-10 transition-all duration-700 delay-[80ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted||scanPending?'opacity-100 scale-100 translate-y-0':'opacity-0 scale-[0.93] translate-y-8'}`}>
                <div className="absolute -inset-6 rounded-[3.5rem] blur-2xl opacity-18 bg-gradient-to-b from-violet-400 via-indigo-300 to-blue-400 pointer-events-none" />

                <div className="relative rounded-[3rem] px-10 py-10 bg-white/[0.18] backdrop-blur-[52px] backdrop-saturate-[200%] border border-white/[0.86] shadow-[0_40px_100px_rgba(0,0,0,0.12),inset_0_2px_0_rgba(255,255,255,0.95)] flex flex-col gap-6 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-white/26 via-transparent to-transparent pointer-events-none rounded-[3rem]" />

                    {/* Logo */}
                    <div className="relative flex flex-col items-center gap-3">
                        <div className="relative group/logo">
                            <div className="absolute -inset-4 rounded-[2.5rem] blur-2xl opacity-32 group-hover/logo:opacity-60 transition-all duration-500 bg-gradient-to-tr from-violet-500/55 to-blue-400/38" />
                            <div className="relative w-[88px] h-[88px] rounded-[1.75rem] bg-white/[0.62] backdrop-blur-2xl border border-white/90 flex items-center justify-center shadow-[0_12px_40px_rgba(110,70,220,0.16),inset_0_2px_0_rgba(255,255,255,1)]"
                                style={{ animation:'lgn-logo 4.5s ease-in-out infinite' }}>
                                <img src="/Logo192.png" alt="FarmaLasa" className="w-[58px] h-[58px] object-contain" />
                            </div>
                        </div>
                        <div className="text-center">
                            <h1 className="text-[32px] font-black text-slate-800 tracking-tight leading-none">Portal</h1>
                            <p className="text-[10px] font-black text-[#0052CC]/72 uppercase tracking-[0.22em] mt-2">Farmacias La Popular &amp; La Salud</p>
                        </div>
                    </div>

                    <div className="relative h-px"><div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/55 to-transparent" /></div>

                    {/* Form or Scan Pending */}
                    <div className="relative flex flex-col gap-5">
                        {scanPending ? (
                            <ScanPendingView compact={false} />
                        ) : (
                            <>
                                <TabBar />
                                <FormPanel compact={false} />
                            </>
                        )}
                    </div>

                    {!scanPending && (
                        <>
                            <div className="relative h-px"><div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/55 to-transparent" /></div>
                            {!isMobileOrApp() && (
                                <div className="relative">
                                    <button type="button" onClick={goToKiosko}
                                        className="group w-full p-4 rounded-[1.75rem] bg-white/[0.18] backdrop-blur-md border border-white/65 flex items-center justify-between transition-all duration-250 active:scale-[0.97] hover:bg-white/[0.35] hover:border-white/88 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5">
                                        <div className="flex items-center gap-3.5">
                                            <div className="w-11 h-11 rounded-[1.1rem] bg-white/50 border border-white/80 flex items-center justify-center group-hover:bg-white transition-all duration-200 shadow-sm group-hover:shadow-[0_4px_12px_rgba(0,82,204,0.15)]">
                                                <Clock size={19} className="text-slate-500 group-hover:text-[#0052CC] transition-colors" strokeWidth={2} />
                                            </div>
                                            <div className="text-left">
                                                <p className="text-[12px] font-black text-slate-700 uppercase tracking-widest">Terminal Kiosco</p>
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
                                            </div>
                                        </div>
                                        <div className="w-8 h-8 rounded-full bg-white/55 border border-white/75 flex items-center justify-center group-hover:bg-[#0052CC] group-hover:border-transparent transition-all duration-200 group-hover:shadow-[0_4px_12px_rgba(0,82,204,0.30)]">
                                            <ArrowRight size={14} className="text-slate-400 group-hover:text-white transition-colors" strokeWidth={2.5} />
                                        </div>
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Quick links */}
            {!scanPending && (
                <div className={`absolute right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-20 transition-all duration-700 delay-[300ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 translate-x-0':'opacity-0 translate-x-8'}`}>
                    <div className="rounded-[2rem] p-4 bg-white/[0.16] backdrop-blur-[40px] backdrop-saturate-[200%] border border-white/[0.78] shadow-[0_20px_50px_rgba(0,0,0,0.09),inset_0_2px_0_rgba(255,255,255,0.90)] flex flex-col gap-3 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/18 to-transparent pointer-events-none rounded-[2rem]" />
                        <div className="relative flex items-center gap-2 px-1 mb-1">
                            <Sparkles size={11} className="text-violet-400" strokeWidth={2} />
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Accesos rápidos</p>
                        </div>
                        {[
                            {href:'https://clientesdte.oss.com.sv/farma_salud/dashboard.php',Icon:ShoppingCart,label:'Sistema de Ventas',sub:'DTE · OSS',color:'#0052CC',glow:'rgba(0,82,204,0.22)'},
                            {href:'https://farmalasa.com',Icon:Pill,label:'Farmalasa',sub:'Sitio web oficial',color:'#6929C4',glow:'rgba(105,41,196,0.22)'},
                        ].map(({href,Icon,label,sub,color,glow})=>(
                            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                                className="relative group flex items-center gap-3 px-3.5 py-3 bg-white/[0.22] hover:bg-white/[0.55] backdrop-blur-md border border-white/55 hover:border-white/88 rounded-[1.25rem] transition-all duration-250 active:scale-[0.97] hover:scale-[1.02] hover:-translate-y-0.5 w-[210px] overflow-hidden"
                                onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 24px ${glow}, inset 0 1px 0 rgba(255,255,255,0.7)`; }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; }}>
                                <div className="absolute inset-0 overflow-hidden rounded-[1.25rem] pointer-events-none">
                                    <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.12] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-600 ease-out" />
                                </div>
                                <div className="relative w-9 h-9 rounded-[0.875rem] flex items-center justify-center flex-shrink-0 transition-all duration-200 group-hover:scale-110"
                                    style={{ background:`${color}16`, border:`1px solid ${color}28` }}>
                                    <Icon size={16} strokeWidth={2} style={{color}} />
                                </div>
                                <div className="relative min-w-0">
                                    <p className="text-[11px] font-black text-slate-700 group-hover:text-slate-900 transition-colors truncate">{label}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{sub}</p>
                                </div>
                                <ChevronRight size={11} className="relative text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 transition-all duration-200 group-hover:translate-x-0.5" strokeWidth={2.5} />
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    const styles = `
        @keyframes lgn-logo{0%,100%{transform:scale(1);box-shadow:0 12px 40px rgba(110,70,220,0.16),inset 0 2px 0 rgba(255,255,255,1);}50%{transform:scale(1.04);box-shadow:0 20px 56px rgba(110,70,220,0.28),inset 0 2px 0 rgba(255,255,255,1);}}
        @keyframes lgn-p1{0%,100%{transform:translate(0,0) scale(1);opacity:.60;}35%{transform:translate(10px,-18px) scale(1.16);opacity:1;}68%{transform:translate(-6px,-8px) scale(.88);opacity:.75;}}
        @keyframes lgn-p2{0%,100%{transform:translate(0,0) scale(1);opacity:.50;}42%{transform:translate(-12px,16px) scale(1.20);opacity:.90;}74%{transform:translate(8px,-10px) scale(.82);opacity:.70;}}
    `;

    const isMob = window.innerWidth < 1024;

    return (
        <div className={`relative w-full min-h-[100dvh] overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${leaving?'opacity-0 scale-[1.03]':'opacity-100 scale-100'}`}
            style={{ background:'radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%)' }}>
            <style>{styles}</style>
            <AmbientBG />
            <div className="relative z-10 w-full min-h-[100dvh]">
                {isMob ? <MobileLayout /> : <DesktopLayout />}
            </div>
        </div>
    );
};

export default LoginView;
