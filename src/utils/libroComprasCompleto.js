import { fechaNumerica } from './fecha';

/**
 * Libro de compras completo — los totales de las dos preguntas que contesta:
 * qué compró la farmacia de verdad (`totalesDelLibro`) y qué de eso puede
 * reclamarse como crédito fiscal (`totalesDeclarable`). Vivía en
 * `LibroComprasCompletoView`; se mudó el 2026-10-05 para que la app sume igual.
 */

/** Las filas de la pestaña: «Sin registrar» son las que no quedaron como compra. */
export const filasDeLaPestana = (filas, pestana) =>
    (pestana === 'sin_compra' ? (filas || []).filter((r) => r.origen !== 'registrada') : (filas || []));

export function totalesDelLibro(filas) {
    const acc = { docs: 0, credito: 0, total: 0, sinCompra: 0, creditoSinCompra: 0 };
    for (const r of filas || []) {
        acc.docs++;
        acc.credito += Number(r.credito_fiscal || 0);
        acc.total += Number(r.total || 0);
        if (r.origen !== 'registrada') {
            acc.sinCompra++;
            acc.creditoSinCompra += Number(r.credito_fiscal || 0);
        }
    }
    return acc;
}

/**
 * Los totales del libro declarable. Un documento que aparece N veces en el
 * libro (`veces_en_el_libro`) cuenta 1/N por renglón, y su crédito repetido es
 * el (N−1)/N de cada renglón. Lo que «falta confirmar» del proveedor es crédito
 * TRABADO: el IVA que trae el total (total − total/1.13).
 */
export function totalesDeclarable(filas) {
    const acc = { docs: 0, credito: 0, sinCuenta: 0, trabado: 0, motivos: new Map(), repRenglones: 0, repDocs: 0, repCredito: 0 };
    for (const r of filas || []) {
        acc.docs++;
        acc.credito += Number(r.credito_fiscal || 0);
        const veces = Number(r.veces_en_el_libro || 1);
        if (veces > 1) {
            acc.repRenglones++;
            acc.repDocs += 1 / veces;
            acc.repCredito += Number(r.credito_fiscal || 0) * (veces - 1) / veces;
        }
        if (r.computa_credito) continue;
        acc.sinCuenta++;
        acc.motivos.set(r.motivo, (acc.motivos.get(r.motivo) || 0) + 1);
        if (String(r.motivo || '').startsWith('Falta confirmar')) {
            const t = Math.abs(Number(r.total || 0));
            acc.trabado += t - t / 1.13;
        }
    }
    return acc;
}

/* ── El archivo que se descarga (mudado el 2026-10-06 para que la app comparta
 *    el MISMO CSV que el portal) ─────────────────────────────────────────── */
const num = (n) => (Number(n) || 0).toFixed(2);
// Vacío ≠ 0.00: NULL significa "no sabemos si hubo percepción", y escribir cero
// sería afirmar que no la hubo. Misma regla que en el libro de compras.
const numOpcional = (n) => (n == null ? '' : num(n));
const fecha = (iso) => fechaNumerica(iso, { vacio: '' });

/**
 * El CSV del libro completo: el documento COMPLETO —no el cortado a 20— y
 * percepción/retención vacías cuando no se sabe. `nombreSucursal(id)` lo pone
 * quien llama.
 */
export function csvDelLibroCompleto(filas, totales, nombreSucursal, mes) {
    return {
        archivo: `libro-compras-completo_${mes}`,
        headers: ['FECHA', 'REGISTRO', 'SUCURSAL', 'TIPO', 'DOCUMENTO', 'NRC', 'NIT', 'PROVEEDOR',
            'EXENTAS', 'GRAVADAS', 'CREDITO FISCAL', 'TOTAL', 'PERCEPCION', 'RETENCION', 'ANULADA'],
        rows: [
            ...(filas || []).map(r => [
                fecha(r.fecha), r.origen === 'registrada' ? 'Registrada' : 'Sin registrar', nombreSucursal(r.branch_id),
                r.documento_tipo || '', r.documento_completo || '', r.nrc || '', r.nit || '', r.proveedor || '',
                num(r.compras_exentas), num(r.compras_gravadas), num(r.credito_fiscal), num(r.total),
                numOpcional(r.percepcion_iva), numOpcional(r.retencion_iva), r.anulada ? 'SI' : '',
            ]),
            ['TOTALES', '', '', '', '', '', '', '', '', '', num(totales.credito), num(totales.total), '', '', ''],
        ],
    };
}

/**
 * El CSV del declarable: SUS columnas, con el motivo —lo único que explica por
 * qué una fila suma cero— y «REPETIDO», que en el archivo es donde se ve.
 */
export function csvDelDeclarable(filas, totDecl, mes) {
    return {
        archivo: `libro-compras-declarable_${mes}`,
        headers: ['FECHA', 'TIPO', 'DOCUMENTO', 'NRC', 'NIT', 'PROVEEDOR',
            'GRAVADAS', 'CREDITO FISCAL', 'TOTAL', 'CUENTA', 'REPETIDO', 'MOTIVO', 'CLASIFICACION'],
        rows: [
            ...(filas || []).map(r => [
                fecha(r.fecha), r.documento_tipo || '', r.documento_completo || '', r.nrc || '', r.nit || '', r.proveedor || '',
                num(r.compras_gravadas), num(r.credito_fiscal), num(r.total), r.computa_credito ? 'SI' : 'NO',
                Number(r.veces_en_el_libro || 1) > 1 ? `SI x${r.veces_en_el_libro}` : '', r.motivo || '', r.clasificacion || '',
            ]),
            ['TOTALES', '', '', '', '', '', '', num(totDecl.credito), '', '', '', '', ''],
        ],
    };
}
