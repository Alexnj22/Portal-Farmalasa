/**
 * La aritmética del inventario de una sala: cuántas unidades son, cuánto falta
 * para que venza y qué lote se muestra. Vivía dentro de
 * `views/inventario/TabInventario.jsx`; se mudó el 2026-10-01 para que la app
 * del teléfono cuente las unidades y pinte los vencimientos con la MISMA regla.
 */
import { diasEntre, hoySV } from './fecha';

/** El factor de la presentación: «CAJA X30» → 30. Sin «X<n>», 1. */
export function factorDeDetalle(detalle) {
    if (!detalle) return 1;
    const m = String(detalle).match(/[Xx](\d+)/);
    return m ? parseInt(m[1], 10) : 1;
}

/** Unidades sueltas de una ubicación: cantidad × factor de su presentación. */
export const unidadesDeUbicacion = (fila) => (fila?.cantidad || 0) * factorDeDetalle(fila?.detalle);

/**
 * Cuánto falta para que venza, y en qué franja cae. Los días se cuentan en el
 * calendario de El Salvador, no en el reloj de quien mira.
 *   vencido · pronto (≤30 d) · trimestre (≤90 d) · semestre (≤180 d) · lejos
 */
export function vencimientoDe(fecha, hoy = hoySV()) {
    if (!fecha) return null;
    const dias = diasEntre(hoy, String(fecha).slice(0, 10));
    const franja = dias < 0 ? 'vencido' : dias <= 30 ? 'pronto' : dias <= 90 ? 'trimestre' : dias <= 180 ? 'semestre' : 'lejos';
    return { dias, vencido: dias < 0, franja };
}

/** El lote que se muestra de un producto agrupado: ninguno, el único, o «VARIOS». */
export function loteAMostrar(grupo) {
    const n = Number(grupo?.num_lotes);
    if (!n) return '—';
    return n === 1 ? (grupo.lote_sample || '—') : 'VARIOS';
}

/** Unidades en el área de vencidos, por `<sala>_<producto>`. */
export function unidadesVencidasPorProducto(filas) {
    const mapa = {};
    for (const f of (filas || [])) {
        const k = `${f.erp_sucursal_id}_${f.erp_product_id}`;
        mapa[k] = (mapa[k] || 0) + unidadesDeUbicacion(f);
    }
    return mapa;
}
