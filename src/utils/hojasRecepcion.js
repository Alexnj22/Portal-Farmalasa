/**
 * En qué está cada hoja del despacho, para la pantalla de recepción.
 *
 * La pantalla recibe SÓLO los renglones pendientes: los que ya se contaron
 * —en ésta o en una sesión anterior— no vienen. Entonces una hoja contada ayer
 * llega sin un solo renglón… exactamente igual que una hoja cuyos productos
 * viajaban en una caja que no llegó. Vistas desde esa lista son la misma cosa, y
 * ahí nace el número que no cuadra: el 2026-08-15, La Popular tenía cuatro hojas
 * con dos marcadas «Contada» y el encabezado decía **0/2 contadas**. Las dos ya
 * contadas se caían del numerador Y del denominador a la vez, así que el conteo
 * hablaba de una lista distinta de la que se veía debajo.
 *
 * Lo que separa los dos casos no está en los renglones pendientes sino en los
 * ids: cuáles ya se contaron y cuáles quedaron en reenvío. Por eso esta función
 * los pide en vez de deducirlos de las cajas faltantes — deducirlo funciona
 * mientras el mapa de cajas esté completo, y los despachos viejos no lo tienen.
 *
 * Tres estados y nada más:
 *   · `contada`   — ya se contó (en esta sesión o en otra anterior)
 *   · `pendiente` — hay renglones para contar ahora
 *   · `reenvio`   — su contenido viaja en una caja que no llegó; hoy no se cuenta
 */

/**
 * @param {object}   p
 * @param {number[]} p.hojaNums          Todas las hojas del despacho.
 * @param {object}   p.paginaItems       `{ "1": [itemId, …] }` — el reparto impreso.
 * @param {object}   p.pendientesPorHoja `{ 1: 3 }` — renglones que quedan por contar hoy.
 * @param {number[]} p.hojasRecibidas    Hojas confirmadas (base + esta sesión).
 * @param {Array}    p.itemsEnReenvio    Ids de renglones en una caja que no llegó.
 * @param {Array}    p.itemsYaContados   Ids de renglones ya contados.
 * @returns {Record<number, 'contada'|'pendiente'|'reenvio'>}
 */
export function estadoDeHojas({
    hojaNums = [],
    paginaItems = {},
    pendientesPorHoja = {},
    hojasRecibidas = [],
    itemsEnReenvio = [],
    itemsYaContados = [],
} = {}) {
    const recibidas = new Set(hojasRecibidas);
    const reenvio   = new Set(itemsEnReenvio);
    const contados  = new Set(itemsYaContados);

    const estado = {};
    for (const n of hojaNums) {
        const ids  = paginaItems[String(n)] ?? [];
        const pend = pendientesPorHoja[n] ?? 0;

        // El orden importa: una hoja confirmada en ESTA sesión sigue teniendo sus
        // renglones en la lista de pendientes —es una foto del momento de abrir la
        // pantalla— así que `recibidas` va primero o volvería a decir «pendiente».
        estado[n] = recibidas.has(n)                    ? 'contada'
                  : pend > 0                            ? 'pendiente'
                  : ids.some(id => reenvio.has(id))     ? 'reenvio'
                  : ids.some(id => contados.has(id))    ? 'contada'
                  // Sin renglones, sin reenvío y sin nada contado no hay con qué
                  // decir que se contó. Se trata como no contable: es lo que hacía
                  // la pantalla antes de que existiera esta función.
                  :                                       'reenvio';
    }
    return estado;
}

/**
 * Las hojas de las que habla el conteo del encabezado: todas menos las que están
 * enteras en reenvío. Ésas no se pueden contar hoy y su fila lo dice, así que
 * meterlas en el total pediría un conteo que nadie puede completar.
 */
export function hojasContables(hojaNums, estado) {
    return (hojaNums ?? []).filter(n => estado?.[n] !== 'reenvio');
}

export function hojasContadas(hojaNums, estado) {
    return (hojaNums ?? []).filter(n => estado?.[n] === 'contada');
}
