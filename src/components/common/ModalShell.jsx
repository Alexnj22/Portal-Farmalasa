import React, { useEffect } from "react";
import { createPortal } from "react-dom";

export default function ModalShell({
  open,
  onClose,
  children,
  maxWidthClass = "max-w-lg",
  zClass = "z-[100]",
  closeOnEsc = true,
  lockScroll = true,
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (!closeOnEsc) return;
      if (e.key === "Escape") onClose?.();
    };

    window.addEventListener("keydown", onKeyDown);

    // Guardamos el estilo original
    const originalStyle = window.getComputedStyle(document.body).overflow;
    
    if (lockScroll) {
        document.documentElement.style.overflow = "hidden"; 
        document.body.style.overflow = "hidden";
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (lockScroll) {
          document.documentElement.style.overflow = "";
          document.body.style.overflow = originalStyle;
      }
    };
  }, [open, onClose, closeOnEsc, lockScroll]);

  if (!open) return null;

  return createPortal(
    <div
      // 🚨 FIX 1: Quitamos transition-all. Usamos animate-in fade-in.
      // Esto hace que el fondo aparezca suavemente, pero una vez que termina, 
      // el navegador deja de monitorear cambios de opacidad, liberando el CPU.
      className={`fixed inset-0 ${zClass} bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500`}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Cerrar modal"
        onClick={onClose}
        className="absolute inset-0 cursor-default w-full h-full bg-transparent border-none outline-none"
      />

      {/* 🚨 FIX 2: ELIMINAMOS transform-gpu.
          La animación zoom-in ya usa "transform" de forma temporal. 
          Al quitar transform-gpu, evitamos que todo el modal se convierta en una sola textura rígida,
          permitiendo que el scroll interno del UnifiedModal se procese de forma independiente y nativa. */}
      <div
        className={`relative w-full ${maxWidthClass} animate-in fade-in zoom-in-95 duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}