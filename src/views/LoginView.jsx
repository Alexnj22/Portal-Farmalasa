import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    ShoppingCart, Pill, AlertCircle, Lock, Camera,
    User as UserIcon, Sparkles, ArrowRight, X, CheckCircle2,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';

// Lectores físicos (keyboard-wedge) tipean rápido y terminan con Enter.
const SCAN_KEY_GAP_MS = 250;
const SCAN_MIN_LENGTH = 3;
// Ventana inicial con prioridad del lector: si nadie escanea, el foco pasa a usuario.
const SCAN_FOCUS_WAIT_MS = 10_000;

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

const keyframeStyles = `
    @keyframes lgn-logo{0%,100%{transform:scale(1);box-shadow:0 12px 40px rgba(110,70,220,0.16),inset 0 2px 0 rgba(255,255,255,1);}50%{transform:scale(1.04);box-shadow:0 20px 56px rgba(110,70,220,0.28),inset 0 2px 0 rgba(255,255,255,1);}}
    @keyframes lgn-p1{0%,100%{transform:translate(0,0) scale(1);opacity:.60;}35%{transform:translate(10px,-18px) scale(1.16);opacity:1;}68%{transform:translate(-6px,-8px) scale(.88);opacity:.75;}}
    @keyframes lgn-p2{0%,100%{transform:translate(0,0) scale(1);opacity:.50;}42%{transform:translate(-12px,16px) scale(1.20);opacity:.90;}74%{transform:translate(8px,-10px) scale(.82);opacity:.70;}}
    @keyframes scan-ln{0%{top:10%}50%{top:88%}100%{top:10%}}
    @keyframes scannerReveal{from{opacity:0;transform:scaleY(0.72) translateY(-12px);filter:blur(6px);transform-origin:top center;}to{opacity:1;transform:scaleY(1) translateY(0);filter:blur(0);transform-origin:top center;}}
`;

/* ─── Static sub-components (fuera del render: no se remontan) ──────────── */

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

