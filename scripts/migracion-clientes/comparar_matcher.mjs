// Enfrenta la traducción TypeScript al matcher original de `bloque.py` sobre
// los 25,946 casos reales que arma `arnes_matcher.py`.
//
// Este archivo es la razón por la que se puede confiar en `distrito.ts`. Una
// traducción que "se ve igual" no hereda nada del original; una que reproduce
// sus 25,946 decisiones, sí.
//
//     python3 arnes_matcher.py            # arma casos_matcher.json
//     python3 arnes_matcher.py --salida   # corre el Python y guarda su fallo
//     node    comparar_matcher.mjs        # corre el TS y compara
//
// Debe dar 0 diferencias. Si una regla cambia en cualquiera de los dos lados,
// esto lo detecta.
import { readFileSync } from 'node:fs';
import { elegirDistrito, ubicacionDe } from '../../supabase/functions/_shared/distrito.ts';

const D = new URL('.', import.meta.url).pathname;
const casos = JSON.parse(readFileSync(`${D}casos_matcher.json`, 'utf8'));
const refPython = JSON.parse(readFileSync(`${D}salida_python.json`, 'utf8'));

let iguales = 0;
const distintos = [];

for (const c of casos) {
  const ops = c.ops.map(o => [o[0], o[1]]);
  const { value, motivo } = await elegirDistrito(
    c.portal_id, c.direccion, ops, ubicacionDe(c.departamento, c.municipio));
  const esperado = refPython[c.portal_id];
  if (!esperado) continue;
  if (String(value) === String(esperado[0]) && motivo === esperado[1]) {
    iguales++;
  } else {
    if (distintos.length < 10) {
      distintos.push(
        `  ${c.portal_id}  dir=${JSON.stringify(c.direccion).slice(0, 46)}\n` +
        `      python: ${esperado[0]} (${esperado[1]})\n` +
        `      typescript: ${value} (${motivo})`);
    }
    distintos.push(null);
  }
}

const nDist = distintos.filter(x => x === null).length + distintos.filter(x => x !== null).length;
const fallan = distintos.filter(Boolean).length + distintos.filter(x => x === null).length;
console.log(`\ncasos: ${casos.length}`);
console.log(`iguales:   ${iguales}`);
console.log(`distintos: ${fallan}`);
for (const d of distintos.filter(Boolean)) console.log(d);
process.exit(fallan === 0 ? 0 : 1);
