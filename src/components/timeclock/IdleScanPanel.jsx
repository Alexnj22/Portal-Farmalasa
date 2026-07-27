import React from 'react';
import { ScanBarcode, ShieldAlert, XCircle, Bell } from 'lucide-react';

// Anillo "esperando escaneo" — reemplaza el <input> que simulaba tecleo
// manual. El carné ya no se escribe: el escáner alimenta un listener global
// de keydown en useTimeClockEngine.js (mismo patrón que LoginView.jsx), la
// detección anti-fraude sigue midiendo velocidad de tecleo sobre ese buffer,
// solo que ya no hay un <input> real detrás. 2026-07-25, a pedido del
// usuario — "no quiero que aparezca un input, nada se ingresa a mano".
function ScanReadyRing({ specialMode }) {
  const ring = specialMode ? 'border-chart-4/40' : 'border-chart-1/40';
  const core = specialMode ? 'bg-chart-4/10 border-chart-4/40 shadow-[0_0_24px_rgba(249,115,22,0.25)]' : 'bg-chart-1/10 border-chart-1/40 shadow-[0_0_24px_rgba(59,130,246,0.25)]';
  const iconColor = specialMode ? 'text-chart-4-text' : 'text-chart-1-text';
  return (
    <div className="w-full flex flex-col items-center gap-3.5 [@media(max-height:800px)]:gap-1.5 py-2 [@media(max-height:800px)]:py-0.5">
      <div className="relative w-24 h-24 [@media(max-height:800px)]:w-14 [@media(max-height:800px)]:h-14 flex items-center justify-center">
        <div className={`absolute inset-0 rounded-full border ${ring} animate-[scanPulse_2.2s_cubic-bezier(0.4,0,0.6,1)_infinite]`} />
        <div className={`absolute inset-0 rounded-full border ${ring} animate-[scanPulse_2.2s_cubic-bezier(0.4,0,0.6,1)_infinite]`} style={{ animationDelay: '1.1s' }} />
        <div className={`relative w-16 h-16 [@media(max-height:800px)]:w-10 [@media(max-height:800px)]:h-10 rounded-full border flex items-center justify-center ${core}`}>
          {specialMode
            ? <ShieldAlert size={26} className={`${iconColor} [@media(max-height:800px)]:w-4 [@media(max-height:800px)]:h-4`} strokeWidth={1.75} />
            : <ScanBarcode size={26} className={`${iconColor} [@media(max-height:800px)]:w-4 [@media(max-height:800px)]:h-4`} strokeWidth={1.75} />}
        </div>
      </div>
      <p className="text-body [@media(max-height:800px)]:text-label font-bold text-white/85 text-center">
        {specialMode ? 'Acerca tu carné para autorizar' : 'Acerca tu carné al lector'}
      </p>
      <p className="text-[9.5px] [@media(max-height:800px)]:hidden font-bold uppercase tracking-[0.12em] text-white/35 text-center">
        Esperando escaneo
      </p>
    </div>
  );
}

