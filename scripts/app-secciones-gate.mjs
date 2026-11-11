#!/usr/bin/env node
// gate:app-secciones — las secciones de una pantalla de la app del personal
// van FIJAS arriba (2026-11-11, usuario: «deja las pestañas siempre al top,
// fijas» y «debe estar en todo, debe ser canónico»).
//
// La forma canónica está en `apps/mobile/componentes/FijoArriba.js`: un
// `<Segmentos>` que cambia lo que muestra la pantalla va FUERA de la lista,
// envuelto en `<FijoArriba>`, justo antes del ScrollView / FlatList /
// ListaPaginada. Lo que este gate caza es la forma vieja: un `<Segmentos>`
// que es lo primero DENTRO de la lista (primer hijo de un ScrollView, o dentro
// de `ListHeaderComponent` / `cabecera`), que se va con el contenido al
// desplazar.
//
// Un `<Segmentos>` que es una elección dentro de un formulario no es una
// sección y casi nunca queda primero en una lista. Si queda, se declara en la
// misma línea o en la anterior con `// seccion-en-linea: <motivo>`.
//
//   node scripts/app-secciones-gate.mjs          → informe; falla con hallazgos
//   node scripts/app-secciones-gate.mjs --hook   → igual, para el pre-commit
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = 'apps/mobile';
const CARPETAS = ['app', 'componentes'];
const VENTANA = 6; // líneas hacia atrás que se miran

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') out.push(...archivos(p)); }
    else if (/\.(js|jsx)$/.test(n)) out.push(p);
  }
  return out;
}

const hallazgos = [];
for (const c of CARPETAS) {
  for (const f of archivos(join(RAIZ, c))) {
    if (/componentes\/(Segmentos|FijoArriba|ListaPaginada)(\.\w+)?\.js$/.test(f)) continue;
    const L = readFileSync(f, 'utf8').split('\n');
    L.forEach((linea, i) => {
      if (!linea.includes('<Segmentos')) return;
      const antes = L.slice(Math.max(0, i - VENTANA), i);
      if ([linea, L[i - 1] ?? ''].some((l) => l.includes('seccion-en-linea:'))) return;
      if (antes.some((l) => l.includes('<FijoArriba'))) return;
      // Lo último que se abrió antes del Segmentos, ignorando comentarios y condiciones.
      const abierto = [...antes].reverse().filter((l) => !l.includes("<RefreshControl")).find((l) => /<ScrollView\b|ListHeaderComponent=|cabecera=|<[A-Z]\w*[\s>]|^\s*<\/\w/.test(l));
      if (abierto && /<ScrollView\b|ListHeaderComponent=|cabecera=/.test(abierto)) {
        hallazgos.push(`${relative('.', f)}:${i + 1}`);
      }
    });
  }
}

if (!hallazgos.length) {
  console.log('  ✓ gate:app-secciones — toda sección de pantalla está fija arriba (FijoArriba).');
  process.exit(0);
}
console.error(`  ✗ gate:app-secciones — ${hallazgos.length} sección(es) DENTRO de la lista: se van al desplazar.`);
for (const h of hallazgos) console.error(`      ${h}`);
console.error('    Sacala de la lista y envolvela en <FijoArriba> (apps/mobile/componentes/FijoArriba.js).');
console.error('    Si es una elección de formulario y no una sección: `// seccion-en-linea: <motivo>`.');
process.exit(1);
