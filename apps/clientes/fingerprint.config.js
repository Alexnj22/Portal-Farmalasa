// La huella de lo nativo (runtimeVersion: fingerprint) y el arranque de Android
// (2026-11-12).
//
// La pantalla de arranque de Android 12+ recorta el ícono en un círculo de 2/3
// del lado, y el logo ancho salía con las puntas cortadas. El arreglo es una
// imagen sólo para Android, en `expo-splash-screen` › `android` de app.json.
// Pero la huella cuenta app.json entero en las DOS plataformas: con ese bloque,
// iOS cambiaba de huella sin que cambie nada de iOS, y la build que ya está en
// la tienda dejaba de recibir las actualizaciones por aire.
//
// Acá se saca el bloque `android` de ese plugin antes de contar. iOS no lo lee
// y queda con su huella. Android sí cambia, y está bien: la imagen de
// `android.image` igual entra a su huella como archivo (fingerprint la suma
// sólo en Android).
//
// Sólo se toca esa clave. El resto de app.json cuenta igual que siempre.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  fileHookTransform(source, chunk) {
    if (source.type !== 'contents' || source.id !== 'expoConfig' || chunk == null) return chunk;
    const config = JSON.parse(chunk.toString());
    for (const p of config.plugins ?? []) {
      if (Array.isArray(p) && p[0] === 'expo-splash-screen' && p[1]) delete p[1].android;
    }
    return JSON.stringify(config);
  },
};
