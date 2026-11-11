import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useParams, useLocation } from 'react-router-dom';
import Inicio from './pages/Inicio';
import Album from './pages/Album';
import { modoDemo } from './lib/api';
import { boda } from './config';
import { pruebasDisponibles } from './lib/reloj';
import { AvisoEnVivo } from './components/EnVivo';

const PanelPruebas = lazy(() => import('./components/PanelPruebas'));

// El panel y la pantalla en vivo no los descarga ningún invitado que no entre ahí.
const Admin = lazy(() => import('./pages/admin/Admin'));
const Pantalla = lazy(() => import('./pages/Pantalla'));
const Canciones = lazy(() => import('./pages/Canciones'));
const Juego = lazy(() => import('./pages/Juego'));
const Dj = lazy(() => import('./pages/Dj'));

function ConCodigo() {
  const { codigo } = useParams();
  return <Inicio codigo={codigo} />;
}

export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { document.title = `${boda.novios.firma} · Nuestra boda`; }, []);
  const esPantalla = pathname.startsWith('/pantalla') || pathname.startsWith('/dj');
  const esAdmin = pathname.startsWith('/admin');
  return (
    <>
      {modoDemo && !esPantalla && (
        <div className="cinta-demo">Versión de prueba: lo que hagas se guarda sólo en este navegador.</div>
      )}
      {!esPantalla && !esAdmin && <AvisoEnVivo />}
      <Suspense fallback={<p className="centro suave" style={{ padding: 60 }}>Cargando…</p>}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/i/:codigo" element={<ConCodigo />} />
          <Route path="/album" element={<Album />} />
          <Route path="/pantalla" element={<Pantalla />} />
          <Route path="/canciones" element={<Canciones />} />
          <Route path="/juego" element={<Juego />} />
          <Route path="/dj" element={<Dj />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="*" element={<Inicio />} />
        </Routes>
      </Suspense>
      {pruebasDisponibles && !esPantalla && <Suspense fallback={null}><PanelPruebas /></Suspense>}
    </>
  );
}
