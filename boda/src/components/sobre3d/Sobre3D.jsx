import { useEffect, useRef, useState } from 'react';
import { boda } from '../../config';
import { t } from '../../lib/idioma';
import { vibrar } from '../../lib/confeti';
import { useDialogo } from '../../lib/dialogo';
import { alternarMusica, hayMusica, useMusica } from '../../lib/sonido';
import { crearEscena } from './escena';
import '../../estilos/sobre.css';
import '../../estilos/sobre3d.css';

const LS = 'boda-sobre-abierto';
const monogramaDe = (m) => { const l = m.replace('&', ''); return [l[0], l.slice(-1)]; };

/**
 * La invitación personal en 3D (WebGL): el sobre llega girando, se mece y
 * sigue al puntero; al tocarlo, el lacre se parte con chispas de oro, la
 * solapa se curva al abrirse, la tarjeta sube, vuela a la cámara con un brillo
 * de lámina y la portada aparece detrás. La escena vive en ./escena.js.
 */
export default function Sobre3D({ codigo, para, monograma, fecha, desactivado }) {
  const [estado, setEstado] = useState('cerrado');
  const [listo, setListo] = useState(false);
  const dialogo = useRef(null); const marco = useRef(null); const escena = useRef(null);
  const fase = useRef('cerrado');
  const relojes = useRef([]);
  const musicaApagada = useRef(false);
  const { sonando } = useMusica();
  const despues = (ms, fn) => { relojes.current.push(setTimeout(fn, ms)); };
  const vivo = estado !== 'fuera';

  useDialogo(dialogo, { activo: vivo });
  useEffect(() => () => relojes.current.forEach(clearTimeout), []);
  useEffect(() => { if (desactivado && fase.current === 'cerrado') { fase.current = 'fuera'; setEstado('fuera'); } }, [desactivado]);
  useEffect(() => {
    if (!vivo) return undefined;
    const raiz = document.documentElement;
    raiz.classList.add('con-sobre');
    return () => raiz.classList.remove('con-sobre');
  }, [vivo]);

  // El foco va a la escena, no al botón de abajo (si no, aparece su anillo).
  useEffect(() => { marco.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    let activo = true;
    const [m1, m2] = monogramaDe(monograma);
    crearEscena(marco.current, {
      para, fecha, monograma: [m1, m2], ella: boda.novios.ella, el: boda.novios.el,
      invitan: t('te invitan a celebrar su boda', 'invite you to their wedding'), etiquetaPara: t('Para', 'For'),
    }).then((e) => {
      if (!activo) { e.destruir(); return; }
      escena.current = e;
      setListo(true);
    }).catch((err) => {
      console.warn('sobre 3d', err);
      if (activo) { fase.current = 'fuera'; setEstado('fuera'); }
    });
    return () => { activo = false; escena.current?.destruir(); escena.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!vivo) { escena.current?.destruir(); escena.current = null; } }, [vivo]);

  if (!vivo) return null;

  const terminar = () => {
    if (fase.current === 'saliendo' || fase.current === 'fuera') return;
    fase.current = 'saliendo';
    escena.current?.salir();
    document.documentElement.classList.remove('con-sobre');
    setEstado('saliendo');
    despues(800, () => { fase.current = 'fuera'; setEstado('fuera'); });
  };

  const abrir = () => {
    if (fase.current !== 'cerrado' || !escena.current) return;
    fase.current = 'abriendo';
    try { sessionStorage.setItem(LS, codigo); } catch { /* privado */ }
    // La música empieza dentro de este mismo toque (el iPhone no deja después).
    if (hayMusica() && !sonando && !musicaApagada.current) alternarMusica();
    vibrar([8, 60, 16]);
    setEstado('abriendo');
    escena.current.abrir().then(terminar);
  };
  const tocarMusica = (e) => {
    e.stopPropagation();
    if (sonando) musicaApagada.current = true;
    alternarMusica();
  };

  return (
    <dialog ref={dialogo} className={`sobre-escena sobre-3d ${estado}${listo ? ' listo' : ''}`} aria-label={t(`Invitación para ${para}`, `Invitation for ${para}`)}
      onCancel={(e) => { e.preventDefault(); if (fase.current === 'cerrado') abrir(); }}>
      <div className="sobre-marco" ref={marco} onClick={abrir} tabIndex={-1} role="presentation" />
      <p className="sobre-arriba"><span className="versalita">{t('Hay una invitación', 'There is an invitation')}</span> <span className="sobre-arriba-grande">{t('para ti', 'for you')}</span></p>
      <p className="sobre-ayuda"><span className="dedo" aria-hidden />{t('Toca el sobre para abrirlo', 'Tap the envelope to open it')}</p>
      <button type="button" className="sobre-saltar" onClick={estado === 'cerrado' ? abrir : terminar}>{estado === 'cerrado' ? t('Abrir', 'Open') : t('Saltar', 'Skip')}</button>
      {hayMusica() && (
        <button type="button" className="sobre-musica" onClick={tocarMusica} aria-pressed={sonando} aria-label={sonando ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>♪</button>
      )}
    </dialog>
  );
}
