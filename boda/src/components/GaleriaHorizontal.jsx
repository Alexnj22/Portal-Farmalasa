import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/idioma';
import Visor from './Visor';
import { imagenAdaptable, conAncho, ANCHOS_GALERIA } from '../lib/fotos';

/**
 * Las fotos de los novios en una tira que se desliza de lado con el dedo
 * (scroll nativo con imán). En computadora, flechas. La barra marca el avance.
 */
export default function GaleriaHorizontal({ titulo, fotos }) {
  const pista = useRef(null);
  const barra = useRef(null);
  const [abierta, setAbierta] = useState(null);
  const [extremos, setExtremos] = useState({ inicio: true, fin: false });
  // Al llegar a la vista, las fotos entran como tinta y un destello las cruza
  // (el mismo lenguaje del Save the Date). Una vez.
  const seccion = useRef(null);
  const [vista, setVista] = useState(false);
  useEffect(() => {
    const el = seccion.current;
    if (!el || !('IntersectionObserver' in window)) { setVista(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVista(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const alDeslizar = () => {
    const el = pista.current;
    const max = el.scrollWidth - el.clientWidth;
    const q = max > 0 ? el.scrollLeft / max : 0;
    if (barra.current) barra.current.style.transform = `scaleX(${Math.max(0.08, q)})`;
    const inicio = el.scrollLeft < 8; const fin = el.scrollLeft > max - 8;
    if (inicio !== extremos.inicio || fin !== extremos.fin) setExtremos({ inicio, fin });
  };
  const mover = (dir) => {
    const el = pista.current;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const items = fotos.map((original) => ({ original, url: conAncho(original, 1800) }));
  return (
    <section id="fotos" ref={seccion} className={`galeria-h ${vista ? 'vista' : ''}`}>
      <div className="contenedor galeria-cabeza">
        <h2>{titulo}</h2>
        <div className="flechas">
          <button type="button" onClick={() => mover(-1)} disabled={extremos.inicio} aria-label={t('Fotos anteriores', 'Previous photos')}>←</button>
          <button type="button" onClick={() => mover(1)} disabled={extremos.fin} aria-label={t('Más fotos', 'More photos')}>→</button>
        </div>
      </div>
      <div className="pista" ref={pista} onScroll={alDeslizar}>
        {items.map((f, n) => (
          <button type="button" key={f.original} className={`foto-h ${n % 3 === 1 ? 'ancha' : ''}`} style={{ '--i': n }} onClick={() => setAbierta(n)} aria-label={t(`Ver foto ${n + 1}`, `View photo ${n + 1}`)}>
            <img {...imagenAdaptable(f.original, ANCHOS_GALERIA, '(min-width: 720px) 48vw, 88vw')} alt="" loading="lazy" decoding="async" />
            <span className="num">{String(n + 1).padStart(2, '0')}</span>
          </button>
        ))}
      </div>
      <div className="contenedor galeria-pie">
        <div className="progreso"><div ref={barra} /></div>
        <span className="versalita">{extremos.fin ? t('Toca una foto para verla', 'Tap a photo to view it') : t('Desliza para ver más →', 'Swipe for more →')}</span>
      </div>
      {abierta != null && <Visor items={items} indice={abierta} alCambiar={setAbierta} alCerrar={() => setAbierta(null)} />}
    </section>
  );
}
