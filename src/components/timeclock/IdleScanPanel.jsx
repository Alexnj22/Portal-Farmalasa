import React from 'react';
import { ScanBarcode, ShieldAlert, LogIn, Utensils, Baby, LogOut, XCircle } from 'lucide-react';

const ACTION_ITEMS = [
  {
    icon: LogIn,
    glassColor: 'bg-green-500/10 border-green-500/30 text-green-400',
    glow: 'group-hover:shadow-[0_0_20px_rgba(34,197,94,0.3)] group-hover:bg-green-500/20',
    label: 'Entrada',
  },
  {
    icon: Utensils,
    glassColor: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    glow: 'group-hover:shadow-[0_0_20px_rgba(249,115,22,0.3)] group-hover:bg-orange-500/20',
    label: 'Almuerzo',
  },
  {
    icon: Baby,
    glassColor: 'bg-pink-500/10 border-pink-500/30 text-pink-400',
    glow: 'group-hover:shadow-[0_0_20px_rgba(236,72,153,0.3)] group-hover:bg-pink-500/20',
    label: 'Lactancia',
  },
  {
    icon: LogOut,
    glassColor: 'bg-slate-400/10 border-slate-400/30 text-slate-300',
    glow: 'group-hover:shadow-[0_0_20px_rgba(148,163,184,0.3)] group-hover:bg-slate-400/20',
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
  return (
    <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500 pointer-events-auto overflow-hidden">
      
      {/* Tarjeta Glassmorphism: max-h-full asegura que no rebase la pantalla */}
      <div className="w-full max-w-[420px] max-h-full flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-5 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] overflow-hidden">
        
        {/* TOP: Ícono y Títulos (shrink-0 para que no se aplaste) */}
        <div className="flex flex-col items-center text-center w-full mb-4 sm:mb-6 shrink-0">
          {/* Animación de rebote recuperada aquí */}
          <div className={`inline-flex p-4 rounded-[1.5rem] mb-3 sm:mb-5 transition-all duration-500 border backdrop-blur-md animate-bounce ${
            specialMode 
              ? 'bg-orange-500/20 border-orange-500/40 shadow-[0_0_40px_rgba(249,115,22,0.2)]' 
              : 'bg-blue-500/20 border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.2)]'
          }`}>
            {specialMode ? (
              <ShieldAlert size={42} className="text-orange-400 drop-shadow-[0_2px_10px_rgba(249,115,22,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />
            ) : (
              <ScanBarcode size={42} className="text-blue-400 drop-shadow-[0_2px_10px_rgba(59,130,246,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />
            )}
          </div>

          <h1 className="text-2xl sm:text-4xl font-semibold text-white tracking-tight leading-tight mb-1 sm:mb-1.5 transition-colors">
            {specialMode ? 'Autorización' : 'Asistencia'}
          </h1>
          <p className={`text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] transition-colors ${
            specialMode ? 'text-orange-400/80' : 'text-blue-400/80'
          }`}>
            Farmacias La Salud &amp; Popular
          </p>
        </div>

        {/* MIDDLE: Formulario e Input (flex-1 para que ocupe el espacio disponible central) */}
        <form onSubmit={submitHandler} className="relative z-20 w-full group pointer-events-auto flex-1 flex flex-col justify-center min-h-0 shrink-0 py-2 sm:py-4">
          <div className="relative w-full">
            <input
              ref={inputRef}
              type="password"
              value={scanCode}
              onKeyDown={keyDownHandler}
              onChange={inputChangeHandler}
              readOnly={false}
              className={`relative z-20 pointer-events-auto w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center text-3xl sm:text-4xl py-4 sm:py-5 rounded-3xl focus:outline-none transition-all duration-300 tracking-[0.5em] sm:tracking-[1em] shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] placeholder:text-white/20 focus:bg-black/40 ${
                specialMode ? 'focus:border-orange-500/50' : 'focus:border-blue-500/50'
              }`}
              placeholder="••••"
              autoComplete="off"
            />
            <div className={`absolute inset-0 z-10 rounded-3xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none ${
              specialMode ? 'shadow-[0_0_20px_rgba(249,115,22,0.2)]' : 'shadow-[0_0_20px_rgba(59,130,246,0.2)]'
            }`} />
          </div>

          <div className="mt-4 sm:mt-6 flex flex-col items-center justify-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2.5 bg-white/5 backdrop-blur-md px-4 py-2 rounded-full border border-white/5">
              <span className={`w-2 h-2 rounded-full animate-pulse ${
                specialMode ? 'bg-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.8)]' : 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
              }`} />
              <p className="text-white/60 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-center">
                {specialMode ? 'Escanee para autorizar' : 'Escanee su carnet'}
              </p>
            </div>

            {specialMode ? (
              <button
                type="button"
                onClick={cancelSpecialModeHandler}
                className="relative z-20 pointer-events-auto text-[10px] sm:text-xs uppercase tracking-widest font-bold text-white/70 hover:text-white flex items-center gap-2 transition-all duration-300 bg-white/5 hover:bg-white/10 px-5 py-3 rounded-full border border-white/10 hover:border-white/20 active:scale-95"
              >
                <XCircle size={14} className="text-red-400" /> Cancelar Permiso
              </button>
            ) : (
              // 🚨 BOTÓN DESTACADO Y ACTIVO POR DEFECTO
              <button
                type="button"
                onClick={specialOutHandler}
                className="relative z-20 pointer-events-auto text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-orange-400 flex items-center gap-2 transition-all duration-300 bg-orange-500/15 px-5 py-3 rounded-full border border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.15)] hover:bg-orange-500/25 hover:border-orange-500/50 hover:shadow-[0_0_25px_rgba(249,115,22,0.4)] hover:-translate-y-0.5 active:scale-95"
              >
                <ShieldAlert size={14} className="animate-pulse" /> Autorizar Permiso / Salida
              </button>
            )}
          </div>
        </form>

        {/* BOTTOM: Acciones Rápidas (shrink-0 para que siempre se vean) */}
        <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-white/10 w-full flex justify-between items-center px-1 shrink-0">
          {ACTION_ITEMS.map((item, index) => (
            <div key={index} className="flex flex-col items-center gap-1.5 sm:gap-2 group cursor-default">
              <div className={`w-9 h-9 sm:w-12 sm:h-12 rounded-[0.8rem] sm:rounded-[1rem] flex items-center justify-center border backdrop-blur-md transition-all duration-300 group-hover:-translate-y-1 ${item.glassColor} ${item.glow}`}>
                <item.icon size={16} className="sm:w-5 sm:h-5 drop-shadow-md" strokeWidth={2} />
              </div>
              <span className="text-white/40 font-semibold text-[7px] sm:text-[9px] uppercase tracking-[0.15em] group-hover:text-white transition-colors">
                {item.label}
              </span>
            </div>
          ))}
        </div>
        
      </div>
    </div>
  );
}

export { IdleScanPanel };