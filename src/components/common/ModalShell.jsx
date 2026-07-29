import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Envoltura canónica de TODO modal del portal (DESIGN.md §14).
 *
 * Da las cuatro cosas que un modal escrito a mano casi siempre olvida:
 * `role="dialog"` + `aria-modal` (sin eso un lector de pantalla no anuncia un
 * diálogo, solo contenido que apareció al final del `<body>`), cierre con
 * Escape, bloqueo de scroll que RESTAURA el valor previo, y la entrada/salida
 * animada que D2.4 clasifica como movimiento funcional.
 *
 * Props:
 *   open             – visibilidad controlada
 *   onClose          – Escape y clic en el fondo
 *   maxWidthClass    – ancho máximo del panel (default max-w-lg)
 *   zClass           – capa de apilamiento (default z-modal)
 *   closeOnEsc       – default true
 *   closeOnBackdrop  – default true. En false el fondo deja de ser un botón:
 *                      lo usa el editor de fotos, donde un clic afuera durante
 *                      un recorte tira el trabajo sin confirmación.
 *   lockScroll       – default true
 *   align            – "center" (default) | "top" para paletas de comandos
 *   surface          – data-surface del panel (default "modal"; el ⌘K usa
 *                      "dropdown", que es lo que ese material es). En `null`
 *                      el panel no declara superficie: para los consumidores
 *                      que ya la ponen en su propio hijo y si no quedarían con
 *                      dos vidrios apilados.
 *   panelClassName   – clases extra sobre el panel (p. ej. `overflow-hidden`,
 *                      que es lo que hace que el radio recorte al contenido)
 *   ariaLabel        – nombre accesible; pasar SIEMPRE el título real
 */

// La salida dura menos que la entrada: al cerrar, el usuario ya decidió y
// esperar la misma animación se siente lento. Sincronizado con el timeout que
// desmonta — si divergen, el panel se congela visible o desaparece de golpe.
const EXIT_MS = 180;

export default function ModalShell({
  open,
  onClose,
  children,
  maxWidthClass = "max-w-lg",
  zClass = "z-modal",
  closeOnEsc = true,
  closeOnBackdrop = true,
  lockScroll = true,
  align = "center",
  surface = "modal",
  panelClassName = "",
  ariaLabel = "Ventana modal",
}) {
  // `mounted` sobrevive a `open=false` el tiempo de la animación de salida.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta en respuesta a `open`; el estado ES la animación de entrada
      return undefined;
    }
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

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

  if (!open && !mounted) return null;

  // Entrada y salida salen de tw-animate-css (ver el @import comentado en
  // index.css). Los dos gates de movimiento las alcanzan: en Solid duran
  // 130ms lineales y con prefers-reduced-motion pierden la geometría y queda
  // solo el fade.
  const backdropAnim = open ? "animate-in fade-in duration-500" : "animate-out fade-out duration-150";
  const panelAnim = open
    ? "animate-in fade-in zoom-in-95 duration-300"
    : "animate-out fade-out zoom-out-95 duration-150";

  return createPortal(
    <div
      // 🚨 FIX 1: Quitamos transition-all. Usamos animate-in fade-in.
      // Esto hace que el fondo aparezca suavemente, pero una vez que termina,
      // el navegador deja de monitorear cambios de opacidad, liberando el CPU.
      className={`fixed inset-0 ${zClass} bg-scrim backdrop-blur-sm flex ${
        align === "top" ? "items-start justify-center pt-[10vh] px-4" : "items-center justify-center p-4 sm:p-6"
      } ${backdropAnim}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {closeOnBackdrop && (
        <button
          type="button"
          aria-label="Cerrar modal"
          onClick={onClose}
          className="absolute inset-0 cursor-default w-full h-full bg-transparent border-none outline-none"
        />
      )}

      {/* 🚨 FIX 2: ELIMINAMOS transform-gpu.
          La animación zoom-in ya usa "transform" de forma temporal.
          Al quitar transform-gpu, evitamos que todo el modal se convierta en una sola textura rígida,
          permitiendo que el scroll interno del UnifiedModal se procese de forma independiente y nativa. */}
      <div
        data-surface={surface || undefined}
        className={`relative w-full ${maxWidthClass} ${panelAnim} ease-[cubic-bezier(0.23,1,0.32,1)] ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
