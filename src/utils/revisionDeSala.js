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

// ── El motivo de un ajuste a mano ───────────────────────────────────────────
// Lo usan el diálogo del portal (`MotivoAjusteModal`) y la pantalla del
// teléfono: los mismos frenos que aplica el CHECK de la base, dichos antes de
// que la base los rechace — un error de guardado no explica qué falta.

/** Qué le falta al motivo para poder guardarse, o `null` si está completo. */
export function faltaEnMotivoDeAjuste({ motivo, nota = '', unidades = '', dias = '' }) {
    if (!motivo) return null;
    if (motivo === 'otro' && !String(nota).trim()) return 'Escribe qué pasa con este producto.';
    if (motivo === 'cliente_fijo' && !(parseInt(unidades, 10) > 0 && parseInt(dias, 10) > 0)) {
        return 'Faltan las unidades y cada cuántos días las compra.';
    }
    return null;
}

/** Lo que se escribe en `product_stock_params` al guardar el motivo. */
export function patchDeMotivoDeAjuste({ motivo, nota = '', unidades = '', dias = '' }) {
    const esClienteFijo = motivo === 'cliente_fijo';
    return {
        manual_motivo: motivo || null,
        manual_nota:   motivo ? (String(nota).trim() || null) : null,
        manual_cliente_unidades: esClienteFijo ? parseInt(unidades, 10) : null,
        manual_cliente_dias:     esClienteFijo ? parseInt(dias, 10)     : null,
    };
}

// ── Ordenar la tabla de una sala ────────────────────────────────────────────
/** Las columnas por las que se puede ordenar, con su nombre. */
export const ORDENES_DE_MINMAX = [
    { key: 'product_name',  label: 'Producto' },
    { key: 'laboratorio',   label: 'Laboratorio' },
    { key: 'abc_xyz',       label: 'Clase ABC·XYZ' },
    { key: 'current_stock', label: 'Existencia' },
    { key: 'coverage',      label: 'Cobertura' },
    { key: 'effective_min', label: 'MIN' },
    { key: 'effective_max', label: 'MAX' },
    { key: 'revenue_6m',    label: 'Ingreso 6 meses' },
    { key: 'ventas',        label: 'Venta por día' },
];

/** Una copia de `filas` ordenada por `clave` (ver `ORDENES_DE_MINMAX`). */
export function ordenarFilasDeMinMax(filas, clave, dir = 'asc') {
    if (!clave) return filas;
    const valor = (r) => {
        switch (clave) {
            case 'product_name':  return r.product_name || '';
            case 'laboratorio':   return r.laboratorio_nombre || '';
            case 'abc_xyz':       return `${r.draft_abc_class || r.abc_class || 'D'}${normXyz(r.draft_demand_variability || r.demand_variability)}`;
            case 'current_stock': return Number(r.current_stock);
            case 'coverage':      return r.daily_velocity > 0 ? Number(r.current_stock) / Number(r.daily_velocity) : Infinity;
            case 'effective_min': return Number(r.effective_min);
            case 'effective_max': return Number(r.effective_max);
            case 'revenue_6m':    return Number(r.revenue_6m);
            case 'ventas':        return Number(r.daily_velocity);
            default:              return null;
        }
    };
    return [...filas].sort((a, b) => {
        const av = valor(a), bv = valor(b);
        if (av == null || bv == null) return 0;
        if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv, 'es') : bv.localeCompare(av, 'es');
        return dir === 'asc' ? av - bv : bv - av;
    });
}

// ── Ocultar lo filtrado ─────────────────────────────────────────────────────
/**
 * Las filas que se escriben para ocultar productos en una sala. Upsert y no
 * update: un producto sin movimiento puede no tener fila todavía.
 *
 * Oculto queda en -/- PUBLICADO, no en un borrador de 0/0: un borrador oculto
 * es inalcanzable —la tabla no lista ocultos— y `calculate_stock_params` se
 * salta la sucursal ENTERA ante un solo pendiente.
 */
export function filasParaOcultar(ids, erpSucursalId, ahora = new Date().toISOString()) {
    return ids.map((id) => ({
        erp_product_id: id,
        erp_sucursal_id: erpSucursalId,
        is_hidden: true,
        min_units: null,
        max_units: null,
        draft_min: null,
        draft_max: null,
        draft_status: 'none',
        updated_at: ahora,
    }));
}

/**
 * Lo que la sala cuenta para sus filtros de estado: los que piden datos,
 * los que la regla de despacho traba, los A en falta, los ocultos y los
 * ajustes a mano por estado. Los ocultos no entran en los demás.
 */
export function conteosDeEstadoDeLaSala(filas) {
    const ajustes = {};
    let sinDatos = 0, riesgo = 0, criticoA = 0, ocultos = 0, ajustadas = 0, publicado = false, bodegaPendientes = 0;
    for (const r of filas ?? []) {
        if (r.is_hidden) { ocultos++; continue; }
        if (r.published_by != null) publicado = true;
        if (r.draft_status === 'sparse_data') sinDatos++;
        if (r.draft_status === 'pending' && r._erp_sucursal_id === 6) bodegaPendientes++;
        if (hasDispatchRisk(r.effective_max, r.dispatch_pres_factor, r.dispatch_multiplo)) riesgo++;
        if (r.abc_class === 'A' && (r.alert_status === 'out_of_stock' || r.alert_status === 'below_min')) criticoA++;
        const est = estadoAjuste(r);
        if (est) { ajustadas++; ajustes[est] = (ajustes[est] ?? 0) + 1; }
    }
    return { sinDatos, riesgo, criticoA, ocultos, ajustadas, ajustes, publicado, bodegaPendientes };
}
