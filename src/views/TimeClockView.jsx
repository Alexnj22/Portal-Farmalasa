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
    <div className="min-h-screen w-full bg-[#0B1121] flex flex-col items-center justify-start pt-32 p-8 relative overflow-hidden font-sans">
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

      <button
        onClick={handleLogout}
        className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors flex items-center gap-2 z-50 font-bold bg-white/5 border border-white/10 px-5 py-2.5 rounded-xl hover:bg-white/10 backdrop-blur-sm"
      >
        <LogOut size={18} /> Salir del Kiosco
      </button>

      <div className="absolute top-6 md:top-10 left-1/2 -translate-x-1/2 text-white/5 font-black text-[7rem] md:text-[11rem] tracking-tighter pointer-events-none select-none whitespace-nowrap z-0">
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>

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
      <div className="max-w-2xl w-full text-center relative z-10 flex flex-col items-center mt-32 md:mt-48">
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
      </div>
    </div>
  );
};

export default TimeClockView;