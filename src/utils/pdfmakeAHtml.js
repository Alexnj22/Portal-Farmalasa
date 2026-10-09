// Una definición de pdfmake → HTML para imprimir o pasar a PDF fuera del
// navegador. `pdfmake` es sólo-web (pesa ~800 kB y su fuente vive en el
// navegador), así que el teléfono arma el mismo documento con este HTML y
// `expo-print` lo convierte. La DEFINICIÓN es la misma que usa el portal: lo
// que cambia es quien la dibuja, y por eso no hay dos documentos que mantener.
//
// Cubre lo que usan los documentos del portal: texto (también en partes),
// `stack`, `columns` (con `width` fijo o `*`), `table` con `widths`, `body`,
// `fillColor` y `layout` ('noBorders', 'lightHorizontalLines' o las funciones
// de líneas), `ul`/`ol`, `image` (data URL), líneas y rectángulos de `canvas`,
// márgenes, tamaños, color, negrita, cursiva, alineación, `characterSpacing`,
// `defaultStyle`, `styles`, `pageMargins` y el `footer` (una vez, al final).
// Las unidades de pdfmake son puntos: en CSS se escriben como `pt`.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const margen = (m) => {
    if (m == null) return '';
    if (typeof m === 'number') return `margin:${m}pt;`;
    if (m.length === 2) return `margin:${m[1]}pt ${m[0]}pt;`;
    const [l, t, r, b] = m;
    return `margin:${t}pt ${r}pt ${b}pt ${l}pt;`;
};

function estiloDe(n = {}, estilos = {}) {
    const desdeEstilo = [].concat(n.style || []).reduce((acc, k) => ({ ...acc, ...(estilos[k] || {}) }), {});
    const e = { ...desdeEstilo, ...n };
    let css = '';
    if (e.fontSize != null) css += `font-size:${e.fontSize}pt;`;
    if (e.bold) css += 'font-weight:700;';
    if (e.italics) css += 'font-style:italic;';
    if (e.color) css += `color:${e.color};`;
    if (e.alignment) css += `text-align:${e.alignment};`;
    if (e.characterSpacing) css += `letter-spacing:${e.characterSpacing}pt;`;
    if (e.lineHeight) css += `line-height:${e.lineHeight};`;
    if (e.decoration === 'underline') css += 'text-decoration:underline;';
    if (e.decoration === 'lineThrough') css += 'text-decoration:line-through;';
    if (e.background) css += `background:${e.background};`;
    return css;
}

function texto(t, estilos) {
    if (t == null) return '';
    if (Array.isArray(t)) return t.map((p) => texto(p, estilos)).join('');
    if (typeof t === 'object') return `<span style="${estiloDe(t, estilos)}">${texto(t.text, estilos)}</span>`;
    return esc(t).replace(/\n/g, '<br>');
}

function lienzo(formas = []) {
    return formas.map((f) => {
        if (f.type === 'line') {
            const ancho = Math.abs((f.x2 ?? 0) - (f.x1 ?? 0));
            return `<div style="width:${ancho}pt;max-width:100%;border-top:${f.lineWidth ?? 1}pt solid ${f.lineColor || 'black'};margin-left:${f.x1 ?? 0}pt"></div>`;
        }
        if (f.type === 'rect') {
            return `<div style="width:${f.w}pt;height:${f.h}pt;background:${f.color || 'transparent'};border:${f.lineWidth ? `${f.lineWidth}pt solid ${f.lineColor || 'black'}` : 'none'};border-radius:${f.r || 0}pt"></div>`;
        }
        return '';
    }).join('');
}

function bordeDeTabla(layout, filas) {
    if (layout === 'noBorders') return () => '';
    if (layout === 'lightHorizontalLines') return (i) => (i > 0 ? 'border-top:0.5pt solid lightgray;' : '');
    if (layout && typeof layout === 'object') {
        const nodo = { table: { body: filas } };
        return (i, j) => {
            const h = layout.hLineWidth ? layout.hLineWidth(i, nodo) : 1;
            const v = layout.vLineWidth ? layout.vLineWidth(j, nodo) : 1;
            const hc = layout.hLineColor ? layout.hLineColor(i, nodo) : 'black';
            const vc = layout.vLineColor ? layout.vLineColor(j, nodo) : 'black';
            let css = '';
            if (h) css += `border-top:${h}pt solid ${hc};`;
            if (i === filas.length - 1 && layout.hLineWidth) { const hb = layout.hLineWidth(i + 1, nodo); if (hb) css += `border-bottom:${hb}pt solid ${hc};`; }
            if (v) css += `border-left:${v}pt solid ${vc};border-right:${v}pt solid ${vc};`;
            return css;
        };
    }
    return () => 'border:0.5pt solid black;';
}

