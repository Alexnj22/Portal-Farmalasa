#!/usr/bin/env node
// Compila una app de Expo para ANDROID en esta Mac (Android Studio, sin EAS) y
// la sube a la pista «internal» de Google Play. Gemelo de `subir-ios.mjs`:
//
//   node scripts/subir-android.mjs apps/clientes clientes   → Puntos Salud
//   node scripts/subir-android.mjs apps/mobile interna      → la app del personal
//
//   --sin-subir   compila y firma el .aab y se detiene (no habla con Google Play)
//   --apk         además arma un .apk firmado, para instalar con `adb install`
//   --version-code=N   usa N si es mayor que lo que se sabe (sin la cuenta de
//                 servicio de Play no se le puede preguntar el último: la app
//                 del personal ya tenía una subida de EAS el 2026-09-30)
//
// El segundo argumento es el perfil de `eas.json` del que se toman las
// variables EXPO_PUBLIC_* (las de PRODUCCIÓN para subir). EAS no se usa.
//
// ── Lo que vive en ~/.claves-farmalasa (nunca en el repositorio) ────────────
//   android-upload.jks + android-upload.env   la llave de SUBIDA de Puntos
//       Salud (creada el 2026-10-08; Google la acepta en el paquete viejo tras
//       el reseteo de llave pedido ese día). Google Play firma la app con su
//       propia llave (Play App Signing); ésta sólo prueba que la subida es
//       nuestra. Si se pierde, se pide un reseteo en Play Console — no se
//       pierde la app, pero tarda días.
//   android-upload-portal.jks + .env   la de la app del PERSONAL: la creó Expo
//       el 2026-09-29 y Play ya la conoce (prueba interna del 30-sep). Ver
//       LLAVE_POR_PAQUETE.
//   play-publicar.json   la cuenta de servicio con acceso a Play Console (la
//       API de publicación). Sin ella el script deja el .aab listo y explica.
//   google-services.json   Firebase (avisos); lo conecta app.config.js de cada app.
//
// ── El número de versión (versionCode) sale de Google Play ──────────────────
// Play rechaza un número ya usado. Se le pregunta el mayor de todas las pistas
// y se usa el siguiente; además se recuerda el último subido desde este equipo
// (compilaciones-subidas.json, la misma libreta que usa iOS, con clave
// «android:<paquete>»). Se escribe en el build.gradle GENERADO: el script no
// deja cambios en el repositorio.
//
// ── La primera vez ──────────────────────────────────────────────────────────
// Google Play NO deja subir por API el primer .aab de una app nueva: la app
// tiene que existir en Play Console y su primera versión se sube a mano. Si la
// API contesta que la app no existe, el script lo dice y deja el .aab.
import { execSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const banderas = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const codigoPedido = Number(args.find((a) => a.startsWith('--version-code='))?.split('=')[1]) || 0;
const [carpeta, perfil] = args.filter((a) => !a.startsWith('--'));
if (!carpeta || !perfil) {
  console.error('Uso: node scripts/subir-android.mjs <carpeta-de-la-app> <perfil-de-eas.json> [--sin-subir] [--apk]');
  process.exit(1);
}
const SIN_SUBIR = banderas.has('--sin-subir');
const app = resolve(carpeta);
const CLAVES = join(homedir(), '.claves-farmalasa');
const REGISTRO = join(CLAVES, 'compilaciones-subidas.json');
const CUENTA_PLAY = join(CLAVES, 'play-publicar.json');

// ── Herramientas: el JDK y el SDK de Android Studio ────────────────────────
const JAVA_HOME = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const ANDROID_HOME = process.env.ANDROID_HOME || join(homedir(), 'Library', 'Android', 'sdk');
for (const [nombre, ruta] of [['JDK de Android Studio', join(JAVA_HOME, 'bin', 'java')], ['SDK de Android', join(ANDROID_HOME, 'platforms')]]) {
  if (!existsSync(ruta)) { console.error(`Falta el ${nombre}: ${ruta}. Instala Android Studio (y su SDK) o define JAVA_HOME/ANDROID_HOME.`); process.exit(1); }
}

// ── La llave de subida ─────────────────────────────────────────────────────
// Una por app cuando Play ya conoce otra: la llave de subida la fija la
// PRIMERA versión que se sube, y una distinta se rechaza.
const LLAVE_POR_PAQUETE = { 'lat.farmasalud.portal': 'android-upload-portal.env' };
const leerEnv = (archivo) => Object.fromEntries(readFileSync(archivo, 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

// ── La app y sus variables ──────────────────────────────────────────────────
const appJson = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo;
const paquete = appJson.android?.package;
if (!paquete) { console.error('app.json no tiene android.package'); process.exit(1); }
const ENV_LLAVE = join(CLAVES, LLAVE_POR_PAQUETE[paquete] ?? 'android-upload.env');
if (!existsSync(ENV_LLAVE)) {
  console.error(`Falta la llave de subida: ${ENV_LLAVE} (y su .jks).
Se crea UNA vez con keytool (ver el encabezado de este script) y se respalda.`);
  process.exit(1);
}
const llave = leerEnv(ENV_LLAVE);
if (!llave.ANDROID_KEYSTORE || !existsSync(llave.ANDROID_KEYSTORE) || !llave.ANDROID_STORE_PASSWORD || !llave.ANDROID_KEY_ALIAS) {
  console.error(`${ENV_LLAVE} incompleto: ANDROID_KEYSTORE, ANDROID_KEY_ALIAS, ANDROID_STORE_PASSWORD, ANDROID_KEY_PASSWORD.`);
  process.exit(1);
}
const eas = JSON.parse(readFileSync(join(app, 'eas.json'), 'utf8'));
const env = { ...(eas.build?.[perfil]?.env ?? {}) };
if (!env.EXPO_PUBLIC_SUPABASE_URL) { console.error(`El perfil «${perfil}» no trae EXPO_PUBLIC_SUPABASE_URL`); process.exit(1); }
const esProduccion = env.EXPO_PUBLIC_SUPABASE_URL.includes('sacecdkdmsdvgqnrsett');
if (!esProduccion && !SIN_SUBIR) {
  console.error(`El perfil «${perfil}» no apunta a producción: no se sube a la tienda (usa --sin-subir para probarlo).`);
  process.exit(1);
}

// ── Google Play ─────────────────────────────────────────────────────────────
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
let tokenPlay = null;
async function token() {
  if (tokenPlay) return tokenPlay;
  const sa = JSON.parse(readFileSync(CUENTA_PLAY, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600,
  })}`;
  const firma = createSign('RSA-SHA256').update(cuerpo).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cuerpo}.${firma}` }),
  });
  if (!r.ok) throw new Error(`Google OAuth ${r.status}: ${await r.text()}`);
  tokenPlay = (await r.json()).access_token;
  return tokenPlay;
}
async function play(metodo, ruta, { cuerpo, binario } = {}) {
  const base = binario ? API.replace('/androidpublisher/v3', '/upload/androidpublisher/v3') : API;
  const r = await fetch(`${base}/${paquete}${ruta}${binario ? '?uploadType=media' : ''}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': binario ? 'application/octet-stream' : 'application/json' },
    body: binario ?? (cuerpo ? JSON.stringify(cuerpo) : undefined),
  });
  const texto = await r.text();
  if (!r.ok) { const e = new Error(`Google Play ${r.status}: ${texto}`); e.status = r.status; e.texto = texto; throw e; }
  return texto ? JSON.parse(texto) : {};
}

function comoCrearLaCuentaDePlay() {
  return `Para subir por API hace falta una cuenta de servicio con acceso a Play Console:
  1. console.cloud.google.com → proyecto «farmasaludapp» → APIs y servicios →
     habilitar «Google Play Android Developer API».
  2. IAM → Cuentas de servicio → Crear («play-publicar»), sin roles de Cloud.
     En la cuenta → Claves → Agregar clave → JSON. Guardar el archivo como
     ${CUENTA_PLAY}  (no en el repositorio).
  3. play.google.com/console → Usuarios y permisos → Invitar usuario → el correo
     de la cuenta de servicio (…@farmasaludapp.iam.gserviceaccount.com) →
     permisos de la app (o de todas): «Lanzar en pistas de prueba» y
     «Ver información de la app». Aceptar.
  4. Volver a correr este script.`;
}

const subidas = existsSync(REGISTRO) ? JSON.parse(readFileSync(REGISTRO, 'utf8')) : {};
const CLAVE_REGISTRO = `android:${paquete}`;
let ultimoEnPlay = 0;
let puedeSubir = !SIN_SUBIR;
let appExisteEnPlay = true;
if (puedeSubir && !existsSync(CUENTA_PLAY)) {
  console.warn(`⚠ No está ${CUENTA_PLAY}: se compila y se deja el .aab, sin subir.\n\n${comoCrearLaCuentaDePlay()}\n`);
  puedeSubir = false;
}
if (puedeSubir) {
  try {
    const edit = await play('POST', '/edits', { cuerpo: {} });
    const { tracks = [] } = await play('GET', `/edits/${edit.id}/tracks`);
    ultimoEnPlay = Math.max(0, ...tracks.flatMap((t) => (t.releases ?? []).flatMap((rel) => (rel.versionCodes ?? []).map(Number))));
    await play('DELETE', `/edits/${edit.id}`).catch(() => {});
  } catch (e) {
    if (e.status === 404 || /not found|No application/i.test(e.texto ?? '')) {
      appExisteEnPlay = false;
      puedeSubir = false;
      console.warn(`⚠ Google Play no tiene ${paquete}: la primera versión se sube A MANO (más abajo, qué subir).`);
    } else if (e.status === 401 || e.status === 403) {
      console.error(`La cuenta de servicio no tiene acceso a ${paquete} en Play Console (${e.status}).\n\n${comoCrearLaCuentaDePlay()}`);
      process.exit(1);
    } else throw e;
  }
}
const versionCode = Math.max(ultimoEnPlay + 1, (Number(subidas[CLAVE_REGISTRO]) || 0) + 1, (Number(appJson.android?.versionCode) || 0) + 1, codigoPedido);
console.log(`→ ${appJson.name} (${paquete}) · versión ${appJson.version} · versionCode ${versionCode}${esProduccion ? '' : ' · PRUEBAS'}`);

// ── Compilar ────────────────────────────────────────────────────────────────
const entorno = {
  ...process.env, ...env, JAVA_HOME, ANDROID_HOME, EXPO_PUBLIC_PRUEBA_CODIGO: '',
  PATH: `${join(JAVA_HOME, 'bin')}:${join(ANDROID_HOME, 'platform-tools')}:${process.env.PATH}`,
  ...(process.env.SENTRY_AUTH_TOKEN ? {} : { SENTRY_DISABLE_AUTO_UPLOAD: 'true' }),
  // La firma viaja por el entorno, nunca por la línea de comandos (se vería en `ps`).
  FL_KEYSTORE: llave.ANDROID_KEYSTORE, FL_KEY_ALIAS: llave.ANDROID_KEY_ALIAS,
  FL_STORE_PASSWORD: llave.ANDROID_STORE_PASSWORD, FL_KEY_PASSWORD: llave.ANDROID_KEY_PASSWORD || llave.ANDROID_STORE_PASSWORD,
};
const correr = (cmd, cwd = app) => execSync(cmd, { cwd, stdio: 'inherit', env: entorno });
correr('npx expo prebuild -p android --clean');

// La firma de subida y el número, en el build.gradle GENERADO.
const gradle = join(app, 'android', 'app', 'build.gradle');
let g = readFileSync(gradle, 'utf8');
const antes = g;
g = g.replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/signingConfigs \{\n/, `signingConfigs {
        subida {
            storeFile file(System.getenv('FL_KEYSTORE'))
            storePassword System.getenv('FL_STORE_PASSWORD')
            keyAlias System.getenv('FL_KEY_ALIAS')
            keyPassword System.getenv('FL_KEY_PASSWORD')
        }
`)
  .replace(/(release \{[\s\S]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.subida');
if (g === antes || !g.includes('signingConfigs.subida') || !g.includes(`versionCode ${versionCode}`)) {
  console.error('No se pudo poner la firma o el número en android/app/build.gradle: la plantilla de Expo cambió. Revisar el reemplazo.');
  process.exit(1);
}
writeFileSync(gradle, g);

const android = join(app, 'android');
correr(`./gradlew bundleRelease${banderas.has('--apk') ? ' assembleRelease' : ''} --console=plain`, android);

// El .aab, con nombre propio, a una carpeta que no borra el próximo prebuild.
const salida = join(CLAVES, 'compilaciones-android');
mkdirSync(salida, { recursive: true });
const nombre = `${paquete}-${appJson.version}-${versionCode}${esProduccion ? '' : '-pruebas'}`;
const aab = join(salida, `${nombre}.aab`);
copyFileSync(join(android, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'), aab);
console.log(`✓ ${aab}`);
if (banderas.has('--apk')) {
  const apk = join(salida, `${nombre}.apk`);
  copyFileSync(join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), apk);
  console.log(`✓ ${apk}`);
}

// ── Subir ───────────────────────────────────────────────────────────────────
if (!puedeSubir) {
  if (!appExisteEnPlay) {
    console.log(`
La primera versión de ${appJson.name} se sube a mano:
  1. play.google.com/console → Crear app → nombre «${appJson.name}», idioma español,
     App, Gratis. (El paquete ${paquete} lo toma del .aab.)
  2. Prueba → Pruebas internas → Crear versión → aceptar Play App Signing
     (Google guarda la llave de la app; la nuestra queda como llave de SUBIDA).
  3. Subir ${aab}
  4. Agregar testers (lista de correos) y guardar/lanzar.
Desde la segunda versión, este script sube solo.`);
  }
  process.exit(0);
}
const edit = await play('POST', '/edits', { cuerpo: {} });
const subido = await play('POST', `/edits/${edit.id}/bundles`, { binario: readFileSync(aab) });
const lanzar = async (status) => play('PUT', `/edits/${edit.id}/tracks/internal`, {
  cuerpo: { track: 'internal', releases: [{ name: `${appJson.version} (${versionCode})`, versionCodes: [String(subido.versionCode)], status }] },
});
try {
  await lanzar('completed');
} catch (e) {
  // Una app que todavía no se publicó en ninguna pista sólo acepta borradores.
  if (/draft/i.test(e.texto ?? '')) await lanzar('draft'); else throw e;
}
await play('POST', `/edits/${edit.id}:commit`);
writeFileSync(REGISTRO, JSON.stringify({ ...subidas, [CLAVE_REGISTRO]: versionCode }, null, 2) + '\n');
console.log(`✓ ${appJson.name} ${appJson.version} (${versionCode}) subida a la pista «internal» de Google Play.`);
