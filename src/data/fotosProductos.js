// Fotos de productos (2026-10-30): una cola común para completar la foto y el
// principio activo del catálogo. Medido ese día: de 4,382 productos activos,
// 4,362 sin foto y 3,632 sin principio activo.
//
// Todo va por funciones de la base y no por `.update()` sobre `products`: el
// módulo `fotos_productos` deja escribir SÓLO la foto y los principios, y abrir
// la policy de UPDATE de `products` le habría dado la ficha entera (precios,
// categoría…). `guardar_carga_producto` comprueba el permiso y toca esas dos.
import { supabase } from '../supabaseClient';
import { anotar } from './audit';
import { buscarIdsDeProducto } from './busquedaProductos';

/** Qué se le pide a la cola: lo que falta. */
export const FALTAS = ['cualquiera', 'foto', 'principio'];

/**
 * Los productos por completar, los que más se venden primero. Los que otra
 * persona está trabajando (hace menos de 15 minutos) no salen.
 * Con `ids` (la búsqueda) devuelve esos, estén completos o no.
 */
export async function fetchColaDeCarga({ falta = 'cualquiera', ids = null, limite = 40 } = {}) {
    const { data, error } = await supabase.rpc('cola_carga_productos', {
        p_falta: falta,
        p_ids: ids,
        p_limite: limite,
    });
    if (error) throw error;
    return /** @type {any[]} */ (data || []);
}

/** Buscar por nombre, principio activo o código de barras, para corregir uno puntual. */
export async function buscarParaCarga(texto) {
    const { ids, error } = await buscarIdsDeProducto(texto, { limite: 30, conPrincipioActivo: true, conLaboratorio: true });
    if (error) throw error;
    if (!ids.length) return [];
    return fetchColaDeCarga({ ids, limite: ids.length });
}

/**
 * Tomar el producto que se abrió: así nadie más lo trabaja a la vez.
 * Devuelve `{ ok, tomado_por }`; `ok: false` = lo tiene otra persona.
 */
export async function tomarProducto(productId) {
    const { data, error } = await supabase.rpc('tomar_producto_para_carga', { p_product_id: Number(productId) });
    if (error) throw error;
    return /** @type {{ ok: boolean, tomado_por?: string }} */ (data);
}

/**
 * Guardar la foto y/o los principios. Un `null` deja ese dato como está.
 * `principios` es `{ rows, text }` de `principiosParaGuardar`.
 */
export async function guardarCarga(productId, { fotoUrl = null, principios = null } = {}, contexto = {}) {
    const { data, error } = await supabase.rpc('guardar_carga_producto', {
        p_product_id: Number(productId),
        p_foto_url: fotoUrl,
        p_filas: principios
            ? principios.rows.map((r, i) => ({ nombre: r.nombre, concentracion: r.concentracion ?? null, orden: r.orden ?? i }))
            : null,
        p_texto: principios ? (principios.text || null) : null,
    });
    if (error) throw error;
    if (fotoUrl) anotar('PRODUCTO_FOTO_CAMBIADA', productId, { origen: 'fotos_productos', ...contexto });
    if (principios) anotar('UPDATE_PRODUCT_PRINCIPLES', productId, { origen: 'fotos_productos', count: principios.rows.length, ...contexto });
    return data;
}

/** Cuánto falta y cuánto hizo cada persona hoy y en los últimos 7 días. */
export async function fetchResumenDeCarga() {
    const { data, error } = await supabase.rpc('resumen_carga_productos');
    if (error) throw error;
    return /** @type {any} */ (data);
}
