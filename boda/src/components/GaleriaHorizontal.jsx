import { useRef, useState } from 'react';
import { t } from '../lib/idioma';
import Visor from './Visor';

/**
 * Las fotos de los novios en una tira que se desliza de lado con el dedo
 * (scroll nativo con imán). En computadora, flechas. La barra marca el avance.
 */
export default function GaleriaHorizontal({ titulo, fotos }) {
  const pista = useRef(null);
  const barra = useRef(null);
  const [abierta, setAbierta] = useState(null);
  const [extremos, setExtremos] = useState({ inicio: true, fin: false });

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

  const items = fotos.map((url) => ({ url }));
  return (
    <section id="fotos" className="galeria-h">
      <div className="contenedor galeria-cabeza">
        <h2>{titulo}</h2>
        <div className="flechas">
          <button type="button" onClick={() => mover(-1)} disabled={extremos.inicio} aria-label={t('Fotos anteriores', 'Previous photos')}>←</button>
          <button type="button" onClick={() => mover(1)} disabled={extremos.fin} aria-label={t('Más fotos', 'More photos')}>→</button>
        </div>
      </div>
      <div className="pista" ref={pista} onScroll={alDeslizar}>
        {items.map((f, n) => (
          <button type="button" key={f.url} className={`foto-h ${n % 3 === 1 ? 'ancha' : ''}`} onClick={() => setAbierta(n)} aria-label={t(`Ver foto ${n + 1}`, `View photo ${n + 1}`)}>
            <img src={f.url} alt="" loading={n < 3 ? 'eager' : 'lazy'} decoding="async" />
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
