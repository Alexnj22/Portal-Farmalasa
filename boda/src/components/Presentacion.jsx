import { useEffect, useRef, useState } from 'react';
import { boda } from '../config';
import { esVideo } from '../lib/api';
import { t } from '../lib/idioma';
import { sinMovimiento } from '../lib/movimiento';
import { useDialogo } from '../lib/dialogo';
import { alternarMusica, hayMusica, useMusica } from '../lib/sonido';

/**
 * Presentación de las fotos de los invitados: pantalla completa, cada foto con
 * un acercamiento lento (Ken Burns) y un fundido. Sin videos (se cortan mal).
 * Toques: izquierda = anterior, derecha = siguiente, centro = pausa.
 */
export default function Presentacion({ fotos, alCerrar }) {
  const lista = fotos.filter((f) => !esVideo(f.ruta));
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const { sonando } = useMusica(); // la misma música del sitio: no arranca otra
  const dialogo = useRef(null);
  const quieto = sinMovimiento();
  useDialogo(dialogo, { activo: lista.length > 0 });

  useEffect(() => {
    if (pausa || lista.length < 2) return undefined;
    const t0 = setTimeout(() => setI((n) => (n + 1) % lista.length), 5500);
    return () => clearTimeout(t0);
  }, [i, pausa, lista.length]);
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'ArrowRight') setI((n) => (n + 1) % lista.length);
      if (e.key === 'ArrowLeft') setI((n) => (n - 1 + lista.length) % lista.length);
      if (e.key === ' ') { e.preventDefault(); setPausa((p) => !p); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [lista.length]);
  // La siguiente se pide antes, para que el fundido no muestre un hueco.
  useEffect(() => { const n = lista[(i + 1) % lista.length]; if (n) new Image().src = n.url; }, [i, lista]);

  if (!lista.length) return null;
  const f = lista[i];
  const tocar = (e) => {
    const x = e.clientX / window.innerWidth;
    if (x < 0.3) setI((n) => (n - 1 + lista.length) % lista.length);
    else if (x > 0.7) setI((n) => (n + 1) % lista.length);
    else setPausa((p) => !p);
  };
  return (
    <dialog ref={dialogo} className="presentacion" aria-label={t('Presentación de fotos', 'Photo slideshow')} onClick={tocar}
      onCancel={(e) => { e.preventDefault(); alCerrar(); }}>
      <img key={`f${f.id}`} src={f.mini || f.url} alt="" className="diapositiva-fondo" aria-hidden />
      <img key={f.id} src={f.url} alt="" className={`diapositiva ${quieto ? '' : `kb${i % 4}`}`} />
      <div className="presentacion-pie">
        <span className="script">{boda.novios.firma}</span>
        {f.autor && <span>{t('Foto de', 'Photo by')} {f.autor}</span>}
        <span className="contador">{i + 1} / {lista.length}{pausa ? ` · ${t('en pausa', 'paused')}` : ''}</span>
      </div>
      <div className="presentacion-botones" onClick={(e) => e.stopPropagation()}>
        {hayMusica() && (
          <button type="button" aria-pressed={sonando} onClick={alternarMusica}
            aria-label={sonando ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>♪</button>
        )}
        {document.fullscreenEnabled && (
          <button type="button" onClick={() => (dialogo.current || document.documentElement).requestFullscreen?.().catch((e) => console.warn('Pantalla completa', e))} aria-label={t('Pantalla completa', 'Full screen')}>⤢</button>
        )}
        <button type="button" onClick={alCerrar} aria-label={t('Cerrar', 'Close')}>×</button>
      </div>
      <div className="presentacion-barra" key={`b${i}${pausa}`} style={{ animationPlayState: pausa ? 'paused' : 'running' }} />
    </dialog>
  );
}
