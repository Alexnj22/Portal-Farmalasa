#!/usr/bin/env node
// Publica una actualización POR AIRE de una app (clientes por omisión; la del
// personal con --app=personal): el
// JavaScript y las imágenes de la app, sin pasar por la tienda. La app lo baja
// al abrir y lo usa la próxima vez que se abre.
//
//   npm run app:actualizar -- "Qué cambia"                 → iPhone y Android
//   npm run app:actualizar -- "Qué cambia" --plataforma=ios
//   npm run app:actualizar -- --ver                         → qué saldría, sin publicar
//   npm run app:actualizar -- "Qué cambia" --app=personal   → la app del personal
//
// ── Qué NO puede ir por aire ────────────────────────────────────────────────
// Lo nativo: un módulo nuevo, un permiso, el widget, un cambio en app.json que
// toque el binario. No hace falta acordarse: la «versión de runtime» es la
// huella del código nativo (política `fingerprint`), y un paquete sólo llega a
// los teléfonos con la MISMA huella. Si lo nativo cambió, el paquete sale con
// otra huella y no llega a nadie hasta que haya un binario nuevo
// (subir-ios / subir-android). El script lo avisa comparando con la huella de
// la última publicación.
//
// ── Cómo ────────────────────────────────────────────────────────────────────
// `expo export` con las variables EXPO_PUBLIC_* de producción (del perfil de
// eas.json, igual que subir-ios), cada archivo al bucket privado
// `app-actualizaciones` por su md5 (lo repetido no se vuelve a subir), y una
// fila en `app_actualizaciones` que sirve la función `app-actualizaciones`.
// Se publica desde código COMMITEADO: la fila guarda el commit, para saber qué
// tiene cada teléfono.
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exigirHuellaEstable } from './lib/huella-estable.mjs';

const PROYECTO = 'sacecdkdmsdvgqnrsett';
const URL_BASE = `https://${PROYECTO}.supabase.co`;
const BUCKET = 'app-actualizaciones';
const args = process.argv.slice(2);
const APPS = { clientes: { carpeta: 'apps/clientes', perfil: 'clientes' }, personal: { carpeta: 'apps/mobile', perfil: 'interna' } };
const APP = args.find((a) => a.startsWith('--app='))?.split('=')[1] ?? 'clientes';
if (!APPS[APP]) { console.error('--app=clientes|personal'); process.exit(1); }
const CARPETA = resolve(APPS[APP].carpeta);
const PERFIL = APPS[APP].perfil;

const ver = args.includes('--ver');
const forzar = args.includes('--forzar');
const plataformaArg = args.find((a) => a.startsWith('--plataforma='))?.split('=')[1];
const mensaje = args.find((a) => !a.startsWith('--'))?.trim();
const plataformas = plataformaArg ? [plataformaArg] : ['ios', 'android'];
if (plataformas.some((p) => !['ios', 'android'].includes(p))) { console.error('--plataforma=ios|android'); process.exit(1); }
if (!ver && !mensaje) { console.error('Uso: npm run app:actualizar -- "Qué cambia" [--plataforma=ios|android] [--ver]'); process.exit(1); }
if (!existsSync(join(CARPETA, 'app.json'))) { console.error('Correr desde la raíz del repo.'); process.exit(1); }
exigirHuellaEstable(CARPETA);

// ── Código commiteado ───────────────────────────────────────────────────────
const sucio = execSync(`git status --porcelain -- ${APPS[APP].carpeta}`, { encoding: 'utf8' }).trim();
if (sucio && !forzar && !ver) {
  console.error(`${APPS[APP].carpeta} tiene cambios sin commitear:\n${sucio}\nCommitealos primero (o --forzar).`);
  process.exit(1);
}
const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();

// ── Variables de producción ─────────────────────────────────────────────────
const eas = JSON.parse(readFileSync(join(CARPETA, 'eas.json'), 'utf8'));
const env = { ...(eas.build?.[PERFIL]?.env ?? {}) };
if (!env.EXPO_PUBLIC_SUPABASE_URL?.includes(PROYECTO)) { console.error(`El perfil «${PERFIL}» no apunta a producción.`); process.exit(1); }
const conEnv = { ...process.env, ...env, NODE_ENV: 'production', EXPO_PUBLIC_PRUEBA_CODIGO: '' };

// ── La llave del servidor (sólo en memoria) ─────────────────────────────────
// El CLI se traga el .env del repo: se corre desde una carpeta temporal.
function llaveDelServidor() {
  const fuera = mkdtempSync(join(tmpdir(), 'llave-'));
  try {
    const out = execFileSync('supabase', ['projects', 'api-keys', '--project-ref', PROYECTO, '-o', 'json'],
      { cwd: fuera, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const llaves = JSON.parse(out.slice(out.indexOf('[')));
    // La CLI enmascara la llave `sb_secret_…` (sale con puntos); la
    // `service_role` sale entera.
    const k = llaves.find((x) => x.name === 'service_role');
    if (!k?.api_key) throw new Error('sin llave secreta');
    return k.api_key;
  } finally { rmSync(fuera, { recursive: true, force: true }); }
}

const huella = (p) => {
  const out = execFileSync('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', p],
    { cwd: CARPETA, encoding: 'utf8', env: conEnv, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  const linea = out.split('\n').find((l) => l.startsWith('{'));
  const rv = linea && JSON.parse(linea).runtimeVersion;
  if (!rv) throw new Error(`no se pudo calcular la versión de runtime de ${p}`);
  return rv;
};

const TIPOS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', json: 'application/json', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', lottie: 'application/json' };

const llave = ver ? null : llaveDelServidor();
// Una llave `sb_secret_…` no es un JWT: viaja sólo en `apikey` (con
// `Authorization: Bearer` la API la rechaza con «Invalid API key»).
const cab = (extra = {}) => ({ apikey: llave, ...(String(llave).startsWith('sb_') ? {} : { Authorization: `Bearer ${llave}` }), ...extra });

async function ultimaHuella(plataforma) {
  const r = await fetch(`${URL_BASE}/rest/v1/app_actualizaciones?select=runtime_version,created_at&app=eq.${APP}&plataforma=eq.${plataforma}&order=created_at.desc&limit=1`, { headers: cab() });
  if (!r.ok) throw new Error(`leer la última publicación: ${r.status} ${await r.text()}`);
  return (await r.json())[0] ?? null;
}

async function subir(path, buf) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', body: buf, headers: cab({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
  });
  if (!r.ok) throw new Error(`subir ${path}: ${r.status} ${await r.text()}`);
}

