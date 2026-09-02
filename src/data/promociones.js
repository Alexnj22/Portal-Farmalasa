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

/**
 * Los proveedores a los que se les factura, para decir quién paga el bono.
 *
 * Sale de `suppliers` —los 127 que vienen del sistema de origen— y no de la
 * lista corta del portal: no hay que mantenerla a mano y ya contiene a quien
 * emite la nota de crédito de una campaña.
 */
export async function fetchProveedoresDelSistema() {
    const { data, error } = await supabase
        .from('suppliers')
        .select('id, nombre')
        .order('nombre');
    if (error) throw error;
    return (data ?? []).map((s) => ({ value: String(s.id), label: s.nombre }));
}

/**
 * La cola de excedentes: lo vendido por encima del lote, esperando decisión.
 *
 * El excedente NO son ventas fuera de la promoción —esas no existen para el
 * módulo—: son ventas suyas, del producto y en las fechas correctas, que se
 * pasaron del lote que se negoció con el laboratorio. Por eso hay que decidir:
 * ese bono no está acordado con nadie.
 */
export async function fetchExcedentes(estado = 'por_decidir') {
    const { data, error } = await supabase.rpc('get_excedentes', {
        p_estado: estado || null,
    });
    if (error) throw error;
    return data ?? [];
}

/**
 * Aprobar suma el excedente a lo de esa persona; negar exige el motivo.
 *
 * El motivo no es un campo más: sin él quien vendió se queda sin nada que
 * reclamar. La base también lo exige, así que la pantalla pide lo mismo que el
 * servidor va a pedir — y no descubre el freno después de mandar.
 */
export async function decidirExcedente(id, aprobar, motivo = null) {
    const { data, error } = await supabase.rpc('decidir_excedente', {
        p_id: Number(id),
        p_aprobar: !!aprobar,
        p_motivo: motivo || null,
    });
    if (error) throw error;
    return data ?? null;
}
