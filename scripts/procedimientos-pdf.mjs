#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Los procedimientos escritos, en PDF y con el formato aprobado.
//
// El original de cada procedimiento es su archivo `.md` en
// `docs/legal/procedimientos/` — se edita ahí y se vuelve a generar. Escrito al
// revés (el PDF a mano y el markdown como copia) las dos versiones divergen y
// nadie sabe cuál firmó el regente.
//
// ── Por qué el conversor es ESTRICTO ──────────────────────────────────────
// Es la decisión de diseño de este archivo. Un conversor de markdown que no
// entiende una línea normalmente la escupe tal cual o la descarta, y las dos
// cosas son inaceptables acá: **este documento lo firma y sella el regente**, y
// una cláusula que desaparece en silencio es una cláusula que la empresa cree
// tener y no tiene. Así que el conversor sólo acepta el subconjunto que estos
// documentos usan —títulos, párrafos, tablas, listas, citas, reglas— y
// **aborta** ante cualquier otra cosa, nombrando el archivo y la línea.
//
// No es un conversor de markdown de propósito general y no debe convertirse en
// uno: el día que haga falta una construcción nueva, se agrega acá a propósito.
//
//   node scripts/procedimientos-pdf.mjs [carpeta-de-salida]
// ═══════════════════════════════════════════════════════════════════════════

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGEN = 'docs/legal/procedimientos';
const SALIDA = process.argv[2] || ORIGEN;

