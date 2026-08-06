import React, { useEffect } from 'react';
import Button from '../common/Button';
import { ShieldAlert, XCircle, SkipForward } from 'lucide-react';

const SU_ROLES = ['JEFE', 'SUBJEFE'];

const formatTime = (dateObj) => {
  if (!dateObj) return '--:--';
  return new Date(dateObj).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true });
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
  clearHandler,
  skipPinHandler,
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
  const empRole = String(authPrompt.employee?.role || '').toUpperCase();
  const requiresSuPin = SU_ROLES.includes(empRole);

  const hasValue = scanCode && scanCode.length > 0;

  return (
    <div className="relative z-content w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-[var(--dur-lento)] pointer-events-auto overflow-hidden">
      
      <div className="w-full max-w-[420px] max-h-full flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-header p-5 sm:p-8 [@media(max-height:800px)]:p-4 shadow-[var(--shadow-glass-dark)] overflow-hidden transition-all duration-[var(--dur-lento)] hover:scale-[1.01] hover:translate-y-[var(--lift-card)] hover:bg-white/[0.04] hover:shadow-[var(--shadow-glass-5)] hover:border-white/20">

        {/* TOP */}
        <div className="flex flex-col items-center text-center w-full mb-5 sm:mb-6 [@media(max-height:800px)]:mb-2 shrink-0 group/icon">
          <div className="inline-flex p-4 [@media(max-height:800px)]:p-2 rounded-3xl mb-3 sm:mb-4 [@media(max-height:800px)]:mb-1.5 transition-all duration-300 border backdrop-blur-md bg-chart-4/10 border-chart-4/40 shadow-[var(--shadow-glow-chart-4-lg)] group-hover/icon:scale-105 group-hover/icon:-translate-y-1 group-hover/icon:shadow-[var(--shadow-glow-chart-4-lg)]">
            <ShieldAlert size={40} className="text-chart-4-text drop-shadow-[var(--shadow-glow-chart-4)] sm:w-12 sm:h-12 [@media(max-height:800px)]:!w-6 [@media(max-height:800px)]:!h-6" strokeWidth={1.5} />
          </div>
          <h1 className="text-2xl sm:text-3xl [@media(max-height:800px)]:text-lg font-semibold text-white tracking-tight leading-tight mb-1.5 [@media(max-height:800px)]:mb-0.5 transition-colors">
            {promptType === 'IN_AFTER_SHIFT' ? 'Turno Finalizado' : promptType === 'IN_EARLY' ? 'Entrada Anticipada' : promptType === 'OUT_LATE' ? 'Fuera de Tiempo' : promptType === 'IN_EARLY_EXTRA' ? 'Registrar Tiempo Extra' : 'Autorización Requerida'}
          </h1>
          <p className="text-micro sm:text-xs [@media(max-height:800px)]:text-micro font-bold uppercase tracking-[0.25em] text-chart-4-text/80 transition-colors px-2">
            {promptType === 'IN_AFTER_SHIFT' ? `Tu turno concluyó a las ${shiftEnd ? formatTime(shiftEnd) : '--:--'}` : promptType === 'IN_EARLY' ? `Tu turno inicia a las ${expectedIn ? formatTime(expectedIn) : '--:--'}` : promptType === 'OUT_LATE' && authPrompt.extraMins >= 25 ? `+${authPrompt.extraMins} min de tu salida oficial` : promptType === 'SPECIAL_OUT_REQUEST' ? `Permiso: ${employeeName}` : promptType === 'IN_EARLY_EXTRA' ? `Tiempo extra: ${employeeName}` : `Turno Extra: ${employeeName}`}
          </p>
          <p className="text-white/40 text-caption sm:text-xs [@media(max-height:800px)]:hidden leading-relaxed mt-2.5 px-2">
            {promptType === 'IN_AFTER_SHIFT' ? 'Requiere autorización para registrar entrada a esta hora.' : promptType === 'IN_EARLY' ? 'Puedes marcar normalmente 5 minutos antes.' : promptType === 'OUT_LATE' ? '¿El tiempo extra fue solicitado por administración?' : promptType === 'IN_EARLY_EXTRA' ? 'Autoriza para guardar la hora de llegada real (no ajustada).' : 'Solicite a su supervisor autorizar el movimiento.'}
          </p>
          {requiresSuPin && (
            <div className="mt-2.5 [@media(max-height:800px)]:mt-1 flex items-center justify-center gap-1.5 px-4 py-2 [@media(max-height:800px)]:py-1 rounded-2xl bg-chart-3/10 border border-chart-3/25">
              <ShieldAlert size={11} className="text-chart-3-text shrink-0" />
              <span className="text-micro sm:text-caption font-bold uppercase tracking-widest text-chart-3-text">Requiere código SU (6 dígitos)</span>
            </div>
          )}
        </div>

        {/* MIDDLE */}
        <form onSubmit={submitHandler} className="relative z-content w-full pointer-events-auto flex-1 flex flex-col justify-center min-h-0 shrink-0 py-2 sm:py-3 [@media(max-height:800px)]:py-1">

          <div className="relative w-full group/input cursor-text">
            {/* 🚨 INPUT BLINDADO */}
<input aria-label="Código de autorización"
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
  className="relative z-content pointer-events-auto w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center py-4 sm:py-5 [@media(max-height:800px)]:py-2.5 rounded-3xl shadow-[var(--shadow-shine-lg)] focus:bg-black/40 select-none
    /* 🚨 ESTABILIZACIÓN: Tamaño y espaciado fijo para el valor */
    text-2xl sm:text-4xl [@media(max-height:800px)]:!text-lg tracking-[0.5em] sm:tracking-[0.8em]
    /* 🚨 PLACEHOLDER: Estilo independiente para evitar saltos */
    placeholder:text-body-xl placeholder:sm:text-xs placeholder:tracking-[0.2em] placeholder:font-bold placeholder:uppercase placeholder:text-chart-4-text/60
    /* 🚨 CARET VIRTUAL: Oculta el cursor nativo y activa la animación del CSS */
    caret-transparent virtual-caret-orange"
/>
            
            {/* Botón Flotante Limpiar */}
            {hasValue && (
              <Button variant="ghost" icon={XCircle} title="Limpiar código" iconOnly onClick={clearHandler} />
            )}

            <div className="absolute inset-0 z-base rounded-3xl opacity-0 transition-opacity duration-[var(--dur-lento)] pointer-events-none shadow-[var(--shadow-glow-chart-4-lg)] group-focus-within/input:opacity-100" />
          </div>

          <div className="mt-5 sm:mt-6 [@media(max-height:800px)]:mt-2.5 flex flex-col items-center justify-center gap-3 [@media(max-height:800px)]:gap-1.5 w-full">

            {promptType === 'OUT_LATE' && (
              <Button variant="secondary" onClick={forceNormalOutHandler}>No, guardar según horario</Button>
            )}
            {skipPinHandler && (
              <Button tone="warning" icon={SkipForward} onClick={skipPinHandler}>Omitir PIN — Notificar a TH</Button>
            )}
            <Button variant="destructive" icon={XCircle} onClick={cancelHandler}>Cancelar / Atrás</Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export { AuthPromptPanel };
export default AuthPromptPanel;