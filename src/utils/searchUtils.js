import { coincide, filtrar } from './busqueda';

/**
 * ⚠️ Gemelo EXACTO de `norm_search` en la base: arma los patrones que viajan
 * a las columnas `*_norm` (`likePattern`, `filtroProductoOCodigo`, los RPC de
 * inventario). NO usarlo para comparar en memoria — para eso está
 * `utils/busqueda.js`. Se retira cuando las columnas del servidor pasen a la
 * regla nueva (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md, F3/F4).
 *
 * Normaliza un string para búsqueda: elimina tildes, puntuación y pasa a minúsculas.
 * "S.S.N" → "ssn"  |  "Ácido" → "acido"  |  "CO-TRIMOXAZOL" → "cotrimoxazol"
 */
export function normSearch(str = '') {
    return String(str)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[.\-/,;:()'"’]/g, '')
        .toLowerCase()
        .trim();
}

/**
 * ¿Coincide? — la regla del portal (`utils/busqueda.js`): todas las palabras
 * en cualquier orden, los números completos, las palabras cortas al inicio.
 * tokenMatch("grav 500", "GRAVOL 500MG X 8", "Lab") → true
 */
export function tokenMatch(query, ...fields) {
    return coincide(query, ...fields);
}

/**
 * Patrón LIKE tokenizado para columnas *_norm en el servidor (PostgREST .ilike()).
 * "alcohol 90" → "%alcohol%90%" (matchea "alcohol90"). Orden-dependiente,
 * a diferencia del LIKE ALL de los RPCs — aceptable para typeahead de producto.
 * Uso: .ilike('nombre_norm', likePattern(term))
 */
export function likePattern(q = '') {
    const toks = normSearch(q).split(/\s+/).filter(Boolean);
    return toks.length ? `%${toks.join('%')}%` : '%';
}

/**
 * Filtra una lista con la regla del portal y devuelve `{ results, isFuzzy }`.
 * `isFuzzy` = los resultados son aproximados: la pantalla muestra
 * «Resultados similares para X».
 *
 * `orden` (plan §8.1): 'relevancia' en CATÁLOGOS (productos, personas,
 * cargos, módulos…), 'original' en HISTORIALES y en tablas cuyo orden elige
 * el usuario. El default es 'original' porque reordenar un historial sin que
 * nadie lo pidiera es peor que no ordenar un catálogo.
 */
export function smartFilter(query, data, getFields, { orden = 'original' } = {}) {
    const { resultados, aproximado } = filtrar(query, data, getFields, { orden });
    return { results: resultados, isFuzzy: aproximado };
}

