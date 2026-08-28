// ─────────────────────────────────────────────────────────────────────────────
// Una bandera de «esto está mal» escrita SUELTA vale `true` para siempre
// ─────────────────────────────────────────────────────────────────────────────
//
// En JSX, `<Campo hasError />` es `hasError={true}`. Sobre un atributo como
// `required` o `compact` eso es exactamente lo que se quiere. Sobre `hasError` o
// `invalid` —que dicen que un dato está MAL— significa que el campo se pinta en
// rojo siempre, con cualquier valor.
//
// Pasó de verdad: la fecha de nacimiento salía en rojo con cualquier fecha, y el
// usuario lo reportó sobre una perfectamente válida. La pista de que no era la
// validación estaba en la misma pantalla —el rótulo decía «· 39 años», y ese
// texto sólo se dibuja cuando la fecha ES válida— pero eso hay que saber
// mirarlo.
//
// No lo caza ningún linter: es JSX válido y el componente lo recibe encantado.
// Y no lo caza una prueba de comportamiento tampoco, porque el campo «funciona»:
// guarda, valida, avisa. Sólo miente con el color.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const RAIZ = process.cwd();

// Los canónicos que reciben esta bandera. Si aparece uno nuevo, se agrega acá.
const BANDERAS = ['hasError', 'invalid'];

const fuentes = execSync("find src -type f \\( -name '*.jsx' -o -name '*.js' \\)", { cwd: RAIZ, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);

describe('ninguna bandera de error va suelta', () => {
    it('en ningún componente de src/', () => {
        const hallazgos = [];
        for (const f of fuentes) {
            const texto = fs.readFileSync(path.join(RAIZ, f), 'utf8');
            /* Se mira la ETIQUETA COMPLETA, no la línea.
             *
             * La primera versión de esta prueba exigía que la bandera estuviera
             * en el mismo renglón que `<Liquid…`, y con eso dio VERDE sobre el
             * defecto real: al reformatear el componente en varias líneas, el
             * `hasError` suelto quedaba tres renglones más abajo. Se descubrió
             * fabricándole la regresión que tenía que cazar, que es lo único que
             * distingue un cero de un detector ciego. */
            const abre = /<(?:Liquid|Portal|File|Catalog)[A-Za-z]*\b/g;
            let m;
            while ((m = abre.exec(texto)) !== null) {
                // Hasta el `>` que cierra la etiqueta de apertura. Se corta en
                // el primero que no esté dentro de una llave, que alcanza para
                // JSX bien formado.
                let i = m.index, prof = 0, fin = -1;
                for (; i < texto.length; i++) {
                    const c = texto[i];
                    if (c === '{') prof++;
                    else if (c === '}') prof--;
                    else if (c === '>' && prof === 0) { fin = i; break; }
                }
                if (fin < 0) continue;
                const etiqueta = texto.slice(m.index, fin);
                for (const b of BANDERAS) {
                    if (new RegExp(`${b}\\s*=`).test(etiqueta)) continue;
                    if (new RegExp(`\\s${b}(\\s|$)`).test(etiqueta)) {
                        const linea = texto.slice(0, m.index).split('\n').length;
                        hallazgos.push(`${f}:${linea} — ${b} sin valor en ${m[0]}`);
                    }
                }
            }
        }
        expect(hallazgos).toEqual([]);
    });
});
