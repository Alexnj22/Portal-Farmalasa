import React from 'react';
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
    setScanCode,
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

  const handleLogout = async () => {
    try {
      if (logout) await logout();
      setView('login');
    } catch (error) {
      console.error("Error al salir del kiosco:", error);
      setView('login');
    }
  };

  return (
    // Contenedor estricto: 100dvh evita el scroll en móviles
    <div className="h-[100dvh] w-full bg-[#0A0F1C] relative overflow-hidden font-sans flex flex-col selection:bg-blue-500/30">
      
      {/* Luces Ambientales súper sutiles para el efecto Glassmorphism */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[70vw] h-[70vw] max-w-[600px] max-h-[600px] bg-blue-600/10 rounded-full filter blur-[120px] opacity-60" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60vw] h-[60vw] max-w-[500px] max-h-[500px] bg-purple-600/5 rounded-full filter blur-[120px] opacity-60" />
      </div>

      {isRevokeModalOpen && (
        <ConfirmModal
          isOpen={isRevokeModalOpen}
          onClose={() => setIsRevokeModalOpen(false)}
          onConfirm={executeRevokeConfig}
          title="¿Desvincular Dispositivo?"
          message="Este dispositivo dejará de funcionar para marcar asistencia inmediatamente. Tendrás que volver a ingresar un PIN válido para reactivarlo."
          confirmText="Sí, desvincular"
        />
      )}

      {/* Botón de Salida Superior */}
      <button
        onClick={handleLogout}
        className="absolute top-[calc(env(safe-area-inset-top,16px)+16px)] right-[calc(env(safe-area-inset-right,16px)+16px)] text-white/50 hover:text-white transition-all duration-300 flex items-center justify-center gap-2 z-50 font-medium bg-white/5 border border-white/10 w-10 h-10 sm:w-auto sm:h-11 sm:px-5 rounded-full hover:bg-white/10 backdrop-blur-xl active:scale-95 shadow-sm"
        title="Salir del Kiosco"
      >
        <LogOut size={16} strokeWidth={2} /> 
        <span className="hidden sm:inline text-[10px] sm:text-xs uppercase tracking-widest">Salir</span>
      </button>

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
        />
      )}

      {/* Contenedor Principal Centrado */}
      <main className="relative z-10 flex-1 w-full flex flex-col items-center justify-center min-h-0 pb-[calc(env(safe-area-inset-bottom,16px)+16px)]">
        
        {/* 🚨 RELOJ SUTIL Y ELEGANTE (Verdadero estilo Lockscreen de iOS) */}
        <div className="flex flex-col items-center justify-center shrink-0 mb-4 sm:mb-8 animate-in slide-in-from-top-4 fade-in duration-700">
          <h2 className="text-white/50 font-light text-[3.5rem] sm:text-6xl md:text-[5.5rem] tracking-tight drop-shadow-md tabular-nums leading-none">
            {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
          </h2>
          <p className="text-white/40 text-[9px] sm:text-xs font-medium uppercase tracking-[0.3em] mt-2 sm:mt-3 drop-shadow-sm">
            {time.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {earlyExitData ? (
          <EarlyExitForm
            earlyExitData={earlyExitData}
            exitReason={exitReason}
            exitNotes={exitNotes}
            onChangeReason={setExitReason}
            onChangeNotes={setExitNotes}
            onSubmit={submitEarlyExit}
            onCancel={cancelAuth}
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
          />
        )}
      </main>
    </div>
  );
};

export default TimeClockView;