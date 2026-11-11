import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { faseActual, faseAlMenos } from '../lib/fase';
import { fechaLarga, fechaCorta, descargarIcs, enlaceGoogleCalendar, limiteConfirmar } from '../lib/fechas';
import { api } from '../lib/api';
import { t, useIdioma, contenido, BotonIdioma } from '../lib/idioma';
import Countdown from '../components/Countdown';
import Seccion, { Titulo } from '../components/Seccion';
import Telon from '../components/Telon';
import { sinMovimiento } from '../lib/movimiento';
import FraseRevelada from '../components/FraseRevelada';
import GaleriaHorizontal from '../components/GaleriaHorizontal';
import { fechaBoda } from '../config';
import Revelar from '../components/Revelar';
import CintaEntrada from '../components/CintaEntrada';
import Sobre from '../components/Sobre';
import Presentacion from '../components/Presentacion';
import { BotonFacil } from '../components/Facil';
import Icono from '../components/Iconos';
import { useInvitacion, usarCodigo } from '../lib/miInvitacion';
import { AhoraCompacto } from '../components/EnVivo';
import { useFacil } from '../lib/facil';

/** Una palabra que entra letra por letra (cada letra sube desde su renglón). */
function Letras({ texto, desde = 0 }) {
  return (
    <span className="renglon" aria-hidden>
      {[...texto].map((c, i) => <span key={i} className="letra" style={{ '--i': desde + i }}>{c === ' ' ? '\u00a0' : c}</span>)}
    </span>
  );
}

const fechaPuntos = () => {
  const [a, m, d] = fechaBoda.toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' }).split('-');
  return `${d} · ${m} · ${a}`;
};

