import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { boda } from '../config';
import { faseActual, faseAlMenos } from '../lib/fase';
import { t, useIdioma, BotonIdioma } from '../lib/idioma';
import { useFacil } from '../lib/facil';
import { useInvitacion } from '../lib/miInvitacion';
import Icono from './Iconos';
import { BotonFacil } from './Facil';
import { AvisoEnVivo } from './EnVivo';
import AppFacil from './AppFacil';

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

function BarraApp() {
  const fase = faseActual();
  const { pathname } = useLocation();
  const { inv } = useInvitacion();
  const pendiente = inv?.grupo && !inv.grupo.respondido_at && fase === 'invitacion';
  return (
    <nav className="barra-app" aria-label={t('Secciones', 'Sections')}>
      {pestanas(fase).map(([a, icono, txt, centro]) => {
        const activo = a === '/' ? pathname === '/' || pathname.startsWith('/i/') : pathname.startsWith(a);
        return (
          <NavLink key={a} to={a} className={`pestana-app ${centro ? 'centro' : ''} ${activo ? 'activa' : ''}`} aria-current={activo ? 'page' : undefined}>
            <span className="icono-pestana"><Icono n={icono} tam={centro ? 26 : 24} />{a === '/confirmar' && pendiente && <i className="globo" aria-label={t('pendiente', 'pending')} />}</span>
            <span className="txt-pestana">{txt}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

/** Marco de todas las pantallas del invitado: aviso en vivo, contenido y barra. */
export default function AppMarco() {
  useIdioma();
  const facil = useFacil();
  return (
    <>
      <AvisoEnVivo />
      {facil ? <AppFacil /> : <><div className="con-barra"><Outlet /></div><BarraApp /></>}
    </>
  );
}

/** Página interior: barra de arriba sencilla y un título grande, estilo app. */
export function PaginaApp({ titulo, bajada, children, variante = '', accion }) {
  return (
    <div className={`pagina-app ${variante}`}>
      <header className="cabeza-app">
        <div className="contenedor fila-cabeza">
          <Link to="/" className="marca">{boda.novios.ella[0]} & {boda.novios.el[0]}</Link>
          <div className="nav-acciones"><BotonFacil /><BotonIdioma /></div>
        </div>
      </header>
      <main className="contenedor cuerpo-app">
        <div className="titulo-app">
          <h1>{titulo}</h1>
          {bajada && <p>{bajada}</p>}
          {accion}
        </div>
        {children}
      </main>
    </div>
  );
}

export { faseAlMenos };
