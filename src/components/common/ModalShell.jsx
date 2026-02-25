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

    // Lock scroll (opcional pero recomendado)
    const prevOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (lockScroll) document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, closeOnEsc, lockScroll]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zClass} bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4`}
      role="dialog"
      aria-modal="true"
    >
      {/* Click fuera */}
      <button
        type="button"
        aria-label="Cerrar modal"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />

      {/* Card */}
      <div
        className={`relative w-full ${maxWidthClass} bg-white rounded-[2rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}