function nodo(n, estilos) {
    if (n == null || n === '') return '';
    if (typeof n === 'string' || typeof n === 'number') return `<div>${texto(n, estilos)}</div>`;
    if (Array.isArray(n)) return n.map((x) => nodo(x, estilos)).join('');
    const base = `${estiloDe(n, estilos)}${margen(n.margin)}`;
    const salto = n.pageBreak === 'before' ? 'page-break-before:always;' : n.pageBreak === 'after' ? 'page-break-after:always;' : '';
    if (n.stack) return `<div style="${base}${salto}">${n.stack.map((x) => nodo(x, estilos)).join('')}</div>`;
    if (n.columns) {
        const gap = n.columnGap ?? 0;
        const cols = n.columns.map((c) => {
            const w = c.width === '*' || c.width == null ? 'flex:1;' : c.width === 'auto' ? 'flex:0 0 auto;' : `flex:0 0 ${c.width}pt;`;
            return `<div style="${w}min-width:0">${nodo({ ...c, width: undefined }, estilos)}</div>`;
        }).join('');
        return `<div style="display:flex;gap:${gap}pt;${base}${salto}">${cols}</div>`;
    }
    if (n.table) {
        const filas = n.table.body || [];
        const anchos = n.table.widths || [];
        const borde = bordeDeTabla(n.layout, filas);
        const col = anchos.map((w) => `<col style="${w === '*' || w === 'auto' ? '' : `width:${w}pt`}">`).join('');
        const cuerpo = filas.map((fila, i) => `<tr>${fila.map((c, j) => {
            const celda = typeof c === 'object' && c !== null ? c : { text: c };
            if (celda._oculta) return '';
            const span = `${celda.colSpan ? ` colspan="${celda.colSpan}"` : ''}${celda.rowSpan ? ` rowspan="${celda.rowSpan}"` : ''}`;
            const relleno = celda.margin ? `padding:${margen(celda.margin).replace('margin:', '')}` : 'padding:2pt 4pt;';
            const fondo = celda.fillColor ? `background:${celda.fillColor};` : '';
            return `<td${span} style="vertical-align:top;${borde(i, j)}${relleno}${fondo}">${nodo({ ...celda, margin: undefined, fillColor: undefined }, estilos)}</td>`;
        }).join('')}</tr>`).join('');
        return `<table style="width:100%;border-collapse:collapse;${margen(n.margin)}${salto}"><colgroup>${col}</colgroup>${cuerpo}</table>`;
    }
    if (n.ul || n.ol) {
        const tag = n.ul ? 'ul' : 'ol';
        return `<${tag} style="${base}${salto}">${(n.ul || n.ol).map((x) => `<li>${typeof x === 'object' ? nodo(x, estilos) : texto(x, estilos)}</li>`).join('')}</${tag}>`;
    }
    if (n.image) {
        const w = n.width ? `width:${n.width}pt;` : n.fit ? `max-width:${n.fit[0]}pt;max-height:${n.fit[1]}pt;` : 'max-width:100%;';
        const alinear = n.alignment === 'center' ? 'display:block;margin-left:auto;margin-right:auto;' : n.alignment === 'right' ? 'display:block;margin-left:auto;' : '';
        return `<div style="${margen(n.margin)}${salto}"><img src="${esc(n.image)}" style="${w}${n.height ? `height:${n.height}pt;` : ''}${alinear}"></div>`;
    }
    if (n.canvas) return `<div style="${margen(n.margin)}${salto}">${lienzo(n.canvas)}</div>`;
    if (n.text != null) return `<div style="${base}${salto}">${texto(n.text, estilos)}</div>`;
    return '';
}

/**
 * El HTML completo de una definición de pdfmake.
 * @param {object} def  la misma que se le pasa a `pdfMake.createPdf`
 */
export function pdfmakeAHtml(def = {}) {
    const estilos = def.styles || {};
    const [ml, mt, mr, mb] = Array.isArray(def.pageMargins) ? (def.pageMargins.length === 2
        ? [def.pageMargins[0], def.pageMargins[1], def.pageMargins[0], def.pageMargins[1]] : def.pageMargins) : [40, 40, 40, 40];
    const pie = typeof def.footer === 'function' ? def.footer(1, 1) : def.footer;
    const tamano = def.pageSize === 'A4' ? 'A4' : 'letter';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>@page{size:${tamano}${def.pageOrientation === 'landscape' ? ' landscape' : ''};margin:${mt}pt ${mr}pt ${mb}pt ${ml}pt}
body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;${estiloDe(def.defaultStyle || {}, estilos)}}
*{box-sizing:border-box}p{margin:0}</style></head><body>
${nodo(def.content, estilos)}
${pie ? `<div style="margin-top:18pt">${nodo({ ...pie, margin: undefined }, estilos)}</div>` : ''}
</body></html>`;
}
