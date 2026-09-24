/**
 * La unidad en la que un producto viaja entre Bodega y las salas, y lo que se
 * deriva de ella. La regla vive en la base (`unidad_de_despacho`, espejo de
 * `unit_base` de los pedidos); acá sólo la aritmética, para que la lista de
 * productos sin venta y el formulario de envío digan lo mismo.
 *
 * `u` = { tipo, etiqueta, factor, multiplo, unidades } — `unidades` es
 * `factor × multiplo`: cuántas unidades sueltas forman una unidad de despacho.
 */

/** Cómo se nombra: «CAJA X 10», «5 BLISTER X 10», o la etiqueta de la regla
 *  con sus unidades («CAJA de 12»). */
export function nombreDeDespacho(u) {
    if (!u) return '';
    const factor = Number(u.factor) || 1, multiplo = Number(u.multiplo) || 1;
    if (u.etiqueta && u.etiqueta !== u.tipo) return `${u.etiqueta} de ${Number(u.unidades)}`;
    return `${multiplo > 1 ? `${multiplo} ` : ''}${u.tipo}${factor > 1 ? ` X ${factor}` : ''}`;
}

/**
 * Lo que se puede devolver a Bodega: sólo unidades de despacho COMPLETAS
 * (usuario, 2026-09-24: «a Bodega no se pueden enviar productos en unidades»).
 * `cantidad` va en la presentación de la regla, lista para el envío.
 */
export function paraBodega(existencia, u) {
    const total = Math.max(0, Math.floor(Number(existencia) || 0));
    const porUnidad = Math.max(1, Number(u?.unidades) || 1);
    const completos = Math.floor(total / porUnidad);
    return {
        completos,
        cantidad: completos * (Number(u?.multiplo) || 1),
        viajan: completos * porUnidad,
        quedan: total - completos * porUnidad,
    };
}

/** A otra sala se puede mandar suelto, pero si no llega ni a una unidad de
 *  despacho conviene saberlo: 2 unidades de una caja de 100. */
export const esPocoParaMandar = (existencia, u) =>
    Number(u?.unidades) > 1 && Number(existencia) < Number(u.unidades);

/**
 * Si un renglón de envío respeta la regla: unidades múltiplo de la unidad de
 * despacho y en una presentación que no sea más chica que la de la regla
 * (se puede mandar en una más grande que la contenga, nunca suelto).
 */
export function renglonCompleto(renglon, u) {
    if (!u || Number(u.unidades) <= 1) return true;
    const unidades = (Number(renglon.cantidad) || 0) * (Number(renglon.factor) || 0);
    return unidades > 0 && unidades % Number(u.unidades) === 0 && Number(renglon.factor) >= Number(u.factor);
}
