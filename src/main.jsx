// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { anotar, entorno } from "./utils/cajaNegra";
import { APP_VERSION } from "./version";

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
anotar('arranque', { version: APP_VERSION, ...entorno() });

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
// vite:preloadError en ese caso: recargamos para tomar el bundle nuevo,
// con guard de 30s en sessionStorage para no entrar en loop de reloads.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunk_reload_at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  const recargando = Date.now() - last > 30_000;
  // Se anota SIEMPRE, recargue o no. El caso que no recarga es el peor de los
  // dos y el que no dejaba rastro: dentro de la ventana de 30s el chunk sigue
  // sin cargar, la vista nunca aparece y no pasa nada visible — «le doy y no
  // abre». Sin esta línea, ese caso es indistinguible de un toque que no
  // registró.
  anotar('chunk-no-cargo', {
    url: String(event.payload?.url || '').slice(-120),
    recargando,
  });
  if (recargando) {
    event.preventDefault();
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
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