// ── El subconjunto, y nada más ────────────────────────────────────────────
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `**negrita**` y `` `literal` ``. Nada de enlaces ni imágenes: no se usan. */
function inline(t, donde) {
    if (/\]\(|!\[/.test(t)) {
        throw new Error(`${donde}: hay un enlace o una imagen, y el conversor no los acepta.`);
    }
    return esc(t)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

const filaDeTabla = (l) => l.trim().startsWith('|') && l.trim().endsWith('|');
const celdas = (l) => l.trim().slice(1, -1).split('|').map(c => c.trim());
const esSeparador = (l) => filaDeTabla(l) && celdas(l).every(c => /^:?-{2,}:?$/.test(c));

/**
 * Markdown → HTML, línea por línea y sin adivinar.
 * @returns {{html: string, titulo: string, meta: Array<[string,string]>, aviso: string}}
 */
function convertir(md, archivo) {
    const lineas = md.split('\n');
    const out = [];
    let titulo = null;
    let meta = null;
    const aviso = [];
    let i = 0;
    const donde = () => `${archivo}:${i + 1}`;

    while (i < lineas.length) {
        const l = lineas[i];

        // Línea en blanco
        if (!l.trim()) { i++; continue; }

        // Regla horizontal: separa bloques, no se dibuja (la maqueta ya separa)
        if (/^-{3,}\s*$/.test(l.trim())) { i++; continue; }

        // Cita: el aviso de BORRADOR. Se junta y sale del cuerpo, va al recuadro.
        if (l.startsWith('>')) {
            const bloque = [];
            while (i < lineas.length && lineas[i].startsWith('>')) {
                bloque.push(lineas[i].replace(/^>\s?/, ''));
                i++;
            }
            aviso.push(`<p>${inline(bloque.join(' ').replace(/\s+/g, ' ').trim(), donde())}</p>`);
            continue;
        }

        // Títulos
        const h = /^(#{1,4})\s+(.*)$/.exec(l);
        if (h) {
            const n = h[1].length;
            if (n === 1) {
                if (titulo) throw new Error(`${donde()}: hay dos títulos de nivel 1.`);
                titulo = h[2].trim();
            } else {
                out.push(`<h${n}>${inline(h[2].trim(), donde())}</h${n}>`);
            }
            i++;
            continue;
        }

        // Tabla
        if (filaDeTabla(l)) {
            if (!filaDeTabla(lineas[i + 1] || '') || !esSeparador(lineas[i + 1])) {
                throw new Error(`${donde()}: una tabla sin su fila de guiones.`);
            }
            const cab = celdas(l);
            i += 2;
            const filas = [];
            while (i < lineas.length && filaDeTabla(lineas[i])) {
                filas.push(celdas(lineas[i]));
                i++;
            }
            // La PRIMERA tabla del documento, apenas debajo del título, es la
            // ficha de identificación: va a la banda de control, no al cuerpo.
            if (!meta && !out.length) {
                meta = filas.map(f => [f[0], f[1] ?? '']);
                continue;
            }
            const th = cab.map(c => `<th>${inline(c, donde())}</th>`).join('');
            const tb = filas.map(f =>
                `<tr>${f.map(c => `<td>${inline(c, donde())}</td>`).join('')}</tr>`).join('');
            out.push(`<table>${cab.some(Boolean) ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${tb}</tbody></table>`);
            continue;
        }

        // Listas: `- ` y `1. `, con líneas de continuación indentadas
        const li = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(l);
        if (li) {
            const ordenada = li[2] !== '-';
            const items = [];
            while (i < lineas.length) {
                const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(lineas[i]);
                if (!m || (m[2] !== '-') !== ordenada) break;
                let texto = m[3];
                i++;
                // Continuación: línea con sangría que no abre un ítem nuevo
                while (i < lineas.length && /^\s{2,}\S/.test(lineas[i])
                       && !/^(\s*)(-|\d+\.)\s+/.test(lineas[i])) {
                    texto += ' ' + lineas[i].trim();
                    i++;
                }
                items.push(`<li>${inline(texto, donde())}</li>`);
            }
            out.push(`<${ordenada ? 'ol' : 'ul'}>${items.join('')}</${ordenada ? 'ol' : 'ul'}>`);
            continue;
        }

        // Ningún HTML crudo. El bloque de firma lo dibuja el generador —es parte
        // del formato, no del texto— y cualquier otra etiqueta suelta es un
        // descuido que no puede llegar a un documento que se firma.
        if (/^\s*<[a-z/]/i.test(l)) {
            throw new Error(`${donde()}: hay HTML crudo (${l.trim().slice(0, 30)}). El texto va en markdown.`);
        }

        // Párrafo: se junta hasta la línea en blanco
        const parrafo = [];
        while (i < lineas.length && lineas[i].trim()
               && !/^(#{1,4}\s|>|-{3,}\s*$|\s*(-|\d+\.)\s)/.test(lineas[i])
               && !filaDeTabla(lineas[i]) && lineas[i].trim() !== '<br/>') {
            parrafo.push(lineas[i].trim());
            i++;
        }
        if (!parrafo.length) {
            throw new Error(`${donde()}: el conversor no entiende esta línea: ${JSON.stringify(l.slice(0, 80))}`);
        }
        out.push(`<p>${inline(parrafo.join(' '), donde())}</p>`);
    }

    if (!titulo) throw new Error(`${archivo}: no tiene título de nivel 1.`);
    if (!meta) throw new Error(`${archivo}: no tiene la ficha de identificación (la tabla bajo el título).`);
    return { html: out.join('\n'), titulo, meta, aviso: aviso.join('') };
}

// ── El formato aprobado ───────────────────────────────────────────────────
// La misma banda de control, la misma franja de identidad y la misma regla de
// tinta que las hojas de bitácoras: negro sobre blanco, ningún significado
// apoyado en un fondo, porque Chrome no imprime fondos por defecto y porque el
// papel se fotocopia. Ver la cabecera de `src/utils/bitacoraPapel.js`.
const CSS = `
  @page { size: letter portrait; margin: 22mm 18mm 20mm; }
  * { box-sizing: border-box; }
  body { font: 400 9.5pt/1.45 Arial, Helvetica, sans-serif; color: #000; margin: 0;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .banda { display: table; width: 100%; border: 1pt solid #000; margin-bottom: 4mm; }
  .banda > div { display: table-cell; vertical-align: middle; padding: 1.6mm 3mm; }
  .banda .logo { width: 52mm; border-right: 1pt solid #000; }
  .banda .logo img { display: block; width: 100%; height: auto; }
  .banda .logo .empresa { font-size: 8.5pt; font-weight: bold; line-height: 1.15; }
  .banda .centro { text-align: center; }
  .banda .cejilla { font-size: 6pt; letter-spacing: .22em; text-transform: uppercase; }
  .banda .titulo { font-size: 12.5pt; font-weight: bold; margin-top: 1mm; line-height: 1.15; }

  table.ficha { width: 100%; border-collapse: collapse; margin-bottom: 5mm; table-layout: fixed; }
  table.ficha td { border: .5pt solid #000; padding: 1.6mm 2.4mm; vertical-align: top; font-size: 8.5pt; }
  table.ficha td.k { width: 34%; font-size: 5.8pt; letter-spacing: .14em; text-transform: uppercase;
                     font-weight: bold; }

  .aviso { border: 1.2pt solid #000; padding: 2.4mm 3mm; margin-bottom: 6mm; font-size: 8pt; line-height: 1.4; }

  h2 { font-size: 10.5pt; font-weight: bold; margin: 7mm 0 2.5mm; padding-bottom: 1.2mm;
       border-bottom: .9pt solid #000; page-break-after: avoid; }
  h3 { font-size: 9.5pt; font-weight: bold; margin: 5mm 0 1.8mm; page-break-after: avoid; }
  h4 { font-size: 9pt; font-weight: bold; margin: 4mm 0 1.5mm; page-break-after: avoid; }
  p { margin: 0 0 2.6mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }
  code { font-family: Arial, Helvetica, sans-serif; border-bottom: .6pt solid #000;
         padding: 0 .6mm; white-space: pre-wrap; }

  table { width: 100%; border-collapse: collapse; margin: 0 0 4mm; page-break-inside: avoid; }
  th, td { border: .4pt solid #000; padding: 1.4mm 2mm; font-size: 8.5pt; vertical-align: top;
           text-align: left; }
  th { font-size: 6pt; letter-spacing: .12em; text-transform: uppercase; font-weight: bold;
       border-bottom: 1.1pt solid #000; }

  .aviso p { margin: 0 0 2mm; }
  .aviso p:last-child { margin-bottom: 0; }

  .firma { margin-top: 18mm; page-break-inside: avoid; width: 92mm; }
  .firma .rotulo { font-size: 5.8pt; letter-spacing: .16em; text-transform: uppercase;
                   font-weight: bold; margin-bottom: 14mm; }
  .firma .raya { border-top: .9pt solid #000; }
  .firma .quien { font-size: 9pt; font-weight: bold; margin-top: 1.4mm; }
  .firma .que { font-size: 7.5pt; margin-top: 1mm; }
`;

const banda = (titulo, logo) => `<div class="banda">
    <div class="logo">${logo?.dataUrl
        ? `<img src="${logo.dataUrl}" alt="Farmacias La Popular y La Salud"/>`
        : '<div class="empresa">FARMACIAS<br/>LA POPULAR Y LA SALUD</div>'}</div>
    <div class="centro">
        <div class="cejilla">Procedimiento escrito</div>
        <div class="titulo">${esc(titulo)}</div>
    </div>
</div>`;

/**
 * El espacio de firma, que es parte del FORMATO y no del texto.
 *
 * El nombre sale de la misma ficha de identificación que encabeza el documento
 * —«Revisado y autorizado por»— así que no hay dos lugares donde escribirlo y
 * no pueden decir cosas distintas. Es el numeral 6.1.12: la documentación va
 * autorizada por el regente, con su firma y sello.
 */
const firma = (meta) => {
    const quien = (meta.find(([k]) => /autorizado/i.test(k)) || [])[1] || '';
    return `<div class="firma">
        <div class="rotulo">Revisado y autorizado por</div>
        <div class="raya"></div>
        <div class="quien">${quien
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')}</div>
        <div class="que">Firma y sello · Fecha: ____________________</div>
    </div>`;
};

const ficha = (meta) => `<table class="ficha">${meta.map(([k, v]) =>
    `<tr><td class="k">${k.replace(/\*\*/g, '')}</td><td>${v
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</td></tr>`).join('')}</table>`;

async function main() {
    let logo = null;
    try {
        const bin = await fs.readFile('public/logo-farmacias.png');
        logo = { dataUrl: `data:image/png;base64,${bin.toString('base64')}` };
    } catch {
        console.warn('  (sin logo: no se encontró public/logo-farmacias.png)');
    }

    const archivos = (await fs.readdir(ORIGEN)).filter(f => f.endsWith('.md')).sort();
    if (!archivos.length) throw new Error(`No hay .md en ${ORIGEN}`);
    await fs.mkdir(SALIDA, { recursive: true });

    const navegador = await chromium.launch();
    for (const archivo of archivos) {
        const md = await fs.readFile(path.join(ORIGEN, archivo), 'utf-8');
        const { html, titulo, meta, aviso } = convertir(md, archivo);

        const codigo = (meta.find(([k]) => /código/i.test(k)) || [])[1] || '';
        const version = (meta.find(([k]) => /versión/i.test(k)) || [])[1] || '';
        const pie = `${esc(titulo)} &nbsp;·&nbsp; ${esc(codigo.replace(/[`\[\]]/g, ''))} v${esc(version)}`;

        const doc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
            <title>${esc(titulo)}</title><style>${CSS}</style></head><body>
            ${banda(titulo, logo)}${ficha(meta)}
            ${aviso ? `<div class="aviso">${aviso}</div>` : ''}
            ${html}${firma(meta)}</body></html>`;

        const pagina = await navegador.newPage();
        await pagina.setContent(doc, { waitUntil: 'load' });
        const salida = path.join(SALIDA, archivo.replace(/\.md$/, '.pdf'));
        await pagina.pdf({
            path: salida,
            printBackground: true,
            preferCSSPageSize: true,
            // La numeración de hoja no es adorno: la Guía de Verificación 3.7 la
            // exige para un documento controlado, y un procedimiento suelto sin
            // número de página no se puede comprobar completo.
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: `<div style="width:100%;padding:0 18mm;font:7pt Arial,sans-serif;color:#000;
                display:flex;justify-content:space-between;">
                <span>${pie}</span>
                <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
            </div>`,
        });
        await pagina.close();
        console.log(`  ✓ ${salida}`);
    }
    await navegador.close();
}

main().catch((e) => { console.error(`\n  ✗ ${e.message}\n`); process.exit(1); });
