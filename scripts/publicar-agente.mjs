// Deja el agente de la caja publicado con el portal.
//
// ── Por qué es un script y no un archivo copiado a mano ──────────────────────
// El agente vive en UN solo lugar (`scripts/agente-impresion/agente.py`) y se
// publica desde ahí en cada build. Tener una segunda copia versionada en
// `public/` significa que algún día una va a estar más nueva que la otra, y el
// síntoma sería que las cajas se actualizan a código viejo — que es peor que no
// actualizarse.
//
// ── Y por qué se publica el HASH, no un número de versión ────────────────────
// Un número hay que acordarse de subirlo. El día que alguien no lo sube, las
// cajas creen estar al día corriendo otra cosa, y nada lo delata. El hash sale
// del archivo, así que no se puede olvidar ni mentir.
//
// Corre solo antes de `npm run build` (ver `prebuild` en package.json).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGEN = join(RAIZ, 'scripts', 'agente-impresion');
const DESTINO = join(RAIZ, 'public', 'agente-impresion');

// `instalar.sh` NO se publica: lleva el canje del código de vinculación y se
// entrega junto con la carpeta. Lo que se publica es lo que una caja ya
// instalada necesita para ponerse al día sola.
const ARCHIVOS = ['agente.py', 'actualizar.sh'];

const agente = await readFile(join(ORIGEN, 'agente.py'));
const firma = createHash('sha256').update(agente).digest('hex');

await mkdir(DESTINO, { recursive: true });
for (const nombre of ARCHIVOS) {
    await writeFile(join(DESTINO, nombre), await readFile(join(ORIGEN, nombre)));
}
// Sin salto de línea al final: el agente compara contra esto tras un `.strip()`,
// pero `actualizar.sh` lo lee con `head -c 64` y un byte de más lo rompería.
await writeFile(join(DESTINO, 'agente.sha256'), firma);

console.log(`agente publicado — ${firma.slice(0, 12)} (${agente.length} bytes)`);
