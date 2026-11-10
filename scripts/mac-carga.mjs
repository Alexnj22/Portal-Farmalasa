#!/usr/bin/env node
// `npm run mac:carga` — ¿por qué está lenta la Mac? Sólo lectura.
//
//   npm run mac:carga            informe; sale 1 si hay algo en rojo
//   npm run mac:carga -- --breve un renglón por hallazgo con qué hacer (hook de
//                                inicio de sesión); siempre sale 0
//
// Los umbrales y el porqué viven en scripts/lib/carga-de-la-mac.mjs.
import { corto, medirCarga } from './lib/carga-de-la-mac.mjs';

const r = medirCarga();
const icono = { ok: '✅', aviso: '🟡', rojo: '🔴' };

if (process.argv.includes('--breve')) {
  if (r.nivel !== 'ok') {
    console.log(`${icono[r.nivel]} La Mac está cargada (npm run mac:carga para el detalle):`);
    for (const h of r.hallazgos) {
      console.log(`- ${h.texto}${h.sugerencia ? ` → ${h.sugerencia}` : ''}`);
    }
  }
  process.exit(0);
}

const [l1, l5, l15] = r.carga.map((x) => x.toFixed(1));
console.log(`${icono[r.nivel]} Carga ${l1} / ${l5} / ${l15} en ${r.nucleos} núcleos · swap ${r.swapGB.toFixed(1)} GB`
  + (r.memLibre !== null ? ` · memoria libre ${r.memLibre}%` : '')
  + (r.diasEncendida !== null ? ` · encendida hace ${Math.floor(r.diasEncendida)} días` : ''));

for (const h of r.hallazgos) {
  console.log(`\n${icono[h.nivel]} ${h.texto}`);
  for (const d of h.detalle) console.log(`   ${d}`);
  if (h.sugerencia) console.log(`   👉 ${h.sugerencia}`);
}

console.log('\nMás CPU ahora:');
for (const p of r.topCpu) console.log(`   ${p.cpu.toFixed(0).padStart(4)}%  pid ${p.pid}  ${corto(p.cmd)}`);

if (r.nivel !== 'ok') {
  console.log('\nNo se mata nada solo: puede ser de otra sesión. Para cerrar uno: kill <pid>.');
}
process.exit(r.nivel === 'rojo' ? 1 : 0);
