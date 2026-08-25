// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { anotar, entorno, iniciarPulso, iniciarSondaRotacion, recogerPulso } from "./utils/cajaNegra";
import { APP_VERSION } from "./version";
import { marcarVersionNueva } from "./utils/versionNueva";

// Supabase uses the Web Locks API internally to serialize token refreshes.
// When multiple async auth operations fire simultaneously (validateSession +
// onAuthStateChange INITIAL_SESSION) they race for the same lock and the
// loser times out after 10 s. This is a known supabase-js bug — suppress it
// so it doesn't surface as an unhandled rejection in the console.
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('LockManager lock')) {
    event.preventDefault();
    return;
  }
  anotar('promesa-sin-capturar', { msg: String(event.reason?.message || event.reason).slice(0, 200) });
});

// ── La caja negra ─────────────────────────────────────────────────────────
// Se engancha ACÁ arriba, antes de que React monte, porque lo que hay que
// atrapar puede pasar durante el arranque. Ver `utils/cajaNegra.js` para por
// qué existe: hay un fallo que sólo ocurre en el iPhone del usuario, la página
// se RECARGA (así que la consola se pierde) y el emulador no lo reproduce.
// El orden importa para poder leerlo: primero se levanta el cuerpo de la sesión
// anterior —si murió sin despedirse—, y recién después se anota este arranque.
// Así una muerte súbita se lee como `murio` seguido de `arranque`, que es
// exactamente el par que el fallo del iPhone no dejaba ver.
recogerPulso();
anotar('arranque', { version: APP_VERSION, ...entorno() });
iniciarPulso();
// La sonda no corre sola: se queda dormida hasta que el teléfono gira, y ahí
// mide un rato corto. Ver `cajaNegra.js` para qué separa.
iniciarSondaRotacion();

window.addEventListener('error', (e) => {
  // `error` también salta por un recurso que no cargó (img, script). Ahí no hay
  // `error.message` y lo que interesa es CUÁL recurso — que es justo el caso de
  // un chunk que el servidor ya no tiene.
  if (e.target && e.target !== window && e.target.tagName) {
    anotar('recurso-fallido', {
      tag: e.target.tagName,
      src: String(e.target.src || e.target.href || '').slice(-120),
    });
    return;
  }
  anotar('error-js', { msg: String(e.message).slice(0, 200), en: `${e.filename?.split('/').pop() ?? '?'}:${e.lineno}` });
}, true);   // en captura: los errores de recurso no burbujean

document.addEventListener('visibilitychange', () => {
  anotar('visibilidad', { estado: document.visibilityState });
});

// Tras un deploy, los chunks con hash viejo ya no existen en el servidor y el
// SPA fallback devuelve index.html ("'text/html' is not a valid JavaScript
// MIME type") al hacer un import() dinámico (React.lazy). Vite emite
// vite:preloadError en ese caso.
//
// ── Acá había una recarga, y se la sacó a propósito (2026-08-25) ───────────
// `window.location.reload()` sin preguntar se lleva todo lo escrito y no
// guardado. Pedido del usuario: *«no que se haga de un solo, imagina que se
// esté trabajando o llenando algo y se pierda por eso»*. Hoy esto sólo AVISA;
// la recarga la aprieta una persona, en `AvisoVersionNueva`.
//
// El evento NO se cancela: sin `preventDefault()` el fallo sigue su camino
// hasta el `ErrorBoundary`, y eso es lo que se quiere — el toque tiene que
// producir algo visible. Cancelarlo dejaba la pantalla igual que un toque que
// no registró, que es exactamente lo que el usuario reportaba como «le doy y
// no abre».
window.addEventListener('vite:preloadError', (event) => {
  anotar('chunk-no-cargo', { url: String(event.payload?.url || '').slice(-120), avisado: true });
  marcarVersionNueva({ bloqueado: true });
});

import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import MotionProvider from "./components/MotionProvider";

// Register service worker for Web Push
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <MotionProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MotionProvider>
    </ThemeProvider>
  </React.StrictMode>
);