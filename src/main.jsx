// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

// Supabase uses the Web Locks API internally to serialize token refreshes.
// When multiple async auth operations fire simultaneously (validateSession +
// onAuthStateChange INITIAL_SESSION) they race for the same lock and the
// loser times out after 10 s. This is a known supabase-js bug — suppress it
// so it doesn't surface as an unhandled rejection in the console.
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('LockManager lock')) {
    event.preventDefault();
  }
});

// Tras un deploy, los chunks con hash viejo ya no existen en el servidor y el
// SPA fallback devuelve index.html ("'text/html' is not a valid JavaScript
// MIME type") al hacer un import() dinámico (React.lazy). Vite emite
// vite:preloadError en ese caso: recargamos para tomar el bundle nuevo,
// con guard de 30s en sessionStorage para no entrar en loop de reloads.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'chunk_reload_at';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last > 30_000) {
    event.preventDefault();
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
  }
});

import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";

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
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);