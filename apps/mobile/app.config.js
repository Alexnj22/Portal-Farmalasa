// La configuración vive en app.json; esto sólo le agrega lo que NO puede ir en
// el repositorio. `google-services.json` (Firebase, para los avisos en
// Android) lo entrega Expo al compilar como archivo secreto
// (`GOOGLE_SERVICES_JSON`, `eas env`). En esta Mac vive en
// ~/.claves-farmalasa/, fuera del proyecto.
const path = require('path');
const os = require('os');
const fs = require('fs');

module.exports = ({ config }) => {
  const local = path.join(os.homedir(), '.claves-farmalasa', 'google-services.json');
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? local : undefined);
  return {
    ...config,
    android: { ...config.android, ...(googleServicesFile ? { googleServicesFile } : {}) },
  };
};
