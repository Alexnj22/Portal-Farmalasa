import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { faseActual } from '../lib/fase';
import { fechaLarga, descargarIcs, enlaceGoogleCalendar, limiteConfirmar } from '../lib/fechas';
import { api } from '../lib/api';
import { t, useIdioma, contenido, BotonIdioma } from '../lib/idioma';
import Countdown from '../components/Countdown';
import { Titulo, Capitulo } from '../components/Seccion';
import { sinMovimiento } from '../lib/movimiento';
import GaleriaHorizontal from '../components/GaleriaHorizontal';
import { fechaBoda } from '../config';
import Revelar from '../components/Revelar';
import LogoStd from '../components/LogoStd';
import { BotonFacil } from '../components/Facil';
import BotonMusica from '../components/BotonMusica';
import { NavEscritorio, Monograma } from '../components/AppMarco';
import { imagenAdaptable, ANCHOS_PORTADA } from '../lib/fotos';
import { precargar } from '../lib/precarga';
import Icono from '../components/Iconos';
import { useInvitacion, usarCodigo } from '../lib/miInvitacion';
import { AhoraCompacto } from '../components/EnVivo';
import { useFacil } from '../lib/facil';

// Lo que no hace falta para pintar la portada se baja aparte.
const Sobre = lazy(() => import('../components/Sobre'));
const Presentacion = lazy(() => import('../components/Presentacion'));
const CintaEntrada = lazy(() => import('../components/CintaEntrada'));

