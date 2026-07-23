import React, { useCallback, useEffect, useMemo } from 'react';
import { LogOut } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useTimeClockEngine } from '../hooks/useTimeClockEngine';

import ConfirmModal from '../components/common/ConfirmModal';
import OfflineBanner from '../components/common/OfflineBanner';
import FeedbackOverlay from '../components/timeclock/FeedbackOverlay';
import AuthPromptPanel from '../components/timeclock/AuthPromptPanel';
import EarlyExitForm from '../components/timeclock/EarlyExitForm';
import KioskConfigModal from '../components/timeclock/KioskConfigModal';
import IdleScanPanel from '../components/timeclock/IdleScanPanel';
import SelfDeclareShiftPanel from '../components/timeclock/SelfDeclareShiftPanel';

const TimeClockView = ({ setView }) => {
  const { logout } = useAuth();

  const {
    scanCode,
    setScanCode,
    feedback,
    authPrompt,
    specialMode,
    isProcessing,
    isConfiguring,
    selectedBranchId,
    deviceNameInput,
    isRevokeModalOpen,
    earlyExitData,
    exitReason,
    exitNotes,
    inputRef,
    time,
    branches,
    lunchAlerts,
    setSelectedBranchId,
    setDeviceNameInput,
    setIsRevokeModalOpen,
    setExitReason,
    setExitNotes,
    handleKeyDown,
    handleInputChange,
    handleScan,
    handleSaveConfig,
    handleRevokeConfig,
    executeRevokeConfig,
    cancelAuth,
    requestSpecialOut,
    submitEarlyExit,
    handleForceNormalOut,
    closeFeedback,
    handleAnnouncementRead,
    handleEarlyExtraRequest,
    handleSkipPin,
    selfDeclareData,
    submitSelfDeclare,
    cancelSelfDeclare,
  } = useTimeClockEngine();

  // Read device & branch from localStorage kiosk_config
  const kioskLabel = useMemo(() => {
    try {
      const raw = localStorage.getItem('kiosk_config');
      if (!raw) return null;
      const cfg = JSON.parse(raw);
      const parts = [];
      if (cfg.deviceName) parts.push(cfg.deviceName);
      if (cfg.branchName) parts.push(cfg.branchName);
      return parts.join('  ·  ') || null;
    } catch {
      return null;
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      if (logout) await logout();
      setView('login');
    } catch {
      setView('login');
    }
  }, [logout, setView]);

  // Dark theme-color for iOS Safari chrome (Dynamic Island + nav bar)
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.content;
    if (meta) meta.content = '#060B18';
    return () => { if (meta && prev) meta.content = prev; };
  }, []);

  // Este kiosco es una pantalla siempre-oscura, independiente del tema real
  // del portal (igual que LoginView) — pero a diferencia de LoginView, SÍ
  // vive dentro del árbol de ThemeProvider (usa LiquidSelect/ConfirmModal,
  // que leen tokens vía [data-theme] en <html>). Forzamos data-theme="dark"
  // en <html> mientras esta vista está montada para que esos componentes —
  // incluido lo que renderizan vía portal a document.body, como el dropdown
  // de LiquidSelect — hereden los tokens oscuros correctos sin importar el
  // tema elegido por el usuario, restaurando el valor real al desmontar.
  useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    return () => {
      if (prevTheme) root.setAttribute('data-theme', prevTheme);
      else root.removeAttribute('data-theme');
    };
  }, []);

  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        if (feedback)           { closeFeedback();              return; }
        if (isRevokeModalOpen)  { setIsRevokeModalOpen(false); return; }
        if (selfDeclareData)    { cancelSelfDeclare();          return; }
        if (isConfiguring || earlyExitData || authPrompt || specialMode) { cancelAuth(); return; }
        if (scanCode?.length)   { setScanCode('');              return; }
        handleLogout();
      }
    };
    window.addEventListener('keydown', handleEscKey);
    return () => window.removeEventListener('keydown', handleEscKey);
  }, [
    feedback, isRevokeModalOpen, isConfiguring, earlyExitData, selfDeclareData,
    authPrompt, specialMode, scanCode, closeFeedback,
    setIsRevokeModalOpen, cancelAuth, setScanCode, handleLogout, cancelSelfDeclare,
  ]);

  const now = time || new Date();
  const timeStr  = now.toLocaleTimeString('en-US',  { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateStr  = now.toLocaleDateString('es-SV',  { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="min-h-[100dvh] w-full bg-[#060B18] relative overflow-y-auto overflow-x-hidden font-sans flex flex-col selection:bg-blue-500/30">

      {/* ── Animated Ambient Orbs ─────────────────────────────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Primary blue — top-left, drifts forward */}
        <div
          className="animate-ambient-drift absolute -top-[20%] -left-[15%] w-[85vw] h-[85vw] max-w-[780px] max-h-[780px] rounded-full"
          style={{ background: 'radial-gradient(circle at 40% 40%, rgba(37,99,235,0.22) 0%, transparent 68%)', filter: 'blur(72px)' }}
        />
        {/* Purple — bottom-right, drifts reverse */}
        <div
          className="animate-ambient-drift-reverse absolute -bottom-[25%] -right-[20%] w-[75vw] h-[75vw] max-w-[680px] max-h-[680px] rounded-full"
          style={{ background: 'radial-gradient(circle at 60% 60%, rgba(109,40,217,0.16) 0%, transparent 70%)', filter: 'blur(90px)' }}
        />
        {/* Cyan accent — top-right */}
        <div
          className="absolute top-[8%] right-[2%] w-[45vw] h-[45vw] max-w-[420px] max-h-[420px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.09) 0%, transparent 72%)', filter: 'blur(64px)', animation: 'ambientDrift 24s ease-in-out infinite reverse' }}
        />
        {/* Subtle center vignette glow */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-blue-950/20 to-transparent" />
      </div>

      {/* 7B.8: el kiosco no daba ningún aviso de conectividad — solo estaba
          montado en AppLayout.jsx (dashboard normal), nunca acá. */}
      <OfflineBanner />

      {/* ── Modals ────────────────────────────────────────────────── */}
      {isRevokeModalOpen && (
        <ConfirmModal
          isOpen={isRevokeModalOpen}
          onClose={() => setIsRevokeModalOpen(false)}
          onConfirm={executeRevokeConfig}
          title="¿Desvincular Dispositivo?"
          message="Este dispositivo dejará de funcionar para marcar asistencia inmediatamente."
          confirmText="Sí, desvincular"
        />
      )}

      {isConfiguring && (
        <KioskConfigModal
          isOpen={isConfiguring}
          kioskConfig={typeof window !== 'undefined' ? localStorage.getItem('kiosk_config') : null}
          branches={branches}
          selectedBranchId={selectedBranchId}
          deviceNameInput={deviceNameInput}
          isProcessing={isProcessing}
          onChangeBranch={setSelectedBranchId}
          onChangeDeviceName={setDeviceNameInput}
          onSave={handleSaveConfig}
          onRevoke={handleRevokeConfig}
          onClose={cancelAuth}
        />
      )}

      {feedback && (
        <FeedbackOverlay
          feedback={feedback}
          onClose={closeFeedback}
          onAnnouncementRead={handleAnnouncementRead}
          onEarlyExtra={handleEarlyExtraRequest}
        />
      )}

      {/* ── Exit button ───────────────────────────────────────────── */}
      <button
        onClick={handleLogout}
        className="fixed top-[max(env(safe-area-inset-top,16px),16px)] right-[max(env(safe-area-inset-right,16px),16px)] z-50
          flex items-center justify-center gap-2
          w-10 h-10 sm:w-auto sm:h-10 sm:px-4
          text-white/40 hover:text-white/90
          bg-white/[0.06] hover:bg-white/[0.12]
          border border-white/[0.10] hover:border-white/[0.22]
          rounded-full backdrop-blur-xl
          shadow-[0_4px_16px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]
          hover:shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.10)]
          transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 active:scale-[0.97]
          cursor-pointer"
        title="Salir del Kiosco (Esc)"
      >
        <LogOut size={15} strokeWidth={2} />
        <span className="hidden sm:inline text-[10px] uppercase tracking-widest font-semibold">Salir</span>
      </button>

      {/* ── Main content ──────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 w-full flex flex-col items-center px-4 py-20 sm:py-24">
        <div className="w-full max-w-[420px] my-auto flex flex-col items-center gap-5 sm:gap-6">

          {/* Logo */}
          <div className="animate-view-enter flex flex-col items-center gap-2">
            <img
              src="/Logo192.png"
              alt="Farmalasa"
              className="w-12 h-12 object-contain opacity-80 drop-shadow-[0_0_24px_rgba(147,197,253,0.35)]"
              draggable="false"
            />
            <span className="text-[9px] font-bold uppercase tracking-[0.32em] text-white/30">
              Farmacias La Salud &amp; Popular
            </span>
          </div>

          {/* Clock card */}
          <div
            className="animate-view-enter w-full flex flex-col items-center justify-center relative overflow-hidden
              bg-gradient-to-b from-blue-950/[0.30] to-white/[0.02]
              backdrop-blur-[60px] backdrop-saturate-[160%]
              border border-white/[0.10]
              rounded-[2.5rem] px-5 py-7
              shadow-[0_32px_72px_rgba(0,0,0,0.45),inset_0_2px_0_rgba(255,255,255,0.07),0_0_0_1px_rgba(255,255,255,0.03)]
              transition-all duration-500 hover:border-white/[0.16] hover:-translate-y-1
              hover:shadow-[0_40px_80px_rgba(0,0,0,0.55),inset_0_2px_0_rgba(255,255,255,0.09)]"
            style={{ animationDelay: '60ms' }}
          >
            {/* Top highlight */}
            <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
            {/* Blue ambient wash */}
            <div className="absolute inset-0 bg-gradient-to-b from-blue-400/[0.04] via-transparent to-transparent pointer-events-none" />

            {/* Time */}
            <h2 className="relative text-white/[0.92] font-extralight tabular-nums leading-none w-full text-center whitespace-nowrap
              text-[3rem] sm:text-[3.5rem] tracking-tight
              drop-shadow-[0_0_40px_rgba(147,197,253,0.22)]">
              {timeStr}
            </h2>

            {/* Date */}
            <p className="relative text-white/40 text-[10px] font-bold uppercase tracking-[0.32em] mt-3 w-full text-center truncate px-2 capitalize">
              {dateStr}
            </p>

            {/* Device label */}
            {kioskLabel && (
              <p className="relative text-white/20 text-[9px] font-semibold uppercase tracking-[0.22em] mt-2 w-full text-center truncate px-4">
                {kioskLabel}
              </p>
            )}

            {/* Bottom shimmer line */}
            <div className="absolute inset-x-10 bottom-0 h-px bg-gradient-to-r from-transparent via-blue-400/12 to-transparent" />
          </div>

          {/* Scan / auth panels */}
          <div className="w-full" style={{ animation: 'viewEnter 280ms var(--ease-spring) 120ms both' }}>
            {selfDeclareData ? (
              <SelfDeclareShiftPanel
                employee={selfDeclareData.employee}
                onSubmit={submitSelfDeclare}
              />
            ) : earlyExitData ? (
              <EarlyExitForm
                earlyExitData={earlyExitData}
                exitReason={exitReason}
                exitNotes={exitNotes}
                onChangeReason={setExitReason}
                onChangeNotes={setExitNotes}
                onSubmit={submitEarlyExit}
                onCancel={cancelAuth}
                isProcessing={isProcessing}
              />
            ) : authPrompt ? (
              <AuthPromptPanel
                authPrompt={authPrompt}
                scanCode={scanCode}
                inputRef={inputRef}
                submitHandler={handleScan}
                keyDownHandler={handleKeyDown}
                inputChangeHandler={handleInputChange}
                cancelHandler={cancelAuth}
                forceNormalOutHandler={handleForceNormalOut}
                clearHandler={() => setScanCode('')}
                skipPinHandler={handleSkipPin}
              />
            ) : (
              <IdleScanPanel
                specialMode={specialMode}
                scanCode={scanCode}
                inputRef={inputRef}
                submitHandler={handleScan}
                keyDownHandler={handleKeyDown}
                inputChangeHandler={handleInputChange}
                cancelSpecialModeHandler={cancelAuth}
                specialOutHandler={requestSpecialOut}
                clearHandler={() => setScanCode('')}
                lunchAlerts={lunchAlerts}
              />
            )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default TimeClockView;
