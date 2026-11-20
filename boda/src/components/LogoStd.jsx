import { useLayoutEffect, useRef } from 'react';
import { SOLIDO, TRAZOS } from './logoStdTrazos';

// La pieza del diseñador mide 752 × 138 y va en un renglón. Aquí se corta en
// dos ventanas del mismo dibujo (viewBox): «Save THE» arriba y «Date» abajo,
// como la composición de la portada. Nada se redibuja: sólo se encuadra.
const CORTE = 440;
const ALTO = 138.64;
const RENGLONES = [
  { clase: 'l1', x: 0, ancho: CORTE },
  { clase: 'l2', x: CORTE, ancho: 753.14 - CORTE },
];
// «THE» (entre «Save» y «Date») va en beige.
const THE = { x: 290, ancho: CORTE - 290 };

/**
 * «Save THE Date» del diseñador: el contorno (Recurso 5) se dibuja de
 * izquierda a derecha como escrito a mano y después entra el sólido
 * (Recurso 4). El dibujo sólo corre con html.std-intro (la primera carga);
 * si no, se ve directamente el sólido.
 */
export default function LogoStd() {
  const raiz = useRef(null);
  // Cada trazo arranca según dónde empieza a la izquierda: se escribe en orden.
  useLayoutEffect(() => {
    raiz.current?.querySelectorAll('.std-contorno path').forEach((p) => {
      try {
        const x = p.getBBox().x;
        p.style.setProperty('--t', (x / 753).toFixed(3));
      } catch { /* sin layout (oculto): queda en 0 */ }
    });
  }, []);
  return (
    <span className="std-logo" ref={raiz}>
      {RENGLONES.map((r) => (
        <svg key={r.clase} className={r.clase} viewBox={`${r.x} 0 ${r.ancho} ${ALTO}`} aria-hidden focusable="false">
          <defs>
            <clipPath id={`the-${r.clase}`}><rect x={THE.x} y="0" width={THE.ancho} height={ALTO} /></clipPath>
          </defs>
          <g className="std-solido" transform="translate(0.5 0.5)">
            <path d={SOLIDO} />
            <path className="std-the-solido" d={SOLIDO} clipPath={`url(#the-${r.clase})`} />
          </g>
          <g className="std-contorno">
            {TRAZOS.map(([, d], i) => <path key={i} d={d} pathLength="1" />)}
          </g>
        </svg>
      ))}
    </span>
  );
}
