// Capa de datos de Distribución — la venta en ruta de la S.A.S.
//
// Todo lo que decide algo vive en la base o en la edge function
// `distribucion-dte`: qué se le puede vender a cada cliente (trigger), el
// precio (sale del catálogo, no de lo que mande la pantalla), el tipo de
// documento, el correlativo y la firma. Acá sólo se lee y se piden acciones;
// por eso los errores de la base se devuelven tal cual y la vista los traduce.
import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

/** Los códigos que lanzan los triggers de la base, en lenguaje de la pantalla. */
const MENSAJES = {
    DIST_SIN_LICENCIA: 'Ese cliente no tiene autorización de la SRS vigente. Complétala en su ficha antes de venderle.',
    DIST_NO_VENTA_LIBRE: 'A una tienda o un supermercado sólo se le venden productos de venta libre.',
    DIST_FUERA_DE_CATALOGO: 'Ese producto no está en el catálogo de distribución.',
    DIST_SIN_CREDITO: 'Ese cliente no tiene crédito aprobado.',
    DIST_PLAZO: 'El plazo pasa del que tiene aprobado el cliente.',
    DIST_CLIENTE_INACTIVO: 'Ese cliente está desactivado.',
    DIST_PEDIDO_CERRADO: 'El pedido ya se facturó o se anuló.',
    DIST_DESCUENTO: 'El descuento pasa del importe del renglón.',
};

export function mensajeDeDistribucion(error) {
    const texto = typeof error === 'string' ? error : error?.message ?? '';
    const codigo = Object.keys(MENSAJES).find(k => texto.includes(k));
    if (codigo) return MENSAJES[codigo];
    if (texto.includes('dist_clientes_documento_unico')) return 'Ya hay un cliente con ese documento.';
    if (texto.includes('dist_clientes_ccf_completo')) {
        return 'Un contribuyente necesita NIT, actividad económica y dirección completa para recibir Crédito Fiscal.';
    }
    return texto || 'No se pudo completar la operación.';
}

// ── Emisor ─────────────────────────────────────────────────────────────────

export async function fetchEmisor() {
    const { data, error } = await supabase.from('dist_emisores').select('*').order('id').limit(1).maybeSingle();
    if (error) throw error;
    return data;
}

export async function guardarEmisor(id, cambios) {
    if (!id) {
        const { error } = await supabase.from('dist_emisores').insert(cambios);
        if (error) throw error;
        return;
    }
    const { error } = await supabase.from('dist_emisores').update(cambios).eq('id', id);
    if (error) throw error;
}

// ── Clientes ───────────────────────────────────────────────────────────────

export async function fetchClientes() {
    const rows = await fetchAllRows(() => supabase
        .from('dist_clientes')
        .select('*')
        .order('nombre'));
    if (rows === null) throw new Error('No se pudieron cargar los clientes.');
    return rows;
}

export async function guardarCliente(cliente) {
    const { id, contribuyente: _generada, created_at: _c, updated_at: _u, ...campos } = cliente;
    if (id) {
        const { error } = await supabase.from('dist_clientes').update(campos).eq('id', id);
        if (error) throw error;
        return id;
    }
    const { data, error } = await supabase.from('dist_clientes')
        .insert(campos).select('id').single(); // creado_por lo pone la base
    if (error) throw error;
    return data.id;
}

// ── Catálogo ───────────────────────────────────────────────────────────────

export async function fetchCatalogo() {
    const rows = await fetchAllRows(() => supabase
        .from('dist_catalogo')
        .select('emisor_id, product_id, precio_sin_iva, venta_libre, activo, products(nombre, es_antibiotico, requiere_receta, regulado)')
        .order('product_id'));
    if (rows === null) throw new Error('No se pudo cargar el catálogo.');
    return rows.map(r => ({
        ...r,
        nombre: r.products?.nombre ?? `Producto ${r.product_id}`,
        // Lo que la base NO dejaría vender a una tienda aunque se marque venta libre.
        controlado: !!(r.products?.es_antibiotico || r.products?.requiere_receta || r.products?.regulado),
    }));
}

export async function guardarPrecio(emisorId, productId, cambios) {
    const { error } = await supabase.from('dist_catalogo')
        .update(cambios).eq('emisor_id', emisorId).eq('product_id', productId);
    if (error) throw error;
}

export async function agregarAlCatalogo(emisorId, productId, precioSinIva, ventaLibre) {
    const { error } = await supabase.from('dist_catalogo').insert({
        emisor_id: emisorId, product_id: productId, precio_sin_iva: precioSinIva, venta_libre: ventaLibre,
    });
    if (error) throw error;
}

// ── Pedidos ────────────────────────────────────────────────────────────────

