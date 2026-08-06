import { supabase } from '../supabaseClient';
import { insertApprovalRequestSilent } from './requests';

// Datos del widget de cargas y descartes de inventario.
//
// La idea del widget es dar vuelta el trabajo: en vez de que alguien busque
// producto por producto, el portal PROPONE la lista y la persona tilda. Eso se
// puede porque `inventory` ya guarda lote, fecha de vencimiento, cantidad y
// presentación por sucursal — el sync lo trae cada minuto.
//
// ── La presentación NO es su id ────────────────────────────────────────────
// El portal y el sistema de origen numeran las presentaciones distinto (para el
// producto 2: 1/102/230 acá, 8421/7213/3 allá), así que acá se arma el
// SIGNIFICADO —tipo + factor— y del otro lado se resuelve por etiqueta. Nunca
// mandar `product_precios.id_presentacion` como si fuera el del movimiento.

// Tope deliberado, por debajo del corte de 1000 filas de PostgREST: si una
// sucursal tuviera más vencidos que esto, el widget lo DICE en vez de mostrar
// una lista recortada que se lee como completa.
export const TOPE_LISTA = 400;

/**
 * Lo que está vencido o por vencer en una sucursal, lote por lote.
 *
 * `dias = 0` es "ya vencido"; 30/60/90 agregan lo que vence dentro de ese
 * plazo. Devuelve `{ filas, hayMas }`.
 */
export async function fetchLotesPorVencer({ erpSucursalId, dias = 0 }) {
    const corte = new Date(Date.now() - 6 * 60 * 60 * 1000);   // fecha de El Salvador
    corte.setDate(corte.getDate() + Number(dias || 0));
    const hasta = corte.toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from('inventory')
        .select('erp_product_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad')
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .eq('is_vencidos', false)          // la bodega de vencidos ya es el destino, no el origen
        .gt('cantidad', 0)
        .not('fecha_vencimiento', 'is', null)
        .lte('fecha_vencimiento', hasta)
        .order('fecha_vencimiento', { ascending: true })
        .range(0, TOPE_LISTA);             // uno de más: así se sabe si hay cola

    if (error) return { filas: [], hayMas: false, error };
    const filas = (data ?? []).slice(0, TOPE_LISTA);
    return { filas, hayMas: (data ?? []).length > TOPE_LISTA, error: null };
}

/** Busca por nombre dentro de lo que esa sucursal tiene con existencia. */
export async function buscarConExistencia({ erpSucursalId, texto }) {
    const q = String(texto ?? '').trim();
    if (q.length < 2) return { filas: [], error: null };

    const { data, error } = await supabase
        .from('inventory')
        .select('erp_product_id, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad')
        .eq('erp_sucursal_id', Number(erpSucursalId))
        .eq('is_vencidos', false)
        .gt('cantidad', 0)
        .ilike('descripcion', `%${q}%`)
        .order('descripcion')
        .range(0, 60);

    return { filas: data ?? [], error };
}

/**
 * Las presentaciones de cada producto, con su factor.
 *
 * Es lo que después identifica la presentación del otro lado, así que se pide
 * el tipo y el factor y NO el id. Chunkeado de a 1000 porque el `in()` viaja
 * como filtro y la respuesta se corta en 1000 filas sin avisar.
 */
export async function fetchPresentaciones(productIds) {
    const ids = [...new Set((productIds ?? []).map(Number).filter(Boolean))];
    if (!ids.length) return { porProducto: new Map(), error: null };

    const tandas = [];
    for (let i = 0; i < ids.length; i += 1000) tandas.push(ids.slice(i, i + 1000));

    const respuestas = await Promise.all(tandas.map(t => supabase
        .from('product_precios')
        .select('product_id, factor, activo, presentaciones(tipo)')
        .in('product_id', t)
        .eq('activo', true)));

    const fallo = respuestas.find(r => r.error);
    if (fallo) return { porProducto: new Map(), error: fallo.error };

    const porProducto = new Map();
    for (const r of respuestas) {
        for (const fila of r.data ?? []) {
            const tipo = fila.presentaciones?.tipo;
            const factor = Number(fila.factor);
            if (!tipo || !factor) continue;
            const lista = porProducto.get(fila.product_id) ?? [];
            // Misma etiqueta = misma presentación: el otro lado también las
            // tiene repetidas y son intercambiables.
            if (!lista.some(p => p.tipo === tipo && p.factor === factor)) {
                lista.push({ tipo, factor });
            }
            porProducto.set(fila.product_id, lista);
        }
    }
    // La unidad primero: es la que se usa en un descarte casi siempre.
    for (const lista of porProducto.values()) lista.sort((a, b) => a.factor - b.factor);
    return { porProducto, error: null };
}

/** Crea la solicitud. El aviso al aprobador lo dispara el trigger, no esto. */
export function insertMovimientoInventario(payload) {
    return insertApprovalRequestSilent(payload);
}
