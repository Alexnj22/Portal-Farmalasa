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
