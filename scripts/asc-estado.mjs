// ¿Ya está en TestFlight? Estado de una compilación en App Store Connect,
// SIEMPRE filtrado por la app:
//
//   node scripts/asc-estado.mjs apps/mobile 33     → Portal Farmalasa, build 33
//   node scripts/asc-estado.mjs apps/clientes 41   → Puntos Salud, build 41
//   node scripts/asc-estado.mjs apps/mobile        → las últimas 5 de esa app
//   … --esperar   repite cada 45 s hasta VALID / INVALID / FAILED
//
// Por qué existe: las dos apps numeran sus compilaciones por separado y los
// números se cruzan. El 2026-10-09 una espera que preguntó sólo por «la 32»
// encontró la 32 de Puntos Salud y se dio por subida una build del portal cuya
// subida había fallado por red. La app sale del bundleId de su app.json.
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [carpeta, numero] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const esperar = process.argv.includes('--esperar');
if (!carpeta) { console.error('uso: node scripts/asc-estado.mjs <apps/mobile|apps/clientes> [número] [--esperar]'); process.exit(2); }

const CLAVES = join(homedir(), '.claves-farmalasa');
const asc = Object.fromEntries(readFileSync(join(CLAVES, 'asc.env'), 'utf8').split('\n')
  .map((l) => l.trim().replace(/^export /, '')).filter((l) => l && !l.startsWith('#')).map((l) => l.split('=').map((x) => x.trim().replace(/^["']|["']$/g, ''))));
const LLAVE = join(CLAVES, `AuthKey_${asc.ASC_KEY_ID}.p8`);

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'ES256', kid: asc.ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: asc.ASC_ISSUER_ID, iat: ahora, exp: ahora + 900, aud: 'appstoreconnect-v1' })}`;
  const firma = sign('sha256', Buffer.from(cuerpo), { key: createPrivateKey(readFileSync(LLAVE)), dsaEncoding: 'ieee-p1363' });
  return `${cuerpo}.${firma.toString('base64url')}`;
}
async function api(ruta) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${ruta}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok) throw new Error(`App Store Connect ${r.status}: ${await r.text()}`);
  return r.json();
}

const bundleId = JSON.parse(readFileSync(join(carpeta, 'app.json'), 'utf8')).expo.ios.bundleIdentifier;
const app = (await api(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name`)).data[0];
if (!app) { console.error(`No hay app con bundleId ${bundleId}`); process.exit(1); }

const filtro = `filter[app]=${app.id}${numero ? `&filter[version]=${numero}` : ''}`;
const FINAL = ['VALID', 'INVALID', 'FAILED'];
for (;;) {
  const { data } = await api(`/v1/builds?${filtro}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate,expired`);
  if (!numero || !esperar) {
    if (!data.length) console.log(`${app.attributes.name}: sin compilación ${numero ?? ''}`.trim());
    for (const b of data) console.log(`${app.attributes.name} · build ${b.attributes.version} · ${b.attributes.processingState} · ${b.attributes.uploadedDate}${b.attributes.expired ? ' · vencida' : ''}`);
    break;
  }
  const estado = data[0]?.attributes.processingState;
  if (FINAL.includes(estado)) { console.log(`${app.attributes.name} · build ${numero} · ${estado}`); process.exit(estado === 'VALID' ? 0 : 1); }
  await new Promise((r) => setTimeout(r, 45_000));
}
