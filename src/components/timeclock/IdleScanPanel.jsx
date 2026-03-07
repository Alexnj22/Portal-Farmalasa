import React from 'react';
import { ScanBarcode, ShieldAlert, LogIn, Utensils, Baby, LogOut, XCircle } from 'lucide-react';

// 🚨 ADAPTACIÓN LIQUIDGLASS: Los iconos ahora son "orbes" de cristal que brillan desde adentro
const ACTION_ITEMS = [
  {
    icon: LogIn,
    color: 'text-emerald-400',
    glow: 'group-hover:shadow-[0_0_30px_rgba(52,211,153,0.25)] group-hover:border-emerald-500/40 group-hover:bg-emerald-500/10',
    label: 'Entrada',
  },
  {
    icon: Utensils,
    color: 'text-orange-400',
    glow: 'group-hover:shadow-[0_0_30px_rgba(251,146,60,0.25)] group-hover:border-orange-500/40 group-hover:bg-orange-500/10',
    label: 'Almuerzo',
  },
  {
    icon: Baby,
    color: 'text-pink-400',
    glow: 'group-hover:shadow-[0_0_30px_rgba(244,114,182,0.25)] group-hover:border-pink-500/40 group-hover:bg-pink-500/10',
    label: 'Lactancia',
  },
  {
    icon: LogOut,
    color: 'text-slate-300',
    glow: 'group-hover:shadow-[0_0_30px_rgba(148,163,184,0.25)] group-hover:border-slate-400/40 group-hover:bg-slate-400/10',
    label: 'Salida',
  },
];

