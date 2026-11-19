import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { boda } from '../config';
import { sinMovimiento } from '../lib/movimiento';
import { t } from '../lib/idioma';
import { vibrar } from '../lib/confeti';
import { useDialogo } from '../lib/dialogo';
import { alternarMusica, hayMusica, useMusica } from '../lib/sonido';
import '../estilos/sobre.css';

const LS = 'boda-sobre-abierto';
const yaAbierto = (codigo) => { try { return sessionStorage.getItem(LS) === codigo; } catch { return true; } };

// Curvas. RESORTE es un muelle amortiguado escrito con linear(): pasa apenas
// del destino y se asienta, como papel que se detiene, sin rebotar. Donde el
// navegador no entiende linear(), cae a la salida suave del sitio.
const SALIDA = 'cubic-bezier(.22, 1, .36, 1)';
const RESORTE = (() => {
  const puntos = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    const y = 1 - Math.exp(-6.2 * x) * Math.cos(9.5 * x);
    puntos.push(Math.round(y * 1000) / 1000);
  }
  const curva = `linear(${puntos.join(', ')})`;
  try { return CSS.supports('animation-timing-function', curva) ? curva : SALIDA; } catch { return SALIDA; }
})();
const BISAGRA = 'cubic-bezier(.62, 0, .24, 1)';
const CAE = 'cubic-bezier(.55, 0, .9, .45)';

// La coreografía, en ms desde el toque.
const T = {
  sello: 0, parte: 150, solapa: 300, tarjetaSube: 1330, tarjetaAdelante: 2220,
  sobreSeVa: 2360, tarjetaCentro: 2460, brillo: 3480, fin: 4650,
};

const monogramaDe = (m) => { const l = m.replace('&', ''); return [l[0], l.slice(-1)]; };

/**
 * La apertura de una invitación personal, en 3D de verdad: el sobre llega
 * girando a la mesa, se mece y sigue al puntero; al tocar el lacre, se aprieta,
 * se parte en dos con un destello y chispas de lámina, la solapa gira sobre su
 * bisagra, la tarjeta sube con un muelle, pasa al frente, el sobre cae fuera de
 * cuadro y la tarjeta queda al centro con un brillo que la recorre; sus nombres
 * se vuelven los de la portada (View Transitions; sin la API, fundido).
 * Todo es transform/opacity sobre capas en el mismo espacio 3D (el orden lo
 * decide la profundidad, no z-index). Una vez por visita; nunca con movimiento
 * reducido ni en modo fácil.
 */
