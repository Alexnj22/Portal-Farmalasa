import React, { useEffect } from 'react';
import { ScanBarcode, ShieldAlert, LogIn, Utensils, Baby, LogOut, XCircle } from 'lucide-react';

const ACTION_ITEMS = [
  { icon: LogIn, glassColor: 'bg-green-500/10 border-green-500/30 text-green-400', glow: 'group-hover:shadow-[0_0_20px_rgba(34,197,94,0.3)] group-hover:bg-green-500/20', label: 'Entrada' },
  { icon: Utensils, glassColor: 'bg-orange-500/10 border-orange-500/30 text-orange-400', glow: 'group-hover:shadow-[0_0_20px_rgba(249,115,22,0.3)] group-hover:bg-orange-500/20', label: 'Almuerzo' },
  { icon: Baby, glassColor: 'bg-pink-500/10 border-pink-500/30 text-pink-400', glow: 'group-hover:shadow-[0_0_20px_rgba(236,72,153,0.3)] group-hover:bg-pink-500/20', label: 'Lactancia' },
  { icon: LogOut, glassColor: 'bg-slate-400/10 border-slate-400/30 text-slate-300', glow: 'group-hover:shadow-[0_0_20px_rgba(148,163,184,0.3)] group-hover:bg-slate-400/20', label: 'Salida' },
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
  clearHandler,
}) {

  useEffect(() => {
    if ((!scanCode || scanCode.length === 0) && inputRef.current) {
      inputRef.current.value = '';
    }
  }, [scanCode, inputRef]);

  const hasValue = scanCode && scanCode.length > 0;

  return (
    <div className="relative z-20 w-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500 pointer-events-auto">

      {/* 🚨 CAJA PRINCIPAL CENTRAL */}
      <div className="w-full max-w-[420px] flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-6 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] transition-all duration-500 hover:scale-[1.01] hover:-translate-y-1 hover:bg-white/[0.04] hover:shadow-[0_30px_60px_rgba(0,0,0,0.4),inset_0_2px_15px_rgba(255,255,255,0.05)] hover:border-white/20">

        {/* TOP: Ícono y Títulos */}
        <div className="flex flex-col items-center text-center w-full mb-6 shrink-0 group/icon">
          <div className={`inline-flex p-4 rounded-[1.5rem] mb-4 transition-all duration-300 border backdrop-blur-md group-hover/icon:scale-105 group-hover/icon:-translate-y-1 ${specialMode ? 'bg-orange-500/10 border-orange-500/40 shadow-[0_0_40px_rgba(249,115,22,0.15)] group-hover/icon:shadow-[0_0_50px_rgba(249,115,22,0.3)]' : 'bg-blue-500/10 border-blue-500/40 shadow-[0_0_40px_rgba(59,130,246,0.15)] group-hover/icon:shadow-[0_0_50px_rgba(59,130,246,0.3)]'
            }`}>
            {specialMode ? <ShieldAlert size={42} className="text-orange-400 drop-shadow-[0_2px_10px_rgba(249,115,22,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} /> : <ScanBarcode size={42} className="text-blue-400 drop-shadow-[0_2px_10px_rgba(59,130,246,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />}
          </div>
          <h1 className="text-2xl sm:text-4xl font-semibold text-white tracking-tight leading-tight mb-1 transition-colors">{specialMode ? 'Autorización' : 'Asistencia'}</h1>
          <p className={`text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] transition-colors ${specialMode ? 'text-orange-400/80' : 'text-blue-400/80'}`}>Farmacias La Salud &amp; Popular</p>
        </div>

        {/* MIDDLE: Formulario e Input */}
        <form onSubmit={submitHandler} className="relative z-20 w-full pointer-events-auto flex flex-col justify-center shrink-0">
          <div className="relative w-full group/input cursor-text">
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
              placeholder={specialMode ? 'ESCANEE PARA AUTORIZAR' : 'ESCANEE SU CARNET'}
              className={`relative z-20 pointer-events-auto w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center py-5 rounded-3xl shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)] select-none text-2xl sm:text-4xl tracking-[0.5em] sm:tracking-[0.8em] placeholder:text-[10px] placeholder:sm:text-xs placeholder:tracking-[0.2em] placeholder:font-bold placeholder:uppercase caret-transparent transition-all duration-300 ${specialMode ? 'placeholder:text-orange-400/50 virtual-caret-orange' : 'placeholder:text-white/40 virtual-caret-blue'}`}
            />
            {hasValue && (
              <button type="button" onClick={clearHandler} className="absolute right-4 top-1/2 -translate-y-1/2 z-40 p-2 text-white/20 hover:text-white/80 transition-all duration-300 hover:scale-110 active:scale-95">
                <XCircle size={22} strokeWidth={2} />
              </button>
            )}
            <div className={`absolute inset-0 z-10 rounded-3xl opacity-0 transition-opacity duration-500 pointer-events-none ${specialMode ? 'shadow-[0_0_20px_rgba(249,115,22,0.2)] group-focus-within/input:opacity-100' : 'shadow-[0_0_20px_rgba(59,130,246,0.2)] group-focus-within/input:opacity-100'}`} />
          </div>

          <div className="mt-5 flex flex-col items-center justify-center">
            {specialMode ? (
              <button type="button" onClick={cancelSpecialModeHandler} className="relative z-20 pointer-events-auto text-[10px] uppercase tracking-widest font-bold text-red-400 flex items-center gap-2 transition-all duration-300 bg-red-500/10 px-6 py-3.5 rounded-full border border-red-500/30 hover:bg-red-500/20 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:-translate-y-0.5 active:scale-95">
                <XCircle size={14} /> Cancelar Permiso
              </button>
            ) : (
              <button type="button" onClick={specialOutHandler} className="relative z-20 pointer-events-auto text-[10px] uppercase tracking-widest font-bold text-orange-400 flex items-center gap-2 transition-all duration-300 bg-orange-500/10 px-6 py-3.5 rounded-full border border-orange-500/30 hover:bg-orange-500/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] hover:-translate-y-0.5 active:scale-95">
                <ShieldAlert size={14} /> Autorizar Permiso / Salida
              </button>
            )}
          </div>
        </form>

        {/* 🚨 COMPORTAMIENTO 1: LEYENDA POR DEFECTO (ADENTRO ABAJO)
            - hidden: por defecto (celulares).
            - sm:flex: aparece en pantallas anchas.
            - [@media(max-height:800px)]:hidden: SE OCULTA si la pantalla es "bajita" para no aplastar el formulario.
        */}
        <div className="hidden sm:flex [@media(max-height:800px)]:hidden mt-4 pt-6 border-t border-white/10 w-full justify-between items-center px-1 shrink-0 animate-in fade-in">
          {ACTION_ITEMS.map((item, index) => (
            <div key={index} className="flex flex-col items-center gap-2 group cursor-default">
              <div className={`w-12 h-12 rounded-[1rem] flex items-center justify-center border backdrop-blur-md transition-all duration-300 group-hover:-translate-y-1 ${item.glassColor} ${item.glow}`}>
                <item.icon size={20} className="drop-shadow-md" strokeWidth={2} />
              </div>
              <span className="text-white/40 font-semibold text-[9px] uppercase tracking-[0.15em] group-hover:text-white transition-colors">
                {item.label}
              </span>
            </div>
          ))}
        </div>

      </div>

      {/* 🚨 COMPORTAMIENTO 2: DOCK FLOTANTE DERECHO (PANTALLAS CHAPARRITAS PERO ANCHAS)
          - hidden: por defecto.
          - md:[@media(max-height:800px)]:flex : SOLO APARECE si la altura es menor a 800px Y el ancho es mayor a 768px (md).
            (Si no le ponemos 'md', chocaría con la caja del centro en celulares acostados).
      */}
      <div className="hidden md:[@media(max-height:800px)]:flex flex-col gap-4 fixed right-6 top-1/2 -translate-y-1/2 bg-white/[0.02] backdrop-blur-3xl border border-white/5 p-4 rounded-[2rem] shadow-2xl animate-in slide-in-from-right-8 z-30">
        {ACTION_ITEMS.map((item, index) => (
          <div key={`side-${index}`} className="flex flex-col items-center gap-1.5 group cursor-default">
            <div className={`w-12 h-12 rounded-[1rem] flex items-center justify-center border backdrop-blur-md transition-all duration-300 group-hover:-translate-x-1 ${item.glassColor} ${item.glow}`}>
              <item.icon size={18} className="drop-shadow-md" strokeWidth={2} />
            </div>
            <span className="text-white/40 font-semibold text-[8px] uppercase tracking-[0.15em] group-hover:text-white transition-colors">
              {item.label}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}