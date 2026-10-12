// ─── Pedido print utility ─────────────────────────────────────────────────────
// Genera un PDF real con pdfmake: el encabezado de cada tabla repite en todas
// las hojas vía headerRows, márgenes exactos, filas atómicas (dontBreakRows).
// qty siempre en PACKS (cajas/blisters/frascos), no en unidades.

import { leerDireccionesDeSalas } from '../data/pedidos';

// pdfmake se carga BAJO DEMANDA. Estático costaba 809 kB gzip en el chunk de
// PedidosView (vfs_fonts son las fuentes embebidas en base64): se bajaban al
// ENTRAR a Pedidos, imprimiera el usuario o no — 4× el peso del tablero entero.
// Este módulo también exporta matemática pura (getPageGroups, buildPedidoCodigo,
// fefoProject, toDispatch…) que 3 de sus 4 importadores usan SIN imprimir nada;
// con el import estático esos tres pagaban las fuentes igual.
// Lo vigila `npm run gate:bundle` (auditoría 2026-07-30).
// La matemática de generar un pedido (FEFO y el código por sala) vive en
// `codigoDePedido`, sin pdfmake: la usa también la app del teléfono.
import { fefoProject } from './codigoDePedido';
import { seccionDePedido } from './papelDePedido';
import {
    ERP_NAMES_DEFAULT, PAGE_MARGINS, buildDocDefinition, dateSuffix, prepararHojasExactas, seccionDeGenerar,
} from './pedidoPdfDoc';
// La definición del papel vive en `pedidoPdfDoc` (puro): el teléfono la usa
// con su propia imprenta y tiene que salir la MISMA hoja.
export { fmtVence } from './pedidoPdfDoc';
export { fefoProject };
export { buildPedidoCodigo } from './codigoDePedido';

let pdfMakePromise = null;
function getPdfMake() {
    if (!pdfMakePromise) {
        pdfMakePromise = Promise.all([
            import('pdfmake/build/pdfmake'),
            import('pdfmake/build/vfs_fonts'),
        ]).then(([mk, fonts]) => {
            const pdfMake = mk.default || mk;
            pdfMake.addVirtualFileSystem(fonts.default || fonts);
            return pdfMake;
        }).catch((err) => {
            pdfMakePromise = null; // reintentar en el próximo click, no quedar roto
            throw err;
        });
    }
    return pdfMakePromise;
}


