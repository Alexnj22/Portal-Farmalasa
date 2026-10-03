// Aplicaciones de inyección pagadas: el control (2026-10-02).
//
// Una fila por aplicación pagada, asignada a la venta cuando la inyección se
// compró aquí. Se paga al cobrar en Mi caja (`anotarIngreso` con `aplicacion`,
// que va por `operar-caja`) y se canjea después. Todo lo que escribe va por
// funciones de la base: el navegador no inserta ni el monto ni las filas.
//
// Detalle del diseño en el encabezado de la migración `inyecciones_pagadas`.
import { supabase } from '../supabaseClient';

/** Lo que vale una aplicación hoy, por origen: `{ COMPRADA: 1, TRAIDA: 2 }`. */
export async function fetchPreciosDeAplicacion() {
    const { data, error } = await supabase.from('inyeccion_precios').select('origen, precio, actualizado_at');
    if (error) throw error;
    return Object.fromEntries((data || []).map((p) => [p.origen, Number(p.precio)]));
}

/**
 * Las ventas con inyección de la sala, con lo que le queda por pagar a cada
 * renglón. `buscar` filtra por cliente o número de factura.
 */
export async function fetchInyeccionesParaCobrar({ sala, buscar = '', dias = 7 }) {
    const { data, error } = await supabase.rpc('inyecciones_para_cobrar', {
        p_branch_id: Number(sala), p_buscar: buscar?.trim() || null, p_dias: dias,
    });
    if (error) throw error;
    return data ?? [];
}

/**
 * Una venta por su número de comprobante, de CUALQUIER sala (2026-10-03): el
 * cliente compró en una sucursal y se la aplica en otra, con el ticket. Es la
 * única forma de llegar a una venta de otra sala. Acepta el correlativo (con o
 * sin ceros) o el código de generación. Cada coincidencia trae su `estado`:
 * `ok` · `sin_inyeccion` · `pagada` · `anulada`.
 */
export async function buscarVentaPorComprobante({ sala, comprobante }) {
    const { data, error } = await supabase.rpc('inyeccion_venta_por_comprobante', {
        p_branch_id: Number(sala), p_comprobante: comprobante?.trim() || '',
    });
    if (error) throw error;
    return data?.ventas ?? [];
}

/** Lo pagado y sin aplicar. Todas las salas: el cliente puede volver a otra. */
export async function fetchAplicacionesPendientes({ buscar = '', sala = null } = {}) {
    const { data, error } = await supabase.rpc('inyecciones_pendientes', {
        p_buscar: buscar?.trim() || null, p_branch_id: sala ? Number(sala) : null,
    });
    if (error) throw error;
    return data ?? [];
}

/**
 * Marca aplicadas, en la sala donde se aplican (la de la caja en pantalla).
 * Falla entera si alguna ya no estaba pendiente.
 */
export async function aplicarPendientes(ids, sala = null) {
    const { data, error } = await supabase.rpc('inyeccion_aplicar', {
        p_ids: ids, p_branch_id: sala ? Number(sala) : null,
    });
    if (error) throw error;
    return data;
}

/** Supervisión: cuántas aplicaciones trae cada presentación vendida. */
export async function fetchCatalogoDeDosis() {
    const { data, error } = await supabase.rpc('inyeccion_catalogo_dosis');
    if (error) throw error;
    return data ?? [];
}

/** Aplicaciones por UNIDAD BASE (la suelta) de un producto; la caja multiplica por su factor. */
export async function fijarDosis({ erpProductId, aplicaciones }) {
    const { error } = await supabase.rpc('inyeccion_fijar_dosis', {
        p_erp_product_id: erpProductId, p_aplicaciones: aplicaciones,
    });
    if (error) throw error;
}

/**
 * Contar un producto por mililitros: lo que trae una unidad (el vial) y las
 * dosis que se usan. Al cobrar se elige la dosis y salen las aplicaciones.
 * `contenidoMl` null vuelve al número fijo de aplicaciones.
 */
export async function fijarMililitros({ erpProductId, contenidoMl, dosisMl }) {
    const { error } = await supabase.rpc('inyeccion_fijar_ml', {
        p_erp_product_id: erpProductId, p_contenido_ml: contenidoMl, p_dosis_ml: contenidoMl == null ? null : dosisMl,
    });
    if (error) throw error;
}

export async function fijarPrecioDeAplicacion({ origen, precio }) {
    const { error } = await supabase.rpc('inyeccion_fijar_precio', { p_origen: origen, p_precio: precio });
    if (error) throw error;
}

/** Supervisión: asignar un cobro suelto a un renglón de una venta. */
export async function vincularCobro({ cobroId, invoiceId, lineaNum }) {
    const { data, error } = await supabase.rpc('inyeccion_vincular_cobro', {
        p_cobro_id: cobroId, p_invoice_id: invoiceId, p_linea_num: lineaNum,
    });
    if (error) throw error;
    return data;
}

/** Deshace SÓLO una asignación hecha a mano. */
export async function desvincularCobro(cobroId) {
    const { data, error } = await supabase.rpc('inyeccion_desvincular_cobro', { p_cobro_id: cobroId });
    if (error) throw error;
    return data;
}

/**
 * Las ventas de la sala de ese día con inyección, para asignar un cobro suelto.
 * Reusa la lista del cobro: es la misma pregunta —qué renglón tiene saldo—.
 */
export async function fetchVentasParaVincular({ sala, buscar = '' }) {
    return fetchInyeccionesParaCobrar({ sala, buscar, dias: 31 });
}

/**
 * La bitácora: cada aplicación pagada del período (por la fecha del cobro),
 * con quién la cobró, quién la aplicó, cuándo y dónde. Hasta tres meses.
 */
export async function fetchBitacoraDeAplicaciones({ sala = null, desde, hasta, buscar = '' }) {
    const { data, error } = await supabase.rpc('inyecciones_bitacora', {
        p_branch_id: sala ? Number(sala) : null, p_desde: desde, p_hasta: hasta,
        p_buscar: buscar?.trim() || null,
    });
    if (error) throw error;
    return data ?? [];
}

/**
 * Marcar a mano si un producto es inyección: `true` lo agrega aunque el nombre
 * no lo diga, `false` lo quita aunque lo diga, `null` vuelve a lo automático.
 */
export async function clasificarProducto({ erpProductId, esInyeccion }) {
    const { error } = await supabase.rpc('inyeccion_clasificar_producto', {
        p_erp_product_id: erpProductId, p_es_inyeccion: esInyeccion,
    });
    if (error) throw error;
}
