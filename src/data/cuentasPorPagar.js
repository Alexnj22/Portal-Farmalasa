import { supabase } from '../supabaseClient';

// Cuentas por pagar — qué le debemos a cada proveedor y si podemos comprarle.
//
// Todo pasa por RPC SECURITY DEFINER. Las tablas `compra_pagos` y
// `compra_pago_aplicado` **no tienen policy de escritura a propósito**: un
// INSERT suelto podría aplicar a una factura más de lo que se le debe, y ese
// error no se ve hasta que el saldo no cuadra contra el banco. La validación
// vive en `registrar_pago_compra`, que es lo único que puede mirar el saldo del
// documento ANTES de escribir.

/**
 * El resumen por proveedor: deuda, vencido, y cuánto queda de su límite.
 *
 * La deuda se cuenta desde **la fecha del DTE**, no desde la compra registrada
 * (decisión del usuario, 2026-08-16): es lo que el proveedor va a cobrar exista
 * o no la carga, y así aparecen las facturas que llegaron por correo y nadie
 * registró — que hoy no están en ningún otro control.
 */
export async function fetchCuentasPorPagar(desde = null) {
    const { data, error } = await supabase.rpc('get_cuentas_por_pagar', { p_desde: desde });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

/** Las facturas de un proveedor, con lo que le queda a cada una. */
export async function fetchDetalleProveedor(emisorNit) {
    const { data, error } = await supabase.rpc('get_cuentas_por_pagar_detalle', {
        p_emisor_nit: emisorNit,
    });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

/** Los pagos: los pendientes primero, que son los que esperan a Gerencia. */
export async function fetchPagos(emisorNit = null, dias = 180) {
    const { data, error } = await supabase.rpc('get_pagos_compra', {
        p_emisor_nit: emisorNit, p_dias: dias,
    });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

/**
 * Registrar un pago. Queda **pendiente** hasta que Gerencia lo apruebe: el
 * cheque todavía no salió, así que no baja el saldo — pero sí se ve como «en
 * trámite», que es lo que evita pagar dos veces la misma factura.
 *
 * `aplicaciones` es [{ document_id, monto }]: el monto del pago es la SUMA de
 * lo aplicado y no un número aparte, así no puede existir un pago de $500
 * repartido en $300.
 */
export async function registrarPago({ emisorNit, fecha, forma, referencia, aplicaciones, nota }) {
    const { data, error } = await supabase.rpc('registrar_pago_compra', {
        p_emisor_nit: emisorNit,
        p_fecha: fecha,
        p_forma: forma,
        p_referencia: referencia || null,
        p_aplicaciones: aplicaciones,
        p_nota: nota || null,
    });
    return { pagoId: data ?? null, error: error?.message ?? null };
}

/** Aprobar — sólo Gerencia (`can_approve`). */
export async function aprobarPago(pagoId) {
    const { error } = await supabase.rpc('aprobar_pago_compra', { p_pago_id: pagoId });
    return { error: error?.message ?? null };
}

/**
 * Anular — sólo Gerencia, y con motivo obligatorio.
 *
 * El pago NO se borra: queda anulado con quién y por qué. Una salida de plata
 * que desaparece del registro es exactamente lo que un control no puede
 * permitir.
 */
export async function anularPago(pagoId, motivo) {
    const { error } = await supabase.rpc('anular_pago_compra', {
        p_pago_id: pagoId, p_motivo: motivo,
    });
    return { error: error?.message ?? null };
}

/**
 * El plazo y el techo del proveedor.
 *
 * `dias_credito` está medido como **constante por proveedor** —COFARSAL 30,
 * MONTREAL 60, y ninguno varía entre facturas—, así que se pregunta una vez y
 * queda. El documento lo propone cuando lo trae (`resumen.pagos[].periodo`, el
 * 39% de las facturas).
 */
export async function guardarCondicionesProveedor(proveedorId, { diasCredito, limiteCredito, formaPago }) {
    const { error } = await supabase
        .from('proveedores_maestro')
        .update({
            dias_credito:   diasCredito   === '' || diasCredito   == null ? null : Number(diasCredito),
            limite_credito: limiteCredito === '' || limiteCredito == null ? null : Number(limiteCredito),
            forma_pago:     formaPago || null,
        })
        .eq('id', proveedorId);
    return { error: error?.message ?? null };
}
