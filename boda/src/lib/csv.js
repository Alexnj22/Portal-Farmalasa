const celda = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function descargarCsv(nombre, filas) {
  if (!filas.length) return;
  const cols = Object.keys(filas[0]);
  const texto = [cols.join(','), ...filas.map((f) => cols.map((c) => celda(f[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
}

/** CSV simple (acepta , o ; como separador y comillas). */
export function leerCsv(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const partir = (l) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const cab = partir(lineas[0]).map((c) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  return lineas.slice(1).map((l) => {
    const v = partir(l);
    return Object.fromEntries(cab.map((c, i) => [c, v[i] ?? '']));
  });
}