const SELECT_PEDIDO = 'id, cliente_id, vendedor_id, estado, condicion, forma_pago, plazo_dias, observaciones, created_at, dte_id, '
    + 'dist_clientes(nombre, tipo, contribuyente), employees!dist_pedidos_vendedor_id_fkey(name), '
    + 'dist_dte!dist_pedidos_dte_id_fkey(numero_control, estado, total_pagar, tipo)';

export async function fetchPedidos({ desde } = {}) {
    const rows = await fetchAllRows(() => {
        let q = supabase.from('dist_pedidos').select(SELECT_PEDIDO).order('created_at', { ascending: false });
        if (desde) q = q.gte('created_at', desde);
        return q;
    });
    if (rows === null) throw new Error('No se pudieron cargar los pedidos.');
    return rows;
}

export async function fetchItemsDePedido(pedidoId) {
    const { data, error } = await supabase.from('dist_pedido_items')
        .select('id, product_id, cantidad, precio_sin_iva, descuento, descripcion')
        .eq('pedido_id', pedidoId).order('id');
    if (error) throw error;
    return data;
}

/**
 * Crea el pedido y sus renglones. `clientUuid` lo genera la pantalla ANTES de
 * mandar: si la señal se corta y se reintenta, la base rechaza el duplicado
 * por `client_uuid` en vez de crear dos pedidos.
 */
export async function crearPedido({ emisorId, clienteId, condicion, plazoDias, formaPago, observaciones, clientUuid, renglones }) {
    const { data: previo, error: ePrev } = await supabase.from('dist_pedidos')
        .select('id').eq('client_uuid', clientUuid).maybeSingle();
    if (ePrev) throw ePrev;
    let pedidoId = previo?.id;
    if (!pedidoId) {
        const { data, error } = await supabase.from('dist_pedidos').insert({
            // vendedor_id lo pone la base (la ficha de quien inserta).
            emisor_id: emisorId, cliente_id: clienteId,
            condicion, plazo_dias: condicion === 2 ? plazoDias : null,
            forma_pago: formaPago, observaciones: observaciones?.trim() || null, client_uuid: clientUuid,
        }).select('id').single();
        if (error) throw error;
        pedidoId = data.id;
    }
    // Los renglones van con precio 0: el trigger pone el del catálogo.
    const { error: eIt } = await supabase.from('dist_pedido_items').upsert(
        renglones.map(r => ({
            pedido_id: pedidoId, product_id: r.product_id, cantidad: r.cantidad,
            precio_sin_iva: 0, descuento: r.descuento || 0, descripcion: r.descripcion || '',
        })),
        { onConflict: 'pedido_id,product_id' });
    if (eIt) {
        // Sin renglones el pedido no sirve: se anula para que no quede colgado.
        const { error: eAnular } = await supabase.from('dist_pedidos')
            .update({ estado: 'anulado', anulado_motivo: 'no se pudieron guardar los productos' })
            .eq('id', pedidoId);
        if (eAnular) console.error('distribucion: no se pudo anular el pedido vacío', pedidoId, eAnular.message);
        throw eIt;
    }
    return pedidoId;
}

export async function anularPedido(pedidoId, motivo) {
    const { error } = await supabase.from('dist_pedidos')
        .update({ estado: 'anulado', anulado_motivo: motivo?.trim() || null })
        .eq('id', pedidoId).eq('estado', 'confirmado');
    if (error) throw error;
}

// ── Documentos (DTE) ───────────────────────────────────────────────────────

export async function fetchDocumentos({ desde } = {}) {
    const rows = await fetchAllRows(() => {
        let q = supabase.from('dist_dte')
            .select('id, tipo, ambiente, numero_control, codigo_generacion, fec_emi, hor_emi, total_pagar, estado, sello_recibido, descripcion_msg, observaciones_mh, intentos, ultimo_intento_at, pedido_id, dist_clientes(nombre)')
            .order('id', { ascending: false });
        if (desde) q = q.gte('fec_emi', desde);
        return q;
    });
    if (rows === null) throw new Error('No se pudieron cargar los documentos.');
    return rows;
}

export async function fetchDocumento(id) {
    const { data, error } = await supabase.from('dist_dte').select('*, dist_clientes(nombre)').eq('id', id).single();
    if (error) throw error;
    return data;
}

async function invocar(body) {
    const { data, error } = await supabase.functions.invoke('distribucion-dte', { body });
    if (error) {
        // supabase-js deja el cuerpo del error en `context`: ahí está el motivo real.
        let motivo = error.message;
        try { motivo = (await error.context?.json())?.error ?? motivo; } catch { /* cuerpo no JSON */ }
        throw new Error(motivo);
    }
    return data;
}

export const facturarPedido = (pedidoId) => invocar({ accion: 'facturar', pedido_id: pedidoId });
export const reintentarDocumento = (dteId) => invocar({ accion: 'transmitir', dte_id: dteId });
