// La configuración vive en app.json; esto sólo le agrega lo que NO puede ir en
// el repositorio: `google-services.json` (Firebase, para los avisos en
// Android), que en esta Mac vive en ~/.claves-farmalasa/ — el mismo archivo
// que usa la app del personal (apps/mobile/app.config.js).
//
// Sólo se conecta si el archivo TRAE esta app: el de Firebase lista cada app
// Android por su paquete, y con uno que no trae `lat.farmasalud.clientes` la
// compilación se cae («No matching client found for package name»). Sin él la
// app compila igual y lo único que no anda en Android son los avisos.
const path = require('path');
const os = require('os');
const fs = require('fs');

function archivoDeFirebase(paquete) {
  const local = path.join(os.homedir(), '.claves-farmalasa', 'google-services.json');
  const archivo = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? local : null);
  if (!archivo) return undefined;
  try {
    const d = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    const trae = (d.client ?? []).some((c) => c.client_info?.android_client_info?.package_name === paquete);
    if (!trae) {
      console.warn(`⚠ ${archivo} no trae ${paquete}: Android compila SIN avisos. Agrega la app en Firebase y baja el archivo de nuevo.`);
      return undefined;
    }
    return archivo;
  } catch { return undefined; }
}

// App Links de Android (2026-10-17): el gemelo de los enlaces universales de
// iPhone (`ios.associatedDomains` + `public/.well-known/apple-app-site-association`).
// El QR del ticket (`/mis-puntos?codigo=…`) y una oferta compartida (`/o/<id>`)
// abren la app si está instalada; si no, la web de siempre. `autoVerify` hace
// que Android lo compruebe contra `public/.well-known/assetlinks.json` del
// portal al instalar: sin esa verificación Android pregunta «¿abrir con…?» o
// se queda en el navegador. Las rutas son las mismas que las del archivo de
// Apple — al agregar una allá, agregarla acá y viceversa.
// Vive aquí y no en app.json para no pisar a quien edite ese archivo; si un
// día app.json trae sus propios intentFilters, se suman, no se reemplazan.
const ENLACES_DEL_PORTAL = {
  action: 'VIEW',
  autoVerify: true,
  data: [
    { scheme: 'https', host: 'portal.farmasalud.lat', pathPrefix: '/mis-puntos' },
    { scheme: 'https', host: 'portal.farmasalud.lat', pathPrefix: '/o/' },
  ],
  category: ['BROWSABLE', 'DEFAULT'],
};

module.exports = ({ config }) => {
  const googleServicesFile = archivoDeFirebase(config.android?.package);
  return {
    ...config,
    android: {
      ...config.android,
      intentFilters: [...(config.android?.intentFilters ?? []), ENLACES_DEL_PORTAL],
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
