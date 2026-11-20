import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { faseActual } from '../lib/fase';
import { fechaLarga, fechaCorta, descargarIcs, enlaceGoogleCalendar, limiteConfirmar } from '../lib/fechas';
import { api } from '../lib/api';
import { t, useIdioma, contenido, BotonIdioma } from '../lib/idioma';
import Countdown from '../components/Countdown';
import { Titulo, Capitulo } from '../components/Seccion';
import { sinMovimiento } from '../lib/movimiento';
import GaleriaHorizontal from '../components/GaleriaHorizontal';
import { fechaBoda } from '../config';
import Revelar from '../components/Revelar';
import { BotonFacil } from '../components/Facil';
import BotonMusica from '../components/BotonMusica';
import { NavEscritorio, Monograma } from '../components/AppMarco';
import { imagenAdaptable } from '../lib/fotos';
import { precargar } from '../lib/precarga';
import { romano } from '../lib/romanos';
import Icono from '../components/Iconos';
import { useInvitacion, usarCodigo } from '../lib/miInvitacion';
import { AhoraCompacto } from '../components/EnVivo';
import { useFacil } from '../lib/facil';

// Lo que no hace falta para pintar la portada se baja aparte.
const Sobre = lazy(() => import('../components/Sobre'));
const Presentacion = lazy(() => import('../components/Presentacion'));
const CintaEntrada = lazy(() => import('../components/CintaEntrada'));

/** 17 · IV · 2027: el mes en romanos, como en una invitación grabada. */
const fechaPuntos = () => {
  const [a, m, d] = fechaBoda.toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' }).split('-');
  return `${Number(d)} · ${romano(Number(m))} · ${a}`;
};

// Las franjas del cine se retiran una vez por visita; al volver a la portada,
// el texto sólo se funde.
const VISTA = 'boda-portada-abierta';

