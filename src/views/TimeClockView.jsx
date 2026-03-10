import React, { useCallback, useEffect } from 'react';
import { LogOut } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { useTimeClockEngine } from '../hooks/useTimeClockEngine';

import ConfirmModal from '../components/common/ConfirmModal';
import FeedbackOverlay from '../components/timeclock/FeedbackOverlay';
import AuthPromptPanel from '../components/timeclock/AuthPromptPanel';
import EarlyExitForm from '../components/timeclock/EarlyExitForm';
import KioskConfigModal from '../components/timeclock/KioskConfigModal';
import IdleScanPanel from '../components/timeclock/IdleScanPanel';

const TimeClockView = ({ setView }) => {
  const { logout } = useAuth();

  const {
    // state
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

    // setters
    setSelectedBranchId,
    setDeviceNameInput,
    setIsRevokeModalOpen,
    setExitReason,
    setExitNotes,

    // actions
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
  } = useTimeClockEngine();

  const handleLogout = useCallback(async () => {
    try {
      if (logout) await logout();
      setView('login');
    } catch (error) {
      console.error("Error al salir del kiosco:", error);
      setView('login');
    }
  }, [logout, setView]);

  // ESCAPE CONTEXTUAL: Actúa como "Atrás/Cancelar/Borrar"
  useEffect(() => {
    const handleEscKey = (e) => {
      if (e.key === 'Escape') {
        if (feedback) {
          closeFeedback();
          return;
        }
        if (isRevokeModalOpen) {
          setIsRevokeModalOpen(false);
          return;
        }
        if (isConfiguring || earlyExitData || authPrompt || specialMode) {
          cancelAuth();
          return;
        }
        if (scanCode && scanCode.length > 0) {
          setScanCode('');
          return;
        }
        handleLogout();
      }
    };
    window.addEventListener('keydown', handleEscKey);
    return () => window.removeEventListener('keydown', handleEscKey);
  }, [
    feedback, isRevokeModalOpen, isConfiguring, earlyExitData, 
    authPrompt, specialMode, scanCode, closeFeedback, 
    setIsRevokeModalOpen, cancelAuth, setScanCode, handleLogout
  ]);

 return (
    // 🚨 1. LIBERACIÓN DE SCROLL: min-h-[100dvh] y overflow-y-auto
    <div className="min-h-[100dvh] w-full bg-[#0A0F1C] relative overflow-y-auto overflow-x-hidden font-sans flex flex-col selection:bg-blue-500/30">
      
      {/* Luces Ambientales */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[70vw] h-[70vw] max-w-[600px] max-h-[600px] bg-blue-600/10 rounded-full filter blur-[120px] opacity-60" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60vw] h-[60vw] max-w-[500px] max-h-[500px] bg-purple-600/5 rounded-full filter blur-[120px] opacity-60" />
      </div>

      {isRevokeModalOpen && (
        <ConfirmModal 
            isOpen={isRevokeModalOpen} 
            onClose={() => setIsRevokeModalOpen(false)} 
            onConfirm={executeRevokeConfig} 
            title="¿Desvincular Dispositivo?" 
            message="Este dispositivo dejará de funcionar para marcar asistencia inmediatamente." 
            confirmText="Sí, desvincular" 
            theme="dark"
        />      
      )}

      {/* Botón Salir */}
      <button 
        onClick={handleLogout} 
        className="fixed top-[max(env(safe-area-inset-top,16px),16px)] right-[max(env(safe-area-inset-right,16px),16px)] text-white/50 hover:text-white flex items-center justify-center gap-2 z-50 font-medium bg-white/5 border border-white/10 w-10 h-10 sm:w-auto sm:h-11 sm:px-5 rounded-full backdrop-blur-xl active:scale-95 transition-all duration-500 hover:scale-105 hover:-translate-y-0.5 hover:bg-white/10 hover:border-white/20 hover:shadow-[0_10px_20px_rgba(0,0,0,0.3),inset_0_1px_5px_rgba(255,255,255,0.05)] cursor-pointer" 
        title="Salir del Kiosco (Esc)"
      >
        <LogOut size={16} strokeWidth={2} /> 
        <span className="hidden sm:inline text-[10px] sm:text-xs uppercase tracking-widest">Salir</span>
      </button>

      {isConfiguring && <KioskConfigModal isOpen={isConfiguring} kioskConfig={typeof window !== 'undefined' ? localStorage.getItem('kiosk_config') : null} branches={branches} selectedBranchId={selectedBranchId} deviceNameInput={deviceNameInput} isProcessing={isProcessing} onChangeBranch={setSelectedBranchId} onChangeDeviceName={setDeviceNameInput} onSave={handleSaveConfig} onRevoke={handleRevokeConfig} onClose={cancelAuth} />}
      
      {feedback && <FeedbackOverlay feedback={feedback} onClose={closeFeedback} onAnnouncementRead={handleAnnouncementRead} />}

      {/* 🚨 2. CONTENEDOR FLEXIBLE: Eliminado justify-center estricto, usamos py para dar margen y centramos el contenido interno. */}
      <main className="relative z-10 flex-1 w-full flex flex-col items-center px-4 py-20 sm:py-24">
        
        {/* 🚨 3. ENVOLTORIO DE CONTENIDO: my-auto centra si hay espacio, pero no corta si falta espacio */}
        <div className="w-full max-w-[420px] my-auto flex flex-col items-center gap-4 sm:gap-6">
            
            {/* RELOJ */}
            <div className="w-full flex flex-col items-center justify-center bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] px-4 py-6 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] transition-all duration-500 hover:scale-[1.01] hover:-translate-y-1 hover:bg-white/[0.04] hover:border-white/20 hover:shadow-[0_30px_60px_rgba(0,0,0,0.4),inset_0_2px_15px_rgba(255,255,255,0.05)] cursor-default animate-in slide-in-from-top-4 fade-in duration-700">
              <h2 className="text-white/80 font-light text-[2.5rem] sm:text-[3rem] md:text-[3.25rem] tracking-tight drop-shadow-md tabular-nums leading-none w-full text-center whitespace-nowrap">
                {(time || new Date()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
              </h2>
              <p className="text-white/40 text-[9px] sm:text-[11px] font-bold uppercase tracking-[0.3em] mt-3 drop-shadow-sm transition-colors group-hover:text-white/60 w-full text-center truncate px-2">
                {(time || new Date()).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>

            {/* PANELES INFERIORES */}
            <div className="w-full animate-in slide-in-from-bottom-4 fade-in duration-700">
                {earlyExitData ? (
                <EarlyExitForm earlyExitData={earlyExitData} exitReason={exitReason} exitNotes={exitNotes} onChangeReason={setExitReason} onChangeNotes={setExitNotes} onSubmit={submitEarlyExit} onCancel={cancelAuth} isProcessing={isProcessing} />
                ) : authPrompt ? (
                <AuthPromptPanel authPrompt={authPrompt} scanCode={scanCode} inputRef={inputRef} submitHandler={handleScan} keyDownHandler={handleKeyDown} inputChangeHandler={handleInputChange} cancelHandler={cancelAuth} forceNormalOutHandler={handleForceNormalOut} clearHandler={() => setScanCode('')} />
                ) : (
                <IdleScanPanel specialMode={specialMode} scanCode={scanCode} inputRef={inputRef} submitHandler={handleScan} keyDownHandler={handleKeyDown} inputChangeHandler={handleInputChange} cancelSpecialModeHandler={cancelAuth} specialOutHandler={requestSpecialOut} clearHandler={() => setScanCode('')} />
                )}
            </div>

        </div>
      </main>
    </div>
  );
};

export default TimeClockView;