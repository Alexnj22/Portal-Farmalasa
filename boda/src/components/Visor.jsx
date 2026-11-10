import { useEffect } from 'react';
import { esVideo } from '../lib/api';

/** Visor a pantalla completa con flechas, teclado y deslizar. */
export default function Visor({ items, indice, alCambiar, alCerrar }) {
  const it = items[indice];
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') alCerrar();
      if (e.key === 'ArrowRight') alCambiar((indice + 1) % items.length);
      if (e.key === 'ArrowLeft') alCambiar((indice - 1 + items.length) % items.length);
    };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [indice, items.length, alCambiar, alCerrar]);
  if (!it) return null;
  let x0 = null;
  return (
    <div
      className="visor" role="dialog" aria-modal="true" onClick={alCerrar}
      onTouchStart={(e) => { x0 = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 50) alCambiar((indice + (dx < 0 ? 1 : -1) + items.length) % items.length);
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {esVideo(it.ruta) ? <video src={it.url} controls autoPlay playsInline /> : <img src={it.url} alt="" />}
        {(it.autor || it.momento) && (
          <div className="info">{[it.momento, it.autor && `por ${it.autor}`].filter(Boolean).join(' · ')}
            {' · '}<a href={it.url} download target="_blank" rel="noreferrer" style={{ color: '#e9dcc6' }}>descargar</a>
          </div>
        )}
      </div>
      <button className="cerrar" aria-label="Cerrar" onClick={alCerrar}>×</button>
      {items.length > 1 && <>
        <button className="flecha izq" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); alCambiar((indice - 1 + items.length) % items.length); }}>‹</button>
        <button className="flecha der" aria-label="Siguiente" onClick={(e) => { e.stopPropagation(); alCambiar((indice + 1) % items.length); }}>›</button>
      </>}
    </div>
  );
}
