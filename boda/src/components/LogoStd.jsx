import { useLayoutEffect, useRef } from 'react';
import { SOLIDO, TRAZOS } from './logoStdTrazos';

// La pieza del diseñador, tal cual: un renglón de 753 × 139, un color.
const VISTA = '0 0 753.14 138.64';

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
      <svg viewBox={VISTA} aria-hidden focusable="false">
        <defs>
          <clipPath id="std-forma"><path d={SOLIDO} transform="translate(0.5 0.5)" /></clipPath>
          <linearGradient id="std-luz" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="std-solido" transform="translate(0.5 0.5)"><path d={SOLIDO} /></g>
        {/* Un destello que cruza la tinta recién puesta. */}
        <g clipPath="url(#std-forma)"><rect className="std-destello" x="-180" y="-20" width="160" height="180" fill="url(#std-luz)" /></g>
        <g className="std-contorno">
          {TRAZOS.map(([, d], i) => <path key={i} d={d} pathLength="1" />)}
        </g>
      </svg>
    </span>
  );
}
