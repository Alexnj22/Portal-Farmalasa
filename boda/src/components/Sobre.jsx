import { useEffect, useRef, useState } from 'react';
import { boda } from '../config';
import { sinMovimiento } from '../lib/movimiento';
import { t } from '../lib/idioma';
import { lanzar, vibrar } from '../lib/confeti';

const LS = 'boda-sobre-abierto';
const yaAbierto = (codigo) => { try { return sessionStorage.getItem(LS) === codigo; } catch { return true; } };
const DURACION = 4800;

/**
 * La apertura de una invitación personal, como abrir un sobre de verdad:
 * llega flotando entre luces y polvo dorado; al tocar el sello, el lacre se
 * parte, la solapa se abre, la tarjeta sube y se acerca hasta llenar la
 * pantalla entre pétalos, y detrás aparece el sitio.
 * Una vez por visita; nunca con movimiento reducido ni en modo fácil.
 */
export default function Sobre({ codigo, para, monograma, fecha, musica, desactivado }) {
  const [estado, setEstado] = useState(() => (!codigo || desactivado || yaAbierto(codigo) || sinMovimiento() ? 'fuera' : 'cerrado'));
  const [sonando, setSonando] = useState(false);
  const audio = useRef(null);
  const sello = useRef(null);

  useEffect(() => { if (desactivado && estado === 'cerrado') setEstado('fuera'); }, [desactivado, estado]);
  useEffect(() => {
    if (estado === 'fuera') return undefined;
    document.documentElement.classList.add('con-sobre');
    return () => document.documentElement.classList.remove('con-sobre');
  }, [estado]);
  // Polvo dorado que sube despacio mientras espera.
  useEffect(() => {
    if (estado !== 'cerrado') return undefined;
    const i = setInterval(() => lanzar({ tipo: 'oro', cantidad: 3, x: Math.random() * innerWidth, y: innerHeight * (0.55 + Math.random() * 0.45), fuerza: 1.2 }), 420);
    return () => clearInterval(i);
  }, [estado]);

  if (estado === 'fuera') return musica && sonando ? <audio ref={audio} src={musica} autoPlay loop /> : null;

  const abrir = () => {
    if (estado !== 'cerrado') return;
    try { sessionStorage.setItem(LS, codigo); } catch { /* privado */ }
    vibrar([12, 30, 24]);
    const r = sello.current?.getBoundingClientRect();
    const x = r ? r.left + r.width / 2 : innerWidth / 2; const y = r ? r.top + r.height / 2 : innerHeight / 2;
    lanzar({ tipo: 'oro', cantidad: 60, x, y, fuerza: 7 });
    setTimeout(() => lanzar({ tipo: 'oro', cantidad: 40, x: innerWidth / 2, y: y - 60, fuerza: 6 }), 1500);
    setTimeout(() => { lanzar({ tipo: 'petalo', cantidad: 40, lluvia: true }); lanzar({ tipo: 'confeti', cantidad: 60, x: innerWidth / 2, y: innerHeight * 0.38, fuerza: 11 }); }, 2700);
    setEstado('abriendo');
    setTimeout(() => setEstado('fuera'), DURACION);
  };
  const alternarMusica = (e) => {
    e.stopPropagation();
    if (!audio.current) return;
    if (sonando) { audio.current.pause(); setSonando(false); } else { audio.current.play().then(() => setSonando(true)).catch(() => {}); }
  };

  return (
    <div className={`sobre-escena ${estado}`} role="dialog" aria-modal="true" aria-label={t('Tu invitación', 'Your invitation')}>
      <div className="luces" aria-hidden>{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ '--i': i }} />)}</div>
      <p className="sobre-arriba"><span>{t('Hay una invitación', 'There is an invitation')}</span> <span>{t('para ti', 'for you')}</span></p>

      <div className="sobre-flota">
        <div className="sobre" onClick={abrir}>
          <div className="sobre-fondo" />
          <div className="sobre-tarjeta" aria-hidden>
            <span className="tarjeta-mono">{monograma}</span>
            <span className="tarjeta-nombres">{boda.novios.ella} <em>&</em> {boda.novios.el}</span>
            <span className="tarjeta-texto">{t('te invitan a celebrar su boda', 'invite you to their wedding')}</span>
            <span className="tarjeta-fecha">{fecha}</span>
            <span className="tarjeta-para">{para}</span>
          </div>
          <div className="sobre-bolsillo">
            <span className="sobre-para">{para}</span>
          </div>
          <div className="sobre-solapa"><span className="cara-afuera" /><span className="cara-adentro" /></div>
          <div className="sobre-brillo" aria-hidden />
          <button ref={sello} type="button" className="sello" onClick={(e) => { e.stopPropagation(); abrir(); }} aria-label={t('Abrir la invitación', 'Open the invitation')}>
            <span className="sello-mitad izq"><span>{monograma}</span></span>
            <span className="sello-mitad der"><span>{monograma}</span></span>
            <span className="sello-onda" aria-hidden />
          </button>
        </div>
      </div>

      <p className="sobre-ayuda"><span className="dedo" aria-hidden />{t('Toca el sello para abrirla', 'Tap the seal to open it')}</p>
      <button type="button" className="sobre-saltar" onClick={abrir}>{t('Abrir', 'Open')}</button>
      {musica && <>
        <audio ref={audio} src={musica} loop preload="none" />
        <button type="button" className="sobre-musica" onClick={alternarMusica} aria-pressed={sonando} aria-label={sonando ? t('Apagar música', 'Mute music') : t('Encender música', 'Play music')}>♪</button>
      </>}
    </div>
  );
}
