import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { boda } from '../config';
import { sinMovimiento } from '../lib/movimiento';
import { t } from '../lib/idioma';
import { lanzar, vibrar, fijarContenedor } from '../lib/confeti';
import { useDialogo } from '../lib/dialogo';
import { alternarMusica, hayMusica, useMusica } from '../lib/sonido';
import '../estilos/sobre.css';

const LS = 'boda-sobre-abierto';
const yaAbierto = (codigo) => { try { return sessionStorage.getItem(LS) === codigo; } catch { return true; } };
// La coreografía (ver estilos/sobre.css): sello 0–0.8 s, solapa 0.25–1.25 s,
// la tarjeta sale 1.1–2.3 s, el sobre se va y la tarjeta queda al centro
// hasta 3.5 s; a los 4.4 s la tarjeta se vuelve los nombres de la portada.
const FIN = 4400;

/**
 * La apertura de una invitación personal, como abrir un sobre de verdad:
 * llega flotando entre luces y polvo dorado; al tocar el lacre, se parte, la
 * solapa se abre, la tarjeta sale del sobre y queda al centro, y sus nombres
 * se convierten en los de la portada (View Transitions; sin la API, fundido).
 * Una vez por visita; nunca con movimiento reducido ni en modo fácil.
 */
export default function Sobre({ codigo, para, monograma, fecha, desactivado }) {
  const [estado, setEstado] = useState(() => (!codigo || desactivado || yaAbierto(codigo) || sinMovimiento() ? 'fuera' : 'cerrado'));
  const dialogo = useRef(null);
  const sello = useRef(null);
  const nombres = useRef(null);
  const relojes = useRef([]);
  const musicaApagada = useRef(false);
  const { sonando } = useMusica();
  const despues = (ms, fn) => { relojes.current.push(setTimeout(fn, ms)); };
  const vivo = estado !== 'fuera';

  useDialogo(dialogo, { activo: vivo });
  useEffect(() => () => relojes.current.forEach(clearTimeout), []);
  useEffect(() => { if (desactivado && estado === 'cerrado') setEstado('fuera'); }, [desactivado, estado]);
  useEffect(() => {
    if (!vivo) return undefined;
    const raiz = document.documentElement;
    raiz.classList.add('con-sobre');
    fijarContenedor(dialogo.current);
    return () => { raiz.classList.remove('con-sobre'); fijarContenedor(null); };
  }, [vivo]);
  // Polvo dorado que sube despacio mientras espera (nunca con la pestaña oculta).
  useEffect(() => {
    if (estado !== 'cerrado') return undefined;
    const i = setInterval(() => {
      if (document.hidden) return;
      lanzar({ tipo: 'oro', cantidad: 2, x: Math.random() * innerWidth, y: innerHeight * (0.55 + Math.random() * 0.45), fuerza: 1.1 });
    }, 480);
    return () => clearInterval(i);
  }, [estado]);

  if (!vivo) return null;

  // Los nombres de la tarjeta se vuelven los de la portada.
  const terminar = () => {
    const raiz = document.documentElement;
    const cambiar = () => {
      flushSync(() => setEstado('fuera'));
      raiz.classList.remove('con-sobre');
      raiz.classList.add('desde-sobre', 'vt-sobre');
    };
    if (typeof document.startViewTransition === 'function' && !document.hidden) {
      if (nombres.current) nombres.current.style.viewTransitionName = 'nombres';
      const vt = document.startViewTransition(cambiar);
      vt.finished.finally(() => raiz.classList.remove('vt-sobre'));
    } else {
      raiz.classList.add('desde-sobre');
      setEstado('saliendo');
      despues(700, () => setEstado('fuera'));
    }
  };

  const abrir = () => {
    if (estado !== 'cerrado') return;
    try { sessionStorage.setItem(LS, codigo); } catch { /* privado */ }
    // La música empieza dentro de este mismo toque (el iPhone no deja después).
    if (hayMusica() && !sonando && !musicaApagada.current) alternarMusica();
    vibrar([12, 30, 24]);
    const r = sello.current?.getBoundingClientRect();
    const x = r ? r.left + r.width / 2 : innerWidth / 2; const y = r ? r.top + r.height / 2 : innerHeight / 2;
    lanzar({ tipo: 'oro', cantidad: 50, x, y, fuerza: 6 });
    despues(1500, () => lanzar({ tipo: 'oro', cantidad: 34, x: innerWidth / 2, y: y - 80, fuerza: 5 }));
    despues(2500, () => { lanzar({ tipo: 'petalo', cantidad: 34, lluvia: true }); lanzar({ tipo: 'confeti', cantidad: 56, x: innerWidth / 2, y: innerHeight * 0.4, fuerza: 10 }); });
    setEstado('abriendo');
    despues(FIN, terminar);
  };
  const tocarMusica = (e) => {
    e.stopPropagation();
    if (sonando) musicaApagada.current = true;
    alternarMusica();
  };

  return (
    <dialog ref={dialogo} className={`sobre-escena ${estado}`} aria-label={t(`Invitación para ${para}`, `Invitation for ${para}`)}
      onCancel={(e) => { e.preventDefault(); if (estado === 'cerrado') abrir(); }}>
      <div className="luces" aria-hidden>{Array.from({ length: 7 }, (_, i) => <span key={i} style={{ '--i': i, '--y': (i * 37) % 70 }} />)}</div>
      <p className="sobre-arriba"><span>{t('Hay una invitación', 'There is an invitation')}</span> <span>{t('para ti', 'for you')}</span></p>

      <div className="sobre-flota">
        <div className="sobre-suelo" aria-hidden />
        <div className="sobre" onClick={abrir}>
          <div className="sobre-fondo" />
          <div className="sobre-tarjeta">
            <span className="tarjeta-mono" aria-hidden>{monograma.replace('&', '')[0]}<em>&amp;</em>{monograma.replace('&', '').slice(-1)}</span>
            <span className="tarjeta-nombres" ref={nombres}>{boda.novios.ella} <em>&amp;</em> {boda.novios.el}</span>
            <span className="tarjeta-texto">{t('te invitan a celebrar su boda', 'invite you to their wedding')}</span>
            <span className="tarjeta-fecha">{fecha}</span>
            <span className="tarjeta-para">{para}</span>
          </div>
          <div className="sobre-bolsillo">
            <span className="sobre-para"><small>{t('Para', 'For')}</small>{para}</span>
          </div>
          <div className="solapa-sombra" aria-hidden><span /></div>
          <div className="sobre-solapa" aria-hidden><span className="cara-afuera" /><span className="cara-adentro" /></div>
          <div className="sobre-brillo" aria-hidden />
          <button ref={sello} type="button" className="sello" onClick={(e) => { e.stopPropagation(); e.currentTarget.blur(); abrir(); }} aria-label={t('Abrir la invitación', 'Open the invitation')}>
            <span className="sello-mitad izq"><span>{monograma}</span></span>
            <span className="sello-mitad der"><span>{monograma}</span></span>
            <span className="sello-onda" aria-hidden />
          </button>
        </div>
      </div>

      <p className="sobre-ayuda"><span className="dedo" aria-hidden />{t('Toca el sello para abrirla', 'Tap the seal to open it')}</p>
      <button type="button" className="sobre-saltar" onClick={estado === 'cerrado' ? abrir : terminar}>{estado === 'cerrado' ? t('Abrir', 'Open') : t('Saltar', 'Skip')}</button>
      {hayMusica() && (
        <button type="button" className="sobre-musica" onClick={tocarMusica} aria-pressed={sonando} aria-label={sonando ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>♪</button>
      )}
    </dialog>
  );
}
