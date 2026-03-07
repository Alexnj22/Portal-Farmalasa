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
      // 🚨 OVERLAY NEUTRO Y OSCURECIDO: Eliminamos el tinte gris (slate). Usamos pura sombra (negro) a muy baja opacidad.
      // 🚨 Esto oscurecerá el fondo (contraste) pero mantendrá la saturación y los matices cian/morado intactos.
      // 🚨 Mantenemos CERO blur para no ensuciar la refracción del cristal del modal.
      className={`fixed inset-0 ${zClass} bg-black/[0.06] flex items-center justify-center p-4 sm:p-6 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]`}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Cerrar modal"
        onClick={onClose}
        className="absolute inset-0 cursor-default w-full h-full"
      />

      {/* 🚨 CONTENEDOR DESNUDO: Animación premium idéntica */}
      <div
        className={`relative w-full ${maxWidthClass} animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}