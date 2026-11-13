// ── El sello de Hacienda de una compra: número Y proveedor (2026-10-24) ─────
//
// El libro de compras del origen trae, por renglón, el número del documento
// (col 3), el NIT del emisor (col 4) y el sello de recepción (col 22). La guarda
// vieja cruzaba la compra con el libro SÓLO por número, y el origen repite el
// número en compras de proveedores DISTINTOS: la compra 6186 (ANA FRANCISCA
// CEDILLOS) y la 6188 (C. IMBERTON), 5-oct, llevan las dos
// `32CBC8C1-E72B-4EE5-` —el número viene truncado a 20— y un solo sello se les
// pegó a las dos. Lo mismo el sello de la 5249 (LETERAGO) en la 5250 (COFARSAL),
// 21-jul.
//
// Un sello identifica UN documento de UN emisor. Así que el renglón del libro
// sólo vale para la compra si coinciden el número Y el emisor (NIT o NRC del
// proveedor de la compra). Si no hay forma de decir de quién es, no se asigna:
// queda para revisión con su motivo. Un sello equivocado es peor que ninguno
// —el día que se use para cruzar documentos, cruzaría mal en silencio—.
//
// Pura a propósito: la prueba (`tests/unit/selloDeCompra.test.js`) la corre sin
// red, y la función del borde sólo le pasa lo que bajó.

export type LineaDelLibro = { numero: string; emisor: string; sello: string };

export type CompraParaSellar = {
  id: number;
  numero: string;
  /** Proveedor de la compra (para ver si el mismo documento está dos veces). */
  proveedor: number | string | null;
  /** NIT y NRC del proveedor, en cualquier formato: se comparan sólo dígitos. */
  identificaciones: Array<string | null | undefined>;
};

export type MotivoDeRevision =
  | 'proveedor-sin-nit'
  | 'emisor-no-coincide'
  | 'varios-sellos'
  | 'sello-en-varios-documentos'
  | 'documento-repetido'
  | 'sello-mal-formado';

export type SelloDecidido = { sello: string | null; revisar: MotivoDeRevision | null };

/** El número viene con espacios distintos en cada fuente (ver fastBackfill). */
export const normNum = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();
export const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/[^0-9]/g, '');

/** El sello de Hacienda son exactamente 40 caracteres alfanuméricos (H19). */
export function selloValido(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[0-9A-Za-z]{40}$/.test(s) ? s : null;
}

// ── ¿El archivo que bajó ES el libro? (2026-10-28) ───────────────────────────
//
// El origen escribe todos sus CSV en UN archivo temporal de ruta fija
// (`csv/libro_compras.csv`). Dos pedidos a la vez chocan, y uno recibe —con
// HTTP 200— los avisos de PHP en vez del archivo:
//
//   Warning: fopen(csv/libro_compras.csv): failed to open stream: File exists …
//
// Medido: 1 de 21 sondas en paralelo (LIBROS-IVA-FORMATO-Y-HALLAZGOS §TRAMPA).
// Ni el `r.ok` ni el parseo lo atrapan: el parser descarta esas líneas y
// devuelve CERO renglones, y con cero renglones `sellosDeLasCompras` contesta
// «no está en el libro» → `sello_recibido: null` en TODAS las compras de la
// ventana. O sea que el backfill semanal borraría sellos fiscales buenos sin
// un solo error.
//
// Dos preguntas, y alcanza con que una falle para no escribir:
//   1. ¿Trae un aviso del servidor? Un libro de verdad nunca lo trae.
//   2. ¿Vino vacío habiendo compras en la ventana? No hay ventana con compras
//      cuyo libro esté vacío: el libro las lista con o sin sello.
// La segunda NO se aplica al anexo de retención, que hoy sale vacío en toda
// la historia (`esperaRenglones: false`).
const AVISO_DEL_SERVIDOR = /failed to open stream|^\s*(?:<br\s*\/?>\s*)?(?:<b>)?\s*(?:Warning|Fatal error|Parse error|Notice)(?:<\/b>)?\s*:/im;

