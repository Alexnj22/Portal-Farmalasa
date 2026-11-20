import { useEffect, useRef } from 'react';
import { SOLIDO, TRAZOS } from './logoStdTrazos';

// La pieza del diseñador, tal cual: un renglón de 753 × 139, un color.
const VISTA = '0 0 753.14 138.64';

/**
 * «Save THE Date» del diseñador: el contorno (Recurso 5) se dibuja de
 * izquierda a derecha como escrito a mano y después entra el sólido
 * (Recurso 4). El dibujo sólo corre con html.std-intro (la primera carga);
 * si no, se ve directamente el sólido.
 */
const NS = 'http://www.w3.org/2000/svg';
const ESCRITURA = 1900; // ms que tarda la pluma en escribir todo
const INICIO = 250;

/**
 * La pluma: una sola punta encendida recorre los trazos uno detrás de otro,
 * de izquierda a derecha y a velocidad pareja (cada trazo dura lo que mide),
 * dejando la línea dorada y soltando chispas de luz. Corre en la primera
 * carga (html.std-intro), que Inicio marca antes de este efecto.
 */
function escribir(svg) {
  const trazos = [...svg.querySelectorAll('.std-contorno path')]
    .map((p) => ({ p, x: p.getBBox().x, largo: p.getTotalLength() }))
    .sort((a, b) => a.x - b.x);
  const total = trazos.reduce((s, t) => s + t.largo, 0) || 1;
  let t = INICIO;
  trazos.forEach((tr) => {
    tr.dura = Math.max(90, ESCRITURA * (tr.largo / total));
    tr.desde = t;
    t += tr.dura * 0.92; // se encadenan, apenas montados
    // Largos reales (pathLength="1" deja restos visibles en trazos complejos).
    const l = (tr.largo + 2).toFixed(1);
    tr.p.style.strokeDasharray = `${l} ${l}`;
    tr.anim = tr.p.animate([{ strokeDashoffset: l }, { strokeDashoffset: 0 }],
      { duration: tr.dura, delay: tr.desde, easing: 'cubic-bezier(.35, 0, .65, 1)', fill: 'both' });
  });
  const fin = t + 120;

  const chispas = document.createElementNS(NS, 'g');
  chispas.setAttribute('class', 'std-chispas');
  const punta = document.createElementNS(NS, 'circle');
  punta.setAttribute('class', 'std-punta');
  punta.setAttribute('r', '3.2');
  svg.appendChild(chispas);
  svg.appendChild(punta);

  const t0 = performance.now();
  let ultima = 0;
  let cuadro = 0;
  const paso = (ahora) => {
    const e = ahora - t0;
    if (e > fin) { punta.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }); return; }
    const tr = trazos.findLast((x) => e >= x.desde) || trazos[0];
    const q = Math.min(1, Math.max(0, (e - tr.desde) / tr.dura));
    // La misma curva que el trazo, para que la punta vaya justo en la tinta.
    const k = tr.anim.effect.getComputedTiming().progress ?? q;
    const pt = tr.p.getPointAtLength(k * tr.largo);
    punta.setAttribute('cx', pt.x.toFixed(1));
    punta.setAttribute('cy', pt.y.toFixed(1));
    punta.style.opacity = e < INICIO ? '0' : '1';
    if (e > INICIO && ahora - ultima > 26) {
      ultima = ahora;
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', pt.x.toFixed(1)); c.setAttribute('cy', pt.y.toFixed(1));
      c.setAttribute('r', (0.7 + Math.random() * 1.4).toFixed(2));
      chispas.appendChild(c);
      const dx = (Math.random() - 0.5) * 26; const dy = 6 + Math.random() * 22;
      c.animate([{ transform: 'translate(0,0)', opacity: 0.95 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }],
        { duration: 650 + Math.random() * 500, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'forwards' }).onfinish = () => c.remove();
    }
    cuadro = requestAnimationFrame(paso);
  };
  cuadro = requestAnimationFrame(paso);
  return () => { cancelAnimationFrame(cuadro); trazos.forEach((x) => x.anim.cancel()); chispas.remove(); punta.remove(); };
}

export default function LogoStd() {
  const raiz = useRef(null);
  useEffect(() => {
    const svg = raiz.current?.querySelector('svg');
    if (!svg || !document.documentElement.classList.contains('std-intro') || !svg.animate) return undefined;
    return escribir(svg);
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
          {TRAZOS.map(([, d], i) => <path key={i} d={d} />)}
        </g>
      </svg>
    </span>
  );
}