/** 13 · FEB · 2027: el mes con letras (en romanos, «II» se leía como 11). */
const MESES = { es: 'ENE FEB MAR ABR MAY JUN JUL AGO SEP OCT NOV DIC', en: 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC' };
const fechaPuntos = () => {
  const [a, m, d] = fechaBoda.toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' }).split('-');
  const mes = t(MESES.es, MESES.en).split(' ')[Number(m) - 1];
  return `${Number(d)} · ${mes} · ${a}`;
};

// La apertura sale en cada carga de la página (también al actualizar). Sólo
// se salta al volver a la portada desde otra pantalla del sitio.
// (StrictMode monta dos veces seguidas: esa segunda vuelta sigue siendo la
// primera carga; por eso la marca se pone un momento después.)
let yaAbierta = null;
let proximaYaAbierta = false;

/**
 * La frase se va encendiendo palabra por palabra mientras se baja (--p de 0 a
 * 1, escrito por un solo rAF y sólo mientras la frase se ve). Las últimas
 * palabras, en cursiva champán.
 */
function FraseAlBajar({ texto, ultimas = 3 }) {
  const ref = useRef(null);
  const p = texto.trim().split(/\s+/);
  const corte = Math.max(0, p.length - ultimas);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (sinMovimiento()) { el.style.setProperty('--p', '1'); return undefined; }
    let cuadro = 0;
    const medir = () => {
      cuadro = 0;
      // Lo que mide es el TEXTO (la caja es más ancha que sus renglones).
    const partes = [...el.children].map((c) => c.getBoundingClientRect());
    const izq = Math.min(...partes.map((p) => p.left)); const der = Math.max(...partes.map((p) => p.right));
    const arr = Math.min(...partes.map((p) => p.top)); const aba = Math.max(...partes.map((p) => p.bottom));
    const r = { left: izq, top: arr, width: der - izq, height: aba - arr };
    const caja = el.getBoundingClientRect();
    el.style.transformOrigin = `${(izq + r.width / 2 - caja.left).toFixed(1)}px ${(arr + r.height / 2 - caja.top).toFixed(1)}px`;
      const vh = window.innerHeight;
      // 0 cuando la frase asoma por abajo; 1 cuando su centro pasa el 40 % de la pantalla.
      const q = (vh - r.top) / (vh * 0.6 + r.height * 0.5);
      el.style.setProperty('--p', Math.min(1, Math.max(0, q)).toFixed(3));
    };
    const pedir = () => { if (!cuadro) cuadro = requestAnimationFrame(medir); };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { window.addEventListener('scroll', pedir, { passive: true }); medir(); }
      else window.removeEventListener('scroll', pedir);
    });
    io.observe(el);
    return () => { io.disconnect(); window.removeEventListener('scroll', pedir); cancelAnimationFrame(cuadro); };
  }, []);
  return (
    <blockquote ref={ref} className="frase-al-bajar" style={{ '--n': p.length }} aria-label={texto}>
      {p.map((w, i) => {
        const pal = <span key={i} className={`pal ${i >= corte ? 'cursiva' : ''}`} style={{ '--i': i }} aria-hidden>{w}</span>;
        return i < p.length - 1 ? [pal, ' '] : pal;
      })}
    </blockquote>
  );
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
    if (yaAbierta === null) { yaAbierta = false; setTimeout(() => { proximaYaAbierta = true; }, 1000); }
    else if (proximaYaAbierta) yaAbierta = true;
    if (yaAbierta) document.documentElement.classList.add('ya-abierta');
  }, []);

  // Save the date, primera carga: la frase aparece sola al centro de la
  // pantalla y después viaja a su lugar en la portada (FLIP), mientras la foto
  // se abre detrás. Con enlace personal no: ahí abre el sobre.
  const tituloStd = useRef(null);
  useLayoutEffect(() => {
    const el = tituloStd.current;
    if (!el || yaAbierta || codigo || sinMovimiento() || !el.animate) return undefined;
    const html = document.documentElement;
    html.classList.add('std-intro');
    // Lo que mide es el TEXTO (la caja es más ancha que sus renglones).
    const partes = [...el.children].map((c) => c.getBoundingClientRect());
    const izq = Math.min(...partes.map((p) => p.left)); const der = Math.max(...partes.map((p) => p.right));
    const arr = Math.min(...partes.map((p) => p.top)); const aba = Math.max(...partes.map((p) => p.bottom));
    const r = { left: izq, top: arr, width: der - izq, height: aba - arr };
    const caja = el.getBoundingClientRect();
    el.style.transformOrigin = `${(izq + r.width / 2 - caja.left).toFixed(1)}px ${(arr + r.height / 2 - caja.top).toFixed(1)}px`;
    const s = Math.min(1.5, (window.innerWidth * 0.84) / r.width, (window.innerHeight * 0.6) / r.height);
    const dx = window.innerWidth / 2 - (r.left + r.width / 2);
    const dy = window.innerHeight / 2 - (r.top + r.height / 2);
    const centro = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)})`;
    const viaje = el.animate([
      { transform: centro, offset: 0 },
      { transform: centro, offset: 0.64, easing: 'cubic-bezier(.72, 0, .16, 1)' },
      { transform: 'none', offset: 1 },
    ], { duration: 3900, fill: 'backwards' });
    return () => { viaje.cancel(); html.classList.remove('std-intro'); };
  }, [codigo]);

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
      <header id="inicio" className={`portada ${fase === 'save-the-date' ? 'std' : ''}`} ref={portada}>
        <span ref={centinela} className="centinela-nav" aria-hidden />
        <div className="portada-foto"><img {...foto} style={boda.portadaEnfoque ? { objectPosition: boda.portadaEnfoque } : undefined} alt="" fetchpriority="high" decoding="async" /></div>
        {fase === 'save-the-date' && <span className="std-brillo" aria-hidden />}
        <span className="franja arriba" aria-hidden />
        <span className="franja abajo" aria-hidden />
        <div className="portada-texto">
          <div className="portada-arriba">
            {fase !== 'save-the-date' && <p className="versalita">{titulo}</p>}
            {inv?.grupo && <p className="saludo">{t('Para', 'For')} {inv.grupo.nombre}</p>}
          </div>
          {/* En el save the date, la frase ES lo principal; los nombres la firman. */}
          {fase === 'save-the-date' && (
            <p className="std-titulo" ref={tituloStd} aria-hidden><LogoStd /></p>
          )}
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
      {fase === 'save-the-date' && (
        <section id="faltan" className="faltan-std" aria-label={t('Cuánto falta', 'Countdown')}>
          <div className="faltan-std-foto" aria-hidden>
            <img {...imagenAdaptable(boda.fotoFaltan || boda.galeria[0], ANCHOS_PORTADA, '100vw')} alt="" loading="lazy" decoding="async" style={boda.fotoFaltanEnfoque ? { objectPosition: boda.fotoFaltanEnfoque } : undefined} />
          </div>
          <div className="faltan-std-texto">
            <Revelar><p className="versalita">{t('Faltan', 'Only')}</p></Revelar>
            <Countdown />
            <Revelar className="faltan-std-pie">
              <p className="grande-fecha">{fechaLarga()}</p>
              <div className="acciones">
                <a className="btn" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">Google Calendar</a>
                <button type="button" className="btn claro-sobre-foto" onClick={descargarIcs}>Apple / Outlook</button>
              </div>
            </Revelar>
          </div>
        </section>
      )}

      {fase !== 'recuerdos' && fase !== 'boda' && fase !== 'save-the-date' && (
        <section id="faltan" className="seccion-inicio faltan">
          <div className="contenedor">
            <Revelar><Capitulo texto={t('Faltan', 'Countdown')} /></Revelar>
            <Countdown />
            <Revelar className="faltan-pie">
              <p className="grande-fecha">{fechaLarga()}</p>
              <div className="acciones">
                <a className="btn claro chico" href={enlaceGoogleCalendar()} target="_blank" rel="noreferrer">Google Calendar</a>
                <button type="button" className="btn claro chico" onClick={descargarIcs}>Apple / Outlook</button>
              </div>
            </Revelar>
          </div>
        </section>
      )}

      {fase !== 'save-the-date' && <Accesos fase={fase} inv={inv} abrirPresentacion={abrirPresentacion} />}

      {/* El save the date es corto: portada, cuánto falta, historia, fotos y cierre. */}
      {fase !== 'save-the-date' && <>
      {/* ── La frase: se enciende palabra por palabra al bajar ── */}
      <figure className="escena-frase">
        <Revelar>
          <span className="filete-corto" aria-hidden />
          <FraseAlBajar texto={boda.frase} />
          <figcaption className="versalita suave">{novios.firma}</figcaption>
        </Revelar>
      </figure>

      </>}

      {/* ── Nuestra historia: la foto queda fija y cambia con cada capítulo ── */}
      <Historia novios={novios} historia={boda.historia} respaldo={boda.fotoHistoria} />

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
            {fase !== 'save-the-date' && boda.contacto?.whatsapp && (
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
 * Nuestra historia: a un lado, la foto del capítulo que se está leyendo, fija;
 * al otro, los capítulos. Al bajar, la foto se funde con la siguiente (con un
 * acercamiento lento) y el índice de años marca dónde vas. En el teléfono la
 * foto queda arriba y los capítulos pasan debajo.
 */
function Historia({ novios, historia, respaldo }) {
  const [activo, setActivo] = useState(0);
  const caps = useRef([]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) setActivo(Number(e.target.dataset.i)); });
    }, { rootMargin: '-62% 0px -34% 0px' });
    caps.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [historia.length]);
  return (
    <section id="historia" className="historia" aria-labelledby="titulo-historia">
      <div className="contenedor">
        <Revelar className="historia-cabeza">
          <p className="versalita">{novios.ella} &amp; {novios.el}</p>
          <Titulo texto={t('Nuestra historia', 'Our story')} as="h2" id="titulo-historia" />
        </Revelar>
        <div className="historia-cuerpo">
          <div className="historia-visor" aria-hidden>
            <div className="historia-marco">
              {historia.map((h, i) => (h.foto || respaldo) && (
                <img key={i} className={i === activo ? 'activa' : ''} style={h.enfoque ? { objectPosition: h.enfoque } : undefined} {...imagenAdaptable(h.foto || respaldo, ANCHOS_PORTADA, '(min-width: 900px) 46vw, 100vw')} alt="" loading="lazy" decoding="async" />
              ))}
              <span className="historia-anio" key={activo}>{historia[activo]?.fecha}</span>
            </div>
            <ol className="historia-indice">
              {historia.map((h, i) => <li key={i} className={i === activo ? 'activo' : ''}>{h.fecha}</li>)}
            </ol>
          </div>
          <ol className="historia-capitulos">
            {historia.map((h, i) => (
              <li key={i} data-i={i} ref={(el) => { caps.current[i] = el; }} className={`historia-cap ${i === activo ? 'activo' : ''}`}>
                <Capitulo numero={i + 1} texto={`${t('Capítulo', 'Chapter')} · ${h.fecha}`} />
                <Titulo texto={h.titulo} as="h3" />
                <p>{h.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
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