// ── Asset cache ───────────────────────────────────────────────────────────────
let _logoCache = null;
async function getLogoBase64() {
    if (_logoCache) return _logoCache;
    try {
        const res  = await fetch('/Logo512.png');
        const blob = await res.blob();
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload  = () => { _logoCache = reader.result; resolve(reader.result); };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch { return null; }
}

let _addrCache = null;
async function getAddressMap() {
    if (!_addrCache) _addrCache = await leerDireccionesDeSalas();
    return _addrCache;
}


async function downloadPdf(docDefinition, filename) {
    const pdfMake = await getPdfMake();
    pdfMake.createPdf(docDefinition).download(filename);
}


// ── Estimación de páginas para FinalizarCajasModal ──────────────────────────
// Calibrado contra pdfmake con LETTER, PAGE_MARGINS=[24,22,24,44] y el layout
// de buildSectionTable (paddingTop:0, paddingBottom:0 → solo margin de celda).
//
// Alturas reales en pdfmake (cell margin [0,2,0,2] + fontSize + border 0.5pt):
//   Fila simple (0-1 lotes, sin badge) ≈ 15pt
//   Cada lote adicional añade ≈ 9pt  (fontSize 7.5 × 1.15 + margin 1+1 = 10.6pt)
//   Badge BAJO RECETA añade ≈ 8pt
//   Header 3 filas (titleRow+subtitle+colHeader) ≈ 50pt
//   Espacio disponible para datos ≈ 726 - 50 = 676pt
const _AVAIL_H    = 792 - PAGE_MARGINS[1] - PAGE_MARGINS[3]; // 726pt
const _HEADER_PT  = 61;
const _DATA_AVAIL = _AVAIL_H - _HEADER_PT;  // 665pt (sin buffer — alturas más ajustadas)
const _ROW_BASE   = 15;   // fila simple (0-1 lotes, sin badge) — calibrado empíricamente
const _LOTE_XTRA  = 9;    // pt por lote adicional (2do, 3ro…)
const _BADGE_ADD  = 8;    // pt extra por badge BAJO RECETA

function _rowPt(row) {
    // Funciona con pedido_items crudos (lotes_asignados) o filas mapeadas (lotes)
    const loteCnt = Array.isArray(row.lotes_asignados) ? row.lotes_asignados.length
                  : Array.isArray(row.lotes)            ? row.lotes.length : 0;
    const badge   = row.products?.es_antibiotico ?? row.es_antibiotico ?? false;
    return Math.max(
        _ROW_BASE + (badge ? _BADGE_ADD : 0),
        loteCnt > 1 ? _ROW_BASE + (loteCnt - 1) * _LOTE_XTRA : _ROW_BASE,
    );
}

// Retorna [{ ids, firstItem, firstLab, itemCount }, …]
// Sort idéntico a buildProductRows (lab → producto).
export function getPageGroups(rows) {
    const printable = [...rows]
        .filter(r => !r.sin_stock && (r.cantidad_asignada ?? 0) > 0)
        .sort((a, b) =>
            (a.products?.laboratorios?.nombre ?? '').localeCompare(b.products?.laboratorios?.nombre ?? '', 'es')
            || (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es')
        );

    const pages = [];
    let page = [], used = 0;
    for (const row of printable) {
        const h = _rowPt(row);
        if (used + h > _DATA_AVAIL && page.length > 0) {
            pages.push(page); page = []; used = 0;
        }
        page.push(row);
        used += h;
    }
    if (page.length > 0) pages.push(page);

    return pages.map(p => ({
        ids:       p.map(r => r.id),
        firstItem: p[0]?.products?.nombre ?? '',
        firstLab:  p[0]?.products?.laboratorios?.nombre ?? '',
        itemCount: p.length,
    }));
}


// ── Extracción exacta de páginas vía pageBreakBefore ─────────────────────────
// La preparación (docDef con id='row_N' y el `pageBreakBefore` que anota la
// página de cada fila) es del núcleo puro (`prepararHojasExactas`): la misma
// que usa el teléfono. Acá sólo se maqueta con pdfmake.
// Resultado: grupos EXACTOS que coinciden 100% con el PDF impreso.
export async function getExactPageGroups(sucId, rawItems) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);
    const captura = prepararHojasExactas(sucId, rawItems, logo, addrMap);
    if (!captura) return [];
    // getBuffer() retorna una Promise (no usa callback en v0.3.11)
    const pdfMake = await getPdfMake();
    await pdfMake.createPdf(captura.docDef).getBuffer();
    return captura.grupos() ?? getPageGroups(rawItems); // fallback
}

// ── Public API ────────────────────────────────────────────────────────────────

// `toDispatch` y las conversiones de lotes viven en `papelDePedido` (sin
// pdfmake: el teléfono las usa para reimprimir la misma hoja).
export { toDispatch, lotesToDispatch, lotesAsignadosToDispatch } from './papelDePedido';


// Un PDF individual por sucursal, nombrado con el código del pedido.
// Descarga simultánea: todos los blobs se construyen en paralelo y se
// disparan con 150ms de intervalo (invisible para el usuario pero evita
// que el navegador bloquee descargas simultáneas).
export async function printPerSucursal(grouped, sortedSucIds, getAdjusted, codigoFn, meta = {}) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);

    const pdfs = sortedSucIds.map(sucId => seccionDeGenerar(grouped, sucId, getAdjusted, codigoFn ? codigoFn(sucId) : null));

    pdfs.forEach(({ section, filename }, idx) => {
        setTimeout(() => {
            const docDef = buildDocDefinition([section], section.codigo ?? section.nombre, meta, logo, addrMap);
            // dentro de setTimeout no hay a quién propagarle el rechazo
            downloadPdf(docDef, filename).catch(err => console.error('[pedidoPrint] descarga falló:', err));
        }, idx * 150);
    });
}


export async function printFromPedidoItems(pedidoNumero, sucGroups, meta = {}, titleOverride = null) {
    const [logo, addrMap] = await Promise.all([getLogoBase64(), getAddressMap()]);
    const ds = dateSuffix();

    // El contenido de cada sala es el del núcleo (`seccionDePedido`): la
    // misma hoja que reimprime el teléfono.
    const sections = sucGroups.map(([sucId, rows]) =>
        seccionDePedido(sucId, rows, sucGroups.length === 1 ? (titleOverride ?? null) : null,
            { cantidad: meta?.cantidad }));

    const title = titleOverride
        ?? (sucGroups.length === 1
            ? `Pedido_${(ERP_NAMES_DEFAULT[sucGroups[0][0]] ?? `Sucursal_${sucGroups[0][0]}`).replace(/ /g, '_')}_${ds}`
            : `Pedido_${String(pedidoNumero).padStart(3,'0')}_${ds}`);
    const filename = `${title.replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`;
    await downloadPdf(buildDocDefinition(sections, title, meta, logo, addrMap), filename);
}
