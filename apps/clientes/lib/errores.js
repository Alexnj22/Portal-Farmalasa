// El reporte de errores (Sentry, plan gratuito: 5,000 errores al mes). Si la
// app se cierra o lanza, llega solo — sin depender de que la persona mande el
// reporte de TestFlight, que es como se supo del cierre en iOS 27.
//
// Apagado mientras no haya DSN: `EXPO_PUBLIC_SENTRY_DSN` sale de la cuenta de
// Sentry (proyecto React Native) y va en `eas.json`, perfil `clientes`.
//
// Lo que NO viaja: ni el DUI, ni el teléfono, ni el token de sesión. Sólo el
// error, la pantalla y el modelo del teléfono (`sendDefaultPii: false`).
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const reportaErrores = !!DSN && !__DEV__;

if (reportaErrores) {
  Sentry.init({
    dsn: DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    environment: 'produccion',
    beforeSend(evento) {
      // Por si algún mensaje de error arrastró un documento o un token.
      const limpiar = (t) => (typeof t === 'string' ? t.replace(/\b\d{8}-?\d\b/g, '[dui]').replace(/[A-Za-z0-9_-]{30,}/g, '[token]') : t);
      if (evento.message) evento.message = limpiar(evento.message);
      for (const e of evento.exception?.values ?? []) e.value = limpiar(e.value);
      return evento;
    },
  });
}

/** Envuelve la raíz: sin DSN devuelve el componente tal cual. */
export const conReporte = (Componente) => (reportaErrores ? Sentry.wrap(Componente) : Componente);

// ── Reporte propio al portal (2026-10-08) ─────────────────────────────────
// Mientras no haya cuenta de Sentry, cada error de JavaScript se manda a la
// tabla `app_errores` por la acción `reportar_error`: el mensaje (limpio de
// documentos y tokens), la pila, la pantalla, la versión y el modelo. Un error
// fatal también se manda antes de que la app se cierre.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { llamar } from './api';

const limpiarTexto = (t) => (typeof t === 'string'
  ? t.replace(/\b\d{8}-?\d\b/g, '[dui]').replace(/[A-Za-z0-9_-]{30,}/g, '[token]') : t);
let ultimo = '';
let pantallaActual = null;
export const anotarPantalla = (p) => { pantallaActual = p; };

export function reportarError(error, { fatal = false, pantalla = null } = {}) {
  try {
    const mensaje = limpiarTexto(String(error?.message ?? error ?? 'Error'));
    const clave = `${mensaje}|${fatal}`;
    if (clave === ultimo) return; // el mismo error en ráfaga, una sola vez
    ultimo = clave;
    // El token se lee tarde para no importar la sesión al cargar (evita ciclos).
    const { useSesion } = require('./sesion');
    llamar('reportar_error', {
      token: useSesion.getState().token ?? undefined,
      fatal, mensaje, pila: limpiarTexto(String(error?.stack ?? '')).slice(0, 8000),
      pantalla: pantalla ?? pantallaActual, version: Constants.expoConfig?.version ?? null,
      compilacion: Constants.expoConfig?.ios?.buildNumber ?? null, plataforma: Platform.OS, dispositivo: Device.modelName,
    }).catch(() => {});
  } catch { /* reportar nunca puede romper la app */ }
}

// El capturador global: todo error sin atrapar pasa por aquí antes de lo de siempre.
if (!__DEV__ && global.ErrorUtils?.setGlobalHandler) {
  const anterior = global.ErrorUtils.getGlobalHandler?.();
  global.ErrorUtils.setGlobalHandler((error, esFatal) => {
    reportarError(error, { fatal: !!esFatal });
    if (anterior) setTimeout(() => anterior(error, esFatal), esFatal ? 800 : 0);
  });
}
