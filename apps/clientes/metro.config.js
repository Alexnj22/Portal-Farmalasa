// Metro para la app de CLIENTES. Del portal sólo toma los colores
// (`@nucleo/constants/tokens.json`): esta app no comparte sesión, permisos ni
// consultas con el personal — habla con una sola puerta, `app-clientes`.
//
// La configuración base sale de Sentry (`getSentryExpoConfig`, que por dentro
// es el `getDefaultConfig` de Expo) para poder pedir `includeWebReplay: false`
// (2026-11-04): con eso Metro resuelve `@sentry-internal/replay` (rrweb, la
// grabación de sesión del navegador) a un módulo vacío y deja de viajar en el
// bundle de iPhone/Android. La app no usa Session Replay (lib/errores.js no lo
// enciende) y en 7.11 ese recorte NO pasa solo: el resolver de Sentry sólo se
// instala cuando la opción es `false` explícita. De paso agrega el Debug ID
// al bundle, que es lo que Sentry usa para casar los source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const app = __dirname;
const raiz = path.resolve(app, '../..');
const config = getSentryExpoConfig(app, { includeWebReplay: false });
const constantes = path.join(raiz, 'src', 'constants') + path.sep;
config.watchFolders = [constantes];

const resolverOriginal = config.resolver.resolveRequest;
config.resolver.resolveRequest = (contexto, nombre, plataforma) => {
  if (nombre.startsWith('@nucleo/constants/')) {
    return contexto.resolveRequest(contexto, path.join(raiz, 'src', 'constants', nombre.slice('@nucleo/constants/'.length)), plataforma);
  }
  return (resolverOriginal || contexto.resolveRequest)(contexto, nombre, plataforma);
};

module.exports = config;
