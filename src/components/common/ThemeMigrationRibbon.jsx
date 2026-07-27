import React from 'react';
import { Construction } from 'lucide-react';

// Alto total (franja + notch) — AppLayout usa esta misma constante para el
// spacer que reserva el espacio en el flujo normal (la franja es `fixed`,
// inmune al modelo de alto de 100dvh que ya causó regresiones en móvil —
// ver v2.30.0/v2.30.1 en version.js — así que no puede empujar contenido
// por sí misma).
export const RIBBON_HEIGHT = 'calc(2.25rem + env(safe-area-inset-top, 0px))';

// Aviso PERMANENTE (a pedido directo del usuario): a diferencia de
// SystemUpdateBanner/UpdateIndicatorDot (v2.48.0/2.48.1, eliminados), esta
// franja no se puede cerrar y no reacciona a sessionStorage. Se había
// retirado en v2.56.1 al cerrar el plan de tema T1-T7, pero el usuario pidió
// restaurarla en v2.57.1 porque siguen entrando cambios visuales al portal —
// no depender de un plan puntual para decidir si se retira.
export default function ThemeMigrationRibbon() {
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[560] flex items-end justify-center"
      style={{ height: RIBBON_HEIGHT }}
    >
      <div
        className="w-full h-9 flex items-center justify-center gap-2 px-3 text-[#2b1c02] text-body-sm font-bold leading-tight"
        style={{
          backgroundImage: 'repeating-linear-gradient(135deg, #f2a93b 0 14px, #f7c876 14px 28px)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        }}
      >
        <Construction size={15} strokeWidth={2.5} className="flex-shrink-0" />
        <span className="truncate">
          Portal en construcción visual — algunas pantallas se ven distintas mientras avanza la migración de tema. Tus datos están correctos.
        </span>
      </div>
    </div>
  );
}
