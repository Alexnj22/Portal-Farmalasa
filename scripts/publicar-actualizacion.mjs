#!/usr/bin/env node
// Publica una actualización POR AIRE de la app de clientes (2026-10-29): el
// JavaScript y las imágenes de la app, sin pasar por la tienda. La app lo baja
// al abrir y lo usa la próxima vez que se abre.
//
//   npm run app:actualizar -- "Qué cambia"                 → iPhone y Android
//   npm run app:actualizar -- "Qué cambia" --plataforma=ios
//   npm run app:actualizar -- --ver                         → qué saldría, sin publicar
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

const PROYECTO = 'sacecdkdmsdvgqnrsett';
const URL_BASE = `https://${PROYECTO}.supabase.co`;
const BUCKET = 'app-actualizaciones';
const CARPETA = resolve('apps/clientes');
const PERFIL = 'clientes';

const args = process.argv.slice(2);
const ver = args.includes('--ver');
const forzar = args.includes('--forzar');
const plataformaArg = args.find((a) => a.startsWith('--plataforma='))?.split('=')[1];
const mensaje = args.find((a) => !a.startsWith('--'))?.trim();
const plataformas = plataformaArg ? [plataformaArg] : ['ios', 'android'];
if (plataformas.some((p) => !['ios', 'android'].includes(p))) { console.error('--plataforma=ios|android'); process.exit(1); }
if (!ver && !mensaje) { console.error('Uso: npm run app:actualizar -- "Qué cambia" [--plataforma=ios|android] [--ver]'); process.exit(1); }
if (!existsSync(join(CARPETA, 'app.json'))) { console.error('Correr desde la raíz del repo.'); process.exit(1); }

// ── Código commiteado ───────────────────────────────────────────────────────
const sucio = execSync('git status --porcelain -- apps/clientes', { encoding: 'utf8' }).trim();
if (sucio && !forzar && !ver) {
  console.error(`apps/clientes tiene cambios sin commitear:\n${sucio}\nCommitealos primero (o --forzar).`);
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
    const k = llaves.find((x) => x.type === 'secret') ?? llaves.find((x) => x.name === 'service_role');
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
const cab = (extra = {}) => ({ Authorization: `Bearer ${llave}`, apikey: llave, ...extra });

async function ultimaHuella(plataforma) {
  const r = await fetch(`${URL_BASE}/rest/v1/app_actualizaciones?select=runtime_version,created_at&app=eq.clientes&plataforma=eq.${plataforma}&order=created_at.desc&limit=1`, { headers: cab() });
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
  execFileSync('npx', ['expo', 'export', ...plataformas.flatMap((p) => ['--platform', p]), '--output-dir', salida],
    { cwd: CARPETA, env: conEnv, stdio: 'inherit' });
  const meta = JSON.parse(readFileSync(join(salida, 'metadata.json'), 'utf8'));

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
      const path = `clientes/${key}`;
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
      body: JSON.stringify({ app: 'clientes', plataforma: p, runtime_version: huellas[p], manifiesto: { launchAsset, assets }, mensaje, commit_git: commit }),
    });
    if (!r.ok) throw new Error(`registrar ${p}: ${r.status} ${await r.text()}`);
    const [fila] = await r.json();
    console.log(`✓ ${p}: actualización ${fila.id} publicada (${assets.length} archivos además del paquete). Llega al abrir la app; se usa la vez siguiente.`);
  }
} finally {
  rmSync(salida, { recursive: true, force: true });
}