/** null si el archivo sirve; si no, el motivo para no escribir nada con él. */
export function motivoParaRechazarElLibro(
  csv: string, documentosEnLaVentana: number, renglones: number, esperaRenglones = true,
): string | null {
  if (AVISO_DEL_SERVIDOR.test(csv)) return 'el archivo trae un aviso del servidor en vez del libro';
  if (esperaRenglones && documentosEnLaVentana > 0 && renglones === 0)
    return `el libro vino sin renglones para ${documentosEnLaVentana} compra(s) de la ventana`;
  return null;
}

/** Los renglones del CSV del libro, con número normalizado y emisor en dígitos. */
export function lineasDelLibro(csv: string, colNumero = 3, colEmisor = 4, colSello = 22): LineaDelLibro[] {
  const out: LineaDelLibro[] = [];
  for (const linea of csv.split('\n')) {
    if (!linea.trim()) continue;
    const c = linea.split(';');
    if (c.length <= Math.max(colNumero, colEmisor, colSello)) continue;
    const numero = normNum(c[colNumero]);
    if (!numero) continue;
    out.push({ numero, emisor: soloDigitos(c[colEmisor]), sello: (c[colSello] ?? '').trim() });
  }
  return out;
}

/**
 * Decide el sello de cada compra. Devuelve id → { sello, revisar }.
 *
 * `revisar` es null cuando no hay nada que mirar (la compra no está en el
 * libro, o está sin sello). Con motivo, el sello queda en null y la compra va
 * a revisión: nunca se elige uno.
 */
export function sellosDeLasCompras(
  compras: CompraParaSellar[],
  lineas: LineaDelLibro[],
): Map<number, SelloDecidido> {
  const porNumero = new Map<string, LineaDelLibro[]>();
  // Un sello bajo más de un documento (número + emisor) no se sabe de cuál es.
  const documentosPorSello = new Map<string, Set<string>>();
  for (const l of lineas) {
    if (!porNumero.has(l.numero)) porNumero.set(l.numero, []);
    porNumero.get(l.numero)!.push(l);
    if (!l.sello || l.sello === '0') continue;
    if (!documentosPorSello.has(l.sello)) documentosPorSello.set(l.sello, new Set());
    documentosPorSello.get(l.sello)!.add(`${l.numero}|${l.emisor}`);
  }

  // El mismo número del mismo proveedor en dos compras: el libro no distingue
  // cuál de las dos es la del sello.
  const comprasPorDocumento = new Map<string, number>();
  for (const c of compras) {
    const k = `${normNum(c.numero)}|${c.proveedor ?? ''}`;
    comprasPorDocumento.set(k, (comprasPorDocumento.get(k) ?? 0) + 1);
  }

  const out = new Map<number, SelloDecidido>();
  const revisar = (id: number, motivo: MotivoDeRevision) => out.set(id, { sello: null, revisar: motivo });

  for (const c of compras) {
    const n = normNum(c.numero);
    const delNumero = n ? (porNumero.get(n) ?? []) : [];
    // Sin renglón en el libro, o con renglones sin sello: no hay nada que decidir.
    if (!delNumero.some((l) => l.sello && l.sello !== '0')) { out.set(c.id, { sello: null, revisar: null }); continue; }

    const ids = new Set(c.identificaciones.map(soloDigitos).filter(Boolean));
    if (ids.size === 0) { revisar(c.id, 'proveedor-sin-nit'); continue; }

    const suyas = delNumero.filter((l) => ids.has(l.emisor));
    if (suyas.length === 0) { revisar(c.id, 'emisor-no-coincide'); continue; }

    // Distintos INCLUIDO el vacío: un renglón con sello y otro sin él del mismo
    // documento tampoco dicen cuál vale.
    const sellos = new Set(suyas.map((l) => (l.sello === '0' ? '' : l.sello)));
    if (sellos.size > 1) { revisar(c.id, 'varios-sellos'); continue; }
    const crudo = [...sellos][0];
    if (!crudo) { out.set(c.id, { sello: null, revisar: null }); continue; }

    const sello = selloValido(crudo);
    if (!sello) { revisar(c.id, 'sello-mal-formado'); continue; }
    if ((documentosPorSello.get(crudo)?.size ?? 0) > 1) { revisar(c.id, 'sello-en-varios-documentos'); continue; }
    if ((comprasPorDocumento.get(`${n}|${c.proveedor ?? ''}`) ?? 0) > 1) { revisar(c.id, 'documento-repetido'); continue; }

    out.set(c.id, { sello, revisar: null });
  }
  return out;
}

