import { lazy, Suspense, useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation, useParams } from 'react-router-dom';
import Inicio from './pages/Inicio';
import { modoDemo } from './lib/api';
import { boda } from './config';
import { pruebasDisponibles } from './lib/reloj';
import { pantalla } from './lib/precarga';
import AppMarco from './components/AppMarco';
import ErrorRuta, { limpiarMarcaDeRecarga } from './components/ErrorRuta';
import Esqueleto from './components/Esqueleto';

const PanelPruebas = lazy(() => import('./components/PanelPruebas'));

function ConCodigo() {
  const { codigo } = useParams();
  return <Inicio codigo={codigo} />;
}

/** Marco de todo el sitio: aviso de la demo, la pantalla y el panel de pruebas. */
function Raiz() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = `${boda.novios.firma} · Nuestra boda`; }, []);
  // Si la página lleva un rato funcionando, la recarga por versión nueva vuelve a estar permitida.
  useEffect(() => { const t = setTimeout(limpiarMarcaDeRecarga, 10000); return () => clearTimeout(t); }, []);
  const esPantalla = pathname.startsWith('/pantalla') || pathname.startsWith('/dj');
  return (
    <>
      {modoDemo && !esPantalla && (
        <div className="cinta-demo">Versión de prueba: lo que hagas se guarda sólo en este navegador.</div>
      )}
      <Outlet />
      {pruebasDisponibles && !esPantalla && <Suspense fallback={null}><PanelPruebas /></Suspense>}
      {/* Cambiar de pestaña vuelve arriba; «atrás» vuelve a donde estabas. */}
      <ScrollRestoration />
    </>
  );
}

// Fuera de la barra de pestañas (proyector, DJ, panel): su propio Suspense.
const suelta = (ruta) => {
  const P = pantalla(ruta);
  return <Suspense fallback={<Esqueleto />}><P /></Suspense>;
};
// Dentro de la barra: el Suspense vive en AppMarco (la barra no parpadea).
const enMarco = (ruta) => { const P = pantalla(ruta); return <P />; };

/** Las rutas del sitio (createBrowserRouter, en main.jsx). */
export const rutas = [{
  element: <Raiz />,
  errorElement: <ErrorRuta />,
  children: [
    {
      element: <AppMarco />,
      children: [
        { path: '/', element: <Inicio /> },
        { path: '/i/:codigo', element: <ConCodigo /> },
        ...['/evento', '/confirmar', '/mensajes', '/hoy', '/mas', '/album', '/canciones', '/juego', '/juego/trivia', '/juego/bingo', '/juego/retos']
          .map((r) => ({ path: r, element: enMarco(r) })),
        { path: '*', element: <Inicio /> },
      ],
    },
    { path: '/pantalla', element: suelta('/pantalla') },
    { path: '/dj', element: suelta('/dj') },
    // El panel es registro producto: se queda en papel claro (estilos/claro.css).
    { path: '/admin/*', element: <div className="tema-claro">{suelta('/admin')}</div> },
  ],
}];
