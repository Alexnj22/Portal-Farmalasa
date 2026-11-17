import { supabase } from '../supabaseClient';
import { firmarRutas } from './chatClientes';

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

/** Datos, tipo, nivel, puntos y última compra del cliente. Lanza si la base falla. */
export async function fetchClienteDePreventa(branchId, customerId) {
    const { data, error } = await supabase.rpc('preventa_cliente', { p_branch: Number(branchId), p_customer: Number(customerId) });
    if (error) throw error;
    if (!data?.foto_ruta) return data ? { ...data, foto: null } : data;
    // La foto que subió desde la app. Si no se puede firmar, va sin foto.
    const firmadas = await firmarRutas([data.foto_ruta]);
    return { ...data, foto: firmadas.get(data.foto_ruta) ?? null };
}

/**
 * La foto de cada producto, `Map<id, url>`. Para los que entran sin pasar por
 * el buscador (corregir, repetir, un borrador viejo). `id` es único y son ≤30.
 * Si falla, sin fotos: no detiene la venta.
 */
export async function fotosDeProductos(ids) {
    const unicos = [...new Set((ids ?? []).map(Number).filter(Boolean))];
    if (!unicos.length) return new Map();
    const { data, error } = await supabase.from('products').select('id, foto_url').in('id', unicos);
    if (error) { console.error('preventas.js: fotos de productos', error); return new Map(); }
    return new Map((data ?? []).filter((p) => p.foto_url).map((p) => [Number(p.id), p.foto_url]));
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
            let cuerpo = null;
            try { cuerpo = await error.context?.json(); detalle = cuerpo?.error ?? ''; } catch { /* sin cuerpo legible */ }
            return { ok: false, error: detalle || error.message || 'No se pudo.', ...(cuerpo?.no_en_caja ? { no_en_caja: true } : {}) };
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
export const enviarPreventaDirecta = ({ branchId, customerId, documento, pago = 'contado', puntos = 0, nota, lineas, preventaId = null, motivoPrecio = null, totalEsperado = null }) =>
    invocar({
        accion: 'directa', branch_id: Number(branchId), customer_id: customerId ? Number(customerId) : null,
        documento, pago, puntos, nota, lineas, ...(preventaId ? { preventa_id: Number(preventaId) } : {}),
        ...(motivoPrecio ? { motivo_precio: motivoPrecio } : {}),
        ...(totalEsperado != null && Number.isFinite(Number(totalEsperado)) ? { total_esperado: Math.round(Number(totalEsperado) * 100) / 100 } : {}),
    });

/** Borrar la preventa de la caja y marcarla anulada. Nunca lanza. */
/** `borradaEnCaja`: quien anula confirma que ya no está en caja (la borraron allá). */
export const anularPreventa = (preventaId, borradaEnCaja = false) =>
    invocar({ accion: 'anular', preventa_id: Number(preventaId), ...(borradaEnCaja ? { borrada_en_caja: true } : {}) });

/**
 * Los lotes de cada producto en la sucursal, `Map<id, [{lote, vence, unidades}]>`,
 * en el orden en que caja los usa. Lanza si la base falla.
 */
export async function lotesDePreventa(branchId, ids) {
    const unicos = [...new Set((ids ?? []).map(Number).filter(Boolean))];
    if (!unicos.length) return new Map();
    const { data, error } = await supabase.rpc('preventa_lotes', { p_branch: Number(branchId), p_ids: unicos });
    if (error) throw error;
    return new Map((data ?? []).map((p) => [Number(p.producto_id), p.lotes ?? []]));
}

/**
 * Revisar el cobro de una preventa en la caja SIN cobrar (kiosco de caja).
 * Devuelve `{ ok, motivo, totales, cabecera, renglones }` o `{ ok: false, error }`. Nunca lanza.
 */
export const ensayarCobro = (preventaId, efectivo) =>
    invocar({ accion: 'cobrar', ensayo: true, preventa_id: Number(preventaId), efectivo: Number(efectivo) || 0 });