// ── El sello impreso en el PDF (2026-11-13) ──────────────────────────────────
//
// Hay proveedores que mandan el JSON del DTE SIN el sello de recepción y sólo
// lo imprimen en la representación gráfica. Guardado los manda todos así
// (ago–nov 2026: 22 de 23 sin sello en la base), y también Santa Lucía,
// Interamericana y otros. Sin sello, `cargar-compra-erp` no deja cargar la
// compra («se podrá cargar cuando llegue») — y por el JSON no iba a llegar
// nunca. El papel lo trae: «SELLO DE RECEPCIÓN 2026…LNMF».
//
// El sello de Hacienda empieza por el año de recepción y son 40 caracteres
// alfanuméricos (`selloValido`). En el texto que devuelve unpdf la etiqueta y
// el valor no siempre quedan juntos (en el PDF de Guardado las etiquetas son
// una columna y los valores otra), así que no se busca «lo que sigue a la
// etiqueta» sino los tokens con forma de sello en TODO el texto:
//
//   · uno solo distinto → ése;
//   · varios → el más cercano a la etiqueta «sello de recepción», y si no hay
//     etiqueta, ninguno (un sello equivocado es peor que ninguno: ver arriba).
//
// El token se exige AISLADO — sin letra ni dígito pegado a los costados —
// para que un pedazo de una cadena más larga (la firma, un hash del QR) no
// pase por sello. Y el año tiene que estar a ±1 del de emisión cuando se
// conoce: una factura emitida en diciembre se recibe a veces en enero.
const SELLO_EN_TEXTO_RE = /(?<![0-9A-Za-z])(20\d{2}[0-9A-Z]{36})(?![0-9A-Za-z])/g;
const ETIQUETA_SELLO_RE = /sello\s*(?:de\s*)?recepci[oó]n/gi;

export type SelloDelPdf = { sello: string | null; motivo: 'uno' | 'junto-a-la-etiqueta' | 'sin-sello' | 'varios-sin-etiqueta' };

export function selloEnTextoDelPdf(texto: string | null | undefined, anioEmision?: number | null): SelloDelPdf {
  const t = texto ?? '';
  const encontrados: { sello: string; pos: number }[] = [];
  for (const m of t.matchAll(SELLO_EN_TEXTO_RE)) {
    const anio = Number(m[1].slice(0, 4));
    if (anioEmision && Math.abs(anio - anioEmision) > 1) continue;
    encontrados.push({ sello: m[1], pos: m.index ?? 0 });
  }
  const distintos = [...new Set(encontrados.map(e => e.sello))];
  if (distintos.length === 0) return { sello: null, motivo: 'sin-sello' };
  if (distintos.length === 1) return { sello: distintos[0], motivo: 'uno' };

  const etiquetas = [...t.matchAll(ETIQUETA_SELLO_RE)].map(m => (m.index ?? 0) + m[0].length);
  if (etiquetas.length === 0) return { sello: null, motivo: 'varios-sin-etiqueta' };
  let mejor: { sello: string; dist: number } | null = null;
  let empate = false;
  for (const e of encontrados) {
    const dist = Math.min(...etiquetas.map(p => Math.abs(e.pos - p)));
    if (!mejor || dist < mejor.dist) { mejor = { sello: e.sello, dist }; empate = false; }
    else if (dist === mejor.dist && e.sello !== mejor.sello) empate = true;
  }
  if (!mejor || empate) return { sello: null, motivo: 'varios-sin-etiqueta' };
  return { sello: mejor.sello, motivo: 'junto-a-la-etiqueta' };
}
