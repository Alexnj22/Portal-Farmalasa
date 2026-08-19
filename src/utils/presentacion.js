// Las dos maneras de pasar de unidades a presentaciones, juntas a propósito:
// eligiendo la equivocada el número se ve razonable y dice otra cosa.
//
//   applyPresRule        → cuánto SUGERIR pedir. Sube un pack con el 40%.
//   presentacionesEnteras → cuánto CABE pedir. Redondea siempre hacia abajo.

// Convierte unidades a presentación usando la regla del 40%:
// floor(units/factor) + (residuo/factor >= 0.4 ? 1 : 0)
export function applyPresRule(units, factor) {
    if (!units || units <= 0 || !factor || factor <= 1) return units ?? 0;
    const floor = Math.floor(units / factor);
    const rem   = units % factor;
    return floor + (rem / factor >= 0.4 ? 1 : 0);
}

/**
 * Cuántas presentaciones ENTERAS se pueden armar con las unidades que hay.
 *
 * Es la cuenta que el desplegable de «Presentación» pone entre paréntesis: con
 * 3 unidades y una caja de 3, la respuesta es 1 caja — no 3. Hasta el
 * 2026-08-19 ahí iba el FACTOR, que se lee igual y dice otra cosa; pedido del
 * usuario: «debe salir la cantidad de esa presentación, no las unidades base».
 *
 * Redondea SIEMPRE hacia abajo, y esa es toda la diferencia con `applyPresRule`
 * de arriba, que sube un pack cuando el residuo pasa el 40%. Aquella sugiere
 * cuánto PEDIR y puede estirarse; ésta es un TECHO: el formulario de traslado
 * compara `cantidad × factor` contra la existencia y el trigger
 * `validar_solicitud_traslado` repite la comparación en la base, así que
 * ofrecer una caja de más no muestra un número feo — produce una solicitud que
 * el envío rechaza.
 *
 * Sin factor usable el factor es 1, nunca 0: dividir por 0 daría `Infinity` y
 * el desplegable ofrecería una existencia que no existe.
 */
export function presentacionesEnteras(unidades, factor) {
    const u = Number(unidades);
    const f = Number(factor);
    if (!Number.isFinite(u) || u <= 0) return 0;
    return Math.floor(u / (Number.isFinite(f) && f > 0 ? f : 1));
}

/**
 * Las opciones del desplegable de «Presentación», con cuántas hay de cada una.
 *
 * `unidades` es la existencia de la sala elegida. Sin sala —todavía no se
 * eligió, o el producto no está en ninguna— va `null` y las opciones salen sin
 * número: uno inventado sería peor que ninguno.
 *
 * El factor se escribe en la etiqueta SÓLO cuando hace falta para distinguir
 * dos opciones que se llaman igual. Medido en el catálogo de producción el
 * 2026-08-19: de 5,712 parejas activas producto·presentación, la etiqueta se
 * repite con dos factores distintos en **2** productos (ACIDO FOLICO 5MG y
 * CETRADOL, «CAJA» de 1 y de 10). Escribirlo siempre sería peor: el texto de la
 * etiqueta no es el factor —de los 444 tipos que terminan en «X N», 236 tienen
 * factor 1, porque ahí la caja ES la unidad base— y dejaría «CAJA X 28 ×1» en
 * pantalla.
 *
 * El índice es el valor porque es lo que el formulario guarda; el orden lo fija
 * quien trae la lista (`fetchPresentaciones`, de menor a mayor factor).
 */
export function opcionesDePresentacion(presentaciones, unidades) {
    const lista = presentaciones ?? [];
    const factoresPorTipo = new Map();
    for (const p of lista) {
        const t = String(p?.tipo ?? '').trim();
        if (!factoresPorTipo.has(t)) factoresPorTipo.set(t, new Set());
        factoresPorTipo.get(t).add(Number(p?.factor));
    }
    return lista.map((p, i) => {
        const t = String(p?.tipo ?? '').trim();
        const nombre = factoresPorTipo.get(t).size > 1 ? `${t} ×${p?.factor}` : t;
        return {
            value: String(i),
            label: unidades == null
                ? nombre
                : `${nombre} (${presentacionesEnteras(unidades, p?.factor)})`,
        };
    });
}
