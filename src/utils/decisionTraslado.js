/**
 * Las cuentas de CONTESTAR un traslado: cuánto puede salir de cada renglón, qué
 * se manda de verdad, si el envío quedó recortado y a quién más pedirle.
 *
 * Vivían privadas dentro de `DecisionTraslado` (views/traslados/
 * FilasTraslado.jsx) y se mudaron acá el 2026-09-30, cuando la app estrenó su
 * propia pantalla para contestar: escritas dos veces, la primera que cambiara
 * dejaría a una de las dos mandando una cantidad distinta sobre el mismo
 * pedido. Puras: no conocen ni React ni el navegador.
 */

/**
 * Cuántos PAQUETES de un renglón puede mandar hoy la sala de origen.
 *
 * Las dos escalas son la trampa: la disponibilidad viene en unidades BASE y lo
 * pedido en paquetes de la presentación. `factor` es lo que las une, y es la
 * MISMA cuenta que hace el despachador contra el reporte del sistema —acá es una
 * ayuda para que la casilla venga puesta, allá es la autoridad—.
 *
 * Nunca más de lo pedido: mandar de más no es mandar, es otro traslado.
 */
export function paquetesQueSalen(linea, item) {
    const factor  = Number(item?.factor) || 1;
    const pedidos = Number(item?.cantidad) || 0;
    const hay     = Math.floor(Number(linea?.unidades ?? 0) / factor);
    return Math.max(0, Math.min(pedidos, hay));
}

/** Cómo se llama un renglón. El nombre guardado manda; el número es el repuesto. */
export function nombreDeLinea(linea, items) {
    return linea?.descripcion
        ?? items?.[linea?.idx]?.descripcion
        ?? `#${linea?.erp_product_id ?? '?'}`;
}

/**
 * Lo que se manda, a partir de lo escrito en cada casilla (`cuantos`, por
 * índice y como texto). Devuelve las líneas aceptadas —`[{ i, cantidad }]`,
 * la forma que espera `despacharTraslado`— y si el envío quedó recortado.
 *
 * Recortado = falta un renglón o alguno sale con menos de lo pedido. Es lo que
 * obliga a escribir «por qué no sale todo».
 */
export function loQueSeManda(lineas = [], items = [], cuantos = {}) {
    const pedidoDe = (idx) => Number(items[idx]?.cantidad) || 0;
    const saleDe = (idx) => {
        const n = Math.floor(Number(cuantos[idx]));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const aceptadas = lineas
        .map(l => ({ i: l.idx, cantidad: Math.min(saleDe(l.idx), pedidoDe(l.idx)) }))
        .filter(a => a.cantidad > 0);
    const hayQueMandar = aceptadas.length > 0;
    const recortado = hayQueMandar && (
        aceptadas.length < lineas.length || aceptadas.some(a => a.cantidad !== pedidoDe(a.i))
    );
    const nadaEnFisico = lineas.length > 0 && lineas.every(l => paquetesQueSalen(l, items[l.idx]) === 0);
    return { aceptadas, hayQueMandar, recortado, nadaEnFisico };
}

/**
 * A quién más pedirle, por renglón. El texto viaja en el aviso de rechazo:
 * quien pidió no tiene por qué volver a buscar dónde hay. Se arma con el dato
 * fresco que se acaba de mirar (`alternativas` de la disponibilidad).
 *
 * Con un solo renglón el nombre del producto ya está en la tarjeta y repetirlo
 * alarga la frase; con varios es lo único que distingue una sugerencia de otra.
 */
export function sugerenciaDeRechazo(lineas = [], items = []) {
    const conAlternativa = lineas.filter(l => (l.alternativas ?? []).length > 0);
    if (conAlternativa.length === 0) return '';
    return conAlternativa.map((l) => {
        const donde = l.alternativas.slice(0, 3).map(a => `${a.sala} (${a.unidades})`).join(', ');
        return lineas.length === 1 ? `Sí hay en ${donde}` : `${nombreDeLinea(l, items)}: ${donde}`;
    }).join(' · ');
}
