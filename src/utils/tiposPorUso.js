/**
 * Los tipos de movimiento de caja, con lo que más anota la sala primero
 * (2026-10-21, pedido del usuario).
 *
 * El vendedor buscaba su tipo entre todos, en el orden fijo del catálogo. Con
 * la cuenta de lo que la sala anotó hace poco, lo de todos los días queda
 * arriba. Dos reglas que no dependen de la cuenta:
 *   · «Otro» va siempre al final: es el último recurso, no un atajo.
 *   · sin cuenta (sala nueva, o la lectura falló) queda el orden del catálogo.
 * El empate también respeta el catálogo, así la lista no salta entre aperturas.
 */
import { TIPOS_OTRO } from './conceptoDeOtroLado.js';

/** `uso` es un Map codigo → veces. Devuelve una lista nueva; no toca `tipos`. */
export function ordenarTiposPorUso(tipos, uso) {
    const veces = (t) => (uso?.get?.(t.codigo) ?? 0);
    return (tipos || [])
        .map((t, i) => ({ t, i }))
        .sort((a, b) => {
            const oa = TIPOS_OTRO.includes(a.t.codigo), ob = TIPOS_OTRO.includes(b.t.codigo);
            if (oa !== ob) return oa ? 1 : -1;
            return (veces(b.t) - veces(a.t)) || (a.i - b.i);
        })
        .map(({ t }) => t);
}
