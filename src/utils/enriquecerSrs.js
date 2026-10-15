/**
 * «Enriquecer SRS» — ponerle principio activo a los productos que no lo tienen,
 * buscándolos en el registro sanitario. La cuenta (cómo se busca, cuánto se
 * parece un resultado, qué principios trae) vivía dentro de
 * `components/srs/SrsEnriquecerModal.jsx`; se mudó el 2026-10-15 para que la
 * app haga el MISMO recorrido. Las lecturas y escrituras están en `data/srs.js`.
 */

export const SRS_CONCURRENCIA   = 5;
export const SRS_LOTE           = 300;   // productos por corrida
export const SRS_PAUSA_MS       = 80;    // entre lanzamientos (para no saturar al intermediario)
export const SRS_AUTO_MIN       = 0.70;  // desde acá se aplica sin revisar
export const SRS_REVISION_MIN   = 0;     // todo lo que tenga resultado va a revisión
export const SRS_CANDIDATOS     = 3;     // candidatos por tarjeta de revisión

const SKIP_TOKENS = new Set([
    // Unidades de dosis
    'MG', 'ML', 'MCG', 'UG', 'G', 'UI', 'IU', 'GR', 'MEQ',
    // Preposiciones / artículos
    'X', 'CX', 'DE', 'Y', 'CON', 'POR', 'EL', 'LA', 'LOS', 'LAS', 'AL',
    // Laboratorios / marcas
    'MK', 'SAIMED', 'MEGALAB', 'GENFAR', 'LAFRANCOL', 'PFIZER', 'NOVARTIS',
    'ROCHE', 'BAYER', 'MERCK', 'SYNTOFARMA', 'ROEMMERS', 'SIEGFRIED', 'LIOMONT',
    'DENMARK', 'PISA',
    // Modificadores
    'ULTRA', 'FORTE', 'PLUS', 'MAX', 'MINI',
    // Formas y descriptores: no identifican, sólo inflan la unión
    'TAB', 'TABS', 'CAP', 'CAPS', 'COMP', 'AMP', 'INY', 'SOL', 'SUS', 'JAR', 'GTS', 'SUSP',
    'TABLETA', 'TABLETAS', 'CAPSULA', 'CAPSULAS', 'COMPRIMIDO', 'COMPRIMIDOS',
    'AMPOLLA', 'AMPOLLAS', 'INYECTABLE', 'SOLUCION', 'SUSPENSION', 'JARABE',
    'GOTAS', 'CREMA', 'UNGUENTO', 'OVULO', 'OVULOS', 'SUPOSITORIO', 'SUPOSITORIOS',
    'BLANDA', 'BLANDAS', 'DURA', 'DURAS', 'GELATINA', 'RECUBIERTA', 'RECUBIERTO',
    'MASTICABLE', 'EFERVESCENTE', 'SUBLINGUAL', 'RETARD', 'LIBERACION',
    // Empaques
    'CAJA', 'FRASCO', 'BLISTER', 'BLIS', 'VIAL', 'VIALES', 'SOBRE', 'SOBRES',
    'TUBO', 'TUBOS', 'SACHET', 'SACHETS', 'ENVASE', 'POMO', 'UNIDAD', 'UNIDADES',
]);

const CORP_WORDS = new Set([
    'LABORATORIO', 'LABORATORIOS', 'FARMACEUTICA', 'FARMACEUTICOS', 'FARMACEUTICO',
    'INDUSTRIA', 'INDUSTRIAS', 'PRODUCTOS', 'COMERCIAL', 'INTERNACIONAL',
    'SA', 'SL', 'SRL', 'SAS', 'CIA', 'CO', 'CV', 'NV', 'INC', 'LTD', 'LLC', 'CORP',
    'DE', 'LA', 'EL', 'LOS', 'Y', 'DEL',
]);

function normalizar(str = '') {
    return String(str)
        .toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/(\d+)([A-Z]+)/g, '$1 $2')   // «500MG» → «500 MG»
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function fichas(str) {
    // Sin los «X NNN» de cantidad: «X 30 TAB» no debe castigar el parecido.
    const limpio = normalizar(str).replace(/\bX\s*\d+\b/g, ' ');
    return limpio.split(' ').filter((t) => t.length >= 2 && !SKIP_TOKENS.has(t));
}

