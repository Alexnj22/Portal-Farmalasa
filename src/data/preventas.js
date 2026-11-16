import { supabase } from '../supabaseClient';

// ═══════════════════════════════════════════════════════════════════════════
// La vista Preventa (2026-11-16). La base cotiza y decide; la función
// `preventa-caja` lleva la venta a la caja, la corrige y la anula.
// ═══════════════════════════════════════════════════════════════════════════

/** Precio por cliente, existencia y errores de cada producto. Lanza si la base falla. */
export async function cotizarPreventa(branchId, customerId, lineas) {
    const { data, error } = await supabase.rpc('preventa_cotizar', {
        p_branch: Number(branchId), p_customer: customerId ? Number(customerId) : null, p_lineas: lineas,
    });
    if (error) throw error;
    return data;
}

/** Las preventas de la sucursal, de hoy hacia atrás `dias` días. Lanza si la base falla. */
export async function fetchPreventasDeSala(branchId, dias = 1) {
    const { data, error } = await supabase.rpc('preventas_de_sala', { p_branch: Number(branchId), p_dias: dias });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

// El motivo real viaja en el CUERPO de la respuesta de la función.
async function invocar(body) {
    try {
        const { data, error } = await supabase.functions.invoke('preventa-caja', { body });
        if (error) {
            let detalle = '';
            try { detalle = (await error.context?.json())?.error ?? ''; } catch { /* sin cuerpo legible */ }
            return { ok: false, error: detalle || error.message || 'No se pudo.' };
        }
        return data ?? { ok: false, error: 'No se pudo.' };
    } catch (err) {
        return { ok: false, error: err?.message ?? 'No se pudo.' };
    }
}

/**
 * Mandar la venta a caja, o corregir la que ya está (`preventaId`).
 * Devuelve `{ ok, referencia, codigo, corregida, avisos }` o `{ ok: false, error }`. Nunca lanza.
 */
export const enviarPreventaDirecta = ({ branchId, customerId, documento, nota, lineas, preventaId = null, motivoPrecio = null }) =>
    invocar({
        accion: 'directa', branch_id: Number(branchId), customer_id: customerId ? Number(customerId) : null,
        documento, nota, lineas, ...(preventaId ? { preventa_id: Number(preventaId) } : {}),
        ...(motivoPrecio ? { motivo_precio: motivoPrecio } : {}),
    });

/** Borrar la preventa de la caja y marcarla anulada. Nunca lanza. */
export const anularPreventa = (preventaId) => invocar({ accion: 'anular', preventa_id: Number(preventaId) });