/** Las últimas palabras de una frase, en cursiva. */
function FraseConCursiva({ texto, ultimas = 3 }) {
  const p = texto.trim().split(/\s+/);
  const corte = Math.max(0, p.length - ultimas);
  return <>{p.slice(0, corte).join(' ')} <em>{p.slice(corte).join(' ')}</em></>;
}

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
  const [errorFotos, setErrorFotos] = useState('');
  const abrirPresentacion = () => api.listarFotos().then((f) => { setErrorFotos(''); setPresentar(f); })
    .catch((e) => { console.error('Presentación', e); setErrorFotos(t('No pudimos traer las fotos. Prueba de nuevo.', "We couldn't load the photos. Please try again.")); });
  const [arriba, setArriba] = useState(true);
  const portada = useRef(null);
  const centinela = useRef(null);

  // ¿Ya se abrió la portada en esta visita? Antes de pintar, para que las
  // franjas no asomen ni un cuadro.
  useLayoutEffect(() => {
    try {
      if (sessionStorage.getItem(VISTA)) document.documentElement.classList.add('ya-abierta');
      else sessionStorage.setItem(VISTA, '1');
    } catch { document.documentElement.classList.add('ya-abierta'); }
  }, []);

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
      if (foto && y <= window.innerHeight) foto.style.setProperty('--paralaje', `${(y * 0.3).toFixed(1)}px`);
    };
    const pedir = () => { if (!cuadro) cuadro = requestAnimationFrame(mover); };
    window.addEventListener('scroll', pedir, { passive: true });
    return () => { window.removeEventListener('scroll', pedir); cancelAnimationFrame(cuadro); };
  }, []);

  // La cabecera es transparente sólo mientras NADA pasa por debajo (un
  // centinela con IntersectionObserver: nada corre en cada cuadro).
  useEffect(() => {
    const el = centinela.current;
    if (!el || !('IntersectionObserver' in window)) { setArriba(false); return undefined; }
    const io = new IntersectionObserver(([e]) => setArriba(e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const foto = imagenAdaptable(boda.portada);
  const fotoHistoria = imagenAdaptable(boda.fotoHistoria || boda.galeria[1] || boda.galeria[0]);

  const titulo = fase === 'save-the-date' ? 'Save the date'
    : fase === 'recuerdos' ? t('Gracias por acompañarnos', 'Thank you for celebrating with us')
    : fase === 'boda' ? t('Hoy nos casamos', "Today we're getting married") : t('Nos casamos', "We're getting married");

  return (
    <>
      {/* Con enlace personal, el sobre con el nombre. */}
      {codigo && inv?.grupo && inv.grupo.codigo === codigo.toUpperCase() && (
        <Suspense fallback={null}><Sobre codigo={codigo} para={inv.grupo.nombre} monograma={`${novios.ella[0]}&${novios.el[0]}`} fecha={fechaPuntos()} desactivado={facil} /></Suspense>
      )}
      {presentar && <Suspense fallback={null}><Presentacion fotos={presentar} alCerrar={() => setPresentar(null)} /></Suspense>}
      <nav className={`nav ${arriba ? 'sobre-foto' : ''}`}>
        <div className="contenedor">
          <a href="#inicio" className="marca"><Monograma /></a>
          <NavEscritorio fase={fase} />
          <div className="nav-acciones"><BotonMusica /><BotonFacil /><BotonIdioma /></div>
        </div>
      </nav>

      {codigo && <Suspense fallback={null}><CintaEntrada codigo={codigo} /></Suspense>}

      {/* ── Portada ── */}
      <header id="inicio" className="portada" ref={portada}>
        <span ref={centinela} className="centinela-nav" aria-hidden />
        <div className="portada-foto"><img {...foto} style={boda.portadaEnfoque ? { objectPosition: boda.portadaEnfoque } : undefined} alt="" fetchpriority="high" decoding="async" /></div>
        <span className="franja arriba" aria-hidden />
        <span className="franja abajo" aria-hidden />
        <div className="portada-texto">
          <div className="portada-arriba">
            {fase !== 'save-the-date' && <p className="versalita">{titulo}</p>}
            {inv?.grupo && <p className="saludo">{t('Para', 'For')} {inv.grupo.nombre}</p>}
          </div>
          {/* En el save the date, la frase ES lo principal; los nombres la firman. */}
          {fase === 'save-the-date' && <p className="std-titulo" aria-hidden><span>Save</span> <em>the</em> <span>Date</span></p>}
          <h1 className={fase === 'save-the-date' ? 'firma-std' : undefined} aria-label={`${fase === 'save-the-date' ? 'Save the date: ' : ''}${novios.ella} ${t('y', 'and')} ${novios.el}`}>
            <span className="linea-1" aria-hidden>{novios.ella}</span>
            <span className="linea-2" aria-hidden><em className="amp">&amp;</em> <em>{novios.el}</em></span>
          </h1>
          <div className="portada-pie">
            {fase === 'boda' ? <AhoraCompacto itinerario={boda.itinerario} /> : <p className={`fecha-puntos ${fase === 'save-the-date' ? 'grande' : ''}`}>{fechaPuntos()}</p>}
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

      {errorFotos && <p className="aviso error contenedor" role="alert" style={{ marginTop: 16 }}>{errorFotos}</p>}

      {/* En la fase boda ya no hay nada que contar: la cuenta regresiva se va. */}
      {fase !== 'recuerdos' && fase !== 'boda' && (
        <section id="faltan" className="seccion-inicio faltan">
          <div className="contenedor">
            <Revelar><Capitulo texto={t('Faltan', 'Countdown')} /></Revelar>
            <Countdown />
            <Revelar className="faltan-pie">
              <p className="grande-fecha">{fase === 'save-the-date' ? fechaCorta() : fechaLarga()}</p>
              <div className="acciones">
                <a className="btn claro chico" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">Google Calendar</a>
                <button type="button" className="btn claro chico" onClick={descargarIcs}>Apple / Outlook</button>
              </div>
            </Revelar>
          </div>
        </section>
      )}

      {fase !== 'save-the-date' && <Accesos fase={fase} inv={inv} abrirPresentacion={abrirPresentacion} />}

      {/* ── La frase: una escena tipográfica, quieta ── */}
      <figure className="escena-frase">
        <Revelar>
          <span className="filete-corto" aria-hidden />
          <blockquote><FraseConCursiva texto={boda.frase} /></blockquote>
          <figcaption className="versalita suave">{novios.firma}</figcaption>
        </Revelar>
      </figure>

      {/* ── Nuestra historia: la foto se abre al bajar ── */}
      <section id="historia" className="seccion-historia" aria-labelledby="titulo-historia">
        <div className="escena-foto">
          <div className="escena-pin">
            <img {...fotoHistoria} alt="" loading="lazy" decoding="async" />
            <div className="escena-titulo">
              <p className="versalita">{novios.ella} &amp; {novios.el}</p>
              <Titulo texto={t('Nuestra historia', 'Our story')} as="h2" id="titulo-historia" />
            </div>
          </div>
        </div>
        <div className="contenedor">
          <ol className="capitulos">
            {boda.historia.map((h, i) => (
              <Revelar as="li" key={i} className="hito">
                <Capitulo numero={i + 1} texto={`${t('Capítulo', 'Chapter')} · ${h.fecha}`} />
                <div><Titulo texto={h.titulo} as="h3" /><p>{h.texto}</p></div>
              </Revelar>
            ))}
          </ol>
        </div>
      </section>

      <GaleriaHorizontal titulo={<Titulo texto={t('Así somos', 'This is us')} as="span" />} fotos={boda.galeria} />

      <footer className="pie-sitio">
        <div className="contenedor">
          <Capitulo texto={t('Los esperamos', 'We hope to see you')} />
          <p className="nombres-gigantes" aria-label={`${novios.ella} ${t('y', 'and')} ${novios.el}`}>
            <span aria-hidden>{novios.ella}</span><span aria-hidden className="segundo"><em className="amp">&amp;</em> <em>{novios.el}</em></span>
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
 * «Qué puedo hacer aquí»: lo importante del momento, en filas finas que llevan
 * a su pestaña. Lo que falta hacer lleva su estado en versalitas champán.
 */
function Accesos({ fase, inv, abrirPresentacion }) {
  const g = inv?.grupo;
  const items = [];
  if (fase === 'invitacion') {
    items.push(g?.respondido_at
      ? { a: '/confirmar', i: 'confirmar', t: t('Ya confirmaste', 'You replied'), d: t('Ver o cambiar tu respuesta', 'See or change your reply'), hecho: true }
      : { a: '/confirmar', i: 'confirmar', t: t('Confirma tu asistencia', 'RSVP'), d: g ? t(`Antes del ${limiteConfirmar(inv.limite)}`, `By ${limiteConfirmar(inv.limite)}`) : t('Con el código de tu invitación', 'With your invitation code'), fuerte: true, estado: t('Falta tu respuesta', 'Reply pending') });
    items.push({ a: '/evento', i: 'lugar', t: t('Dónde y cuándo', 'Where and when'), d: t('Mapa, programa y vestimenta', 'Map, schedule and dress code') });
    items.push({ a: '/canciones', i: 'musica', t: t('Pide una canción', 'Request a song'), d: t('La que no puede faltar', "The one that can't be missed") });
    items.push({ a: '/mensajes', i: 'mensajes', t: t('Déjanos un mensaje', 'Leave us a message'), d: t('Escrito o de voz', 'Written or voice') });
  } else if (fase === 'boda') {
    items.push({ a: '/hoy', i: 'hoy', t: t('Qué está pasando', 'What’s happening'), d: t('Programa en vivo y tu mesa', 'Live schedule and your table'), fuerte: true, estado: t('En vivo', 'Live') });
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
  const rotulo = fase === 'recuerdos' ? t('Para recordar', 'To remember') : fase === 'boda' ? t('Esta noche', 'Tonight') : t('Para ti', 'For you');
  return (
    <section className="seccion-inicio" aria-label={t('Qué puedes hacer', 'What you can do')}>
      <div className="contenedor dividida">
        <Revelar className="dividida-titulo"><Capitulo texto={rotulo} /></Revelar>
        <ul className="accesos">
          {items.map((x, k) => {
            const cuerpo = <>
              <span className="acceso-icono"><Icono n={x.i} tam={24} grueso={1.3} /></span>
              <span className="acceso-texto">{x.estado && <span className="estado-acceso">{x.estado}</span>}<b>{x.t}</b><span>{x.d}</span></span>
              <Icono n="flecha" tam={18} grueso={1.3} className="acceso-flecha" />
            </>;
            const clase = `acceso ${x.fuerte ? 'fuerte' : ''} ${x.hecho ? 'hecho' : ''}`;
            return (
              <li key={k}>
                {x.boton
                  ? <button type="button" className={clase} onClick={x.boton}>{cuerpo}</button>
                  : <Link to={x.a} viewTransition className={clase} onPointerEnter={() => precargar(x.a)} onPointerDown={() => precargar(x.a)} onFocus={() => precargar(x.a)}>{cuerpo}</Link>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
