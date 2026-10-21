/**
 * «Otro» en un movimiento de caja: qué falta y dónde va (2026-10-21).
 *
 * Es el GEMELO de la parte de «Otro» de `caja_movimiento_regla`, y existe sólo
 * para avisar mientras se escribe: el que decide es el servidor. Las dos mitades
 * leen la MISMA lista (`caja_conceptos_de_otro_lado`), y sus patrones se
 * escriben para valer igual en JavaScript y en Postgres.
 *
 * Decisión del usuario: si el concepto es algo que tiene su propio tipo
 * —anticipos, Mapfre, remesas, un proveedor, una corrección— no se deja anotar
 * en «Otro»: se dice dónde va.
 */

/** Los tipos «Otro» del catálogo de la caja. */
export const TIPOS_OTRO = ['OTRO_ENTRADA', 'OTRO_SALIDA'];

/** Cuántas letras o números tiene que tener lo escrito en «Otro». */
export const MINIMO_DE_DETALLE = 10;

/** El texto como lo compara la lista: minúsculas y sin tildes. */
export function textoComparable(texto) {
    return String(texto ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

/** Lo que la persona escribió, sin el rótulo «Otro ·» adelante. */
function loEscrito(texto) {
    return textoComparable(texto).replace(/^\s*otro\s*([·:-]\s*)?/, '').trim();
}

/**
 * Si el texto de un «Otro» se anota en otro lado, devuelve el aviso; si no,
 * `null`. `lista` son las filas de `fetchConceptosDeOtroLado`.
 */
export function vaEnOtroLado(lista, sentido, texto) {
    const t = loEscrito(texto);
    if (!t) return null;
    for (const fila of lista || []) {
        if (fila.sentido !== sentido) continue;
        let re;
        try { re = new RegExp(fila.patron); } catch { continue; }
        if (re.test(t)) return `Esto no va en «Otro»: ${fila.va_en}.`;
    }
    return null;
}

/** `true` si lo escrito en «Otro» alcanza para saber de qué fue. */
export function detalleSuficiente(texto) {
    return loEscrito(texto).replace(/[^a-z0-9]/g, '').length >= MINIMO_DE_DETALLE;
}
