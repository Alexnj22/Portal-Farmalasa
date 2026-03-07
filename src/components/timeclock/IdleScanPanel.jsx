import React from 'react';
import { ScanBarcode, ShieldAlert, LogIn, Utensils, Baby, LogOut, XCircle } from 'lucide-react';

// Actualizamos los colores para que parezcan "cristal tintado" en lugar de sólidos
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
    // Contenedor principal: Ocupa el 100% de la altura, evita el scroll y centra el contenido
    <div className="relative z-20 w-full h-full min-h-full flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 animate-in fade-in duration-500 pointer-events-auto overflow-hidden">
      
      {/* Tarjeta Glassmorphism Principal */}
      <div className="w-full max-w-[420px] flex flex-col items-center justify-between bg-black/20 backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)]">
        
        {/* TOP: Ícono y Títulos */}
        <div className="flex flex-col items-center text-center w-full mb-6">
          <div className={`inline-flex p-4 rounded-[1.5rem] mb-5 transition-all duration-500 border backdrop-blur-md ${
            specialMode 
              ? 'bg-orange-500/20 border-orange-500/40 shadow-[0_0_40px_rgba(249,115,22,0.2)]' 
              : 'bg-blue-500/20 border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.2)]'
          }`}>
            {specialMode ? (
              <ShieldAlert size={48} className="text-orange-400 drop-shadow-[0_2px_10px_rgba(249,115,22,0.8)]" strokeWidth={1.5} />
            ) : (
              <ScanBarcode size={48} className="text-blue-400 drop-shadow-[0_2px_10px_rgba(59,130,246,0.8)]" strokeWidth={1.5} />
            )}
          </div>

          <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight leading-tight mb-1.5 transition-colors">
            {specialMode ? 'Autorización' : 'Asistencia'}
          </h1>
          <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-[0.25em] transition-colors ${
            specialMode ? 'text-orange-400/80' : 'text-blue-400/80'
          }`}>
            Farmacias La Salud &amp; Popular
          </p>
        </div>

        {/* MIDDLE: Formulario e Input */}
        <form onSubmit={submitHandler} className="relative z-20 w-full group pointer-events-auto flex-1 flex flex-col justify-center">
          <div className="relative w-full">
            <input
              ref={inputRef}
              type="password"
              value={scanCode}
              onKeyDown={keyDownHandler}
              onChange={inputChangeHandler}
              readOnly={false}
              className={`relative z-20 pointer-events-auto w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center text-3xl sm:text-4xl py-5 rounded-3xl focus:outline-none transition-all duration-300 tracking-[0.5em] sm:tracking-[1em] shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] placeholder:text-white/20 focus:bg-black/40 ${
                specialMode ? 'focus:border-orange-500/50' : 'focus:border-blue-500/50'
              }`}
              placeholder="••••"
              autoComplete="off"
            />

            {/* Anillo de brillo exterior al hacer focus */}
            <div className={`absolute inset-0 z-10 rounded-3xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500 pointer-events-none ${
              specialMode 
                ? 'shadow-[0_0_20px_rgba(249,115,22,0.2)]' 
                : 'shadow-[0_0_20px_rgba(59,130,246,0.2)]'
            }`} />
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-2.5 bg-white/5 backdrop-blur-md px-4 py-2 rounded-full border border-white/5">
              <span className={`w-2 h-2 rounded-full animate-pulse ${
                specialMode 
                  ? 'bg-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.8)]' 
                  : 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
              }`} />
              <p className="text-white/60 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.2em] text-center">
                {specialMode ? 'Escanee para autorizar' : 'Escanee su carnet'}
              </p>
            </div>

            {/* Botón de Modo Especial (Glass Pill) */}
            {specialMode ? (
              <button
                type="button"
                onClick={cancelSpecialModeHandler}
                className="relative z-20 pointer-events-auto text-[10px] sm:text-xs uppercase tracking-widest font-bold text-white/70 hover:text-white flex items-center gap-2 transition-all duration-300 bg-white/5 hover:bg-white/10 px-4 py-2.5 rounded-full border border-white/10 hover:border-white/20 active:scale-95"
              >
                <XCircle size={14} className="text-red-400" /> Cancelar Permiso
              </button>
            ) : (
              <button
                type="button"
                onClick={specialOutHandler}
                className="relative z-20 pointer-events-auto text-[10px] sm:text-xs uppercase tracking-widest font-bold text-white/60 hover:text-orange-400 flex items-center gap-2 transition-all duration-300 bg-white/5 hover:bg-orange-500/10 px-4 py-2.5 rounded-full border border-white/10 hover:border-orange-500/30 active:scale-95"
              >
                <ShieldAlert size={14} /> Permiso / Salida Anticipada
              </button>
            )}
          </div>
        </form>

        {/* BOTTOM: Acciones Rápidas (Iconos de estado) */}
        <div className="mt-8 pt-6 border-t border-white/10 w-full flex justify-between items-center px-1 sm:px-2 gap-2">
          {ACTION_ITEMS.map((item, index) => (
            <div
              key={index}
              className="flex flex-col items-center gap-2 group cursor-default"
            >
              <div
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-[1rem] flex items-center justify-center border backdrop-blur-md transition-all duration-300 group-hover:-translate-y-1 ${item.glassColor} ${item.glow}`}
              >
                <item.icon size={18} className="sm:w-5 sm:h-5 drop-shadow-md" strokeWidth={2} />
              </div>
              <span className="text-white/40 font-semibold text-[8px] sm:text-[9px] uppercase tracking-[0.15em] group-hover:text-white transition-colors">
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