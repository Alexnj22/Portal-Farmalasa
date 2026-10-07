#!/usr/bin/env node
// Compila una app de Expo en ESTA Mac con Xcode y la sube a TestFlight, sin los
// servidores de Expo (EAS): no cuesta nada por versión. Sirve para las dos apps:
//
//   node scripts/subir-ios.mjs apps/clientes clientes   → Puntos Salud
//   node scripts/subir-ios.mjs apps/mobile interna      → la app del personal
//
// El segundo argumento es el perfil de `eas.json` del que se toman las
// variables EXPO_PUBLIC_* (las de PRODUCCIÓN). EAS no se usa: sólo se lee ese
// archivo para no repetir las variables en dos lugares.
//
// ── El número de compilación sale de App Store Connect ─────────────────────
// Apple rechaza una subida con un número ya usado, y la app del personal ya
// subió hasta el 22 por EAS. Así que se le pregunta a App Store Connect cuál es
// el último y se usa el siguiente, y se escribe en el Info.plist GENERADO (no
// en app.json): el script no deja cambios en el repositorio.
//
// ── La firma ────────────────────────────────────────────────────────────────
// Con la llave de API de App Store Connect (~/.claves-farmalasa/AuthKey_*.p8 +
// asc.env), Xcode firma en la nube: crea solo el certificado y los perfiles de
// la app y de sus extensiones (los widgets de la app del personal), sin pedir
// contraseña ni código.
import { execSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [carpeta, perfil] = process.argv.slice(2);
if (!carpeta || !perfil) {
  console.error('Uso: node scripts/subir-ios.mjs <carpeta-de-la-app> <perfil-de-eas.json>');
  process.exit(1);
}
const app = resolve(carpeta);
const EQUIPO = 'ZZWA3Q7Q35';
const CLAVES = join(homedir(), '.claves-farmalasa');

// ── La llave ────────────────────────────────────────────────────────────────
const asc = Object.fromEntries(readFileSync(join(CLAVES, 'asc.env'), 'utf8').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split('=').map((x) => x.trim())));
const LLAVE = join(CLAVES, `AuthKey_${asc.ASC_KEY_ID}.p8`);
if (!asc.ASC_KEY_ID || !asc.ASC_ISSUER_ID || !existsSync(LLAVE)) {
  console.error(`Falta la llave: ${CLAVES}/asc.env (ASC_KEY_ID, ASC_ISSUER_ID) y AuthKey_<ID>.p8`);
  process.exit(1);
}

function tokenAsc() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'ES256', kid: asc.ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: asc.ASC_ISSUER_ID, iat: ahora, exp: ahora + 900, aud: 'appstoreconnect-v1' })}`;
  const firma = sign('sha256', Buffer.from(cuerpo), { key: createPrivateKey(readFileSync(LLAVE)), dsaEncoding: 'ieee-p1363' });
  return `${cuerpo}.${firma.toString('base64url')}`;
}
async function apiAsc(ruta) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${ruta}`, { headers: { Authorization: `Bearer ${tokenAsc()}` } });
  if (!r.ok) throw new Error(`App Store Connect ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── La app y sus variables ──────────────────────────────────────────────────
const appJson = JSON.parse(readFileSync(join(app, 'app.json'), 'utf8')).expo;
const bundle = appJson.ios.bundleIdentifier;
const eas = JSON.parse(readFileSync(join(app, 'eas.json'), 'utf8'));
const env = { ...(eas.build?.[perfil]?.env ?? {}) };
if (!env.EXPO_PUBLIC_SUPABASE_URL) { console.error(`El perfil «${perfil}» no trae EXPO_PUBLIC_SUPABASE_URL`); process.exit(1); }
if (!env.EXPO_PUBLIC_SUPABASE_URL.includes('sacecdkdmsdvgqnrsett')) {
  console.error(`El perfil «${perfil}» no apunta a producción: no se sube a la tienda.`);
  process.exit(1);
}

const { data: apps } = await apiAsc(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}`);
if (!apps.length) { console.error(`App Store Connect no tiene una app con ${bundle}. Créala primero.`); process.exit(1); }
const { data: builds } = await apiAsc(`/v1/builds?filter[app]=${apps[0].id}&limit=200&fields[builds]=version`);
// App Store Connect NO lista una compilación mientras Apple la procesa (10–30
// min): dos subidas seguidas sacaban el mismo número y la segunda quedaba
// repetida (pasó con la 16 de Puntos Salud, 2026-10-07). Por eso también se
// recuerda, en este equipo, el último número que se subió de cada app.
const REGISTRO = join(CLAVES, 'compilaciones-subidas.json');
const subidas = existsSync(REGISTRO) ? JSON.parse(readFileSync(REGISTRO, 'utf8')) : {};
const ultimo = Math.max(0, ...builds.map((b) => Number(b.attributes.version) || 0), Number(appJson.ios.buildNumber) || 0,
  Number(subidas[bundle]) || 0);
