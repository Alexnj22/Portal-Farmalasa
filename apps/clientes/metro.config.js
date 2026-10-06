// Metro para la app de CLIENTES. Del portal sólo toma los colores
// (`@nucleo/constants/tokens.json`): esta app no comparte sesión, permisos ni
// consultas con el personal — habla con una sola puerta, `app-clientes`.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const app = __dirname;
const raiz = path.resolve(app, '../..');
const config = getDefaultConfig(app);
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
