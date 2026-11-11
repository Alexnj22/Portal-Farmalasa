import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useParams, useLocation } from 'react-router-dom';
import Inicio from './pages/Inicio';
import Album from './pages/Album';
import { modoDemo } from './lib/api';
import { boda } from './config';
import { pruebasDisponibles } from './lib/reloj';
import AppMarco from './components/AppMarco';

const PanelPruebas = lazy(() => import('./components/PanelPruebas'));

// El panel y la pantalla en vivo no los descarga ningún invitado que no entre ahí.
const Admin = lazy(() => import('./pages/admin/Admin'));
const Pantalla = lazy(() => import('./pages/Pantalla'));
const Canciones = lazy(() => import('./pages/Canciones'));
const Juegos = lazy(() => import('./pages/juegos/Juegos'));
const Trivia = lazy(() => import('./pages/juegos/Trivia'));
const Bingo = lazy(() => import('./pages/juegos/Bingo'));
const Retos = lazy(() => import('./pages/juegos/Retos'));
const Dj = lazy(() => import('./pages/Dj'));
const Evento = lazy(() => import('./pages/app/Evento'));
const Confirmar = lazy(() => import('./pages/app/Confirmar'));
const Mensajes = lazy(() => import('./pages/app/Mensajes'));
const Hoy = lazy(() => import('./pages/app/Hoy'));
const Mas = lazy(() => import('./pages/app/Mas'));

function ConCodigo() {
  const { codigo } = useParams();
  return <Inicio codigo={codigo} />;
}

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = `${boda.novios.firma} · Nuestra boda`; }, []);
  const esPantalla = pathname.startsWith('/pantalla') || pathname.startsWith('/dj');
  return (
    <>
      {modoDemo && !esPantalla && (
        <div className="cinta-demo">Versión de prueba: lo que hagas se guarda sólo en este navegador.</div>
      )}
      <Suspense fallback={<p className="centro suave" style={{ padding: 60 }}>Cargando…</p>}>
        <Routes>
          <Route element={<AppMarco />}>
            <Route path="/" element={<Inicio />} />
            <Route path="/i/:codigo" element={<ConCodigo />} />
            <Route path="/evento" element={<Evento />} />
            <Route path="/confirmar" element={<Confirmar />} />
            <Route path="/mensajes" element={<Mensajes />} />
            <Route path="/hoy" element={<Hoy />} />
            <Route path="/mas" element={<Mas />} />
            <Route path="/album" element={<Album />} />
            <Route path="/canciones" element={<Canciones />} />
            <Route path="/juego" element={<Juegos />} />
            <Route path="/juego/trivia" element={<Trivia />} />
            <Route path="/juego/bingo" element={<Bingo />} />
            <Route path="/juego/retos" element={<Retos />} />
            <Route path="*" element={<Inicio />} />
          </Route>
          <Route path="/pantalla" element={<Pantalla />} />
          <Route path="/dj" element={<Dj />} />
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </Suspense>
      {pruebasDisponibles && !esPantalla && <Suspense fallback={null}><PanelPruebas /></Suspense>}
    </>
  );
}
