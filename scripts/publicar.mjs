#!/usr/bin/env node
// Publica el portal: adelanta la rama `produccion` a `origin/main`, y Vercel
// despliega portal.farmasalud.lat (ver scripts/vercel-ignorar.sh).
//
//   npm run publicar            → publica si hay cambios de la web desde la última vez
//   npm run publicar -- --ver   → sólo dice qué se publicaría
//   npm run publicar -- --no-esperar → publica aunque Vercel esté armando otro
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

// ── No amontonar despliegues (2026-11-05) ──────────────────────────────────
// Vercel arma uno a la vez. Ese día varias sesiones publicaron en minutos:
// ~20 despliegues en fila, el mismo commit armado hasta tres veces, y uno
// VIEJO (v2.1451.38) terminó después de los nuevos y quedó publicado — el
// portal retrocedió hasta que pasó el resto de la fila. Así que, si hay un
// despliegue de producción en curso, se espera a que termine: lo que se
// publica después es `origin/main` releído en ese momento, o sea que nada se
// pierde y la fila no crece. Sin la CLI de Vercel (o sin sesión) no se frena:
// se avisa y se publica como antes. `--no-esperar` lo saltea.
const PROYECTO = 'prj_JoZdpSXLEXabcr7B77LkAvtRrEAH';
const EQUIPO = 'team_ixok1wq6QmACIejj6GueVFrv';
function enCurso() {
  try {
    const r = JSON.parse(sh(`vercel api "/v6/deployments?projectId=${PROYECTO}&teamId=${EQUIPO}`
      + '&target=production&state=BUILDING,INITIALIZING,QUEUED&limit=20"'));
    return r.deployments ?? [];
  } catch {
    return null;
  }
}
let destino = main;
if (!process.argv.includes('--no-esperar')) {
  const hasta = Date.now() + 15 * 60_000;
  for (let ocupados = enCurso(); ocupados?.length; ocupados = enCurso()) {
    if (Date.now() > hasta) {
      console.error('✗ Vercel lleva 15 minutos con despliegues de producción en curso. No se publica: revisar la fila en Vercel.');
      process.exit(1);
    }
    console.log(`… Vercel está armando ${ocupados.length} despliegue(s) de producción; se espera para no amontonar.`);
    execSync('sleep 20');
  }
  if (enCurso() === null) console.warn('⚠ No se pudo consultar Vercel (¿`vercel login`?): se publica sin esperar.');
  sh('git fetch -q origin main produccion');
  destino = sh('git rev-parse origin/main');
  if (destino === sh('git rev-parse origin/produccion')) { console.log('Otra sesión ya publicó esto.'); process.exit(0); }
}
sh(`git push -q origin ${destino}:refs/heads/produccion`);
console.log(`✓ Publicando ${destino.slice(0, 9)} en portal.farmasalud.lat (Vercel tarda ~2 min).`);
