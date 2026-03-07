import React from 'react';
import { ShieldAlert, XCircle } from 'lucide-react';

// Añadimos esta función segura localmente para evitar que la app 
// explote si format12hNoSeconds no se pasó como prop o no se importó.
const formatTime = (dateObj) => {
  if (!dateObj) return '--:--';
  return new Date(dateObj).toLocaleTimeString('es-ES', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const AuthPromptPanel = ({
  authPrompt,
  scanCode,
  inputRef,
  // 🚨 Props corregidos para que coincidan exactamente con lo que envía TimeClockView
  submitHandler,
  keyDownHandler,
  inputChangeHandler,
  cancelHandler,
  forceNormalOutHandler
}) => {
  if (!authPrompt) return null;

  const promptType = authPrompt.type;
  const employeeName = authPrompt.employee?.name || 'Empleado';
  const shiftEnd = authPrompt.customConfig?.shiftEndD;
  const expectedIn = authPrompt.customConfig?.expectedIn;

  return (
    <div className="animate-in fade-in zoom-in duration-300 w-full">
      <div className="inline-flex p-5 bg-purple-600 rounded-full mb-6 shadow-[0_0_40px_rgba(147,51,234,0.4)] animate-pulse">
        <ShieldAlert size={64} className="text-white" />
      </div>

      {promptType === 'IN_AFTER_SHIFT' ? (
        <>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">
            Turno Finalizado
          </h1>
          <p className="text-orange-400 text-sm md:text-md mb-2 font-black uppercase tracking-[0.1em]">
            Tu turno concluyó a las {shiftEnd ? formatTime(shiftEnd) : '--:--'}.
          </p>
          <p className="text-slate-400 text-xs mb-8">
            Requiere autorización para registrar entrada a esta hora.
          </p>
        </>
      ) : promptType === 'IN_EARLY' ? (
        <>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">
            Entrada Anticipada
          </h1>
          <p className="text-orange-400 text-sm md:text-md mb-2 font-black uppercase tracking-[0.1em]">
            Tu turno inicia a las {expectedIn ? formatTime(expectedIn) : '--:--'}.
          </p>
          <p className="text-slate-400 text-xs mb-8">
            Puedes marcar normalmente 5 minutos antes.
          </p>
        </>
      ) : promptType === 'OUT_LATE' ? (
        <>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">
            Salida Fuera de Tiempo
          </h1>

          {authPrompt.extraMins >= 25 && (
            <p className="text-orange-400 text-sm md:text-md mb-2 font-black uppercase tracking-[0.1em]">
              Han pasado {authPrompt.extraMins} min de tu salida oficial ({shiftEnd ? formatTime(shiftEnd) : '--:--'}).
            </p>
          )}

          <p className="text-slate-300 text-xs mb-6 max-w-sm mx-auto leading-relaxed">
            ¿Este tiempo extra fue solicitado por administración? Solicita el PIN para autorizarlo.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">
            Autorización Requerida
          </h1>
          <p className="text-purple-400 text-sm md:text-md mb-8 font-black uppercase tracking-[0.1em]">
            {promptType === 'SPECIAL_OUT_REQUEST'
              ? `Permiso para: ${employeeName}`
              : `Turno Extra: ${employeeName}`}
          </p>
        </>
      )}

      <form onSubmit={submitHandler} className="w-full max-w-sm mx-auto relative group">
        <div className="relative">
          <input
            ref={inputRef}
            type="password"
            value={scanCode}
            onKeyDown={keyDownHandler}
            onChange={inputChangeHandler}
            className="w-full bg-purple-900/30 border-2 border-purple-500/50 text-white text-center text-4xl py-6 rounded-2xl focus:outline-none focus:border-purple-400 transition-all tracking-[1em] shadow-2xl"
            placeholder="••••"
            maxLength={10}
            autoComplete="off"
          />
        </div>

        <p className="mt-6 text-slate-400 text-xs md:text-sm font-bold uppercase tracking-[0.2em] text-center">
          {promptType === 'OUT_LATE'
            ? 'INGRESE PIN PARA HORAS EXTRAS'
            : 'INGRESE EL CÓDIGO DEL MONITOR'}
        </p>

        {promptType === 'OUT_LATE' ? (
          <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
            <button
              type="button"
              onClick={forceNormalOutHandler}
              className="w-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 py-3.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all shadow-lg border border-slate-700 hover:border-slate-500"
            >
              No, guardar según horario
            </button>
            <button
              type="button"
              onClick={cancelHandler}
              className="w-full text-slate-500 hover:text-white uppercase font-bold text-[10px] tracking-widest transition-colors py-2"
            >
              Cancelar / Atrás
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={cancelHandler}
            className="mt-8 text-slate-500 hover:text-white uppercase font-bold text-xs tracking-widest transition-colors inline-flex items-center gap-2"
          >
            <XCircle size={14} /> Cancelar / Atrás
          </button>
        )}
      </form>
    </div>
  );
};
export { AuthPromptPanel };
export default AuthPromptPanel;