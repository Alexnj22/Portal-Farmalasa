import { lazy, Suspense, useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { boda } from '../config';
import { faseActual, faseAlMenos, useFase } from '../lib/fase';
import { precargar, enRatoLibre } from '../lib/precarga';
import { t, useIdioma, BotonIdioma } from '../lib/idioma';
import { useFacil } from '../lib/facil';
import { useInvitacion } from '../lib/miInvitacion';
import Icono from './Iconos';
import { BotonFacil } from './Facil';
import { AvisoEnVivo } from './EnVivo';
import BotonMusica from './BotonMusica';
import Esqueleto from './Esqueleto';

// Los abuelos tienen su propia app; nadie más la descarga.
const AppFacil = lazy(() => import('./AppFacil'));

/** Las pestañas de abajo cambian según el momento: antes, el día y después. */
export function pestanas(fase) {
  if (fase === 'boda') return [
    ['/hoy', 'hoy', t('Hoy', 'Today')], ['/canciones', 'musica', t('Canciones', 'Songs')],
    ['/album', 'camara', t('Fotos', 'Photos'), true], ['/juego', 'juego', t('Juegos', 'Games')], ['/mas', 'mas', t('Más', 'More')],
  ];
  if (fase === 'recuerdos') return [
    ['/', 'inicio', t('Inicio', 'Home')], ['/mensajes', 'mensajes', t('Mensajes', 'Messages')],
    ['/album', 'fotos', t('Fotos', 'Photos'), true], ['/evento', 'lugar', t('La boda', 'Wedding')], ['/mas', 'mas', t('Más', 'More')],
  ];
  if (fase === 'save-the-date') return [
    ['/', 'inicio', t('Inicio', 'Home')], ['/confirmar', 'calendario', t('Tu lugar', 'Your seat'), true], ['/mas', 'mas', t('Más', 'More')],
  ];
  return [
    ['/', 'inicio', t('Inicio', 'Home')], ['/evento', 'lugar', t('Dónde', 'Where')],
    ['/confirmar', 'confirmar', t('Confirmar', 'RSVP'), true], ['/mensajes', 'mensajes', t('Mensajes', 'Messages')], ['/mas', 'mas', t('Más', 'More')],
  ];
}

/** ¿Esta pestaña es la de la pantalla actual? */
const esActiva = (a, pathname) => (a === '/' ? pathname === '/' || pathname.startsWith('/i/') : pathname === a || pathname.startsWith(`${a}/`));

// Dirección del cambio de pestaña, para que la transición se deslice hacia el
// lado correcto (izquierda → derecha o al revés). La lee el CSS en <html>.
function marcarDireccion(desde, hacia) {
  document.documentElement.dataset.dir = hacia >= desde ? 'adelante' : 'atras';
}

function BarraApp({ fase }) {
  const { pathname } = useLocation();
  const { inv } = useInvitacion();
  const pendiente = inv?.grupo && !inv.grupo.respondido_at && fase === 'invitacion';
  const lista = pestanas(fase);
  const activa = lista.findIndex(([a]) => esActiva(a, pathname));
  // En un rato libre se bajan las pestañas de esta fase: tocar una ya no espera.
  useEffect(() => enRatoLibre(() => lista.forEach(([a]) => precargar(a))), [fase]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <nav className="barra-app" aria-label={t('Secciones', 'Sections')} style={{ '--n': lista.length, '--i': Math.max(0, activa) }}>
      <span className={`indicador-pestana ${activa < 0 || lista[activa]?.[3] ? 'sin' : ''}`} aria-hidden />
      {lista.map(([a, icono, txt, centro], i) => {
        const activo = i === activa;
        const alerta = a === '/confirmar' && pendiente;
        return (
          <NavLink key={a} to={a} viewTransition className={`pestana-app ${centro ? 'centro' : ''} ${activo ? 'activa' : ''}`} aria-current={activo ? 'page' : undefined}
            onPointerEnter={() => precargar(a)} onPointerDown={() => precargar(a)} onFocus={() => precargar(a)} onClick={() => marcarDireccion(activa, i)}>
            <span className="icono-pestana"><Icono n={icono} tam={centro ? 26 : 24} />{alerta && <i className="globo" aria-hidden />}</span>
            <span className="txt-pestana">{txt}{alerta && <span className="oculto-visual">{t(' (falta responder)', ' (reply pending)')}</span>}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/** En computadora (≥1024 px) la navegación va en la cabecera, no abajo. */
export function NavEscritorio({ fase = faseActual() }) {
  const { pathname } = useLocation();
  const lista = pestanas(fase);
  const activa = lista.findIndex(([a]) => esActiva(a, pathname));
  return (
    <nav className="nav-escritorio" aria-label={t('Secciones', 'Sections')}>
      {lista.map(([a, , txt, centro], i) => (
        <NavLink key={a} to={a} viewTransition className={`${centro ? 'principal' : ''} ${i === activa ? 'activa' : ''}`} aria-current={i === activa ? 'page' : undefined}
          onPointerEnter={() => precargar(a)} onFocus={() => precargar(a)} onClick={() => marcarDireccion(activa, i)}>{txt}</NavLink>
      ))}
    </nav>
  );
}

/** Marco de todas las pantallas del invitado: aviso en vivo, contenido y barra. */
export default function AppMarco() {
  useIdioma();
  const facil = useFacil();
  const { fase, noche } = useFase();
  // Tema nocturno: el día de la boda, desde las 6 p. m. del lugar (ver DESIGN.md).
  useEffect(() => {
    const raiz = document.documentElement;
    if (noche && !facil) raiz.dataset.tema = 'noche'; else delete raiz.dataset.tema;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', noche && !facil ? '#151808' : '#f5f0e4');
  }, [noche, facil]);
  // Fotos que quedaron a medio subir (se cerró la página): se retoman solas.
  useEffect(() => enRatoLibre(() => {
    import('../lib/colaSubidas').then((m) => m.reanudarSiHay()).catch((e) => console.error('Cola de subidas', e));
  }, 4000), []);
  return (
    <>
      <AvisoEnVivo fase={fase} />
      {facil
        ? <Suspense fallback={<div className="facil-pantalla" aria-busy="true" />}><AppFacil /></Suspense>
        : <>
            {/* Al cambiar de fase (medianoche del lugar) todo se vuelve a armar. */}
            <div className="con-barra" key={fase}>
              <Suspense fallback={<Esqueleto />}><Outlet /></Suspense>
            </div>
            <BarraApp fase={fase} />
          </>}
    </>
  );
}

/**
 * Página interior: cabecera fija con la marca, título grande con la última
 * palabra en cursiva, y el contenido. En computadora, el título a la
 * izquierda (1/3) y el contenido a la derecha (2/3).
 */
export function PaginaApp({ titulo, bajada, children, variante = '', accion }) {
  return (
    <div className={`pagina-app ${variante}`}>
      <header className="cabeza-app">
        <div className="contenedor fila-cabeza">
          <Link to="/" viewTransition className="marca">{boda.novios.ella[0]} &amp; {boda.novios.el[0]}</Link>
          <NavEscritorio />
          <div className="nav-acciones"><BotonMusica /><BotonFacil /><BotonIdioma /></div>
        </div>
      </header>
      <main className="contenedor cuerpo-app">
        <div className="titulo-app">
          <h1>{titulo}</h1>
          {bajada && <p>{bajada}</p>}
          {accion}
        </div>
        <div className="contenido-app">{children}</div>
      </main>
    </div>
  );
}

export { faseAlMenos };
