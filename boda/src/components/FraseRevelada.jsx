import { useRef } from 'react';
import { useProgresoScroll, sinMovimiento } from '../lib/movimiento';

/** Un párrafo cuyas palabras se iluminan una a una mientras se lee al bajar. */
export default function FraseRevelada({ texto, className = '' }) {
  const ref = useRef(null);
  const palabras = texto.split(/\s+/);
  useProgresoScroll(ref, (p) => {
    ref.current.style.setProperty('--p', sinMovimiento() ? 1 : Math.min(1, p * 1.6));
  }, { inicio: 0.9, fin: 0.35 });
  return (
    <p ref={ref} className={`frase-revelada ${className}`} style={{ '--n': palabras.length }} aria-label={texto}>
      {palabras.map((w, i) => <span key={i} aria-hidden style={{ '--i': i }}>{w} </span>)}
    </p>
  );
}
