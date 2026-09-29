// La sesión que la app le presta al portal web incrustado.
//
// Son las MISMAS claves que escribe el `AuthContext` del portal, porque es el
// mismo código: la sesión de auth-js, la ficha (`sb_user`) y el sello de
// actividad (`sb_last_activity_at`, sin él el portal la da por vencida).
//
// ── Un solo renovador a la vez ──────────────────────────────────────────────
// La app y el portal tienen cada uno su cliente de Supabase. Si los dos
// renuevan el MISMO token de refresco, el segundo usa uno ya gastado y
// Supabase cierra la sesión de los dos (detección de reuso). Por eso, mientras
// el portal está abierto la app deja de renovar, y cada vez que el portal
// renueva le avisa a la app, que adopta el token nuevo.
import * as almacen from '@plataforma/almacen';
import { AUTH_STORAGE_KEY } from '@nucleo/supabaseClient';

export const CLAVES_DE_SESION = [AUTH_STORAGE_KEY, 'sb_user', 'sb_last_activity_at'];

/** El script que corre en el portal ANTES que su propio código. */
// `abajo`: cuando el portal va dentro de una pestaña (sin barra de título), la
// WebView ocupa la pantalla entera —así el fondo pasa detrás de la hora y de
// la barra de vidrio, como en cualquier app del sistema— y el portal corre su
// CONTENIDO: arriba con su propio `--sa-top` (el `env()` de la WebView) y abajo
// con el alto de la barra de pestañas, que la WebView no conoce y la app sí.
export function scriptDeEntrada({ abajo = null } = {}) {
  const valores = {};
  for (const clave of CLAVES_DE_SESION) {
    const v = almacen.leer(clave);
    if (v != null) valores[clave] = v;
  }
  // El sello de actividad va con la hora de ahora: abrir el portal ES actividad.
  valores.sb_last_activity_at = String(Date.now());
  return `
    (function () {
      try {
        var valores = ${JSON.stringify(valores)};
        for (var k in valores) localStorage.setItem(k, valores[k]);
      } catch (e) {}
      window.__FARMALASA_APP__ = true;
      // Esconde la barra y las pestañas del portal (ver src/index.css).
      document.documentElement.setAttribute('data-en-la-app', '');
      var abajo = ${JSON.stringify(abajo)};
      if (abajo != null) {
        document.documentElement.setAttribute('data-en-pestana', '');
        document.documentElement.style.setProperty('--sa-bottom', abajo + 'px');
      }
      var original = Storage.prototype.setItem;
      var quitar = Storage.prototype.removeItem;
      var avisar = function (tipo, valor) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: tipo, valor: valor })); } catch (e) {}
      };
      Storage.prototype.setItem = function (k, v) {
        original.call(this, k, v);
        if (this === window.localStorage && k === ${JSON.stringify(AUTH_STORAGE_KEY)}) avisar('sesion', v);
      };
      Storage.prototype.removeItem = function (k) {
        quitar.call(this, k);
        if (this === window.localStorage && k === ${JSON.stringify(AUTH_STORAGE_KEY)}) avisar('salio', null);
      };
    })();
    true;
  `;
}
