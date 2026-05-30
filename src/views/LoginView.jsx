import React, { useState, useEffect, useRef } from 'react';
import {
    Clock, ScanBarcode, Loader2, ChevronRight,
    ShoppingCart, Pill, AlertCircle, Lock, Camera, CameraOff, User as UserIcon, Sparkles
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { isMobileOrApp } from '../utils/helpers';
import { supabase } from '../supabaseClient';

/* ─────────────────────────────────────────────────────────────────────────────
   Premium Glassmorphism Login
   ───────────────────────────────────────────────────────────────────────────── */

const LoginView = ({ setView, setActiveEmployee }) => {
    const { login, loginWithUsername, isAdmin, user, completePasswordChange } = useAuth();

    const [isLoading,        setIsLoading]        = useState(false);
    const [error,            setError]            = useState('');
    const [loginMode,        setLoginMode]        = useState('code');
    const [newPassword,      setNewPassword]      = useState('');
    const [confirmPassword,  setConfirmPassword]  = useState('');
    const [changePassError,  setChangePassError]  = useState('');
    const [changePassLoading,setChangePassLoading]= useState(false);
    const [mustChangePwd,    setMustChangePwd]    = useState(false);
    const [pendingUserLocal, setPendingUserLocal] = useState(null);
    const [scannerActive,    setScannerActive]    = useState(false);
    const [scanFeedback,     setScanFeedback]     = useState(null);
    const [mounted,          setMounted]          = useState(false);

    const inputRef       = useRef(null);
    const usernameRef    = useRef(null);
    const userPasswordRef= useRef(null);
    const loginModeRef   = useRef(loginMode);
    const videoRef       = useRef(null);
    const scannerRef     = useRef(null);
    const streamRef      = useRef(null);
    const cooldownRef    = useRef(false);

    useEffect(() => { loginModeRef.current = loginMode; }, [loginMode]);
    useEffect(() => { const t = setTimeout(() => setMounted(true), 60); return () => clearTimeout(t); }, []);

    useEffect(() => {
        if (loginMode === 'code' && inputRef.current && !scannerActive) inputRef.current.focus();
        else if (loginMode === 'username' && usernameRef.current) usernameRef.current.focus();
    }, [loginMode, scannerActive]);

    const stopCameraSafely = () => {
        if (scannerRef.current) { try { scannerRef.current.reset(); } catch {} scannerRef.current = null; }
        if (streamRef.current)  { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
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
        let isWarmup  = true;
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
        if (user) { if (isAdmin) setView('dashboard'); else { setActiveEmployee(user); setView('employee-detail'); } }
    }, [user, isAdmin, setView, setActiveEmployee]);

    useEffect(() => {
        if (error) { const t = setTimeout(() => setError(''), 4000); return () => clearTimeout(t); }
    }, [error]);

    const handleStopScannerBtn = () => {
        cooldownRef.current = false;
        stopCameraSafely();
        setScannerActive(false);
        setScanFeedback(null);
    };

    const handleUsernameLogin = async (e) => {
        e.preventDefault();
        setError('');
        const username = usernameRef.current?.value?.trim() || '';
        const password = userPasswordRef.current?.value || '';
        if (!username || !password) { setError('Ingresa usuario y contraseña.'); return; }
        setIsLoading(true);
        try {
            const result = await loginWithUsername(username, password);
            if (!result.ok) {
                setError(result.error || 'Credenciales inválidas.');
                setIsLoading(false);
                if (userPasswordRef.current) userPasswordRef.current.value = '';
                userPasswordRef.current?.focus();
            } else if (result.mustChangePassword) {
                setPendingUserLocal(result.user);
                setMustChangePwd(true);
                setIsLoading(false);
            } else {
                setIsLoading(false);
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
        if (!code.trim()) { setError('Por favor, ingresa tu código.'); return; }
        setIsLoading(true);
        try {
            const success = await login(code);
            if (!success) {
                if (inputRef.current) inputRef.current.value = '';
                setError('Código inválido. Intenta de nuevo.');
                setIsLoading(false);
                inputRef.current?.focus();
            }
        } catch {
            setError('Error de conexión. Intenta de nuevo.');
            setIsLoading(false);
            if (inputRef.current) inputRef.current.value = '';
            inputRef.current?.focus();
        }
    };

    const handleChangePassword = async () => {
        setChangePassError('');
        if (newPassword.length < 8)      { setChangePassError('Mínimo 8 caracteres.'); return; }
        if (!/[A-Z]/.test(newPassword))  { setChangePassError('Debe incluir al menos una mayúscula.'); return; }
        if (!/[0-9]/.test(newPassword))  { setChangePassError('Debe incluir al menos un número.'); return; }
        if (newPassword !== confirmPassword) { setChangePassError('Las contraseñas no coinciden.'); return; }
        setChangePassLoading(true);
        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword,
                data: { must_change_password: false },
            });
            if (error) { setChangePassError(error.message); setChangePassLoading(false); return; }
            completePasswordChange(pendingUserLocal);
            setMustChangePwd(false);
            setPendingUserLocal(null);
            setNewPassword('');
            setConfirmPassword('');
        } catch {
            setChangePassError('Error de conexión. Intenta de nuevo.');
        }
        setChangePassLoading(false);
    };

    /* ── Shared: ambient background ── */
    const AmbientBG = () => (
        <>
            <div className="animate-ambient-drift absolute rounded-full pointer-events-none"
                style={{ width:'80vw', height:'80vw', top:'-20%', left:'-20%',
                    background:'radial-gradient(circle, rgba(110,70,230,0.38) 0%, rgba(130,80,240,0.16) 45%, transparent 70%)',
                    filter:'blur(40px)' }} />
            <div className="animate-ambient-drift-reverse absolute rounded-full pointer-events-none"
                style={{ width:'70vw', height:'70vw', bottom:'-18%', right:'-18%',
                    background:'radial-gradient(circle, rgba(60,100,240,0.30) 0%, rgba(80,140,255,0.12) 45%, transparent 70%)',
                    filter:'blur(50px)', animationDuration:'22s' }} />
            <div className="animate-ambient-drift absolute rounded-full pointer-events-none"
                style={{ width:'55vw', height:'55vw', top:'35%', right:'-10%',
                    background:'radial-gradient(circle, rgba(160,90,255,0.20) 0%, transparent 65%)',
                    filter:'blur(45px)', animationDuration:'18s', animationDelay:'-6s' }} />
        </>
    );

    /* ── Password change screen ── */
    if (mustChangePwd) {
        return (
            <div className="relative flex items-center justify-center w-full min-h-[100dvh] overflow-hidden"
                style={{ background:'radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%)' }}>
                <AmbientBG />
                <div className={`relative z-10 w-full max-w-[420px] mx-5 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-6 scale-[0.96]'}`}>
                    <div className="rounded-[2.5rem] p-8 bg-white/[0.22] backdrop-blur-[48px] backdrop-saturate-[200%] border border-white/[0.88] shadow-[0_32px_80px_rgba(0,0,0,0.12),inset_0_2px_0_rgba(255,255,255,0.95)] flex flex-col gap-6">
                        <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-[2.5rem]" />
                        <div className="relative flex flex-col items-center gap-3">
                            <div className="w-14 h-14 rounded-[1.25rem] bg-amber-400/10 border border-amber-300/40 flex items-center justify-center backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                                <Lock size={22} className="text-amber-500" strokeWidth={2} />
                            </div>
                            <h3 className="text-[22px] font-black text-slate-800 tracking-tight text-center">Cambia tu contraseña</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Primer acceso — establece una contraseña personal</p>
                        </div>
                        <form id="change-pwd-form" onSubmit={e => { e.preventDefault(); handleChangePassword(); }} className="relative flex flex-col gap-3">
                            {[
                                { ref: null, type:'password', placeholder:'Nueva contraseña (mín. 8 caracteres)', value: newPassword, onChange: e => { setNewPassword(e.target.value); setChangePassError(''); } },
                                { ref: null, type:'password', placeholder:'Confirmar contraseña', value: confirmPassword, onChange: e => { setConfirmPassword(e.target.value); setChangePassError(''); } },
                            ].map((f, i) => (
                                <div key={i} className="relative group flex items-center">
                                    <Lock size={15} strokeWidth={2.5} className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-10" />
                                    <input type={f.type} placeholder={f.placeholder} value={f.value} onChange={f.onChange}
                                        className="w-full pl-11 pr-4 py-3.5 bg-white/[0.35] hover:bg-white/[0.55] backdrop-blur-md border border-white/70 rounded-[1.25rem] text-[13px] font-bold text-slate-800 placeholder-slate-400 outline-none focus:bg-white/[0.70] focus:border-[#0052CC]/40 focus:ring-4 focus:ring-[#0052CC]/12 transition-all" />
                                </div>
                            ))}
                            {changePassError && (
                                <div className="px-4 py-2.5 bg-red-50/60 backdrop-blur-sm border border-red-200/80 rounded-[1rem] flex items-center gap-2">
                                    <AlertCircle size={14} className="text-red-500 shrink-0" strokeWidth={2.5} />
                                    <p className="text-[11px] font-black text-red-600">{changePassError}</p>
                                </div>
                            )}
                            <button type="submit" onClick={handleChangePassword}
                                disabled={changePassLoading || !newPassword || !confirmPassword}
                                className="relative overflow-hidden group w-full h-[52px] bg-gradient-to-b from-[#0052CC] to-[#003D99] text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[0_8px_24px_rgba(0,82,204,0.35)] hover:shadow-[0_14px_32px_rgba(0,82,204,0.50)] flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-60 disabled:shadow-none">
                                <span className="absolute inset-0 overflow-hidden rounded-[1.25rem] pointer-events-none">
                                    <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.18] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
                                </span>
                                {changePassLoading ? <Loader2 size={18} className="animate-spin" /> : 'Guardar contraseña'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    /* ── Input field shared style ── */
    const inputCls = "w-full bg-white/[0.28] hover:bg-white/[0.45] backdrop-blur-md border border-white/70 text-slate-800 placeholder-slate-400 outline-none focus:bg-white/[0.65] focus:border-[#0052CC]/45 focus:ring-4 focus:ring-[#0052CC]/14 transition-all font-bold";

    /* ── Tab switcher ── */
    const TabBar = () => (
        <div className="flex bg-white/[0.22] backdrop-blur-md border border-white/60 rounded-[2rem] p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.04)]">
            {[['code','Carné'],['username','Usuario']].map(([mode, label]) => (
                <button key={mode} type="button"
                    onClick={() => { handleStopScannerBtn(); setLoginMode(mode); setError(''); }}
                    className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest rounded-[1.5rem] transition-all duration-300 ${loginMode === mode ? 'bg-white text-[#0052CC] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                    {label}
                </button>
            ))}
        </div>
    );

    /* ── Scanner view ── */
    const ScannerView = () => (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300 flex flex-col gap-2">
            <div className="relative w-full rounded-[1.5rem] overflow-hidden bg-black border border-black/20" style={{ height: 220 }}>
                <style>{`@keyframes scan-line{0%{top:8%}50%{top:88%}100%{top:8%}}`}</style>
                <div style={{ position:'absolute', left:'5%', right:'5%', height:'2px', background:'rgba(0,82,204,0.9)', animation:'scan-line 2s ease-in-out infinite', zIndex:10, boxShadow:'0 0 12px rgba(0,82,204,0.75)' }} />
                {[{top:10,left:10,bt:'borderTop',bl:'borderLeft',br1:'4px 0 0 0'},{top:10,right:10,bt:'borderTop',bl:'borderRight',br1:'0 4px 0 0'},{bottom:10,left:10,bt:'borderBottom',bl:'borderLeft',br1:'0 0 0 4px'},{bottom:10,right:10,bt:'borderBottom',bl:'borderRight',br1:'0 0 4px 0'}].map((c,i) => (
                    <div key={i} style={{ position:'absolute', ...c, width:22, height:22, [c.bt]:'3px solid #0052CC', [c.bl]:'3px solid #0052CC', borderRadius:c.br1, zIndex:11 }} />
                ))}
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
            </div>
            <div className="flex items-center justify-center gap-2 px-3 py-2 bg-white/[0.18] backdrop-blur-sm rounded-[1rem]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#0052CC] animate-pulse shrink-0" />
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600 text-center">Apunta al código de barras de tu carné</p>
            </div>
        </div>
    );

    /* ── Scan feedback ── */
    const ScanFeedback = () => scanFeedback && (
        <div className={`p-3 rounded-2xl text-center animate-in zoom-in-95 duration-200 ${
            scanFeedback.status === 'error'   ? 'bg-red-50/60 border border-red-200' :
            scanFeedback.status === 'success' ? 'bg-emerald-50/60 border border-emerald-200' :
            'bg-[#0052CC]/5 border border-[#0052CC]/20'}`}>
            {scanFeedback.code && <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Código: <span className="font-bold">{scanFeedback.code}</span></p>}
            <p className={`text-[12px] font-bold flex items-center justify-center gap-1.5 ${
                scanFeedback.status === 'error'   ? 'text-red-600' :
                scanFeedback.status === 'success' ? 'text-emerald-600' : 'text-[#0052CC]'}`}>
                {scanFeedback.status === 'reading' && <Loader2 size={12} className="animate-spin" />}
                {scanFeedback.message}
            </p>
        </div>
    );

    /* ── Error pill ── */
    const ErrorPill = () => error && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300 px-4 py-3 bg-red-50/50 backdrop-blur-md border border-red-200/80 rounded-[1.25rem] flex items-center gap-3">
            <AlertCircle size={16} className="text-red-500 shrink-0" strokeWidth={2.5} />
            <p className="text-red-600 text-[10px] font-black uppercase tracking-widest">{error}</p>
        </div>
    );

    /* ── Submit button ── */
    const SubmitBtn = ({ label = 'Ingresar al Portal', height = 'h-[56px]' }) => (
        <button type="submit" disabled={isLoading}
            className={`relative overflow-hidden group w-full ${height} bg-gradient-to-b from-[#0052CC] to-[#003D99] text-white rounded-[1.5rem] font-black text-[13px] uppercase tracking-widest shadow-[0_8px_24px_rgba(0,82,204,0.35)] hover:shadow-[0_14px_36px_rgba(0,82,204,0.50)] flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-60 disabled:shadow-none`}>
            <span className="absolute inset-0 overflow-hidden rounded-[1.5rem] pointer-events-none">
                <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.18] to-transparent -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
            </span>
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : label}
        </button>
    );

    /* ── Code form ── */
    const CodeForm = ({ compact = false }) => (
        <div className="flex flex-col gap-3">
            <div className="relative group z-20 flex items-center gap-2">
                <div className="relative flex-1 flex items-center">
                    <ScanBarcode size={compact ? 18 : 22} strokeWidth={2}
                        className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-30" />
                    <input ref={inputRef} id="login-code" name="login-code" type="text"
                        placeholder="CÓDIGO" autoComplete="off" spellCheck="false"
                        className={`${inputCls} ${compact ? 'pl-11 pr-4 py-3 text-sm' : 'pl-14 pr-5 py-4 text-lg'} rounded-[1.5rem] tracking-[0.45em] uppercase [-webkit-text-security:disc]`} />
                </div>
                <button type="button"
                    onClick={() => {
                        if (scannerActive) { handleStopScannerBtn(); }
                        else { if (inputRef.current) inputRef.current.value = ''; setScanFeedback(null); cooldownRef.current = false; setScannerActive(true); }
                    }}
                    title={scannerActive ? 'Cerrar cámara' : 'Escanear carné'}
                    className={`shrink-0 ${compact ? 'w-[44px] h-[44px]' : 'w-[52px] h-[52px]'} flex items-center justify-center rounded-[1.25rem] border backdrop-blur-md transition-all active:scale-[0.97] ${
                        scannerActive ? 'bg-red-50/70 border-red-200/60 text-red-400' : 'bg-white/[0.35] border-white/70 text-slate-400 hover:bg-white/[0.70] hover:text-[#0052CC]'}`}>
                    {scannerActive ? <CameraOff size={compact ? 16 : 18} strokeWidth={2} /> : <Camera size={compact ? 16 : 18} strokeWidth={2} />}
                </button>
            </div>
            {scannerActive && <ScannerView />}
            <ScanFeedback />
        </div>
    );

    /* ── Username form ── */
    const UsernameForm = ({ compact = false }) => (
        <div className={`flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
            {[
                { ref: usernameRef, id:'username', type:'text', placeholder:'nombre.apellido', autoComplete:'username', Icon: UserIcon },
                { ref: userPasswordRef, id:'password', type:'password', placeholder:'Contraseña', autoComplete:'current-password', Icon: Lock },
            ].map(({ ref, id, type, placeholder, autoComplete, Icon }, i) => (
                <div key={i} className="relative group flex items-center">
                    <Icon size={compact ? 16 : 18} strokeWidth={2}
                        className="absolute left-4 text-slate-400 group-focus-within:text-[#0052CC] transition-colors pointer-events-none z-10" />
                    <input ref={ref} id={id} name={id} type={type} placeholder={placeholder} autoComplete={autoComplete}
                        className={`${inputCls} ${compact ? 'pl-11 pr-4 py-3 text-[13px]' : 'pl-12 pr-5 py-4 text-[14px]'} rounded-[1.5rem]`} />
                </div>
            ))}
        </div>
    );

    /* ── Kiosco button ── */
    const KioscoBtn = ({ compact = false }) => !isMobileOrApp() && (
        <button type="button" onClick={() => setView('timeclock')}
            className={`group w-full ${compact ? 'p-3' : 'p-4'} rounded-[1.75rem] bg-white/[0.20] backdrop-blur-md border border-white/70 flex items-center justify-between transition-all active:scale-[0.97] hover:bg-white/[0.38] hover:border-white/90 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]`}>
            <div className="flex items-center gap-3">
                <div className={`${compact ? 'w-9 h-9 rounded-[0.875rem]' : 'w-11 h-11 rounded-[1.1rem]'} bg-white/50 border border-white/80 flex items-center justify-center group-hover:bg-white transition-colors shadow-sm`}>
                    <Clock size={compact ? 16 : 20} className="text-slate-500 group-hover:text-[#0052CC] transition-colors" strokeWidth={2} />
                </div>
                <div className="text-left">
                    <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-black text-slate-700 uppercase tracking-widest`}>Terminal Kiosco</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.1em] mt-0.5">Marcar entrada / salida</p>
                </div>
            </div>
            <div className={`${compact ? 'w-7 h-7' : 'w-8 h-8'} rounded-full bg-white/60 border border-white/80 flex items-center justify-center group-hover:bg-[#0052CC] group-hover:border-transparent transition-all`}>
                <ChevronRight size={compact ? 13 : 15} className="text-slate-400 group-hover:text-white transition-colors" strokeWidth={3} />
            </div>
        </button>
    );

    /* ── Quick links ── */
    const QuickLinks = ({ vertical = false }) => (
        <div className={`flex ${vertical ? 'flex-col gap-2' : 'gap-2'}`}>
            {[
                { href:'https://clientesdte.oss.com.sv/farma_salud/dashboard.php', Icon: ShoppingCart, label:'Ventas', color:'#0052CC' },
                { href:'https://farmalasa.com', Icon: Pill, label:'FarmaLasa', color:'#6929C4' },
            ].map(({ href, Icon, label, color }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                    className="group flex items-center gap-2.5 px-4 py-2.5 bg-white/[0.25] hover:bg-white/[0.55] backdrop-blur-md border border-white/60 hover:border-white/90 rounded-[1.25rem] transition-all active:scale-[0.97] hover:shadow-sm">
                    <Icon size={15} strokeWidth={2} style={{ color }} className="transition-transform group-hover:scale-110" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 group-hover:text-slate-700 transition-colors">{label}</span>
                </a>
            ))}
        </div>
    );

    /* ═══════════════════════════════════════════
       MOBILE LAYOUT  (< 1024px) — single centered card
       ═══════════════════════════════════════════ */
    const MobileLayout = () => (
        <div className="flex flex-col items-center justify-between min-h-[100dvh] w-full px-5 py-8 gap-5">

            {/* Logo + brand at top */}
            <div className={`flex flex-col items-center gap-2 transition-all duration-700 delay-[100ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
                <div className="relative">
                    <div className="absolute -inset-3 rounded-[2rem] blur-xl opacity-40 bg-gradient-to-tr from-violet-500/60 to-blue-400/40" />
                    <div className="relative w-16 h-16 rounded-[1.5rem] bg-white/[0.55] backdrop-blur-xl border border-white/80 flex items-center justify-center shadow-[0_8px_24px_rgba(110,70,220,0.18),inset_0_2px_0_rgba(255,255,255,0.9)]">
                        <img src="/Logo192.png" alt="FarmaLasa" className="w-10 h-10 object-contain" />
                    </div>
                </div>
                <div className="text-center mt-1">
                    <p className="font-black text-[20px] text-slate-800 tracking-tight leading-none">Portal Farmalasa</p>
                    <p className="text-[9px] font-black text-[#0052CC]/70 uppercase tracking-[0.22em] mt-1">Sistema de Gestión</p>
                </div>
            </div>

            {/* Main glass card */}
            <div className={`relative w-full max-w-[420px] transition-all duration-700 delay-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.94] translate-y-5'}`}>
                <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-[2.5rem]" />
                <div className="rounded-[2.5rem] p-6 bg-white/[0.22] backdrop-blur-[48px] backdrop-saturate-[200%] border border-white/[0.85] shadow-[0_24px_60px_rgba(0,0,0,0.10),inset_0_2px_0_rgba(255,255,255,0.92)] flex flex-col gap-4">
                    <TabBar />
                    <form onSubmit={loginMode === 'username' ? handleUsernameLogin : handleLogin} className="flex flex-col gap-3">
                        {loginMode === 'code' ? <CodeForm compact /> : <UsernameForm compact />}
                        <ErrorPill />
                        <SubmitBtn height="h-[48px]" />
                    </form>
                    <div className="h-px bg-white/40 mx-2" />
                    <KioscoBtn compact />
                </div>
            </div>

            {/* Quick links at bottom */}
            <div className={`transition-all duration-700 delay-[280ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                <QuickLinks />
            </div>
        </div>
    );

    /* ═══════════════════════════════════════════
       DESKTOP LAYOUT  (>= 1024px) — centered card + right panel
       ═══════════════════════════════════════════ */
    const DesktopLayout = () => (
        <div className="flex items-center justify-center w-full min-h-[100dvh] px-8 py-12 gap-8">

            {/* Main card */}
            <div className={`relative w-full max-w-[480px] transition-all duration-700 delay-[100ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.93] translate-y-8'}`}>
                {/* Card glow */}
                <div className="absolute -inset-4 rounded-[3rem] blur-2xl opacity-20 bg-gradient-to-b from-violet-400 to-blue-400 pointer-events-none" />

                <div className="relative rounded-[3rem] px-10 py-10 bg-white/[0.20] backdrop-blur-[52px] backdrop-saturate-[200%] border border-white/[0.88] shadow-[0_40px_100px_rgba(0,0,0,0.13),inset_0_2px_0_rgba(255,255,255,0.95)] flex flex-col gap-6">
                    <div className="absolute inset-0 bg-gradient-to-b from-white/28 via-transparent to-transparent pointer-events-none rounded-[3rem]" />

                    {/* Logo */}
                    <div className={`relative flex flex-col items-center gap-3 transition-all duration-700 delay-[200ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'}`}>
                        <div className="relative group/logo">
                            <div className="absolute -inset-4 rounded-[2.5rem] blur-2xl opacity-35 group-hover/logo:opacity-65 transition-all duration-500 bg-gradient-to-tr from-violet-500/60 to-blue-400/40" />
                            <div className="relative w-24 h-24 rounded-[2rem] bg-white/[0.60] backdrop-blur-2xl border border-white/90 flex items-center justify-center shadow-[0_12px_40px_rgba(110,70,220,0.18),inset_0_2px_0_rgba(255,255,255,1)]" style={{ animation:'fls-logo-pulse 4s ease-in-out infinite' }}>
                                <img src="/Logo192.png" alt="FarmaLasa" className="w-16 h-16 object-contain" />
                            </div>
                        </div>
                        <div className="text-center">
                            <h1 className="text-[34px] font-black text-slate-800 tracking-tight leading-none">Portal</h1>
                            <p className="text-[10px] font-black text-[#0052CC]/75 uppercase tracking-[0.22em] mt-2">Farmacias La Popular & La Salud</p>
                        </div>
                    </div>

                    {/* Separator */}
                    <div className="relative h-px">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                    </div>

                    {/* Form */}
                    <div className={`relative flex flex-col gap-5 transition-all duration-700 delay-[300ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                        <TabBar />
                        <form onSubmit={loginMode === 'username' ? handleUsernameLogin : handleLogin} className="flex flex-col gap-4">
                            {loginMode === 'code' ? <CodeForm /> : <UsernameForm />}
                            <ErrorPill />
                            <SubmitBtn />
                        </form>
                    </div>

                    {/* Divider */}
                    <div className={`relative h-px transition-all duration-700 delay-[380ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                    </div>

                    {/* Kiosco */}
                    <div className={`relative transition-all duration-700 delay-[420ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
                        <KioscoBtn />
                    </div>
                </div>
            </div>

            {/* Right panel — quick links */}
            <div className={`hidden lg:flex flex-col gap-3 transition-all duration-700 delay-[350ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
                <div className="rounded-[2rem] p-4 bg-white/[0.18] backdrop-blur-[40px] backdrop-saturate-[200%] border border-white/[0.80] shadow-[0_20px_50px_rgba(0,0,0,0.09),inset_0_2px_0_rgba(255,255,255,0.90)] flex flex-col gap-3">
                    <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none rounded-[2rem]" />
                    <div className="relative flex items-center gap-2 px-1">
                        <Sparkles size={12} className="text-violet-400" strokeWidth={2} />
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Accesos rápidos</p>
                    </div>
                    <div className="relative flex flex-col gap-2">
                        {[
                            { href:'https://clientesdte.oss.com.sv/farma_salud/dashboard.php', Icon: ShoppingCart, label:'Sistema de Ventas', sub:'DTE · OSS', color:'#0052CC' },
                            { href:'https://farmalasa.com', Icon: Pill, label:'Farmalasa', sub:'Sitio web oficial', color:'#6929C4' },
                        ].map(({ href, Icon, label, sub, color }) => (
                            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                                className="group flex items-center gap-3 px-3 py-3 bg-white/[0.25] hover:bg-white/[0.55] backdrop-blur-md border border-white/60 hover:border-white/90 rounded-[1.25rem] transition-all active:scale-[0.97] hover:shadow-sm w-[200px]">
                                <div className="w-9 h-9 rounded-[0.875rem] flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                                    style={{ background: color + '15', border: `1px solid ${color}25` }}>
                                    <Icon size={16} strokeWidth={2} style={{ color }} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black text-slate-700 truncate">{label}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{sub}</p>
                                </div>
                                <ChevronRight size={12} className="text-slate-300 group-hover:text-slate-500 ml-auto shrink-0 transition-colors" strokeWidth={2.5} />
                            </a>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );

    /* ── Logo pulse keyframe (reuse splash animation) ── */
    const logoKeyframe = `@keyframes fls-logo-pulse{0%,100%{transform:scale(1);box-shadow:0 12px 40px rgba(110,70,220,0.18),inset 0 2px 0 rgba(255,255,255,1);}50%{transform:scale(1.04);box-shadow:0 20px 56px rgba(110,70,220,0.30),inset 0 2px 0 rgba(255,255,255,1);}}`;

    return (
        <div className="relative w-full min-h-[100dvh] overflow-hidden"
            style={{ background:'radial-gradient(ellipse at 38% 28%, #ded8ff 0%, #eae8ff 22%, #eef2ff 50%, #f3f4fb 100%)' }}>
            <style>{logoKeyframe}</style>
            <AmbientBG />

            {/* Floating glass particles */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {[
                    {s:16,t:'12%',l:'8%',d:'6.5s',dl:'0s'},
                    {s:10,t:'20%',l:'78%',d:'9s',dl:'1.2s'},
                    {s:20,t:'65%',l:'12%',d:'7.5s',dl:'2.5s'},
                    {s:12,t:'72%',l:'82%',d:'10s',dl:'0.7s'},
                    {s:8,t:'38%',l:'5%',d:'5.5s',dl:'3.2s'},
                    {s:14,t:'15%',l:'88%',d:'11s',dl:'1.8s'},
                    {s:22,t:'80%',l:'60%',d:'8.5s',dl:'4.0s'},
                ].map((p,i) => (
                    <div key={i} className="absolute rounded-full"
                        style={{
                            width:p.s, height:p.s, top:p.t, left:p.l,
                            background:'rgba(255,255,255,0.50)',
                            backdropFilter:'blur(8px)',
                            border:'1px solid rgba(255,255,255,0.88)',
                            boxShadow:'inset 0 1px 2px rgba(255,255,255,1)',
                            animation:`fls-f${i%2+1} ${p.d} ease-in-out ${p.dl} infinite`,
                        }} />
                ))}
                <style>{`
                    @keyframes fls-f1{0%,100%{transform:translate(0,0) scale(1);opacity:.60;}35%{transform:translate(10px,-18px) scale(1.16);opacity:1;}68%{transform:translate(-6px,-8px) scale(.88);opacity:.75;}}
                    @keyframes fls-f2{0%,100%{transform:translate(0,0) scale(1);opacity:.50;}42%{transform:translate(-12px,16px) scale(1.20);opacity:.90;}74%{transform:translate(8px,-10px) scale(.82);opacity:.70;}}
                `}</style>
            </div>

            <div className="relative z-10 w-full min-h-[100dvh]">
                {window.innerWidth < 1024 ? <MobileLayout /> : <DesktopLayout />}
            </div>
        </div>
    );
};

export default LoginView;
