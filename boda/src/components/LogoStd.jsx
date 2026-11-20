import { useEffect, useRef } from 'react';
import { SOLIDO, TRAZOS } from './logoStdTrazos';
import { escribir, animarValor } from '../lib/pluma';

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
  useEffect(() => {
    const svg = raiz.current?.querySelector('svg');
    if (!svg || !document.documentElement.classList.contains('std-intro') || !svg.animate) return undefined;
    // La tinta (el sólido) sigue a la pluma: un <mask> cuyo rectángulo crece
    // de izquierda a derecha con el borde suave.
    const tinta = svg.querySelector('.std-tinta');
    const parar = animarValor((w) => tinta.setAttribute('width', w.toFixed(1)), { desde: 0, hasta: 1100, duracion: 1900, retraso: 700 });
    const limpiar = escribir(svg, { selector: '.std-contorno path', escritura: 1900, inicio: 250 });
    return () => { parar(); limpiar(); tinta.setAttribute('width', '1100'); };
  }, []);
  return (
    <span className="std-logo" ref={raiz}>
      <svg viewBox={VISTA} aria-hidden focusable="false">
        <defs>
          <clipPath id="std-forma"><path d={SOLIDO} transform="translate(0.5 0.5)" /></clipPath>
          <linearGradient id="std-borde" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0.86" stopColor="#fff" />
            <stop offset="1" stopColor="#000" />
          </linearGradient>
          <mask id="std-mascara" maskUnits="userSpaceOnUse" x="-20" y="-20" width="1140" height="180">
            <rect className="std-tinta" x="-20" y="-20" width="1100" height="180" fill="url(#std-borde)" />
          </mask>
          <linearGradient id="std-luz" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="std-solido" transform="translate(0.5 0.5)" mask="url(#std-mascara)"><path d={SOLIDO} /></g>
        {/* Un destello que cruza la tinta recién puesta. */}
        <g clipPath="url(#std-forma)"><rect className="std-destello" x="-180" y="-20" width="160" height="180" fill="url(#std-luz)" /></g>
        <g className="std-contorno">
          {TRAZOS.map(([, d], i) => <path key={i} d={d} />)}
        </g>
      </svg>
    </span>
  );
}
