/**
 * Las cajas especiales de un despacho — una entrada por CAJA FÍSICA.
 *
 * Una caja especial es una **caja**, no una unidad. Un Electrolit ×12 marcado
 * como caja especial viaja como una caja: 24 botellas son **2** cajas
 * especiales, no 24. Y al sistema se le manda un traslado con las 24 unidades,
 * no 24 traslados de una — eso ya lo hace `planificar_traslado_pedido`, que
 * emite una línea por renglón con la cantidad completa.
 *
 * Antes esto se armaba con `Array.from({ length: cantidad_asignada })` en el
 * momento de finalizar, o sea **una etiqueta por unidad**. El pedido #114 (La
 * Popular, 14-ago-2026) salió con 60 etiquetas E1…E60 para 5 cajas reales, y la
 * pantalla de recepción —que armaba su propia lista, una por producto— decía 4.
 * Tres números distintos para lo mismo. De ahí que la construcción viva acá y
 * en un solo lugar: mientras cada pantalla la reconstruya a su manera, van a
 * volver a discrepar.
 *
 * El universo de `caja_especial` son dos familias, y la fórmula sirve a las dos:
 * andaderas, bastones y sillas tienen factor 1 —una unidad ES una caja, así que
 * nada cambia para ellas— y los diez sabores de Electrolit 625 ml tienen factor
 * 12.
 */

/**
 * Cuántas cajas físicas son las unidades asignadas de un renglón.
 *
 * `ceil` y no `round` porque una caja a medio llenar sigue siendo una caja que
 * alguien tiene que cargar y contar. Hoy no cambia ningún número —el múltiplo de
 * despacho obliga a cantidades exactas— pero el día que entre un parcial, `round`
 * lo desaparecería.
 */
export function cajasDeRenglon(r) {
    const unidades = r?.cantidad_asignada ?? 0;
    if (unidades <= 0) return 0;
    return Math.ceil(unidades / (Number(r?.dispatch_factor) || 1));
}

/**
 * La lista de cajas especiales de un despacho: `[{ label, pedido_item_id, … }]`,
 * numeradas E1, E2, E3… en orden de nombre de producto.
 *
 * El orden importa y por eso está fijado acá: la etiqueta es la **clave** con la
 * que después se marca una caja como dañada (`cajas_especiales_llegadas`), así
 * que si dos pantallas numeran distinto, marcar «E2 dañada» en una señala otra
 * caja en la otra.
 */
/**
 * Qué hay abierto en la pantalla de recepción: `'especial'` (una caja
 * especial), `'hoja'` (una hoja del despacho) o `'pedido'` (el despacho entero
 * — los viejos, que se armaron sin hojas).
 *
 * Existe porque cuatro sitios del modal lo preguntaban por su cuenta y tres lo
 * respondían mal: preguntaban sólo por el número de la unidad abierta, que
 * dentro de una caja especial vale `null`, y caían en «el pedido entero». En
 * pantalla eso listaba los productos de las otras unidades bajo el título de la
 * especial —visto en La Popular el 2026-08-14: «E3 — Caja especial» con tres
 * leches adentro— y el botón se ofrecía a «Confirmar Caja null». Peor: «Todo
 * OK» daba por recibido el pedido COMPLETO desde adentro de una caja de
 * Electrolit.
 *
 * Una caja especial es una unidad propia. Con la respuesta derivada en un solo
 * lugar no puede volver a haber tres respuestas distintas para la misma
 * pregunta.
 */
export function alcanceDeRecepcion({ especial = null, hoja = null, hayHojas = false } = {}) {
    if (especial != null) return 'especial';
    if (hayHojas && hoja != null) return 'hoja';
    return 'pedido';
}

/**
 * Los renglones con la cantidad que de verdad SALE, para contar cajas sobre eso
 * y no sobre lo asignado.
 *
 * `ajustesEnvio` —`[{ pedido_item_id, cantidad_enviada }]`— sólo trae las
 * EXCEPCIONES: lo normal es que salga lo asignado, así que un renglón sin ajuste
 * vale por su `cantidad_asignada` y se devuelve tal cual.
 *
 * Existe porque una caja que quien despacha acaba de declarar que NO envía no es
 * una caja que la sala pueda recibir. Contarla igual le imprime una etiqueta
 * E1…En a algo que nunca viajó, y quien recibe la reporta como faltante —con
 * razón— sobre un renglón que ya estaba resuelto como `no_enviado`.
 *
 * Es la primera mitad de lo que costó el pedido #178 de Salud 4 (17-sep-2026):
 * se le preguntó a la sala por «E2 — ELECTROLIT MANZANA 625ML», despachado en 0
 * de 12. La segunda mitad es `renglonesDeCajasFaltantes`, que mandó ese reporte
 * al renglón equivocado.
 */
export function renglonesQueSalen(rows, ajustesEnvio = []) {
    //  `Number.isFinite(Number(x))` a secas NO alcanza: `Number(null)` y
    //  `Number('')` valen 0, o sea que un ajuste sin cantidad se leería como
    //  «no envío nada» y borraría las cajas de ese renglón. Un ajuste que no
    //  dice cuánto sale no dice nada: el renglón vale por lo asignado.
    const enviadoDe = new Map((ajustesEnvio ?? [])
        .filter(a => a?.pedido_item_id != null && a?.cantidad_enviada != null && a.cantidad_enviada !== ''
                     && Number.isFinite(Number(a.cantidad_enviada)))
        .map(a => [Number(a.pedido_item_id), Number(a.cantidad_enviada)]));
    if (enviadoDe.size === 0) return [...(rows ?? [])];
    return [...(rows ?? [])].map(r => (
        enviadoDe.has(r?.id) ? { ...r, cantidad_asignada: enviadoDe.get(r.id) } : r
    ));
}

