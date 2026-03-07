import React from 'react';
import { ScanBarcode, ShieldAlert, LogIn, Utensils, Baby, LogOut, XCircle } from 'lucide-react';

const ACTION_ITEMS = [
  {
    icon: LogIn,
    color: 'bg-green-500 text-slate-900',
    glow: 'group-hover:shadow-[0_0_20px_rgba(34,197,94,0.6)]',
    label: 'Entrada',
  },
  {
    icon: Utensils,
    color: 'bg-orange-500 text-slate-900',
    glow: 'group-hover:shadow-[0_0_20px_rgba(249,115,22,0.6)]',
    label: 'Almuerzo',
  },
  {
    icon: Baby,
    color: 'bg-pink-500 text-white',
    glow: 'group-hover:shadow-[0_0_20px_rgba(236,72,153,0.6)]',
    label: 'Lactancia',
  },
  {
    icon: LogOut,
    color: 'bg-slate-500 text-slate-900',
    glow: 'group-hover:shadow-[0_0_20px_rgba(100,116,139,0.6)]',
    label: 'Salida',
  },
];

// 🚨 Props corregidos para que hagan match exacto con TimeClockView
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
    <div className="relative z-20 w-full animate-in fade-in duration-300 pointer-events-auto">
      <div className={`inline-flex p-5 rounded-full mb-6 transition-all duration-300 animate-bounce ${
        specialMode 
          ? 'bg-orange-500 shadow-[0_0_40px_rgba(249,115,22,0.4)]' 
          : 'bg-blue-600 shadow-[0_0_40px_rgba(37,99,235,0.4)]'
      }`}>
        {specialMode ? (
          <ShieldAlert size={64} className="text-white" />
        ) : (
          <ScanBarcode size={64} className="text-white" />
        )}
      </div>

      <h1 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tighter transition-colors">
        {specialMode ? 'Modo Autorización' : 'Kiosco de Asistencia'}
      </h1>
      <p className={`text-sm md:text-lg mb-10 font-black uppercase tracking-[0.2em] transition-colors ${
        specialMode ? 'text-orange-400' : 'text-blue-400'
      }`}>
        Farmacias La Salud &amp; Popular
      </p>

      <form onSubmit={submitHandler} className="relative z-20 w-full max-w-md mx-auto group pointer-events-auto">
        <div className="relative">
          <input
            ref={inputRef}
            type="password"
            value={scanCode}
            onKeyDown={keyDownHandler}
            onChange={inputChangeHandler}
            readOnly={false}
            className="relative z-20 pointer-events-auto w-full bg-[#111827] border-2 border-[#1F2937] text-white text-center text-4xl py-6 rounded-2xl focus:outline-none transition-all tracking-[1em] shadow-2xl"
            placeholder="••••"
            autoComplete="off"
          />

          <div className={`absolute inset-0 z-10 border-2 rounded-2xl opacity-0 group-focus-within:opacity-100 group-focus-within:animate-pulse pointer-events-none transition-opacity ${
            specialMode 
              ? 'border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.3)]' 
              : 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]'
          }`} />
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${
              specialMode 
                ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]' 
                : 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
            }`} />
            <p className="text-slate-400 text-xs md:text-sm font-bold uppercase tracking-[0.3em] text-center">
              {specialMode ? 'ESCANEE PARA AUTORIZAR' : 'ESCANEE SU CARNET'}
            </p>
          </div>

          {/* Renderizado condicional del botón según el estado del modo especial */}
          {specialMode ? (
            <button
              type="button"
              onClick={cancelSpecialModeHandler}
              className="relative z-20 pointer-events-auto text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-white flex items-center gap-1.5 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-white/10"
            >
              <XCircle size={12} /> Cancelar Permiso
            </button>
          ) : (
            <button
              type="button"
              onClick={specialOutHandler}
              className="relative z-20 pointer-events-auto text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-orange-400 flex items-center gap-1.5 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-white/10"
            >
              <ShieldAlert size={12} /> Autorizar Permiso / Salida Anticipada
            </button>
          )}
        </div>
      </form>

      <div className="mt-16 md:mt-24 flex justify-center gap-6 md:gap-12 w-full">
        {ACTION_ITEMS.map((item, index) => (
          <div
            key={index}
            className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-all cursor-default group hover:-translate-y-1"
          >
            <div
              className={`${item.color} w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-lg ${item.glow} transition-all duration-300`}
            >
              <item.icon size={20} className="md:w-6 md:h-6" />
            </div>
            <span className="text-slate-500 font-bold text-[9px] md:text-[10px] uppercase tracking-[0.2em] group-hover:text-white transition-colors">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { IdleScanPanel };