import { useEffect, useRef } from 'react';
import { esVideo } from '../lib/api';
import { t, rotuloMomento } from '../lib/idioma';
import { useDialogo } from '../lib/dialogo';

/**
 * Visor a pantalla completa con flechas, teclado y deslizar. Es un <dialog>
 * modal: el resto queda inerte, Esc lo cierra y el foco vuelve a la foto
 * tocada. El efecto del teclado se monta una sola vez (lee lo último por ref).
 */
export default function Visor({ items, indice, alCambiar, alCerrar }) {
  const it = items[indice];
  const dialogo = useRef(null);
  const ultimo = useRef({});
  ultimo.current = { items, indice, alCambiar, alCerrar };
  const x0 = useRef(null);
  useDialogo(dialogo);
  const mover = (paso) => {
    const u = ultimo.current;
    u.alCambiar((u.indice + paso + u.items.length) % u.items.length);
  };
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'ArrowRight') mover(1);
      if (e.key === 'ArrowLeft') mover(-1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!it) return null;
  return (
    <dialog
      ref={dialogo} className="visor" aria-label={t('Foto del álbum', 'Album photo')}
      onCancel={(e) => { e.preventDefault(); alCerrar(); }}
      onClick={alCerrar}
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (x0.current == null) return;
        const dx = e.changedTouches[0].clientX - x0.current;
        x0.current = null;
        if (Math.abs(dx) > 50) mover(dx < 0 ? 1 : -1);
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {esVideo(it.ruta) ? <video src={it.url} controls autoPlay playsInline /> : <img src={it.url} alt="" />}
        {(it.autor || it.momento) && (
          <div className="info">{[it.momento && rotuloMomento(it.momento), it.autor && `${t('por', 'by')} ${it.autor}`].filter(Boolean).join(' · ')}
            {' · '}<a href={it.url} download target="_blank" rel="noreferrer" style={{ color: 'var(--oliva-claro)' }}>{t('descargar', 'download')}</a>
          </div>
        )}
      </div>
      <button type="button" className="cerrar" aria-label={t('Cerrar', 'Close')} onClick={alCerrar}>×</button>
      {items.length > 1 && <>
        <button type="button" className="flecha izq" aria-label={t('Anterior', 'Previous')} onClick={(e) => { e.stopPropagation(); mover(-1); }}>‹</button>
        <button type="button" className="flecha der" aria-label={t('Siguiente', 'Next')} onClick={(e) => { e.stopPropagation(); mover(1); }}>›</button>
      </>}
    </dialog>
  );
}