export default function IdleScanPanel({
  specialMode,
  scanCode,
  inputRef,
  submitHandler,
  keyDownHandler,
  inputChangeHandler,
  specialOutHandler,
  cancelSpecialModeHandler,
}) {

  // 🚨 CLASES MAESTRAS: Dark Glass (Estilo visionOS)
  const darkGlass = "bg-white/[0.03] backdrop-blur-3xl backdrop-saturate-[150%] border border-white/[0.08] shadow-[0_24px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)]";
  const smoothTransition = "transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]";

  return (
    <div className="relative z-20 w-full animate-in fade-in zoom-in-95 duration-500 pointer-events-auto flex flex-col items-center">
      
      {/* 🚨 ICONO PRINCIPAL FLOTANTE (Orbe de cristal) */}
      <div className={`relative flex items-center justify-center w-28 h-28 rounded-full mb-8 ${darkGlass} ${smoothTransition} ${
        specialMode 
          ? 'shadow-[0_0_50px_rgba(249,115,22,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] border-orange-500/30' 
          : 'shadow-[0_0_50px_rgba(0,122,255,0.2),inset_0_1px_0_rgba(255,255,255,0.2)] border-[#007AFF]/30'
      }`}>
        {/* Reflejo dinámico interno */}
        <div className={`absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-transparent`}></div>
        
        {specialMode ? (
          <ShieldAlert size={48} className="text-orange-400 relative z-10" strokeWidth={1.5} />
        ) : (
          <ScanBarcode size={48} className="text-[#007AFF] relative z-10" strokeWidth={1.5} />
        )}
      </div>

      <h1 className="text-4xl md:text-[44px] font-black text-white mb-2 tracking-tighter transition-colors drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
        {specialMode ? 'Modo Autorización' : 'Kiosco de Asistencia'}
      </h1>
      <p className={`text-xs md:text-sm mb-12 font-black uppercase tracking-[0.3em] transition-colors ${
        specialMode ? 'text-orange-400' : 'text-[#007AFF]'
      }`}>
        Farmacias La Salud &amp; Popular
      </p>

      <form onSubmit={submitHandler} className="relative z-20 w-full max-w-[420px] mx-auto group pointer-events-auto">
        
        {/* 🚨 INPUT CÓDIGO (Efecto de hueco tallado en el cristal) */}
        <div className="relative transform-gpu transition-transform duration-500 group-focus-within:scale-[1.02]">
          <input
            ref={inputRef}
            type="password"
            value={scanCode}
            onKeyDown={keyDownHandler}
            onChange={inputChangeHandler}
            readOnly={false}
            className={`relative z-20 pointer-events-auto w-full bg-[#030712]/60 backdrop-blur-xl border border-white/[0.05] text-white text-center text-4xl md:text-5xl py-7 rounded-[2rem] focus:outline-none ${smoothTransition} tracking-[0.5em] md:tracking-[0.8em] font-black shadow-[inset_0_8px_30px_rgba(0,0,0,0.8)] placeholder:text-white/10 ${
                specialMode ? 'focus:border-orange-500/50' : 'focus:border-[#007AFF]/50'
            }`}
            placeholder="••••"
            autoComplete="off"
          />

          {/* Anillo de luz exterior al enfocar */}
          <div className={`absolute inset-0 z-10 rounded-[2rem] opacity-0 group-focus-within:opacity-100 pointer-events-none ${smoothTransition} ${
            specialMode 
              ? 'shadow-[0_0_40px_rgba(249,115,22,0.3)]' 
              : 'shadow-[0_0_40px_rgba(0,122,255,0.3)]'
          }`} />
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-6">
          <div className="flex items-center gap-3 bg-white/[0.02] px-5 py-2.5 rounded-full border border-white/[0.05] backdrop-blur-md">
            <span className={`w-2 h-2 rounded-full animate-pulse ${
              specialMode 
                ? 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,1)]' 
                : 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,1)]'
            }`} />
            <p className="text-slate-300 text-[10px] md:text-[11px] font-black uppercase tracking-[0.25em] text-center">
              {specialMode ? 'ESCANEE PARA AUTORIZAR' : 'ESCANEE SU CARNET'}
            </p>
          </div>

          {/* 🚨 BOTONES DE ACCIÓN SECUNDARIA (Píldoras de cristal) */}
          {specialMode ? (
            <button
              type="button"
              onClick={cancelSpecialModeHandler}
              className={`relative z-20 pointer-events-auto text-[10px] uppercase tracking-widest font-black text-slate-400 hover:text-white flex items-center gap-2 ${darkGlass} ${smoothTransition} px-5 py-3 rounded-full hover:bg-white/[0.08] hover:-translate-y-1 active:scale-95`}
            >
              <XCircle size={14} /> Cancelar Permiso
            </button>
          ) : (
            <button
              type="button"
              onClick={specialOutHandler}
              className={`relative z-20 pointer-events-auto text-[10px] uppercase tracking-widest font-black text-slate-400 hover:text-orange-400 flex items-center gap-2 ${darkGlass} ${smoothTransition} px-5 py-3 rounded-full hover:bg-white/[0.08] hover:border-orange-500/30 hover:-translate-y-1 active:scale-95`}
            >
              <ShieldAlert size={14} /> Autorizar Permiso / Salida Anticipada
            </button>
          )}
        </div>
      </form>

      {/* 🚨 ICONOS INFERIORES (Cristal interactivo) */}
      <div className="mt-20 md:mt-28 flex justify-center gap-4 md:gap-10 w-full max-w-3xl flex-wrap">
        {ACTION_ITEMS.map((item, index) => (
          <div
            key={index}
            className="flex flex-col items-center gap-4 opacity-70 hover:opacity-100 transition-all cursor-default group"
          >
            <div
              className={`w-14 h-14 md:w-16 md:h-16 rounded-[1.5rem] flex items-center justify-center ${darkGlass} ${smoothTransition} group-hover:-translate-y-2 group-hover:scale-110 ${item.glow}`}
            >
              <item.icon size={24} className={`md:w-7 md:h-7 ${item.color} transition-colors`} strokeWidth={1.5} />
            </div>
            <span className={`font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] transition-colors ${smoothTransition} text-slate-500 group-hover:${item.color.replace('text-', 'text-')}`}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { IdleScanPanel };