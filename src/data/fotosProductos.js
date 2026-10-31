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
import { fetchAllRows } from '../utils/supabaseUtils';
import { claveDePrincipio, normalizarPrincipio } from '../utils/concentracion';
import { PRINCIPIO_PRESETS } from '../utils/edicionDeProducto';

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

/**
 * Lo último que se completó, el más reciente primero: para volver a abrir uno
 * y corregirlo. Un producto sale una vez (su cambio más reciente), con quién y
 * cuándo. Lee 500 filas del registro —tope deliberado, bajo el techo de 1000—:
 * alcanza de sobra para los 60 productos distintos que se muestran.
 */
export async function fetchRecientesDeCarga({ limite = 60 } = {}) {
    const { data, error } = await supabase.from('producto_carga_log')
        .select('product_id, employee_id, created_at')
        .order('created_at', { ascending: false })
        .limit(500);
    if (error) throw error;
    const ultimo = new Map();
    for (const r of data || []) {
        if (!ultimo.has(r.product_id)) ultimo.set(r.product_id, r);
        if (ultimo.size >= limite) break;
    }
    if (!ultimo.size) return [];
    const filas = await fetchColaDeCarga({ ids: [...ultimo.keys()], limite: ultimo.size });
    const porId = new Map(filas.map((f) => [f.id, f]));
    return [...ultimo.values()]
        .filter((r) => porId.has(r.product_id))
        .map((r) => ({ ...porId.get(r.product_id), hecho_por: r.employee_id, hecho_el: r.created_at }));
}

/** Cuánto falta y cuánto hizo cada persona hoy y en los últimos 7 días. */
export async function fetchResumenDeCarga() {
    const { data, error } = await supabase.rpc('resumen_carga_productos');
    if (error) throw error;
    return /** @type {any} */ (data);
}

/**
 * Los principios que ya existen en el catálogo, uno por molécula: para elegir
 * de la lista en vez de escribir una variante nueva («ACETAMINOFEN» al lado de
 * «ACETAMINOFÉN»). De cada grupo que sólo difiere en tildes o mayúsculas gana
 * la forma más usada. Son ~1,100 filas: se pagina (el techo de 1000).
 */
export async function fetchNombresDePrincipios() {
    const filas = await fetchAllRows(() => supabase.from('product_active_principles').select('nombre').order('id'));
    if (!filas) throw new Error('No se pudo leer la lista de principios activos.');
    const grupos = new Map();
    for (const { nombre } of filas) {
        const n = normalizarPrincipio(nombre);
        if (!n || PRINCIPIO_PRESETS.includes(nombre)) continue;
        const k = claveDePrincipio(n);
        const g = grupos.get(k) || new Map();
        g.set(n, (g.get(n) || 0) + 1);
        grupos.set(k, g);
    }
    return [...grupos.values()]
        .map((g) => [...g.entries()].sort((a, b) => b[1] - a[1])[0][0])
        .sort((a, b) => a.localeCompare(b, 'es'));
}
