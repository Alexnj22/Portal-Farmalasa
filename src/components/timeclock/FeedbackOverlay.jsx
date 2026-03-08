import React, { useState } from 'react';
import { Baby, CheckSquare, Clock, Megaphone, AlertTriangle, CheckCircle2 } from 'lucide-react';

// 🚨 MAPA DE TEMAS LIQUIDGLASS DARK (Glows, Bordes e Íconos)
const THEME_MAP = {
  green: { glow: 'bg-emerald-500', border: 'border-emerald-500/40', icon: 'text-emerald-400' },
  red: { glow: 'bg-red-600', border: 'border-red-500/50', icon: 'text-red-400' },
  orange: { glow: 'bg-orange-500', border: 'border-orange-500/50', icon: 'text-orange-400' },
  blue: { glow: 'bg-[#007AFF]', border: 'border-[#007AFF]/50', icon: 'text-[#007AFF]' },
  pink: { glow: 'bg-pink-500', border: 'border-pink-500/50', icon: 'text-pink-400' },
  purple: { glow: 'bg-purple-500', border: 'border-purple-500/50', icon: 'text-purple-400' },
  slate: { glow: 'bg-slate-400', border: 'border-white/10', icon: 'text-white' },
};

export default function FeedbackOverlay({
  feedback,
  onClose,
  onAnnouncementRead,
}) {
  const [isSuccess, setIsSuccess] = useState(false);

  if (!feedback) return null;

  const {
    status,
    color,
    icon: Icon, 
    employee,
    message,
    subtext,
    warning,
    time,
    announcement,
    isLactationAction,
  } = feedback;

  const theme = THEME_MAP[color] || THEME_MAP.slate;
  const isUrgent = announcement?.priority === 'URGENT';

  const handleAnnouncementClose = () => {
    setIsSuccess(true);
    setTimeout(() => {
      if (announcement && onAnnouncementRead) {
        onAnnouncementRead();
      } else if (onClose) {
        onClose();
      }
    }, 500);
  };

  return (
    // Contenedor principal Liquidglass Black
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center animate-in fade-in duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] bg-[#0A0F1C]/80 backdrop-blur-[40px] backdrop-saturate-[150%] overflow-hidden">

      {/* ORBE DE LUZ DE FONDO */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] md:w-[800px] md:h-[800px] rounded-full blur-[140px] pointer-events-none transition-colors duration-1000 ${color === 'red' ? 'opacity-20' : 'opacity-10'} ${theme.glow}`}></div>

      <div className="flex flex-col items-center justify-center text-center w-full max-w-6xl h-full p-8 relative z-10">

        {isLactationAction && (
          <div className="absolute top-10 right-10 flex items-center gap-2 bg-pink-500/10 backdrop-blur-2xl border border-pink-500/30 px-5 py-2.5 rounded-full text-pink-100 font-bold animate-pulse shadow-[0_4px_20px_rgba(244,114,182,0.2),inset_0_1px_2px_rgba(255,255,255,0.15)] overflow-hidden">
            <Baby size={20} className="text-pink-400 drop-shadow-[0_0_8px_rgba(244,114,182,0.6)]" /> Periodo de Lactancia
          </div>
        )}

        {status === 'success' ? (
          <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 w-full">

            {/* COLUMNA IZQUIERDA: Info del Empleado */}
            <div className="flex flex-col items-center justify-center flex-1 animate-in slide-in-from-left-8 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] w-full max-w-[500px]">

              {/* 🚨 PIEZA UNIFICADA: Foto + Nombre Integrado */}
              <div className="relative mb-16 shrink-0 flex flex-col items-center">
                
                {/* Orbe de luz interno */}
                <div className={`absolute inset-0 rounded-[2.5rem] blur-2xl opacity-60 ${theme.glow}`}></div>
                
                {/* Contenedor de la Foto */}
                <div
                  className={`relative h-36 w-36 md:h-44 md:w-44 rounded-[2rem] md:rounded-[2.5rem] flex items-center justify-center border bg-white/[0.03] backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] overflow-hidden transition-all duration-500 ${color === 'red' ? `${theme.border} animate-pulse` : 'border-white/10'}`}>
                  {(employee?.photo_url || employee?.photo) ? (
                    <img
                      src={employee.photo_url || employee.photo}
                      alt={employee?.name || 'Empleado'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-6xl md:text-7xl font-bold text-white/50 drop-shadow-md">
                      {employee?.name?.charAt(0) || '?'}
                    </span>
                  )}
                </div>

                {/* Nombre: Píldora encrustada */}
                <div className="absolute -bottom-4 z-20 px-6 py-2.5 rounded-full bg-white/[0.03] backdrop-blur-3xl border border-white/20 shadow-[0_15px_30px_rgba(0,0,0,0.6),inset_0_1px_2px_rgba(255,255,255,0.1)] max-w-[120%] w-max flex items-center justify-center">
                  <h2 className="text-[10px] sm:text-[11px] md:text-xs font-black text-white uppercase tracking-[0.2em] drop-shadow-md truncate">
                    {employee?.name}
                  </h2>
                </div>
              </div>

              {/* Mensaje Principal (ej: ENTRADA EXTRA AUTORIZADA) */}
              <div className="mb-4">
                <p className="text-sm md:text-base font-bold uppercase tracking-[0.15em] text-center text-balance leading-relaxed text-white drop-shadow-md">
                  {message}
                </p>
              </div>

              {/* 🚨 NUEVO CONTENEDOR MAESTRO: Obliga a que los hijos midan igual */}
              {/* w-max toma el ancho del texto más largo. items-stretch iguala el ancho de los demás. */}
              <div className="flex flex-col items-stretch gap-3 w-max max-w-[95vw] mx-auto">
                
                {/* Subtexto (Píldora adaptable al 100% del contenedor padre) */}
                <div className={`flex items-center justify-center bg-white/5 backdrop-blur-2xl rounded-[1.5rem] px-8 py-3.5 border shadow-sm w-full ${color === 'red' ? 'border-red-500/40' : 'border-white/10'}`}>
                  <p className="text-xs sm:text-sm md:text-[15px] text-white font-bold uppercase tracking-[0.15em] text-center whitespace-nowrap">
                    {subtext}
                  </p>
                </div>

                {warning && (
                  <div className="flex items-center justify-center gap-2 px-8 py-3 bg-amber-500/10 backdrop-blur-xl border border-amber-500/30 text-amber-400 rounded-[1.5rem] font-bold uppercase tracking-widest text-[11px] animate-pulse shadow-sm w-full">
                    <AlertTriangle size={16} strokeWidth={2.5} className="shrink-0" />
                    <span className="whitespace-nowrap">{warning}</span>
                  </div>
                )}

                {/* Reloj (Mismo ancho automático y misma curvatura de borde que el subtexto) */}
                <div className="flex items-center justify-center gap-3 text-white font-light tabular-nums text-3xl md:text-4xl bg-white/[0.03] backdrop-blur-2xl px-8 py-4 rounded-[1.5rem] border border-white/10 shadow-[inset_0_2px_15px_rgba(255,255,255,0.02)] w-full">
                  <Clock size={32} className="text-white/30 shrink-0" /> 
                  <span className="whitespace-nowrap">{time}</span>
                </div>

              </div>
              
            </div>

            {/* COLUMNA DERECHA: Tarjeta de Aviso Liquid Glass */}
            {announcement && (
              <div className={`group flex-1 w-full max-w-md flex flex-col rounded-[2rem] overflow-hidden transition-all duration-500 animate-in zoom-in-95 slide-in-from-right-8 cursor-default bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] hover:-translate-y-1 hover:bg-white/[0.04] hover:border-white/20`}>
                <div className={`p-6 flex items-center gap-4 border-b transition-colors duration-500 ${isUrgent ? 'bg-red-500/10 border-red-500/20' : 'bg-white/[0.02] border-white/5'}`}>
                  <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center bg-white/5 backdrop-blur-md shadow-[inset_0_2px_10px_rgba(255,255,255,0.05)] border border-white/10 shrink-0 transition-transform duration-500 group-hover:scale-105 group-hover:-rotate-3 ${isUrgent ? 'text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'text-blue-400'}`}>
                    {isUrgent ? <AlertTriangle size={28} strokeWidth={2} /> : <Megaphone size={28} strokeWidth={2} />}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-0.5 ${isUrgent ? 'text-red-400' : 'text-white/40'}`}>
                      {isUrgent ? '🚨 Aviso Urgente' : 'Mensaje Administrativo'}
                    </span>
                    <h3 className="font-semibold text-[20px] text-white/90 leading-tight tracking-tight">
                      {announcement.title}
                    </h3>
                  </div>
                </div>

                <div className="p-8 flex flex-col justify-between h-full min-h-[300px] relative bg-transparent">
                  <div className="flex-1 overflow-y-auto max-h-[200px] scrollbar-hide">
                    <p className="text-white/60 text-[15px] md:text-[16px] font-medium leading-relaxed whitespace-pre-wrap px-1">{announcement.message}</p>
                  </div>

                  <button onClick={handleAnnouncementClose} disabled={isSuccess} className={`mt-8 w-full py-4 rounded-full font-bold uppercase tracking-widest text-[11px] sm:text-xs flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 ${isSuccess ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : isUrgent ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white hover:border-white/20'}`}>
                    {isSuccess ? <><CheckCircle2 size={18} strokeWidth={2.5} className="animate-in zoom-in-50 duration-200" /> ¡Confirmado!</> : <><CheckSquare size={18} strokeWidth={2.5} /> Entendido, Continuar</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* =========================================================
             PANTALLAS DE ERROR / INFO
             ========================================================= */
          <div className="flex flex-col items-center justify-center animate-in zoom-in-95 duration-500 w-full max-w-lg mx-auto">

            <div className="relative mb-8 shrink-0">
              <div className={`absolute inset-0 rounded-[3rem] blur-2xl opacity-60 ${theme.glow}`}></div>
              <div
                className={`relative h-40 w-40 sm:h-48 sm:w-48 md:h-56 md:w-56 rounded-[2.5rem] md:rounded-[3rem] flex items-center justify-center border backdrop-blur-3xl transition-all duration-500 
                ${color === 'red'
                    ? 'bg-red-500/10 border-red-500/40 shadow-[0_0_50px_rgba(239,68,68,0.2),inset_0_2px_20px_rgba(255,255,255,0.1)] animate-[pulse_2s_infinite]'
                    : 'bg-white/[0.03] border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)]'
                  }`}>
                {Icon && (
                  <div className={color === 'red' ? 'animate-bounce' : ''}>
                    <Icon
                      size={96}
                      strokeWidth={1.5}
                      className={`${theme.icon} drop-shadow-[0_0_20px_currentColor]`}
                    />
                  </div>
                )}
              </div>
            </div>

            <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-6 tracking-tight uppercase text-center leading-tight w-full px-4 drop-shadow-md">
              {message}
            </h1>

            <div className={`backdrop-blur-2xl rounded-3xl px-8 py-4 border shadow-lg text-center transition-colors duration-500 max-w-[95%] w-fit mx-auto
              ${color === 'red' ? 'bg-red-500/15 border-red-500/30' : 'bg-white/5 border-white/10'}
            `}>
              <p className={`text-sm md:text-base font-bold uppercase tracking-widest text-balance leading-relaxed
                ${color === 'red' ? 'text-red-300' : 'text-white/70'}
              `}>
                {subtext}
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}