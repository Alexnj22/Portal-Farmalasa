// ── `blanquearComentarios` · el stripper que no se come el archivo ─────────
//
// Encontrado el 2026-08-26 midiendo por qué una categoría nueva daba CERO
// sobre el formulario más grande del repo: `accept="image/*"` tiene un `/*`
// dentro de una CADENA, y el `replace(/\/\*[\s\S]*?\*\//g, …)` lo tomó como
// apertura de comentario y blanqueó **154,304 caracteres** — el archivo entero
// de ahí para abajo. O sea que `input-sin-nombre`, `tarjeta-a-mano` y la
// categoría nueva venían dando cero sobre 2/3 de `EmployeeFormModal.jsx` sin
// que nada lo dijera.
//
// Es el modo de falla más caro que tiene un gate: no falla, da verde. Y el
// verde es indistinguible del verde de verdad.
//
// Por eso esto no es un regex sino un recorrido que sabe cuándo está dentro de
// una cadena. Blanquea conservando los saltos de línea, para que los números de
// línea que reporta el gate sigan siendo los del archivo.
export function blanquearComentarios(txt) {
  let out = '';
  let i = 0;
  let comilla = null;   // ', " o ` cuando estamos dentro de una cadena
  while (i < txt.length) {
    const c = txt[i], d = txt[i + 1];
    if (comilla) {
      if (c === '\\') { out += txt.slice(i, i + 2); i += 2; continue; }
      if (c === comilla) comilla = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { comilla = c; out += c; i++; continue; }
    if (c === '/' && d === '*') {
      const fin = txt.indexOf('*/', i + 2);
      const hasta = fin === -1 ? txt.length : fin + 2;
      out += txt.slice(i, hasta).replace(/[^\n]/g, ' ');
      i = hasta; continue;
    }
    if (c === '/' && d === '/') {
      let fin = txt.indexOf('\n', i);
      if (fin === -1) fin = txt.length;
      out += txt.slice(i, fin).replace(/[^\n]/g, ' ');
      i = fin; continue;
    }
    out += c; i++;
  }
  return out;
}
