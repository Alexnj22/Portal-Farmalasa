import React from 'react';
import Button from '../common/Button';
import { ScanBarcode, ShieldAlert, XCircle, Bell } from 'lucide-react';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

// Anillo "esperando escaneo" — reemplaza el <input> que simulaba tecleo
// manual. El carné ya no se escribe: el escáner alimenta un listener global
// de keydown en useTimeClockEngine.js (mismo patrón que LoginView.jsx), la
// detección anti-fraude sigue midiendo velocidad de tecleo sobre ese buffer,
// solo que ya no hay un <input> real detrás. 2026-07-25, a pedido del
// usuario — "no quiero que aparezca un input, nada se ingresa a mano".
export function ScanReadyRing({ specialMode }) {
  // El color de la marca y no un color de dato: así sigue al estilo del kiosco
  // (azul en el marcador, verde en «Mostrador»).
  const ring = specialMode ? 'border-chart-4/40' : 'border-brand/40';
  const core = specialMode ? 'bg-chart-4/15 border-chart-4/50' : 'bg-brand/15 border-brand/50';
  const iconColor = specialMode ? 'text-chart-4-text' : 'text-brand-text';
  const Icono = specialMode ? ShieldAlert : ScanBarcode;
  return (
    <div className="relative w-36 h-36 [@media(max-height:800px)]:w-24 [@media(max-height:800px)]:h-24 flex items-center justify-center">
      <div className={`absolute inset-0 rounded-full border-2 ${ring} animate-[scanPulse_2.2s_var(--ease-spring)_infinite]`} />
      <div className={`absolute inset-0 rounded-full border-2 ${ring} animate-[scanPulse_2.2s_var(--ease-spring)_infinite]`} style={{ animationDelay: '1.1s' }} />
      <div className={`relative w-24 h-24 [@media(max-height:800px)]:w-16 [@media(max-height:800px)]:h-16 rounded-full border-2 flex items-center justify-center ${core}`}>
        <Icono size={40} className={`${iconColor} [@media(max-height:800px)]:w-7 [@media(max-height:800px)]:h-7`} strokeWidth={1.5} />
      </div>
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
    <div className="relative z-content w-full flex flex-col items-center justify-center p-4 sm:p-6 [@media(max-height:800px)]:p-3 animate-in fade-in duration-[var(--dur-lento)] pointer-events-auto">

      {/* Sin tarjeta: el anillo y la frase SON la pantalla. El título
          «Asistencia» sólo repetía lo obvio; en modo permiso sí se dice,
          porque cambia lo que hace el lector. */}
      <div className="w-full max-w-[420px] mt-6 [@media(max-height:800px)]:mt-1 flex flex-col items-center text-center gap-5 [@media(max-height:800px)]:gap-3">
        <ScanReadyRing specialMode={specialMode} />
        <div className="flex flex-col items-center gap-1">
          {specialMode && <p className="text-label font-black uppercase tracking-widest text-chart-4-text">Autorización</p>}
          <p className="text-title-lg [@media(max-height:800px)]:text-title font-bold text-content">
            {specialMode ? 'Acerca tu carné para autorizar' : 'Acerca tu carné al lector'}
          </p>
        </div>
        {specialMode ? (
          <Button variant="destructive" icon={XCircle} onClick={cancelSpecialModeHandler}>Cancelar permiso</Button>
        ) : (
          <Button variant="secondary" icon={ShieldAlert} onClick={specialOutHandler}>Permiso o salida</Button>
        )}
      </div>

      {/* Lunch alerts banner */}
      {!specialMode && lunchAlerts.length > 0 && (
        <div className="w-full max-w-[420px] mt-3 animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-lento)]">
          <div className="bg-chart-4/10 backdrop-blur-xl border border-chart-4/25 rounded-3xl px-4 py-3 shadow-[var(--shadow-glow-chart-4)]">
            <div className="flex items-center gap-2 mb-2">
              <Bell size={13} className="text-chart-4-text shrink-0" strokeWidth={2.5} />
              <span className="text-caption font-black uppercase tracking-widest text-chart-4-text">
                Hora de Almuerzo
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {lunchAlerts.map(alert => (
                <div key={alert.employee.id} className="flex items-center justify-between gap-2">
                  <span className="text-content-2 text-label font-semibold truncate">
                    {shortEmployeeName(alert.employee)}
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