const salida = mkdtempSync(join(tmpdir(), 'ota-'));
try {
  const huellas = Object.fromEntries(plataformas.map((p) => [p, huella(p)]));
  for (const p of plataformas) console.log(`→ ${p}: versión de runtime ${huellas[p].slice(0, 12)}…`);
  if (ver) { rmSync(salida, { recursive: true, force: true }); process.exit(0); }

  console.log('→ Exportando el JavaScript de la app…');
  // `--clear` SIEMPRE (2026-11-10). Las dos apps se exportan en esta Mac y
  // Metro guarda lo ya traducido en una memoria común: un archivo idéntico en
  // las dos se tomó traducido por el plugin de worklets de la OTRA app (0.10.1
  // en clientes, 0.13.0 en la del personal). El paquete de la app del personal
  // salió con worklets en el formato viejo y se cerraba al abrir, en todos los
  // iPhone que lo bajaron (TestFlight, compilación 72).
  execFileSync('npx', ['expo', 'export', '--clear', ...plataformas.flatMap((p) => ['--platform', p]), '--output-dir', salida],
    { cwd: CARPETA, env: conEnv, stdio: 'inherit' });
  const meta = JSON.parse(readFileSync(join(salida, 'metadata.json'), 'utf8'));
  // Y se comprueba, por si la memoria vuelve a colarse por otro lado: cada
  // worklet del paquete tiene que estar escrito como lo escribe el plugin de
  // ESTA app (el 0.13 desarma el cierre con `[...]`, el 0.10 con `{...}`).
  {
    const plugin = readFileSync(join(CARPETA, 'node_modules', 'react-native-worklets', 'plugin', 'index.js'), 'utf8');
    const esperado = plugin.includes('arrayPattern') ? '[' : '{';
    const ajeno = esperado === '[' ? '{' : '[';
    for (const p of plataformas) {
      const archivo = meta.fileMetadata?.[p]?.bundle;
      if (!archivo) continue;
      const texto = readFileSync(join(salida, archivo)).toString('latin1');
      const malos = (texto.match(new RegExp(`const\\${ajeno}[^=]{1,200}\\${ajeno === '[' ? ']' : '}'}=this\\.__closure`, 'g')) || []).length;
      if (malos) {
        console.error(`✗ ${p}: ${malos} worklet(s) traducidos con el plugin de OTRA versión de worklets. No se publica.`);
        process.exit(1);
      }
    }
  }
  // La configuración pública de la app viaja en el manifiesto como
  // `extra.expoClient` (2026-11-05): sin ella `Constants.expoConfig` queda
  // vacío en el paquete bajado, el arranque falla y expo-updates vuelve solo al
  // de la compilación. Era por qué ninguna actualización por aire se veía.
  const expoClient = JSON.parse(execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'],
    { cwd: CARPETA, env: conEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }));
  if (!expoClient?.slug) throw new Error('no se pudo leer la configuración de la app (expo config)');

  for (const p of plataformas) {
    const previa = await ultimaHuella(p);
    if (previa && previa.runtime_version !== huellas[p]) {
      console.warn(`⚠ ${p}: lo nativo cambió desde la última publicación (${previa.runtime_version.slice(0, 12)}… → ${huellas[p].slice(0, 12)}…).`
        + ' Este paquete sólo llegará a binarios compilados desde ahora (subir-ios / subir-android).');
    }
    const fm = meta.fileMetadata?.[p];
    if (!fm?.bundle) throw new Error(`el export no trajo el paquete de ${p}`);
    const archivo = async (rel, contentType, fileExtension) => {
      const buf = readFileSync(join(salida, rel));
      const key = createHash('md5').update(buf).digest('hex');
      const hash = createHash('sha256').update(buf).digest('base64url');
      const path = `${APP}/${key}`;
      await subir(path, buf);
      return { path, hash, key, contentType, fileExtension };
    };
    const launchAsset = await archivo(fm.bundle, 'application/javascript', '.bundle');
    const assets = [];
    for (const a of fm.assets ?? []) {
      const ext = String(a.ext ?? '').toLowerCase();
      assets.push(await archivo(a.path, TIPOS[ext] ?? 'application/octet-stream', ext ? `.${ext}` : ''));
    }
    const r = await fetch(`${URL_BASE}/rest/v1/app_actualizaciones`, {
      method: 'POST',
      headers: cab({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ app: APP, plataforma: p, runtime_version: huellas[p], manifiesto: { launchAsset, assets, expoClient }, mensaje, commit_git: commit }),
    });
    if (!r.ok) throw new Error(`registrar ${p}: ${r.status} ${await r.text()}`);
    const [fila] = await r.json();
    console.log(`✓ ${p}: actualización ${fila.id} publicada (${assets.length} archivos además del paquete). Llega al abrir la app; se usa la vez siguiente.`);
  }
} finally {
  rmSync(salida, { recursive: true, force: true });
}
