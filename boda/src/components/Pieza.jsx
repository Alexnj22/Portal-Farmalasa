import { PIEZAS } from './piezasTrazos';

/**
 * Una pieza de letra del diseñador (disenio/*.svg), tal cual, en el color del
 * texto que la rodea. `texto` es lo que dice: lo lee el lector de pantalla.
 */
export default function Pieza({ nombre, texto, className = '' }) {
  const p = PIEZAS[nombre];
  return (
    <svg className={`pieza pieza-${nombre} ${className}`} viewBox={p.vista} role="img" aria-label={texto} focusable="false">
      {p.d.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
