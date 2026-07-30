import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Lo que un diálogo debe poder enfocar. `[tabindex="-1"]` queda fuera a
// propósito: es enfocable por código, no por Tab.
const ENFOCABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]',
].join(',');

const visible = (el) => {
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

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
 *   align            – "center" (default) | "top" para paletas de comandos |
 *                      "bottom" para hojas táctiles (entran deslizando desde
 *                      abajo y llegan a los bordes: sin padding en el
 *                      contenedor, el panel pone el suyo)
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
// esperar la misma animación se siente lento. Es el TOPE de vida del panel tras
// `open=false`, no la duración de la animación: esa la puede acortar el tema
// (`[data-theme="solid"] .animate-out { animation-duration: 130ms }`) o
// `prefers-reduced-motion` (120ms !important), y desde JS no hay forma de
// saberlo. Por eso la salida ya no depende de que los dos números coincidan
// —ver `fill-mode-forwards` abajo—: si divergen, no se ve.
const EXIT_MS = 180;

// Los keyframes `exit` de tw-animate-css son solo `to`, y el shorthand
// `--animate-out` trae `var(--tw-animation-fill-mode, none)`. Sin declarar el
// fill-mode, en cuanto la animación TERMINA el elemento vuelve a su estado
// natural: opacidad 1, sin transform. Y como el tema la acorta a 130ms mientras
// el desmontaje espera 180ms, quedaba una ventana de ~50ms en la que el modal
// —ya desvanecido— reaparecía entero y después desaparecía de golpe. Medido el
// 2026-07-29 sobre el modal de lote: opacidad 1.00 → 0.02 → **1.00** → nodo
// removido. Eso es lo que se reportaba como "al cerrarlo se abre y cierra dos
// veces": no había doble montaje (el MutationObserver ve un ADD y un DEL), era
// este rebote.
//
// `fill-mode-forwards` hace que la salida SOSTENGA su último fotograma hasta
// que el nodo se va, y de paso vuelve inofensiva cualquier divergencia futura
// entre la duración de la animación y EXIT_MS.
const HOLD_EXIT = "fill-mode-forwards";

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
  const panelRef = useRef(null);
  const disparadorRef = useRef(null);

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
      if (e.key === "Escape") {
        if (closeOnEsc) onClose?.();
        return;
      }
      // Trampa de foco: dentro de un diálogo modal, Tab no puede salir a la
      // página de atrás — que sigue ahí, con todos sus controles enfocables e
      // invisibles bajo el scrim. Escape es la salida, y siempre está.
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const f = [...panel.querySelectorAll(ENFOCABLES)].filter(visible);
      if (!f.length) { e.preventDefault(); panel.focus(); return; }
      const primero = f[0], ultimo = f[f.length - 1];
      if (!panel.contains(document.activeElement)) { e.preventDefault(); primero.focus(); return; }
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
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

  // Foco: entrar al abrir, y VOLVER al disparador al cerrar.
  // Lo segundo es lo que más se olvida y lo que más se nota: sin eso, cerrar un
  // modal con teclado deja el foco en el `<body>` y la siguiente tabulación
  // arranca desde el principio de la página. Medido el 2026-07-29 antes de este
  // cambio: `document.activeElement` era BODY tras cerrar los 6 modales.
  useEffect(() => {
    if (!open) return undefined;
    disparadorRef.current = document.activeElement;

    const t = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return; // un autoFocus ya lo movió
      const f = [...panel.querySelectorAll(ENFOCABLES)].filter(visible);
      (f[0] || panel).focus();
    }, 60);

    return () => {
      clearTimeout(t);
      const previo = disparadorRef.current;

      // Se difiere un tick: varios modales del portal se despachan desde
      // `UnifiedModal`, que al cerrar **se desmonta entero** y hace re-render
      // de la vista de atrás. Enfocando en el mismo tick, React reemplazaba el
      // nodo del disparador justo después y el foco caía al `<body>` igual.
      // Medido el 2026-07-29: 3 de 11 diálogos terminaban en BODY por esto.
      setTimeout(() => {
        if (previo && typeof previo.focus === 'function' && previo.isConnected) {
          previo.focus({ preventScroll: true });
        }
      }, 0);

      // Segunda pasada DESPUÉS de que el panel se desmonta.
      // La primera versión de este respaldo comprobaba "¿el foco quedó en el
      // body?" en el mismo tick, y ahí todavía no: el panel sigue montado
      // `EXIT_MS` por la animación de salida, así que el foco seguía adentro,
      // la comprobación salía temprano, y recién al desmontarse el navegador lo
      // mandaba al body. Los 3 diálogos que fallaban seguían fallando.
      // Ahora se corre cuando el panel ya no existe.
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        // El disparador no sobrevivió (lo reemplazó un re-render, o la vista
        // cambió). Antes que dejar el foco en `<body>` —donde la próxima
        // tabulación arranca desde el principio de la página, pasando otra vez
        // por todo el menú— se lo lleva al contenido, que es lo que recomienda
        // la APG de WAI-ARIA cuando el disparador no sobrevive.
        if (previo && typeof previo.focus === 'function' && previo.isConnected) {
          previo.focus({ preventScroll: true });
          return;
        }
        const main = document.querySelector('main') || document.querySelector('[role="main"]');
        if (!main) return;
        const habiaTabIndex = main.hasAttribute('tabindex');
        if (!habiaTabIndex) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
        if (!habiaTabIndex) {
          // se quita en cuanto suelta el foco: un `<main>` permanentemente
          // enfocable ensucia el recorrido de teclado del resto de la app
          main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
        }
      }, EXIT_MS + 40);
    };
  }, [open]);

  if (!open && !mounted) return null;

  // Entrada y salida salen de tw-animate-css (ver el @import comentado en
  // index.css). Los dos gates de movimiento las alcanzan: en Solid duran
  // 130ms lineales y con prefers-reduced-motion pierden la geometría y queda
  // solo el fade.
  const backdropAnim = open ? "animate-in fade-in duration-500" : `animate-out fade-out duration-150 ${HOLD_EXIT}`;
  // Una hoja inferior no hace zoom: sube y baja. Es la misma distinción que el
  // resto del sistema hace entre movimiento decorativo y movimiento que dice de
  // dónde viene la cosa.
  const esHoja = align === "bottom";
  const panelAnim = open
    ? (esHoja ? "animate-in slide-in-from-bottom duration-300" : "animate-in fade-in zoom-in-95 duration-300")
    : (esHoja ? `animate-out slide-out-to-bottom duration-200 ${HOLD_EXIT}` : `animate-out fade-out zoom-out-95 duration-150 ${HOLD_EXIT}`);
  const alignCls =
    align === "top"    ? "items-start justify-center pt-[10vh] px-4" :
    align === "bottom" ? "items-end justify-center" :
                         "items-center justify-center p-4 sm:p-6";

  return createPortal(
    <div
      // 🚨 FIX 1: Quitamos transition-all. Usamos animate-in fade-in.
      // Esto hace que el fondo aparezca suavemente, pero una vez que termina,
      // el navegador deja de monitorear cambios de opacidad, liberando el CPU.
      className={`fixed inset-0 ${zClass} bg-scrim backdrop-blur-sm flex ${alignCls} ${backdropAnim}`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/* El fondo es una afordancia de MOUSE: duplica lo que Escape ya hace,
          así que va fuera del árbol de accesibilidad y fuera de Tab. Dejarlo
          tabulable metía una parada de foco invisible antes del contenido del
          diálogo — el mismo criterio que los chevrons de §25.9. */}
      {closeOnBackdrop && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onClose}
          className="absolute inset-0 cursor-default w-full h-full bg-transparent border-none outline-none"
        />
      )}

      {/* 🚨 FIX 2: ELIMINAMOS transform-gpu.
          La animación zoom-in ya usa "transform" de forma temporal.
          Al quitar transform-gpu, evitamos que todo el modal se convierta en una sola textura rígida,
          permitiendo que el scroll interno del UnifiedModal se procese de forma independiente y nativa. */}
      <div
        ref={panelRef}
        // `tabIndex={-1}`: destino de respaldo del foco cuando el diálogo no
        // tiene ningún control adentro (un visor, una confirmación sin botones).
        tabIndex={-1}
        data-surface={surface || undefined}
        className={`relative w-full ${maxWidthClass} ${panelAnim} ease-[cubic-bezier(0.23,1,0.32,1)] outline-none ${panelClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
