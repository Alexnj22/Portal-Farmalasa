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
// franja no se puede cerrar y no reacciona a sessionStorage — se queda
// mientras dure la migración de tema (AUDITORIA-TEMA-2026-07.md). Cuando el
// plan termine, se retira el <ThemeMigrationRibbon /> de AppLayout.jsx (y el
// spacer que lo acompaña) en vez de agregar una condición aquí.
export default function ThemeMigrationRibbon() {
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-[560] flex items-end justify-center"
      style={{ height: RIBBON_HEIGHT }}
    >
      <div
        className="w-full h-9 flex items-center justify-center gap-2 px-3 text-[#2b1c02] text-[12px] font-bold leading-tight"
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
