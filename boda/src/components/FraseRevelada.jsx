import { useRef } from 'react';
import { useProgresoScroll, sinMovimiento } from '../lib/movimiento';

/** Un párrafo cuyas palabras se iluminan una a una mientras se lee al bajar. */
export default function FraseRevelada({ texto, className = '' }) {
  const ref = useRef(null);
  const palabras = texto.split(/\s+/);
  // Con animation-timeline: view() lo hace el CSS; sin movimiento, todas encendidas.
  // Sólo en los demás navegadores se mide en cada cuadro de scroll.
  const porJs = typeof CSS !== 'undefined' && !CSS.supports?.('animation-timeline: view()') && !sinMovimiento();
  useProgresoScroll(ref, (p) => {
    ref.current?.style.setProperty('--p', Math.min(1, p * 1.6));
  }, { inicio: 0.9, fin: 0.35, activo: porJs });
  return (
    <p ref={ref} className={`frase-revelada ${className}`} style={{ '--n': palabras.length }} aria-label={texto}>
      {palabras.map((w, i) => <span key={i} aria-hidden style={{ '--i': i }}>{w} </span>)}
    </p>
  );
}
