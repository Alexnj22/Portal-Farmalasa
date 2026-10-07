// La revisión de una sala de Min·Máx — lo que la tabla del portal
// (`useMinMaxData`) y la app del teléfono necesitan contar igual: en qué estado
// está un ajuste a mano, qué filas pasan los filtros, cuánto se lleva
// «Descartar», por qué el cálculo se negó y qué decir al publicar.
import { normXyz, hasDispatchRisk } from './minmaxTabla';

/**
 * En cuál de los cuatro estados está un ajuste puesto por una persona.
 *
 * `a_mano` es el más flojo y los otros tres son SELLADOS: vienen de una
 * solicitud aprobada o de un motivo declarado. Esa separación es la misma que
 * hace el freno de publicar, y hasta el 2026-09-04 no existía acá: bastaba
 * `manual_at` + un borrador distinto para gritar EN CONFLICTO, o sea que
 * cualquier fila que alguien tocó alguna vez y que el cálculo vuelve a proponer
 * salía marcada. En Salud 2 eran **59 de 65 filas**, y un indicador que marca
 * casi todo no indica nada.
 *
 * (La otra mitad de ese arreglo está en la base: publicar ahora limpia
 * `manual_at`, así que la firma describe el número de HOY y no cualquier cosa
 * que se hizo hace tres meses. Eran 926 filas arrastrando una firma vieja.)
 *
 * El orden importa: «volvió a moverse» gana sobre «en conflicto» porque dice
 * algo más fuerte —el motivo que se declaró dejó de ser cierto— y quien lo mire
 * va a querer resolver eso antes que el desacuerdo de números.
 */
export const estadoAjuste = (r) => {
    if (!r?._manual_at) return null;

    // Sin sello, la fila sólo dice «este número lo puso una persona y todavía no
    // se publicó encima». Es información, no una decisión pendiente: el cálculo
    // del mes que viene la va a reemplazar como a cualquier otra.
    if (!r._ajuste_solicitud_id && !r._manual_motivo) return 'a_mano';

    // El motivo era «ya no rota» y el producto volvió a venderse después de que
    // alguien lo dijera. `last_sale_date` es una fecha sin hora: se compara
    // contra el DÍA del ajuste para no hacerla retroceder al leerla como UTC.
    if (r._manual_motivo === 'ya_no_rota' && r.last_sale_date) {
        const diaAjuste = String(r._manual_at).slice(0, 10);
        if (String(r.last_sale_date).slice(0, 10) > diaAjuste) return 'volvio_a_moverse';
    }

    // El cálculo propone algo distinto de lo que quedó vigente. Puede venir de
    // un borrador sin publicar o del último valor calculado.
    const hayBorradorDistinto = r.draft_status === 'pending'
        && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max);
    const calculoDistinto = r.calc_min != null
        && (r.calc_min !== r.effective_min || r.calc_max !== r.effective_max);
    if (hayBorradorDistinto || calculoDistinto) return 'en_conflicto';

    return 'respetado';
};

/**
 * ¿Pasa esta fila los filtros de la sala? Los ocultos sólo se ven con
 * `soloOcultos`; los de catálogo sin venta sólo con el filtro «sin datos» o una
 * búsqueda escrita.
 */
export function filaPasaFiltros(r, f = {}) {
    const {
        ocultos = new Set(), soloOcultos = false, soloSinDatos = false, soloBorradores = false, soloCambios = false,
        riesgoDeDespacho = false, ajuste = 'all', abc = 'all', xyz = 'all', alerta = 'all', hayBusqueda = false,
    } = f;
    if (soloOcultos) return ocultos.has(r.erp_product_id);
    if (ocultos.has(r.erp_product_id)) return false;
    if (soloSinDatos && r.draft_status !== 'sparse_data') return false;
    if (soloBorradores && r.draft_status !== 'pending') return false;
    if (soloCambios && !(r.draft_status === 'pending' && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max))) return false;
    if (riesgoDeDespacho && !hasDispatchRisk(r.effective_max, r.dispatch_pres_factor, r.dispatch_multiplo)) return false;
    if (ajuste !== 'all') {
        const est = estadoAjuste(r);
        if (ajuste === 'any' ? !est : est !== ajuste) return false;
    }
    if (r.is_catalog_only && alerta !== 'no_data' && !hayBusqueda) return false;
    if (abc !== 'all' && (r.draft_abc_class || r.abc_class) !== abc) return false;
    if (xyz !== 'all' && normXyz(r.draft_demand_variability || r.demand_variability) !== xyz) return false;
    if (alerta !== 'all' && r.alert_status !== alerta) return false;
    return true;
}

/**
 * Qué se lleva «Descartar»: `discard_stock_drafts` limpia los borradores Y las
 * filas de «datos escasos», que no salen en la lista de borradores. Se cuenta
 * antes para que el aviso no sorprenda.
 */
export function cuentaADescartar(rows, erpId) {
    let borradores = 0, sinDatos = 0;
    for (const r of rows ?? []) {
        if (erpId != null && r._erp_sucursal_id !== erpId) continue;
        if (r.draft_status === 'pending') borradores++;
        if (r.draft_status === 'sparse_data') sinDatos++;
    }
    return { borradores, sinDatos, total: borradores + sinDatos };
}

/** `calculate_stock_params` no lanza cuando se niega: devuelve `skipped`. */
export function motivoDeSaltoDelCalculo(res) {
    if (!res?.skipped) return null;
    if (res.reason === 'branch_has_pending_drafts') return 'Tiene borradores sin revisar. Publícalos o descártalos antes de recalcular.';
    if (res.reason === 'module_locked') return `Min·Max está en mantenimiento${res.locked_by ? ` por ${res.locked_by}` : ''}.`;
    return 'No se recalculó.';
}

/** Lo que se dice al publicar: cuántos, y qué quedó quieto y por qué. */
export function mensajeDePublicacion(res, dejadasAparte = 0) {
    const n = res?.published ?? 0;
    const frenadas = res?.omitidas_por_ajuste_manual ?? 0;
    const label = `${n.toLocaleString()} borrador${n !== 1 ? 'es' : ''}`;
    const cola = dejadasAparte > 0
        ? ` · ${dejadasAparte.toLocaleString()} quedaron igual, como elegiste`
        : frenadas > 0 ? ` · ${frenadas.toLocaleString()} no, vienen de una solicitud` : '';
    return { texto: `Se publicaron ${label}${cola}`, aviso: frenadas > 0 || dejadasAparte > 0 };
}
