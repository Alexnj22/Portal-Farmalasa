/**
 * Las reglas de una propuesta de MIN·MAX — las mismas que vigila la base.
 *
 * Viven en su propio archivo por dos motivos. El chico: exportarlas desde
 * `WidgetMinMaxRequest.jsx`, que exporta componentes, rompe el recargado en
 * caliente y el lint lo marca. El grande: son la MITAD de una regla que también
 * está escrita en Postgres —`mmcr_pair_valid` y `mmcr_reason_required`—, y una
 * regla partida en dos idiomas se separa sola si nadie la puede ver junta ni
 * probar aparte. `tests/unit/minmaxSolicitud.test.js` corre exactamente los
 * mismos casos que se corrieron contra la tabla real antes de aplicarla.
 */

/**
 * El par válido: o el MIN es 0 y el MAX no pasa de 1 —el producto retirado, o el
 * «traelo sólo si lo piden»— o el MIN es al menos 1 y el MAX lo supera.
 *
 * Es `mmcr_pair_valid` al pie de la letra. La pantalla pedía `MAX > MIN` a
 * secas, que es MÁS estricto que la base: dejaba fuera el 0 · 0 que la tabla sí
 * acepta, así que retirar un producto era imposible desde el widget y se
 * terminaba pidiendo 0 · 1 —que no es lo mismo: manda a comprar una unidad—.
 * Reportado el 2026-08-13.
 */
export function parMinMaxValido(min, max) {
    if (min == null || max == null || Number.isNaN(min) || Number.isNaN(max)) return false;
    return min === 0 ? max >= 0 && max <= 1 : min >= 1 && max > min;
}

/**
 * Para la reposición, «—» y «0» son el MISMO número.
 *
 * El pedido entra por `minmax_eff_max(...) > 0` (`get_pedido_preview`), y esa
 * función coalesce los NULL a 0: un producto sin par publicado y uno publicado
 * en 0 · 0 son indistinguibles ahí. La pantalla los dibuja distinto —«—» contra
 * «0»— y eso hizo creer que pasar de uno al otro era un ajuste.
 */
const comoNumero = (v) => v ?? 0;

/**
 * ¿Este ajuste deja la sala exactamente como está?
 *
 * Reportado el 2026-08-14: de las 5 propuestas pendientes de Salud 2, CUATRO
 * pedían 0 · 0 sobre un producto que ya no se reponía —tres de ellas desde
 * «— · —»—. Ninguna cambiaba nada, todas gastaban la atención de quien aprueba,
 * y la del producto oculto ni siquiera se podía aprobar.
 *
 * Es la mitad en el navegador de `mmcr_solicitud_con_efecto` (migración
 * 20260814142852), con una diferencia deliberada: acá se compara contra el par
 * que el formulario tiene a la vista, y allá contra el que está guardado. Si
 * los dos no coinciden —formulario viejo—, manda el de la base.
 */
export function ajusteSinCambio(actual, pedidoMin, pedidoMax) {
    if (!parMinMaxValido(pedidoMin, pedidoMax)) return false;
    return comoNumero(actual?.min) === pedidoMin && comoNumero(actual?.max) === pedidoMax;
}

/** Cuántas veces más grande. Un decimal alcanza: «7.1×» ya dice todo. */
const veces = (pedido, hoy) => (pedido / hoy).toLocaleString('es-SV', { maximumFractionDigits: 1 });

/** Un salto de este tamaño ya no se explica solo. */
export const SALTO_QUE_EXIGE_MOTIVO = 3;

/**
 * Por qué ESTE ajuste no puede ir sin motivo. Devuelve la lista de razones,
 * lista para mostrar; vacía significa que el motivo es opcional.
 *
 * Las tres son la misma idea: el número propuesto no se entiende mirándolo.
 *
 *  1. **Cero.** Es la única propuesta que APAGA el producto —deja de entrar en
 *     los pedidos de esa sala— y no hay forma de deducir por qué desde el
 *     número. Quien lo apruebe necesita leerlo.
 *  2. **Triplicar.** Pasar de 24 a 150 mueve plata de verdad en inventario, y el
 *     historial de ventas que la pantalla muestra al lado casi nunca lo
 *     respalda solo: las cuatro propuestas que hay en la tabla lo dicen en el
 *     motivo («por más rotación», «cliente disminuyó compra»).
 *  3. **Empezar de cero.** Si hoy no hay MIN·MAX, cualquier número es un
 *     estreno: no hay contra qué compararlo, así que el motivo ES la
 *     justificación entera. Incluye el caso «todavía no tiene parámetros en
 *     esta sucursal», donde `actual` viene en null.
 *
 * Bajar un número NO exige motivo por sí solo: la mitad de la razón de esta
 * pantalla es corregir un máximo inflado, y cobrarle un texto a cada corrección
 * hacia abajo es cobrarle a lo que uno quiere que pase. El 0 · 0 es la
 * excepción, y es excepción porque apaga, no porque baje.
 *
 * @param {{min: number|null, max: number|null}|null} actual  el MIN·MAX de hoy
 * @param {number|null} pedidoMin
 * @param {number|null} pedidoMax
 */
export function motivosQueExigenExplicacion(actual, pedidoMin, pedidoMax) {
    if (!parMinMaxValido(pedidoMin, pedidoMax)) return [];
    if (pedidoMin === 0 && pedidoMax === 0) {
        return ['Se deja en cero: el producto deja de reponerse.'];
    }
    if (actual?.min == null || actual?.max == null) {
        return ['El producto todavía no tiene MIN y MAX en esta sucursal.'];
    }
    const motivos = [];
    for (const [rotulo, hoy, pedido] of [['MIN', actual.min, pedidoMin], ['MAX', actual.max, pedidoMax]]) {
        if (!pedido) continue;                        // dejar un lado en 0 no es un salto
        if (hoy === 0) motivos.push(`El ${rotulo} de hoy es 0 y se propone ${pedido}.`);
        else if (pedido >= hoy * SALTO_QUE_EXIGE_MOTIVO) {
            motivos.push(`El ${rotulo} propuesto (${pedido}) es ${veces(pedido, hoy)}× el de hoy (${hoy}).`);
        }
    }
    return motivos;
}
