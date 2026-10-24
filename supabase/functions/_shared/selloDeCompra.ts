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
