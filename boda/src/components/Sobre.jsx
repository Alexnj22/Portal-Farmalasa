import { useEffect, useRef, useState } from 'react';
import { sinMovimiento } from '../lib/movimiento';
import { t } from '../lib/idioma';

const LS = 'boda-sobre-abierto';
const yaAbierto = (codigo) => { try { return sessionStorage.getItem(LS) === codigo; } catch { return true; } };

/**
 * Apertura de una invitación personal: un sobre oliva con el nombre del
 * invitado y un sello. Se toca el sello (o «Abrir») y la solapa se abre, la
 * tarjeta sube y el sobre se retira. Una vez por visita; no aparece con
 * movimiento reducido ni en modo fácil. Si hay música, el botón la enciende
 * (empieza apagada: un sitio no suena sin permiso).
 */
export default function Sobre({ codigo, para, monograma, fecha, musica, desactivado }) {
  const [estado, setEstado] = useState(() => (!codigo || desactivado || yaAbierto(codigo) || sinMovimiento() ? 'fuera' : 'cerrado'));
  const [sonando, setSonando] = useState(false);
  const audio = useRef(null);

  useEffect(() => { if (desactivado && estado === 'cerrado') setEstado('fuera'); }, [desactivado, estado]);
  useEffect(() => {
    if (estado !== 'cerrado') return undefined;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = ''; };
  }, [estado]);

  if (estado === 'fuera') return musica && sonando ? <audio ref={audio} src={musica} autoPlay loop /> : null;

  const abrir = () => {
    if (estado !== 'cerrado') return;
    try { sessionStorage.setItem(LS, codigo); } catch { /* privado */ }
    setEstado('abriendo');
    setTimeout(() => setEstado('fuera'), 2300);
  };
  const alternarMusica = (e) => {
    e.stopPropagation();
    if (!audio.current) return;
    if (sonando) { audio.current.pause(); setSonando(false); } else { audio.current.play().then(() => setSonando(true)).catch(() => {}); }
  };

  return (
    <div className={`sobre-escena ${estado}`} role="dialog" aria-modal="true" aria-label={t('Tu invitación', 'Your invitation')}>
      <div className="sobre" onClick={abrir}>
        <div className="sobre-tarjeta" aria-hidden>
          <span className="mono">{monograma}</span>
          <span className="fecha">{fecha}</span>
        </div>
        <div className="sobre-cuerpo" />
        <div className="sobre-solapa" />
        <div className="sobre-frente">
          <p className="sobre-para">{para}</p>
        </div>
        <button type="button" className="sello" onClick={(e) => { e.stopPropagation(); abrir(); }} aria-label={t('Abrir la invitación', 'Open the invitation')}>
          <span>{monograma}</span>
        </button>
      </div>
      <p className="sobre-ayuda">{t('Toca el sello para abrir', 'Tap the seal to open')}</p>
      <button type="button" className="btn enlace sobre-saltar" onClick={abrir}>{t('Abrir', 'Open')}</button>
      {musica && <>
        <audio ref={audio} src={musica} loop preload="none" />
        <button type="button" className="sobre-musica" onClick={alternarMusica} aria-pressed={sonando} aria-label={sonando ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>♪</button>
      </>}
    </div>
  );
}
