#!/usr/bin/env node
// Publica el portal: adelanta la rama `produccion` a `origin/main`, y Vercel
// despliega portal.farmasalud.lat (ver scripts/vercel-ignorar.sh).
//
//   npm run publicar            → publica si hay cambios de la web desde la última vez
//   npm run publicar -- --ver   → sólo dice qué se publicaría
//
// No hace commits ni toca el árbol de trabajo: mueve una rama del remoto. Lo
// que no está pusheado a `main` no se publica.
import { execSync } from 'node:child_process';

const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const soloVer = process.argv.includes('--ver');
const FUERA = ['apps', 'supabase', 'scripts', 'docs', 'auditoria', '*.md', 'src/version.js']
  .map((x) => `':(exclude)${x}'`).join(' ');

sh('git fetch -q origin main produccion');
const main = sh('git rev-parse origin/main');
const prod = sh('git rev-parse origin/produccion');
if (main === prod) { console.log('Producción ya está al día.'); process.exit(0); }
if (sh(`git merge-base --is-ancestor ${prod} ${main} && echo si || echo no`) !== 'si') {
  console.error('produccion no es un ancestro de main: alguien la movió a mano. Revisar antes de publicar.');
  process.exit(1);
}
const web = sh(`git diff --name-only ${prod} ${main} -- . ${FUERA}`).split('\n').filter(Boolean);
const commits = sh(`git log --oneline ${prod}..${main}`).split('\n').filter(Boolean);
console.log(`${commits.length} commits desde la última publicación; ${web.length} archivos de la web:`);
for (const f of web.slice(0, 30)) console.log('  ' + f);
if (web.length > 30) console.log(`  … y ${web.length - 30} más`);
if (!web.length) {
  // Sin cambios de la web: se adelanta igual la rama (para que la próxima
  // comparación parta de acá) pero Vercel no tiene nada nuevo que mostrar.
  console.log('Nada de la web cambió: no hace falta desplegar.');
  process.exit(0);
}
if (soloVer) process.exit(0);
sh(`git push -q origin ${main}:refs/heads/produccion`);
console.log(`✓ Publicando ${main.slice(0, 9)} en portal.farmasalud.lat (Vercel tarda ~2 min).`);