/** La palabra corta que identifica al laboratorio («Laboratorios MK S.A.» → «MK»). */
function fichaDeLab(labNombre = '') {
    if (!labNombre) return '';
    return normalizar(labNombre).split(' ')
        .find((w) => w.length >= 2 && w.length <= 12 && !CORP_WORDS.has(w) && !/^\d+$/.test(w)) || '';
}

/**
 * Hasta tres búsquedas, de la más precisa a la más suelta: fármaco + dosis +
 * laboratorio, fármaco + dosis, y las dos fichas cortas pegadas («ACI TIP» →
 * «ACITIP», que encuentra «ACI-TIP»). Sin repetidas.
 */
export function busquedasSrsDe(producto) {
    const t = fichas(producto?.nombre ?? '');
    const lab = fichaDeLab(producto?.laboratorios?.nombre);
    const salida = [];
    if (t.length && lab) salida.push([...t.slice(0, 4), lab].join(' '));
    if (t.length) salida.push(t.slice(0, 4).join(' '));
    const marca = t.filter((x) => !/^\d+$/.test(x)).slice(0, 2);
    if (marca.length === 2 && marca.every((x) => x.length <= 6)) salida.push(marca.join(''));
    return [...new Set(salida.filter((q) => q.trim()))];
}

/** Cuánto se parece un nombre del catálogo a uno del SRS (0–1, Jaccard con premio por dosis). */
export function parecidoSrs(nombreCatalogo, nombreSrs) {
    const a = new Set(fichas(nombreCatalogo));
    const b = new Set(fichas(nombreSrs));
    if (a.size === 0 || b.size === 0) return 0;
    const inter = [...a].filter((t) => b.has(t)).length;
    const union = new Set([...a, ...b]).size;
    let s = inter / union;
    const aNums = [...a].filter((t) => /^\d+$/.test(t));
    const bNums = new Set([...b].filter((t) => /^\d+$/.test(t)));
    if (aNums.length > 0 && aNums.every((n) => bNums.has(n))) s = Math.min(1, s * 1.3);
    return s;
}

/** Los principios que trae un resultado del SRS («A + B», «500 mg + 125 mg»). */
export function principiosDeSrs(srs) {
    const pa = String(srs?.principio_activo || '').trim();
    const conc = String(srs?.concentracion || '').trim();
    if (!pa) return [];
    const nombres = pa.split(/\s*\+\s*/).map((s) => s.trim()).filter(Boolean);
    const concs = conc.split(/\s*\+\s*/).map((s) => s.trim()).filter(Boolean);
    return nombres.map((nombre, i) => ({ nombre, concentracion: concs[i] || '', orden: i }));
}

/** «Amoxicilina 500mg, Ácido clavulánico 125mg». */
export function textoDePrincipios(principios) {
    return (principios || []).map((p) => [p.nombre, p.concentracion].filter(Boolean).join(' ')).join(', ');
}

/**
 * De los resultados del SRS para un producto: los mejores candidatos y qué
 * hacer. `{ tipo: 'auto' | 'revisar' | 'sin', entrada }` — `entrada` =
 * `{ product, srs, score, principios, candidates }`.
 */
export function decidirSrs(producto, resultados) {
    const candidatos = (resultados || [])
        .map((r) => ({ srs: r, score: parecidoSrs(producto.nombre, r.nombre_comercial || r.nombreComercial || '') }))
        .filter((r) => r.score >= SRS_REVISION_MIN)
        .sort((a, b) => b.score - a.score)
        .slice(0, SRS_CANDIDATOS);
    const mejor = candidatos[0];
    if (!mejor) return { tipo: 'sin', entrada: null };
    const entrada = { product: producto, srs: mejor.srs, score: mejor.score, principios: principiosDeSrs(mejor.srs), candidates: candidatos };
    return { tipo: mejor.score >= SRS_AUTO_MIN ? 'auto' : 'revisar', entrada };
}
