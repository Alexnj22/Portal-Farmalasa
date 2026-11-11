import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { boda } from '../config';
import { esVideo } from '../lib/api';
import { t } from '../lib/idioma';
import { sinMovimiento } from '../lib/movimiento';

/**
 * Presentación de las fotos de los invitados: pantalla completa, cada foto con
 * un acercamiento lento (Ken Burns) y un fundido. Sin videos (se cortan mal).
 * Toques: izquierda = anterior, derecha = siguiente, centro = pausa.
 */
export default function Presentacion({ fotos, alCerrar }) {
  const lista = fotos.filter((f) => !esVideo(f.ruta));
  const [i, setI] = useState(0);
  const [pausa, setPausa] = useState(false);
  const [musica, setMusica] = useState(false);
  const audio = useRef(null);
  const quieto = sinMovimiento();

  useEffect(() => {
    if (pausa || lista.length < 2) return undefined;
    const t0 = setTimeout(() => setI((n) => (n + 1) % lista.length), 5500);
    return () => clearTimeout(t0);
  }, [i, pausa, lista.length]);
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'Escape') alCerrar();
      if (e.key === 'ArrowRight') setI((n) => (n + 1) % lista.length);
      if (e.key === 'ArrowLeft') setI((n) => (n - 1 + lista.length) % lista.length);
      if (e.key === ' ') { e.preventDefault(); setPausa((p) => !p); }
    };
    window.addEventListener('keydown', tecla);
    document.documentElement.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', tecla); document.documentElement.style.overflow = ''; };
  }, [alCerrar, lista.length]);
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
  return createPortal(
    <div className="presentacion" role="dialog" aria-modal="true" aria-label={t('Presentación de fotos', 'Photo slideshow')} onClick={tocar}>
      <img key={`f${f.id}`} src={f.mini || f.url} alt="" className="diapositiva-fondo" aria-hidden />
      <img key={f.id} src={f.url} alt="" className={`diapositiva ${quieto ? '' : `kb${i % 4}`}`} />
      <div className="presentacion-pie">
        <span className="script">{boda.novios.firma}</span>
        {f.autor && <span>{t('Foto de', 'Photo by')} {f.autor}</span>}
        <span className="contador">{i + 1} / {lista.length}{pausa ? ` · ${t('en pausa', 'paused')}` : ''}</span>
      </div>
      <div className="presentacion-botones" onClick={(e) => e.stopPropagation()}>
        {boda.musica && <>
          <audio ref={audio} src={boda.musica} loop preload="none" />
          <button type="button" aria-pressed={musica} onClick={() => { if (musica) { audio.current.pause(); setMusica(false); } else audio.current.play().then(() => setMusica(true)).catch(() => {}); }}
            aria-label={musica ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>♪</button>
        </>}
        <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label={t('Pantalla completa', 'Full screen')}>⤢</button>
        <button type="button" onClick={alCerrar} aria-label={t('Cerrar', 'Close')}>×</button>
      </div>
      <div className="presentacion-barra" key={`b${i}${pausa}`} style={{ animationPlayState: pausa ? 'paused' : 'running' }} />
    </div>,
    document.body,
  );
}
