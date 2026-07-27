import { MotionConfig } from 'framer-motion';
import { useMotionConfig } from '../hooks/useMotionConfig';

/**
 * MotionProvider — aplica la política de movimiento a TODO el árbol de
 * framer-motion de una sola vez (D2.4, 2026-07-26).
 *
 * Cierra S1.6 de la auditoría: `prefers-reduced-motion` estaba resuelto para
 * las 18 clases CSS que enumera DESIGN.md §25, pero la media query de CSS no
 * detiene animación manejada por JS. Los 25 archivos con framer-motion la
 * ignoraban por completo — `useReducedMotion` tenía 0 usos en el proyecto.
 *
 * `reducedMotion="user"` hace que framer-motion respete la preferencia del
 * sistema en cada componente descendiente, sin tocar los 25 archivos uno por
 * uno. Es la diferencia entre resolver el problema y parchear sus síntomas:
 * cualquier `motion.*` que se agregue mañana queda cubierto solo.
 *
 * `transition` fija el default por tema — Liquid con spring, Solid corto y
 * lineal — así que un `motion.div` sin `transition` propia ya se comporta
 * según el eje expresivo/eficiente sin que su autor tenga que saberlo.
 * Los componentes que necesiten control fino siguen pudiendo pedir
 * `useMotionConfig()` directamente.
 *
 * Va DENTRO de ThemeProvider: necesita leer el tema activo.
 */
export default function MotionProvider({ children }) {
  const m = useMotionConfig();
  return (
    <MotionConfig reducedMotion="user" transition={m.spring}>
      {children}
    </MotionConfig>
  );
}
