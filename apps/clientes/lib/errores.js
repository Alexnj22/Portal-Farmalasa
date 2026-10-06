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
