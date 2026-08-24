// Lo escrito sobre este módulo:
// `docs/PRODUCTOS-LA-PRESENTACION-Y-EL-FACTOR-2026-08-24.md` — por qué sumar
// `cantidad` sin convertir cambiaba el ORDEN de las salas, por qué el factor lo
// manda la base, y las dos maneras de pasar de unidades a presentaciones (una
// sugiere, la otra es un techo).
//
// Cuántas unidades hay de verdad en una fila de `inventory`.
//
// `cantidad` NO está en unidades: está en la presentación de esa fila. El mismo
// lote aparece varias veces —CAJA, BLISTER, UNIDAD— y cada una cuenta lo suyo.
// Verificado el 2026-08-07 sobre la amoxicilina 500: lote `L5M5137` en La
// Popular son 24 CAJA (1x30), 1 BLISTER (1x10) y 3 UNIDAD (1x1).
//
// Sumarlas sin convertir no sólo daba un número corto: **cambiaba el orden de
// las salas**. La Consulta de Inventario mostraba La Popular (46) por encima de
// Salud 1 (39) cuando Salud 1 tiene 1,034 unidades contra 836 — la pantalla que
// existe para decir «en qué sala hay» apuntaba a la equivocada.
//
// ── Por qué vive acá y no en el widget ────────────────────────────────────
// Porque lo necesitan DOS pantallas: la Consulta y el modal de pedir a otra
// sala, que ahora reparte lo pedido entre lotes. Escrito dos veces, la próxima
// corrección llegaría a una sola — que es literalmente lo que acababa de pasar
// con la presentación del lote, arreglada en la lista y olvidada en el detalle.

// ── El factor lo manda la base, y ya no se deduce acá (2026-08-18) ────────
//
// Hasta hoy este archivo lo leía de `detalle` y `v_inventario_disponible` lo
// leía del catálogo, así que la MISMA pantalla decía dos números distintos: la
// Consulta de Inventario mostraba «Bodega · 3 uds» de CLOPRIM X 3 AMPOLLAS y el
// formulario de pedirlo, abierto desde esa fila, decía «Bodega — 1 unidad». Y
// como la guarda del formulario y el trigger de la base leen ese 1, la caja no
// se podía pedir.
//
// El factor lo resuelve `factor_de_inventario` en la base —el catálogo dice qué
// factores son posibles para la etiqueta y `detalle` elige entre ellos— y viaja
// en la fila. Que dos fuentes coincidan es cuestión de suerte; que haya una
// sola, no.
//
// `detalle` sigue leyéndose SÓLO como respaldo, para las filas que llegan por
// un camino que todavía no manda `factor`. Medido sobre las 24,181 filas del
// inventario: 24,031 vienen en formato `1xN` limpio, 48 con un `1` pelado y 102
// con variantes de espaciado (`1 X 1`, `X 25`, `1X 16`) que este parse cubre
// porque normaliza los espacios antes de leer.
//
// Sin número después de la x el factor es 1 —una presentación suelta— y NUNCA
// 0: un 0 borraría la existencia en silencio, que es peor que contarla de menos.
const FACTOR_RE = /x\s*(\d+)\s*$/i;

export function factorDe(detalle) {
    const m = FACTOR_RE.exec(String(detalle ?? '').replace(/\s+/g, ' ').trim());
    const n = m ? parseInt(m[1], 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/** El factor de una fila: el que mandó la base, o el de `detalle` si no vino. */
export function factorDeFila(row) {
    const n = Number(row?.factor);
    return Number.isFinite(n) && n > 0 ? n : factorDe(row?.detalle);
}

export const unidadesDe = (row) => (Number(row?.cantidad) || 0) * factorDeFila(row);

export const sumaUnidades = (lots) => (lots || []).reduce((s, r) => s + unidadesDe(r), 0);

/**
 * Los lotes de una sala, sumados en unidades y ordenados por vencimiento.
 *
 * Un «lote» acá es la pareja número + fecha, no la fila: la misma pareja llega
 * partida en CAJA, BLISTER y UNIDAD y las tres son el mismo lote físico. La
 * identidad incluye la fecha a propósito — hay productos con dos lotes del
 * mismo número y vencimientos distintos, y son existencias separadas.
 *
 * Lo que vence primero va primero: es el orden en que hay que sacarlo.
 */
export function lotesEnUnidades(filas) {
    const m = new Map();
    for (const r of filas || []) {
        const clave = `${r.lote ?? ''}|${r.fecha_vencimiento ?? ''}`;
        if (!m.has(clave)) m.set(clave, {
            clave,
            lote:  r.lote || null,
            vence: r.fecha_vencimiento || null,
            unidades: 0,
        });
        m.get(clave).unidades += unidadesDe(r);
    }
    // Sin fecha va al final: no se puede prometer que salga primero algo cuyo
    // vencimiento no se conoce.
    return [...m.values()]
        .filter(l => l.unidades > 0)
        .sort((a, b) => String(a.vence ?? '9999-12-31').localeCompare(String(b.vence ?? '9999-12-31')));
}

/**
 * Reparte las unidades pedidas entre los lotes disponibles, el que vence
 * primero primero.
 *
 * Devuelve `{ reparto, faltan }`. `faltan` > 0 significa que con los lotes que
 * quedan no alcanza — y eso se DICE, no se reparte de más: un reparto que suma
 * menos de lo pedido sin avisar es la peor versión de este cálculo.
 */
export function repartirPedido(lotes, unidadesPedidas) {
    const reparto = [];
    let restan = Math.max(0, Number(unidadesPedidas) || 0);
    for (const l of lotes) {
        if (restan <= 0) break;
        const toma = Math.min(l.unidades, restan);
        if (toma <= 0) continue;
        reparto.push({ ...l, toma });
        restan -= toma;
    }
    return { reparto, faltan: restan };
}