export default function Sobre({ codigo, para, monograma, fecha, desactivado }) {
  const [estado, setEstado] = useState(() => (!codigo || desactivado || yaAbierto(codigo) || sinMovimiento() ? 'fuera' : 'cerrado'));
  const r = {
    dialogo: useRef(null), vaiven: useRef(null), sobre: useRef(null), cuerpo: useRef(null),
    tarjeta: useRef(null), brillo: useRef(null), solapa: useRef(null), sombra: useRef(null),
    sello: useRef(null), izq: useRef(null), der: useRef(null), luz: useRef(null), suelo: useRef(null),
    nombres: useRef(null),
  };
  const relojes = useRef([]);
  const musicaApagada = useRef(false);
  const { sonando } = useMusica();
  const despues = (ms, fn) => { relojes.current.push(setTimeout(fn, ms)); };
  const vivo = estado !== 'fuera';

  useDialogo(r.dialogo, { activo: vivo });
  useEffect(() => () => relojes.current.forEach(clearTimeout), []);
  useEffect(() => { if (desactivado && estado === 'cerrado') setEstado('fuera'); }, [desactivado, estado]);
  useEffect(() => {
    if (!vivo) return undefined;
    const raiz = document.documentElement;
    raiz.classList.add('con-sobre');
    return () => raiz.classList.remove('con-sobre');
  }, [vivo]);

  // Mientras espera, el sobre se inclina hacia el puntero (computadora) con
  // una inercia suave. En el teléfono lo mece la animación de CSS.
  useEffect(() => {
    if (estado !== 'cerrado') return undefined;
    const fino = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    if (!fino) return undefined;
    let meta = { x: 0, y: 0 }; let ahora = { x: 0, y: 0 }; let cuadro = 0;
    const mover = (e) => { meta = { x: e.clientX / innerWidth - 0.5, y: e.clientY / innerHeight - 0.5 }; };
    const paso = () => {
      ahora = { x: ahora.x + (meta.x - ahora.x) * 0.06, y: ahora.y + (meta.y - ahora.y) * 0.06 };
      if (r.sobre.current) r.sobre.current.style.transform = `rotateX(${(-ahora.y * 12).toFixed(2)}deg) rotateY(${(ahora.x * 16).toFixed(2)}deg)`;
      cuadro = requestAnimationFrame(paso);
    };
    const arranque = setTimeout(() => { addEventListener('pointermove', mover); cuadro = requestAnimationFrame(paso); }, 1600);
    return () => { clearTimeout(arranque); removeEventListener('pointermove', mover); cancelAnimationFrame(cuadro); };
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (r.nombres.current) r.nombres.current.style.viewTransitionName = 'nombres';
      const vt = document.startViewTransition(cambiar);
      vt.finished.finally(() => raiz.classList.remove('vt-sobre'));
    } else {
      raiz.classList.add('desde-sobre');
      setEstado('saliendo');
      despues(700, () => setEstado('fuera'));
    }
  };

  const animar = (el, cuadros, ms, inicio, easing = SALIDA) => el?.animate(cuadros, { duration: ms, delay: inicio, easing, fill: 'both' });

  // Chispas de lámina que salen del lacre al partirse.
  const chispas = () => {
    const sello = r.sello.current; if (!sello) return;
    for (let i = 0; i < 14; i++) {
      const c = document.createElement('i');
      c.className = 'chispa';
      const ang = (i / 14) * 360 + (Math.random() * 16 - 8);
      const largo = 46 + Math.random() * 46;
      sello.appendChild(c);
      const a = c.animate([
        { transform: `rotate(${ang}deg) translateY(-14px) scaleY(.4)`, opacity: 0 },
        { offset: 0.18, transform: `rotate(${ang}deg) translateY(-26px) scaleY(1)`, opacity: 1 },
        { transform: `rotate(${ang}deg) translateY(-${largo + 26}px) scaleY(.15)`, opacity: 0 },
      ], { duration: 720 + Math.random() * 260, delay: T.parte, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      a.onfinish = () => c.remove();
    }
  };

  const secuencia = () => {
    const sobre = r.sobre.current; const tarjeta = r.tarjeta.current;
    if (!sobre || !tarjeta) return;

    // El vaivén se detiene desde la pose en la que esté, sin salto.
    const v = r.vaiven.current;
    if (v) {
      const pose = getComputedStyle(v).transform;
      v.style.animation = 'none';
      animar(v, [{ transform: pose === 'none' ? 'none' : pose }, { transform: 'none' }], 600, 0);
    }
    const inclinacion = sobre.style.transform || 'rotateX(0deg) rotateY(0deg)';
    sobre.style.transform = '';

    // Medidas para que la tarjeta termine al centro y a buen tamaño.
    const caja = tarjeta.getBoundingClientRect();
    const altoSobre = sobre.getBoundingClientRect().height;
    const subir = -(altoSobre * 0.97);
    const dy = innerHeight / 2 - (caja.top + caja.height / 2);
    const z = 110; const lupa = 1300 / (1300 - z);
    const escala = Math.min((innerWidth * 0.9) / caja.width, (innerHeight * 0.6) / caja.height, 1.7) / lupa;

    // 1. El lacre se aprieta y se parte.
    animar(r.sello.current, [{ transform: 'translateZ(6px) scale(1)' }, { transform: 'translateZ(6px) scale(.88)' }, { transform: 'translateZ(6px) scale(1)' }], 260, T.sello, 'ease-out');
    despues(T.parte, () => r.sello.current?.classList.add('roto'));
    animar(r.luz.current, [{ transform: 'scale(.5)', opacity: 0 }, { offset: 0.15, opacity: 0.95 }, { transform: 'scale(3.2)', opacity: 0 }], 820, T.parte, 'cubic-bezier(.2,.7,.3,1)');
    animar(r.izq.current, [
      { transform: 'none', opacity: 1 },
      { offset: 0.22, transform: 'translate(-10px,-14px) rotate(-14deg)', opacity: 1, easing: 'cubic-bezier(.5,0,.9,.5)' },
      { transform: 'translate(-74px,260px) rotate(-96deg)', opacity: 0 },
    ], 1050, T.parte, 'cubic-bezier(.2,.6,.4,1)');
    animar(r.der.current, [
      { transform: 'none', opacity: 1 },
      { offset: 0.22, transform: 'translate(12px,-10px) rotate(12deg)', opacity: 1, easing: 'cubic-bezier(.5,0,.9,.5)' },
      { transform: 'translate(80px,250px) rotate(88deg)', opacity: 0 },
    ], 1100, T.parte, 'cubic-bezier(.2,.6,.4,1)');
    chispas();

    // 2. La solapa gira sobre su bisagra; el sobre se inclina para dejar ver.
    animar(sobre, [{ transform: inclinacion }, { transform: 'rotateX(11deg) rotateY(0deg) translateY(4%)' }], 1100, T.solapa, BISAGRA);
    animar(r.solapa.current, [{ transform: 'translateZ(3px) rotateX(0deg)' }, { transform: 'translateZ(.5px) rotateX(180deg)' }], 960, T.solapa, BISAGRA);
    animar(r.sombra.current, [{ opacity: 0.7 }, { opacity: 0 }], 380, T.solapa, 'ease-out');

    // 3. La tarjeta sube del bolsillo con un muelle, pasa al frente y viene al centro.
    animar(tarjeta, [
      { transform: 'translate3d(0,0,1px) rotate(0deg)' },
      { transform: `translate3d(0,${subir}px,1px) rotate(-1.4deg)` },
    ], 1000, T.tarjetaSube, RESORTE);
    tarjeta.animate([
      { transform: `translate3d(0,${subir}px,1px) rotate(-1.4deg)` },
      { transform: `translate3d(0,${subir * 0.92}px,${z * 0.6}px) rotate(-.6deg)` },
      { transform: `translate3d(0,${dy}px,${z}px) rotate(0deg) scale(${escala})` },
    ], { duration: 1400, delay: T.tarjetaAdelante, easing: SALIDA, fill: 'forwards' });
    animar(tarjeta, [
      { boxShadow: '0 1px 2px oklch(0.05 0.004 105 / .35), 0 8px 20px oklch(0.04 0.004 105 / .3)' },
      { boxShadow: '0 2px 4px oklch(0.04 0.004 105 / .4), 0 40px 90px oklch(0.02 0.004 105 / .75)' },
    ], 1200, T.tarjetaCentro);

    // 4. El sobre cae fuera de cuadro y se pierde en la sombra.
    // Sin opacidad en el contenedor: animarla aplanaría su 3D y la tarjeta
    // dejaría de quedar detrás del bolsillo. Se apagan las hojas, una por una.
    animar(r.cuerpo.current, [
      { transform: 'translate3d(0,0,0) rotateX(0deg)' },
      { transform: `translate3d(0,${innerHeight * 0.62}px,-160px) rotateX(-24deg)` },
    ], 1000, T.sobreSeVa, CAE);
    r.cuerpo.current?.querySelectorAll('.sobre-fondo, .sobre-bolsillo, .sobre-solapa > span').forEach((hoja) => {
      animar(hoja, [{ opacity: 1 }, { opacity: 0 }], 800, T.sobreSeVa + 150, 'ease-in');
    });
    animar(sobre, [{ transform: 'rotateX(11deg) rotateY(0deg) translateY(4%)' }, { transform: 'rotateX(0deg) rotateY(0deg) translateY(0)' }], 1100, T.sobreSeVa, SALIDA);
    animar(r.suelo.current, [{ opacity: 1 }, { opacity: 0 }], 600, T.sobreSeVa, 'ease-out');

    // 5. Un brillo de lámina recorre la tarjeta.
    animar(r.brillo.current, [{ transform: 'translateX(-130%) skewX(-18deg)', opacity: 0 }, { offset: 0.2, opacity: 1 }, { transform: 'translateX(330%) skewX(-18deg)', opacity: 0 }], 1100, T.brillo, 'cubic-bezier(.45,0,.2,1)');
  };

  const abrir = () => {
    if (estado !== 'cerrado') return;
    try { sessionStorage.setItem(LS, codigo); } catch { /* privado */ }
    // La música empieza dentro de este mismo toque (el iPhone no deja después).
    if (hayMusica() && !sonando && !musicaApagada.current) alternarMusica();
    vibrar([10, 40, 18]);
    setEstado('abriendo');
    secuencia();
    despues(T.fin, terminar);
  };
  const tocarMusica = (e) => {
    e.stopPropagation();
    if (sonando) musicaApagada.current = true;
    alternarMusica();
  };

  const [m1, m2] = monogramaDe(monograma);
  const mono = <>{m1}<em>&amp;</em>{m2}</>;

  return (
    <dialog ref={r.dialogo} className={`sobre-escena ${estado}`} aria-label={t(`Invitación para ${para}`, `Invitation for ${para}`)}
      onCancel={(e) => { e.preventDefault(); if (estado === 'cerrado') abrir(); }}>
      <p className="sobre-arriba"><span className="versalita">{t('Hay una invitación', 'There is an invitation')}</span> <span className="sobre-arriba-grande">{t('para ti', 'for you')}</span></p>

      <div className="sobre-flota">
        <div className="sobre-suelo" ref={r.suelo} aria-hidden />
        <div className="sobre-vaiven" ref={r.vaiven}>
          <div className="sobre" ref={r.sobre} onClick={abrir}>
            <div className="sobre-tarjeta" ref={r.tarjeta}>
              <span className="tarjeta-mono" aria-hidden>{mono}</span>
              <span className="tarjeta-filete" aria-hidden />
              <span className="tarjeta-nombres" ref={r.nombres}>{boda.novios.ella} <em>&amp;</em> {boda.novios.el}</span>
              <span className="tarjeta-texto">{t('te invitan a celebrar su boda', 'invite you to their wedding')}</span>
              <span className="tarjeta-fecha">{fecha}</span>
              <span className="tarjeta-para">{para}</span>
              <span className="tarjeta-brillo" aria-hidden><span ref={r.brillo} /></span>
            </div>
            <div className="sobre-cuerpo" ref={r.cuerpo}>
              <div className="sobre-fondo" />
              <div className="sobre-bolsillo">
                <span className="sobre-para"><small>{t('Para', 'For')}</small>{para}</span>
              </div>
              <div className="solapa-sombra" ref={r.sombra} aria-hidden><span /></div>
              <div className="sobre-solapa" ref={r.solapa} aria-hidden>
                <span className="cara-afuera">
                  {/* El canto de la solapa en lámina champán, con un brillo que pasa. */}
                  <svg className="canto" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="1.2,0.8 50,97.5 98.8,0.8" /></svg>
                  <span className="brillo-lamina" />
                </span>
                <span className="cara-adentro" />
              </div>
              <button ref={r.sello} type="button" className="sello" onClick={(e) => { e.stopPropagation(); e.currentTarget.blur(); abrir(); }} aria-label={t('Abrir la invitación', 'Open the invitation')}>
                <span className="sello-luz" ref={r.luz} aria-hidden />
                <span className="sello-mitad izq" ref={r.izq}><span>{mono}</span></span>
                <span className="sello-mitad der" ref={r.der}><span>{mono}</span></span>
                <span className="sello-onda" aria-hidden />
              </button>
            </div>
          </div>
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
