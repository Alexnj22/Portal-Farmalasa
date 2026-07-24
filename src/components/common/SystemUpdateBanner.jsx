import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

const DISMISSED_KEY = 'system_update_notice_dismissed_v1';

// onVisibleChange: AppLayout necesita saber cuándo el aviso está en pantalla
// para empujar el contenido hacia abajo (#main-scroll) y así nunca taparlo —
// a diferencia de OfflineBanner/PushPromptBanner (transitorios, riesgo bajo
// de solapar contenido), este aviso puede quedar visible toda la sesión.
export default function SystemUpdateBanner({ onVisibleChange }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISSED_KEY)) return;
    // Pequeño delay para que no aparezca antes de que el resto de la UI asiente
    const t = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => { onVisibleChange?.(visible); }, [visible, onVisibleChange]);

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      role="status"
      data-surface="dropdown"
      // top offset en mobile despeja el header sticky (fuera de #main-scroll,
      // por eso el push de padding no lo alcanza) + safe-area-inset-top para
      // standalone iOS; en desktop (lg+) no hay header fijo compitiendo, top-4 basta
      className="fixed top-[calc(4.75rem+env(safe-area-inset-top,0px))] lg:top-4 left-1/2 -translate-x-1/2 z-[500] w-[calc(100%-2rem)] max-w-sm
                 flex items-center gap-3 px-4 py-3 animate-in fade-in slide-in-from-top-4 duration-300"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-content-2 flex items-center justify-center">
        <Sparkles size={16} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-content leading-tight">Portal en actualización visual</p>
        <p className="text-[11px] text-content-3 leading-tight mt-0.5">
          Algunos elementos pueden verse distintos temporalmente. Los datos que ves son correctos.
        </p>
      </div>
      <button
        onClick={dismiss}
        className="p-1.5 rounded-lg hover:bg-surface-card-hover active:scale-[0.97] transition-all flex-shrink-0"
        aria-label="Cerrar aviso"
      >
        <X size={14} className="text-content-3" />
      </button>
    </div>
  );
}
