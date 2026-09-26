// El quitacomentarios que comparten `gate:nucleo` y `gate:consultas`.
// Vivía dentro de `nucleo-gate.mjs`; al necesitarlo un segundo gate se mudó
// acá en vez de copiarse (2026-09-26).

/* Quita comentarios conservando los saltos de línea, para que los renglones
 * reportados sigan siendo los del archivo. Respeta cadenas, plantillas
 * ANIDADAS (`…${ x ? `…` : '' }…`, que en este repo arma todo el HTML de lo
 * que se imprime) y expresiones regulares literales (`/['"]/`). La primera
 * versión no llevaba la pila de plantillas y se desfasaba a mitad de
 * `bitacoraPapel.js`: acusaba a un comentario que explicaba `window.print()`. */
export function sinComentarios(texto, { blanquearCadenas = false } = {}) {
    let out = '', i = 0;
    // El texto de una cadena no es código: `'window'` no toca al navegador.
    const txt = (ch) => (blanquearCadenas && ch !== '\n' ? ' ' : ch);
    const pila = [];          // 'tpl' = dentro de una plantilla; número = llaves abiertas en un ${…}
    let cadena = null;        // ' o " mientras se está dentro de una
    const enPlantilla = () => pila[pila.length - 1] === 'tpl';
    while (i < texto.length) {
        const c = texto[i], s = texto[i + 1];
        if (cadena) {
            if (c === '\\') { out += txt(c) + txt(s ?? ''); i += 2; continue; }
            if (c === cadena || c === '\n') { cadena = null; out += c; i++; continue; }
            out += txt(c); i++; continue;
        }
        if (enPlantilla()) {
            if (c === '\\') { out += txt(c) + txt(s ?? ''); i += 2; continue; }
            if (c === '`') { pila.pop(); out += c; i++; continue; }
            if (c === '$' && s === '{') { pila.push(0); out += '${'; i += 2; continue; }
            out += txt(c); i++; continue;
        }
        // código (el nivel de arriba, o dentro de un ${…})
        if (c === '"' || c === "'") { cadena = c; out += c; i++; continue; }
        if (c === '`') { pila.push('tpl'); out += c; i++; continue; }
        if (c === '{' && pila.length) { pila[pila.length - 1]++; out += c; i++; continue; }
        if (c === '}' && pila.length && typeof pila[pila.length - 1] === 'number') {
            if (pila[pila.length - 1] === 0) { pila.pop(); out += c; i++; continue; }   // cierra el ${…}
            pila[pila.length - 1]--; out += c; i++; continue;
        }
        if (c === '/' && s === '/') { while (i < texto.length && texto[i] !== '\n') i++; continue; }
        if (c === '/' && s === '*') {
            i += 2;
            while (i < texto.length && !(texto[i] === '*' && texto[i + 1] === '/')) { if (texto[i] === '\n') out += '\n'; i++; }
            i += 2; continue;
        }
        // Una expresión regular literal: el `/` llega donde se espera un valor.
        if (c === '/' && /(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/.test(out.slice(-12))) {
            let k = i + 1, clase = false;
            while (k < texto.length && texto[k] !== '\n') {
                if (texto[k] === '\\') { k += 2; continue; }
                if (texto[k] === '[') clase = true;
                else if (texto[k] === ']') clase = false;
                else if (texto[k] === '/' && !clase) break;
                k++;
            }
            out += texto.slice(i, k + 1); i = k + 1; continue;
        }
        out += c; i++;
    }
    return out;
}
