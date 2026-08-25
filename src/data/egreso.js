import { supabase } from '../supabaseClient';

/**
 * Anota que algo SALIÓ del portal: un CSV, un ZIP, una impresión masiva.
 *
 * Fase 1.2 de `docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md`. Hoy no bloquea
 * nada — es la línea base con la que la Fase 3 va a elegir un techo. Sin estos
 * datos, cualquier umbral sería inventado, y este portal tiene una trampa
 * específica: `fetchAllRows` pagina 20,000+ filas como comportamiento NORMAL,
 * así que «muchas filas» no distingue a nadie. Lo que va a distinguir es qué
 * módulos exporta cada quien y con qué frecuencia.
 *
 * **No recibe quién exporta, y es a propósito.** La firma la pone
 * `registrar_egreso` leyendo `auth_employee_id()` adentro de la base: quien
 * exporta no elige a nombre de quién queda anotado.
 *
 * **Nunca lanza.** Una descarga que falla porque no se pudo anotar sería peor
 * que no anotarla: el registro existe para observar, no para frenar. Pero el
 * fallo se ve en consola — un registro que falla en silencio da una línea base
 * falsa, y una línea base falsa es peor que ninguna porque nadie la sospecha.
 *
 * @param {string} modulo    de dónde salió, en términos del portal (`libros_iva`, `personal`, …)
 * @param {object} [opciones]
 * @param {string} [opciones.formato]  `csv` | `zip` | `pdf`
 * @param {number} [opciones.filas]    cuántos registros, cuando se sabe
 * @param {object} [opciones.detalle]  el recorte: mes, sucursal, filtro
 */
export async function registrarEgreso(modulo, { formato = null, filas = null, detalle = {} } = {}) {
    try {
        const { error } = await supabase.rpc('registrar_egreso', {
            p_modulo: modulo,
            p_formato: formato,
            p_filas: Number.isFinite(filas) ? filas : null,
            p_detalle: detalle ?? {},
        });
        if (error) console.warn(`[egreso] no se pudo anotar "${modulo}": ${error.message}`);
    } catch (e) {
        console.warn(`[egreso] no se pudo anotar "${modulo}": ${e?.message || e}`);
    }
}
