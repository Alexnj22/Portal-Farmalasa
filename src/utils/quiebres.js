// Agotados que venden — las cuentas de la pestaña «Agotados» de Min·Máx
// (`views/productos/TabQuiebres.jsx`), puras, para que la pantalla del teléfono
// cuente y filtre igual. Las filas son las de `get_quiebres_sala`:
// `{ erp_product_id, descripcion, abc_class, dias_sin, ultima_venta,
//    min_units, max_units, hay_ahora }`; `diasFoto` es cuántos días se miraron.
import { tokenMatch } from './searchUtils';

/** Las tres tarjetas: cuántos, cuántos nunca tuvieron y cuántos ya reingresaron. */
export function resumenDeQuiebres(filas, diasFoto) {
    const todas = filas || [];
    return {
        total: todas.length,
        sinNada: todas.filter((f) => f.dias_sin === diasFoto).length,
        reingreso: todas.filter((f) => f.hay_ahora).length,
    };
}

/**
 * Los filtros de la lista. «Con Min/Max» (puesto por defecto) deja sólo lo que
 * la sala ya decidió tener; «Nunca hubo», lo que no tuvo existencia ni un día.
 */
export function filtrarQuiebres(filas, { diasFoto, soloConMinMax = true, soloSinNada = false, busca = '' } = {}) {
    const t = String(busca || '').trim();
    return (filas || []).filter((f) => {
        if (soloConMinMax && !(f.max_units > 0)) return false;
        if (soloSinNada && f.dias_sin !== diasFoto) return false;
        if (t && !tokenMatch(t, f.descripcion)) return false;
        return true;
    });
}
