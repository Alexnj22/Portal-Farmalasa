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
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center animate-in fade-in duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] bg-[#0B1121]/70 backdrop-blur-[50px] backdrop-saturate-[200%] overflow-hidden">

      {/* ORBE DE LUZ */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] md:w-[800px] md:h-[800px] rounded-full blur-[140px] opacity-20 pointer-events-none transition-colors duration-1000 ${theme.glow}`}></div>

      <div className="flex flex-col items-center justify-center text-center w-full max-w-6xl h-full p-8 relative z-10">

        {isLactationAction && (
          <div className="absolute top-10 right-10 flex items-center gap-2 bg-white/5 backdrop-blur-2xl border border-white/10 px-5 py-2.5 rounded-full text-white/90 font-bold animate-pulse shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_2px_rgba(255,255,255,0.15)]">
            <Baby size={20} className="text-pink-400 drop-shadow-[0_0_8px_rgba(244,114,182,0.6)]" /> Periodo de Lactancia Detectado
          </div>
        )}

        {status === 'success' ? (
          <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 w-full">

            {/* =========================================================
                COLUMNA IZQUIERDA: Info del Empleado
                ========================================================= */}
            <div className="flex flex-col items-center justify-center flex-1 animate-in slide-in-from-left-8 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
              <div
                className={`h-40 w-40 md:h-48 md:w-48 rounded-[2.5rem] md:rounded-[3rem] flex items-center justify-center mb-6 border-[2px] bg-white/5 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.6),inset_0_2px_20px_rgba(255,255,255,0.1)] overflow-hidden transform-gpu transition-all duration-500 ${color === 'red' ? `${theme.border} animate-pulse` : 'border-white/10'}`}
              >
                {(employee?.photo_url || employee?.photo) ? (
                  <img
                    src={employee.photo_url || employee.photo}
                    alt={employee?.name || 'Empleado'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-7xl md:text-8xl font-bold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                    {employee?.name?.charAt(0) || '?'}
                  </span>
                )}
              </div>

              <h2 className="text-2xl md:text-3xl font-black text-white/90 mb-2 tracking-[0.2em] uppercase drop-shadow-md">
                {employee?.name}
              </h2>

              <h1 className="text-4xl md:text-6xl font-black text-white mb-6 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] tracking-tight flex items-center justify-center gap-4 text-center">
                {Icon ? (
                  <Icon
                    size={56}
                    strokeWidth={2.5}
                    className={color === 'red' ? 'text-red-400 animate-bounce drop-shadow-[0_0_15px_rgba(248,113,113,0.5)]' : `${theme.icon} drop-shadow-lg`}
                  />
                ) : null}
                {message}
              </h1>

              <div className={`bg-white/5 backdrop-blur-2xl rounded-full px-8 py-3 mb-6 border shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.15)] ${color === 'red' ? 'border-red-500/50' : 'border-white/10'}`}>
                <p className="text-lg md:text-xl text-white font-black uppercase tracking-widest drop-shadow-sm">
                  {subtext}
                </p>
              </div>

              {warning && (
                <div className="mb-6 px-6 py-3 bg-amber-500/10 backdrop-blur-xl border border-amber-500/30 text-amber-400 rounded-2xl font-black uppercase tracking-widest text-[12px] animate-pulse shadow-[0_10px_30px_rgba(245,158,11,0.1),inset_0_1px_2px_rgba(255,255,255,0.2)] text-center flex items-center gap-2">
                  <AlertTriangle size={18} strokeWidth={2.5} /> {warning}
                </div>
              )}

              <div className="flex items-center gap-4 text-white font-mono text-3xl md:text-4xl font-bold bg-white/5 backdrop-blur-2xl px-10 py-5 rounded-[1.5rem] border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5),inset_0_1px_2px_rgba(255,255,255,0.15)]">
                <Clock size={36} className="text-white/40" /> {time}
              </div>
            </div>

            {/* =========================================================
                COLUMNA DERECHA: Tarjeta de Aviso
                ========================================================= */}
            {announcement && (
              <div className={`group flex-1 w-full max-w-md flex flex-col rounded-[2.5rem] overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu animate-in zoom-in-95 slide-in-from-right-8 cursor-default bg-white/5 backdrop-blur-[50px] backdrop-saturate-[200%] border hover:-translate-y-2 border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.6),inset_0_1px_2px_rgba(255,255,255,0.15)] hover:shadow-[0_50px_100px_rgba(0,0,0,0.8),inset_0_1px_2px_rgba(255,255,255,0.15)] hover:border-white/20 hover:bg-white/10`}>

                {/* Header Dinámico (🚨 Aquí está el cambio principal del fondo) */}
                <div className={`p-6 flex items-center gap-4 border-b transition-colors duration-500 ${isUrgent ? 'bg-red-500/10 border-red-500/20 group-hover:bg-red-500/20' : 'bg-white/[0.02] border-white/10 group-hover:bg-white/5'}`}>
                  <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center bg-white/10 backdrop-blur-md shadow-[inset_0_2px_10px_rgba(255,255,255,0.1)] border border-white/20 shrink-0 transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-3 ${isUrgent ? 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse' : 'text-[#007AFF]'}`}>
                    {isUrgent ? <AlertTriangle size={28} strokeWidth={2.5} /> : <Megaphone size={28} strokeWidth={2.5} />}
                  </div>
                  <div className="flex flex-col text-left">
                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] mb-0.5 ${isUrgent ? 'text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'text-white/50'}`}>
                      {isUrgent ? '🚨 Aviso Urgente' : 'Mensaje Administrativo'}
                    </span>
                    <h3 className="font-black text-[20px] text-white leading-tight tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                      {announcement.title}
                    </h3>
                  </div>
                </div>

                {/* Cuerpo del Mensaje */}
                <div className="p-8 flex flex-col justify-between h-full min-h-[300px] relative bg-transparent">

                  {/* Scroll Oculto Master */}
                  <div className="flex-1 overflow-y-auto max-h-[200px] scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] relative z-10">
                    <p className="text-white/80 text-[15px] md:text-[16px] font-medium leading-relaxed whitespace-pre-wrap">
                      {announcement.message}
                    </p>
                  </div>

                  {/* 🚨 BOTÓN INTERACTIVO DINÁMICO */}
                  <button
                    onClick={handleAnnouncementClose}
                    disabled={isSuccess}
                    className={`mt-8 w-full py-4 rounded-2xl font-black uppercase tracking-widest text-[13px] flex items-center justify-center gap-2 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu relative z-10 active:scale-95 ${isSuccess
                        ? isUrgent
                          // 🚨 ÉXITO URGENTE: Rojo brillante y sólido confirmando
                          ? 'bg-red-600 text-white shadow-[0_10px_40px_rgba(239,68,68,0.5),inset_0_2px_5px_rgba(255,255,255,0.4)] scale-[1.02] border-none'
                          // ÉXITO NORMAL: Verde esmeralda
                          : 'bg-emerald-500 text-white shadow-[0_10px_40px_rgba(16,185,129,0.5),inset_0_2px_5px_rgba(255,255,255,0.4)] scale-[1.02] border-none'
                        : isUrgent
                          // URGENTE REPOSO: Botón Rojo Liquid Glass sutil
                          ? 'bg-red-500/10 text-red-100 border border-red-500/30 shadow-[0_8px_20px_rgba(239,68,68,0.1),inset_0_1px_2px_rgba(255,255,255,0.15)] hover:-translate-y-1 hover:bg-red-500/25 hover:border-red-400 hover:text-white hover:shadow-[0_12px_30px_rgba(239,68,68,0.2),inset_0_1px_2px_rgba(255,255,255,0.2)]'
                          // NORMAL REPOSO: Botón estándar grisáceo translúcido
                          : 'bg-white/10 hover:bg-white/20 text-white border border-white/20 shadow-[0_8px_20px_rgba(0,0,0,0.3),inset_0_1px_2px_rgba(255,255,255,0.2)] hover:-translate-y-1'
                      }`}
                  >
                    {isSuccess ? (
                      <>
                        <CheckCircle2 size={22} strokeWidth={3} className="animate-in zoom-in-50 duration-200" />
                        ¡Confirmado!
                      </>
                    ) : (
                      <>
                        <CheckSquare size={20} strokeWidth={2.5} />
                        Entendido, Continuar
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* =========================================================
             PANTALLAS DE ERROR / INFO
             ========================================================= */
          <div className="flex flex-col items-center justify-center animate-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
            <div className={`h-56 w-56 md:h-64 md:w-64 rounded-[3rem] md:rounded-[4rem] flex items-center justify-center mb-10 border-[2px] bg-white/5 backdrop-blur-3xl shadow-[0_30px_60px_rgba(0,0,0,0.6),inset_0_2px_30px_rgba(255,255,255,0.1)] transition-all ${color === 'red' ? `${theme.border} animate-[pulse_1s_infinite]` : 'border-white/10'
              }`}>
              {Icon ? <Icon size={120} strokeWidth={2} className={`drop-shadow-[0_0_20px_rgba(255,255,255,0.2)] ${theme.icon}`} /> : null}
            </div>

            <h1 className="text-5xl md:text-7xl font-black text-white mb-6 drop-shadow-[0_4px_15px_rgba(0,0,0,0.5)] tracking-tight uppercase text-center">
              {message}
            </h1>
            <div className="bg-white/5 backdrop-blur-2xl rounded-full px-10 py-4 border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_2px_rgba(255,255,255,0.15)] text-center">
              <p className="text-xl md:text-2xl text-white/90 font-bold uppercase tracking-widest">
                {subtext}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}