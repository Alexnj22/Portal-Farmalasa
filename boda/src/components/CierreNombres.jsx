import { useEffect, useRef, useState } from 'react';
import { PIEZAS } from './piezasTrazos';
import { escribir } from '../lib/pluma';
import { sinMovimiento } from '../lib/movimiento';

/**
 * El cierre de la página: los nombres apilados del diseñador y su ornamento
 * debajo. Al llegar a la vista, los nombres entran como tinta y el ornamento
 * lo escribe la pluma del Save the Date (punta de luz y chispas) y la tinta lo
 * llena; después queda fijo y, cada tanto, un destello lo recorre.
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
  // El ornamento lo escribe la misma pluma del Save the Date, con sus chispas,
  // apenas los nombres terminan de entrar.
  const icono = useRef(null);
  useEffect(() => {
    if (!visto || !icono.current?.animate || sinMovimiento()) return undefined;
    let limpiar = null;
    const espera = setTimeout(() => { limpiar = escribir(icono.current, { selector: '.cierre-contorno path', escritura: 1700, inicio: 0 }); }, 1100);
    return () => { clearTimeout(espera); limpiar?.(); };
  }, [visto]);
  const n = PIEZAS.nombresApilados;
  // El ornamento sin su «&» (el quinto trazo del archivo del diseñador).
  const o = { ...PIEZAS.icono, d: PIEZAS.icono.d.slice(0, 4) };
  return (
    <div ref={raiz} className={`cierre ${visto ? 'visto' : ''}`} role="img" aria-label={texto}>
      <svg className="cierre-nombres" viewBox={n.vista} aria-hidden focusable="false">
        {n.d.map((d, i) => <path key={i} d={d} />)}
      </svg>
      <svg ref={icono} className="cierre-icono" viewBox={o.vista} aria-hidden focusable="false">
        <defs>
          <clipPath id="cierre-forma">{o.d.map((d, i) => <path key={i} d={d} />)}</clipPath>
          <linearGradient id="cierre-luz" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="cierre-trazo">{o.d.map((d, i) => <path key={i} d={d} />)}</g>
        <g className="cierre-contorno">{o.d.map((d, i) => <path key={i} d={d} />)}</g>
        <g clipPath="url(#cierre-forma)"><rect className="cierre-destello" x="-160" y="-20" width="140" height="300" fill="url(#cierre-luz)" /></g>
      </svg>
    </div>
  );
}
