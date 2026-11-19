import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
// Fuentes propias (sin Google Fonts): Bodoni Moda e Inter Tight, sólo latín.
import './estilos/fuentes.css';
import { rutas } from './App';
import { registrarServiceWorker } from './lib/pwa';
import './styles.css';
import './estilos/claro.css';

const router = createBrowserRouter(rutas, {
  future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
});
registrarServiceWorker(router);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
);
