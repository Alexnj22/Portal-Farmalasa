// La configuración vive en app.json; esto sólo le agrega lo que NO puede ir en
// el repositorio. `google-services.json` (Firebase, para los avisos en
// Android) lo entrega Expo al compilar como archivo secreto
// (`GOOGLE_SERVICES_JSON`, `eas env`). En esta Mac vive en
// ~/.claves-farmalasa/, fuera del proyecto.
const path = require('path');
const os = require('os');
const fs = require('fs');

// La llave de Google Maps para ANDROID (2026-10-12). `react-native-maps` en
// Android usa el SDK de Google Maps, y sin llave la app SE CERRABA al abrir el
// mapa de una ruta («API key not found»). Con la llave, `componentes/SinMapa`
// (`hayMapa`) muestra el mapa; sin ella, el botón «Abrir en Google Maps». Va
// restringida a este paquete y a sus huellas SHA-1 en Google Cloud, así que
// viajar dentro del binario es lo esperado; igual no va al repositorio.
function llaveDeMaps() {
  if (process.env.GOOGLE_MAPS_ANDROID_KEY) return process.env.GOOGLE_MAPS_ANDROID_KEY.trim();
  const archivo = path.join(os.homedir(), '.claves-farmalasa', 'google-maps-android.txt');
  return fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8').trim() || undefined : undefined;
}

module.exports = ({ config }) => {
  const local = path.join(os.homedir(), '.claves-farmalasa', 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? local : undefined);
  const apiKey = llaveDeMaps();
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      ...(apiKey ? { config: { ...config.android?.config, googleMaps: { apiKey } } } : {}),
    },
  };
};