const GlassButton = ({ type = 'submit', onClick, disabled, children, height = 'h-[54px]' }) => (
    <button type={type} onClick={onClick} disabled={disabled}
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

const CameraScanner = ({ videoRef }) => (
    <div style={{ animation: 'scannerReveal 450ms cubic-bezier(0.23,1,0.32,1) both' }} className="flex flex-col gap-2.5">
        <div className="relative w-full overflow-hidden border border-white/[0.14] shadow-[0_20px_60px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.14)]"
            style={{ height: 224, borderRadius: '1.5rem' }}>
            <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-sm" />
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />
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
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Apunta la cámara al código de barras</p>
        </div>
    </div>
);

/* ─── LoginView ─────────────────────────────────────────────────────────── */

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, loginWithUsername, hasPermission, user, completePasswordChange } = useAuth();

    const [isLoading,         setIsLoading]         = useState(false);
    const [error,             setError]             = useState('');
    const [scanFeedback,      setScanFeedback]      = useState(null);
    const [formEngaged,       setFormEngaged]       = useState(false);
    const [cameraActive,      setCameraActive]      = useState(false);
    const [mounted,           setMounted]           = useState(false);
    const [leaving,           setLeaving]           = useState(false);
    const [newPassword,       setNewPassword]       = useState('');
    const [confirmPassword,   setConfirmPassword]   = useState('');
    const [changePassError,   setChangePassError]   = useState('');
    const [changePassLoading, setChangePassLoading] = useState(false);
    const [mustChangePwd,     setMustChangePwd]     = useState(false);
    const [pendingUserLocal,  setPendingUserLocal]  = useState(null);
    const [scanHold,          setScanHold]          = useState(true);
    const [scanHoldLeft,      setScanHoldLeft]      = useState(SCAN_FOCUS_WAIT_MS / 1000);
    const [hasCamera,         setHasCamera]         = useState(false);

    const usernameRef     = useRef(null);
    const userPasswordRef = useRef(null);
    const videoRef        = useRef(null);
    const scannerRef      = useRef(null);
    const streamRef       = useRef(null);
    const cooldownRef     = useRef(false);
    const busyRef         = useRef(false);
    const scanBufRef      = useRef('');
    const scanLastKeyRef  = useRef(0);
    const scanHoldTimeoutRef  = useRef(null);
    const scanHoldIntervalRef = useRef(null);

    useEffect(() => {
        const t = setTimeout(() => setMounted(true), 60);
        return () => clearTimeout(t);
    }, []);

    // Solo mostrar el botón de cámara si el dispositivo tiene una.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                if (!navigator.mediaDevices?.enumerateDevices) return;
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (alive) setHasCamera(devices.some(d => d.kind === 'videoinput'));
            } catch { /* API no disponible → botón oculto */ }
        })();
        return () => { alive = false; };
    }, []);

    const endScanHold = useCallback(() => {
        clearTimeout(scanHoldTimeoutRef.current);
        clearInterval(scanHoldIntervalRef.current);
        setScanHold(false);
    }, []);

    // Prioridad inicial del lector: durante los primeros 10s nada tiene foco
    // (el navegador/gestor de contraseñas suele enfocar el primer input — se
    // libera); si no hubo login al vencer, el foco pasa a usuario.
    useEffect(() => {
        const blurT = setTimeout(() => {
            const ae = document.activeElement;
            if (ae === usernameRef.current || ae === userPasswordRef.current) ae.blur();
        }, 50);
        const start = Date.now();
        scanHoldIntervalRef.current = setInterval(() => {
            setScanHoldLeft(Math.max(0, Math.ceil((SCAN_FOCUS_WAIT_MS - (Date.now() - start)) / 1000)));
        }, 250);
        scanHoldTimeoutRef.current = setTimeout(() => {
            endScanHold();
            if (!busyRef.current) usernameRef.current?.focus();
        }, SCAN_FOCUS_WAIT_MS);
        return () => {
            clearTimeout(blurT);
            clearTimeout(scanHoldTimeoutRef.current);
            clearInterval(scanHoldIntervalRef.current);
        };
    }, [endScanHold]);

    useEffect(() => {
        if (user) { if (hasPermission('staff_list', 'can_view') || hasPermission('overview', 'can_view')) setView('dashboard'); else { setActiveEmployee(user); setView('employee-detail'); } }
    }, [user, hasPermission, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(''), 4000); return () => clearTimeout(t); }
    }, [error]);

    /* ── Scan login (lector físico o cámara) ─────────────────────────────── */

    const handleScanLogin = async (rawCode) => {
        if (busyRef.current || mustChangePwd) return false;
        const code = String(rawCode ?? '').trim().toUpperCase();
        if (!code) return false;
        busyRef.current = true;
        endScanHold();
        setError('');
        setScanFeedback({ status: 'reading', code, message: 'Verificando...' });
        setIsLoading(true);
        try {
            const result = await login(code);
            if (!result.ok) {
                setScanFeedback({ status: 'error', code, message: result.error || 'Carné no reconocido.' });
                setTimeout(() => setScanFeedback(cur => (cur?.status === 'error' ? null : cur)), 2500);
                return false;
            }
            setScanFeedback({ status: 'success', code, message: '¡Acceso concedido!' });
            return true;
        } catch {
            setScanFeedback({ status: 'error', code, message: 'Error de conexión.' });
            setTimeout(() => setScanFeedback(cur => (cur?.status === 'error' ? null : cur)), 2500);
            return false;
        } finally {
            setIsLoading(false);
            busyRef.current = false;
        }
    };
    const handleScanLoginRef = useRef(handleScanLogin);
    handleScanLoginRef.current = handleScanLogin;

    // Captura global: el lector siempre está activo mientras el foco NO esté en un
    // input (si el usuario escribe usuario/contraseña, las teclas van al campo).
    useEffect(() => {
        const onKeyDown = (e) => {
            const t = e.target;
            if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const now = Date.now();
            if (now - scanLastKeyRef.current > SCAN_KEY_GAP_MS) scanBufRef.current = '';
            scanLastKeyRef.current = now;
            if (e.key === 'Enter') {
                const code = scanBufRef.current.trim();
                scanBufRef.current = '';
                if (code.length >= SCAN_MIN_LENGTH) {
                    e.preventDefault();
                    handleScanLoginRef.current(code);
                }
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                scanBufRef.current += e.key;
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    /* ── Cámara (scan por video) ─────────────────────────────────────────── */

    const stopCameraSafely = () => {
        if (scannerRef.current) { try { scannerRef.current.reset(); } catch { /* best-effort teardown */ } scannerRef.current = null; }
        if (streamRef.current)  { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (videoRef.current?.srcObject) {
            try { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; videoRef.current.src = ''; videoRef.current.removeAttribute('src'); } catch { /* best-effort teardown */ }
        }
    };
    useEffect(() => () => stopCameraSafely(), []);

    useEffect(() => {
        if (!cameraActive) return;
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
                    if (videoRef.current?.srcObject) streamRef.current = videoRef.current.srcObject;
                    stopCameraSafely();
                    setCameraActive(false);
                    handleScanLoginRef.current(scannedCode);
                });
            } catch { if (!cancelled) { stopCameraSafely(); setCameraActive(false); setError('No se pudo acceder a la cámara. Verifica los permisos.'); } }
        })();
        return () => { cancelled = true; clearTimeout(warmupTimer); stopCameraSafely(); };
    }, [cameraActive]);

    const toggleCamera = () => {
        if (cameraActive) { cooldownRef.current = false; stopCameraSafely(); setCameraActive(false); }
        else { endScanHold(); setScanFeedback(null); cooldownRef.current = false; setCameraActive(true); }
    };

    /* ── Estado "lector en pausa" cuando el usuario usa el formulario ────── */

    const syncFormEngaged = useCallback(() => {
        // Diferido: tras blur/focus, activeElement recién queda actualizado.
        setTimeout(() => {
            const ae = document.activeElement;
            const focused = ae === usernameRef.current || ae === userPasswordRef.current;
            const hasText = !!(usernameRef.current?.value || userPasswordRef.current?.value);
            setFormEngaged(focused || hasText);
            if (focused || hasText) endScanHold();
        }, 0);
    }, [endScanHold]);

    /* ── Login usuario/contraseña ────────────────────────────────────────── */

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

    const goToKiosko = () => {
        setLeaving(true);
        setTimeout(() => setView('timeclock'), 320);
    };

    /* ── Widgets (funciones que devuelven JSX inline: sin remounts) ──────── */

    const renderScanWidget = (compact) => {
        const st     = scanFeedback?.status; // 'reading' | 'success' | 'error' | undefined
        const paused = formEngaged && !st && !isLoading && !cameraActive;
        const active = !paused && !st && !isLoading && !cameraActive;

        return (
            <div className="flex flex-col gap-2.5">
                <div className={[
                    'flex items-center gap-3 px-4 rounded-[1.5rem] border backdrop-blur-md transition-all duration-300',
                    compact ? 'py-2.5' : 'py-3',
                    st === 'error'   ? 'bg-red-50/55 border-red-200/80' :
                    st === 'success' ? 'bg-emerald-50/55 border-emerald-200/80' :
                    paused           ? 'bg-white/[0.14] border-white/45' :
                                       'bg-[#0052CC]/[0.05] border-[#0052CC]/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]',
                ].join(' ')}>
                    <div className={[
                        'relative shrink-0 flex items-center justify-center rounded-[1rem] border transition-all duration-300',
                        compact ? 'w-10 h-10' : 'w-11 h-11',
                        st === 'error'   ? 'bg-red-100/60 border-red-200' :
                        st === 'success' ? 'bg-emerald-100/60 border-emerald-200' :
                        paused           ? 'bg-white/40 border-white/60' :
                                           'bg-white/60 border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]',
                    ].join(' ')}>
                        {st === 'reading' || isLoading
                            ? <Loader2 size={compact?17:19} className="text-[#0052CC] animate-spin" strokeWidth={2.2} />
                            : st === 'success'
                                ? <CheckCircle2 size={compact?17:19} className="text-emerald-500" strokeWidth={2.2} />
                                : st === 'error'
                                    ? <AlertCircle size={compact?17:19} className="text-red-500" strokeWidth={2.2} />
                                    : <ScanBarcode size={compact?17:19} className={paused || cameraActive ? 'text-slate-400' : 'text-[#0052CC]'} strokeWidth={2} />}
                        {active && (
                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0052CC]/50" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#0052CC] border border-white/80" />
                            </span>
                        )}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                        {scanFeedback ? (
                            <>
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 truncate">Código: {scanFeedback.code}</p>
                                <p className={`text-[12px] font-bold truncate ${st==='error'?'text-red-600':st==='success'?'text-emerald-600':'text-[#0052CC]'}`}>{scanFeedback.message}</p>
                            </>
                        ) : cameraActive ? (
                            <>
                                <p className="text-[11px] font-black uppercase tracking-widest text-slate-600">Cámara activa</p>
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mt-0.5">Escaneando con la cámara</p>
                            </>
                        ) : paused ? (
                            <>
                                <p className="text-[11px] font-black uppercase tracking-widest text-slate-600">Lector en pausa</p>
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mt-0.5">Toca fuera de los campos para reactivar</p>
                            </>
                        ) : (
                            <>
                                <p className="text-[11px] font-black uppercase tracking-widest text-[#0052CC]">Lector activo</p>
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mt-0.5">
                                    {scanHold ? `Escanea tu carné · usuario en ${scanHoldLeft}s` : 'Escanea tu carné para entrar'}
                                </p>
                            </>
                        )}
                    </div>
                    {hasCamera && (
                        <button
                            type="button"
                            onClick={toggleCamera}
                            title={cameraActive ? 'Cerrar cámara' : 'Escanear con cámara'}
                            className={[
                                'shrink-0 flex items-center justify-center rounded-[1rem] border backdrop-blur-md',
                                'transition-all duration-300 active:scale-[0.93]',
                                compact ? 'w-10 h-10' : 'w-11 h-11',
                                cameraActive
                                    ? 'bg-red-500/[0.15] border-red-400/45 text-red-400 shadow-[0_0_18px_rgba(239,68,68,0.18),inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-red-500/[0.25]'
                                    : 'bg-white/[0.28] border-white/60 text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-white/[0.55] hover:border-white/85 hover:text-[#0052CC]',
                            ].join(' ')}
                        >
                            {cameraActive
                                ? <X size={compact ? 15 : 17} strokeWidth={2.5} />
                                : <Camera size={compact ? 16 : 18} strokeWidth={2} />}
                        </button>
                    )}
                </div>
                {cameraActive && <CameraScanner videoRef={videoRef} />}
            </div>
        );
    };

    const renderLoginForm = (compact) => (
        <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
            {renderScanWidget(compact)}

            <div className="relative flex items-center gap-3 px-1">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/60 to-white/60" />
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 shrink-0">o con tu usuario</span>
                <div className="flex-1 h-px bg-gradient-to-l from-transparent via-white/60 to-white/60" />
            </div>

            <form onSubmit={handleUsernameLogin} className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
                {[
                    { ref: usernameRef,     id: 'username', type: 'text',     placeholder: 'nombre.apellido', autoComplete: 'username',         Icon: UserIcon },
                    { ref: userPasswordRef, id: 'password', type: 'password', placeholder: 'Contraseña',      autoComplete: 'current-password', Icon: Lock },
                ].map(({ ref, id, type, placeholder, autoComplete, Icon }) => (
                    <div key={id} className="relative group flex items-center">
                        <Icon size={compact?16:18} strokeWidth={2} className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-10" />
                        <input ref={ref} id={id} name={id} type={type} placeholder={placeholder}
                            autoComplete={autoComplete}
                            onFocus={syncFormEngaged} onBlur={syncFormEngaged} onInput={syncFormEngaged}
                            className={`${inputCls} ${compact?'pl-11 pr-4 py-3 text-[16px]':'pl-12 pr-5 py-4 text-[16px]'} rounded-[1.5rem]`} />
                    </div>
                ))}
                {error && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200 px-4 py-3 bg-red-50/50 backdrop-blur-md border border-red-200/80 rounded-[1.25rem] flex items-center gap-3">
                        <AlertCircle size={15} className="text-red-500 shrink-0" strokeWidth={2.5} />
                        <p className="text-red-600 text-[10px] font-black uppercase tracking-widest">{error}</p>
                    </div>
                )}
                <GlassButton height={compact ? 'h-[46px]' : 'h-[54px]'} disabled={isLoading}>
                    {isLoading
                        ? <Loader2 size={compact?16:20} className="animate-spin" />
                        : 'Ingresar al Portal'}
                </GlassButton>
            </form>
        </div>
    );

    /* ══════════════════════════════════════════════════════
       CHANGE PASSWORD SCREEN
    ══════════════════════════════════════════════════════ */
    if (mustChangePwd) {
        return (
            <div className="relative flex items-center justify-center w-full min-h-[100dvh] overflow-hidden"
                style={{ background:'radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%)' }}>
                <style>{keyframeStyles}</style>
                <AmbientBG />
                <div className={`relative z-10 w-full max-w-[420px] mx-5 transition-all duration-600 ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 translate-y-0 scale-100':'opacity-0 translate-y-6 scale-[0.96]'}`}>
                    <div className="rounded-[2.5rem] p-8 bg-white/[0.20] backdrop-blur-[48px] backdrop-saturate-[200%] border border-white/[0.85] shadow-[0_32px_80px_rgba(0,0,0,0.12),inset_0_2px_0_rgba(255,255,255,0.95)] flex flex-col gap-6">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/28 to-transparent pointer-events-none rounded-[2.5rem]" />
                        <div className="relative flex flex-col items-center gap-3">
                            <div className="w-14 h-14 rounded-[1.25rem] bg-amber-400/10 border border-amber-300/40 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                                <Lock size={22} className="text-amber-500" strokeWidth={2} />
                            </div>
                            <h3 className="text-[22px] font-black text-slate-800 tracking-tight text-center">Cambia tu contraseña</h3>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Primer acceso — establece una contraseña personal</p>
                        </div>
                        <form id="cpf" onSubmit={e=>{e.preventDefault();handleChangePassword();}} className="relative flex flex-col gap-3">
                            {[{ph:'Nueva contraseña (mín. 8 caracteres)',v:newPassword,s:e=>{setNewPassword(e.target.value);setChangePassError('');}},{ph:'Confirmar contraseña',v:confirmPassword,s:e=>{setConfirmPassword(e.target.value);setChangePassError('');}}].map((f,i)=>(
                                <div key={i} className="relative group flex items-center">
                                    <Lock size={15} strokeWidth={2.5} className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-10" />
                                    <input type="password" placeholder={f.ph} value={f.v} onChange={f.s} className={`${inputCls} pl-11 pr-4 py-3.5 text-[16px] rounded-[1.25rem]`} />
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
       LAYOUTS (JSX inline vía funciones: sin remounts)
    ══════════════════════════════════════════════════════ */

    const renderMobileLayout = () => (
        <div className="flex flex-col items-center justify-between min-h-[100dvh] w-full px-5 py-8 gap-4">
            <div className={`flex flex-col items-center gap-2 transition-all duration-700 delay-[80ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 translate-y-0':'opacity-0 -translate-y-4'}`}>
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

            <div className={`relative w-full max-w-[420px] transition-all duration-700 delay-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 scale-100 translate-y-0':'opacity-0 scale-[0.94] translate-y-5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-[2.5rem]" />
                <div className="rounded-[2.5rem] p-5 bg-white/[0.20] backdrop-blur-[48px] backdrop-saturate-[200%] border border-white/[0.82] shadow-[0_24px_60px_rgba(0,0,0,0.10),inset_0_2px_0_rgba(255,255,255,0.90)] flex flex-col gap-4">
                    {renderLoginForm(true)}
                    {!isMobileOrApp() && (
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
                                        <p className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
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

            <div className={`flex gap-2 transition-all duration-700 delay-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 translate-y-0':'opacity-0 translate-y-4'}`}>
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

    const renderDesktopLayout = () => (
        <div className="relative flex items-center justify-center w-full min-h-[100dvh] px-6 py-10">
            <div className={`relative w-full max-w-[480px] z-10 transition-all duration-700 delay-[80ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 scale-100 translate-y-0':'opacity-0 scale-[0.93] translate-y-8'}`}>
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

                    <div className="relative flex flex-col gap-5">
                        {renderLoginForm(false)}
                    </div>

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
                                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
                                    </div>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-white/55 border border-white/75 flex items-center justify-center group-hover:bg-[#0052CC] group-hover:border-transparent transition-all duration-200 group-hover:shadow-[0_4px_12px_rgba(0,82,204,0.30)]">
                                    <ArrowRight size={14} className="text-slate-400 group-hover:text-white transition-colors" strokeWidth={2.5} />
                                </div>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Quick links */}
            <div className={`absolute right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-20 transition-all duration-700 delay-[300ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted?'opacity-100 translate-x-0':'opacity-0 translate-x-8'}`}>
                <div className="rounded-[2rem] p-4 bg-white/[0.16] backdrop-blur-[40px] backdrop-saturate-[200%] border border-white/[0.78] shadow-[0_20px_50px_rgba(0,0,0,0.09),inset_0_2px_0_rgba(255,255,255,0.90)] flex flex-col gap-3 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-white/18 to-transparent pointer-events-none rounded-[2rem]" />
                    <div className="relative flex items-center gap-2 px-1 mb-1">
                        <Sparkles size={11} className="text-violet-400" strokeWidth={2} />
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Accesos rápidos</p>
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
                                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{sub}</p>
                            </div>
                            <ChevronRight size={11} className="relative text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 transition-all duration-200 group-hover:translate-x-0.5" strokeWidth={2.5} />
                        </a>
                    ))}
                </div>
            </div>
        </div>
    );

    const isMob = window.innerWidth < 1024;

    return (
        <div className={`relative w-full min-h-[100dvh] overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${leaving?'opacity-0 scale-[1.03]':'opacity-100 scale-100'}`}
            style={{ background:'radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%)' }}>
            <style>{keyframeStyles}</style>
            <AmbientBG />
            <div className="relative z-10 w-full min-h-[100dvh]">
                {isMob ? renderMobileLayout() : renderDesktopLayout()}
            </div>
        </div>
    );
};

export default LoginView;