export function construirCajasEspeciales(rows) {
    let n = 1;
    return [...(rows ?? [])]
        .filter(r => r.caja_especial === true && (r.cantidad_asignada ?? 0) > 0)
        .sort((a, b) => (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es'))
        .flatMap(r => Array.from({ length: cajasDeRenglon(r) }, () => ({
            label:          `E${n++}`,
            pedido_item_id: r.id,
            erp_product_id: r.erp_product_id,
            product_name:   r.products?.nombre ?? '',
        })));
}

/**
 * Qué renglones bloquea un reporte de cajas especiales faltantes: la INVERSA de
 * `construirCajasEspeciales`, y vive pegada a ella a propósito.
 *
 * La etiqueta E1…En es una **clave**, y la lista que se guardó al finalizar ya
 * dice de qué renglón salió cada caja. Quien recibe la lee; no la vuelve a
 * derivar.
 *
 * Derivarla de nuevo costó el pedido #178 de Salud 4 (17-sep-2026). La pantalla
 * de llegada reconstruía el orden con los renglones vivos y contaba una etiqueta
 * por **unidad**, no por caja: con 12 botellas por caja, E1…E12 caían todas
 * sobre el primer producto. El «E2 faltante» que reportó la sala —ELECTROLIT
 * MANZANA, que bodega nunca despachó— marcó ELECTROLIT COCO, que estaba en el
 * estante. Encima salteaba los renglones ya `recibido`, o sea que las etiquetas
 * se corrían otra vez. Es el mismo aviso que el encabezado de este archivo ya
 * traía escrito desde el pedido #114, y la razón de que las dos mitades del mapa
 * vivan ahora en el mismo lugar: mientras cada pantalla lo reconstruya a su
 * manera, van a volver a discrepar.
 *
 * Ninguna de las dos mitades del defecto da error: la sala ve dada por no
 * llegada una caja que tiene en la mano, y la que falta de verdad no la persigue
 * nadie.
 *
 * Devuelve `{ ids, huerfanas }`. Una etiqueta sin dueño **no se saltea** — se
 * devuelve para que el llamador se plante. Saltearla deja la llegada confirmada
 * y el faltante sin ningún renglón bloqueado, que es un faltante invisible.
 */
export function renglonesDeCajasFaltantes(cajasEspeciales, especialesLlegadas) {
    const faltantes = Object.entries(especialesLlegadas ?? {})
        .filter(([, v]) => v === 'faltante')
        .map(([label]) => label);
    //  `Array.isArray` y no `?? []`: el DEFAULT de la columna es `'{}'::jsonb`,
    //  o sea un OBJETO vacío, no un arreglo. `{}.filter` no existe — con `?? []`
    //  un pedido viejo reventaría acá con un TypeError en vez de denunciar sus
    //  etiquetas como huérfanas, que es lo que de verdad pasa.
    const duenoDe = new Map((Array.isArray(cajasEspeciales) ? cajasEspeciales : [])
        .filter(c => c?.label != null && c?.pedido_item_id != null)
        .map(c => [c.label, c.pedido_item_id]));
    return {
        ids:       [...new Set(faltantes.map(l => duenoDe.get(l)).filter(id => id != null))],
        huerfanas: faltantes.filter(l => !duenoDe.has(l)),
    };
}

/**
 * De las cajas de Electrolit de un despacho, cuántas NO viajan ya como caja
 * especial — o sea, cuántas quedan por preguntar aparte.
 *
 * Existe porque un mismo Electrolit ×12 puede caer en las dos cuentas:
 * `cajas_electrolit` lo cuenta por despachar en CAJA, y `cajas_especiales` lo
 * cuenta por estar marcado `caja_especial`. Hoy 151 de los 367 renglones de
 * Electrolit por caja son las dos cosas, así que la pantalla de llegada
 * preguntaba **dos veces por la misma caja física**: una con un contador de
 * «cuántas no llegaron» y otra con su etiqueta E1…En y un OK/Falta.
 *
 * El 1-sep-2026 eso costó el pedido 10-310826-3 de Salud 1: las cuatro cajas
 * llegaron, se marcaron E1…E4 en OK —la respuesta correcta— y el contador quedó
 * en 4. La base guardó las dos respuestas contradictorias, los cuatro renglones
 * se bloquearon como no llegados y el banner igual decía «sin novedad».
 *
 * Se resta acá y no en el momento de finalizar a propósito: `cajas_electrolit`
 * significa «todas las cajas de Electrolit del despacho» y así se guardó en los
 * pedidos que ya existen. Restando al LEER, la cuenta sale igual para los
 * viejos y para los nuevos; restando al escribir, los viejos quedarían con un
 * número y los nuevos con otro.
 */
export function electrolitFueraDeEspeciales(cajasElectrolit = 0, cajasEspeciales = []) {
    const yaPreguntadas = (cajasEspeciales ?? [])
        .filter(e => (e?.product_name ?? '').toLowerCase().includes('electrolit'))
        .length;
    return Math.max(0, (cajasElectrolit ?? 0) - yaPreguntadas);
}