const numero = String(ultimo + 1);
console.log(`→ ${appJson.name} (${bundle}) · versión ${appJson.version} · compilación ${numero}`);

// ── Compilar ────────────────────────────────────────────────────────────────
// SENTRY_DISABLE_AUTO_UPLOAD: el plugin de Sentry sube los símbolos al
// compilar y, sin `SENTRY_AUTH_TOKEN`, rompe el archivo. Se enciende cuando
// esté el token.
const correr = (cmd, cwd = app) => execSync(cmd, { cwd, stdio: 'inherit', env: {
  ...process.env, ...env, EXPO_PUBLIC_PRUEBA_CODIGO: '',
  ...(process.env.SENTRY_AUTH_TOKEN ? {} : { SENTRY_DISABLE_AUTO_UPLOAD: 'true' }),
} });
correr('npx expo prebuild -p ios --clean');

// El número en TODOS los Info.plist generados (app y extensiones: Apple exige
// que coincidan).
const ios = join(app, 'ios');
const plists = execSync(`find "${ios}" -name Info.plist -not -path "*/Pods/*" -not -path "*/build/*"`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
for (const p of plists) {
  try { execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${numero}" "${p}"`, { stdio: 'ignore' }); } catch { /* sin la clave */ }
}

const workspace = readdirSync(ios).find((f) => f.endsWith('.xcworkspace'));
const scheme = workspace.replace('.xcworkspace', '');
const salida = mkdtempSync(join(tmpdir(), 'subir-ios-'));
const auth = `-allowProvisioningUpdates -authenticationKeyPath "${LLAVE}" -authenticationKeyID ${asc.ASC_KEY_ID} -authenticationKeyIssuerID ${asc.ASC_ISSUER_ID}`;

correr(`xcodebuild -workspace "${workspace}" -scheme "${scheme}" -configuration Release -destination "generic/platform=iOS" `
  + `-archivePath "${salida}/app.xcarchive" DEVELOPMENT_TEAM=${EQUIPO} CURRENT_PROJECT_VERSION=${numero} `
  // Sin firmar: firmar el archivo exige un perfil de DESARROLLO, y Apple sólo
  // lo genera con un iPhone registrado en el equipo («Your team has no
  // devices»). La firma de DISTRIBUCIÓN la pone la exportación, en la nube.
  + `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" archive -quiet`, ios);

// El archivo sin firmar no lleva los permisos (entitlements): la exportación
// firma con lo que encuentra en el binario, y sin esto la app salía SIN
// `aps-environment` —o sea sin avisos— y sin los app groups de los widgets
// (medido el 2026-10-06 con `codesign -d --entitlements`). Se firma ad-hoc
// cada paquete con su archivo de permisos, de adentro hacia afuera
// (extensiones primero, después la app); la exportación cambia esa firma por
// la de distribución y conserva los permisos.
// Los de las extensiones de @bacons/apple-targets viven en `<app>/targets/<x>/`
// (carpeta en minúsculas, el paquete con el `name` de la config).
const entitlements = execSync(`find "${ios}" "${join(app, 'targets')}" -name "*.entitlements" -not -path "*/Pods/*" -not -path "*/build/*" 2>/dev/null || true`, { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const permisosDe = (paquete) => {
  const nombre = paquete.split('/').pop().replace(/\.(app|appex)$/, '').toLowerCase();
  const propio = entitlements.filter((e) => e.split('/').slice(-2, -1)[0].toLowerCase() === nombre);
  // Sin archivo = sin permisos (la extensión Avisos de la app del personal no
  // lleva ninguno). Dos o más = no se adivina cuál.
  if (propio.length > 1) throw new Error(`No sé qué permisos lleva ${nombre}: ${propio.length} archivos .entitlements en ios/${nombre}/`);
  return propio[0] ?? null;
};
const appArchivada = join(salida, 'app.xcarchive', 'Products', 'Applications', readdirSync(join(salida, 'app.xcarchive', 'Products', 'Applications'))[0]);
const extensiones = existsSync(join(appArchivada, 'PlugIns'))
  ? readdirSync(join(appArchivada, 'PlugIns')).filter((f) => f.endsWith('.appex')).map((f) => join(appArchivada, 'PlugIns', f)) : [];
for (const paquete of [...extensiones, appArchivada]) {
  const permisos = permisosDe(paquete);
  execSync(`codesign -f -s - ${permisos ? `--entitlements "${permisos}" ` : ''}"${paquete}"`, { stdio: 'inherit' });
}

writeFileSync(join(salida, 'ExportOptions.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${EQUIPO}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
`);
correr(`xcodebuild -exportArchive -archivePath "${salida}/app.xcarchive" -exportOptionsPlist "${salida}/ExportOptions.plist" -exportPath "${salida}/export" ${auth}`, ios);

writeFileSync(REGISTRO, JSON.stringify({ ...subidas, [bundle]: Number(numero) }, null, 2) + '\n');
console.log(`✓ ${appJson.name} ${appJson.version} (${numero}) subida. Aparece en TestFlight en 10–30 minutos.`);
