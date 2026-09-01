import { supabase } from '../supabaseClient';

/**
 * Promociones por producto — Fase 4 de `docs/PLAN-PROMOCIONES-2026-09-01.md`.
 *
 * Todas las escrituras pasan por RPC: las tablas no tienen policy de INSERT ni
 * de UPDATE a propósito, así que un `.insert()` desde acá no fallaría con un
 * error claro — lo cortaría el RLS. Y el cálculo vive en la base porque cruza
 * 618,464 renglones de venta contra las facturas del período: traerlo al
 * navegador sería pedir el techo de las 1000 filas y perder.
 */

/** La lista, sin ventas. El avance se ve al abrir una. */
export async function fetchPromociones(estado = null) {
    const { data, error } = await supabase.rpc('get_promociones', {
        p_estado: estado || null,
    });
    if (error) throw error;
    return data ?? [];
}

/** El detalle de una: renglones, reparto por sala y quién vendió. */
export async function fetchPromocion(id) {
    const { data, error } = await supabase.rpc('get_promocion', {
        p_id: Number(id),
    });
    if (error) throw error;
    return data ?? null;
}

/**
 * Crea la promoción entera de una vez —renglones, tarifa y reparto— porque la
 * base valida que el reparto de cada renglón sume su lote. Un reparto que no
 * cuadra no puede existir ni un instante.
 */
export async function crearPromocion({ nombre, renglones, nota }) {
    const { data, error } = await supabase.rpc('crear_promocion', {
        p_nombre: nombre,
        p_renglones: renglones,
        p_nota: nota || null,
    });
    if (error) throw error;
    return data ?? null;
}

/** Enciende o devuelve a borrador. Una finalizada no se reabre. */
export async function activarPromocion(id, activar = true) {
    const { data, error } = await supabase.rpc('activar_promocion', {
        p_id: Number(id),
        p_activar: !!activar,
    });
    if (error) throw error;
    return data ?? null;
}

/**
 * Cambiar los montos NO reescribe lo ya ganado: la base agrega una tarifa con
 * su fecha y el cálculo toma la vigente a la fecha de cada venta.
 */
export async function editarTarifaRenglon({
    renglonId, bonoVendedor, bonoAdm, bonoBodega, unidadesPorBono = 1, desde = null,
}) {
    const { data, error } = await supabase.rpc('editar_tarifa_renglon', {
        p_renglon_id:        Number(renglonId),
        p_bono_vendedor:     Number(bonoVendedor) || 0,
        p_bono_adm:          Number(bonoAdm) || 0,
        p_bono_bodega:       Number(bonoBodega) || 0,
        p_unidades_por_bono: Math.max(Number(unidadesPorBono) || 1, 1),
        p_desde:             desde || null,
    });
    if (error) throw error;
    return data ?? null;
}

/**
 * Mueve el fin de UN producto. Si la promoción estaba finalizada la reabre —
 * su vigencia se deriva de los renglones, no al revés.
 */
export async function extenderRenglon(renglonId, fin) {
    const { data, error } = await supabase.rpc('extender_renglon', {
        p_renglon_id: Number(renglonId),
        p_fin: fin,
    });
    if (error) throw error;
    return data ?? null;
}

/**
 * Las presentaciones en que se ha vendido un producto, agrupadas POR FACTOR.
 *
 * Por factor y no por rótulo porque el rótulo está sucio: en agosto hubo 283
 * etiquetas distintas para sólo 29 factores, y el mismo producto se factura
 * como `CAJA 1x100` y `CAJA 1X100`. Agrupar por el texto partiría en dos una
 * presentación que es una sola.
 */
export async function fetchPresentacionesDeProducto(erpProductId) {
    const { data, error } = await supabase.rpc('get_presentaciones_de_producto', {
        p_erp_product_id: Number(erpProductId),
    });
    if (error) throw error;
    return data ?? [];
}
