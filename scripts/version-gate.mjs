#!/usr/bin/env node
/**
 * Verifica que APP_VERSION haya subido cuando cambió `src/`.
 *
 * Creado el 2026-07-27 después de descubrir que DOCE bumps seguidos habían
 * fallado en silencio: los scripts hacían un `replace` sobre un ancla que ya no
 * existía, no verificaban el resultado, y el commit salía igual con "(v2.7X)"
 * en el mensaje y el archivo intacto.
 *
 * Es el mismo patrón que las vistas sin import: una operación que no hace nada,
 * y nada que lo mire.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const leerVersion = (texto) => (texto.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];

const actual = leerVersion(readFileSync('src/version.js', 'utf8'));
let anterior = null;
try {
  anterior = leerVersion(execSync('git show HEAD:src/version.js', { encoding: 'utf8' }));
} catch { /* primer commit */ }

const cambios = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .split('\n').filter(f => f.startsWith('src/') && f !== 'src/version.js');

console.log(`\n  APP_VERSION: ${anterior ?? '—'} → ${actual}`);
if (!cambios.length) {
  console.log('  Sin cambios en src/ preparados. Nada que verificar.\n');
  process.exit(0);
}
if (actual === anterior) {
  console.log(`\n  ✗ ${cambios.length} archivo(s) de src/ cambiaron y APP_VERSION sigue en ${actual}.`);
  console.log('    Si el bump se hizo con un script, revisá que el reemplazo haya ocurrido:');
  console.log('    un replace que no encuentra su ancla no falla, simplemente no hace nada.\n');
  process.exit(1);
}
console.log(`  ✓ ${cambios.length} archivo(s) de src/ y la versión subió.\n`);
