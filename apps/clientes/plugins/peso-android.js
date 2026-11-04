// El PESO de la app en Android (2026-11-04). La auditoría midió ~45 MB de
// descarga; el AAB llevaba ~61 MB de dex sin achicar y 1.2 MB de tablas de
// una firma post-cuántica que nadie usa. `android/` NO está en git: lo
// regenera `expo prebuild --clean` (scripts/subir-android.mjs), así que todo
// va por este plugin y nada se edita a mano en android/.
//
// Tres cosas, ninguna quita una función:
//
// 1. R8 (minify + shrinkResources) en release. La plantilla de Expo ya lee
//    las dos propiedades de gradle.properties; expo-build-properties no está
//    instalado y no hace falta para esto.
//    · shrinkResources NO rompe las imágenes ni los sonidos de JS aunque se
//      busquen por nombre (`getIdentifier`): el empaquetado de Metro escribe
//      `res/raw/keep.xml` con la lista (@react-native/community-cli-plugin
//      createKeepFileAsync y @expo/cli persistMetroAssets).
//    · `-dontobfuscate`: se achica (se quita código muerto) pero NO se
//      renombra. Dos motivos: sin el plugin de Gradle de Sentry el mapping no
//      se sube y los errores de Java llegarían ilegibles; y lo que busca
//      clases por nombre (JNI de Skia/audio, reflexión) sigue encontrándolas.
//      Renombrar ahorraría un poco más; no vale el riesgo.
//
// 2. Reglas -keep para las librerías nativas que NO traen consumer rules
//    (revisado node_modules/*/android/{proguard-rules,consumer-rules}.pro):
//    Skia, Sentry RN, WebView, gesture-handler, screens, view-shot y los
//    módulos propios. Reanimated, worklets, audio-api, svg, expo-modules,
//    expo-updates y expo-notifications ya traen las suyas.
//
// 3. Fuera `org/bouncycastle/pqc/**` del paquete: son las tablas de la firma
//    Picnic (lowmcL1/L3/L5, 1.2 MB) que trae bcutil por expo-updates. Esa
//    librería sólo se usa para la firma de actualizaciones
//    (`updates.codeSigningCertificate`), que esta app NO configura — y aun
//    configurada usa RSA, no Picnic.
const fs = require('fs');
const path = require('path');
const { withGradleProperties, withDangerousMod } = require('expo/config-plugins');

const PROPIEDADES = {
  'android.enableMinifyInReleaseBuilds': 'true',
  'android.enableShrinkResourcesInReleaseBuilds': 'true',
};
const EXCLUIR = ['**/org/bouncycastle/pqc/**'];

const MARCA = '# peso-android: reglas para R8';
const REGLAS = `
${MARCA} (plugins/peso-android.js — no editar aquí, se regenera)
-dontobfuscate
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod

# Skia: el C++ llama a Java por JNI y por nombre.
-keep class com.shopify.reactnative.skia.** { *; }
# Sentry RN (el SDK de Android trae sus reglas; el puente de RN no).
-keep class io.sentry.react.** { *; }
# WebView: la interfaz que se expone a la página va por @JavascriptInterface.
-keep class com.reactnativecommunity.webview.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
# gesture-handler y screens (sin consumer rules).
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
# view-shot (captura de la tarjeta).
-keep class fr.greweb.reactnativeviewshot.** { *; }
# Módulos propios (widget de saldo, reserva viva).
-keep class lat.farmasalud.clientes.** { *; }
`;

module.exports = function pesoAndroid(config) {
  config = withGradleProperties(config, (c) => {
    const lista = c.modResults;
    const poner = (clave, valor) => {
      const fila = lista.find((p) => p.type === 'property' && p.key === clave);
      if (fila) fila.value = valor;
      else lista.push({ type: 'property', key: clave, value: valor });
    };
    for (const [clave, valor] of Object.entries(PROPIEDADES)) poner(clave, valor);
    const clave = 'android.packagingOptions.excludes';
    const fila = lista.find((p) => p.type === 'property' && p.key === clave);
    const actuales = (fila?.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    poner(clave, [...new Set([...actuales, ...EXCLUIR])].join(','));
    return c;
  });

  return withDangerousMod(config, ['android', (c) => {
    const archivo = path.join(c.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
    const antes = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '';
    if (!antes.includes(MARCA)) fs.writeFileSync(archivo, antes.replace(/\s*$/, '\n') + REGLAS);
    return c;
  }]);
};