export default function IdleScanPanel({
  specialMode,
  specialOutHandler,
  cancelSpecialModeHandler,
  lunchAlerts = [],
}) {

  return (
    <div className="relative z-20 w-full flex flex-col items-center justify-center p-4 sm:p-6 [@media(max-height:800px)]:p-3 animate-in fade-in duration-500 pointer-events-auto">

      {/* 🚨 CAJA PRINCIPAL CENTRAL */}
      <div className="w-full max-w-[420px] flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-6 sm:p-8 [@media(max-height:800px)]:p-4 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)] transition-all duration-500 hover:scale-[1.01] hover:-translate-y-1 hover:bg-white/[0.04] hover:shadow-[0_30px_60px_rgba(0,0,0,0.4),inset_0_2px_15px_rgba(255,255,255,0.05)] hover:border-white/20">

        {/* TOP: Ícono y Títulos */}
        <div className="flex flex-col items-center text-center w-full mb-6 [@media(max-height:800px)]:mb-2 shrink-0 group/icon">
          <div className={`inline-flex p-4 [@media(max-height:800px)]:p-2 rounded-[1.5rem] mb-4 [@media(max-height:800px)]:mb-1.5 transition-all duration-300 border backdrop-blur-md group-hover/icon:scale-105 group-hover/icon:-translate-y-1 ${specialMode ? 'bg-chart-4/10 border-chart-4/40 shadow-[0_0_40px_rgba(249,115,22,0.15)] group-hover/icon:shadow-[0_0_50px_rgba(249,115,22,0.3)]' : 'bg-chart-1/10 border-chart-1/40 shadow-[0_0_40px_rgba(59,130,246,0.15)] group-hover/icon:shadow-[0_0_50px_rgba(59,130,246,0.3)]'
            }`}>
            {specialMode
              ? <ShieldAlert size={42} className="text-chart-4-text drop-shadow-[var(--shadow-glow-chart-4)] sm:w-12 sm:h-12 [@media(max-height:800px)]:!w-6 [@media(max-height:800px)]:!h-6" strokeWidth={1.5} />
              : <ScanBarcode size={42} className="text-chart-1-text drop-shadow-[var(--shadow-glow-chart-1)] sm:w-12 sm:h-12 [@media(max-height:800px)]:!w-6 [@media(max-height:800px)]:!h-6" strokeWidth={1.5} />}
          </div>
          <h1 className="text-2xl sm:text-4xl [@media(max-height:800px)]:text-lg font-semibold text-white tracking-tight leading-tight mb-1 [@media(max-height:800px)]:mb-0.5 transition-colors">{specialMode ? 'Autorización' : 'Asistencia'}</h1>
          <p className={`text-micro sm:text-xs [@media(max-height:800px)]:hidden font-bold uppercase tracking-[0.25em] transition-colors ${specialMode ? 'text-chart-4-text/80' : 'text-chart-1-text/80'}`}>Farmacias La Salud &amp; Popular</p>
        </div>

        {/* MIDDLE: estado de espera del escáner (nada se teclea a mano) */}
        <div className="relative z-20 w-full flex flex-col justify-center shrink-0">
          <ScanReadyRing specialMode={specialMode} />

          <div className="mt-5 [@media(max-height:800px)]:mt-2.5 flex flex-col items-center justify-center">
            {specialMode ? (
              <button type="button" onClick={cancelSpecialModeHandler} className="relative z-20 pointer-events-auto text-caption uppercase tracking-widest font-bold text-danger flex items-center gap-2 transition-all duration-300 bg-danger/10 px-6 py-3.5 [@media(max-height:800px)]:py-2 rounded-full border border-danger/30 hover:bg-danger/20 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:-translate-y-0.5 active:scale-[0.97]">
                <XCircle size={14} /> Cancelar Permiso
              </button>
            ) : (
              <button type="button" onClick={specialOutHandler} className="relative z-20 pointer-events-auto text-caption uppercase tracking-widest font-bold text-chart-4-text flex items-center gap-2 transition-all duration-300 bg-chart-4/10 px-6 py-3.5 [@media(max-height:800px)]:py-2 rounded-full border border-chart-4/30 hover:bg-chart-4/20 hover:shadow-[0_0_15px_rgba(249,115,22,0.3)] hover:-translate-y-0.5 active:scale-[0.97]">
                <ShieldAlert size={14} /> Autorizar Permiso / Salida
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Lunch alerts banner */}
      {!specialMode && lunchAlerts.length > 0 && (
        <div className="w-full max-w-[420px] mt-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="bg-chart-4/10 backdrop-blur-xl border border-chart-4/25 rounded-[1.5rem] px-4 py-3 shadow-[var(--shadow-glow-chart-4)]">
            <div className="flex items-center gap-2 mb-2">
              <Bell size={13} className="text-chart-4-text shrink-0" strokeWidth={2.5} />
              <span className="text-caption font-black uppercase tracking-widest text-chart-4-text">
                Hora de Almuerzo
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {lunchAlerts.map(alert => (
                <div key={alert.employee.id} className="flex items-center justify-between gap-2">
                  <span className="text-white/80 text-label font-semibold truncate">
                    {alert.employee.name}
                  </span>
                  <span className={`text-caption font-bold shrink-0 ${alert.minsOverdue > 0 ? 'text-danger' : 'text-chart-4-text'}`}>
                    {alert.minsOverdue > 0 ? `${alert.minsOverdue} min tarde` : `${alert.lunchTime}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}