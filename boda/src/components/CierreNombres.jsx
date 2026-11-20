import { useEffect, useRef, useState } from 'react';
import { PIEZAS } from './piezasTrazos';

/**
 * El cierre de la página: los nombres apilados del diseñador y su ornamento
 * debajo. Al llegar a la vista, los nombres entran como tinta y el ornamento
 * se abre desde el centro hacia los lados; después, cada tanto, un destello
 * lo recorre.
 */
export default function CierreNombres({ texto }) {
  const raiz = useRef(null);
  const [visto, setVisto] = useState(false);
  useEffect(() => {
    const el = raiz.current;
    if (!el || !('IntersectionObserver' in window)) { setVisto(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisto(true); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const n = PIEZAS.nombresApilados;
  const o = PIEZAS.icono;
  return (
    <div ref={raiz} className={`cierre ${visto ? 'visto' : ''}`} role="img" aria-label={texto}>
      <svg className="cierre-nombres" viewBox={n.vista} aria-hidden focusable="false">
        {n.d.map((d, i) => <path key={i} d={d} />)}
      </svg>
      <svg className="cierre-icono" viewBox={o.vista} aria-hidden focusable="false">
        <defs>
          <clipPath id="cierre-forma">{o.d.map((d, i) => <path key={i} d={d} />)}</clipPath>
          <linearGradient id="cierre-luz" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="cierre-trazo">{o.d.map((d, i) => <path key={i} d={d} />)}</g>
        <g clipPath="url(#cierre-forma)"><rect className="cierre-destello" x="-160" y="-20" width="140" height="300" fill="url(#cierre-luz)" /></g>
      </svg>
    </div>
  );
}
