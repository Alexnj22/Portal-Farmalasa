// Los permisos de Android que la app NO usa (2026-10-19, auditoría para las
// tiendas). Las librerías los traen en su manifiesto y el fusionado los
// declaraba todos: Google Play los muestra en la ficha y pide justificar
// varios, y el aviso de privacidad (cláusula 10.13) dice que la app no usa el
// micrófono. Medido con `expo prebuild` + los manifiestos de las librerías.
//
// Dos maneras, según el caso:
//   · `android.blockedPermissions` (en app.config.js, lista `BLOQUEADOS`):
//     se quitan del todo (`tools:node="remove"`).
//   · WRITE_EXTERNAL_STORAGE NO se puede quitar del todo: en Android 9 o
//     anterior expo-image-picker la pide junto con CAMERA para
//     `launchCameraAsync` (ImagePickerModule.kt, `ensureCameraPermissionsAreGranted`),
//     y sin ella la foto de la receta fallaría en esos teléfonos. Este plugin
//     la deja SÓLO hasta Android 9 (`maxSdkVersion="28"`): de Android 10 en
//     adelante no aparece.
const { withAndroidManifest } = require('expo/config-plugins');

const ESCRITURA = 'android.permission.WRITE_EXTERNAL_STORAGE';

module.exports = function permisosAndroid(config) {
  return withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m.$['xmlns:tools'] = m.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const lista = (m['uses-permission'] ?? []).filter((p) => p.$?.['android:name'] !== ESCRITURA);
    lista.push({ $: { 'android:name': ESCRITURA, 'android:maxSdkVersion': '28', 'tools:replace': 'android:maxSdkVersion' } });
    m['uses-permission'] = lista;
    return c;
  });
};