export default function Inicio({ codigo }) {
  const idioma = useIdioma();
  const boda = contenido(idioma);
  const { novios } = boda;
  const fase = faseActual();
  // El enlace personal deja el código guardado para todas las pestañas.
  useEffect(() => { if (codigo) usarCodigo(codigo); }, [codigo]);
  const { inv } = useInvitacion();
  const facil = useFacil();
  const [presentar, setPresentar] = useState(null); // fotos de la presentación abierta
  const abrirPresentacion = () => api.listarFotos().then((f) => setPresentar(f)).catch(() => {});
  const [arriba, setArriba] = useState(true);
  const portada = useRef(null);

  // Paralaje para navegadores sin animaciones ligadas al scroll (Safari < 26):
  // un solo rAF por cuadro que escribe una variable CSS, sin estado de React,
  // y sólo mientras la portada se ve.
  useEffect(() => {
    const el = portada.current;
    if (!el || CSS.supports?.('animation-timeline: scroll()') || sinMovimiento()) return undefined;
    const foto = el.querySelector('.portada-foto');
    let cuadro = 0;
    const mover = () => {
      cuadro = 0;
      const y = window.scrollY;
      if (foto && y <= window.innerHeight) foto.style.setProperty('--paralaje', `${(y * 0.38).toFixed(1)}px`);
    };
    const pedir = () => { if (!cuadro) cuadro = requestAnimationFrame(mover); };
    window.addEventListener('scroll', pedir, { passive: true });
    return () => { window.removeEventListener('scroll', pedir); cancelAnimationFrame(cuadro); };
  }, []);

  // La barra de navegación es transparente mientras se ve la portada y lino
  // al dejarla. Un IntersectionObserver: no corre nada en cada cuadro de scroll.
  useEffect(() => {
    const el = portada.current;
    if (!el || !('IntersectionObserver' in window)) { setArriba(false); return undefined; }
    const io = new IntersectionObserver(([e]) => setArriba(e.isIntersecting), { rootMargin: '-64px 0px -70% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const titulo = fase === 'save-the-date' ? 'Save the date'
    : fase === 'recuerdos' ? t('¡Gracias por acompañarnos!', 'Thank you for celebrating with us!')
    : fase === 'boda' ? t('¡Hoy nos casamos!', "Today we're getting married!") : t('Nos casamos', "We're getting married");

  return (
    <>
      {/* Con enlace personal, el sobre con el nombre; sin él, el telón. */}
      {codigo
        ? inv?.grupo && inv.grupo.codigo === codigo.toUpperCase() && <Sobre codigo={codigo} para={inv.grupo.nombre} monograma={`${novios.ella[0]}&${novios.el[0]}`} fecha={fechaPuntos()} musica={boda.musica} desactivado={facil} />
        : !facil && <Telon monograma={`${novios.ella[0]} & ${novios.el[0]}`} para="" />}
      {presentar && <Presentacion fotos={presentar} alCerrar={() => setPresentar(null)} />}
      <nav className={`nav ${arriba ? 'sobre-foto' : ''}`}>
        <div className="contenedor">
          <a href="#inicio" className="marca">{novios.ella[0]} & {novios.el[0]}</a>
          <div className="nav-acciones"><BotonFacil /><BotonIdioma /></div>
        </div>
      </nav>

      {codigo && <CintaEntrada codigo={codigo} />}

      {/* ── Portada ── */}
      <header id="inicio" className="portada" ref={portada}>
        <div className="portada-foto"><img src={boda.portada} alt="" fetchpriority="high" /></div>
        <div className="portada-texto">
          <div className="portada-arriba">
            <p className="versalita">{titulo}</p>
            {inv?.grupo && <p className="saludo">{t('Para', 'For')} {inv.grupo.nombre}</p>}
          </div>
          <h1 aria-label={`${novios.ella} ${t('y', 'and')} ${novios.el}`}>
            <Letras texto={novios.ella} />
            <span className="segundo"><Letras texto={`& ${novios.el}`} desde={novios.ella.length} /></span>
          </h1>
          <div className="portada-pie">
            {fase === 'boda' ? <AhoraCompacto itinerario={boda.itinerario} /> : <p className="fecha-puntos">{fechaPuntos()}</p>}
            <div className="acciones">
              {fase === 'boda' && <Link className="btn" to="/album">{t('Subir fotos al álbum', 'Upload photos')}</Link>}
              {fase === 'recuerdos' && <button type="button" className="btn" onClick={abrirPresentacion}>{t('Ver la presentación', 'Watch the slideshow')}</button>}
              {fase === 'recuerdos' && <Link className="btn claro-sobre-foto" to="/album">{t('Ver el álbum', 'See the album')}</Link>}
              {fase === 'invitacion' && <Link className="btn" to="/confirmar">{inv?.grupo?.respondido_at ? t('Ver mi invitación', 'My invitation') : t('Confirmar asistencia', 'RSVP')}</Link>}
              {fase === 'save-the-date' && <a className="btn" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">{t('Guardar la fecha', 'Save the date')}</a>}
            </div>
          </div>
        </div>
      </header>

      <div className="cinta-desfile" aria-hidden>
        <div className="pista-desfile">
          {[0, 1].map((k) => (
            <span key={k}>
              {[0, 1, 2].map((j) => <span key={j}>{novios.ella} <em>&</em> {novios.el}<i>✦</i>{fechaLarga()}<i>✦</i></span>)}
            </span>
          ))}
        </div>
      </div>

      {fase !== 'recuerdos' && (
        <section id="faltan" className="faltan">
          <div className="contenedor">
            <Revelar as="p" className="versalita suave">{t('Faltan', 'Countdown')}</Revelar>
            <Countdown />
            <Revelar className="faltan-pie">
              <p className="grande-fecha">{fase === 'save-the-date' ? fechaCorta() : fechaLarga()}</p>
              {(fase === 'save-the-date' || fase === 'invitacion') && (
                <div className="acciones">
                  <a className="btn claro" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">Google Calendar</a>
                  <button className="btn claro" onClick={descargarIcs}>Apple / Outlook</button>
                </div>
              )}
            </Revelar>
          </div>
        </section>
      )}

      <Accesos fase={fase} inv={inv} boda={boda} abrirPresentacion={abrirPresentacion} />

      {/* ── Historia ── */}
      <Seccion id="historia" titulo={t('Nuestra historia', 'Our story')} dividida>
        <FraseRevelada texto={boda.frase} className="frase" />
        <ol className="hitos">
          {boda.historia.map((h, i) => (
            <Revelar as="li" key={i} className="hito">
              <span className="anio">{h.fecha}</span>
              <div><h3>{h.titulo}</h3><p>{h.texto}</p></div>
            </Revelar>
          ))}
        </ol>
      </Seccion>

      <GaleriaHorizontal titulo={<Titulo texto={t('Así somos', 'This is us')} as="span" />} fotos={boda.galeria} />

      <footer className="pie-sitio">
        <div className="contenedor">
          <p className="versalita" style={{ color: 'var(--oliva-claro)' }}>{t('Los esperamos', 'We hope to see you')}</p>
          <p className="nombres-gigantes" aria-label={`${novios.ella} ${t('y', 'and')} ${novios.el}`}>
            <span aria-hidden>{novios.ella}</span><span aria-hidden className="segundo"><em>&</em> {novios.el}</span>
          </p>
          <div className="pie-filas">
            <p>{fechaLarga()}</p>
            <p>{novios.hashtag}</p>
            {boda.contacto?.whatsapp && (
              <p>
                <a href={`https://wa.me/${boda.contacto.whatsapp}`} target="_blank" rel="noreferrer">
                  {t(`¿Dudas? Escríbele a ${boda.contacto.nombre}`, `Questions? Message ${boda.contacto.nombre}`)}
                </a>
              </p>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}

/**
 * «Qué puedo hacer aquí»: lo importante del momento, en tarjetas grandes que
 * llevan a su pestaña. Así nadie tiene que adivinar dónde está cada cosa.
 */
function Accesos({ fase, inv, boda, abrirPresentacion }) {
  const g = inv?.grupo;
  const items = [];
  if (fase === 'invitacion') {
    items.push(g?.respondido_at
      ? { a: '/confirmar', i: 'confirmar', t: t('Ya confirmaste', 'You replied'), d: t('Ver o cambiar tu respuesta', 'See or change your reply'), hecho: true }
      : { a: '/confirmar', i: 'confirmar', t: t('Confirma tu asistencia', 'RSVP'), d: g ? t(`Antes del ${limiteConfirmar(inv.limite)}`, `By ${limiteConfirmar(inv.limite)}`) : t('Con el código de tu invitación', 'With your invitation code'), fuerte: true });
    items.push({ a: '/evento', i: 'lugar', t: t('Dónde y cuándo', 'Where and when'), d: t('Mapa, programa y vestimenta', 'Map, schedule and dress code') });
    items.push({ a: '/canciones', i: 'musica', t: t('Pide una canción', 'Request a song'), d: t('La que no puede faltar', "The one that can't be missed") });
    items.push({ a: '/mensajes', i: 'mensajes', t: t('Déjanos un mensaje', 'Leave us a message'), d: t('Escrito o de voz', 'Written or voice') });
  } else if (fase === 'boda') {
    items.push({ a: '/hoy', i: 'hoy', t: t('Qué está pasando', 'What’s happening'), d: t('Programa en vivo y tu mesa', 'Live schedule and your table'), fuerte: true });
    items.push({ a: '/album', i: 'camara', t: t('Sube tus fotos', 'Upload photos'), d: t('Al álbum de todos', 'To the shared album') });
    items.push({ a: '/canciones', i: 'musica', t: t('Pide una canción', 'Request a song'), d: t('Y vota las de los demás', 'And vote for others') });
    items.push({ a: '/juego', i: 'juego', t: t('Juegos', 'Games'), d: t('Trivia, bingo y retos', 'Trivia, bingo and challenges') });
  } else if (fase === 'recuerdos') {
    items.push({ boton: abrirPresentacion, i: 'play', t: t('Ver la presentación', 'Watch the slideshow'), d: t('Las fotos de todos', "Everyone's photos"), fuerte: true });
    items.push({ a: '/album', i: 'fotos', t: t('El álbum', 'The album'), d: t('Descarga tus favoritas', 'Download your favorites') });
    items.push({ a: '/mensajes', i: 'mensajes', t: t('Mensajes', 'Messages'), d: t('Lo que nos escribieron', 'What you wrote us') });
  } else {
    items.push({ a: '/confirmar', i: 'calendario', t: t('Tu lugar', 'Your seat'), d: g ? `${g.pases} ${g.pases === 1 ? t('lugar reservado', 'seat') : t('lugares reservados', 'seats')}` : t('Con el código de tu invitación', 'With your code'), fuerte: true });
  }
  return (
    <section className="accesos contenedor" aria-label={t('Qué puedes hacer', 'What you can do')}>
      {items.map((x, k) => {
        const cuerpo = <>
          <span className="acceso-icono"><Icono n={x.i} tam={26} /></span>
          <span className="acceso-texto"><b>{x.t}</b><span>{x.d}</span></span>
          <Icono n="flecha" tam={20} className="acceso-flecha" />
        </>;
        const clase = `acceso ${x.fuerte ? 'fuerte' : ''} ${x.hecho ? 'hecho' : ''}`;
        return x.boton
          ? <button key={k} type="button" className={clase} onClick={x.boton}>{cuerpo}</button>
          : <Link key={k} to={x.a} className={clase}>{cuerpo}</Link>;
      })}
    </section>
  );
}
