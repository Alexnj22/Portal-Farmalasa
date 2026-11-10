import { useEffect } from 'react';

export const sinMovimiento = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Llama a `alMover(progreso, rect)` en cada cuadro en que la página se
 * desplaza, con el progreso del elemento a través de la pantalla (0 → 1).
 * Un solo requestAnimationFrame por cuadro; sólo escribe transform/opacidad.
 */
export function useProgresoScroll(ref, alMover, { inicio = 1, fin = 0 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let cuadro = 0;
    const medir = () => {
      cuadro = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 cuando el borde superior está en `inicio`·vh; 1 cuando el inferior llega a `fin`·vh
      const total = r.height + vh * (inicio - fin);
      const p = Math.min(1, Math.max(0, (vh * inicio - r.top) / total));
      alMover(p, r, vh);
    };
    const pedir = () => { if (!cuadro) cuadro = requestAnimationFrame(medir); };
    medir();
    window.addEventListener('scroll', pedir, { passive: true });
    window.addEventListener('resize', pedir);
    return () => { window.removeEventListener('scroll', pedir); window.removeEventListener('resize', pedir); cancelAnimationFrame(cuadro); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
