import React, { useEffect } from 'react';
import { ShieldAlert, XCircle } from 'lucide-react';

const formatTime = (dateObj) => {
  if (!dateObj) return '--:--';
  return new Date(dateObj).toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const AuthPromptPanel = ({
  authPrompt,
  scanCode,
  inputRef,
  submitHandler,
  keyDownHandler,
  inputChangeHandler,
  cancelHandler,
  forceNormalOutHandler,
  clearHandler
}) => {
  
  // 🚨 SEGURIDAD: Limpiamos el input sin exponerlo al DOM
  useEffect(() => {
    if ((!scanCode || scanCode.length === 0) && inputRef.current) {
      inputRef.current.value = '';
    }
  }, [scanCode, inputRef]);

  if (!authPrompt) return null;

  const promptType = authPrompt.type;
  const employeeName = authPrompt.employee?.name || 'Empleado';
  const shiftEnd = authPrompt.customConfig?.shiftEndD;
  const expectedIn = authPrompt.customConfig?.expectedIn;

  const hasValue = scanCode && scanCode.length > 0;

  return (
    <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500 pointer-events-auto overflow-hidden">
      
      <div className="w-full max-w-[420px] max-h-full flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-5 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] overflow-hidden transition-all duration-500 hover:scale-[1.01] hover:-translate-y-1 hover:bg-white/[0.04] hover:shadow-[0_30px_60px_rgba(0,0,0,0.4),inset_0_2px_15px_rgba(255,255,255,0.05)] hover:border-white/20">
        
        {/* TOP */}
        <div className="flex flex-col items-center text-center w-full mb-5 sm:mb-6 shrink-0 group/icon">
          <div className="inline-flex p-4 rounded-[1.5rem] mb-3 sm:mb-4 transition-all duration-300 border backdrop-blur-md bg-orange-500/10 border-orange-500/40 shadow-[0_0_40px_rgba(249,115,22,0.15)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[0_0_50px_rgba(249,115,22,0.3)]">
            <ShieldAlert size={42} className="text-orange-400 drop-shadow-[0_2px_10px_rgba(249,115,22,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5 transition-colors">
            {promptType === 'IN_AFTER_SHIFT' ? 'Turno Finalizado' : promptType === 'IN_EARLY' ? 'Entrada Anticipada' : promptType === 'OUT_LATE' ? 'Fuera de Tiempo' : 'Autorización Requerida'}
          </h1>
          <p className="text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] text-orange-400/80 transition-colors px-2">
            {promptType === 'IN_AFTER_SHIFT' ? `Tu turno concluyó a las ${shiftEnd ? formatTime(shiftEnd) : '--:--'}` : promptType === 'IN_EARLY' ? `Tu turno inicia a las ${expectedIn ? formatTime(expectedIn) : '--:--'}` : promptType === 'OUT_LATE' && authPrompt.extraMins >= 25 ? `+${authPrompt.extraMins} min de tu salida oficial` : promptType === 'SPECIAL_OUT_REQUEST' ? `Permiso: ${employeeName}` : `Turno Extra: ${employeeName}`}
          </p>
          <p className="text-white/40 text-[10px] sm:text-xs leading-relaxed mt-2.5 px-2">
            {promptType === 'IN_AFTER_SHIFT' ? 'Requiere autorización para registrar entrada a esta hora.' : promptType === 'IN_EARLY' ? 'Puedes marcar normalmente 5 minutos antes.' : promptType === 'OUT_LATE' ? '¿El tiempo extra fue solicitado por administración?' : 'Solicite a su supervisor autorizar el movimiento.'}
          </p>
        </div>

        {/* MIDDLE */}
        <form onSubmit={submitHandler} className="relative z-20 w-full pointer-events-auto flex-1 flex flex-col justify-center min-h-0 shrink-0 py-2 sm:py-3">
          
          <div className="relative w-full group/input cursor-text">
            {/* 🚨 INPUT BLINDADO */}
<input
  ref={inputRef}
  type="password"
  onChange={inputChangeHandler}
  onKeyDown={keyDownHandler}
  onContextMenu={(e) => e.preventDefault()} 
  onCopy={(e) => e.preventDefault()} 
  onPaste={(e) => e.preventDefault()} 
  onCut={(e) => e.preventDefault()}
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => e.preventDefault()}
  autoComplete="new-password"
  spellCheck="false"
  placeholder={promptType === 'OUT_LATE' ? 'PIN PARA HORAS EXTRAS' : 'PIN DE SUPERVISOR'}
  className="relative z-20 pointer-events-auto w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center py-4 sm:py-5 rounded-3xl shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] focus:bg-black/40 select-none
    /* 🚨 ESTABILIZACIÓN: Tamaño y espaciado fijo para el valor */
    text-2xl sm:text-4xl tracking-[0.5em] sm:tracking-[0.8em]
    /* 🚨 PLACEHOLDER: Estilo independiente para evitar saltos */
    placeholder:text-[10px] placeholder:sm:text-xs placeholder:tracking-[0.2em] placeholder:font-bold placeholder:uppercase placeholder:text-orange-400/60
    /* 🚨 CARET VIRTUAL: Oculta el cursor nativo y activa la animación del CSS */
    caret-transparent virtual-caret-orange focus:outline-none"
/>
            
            {/* Botón Flotante Limpiar */}
            {hasValue && (
              <button
                type="button"
                onClick={clearHandler}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-40 p-2 text-white/20 hover:text-white/80 transition-all duration-300 hover:scale-110 active:scale-95"
                title="Limpiar código"
              >
                <XCircle size={22} strokeWidth={2} />
              </button>
            )}

            <div className="absolute inset-0 z-10 rounded-3xl opacity-0 transition-opacity duration-500 pointer-events-none shadow-[0_0_20px_rgba(249,115,22,0.2)] group-focus-within/input:opacity-100" />
          </div>

          <div className="mt-5 sm:mt-6 flex flex-col items-center justify-center gap-3 w-full">

            {promptType === 'OUT_LATE' && (
              <button type="button" onClick={forceNormalOutHandler} className="relative z-20 pointer-events-auto text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-slate-300 flex items-center justify-center w-full gap-2 transition-all duration-300 bg-white/5 px-5 py-3.5 rounded-full border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white active:scale-95">
                No, guardar según horario
              </button>
            )}
            <button type="button" onClick={cancelHandler} className="relative z-20 pointer-events-auto text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-red-400 flex items-center justify-center w-full gap-2 transition-all duration-300 bg-red-500/10 px-5 py-3.5 rounded-full border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:-translate-y-0.5 active:scale-95">
              <XCircle size={14} /> Cancelar / Atrás
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export { AuthPromptPanel };
export default AuthPromptPanel;