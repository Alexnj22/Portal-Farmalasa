// @ts-nocheck — Las tablas `dist_*` todavía NO existen en producción (viven en
// supabase/borradores/distribucion y sólo en el entorno de pruebas), y
// `gate:tipos` revisa contra los tipos de PRODUCCIÓN (`src/types/database.ts`):
// cada consulta de este archivo salía como «tabla inexistente». Es cierto hoy y
// deja de serlo al migrar: ese día se corre `npm run tipos:base` y se QUITA
// esta línea, para que el archivo entre al contrato como los demás.
// Capa de datos de Distribución — la venta en ruta de la S.A.S.
//
// Todo lo que decide algo vive en la base o en la edge function
// `distribucion-dte`: qué se le puede vender a cada cliente (trigger), el
// precio (sale de la lista de precios, no de lo que mande la pantalla), el tipo de
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
    // El del tope va ANTES: `DIST_DESCUENTO` también está adentro de su código.
    DIST_DESCUENTO_TOPE: 'Ese descuento pasa del tope que fijó la empresa. Pídele a quien administra Distribución que lo autorice.',
    DIST_DESCUENTO: 'El descuento pasa del importe del renglón.',
    DIST_SIN_PRECIO: 'Esa presentación no tiene precio cargado. Revisa el catálogo.',
    DIST_CCF_SIN_NRC: 'Ese cliente no tiene NRC: sólo se le puede emitir Factura.',
    DIST_SIN_PERMISO: 'No tienes permiso para esto en Distribución.',
    DIST_AUTOAPROBAR: 'No puedes decidir un descuento que pediste tú: lo decide otra persona con permiso.',
    DIST_SOLICITUD_RESUELTA: 'Esa solicitud ya se resolvió.',
    DIST_LOTE_AJENO: 'Ese lote no es de ese producto. Vuelve a elegirlo.',
    DIST_RESERVA_AJENA: 'Esta venta la tiene abierta otra persona: sus productos siguen reservados a su nombre.',
    DIST_PAGO_FACTURADO: 'La forma y el monto ya están en el documento: sólo se puede adjuntar el comprobante.',
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
        .select('emisor_id, product_id, precio_con_iva, venta_libre, activo, products(nombre, codigo_barras, es_antibiotico, requiere_receta, regulado)')
        .order('product_id'));
    if (rows === null) throw new Error('No se pudo cargar el catálogo.');
    return rows.map(r => ({
        ...r,
        nombre: r.products?.nombre ?? `Producto ${r.product_id}`,
        codigo_barras: r.products?.codigo_barras ?? null,
        // Lo que la base NO dejaría vender a una tienda aunque se marque venta libre.
        controlado: !!(r.products?.es_antibiotico || r.products?.requiere_receta || r.products?.regulado),
    }));
}

/**
 * Listas de precio y precios por presentación. Una tabla chica (listas) y una
 * que crece con el catálogo (precios): ésa va paginada.
 */
export async function fetchListasYPrecios() {
    const [{ data: listas, error }, precios] = await Promise.all([
        supabase.from('dist_listas').select('id, emisor_id, nombre, orden, activo').order('orden'),
        fetchAllRows(() => supabase.from('dist_precios')
            .select('id, product_id, presentacion, unidades, lista_id, precio_con_iva, activo')
            .eq('activo', true)
            .order('id')),
    ]);
    if (error) throw error;
    if (precios === null) throw new Error('No se pudieron cargar los precios.');
    return { listas: listas ?? [], precios };
}

export async function guardarPrecio(emisorId, productId, cambios) {
    const { error } = await supabase.from('dist_catalogo')
        .update(cambios).eq('emisor_id', emisorId).eq('product_id', productId);
    if (error) throw error;
}

export async function agregarAlCatalogo(emisorId, productId, precioConIva, ventaLibre) {
    const { error } = await supabase.from('dist_catalogo').insert({
        emisor_id: emisorId, product_id: productId, precio_con_iva: precioConIva, venta_libre: ventaLibre,
    });
    if (error) throw error;
}

// ── Pedidos ────────────────────────────────────────────────────────────────

const SELECT_PEDIDO = 'id, cliente_id, vendedor_id, estado, tipo_documento, condicion, forma_pago, plazo_dias, observaciones, created_at, dte_id, descuento_solicitud_id, '
    + 'dist_clientes(nombre, tipo, contribuyente), employees!dist_pedidos_vendedor_id_fkey(name), '
    + 'dist_dte!dist_pedidos_dte_id_fkey(numero_control, estado, total_pagar, tipo), '
    // Los renglones, para el total de una preventa (sin documento todavía no
    // hay `total_pagar`): lo calcula la pantalla con el motor del documento.
    + 'dist_pedido_items(cantidad, precio_con_iva, descuento)';

/** `estados`: sólo esos (p. ej. las preventas por finalizar: `['confirmado']`). */
export async function fetchPedidos({ desde, estados } = {}) {
    const rows = await fetchAllRows(() => {
        let q = supabase.from('dist_pedidos').select(SELECT_PEDIDO).order('created_at', { ascending: false });
        if (desde) q = q.gte('created_at', desde);
        if (estados?.length) q = q.in('estado', estados);
        return q;
    });
    if (rows === null) throw new Error('No se pudieron cargar los pedidos.');
    return rows;
}

/**
 * Lo que un cliente compró en sus últimos pedidos (sin anulados), para
 * «repetir el último pedido» y «lo que suele llevar». En ruta el pedido de una
 * tienda se parece mucho al de la semana pasada: empezar desde ahí ahorra
 * buscar producto por producto. Diez pedidos alcanzan y es una sola consulta.
 */
export async function fetchHistorialDeCliente(clienteId) {
    const { data, error } = await supabase.from('dist_pedidos')
        .select('id, created_at, estado, dist_pedido_items(product_id, presentacion, cantidad, lista_id)')
        .eq('cliente_id', clienteId).neq('estado', 'anulado')
        .order('created_at', { ascending: false }).limit(10);
    if (error) throw error;
    return data ?? [];
}

/** Todo lo que la vista de venta necesita para corregir un pedido por facturar. */
export async function fetchPedidoParaCorregir(pedidoId) {
    const [{ data: pedido, error }, items, pagos] = await Promise.all([
        supabase.from('dist_pedidos')
            .select('id, cliente_id, estado, tipo_documento, condicion, forma_pago, plazo_dias, observaciones, reemplaza_dte_id, descuento_solicitud_id, client_uuid')
            .eq('id', pedidoId).single(),
        fetchItemsDePedido(pedidoId),
        fetchPagos(pedidoId),
    ]);
    if (error) throw error;
    return { pedido, items, pagos };
}

export async function fetchItemsDePedido(pedidoId) {
    const { data, error } = await supabase.from('dist_pedido_items')
        .select('id, product_id, cantidad, precio_con_iva, descuento, descuento_pct, descuento_estado, descuento_pedido, descripcion, presentacion, unidades, lista_id, lote_id')
        .eq('pedido_id', pedidoId).order('id');
    if (error) throw error;
    return data;
}

// Lo que viaja de un renglón. Precio 0 y descripción vacía: los pone el
// trigger desde la lista de precios. El descuento viaja en % o en $ CON IVA,
// nunca los dos: en % el monto lo calcula la base sobre SU precio.
function filaDeRenglon(pedidoId, r) {
    const enPct = r.descuentoTipo === 'pct' && Number(r.descuentoValor) > 0;
    return {
        pedido_id: pedidoId, product_id: r.product_id, cantidad: r.cantidad,
        presentacion: r.presentacion || 'UNIDAD', lista_id: r.lista_id ?? null,
        // El lote que eligió la pantalla (primero vence, primero sale). Al
        // facturar es una PREFERENCIA: si ya no alcanza, la base completa con
        // el siguiente (borrador 0010).
        lote_id: r.lote_id ?? null,
        precio_con_iva: 0, descripcion: '',
        descuento_pct: enPct ? Number(r.descuentoValor) : null,
        descuento: enPct ? 0 : (r.descuentoTipo === 'monto' ? Number(r.descuentoValor) || 0 : 0),
    };
}

/**
 * Crea el pedido y sus renglones. `clientUuid` lo genera la pantalla ANTES de
 * mandar: si la señal se corta y se reintenta, la base rechaza el duplicado
 * por `client_uuid` en vez de crear dos pedidos.
 */
export async function crearPedido({ emisorId, clienteId, tipoDocumento, condicion, plazoDias, formaPago, observaciones, clientUuid, renglones }) {
    const { data: previo, error: ePrev } = await supabase.from('dist_pedidos')
        .select('id').eq('client_uuid', clientUuid).maybeSingle();
    if (ePrev) throw ePrev;
    let pedidoId = previo?.id;
    if (!pedidoId) {
        const { data, error } = await supabase.from('dist_pedidos').insert({
            // vendedor_id lo pone la base (la ficha de quien inserta).
            emisor_id: emisorId, cliente_id: clienteId, tipo_documento: tipoDocumento,
            condicion, plazo_dias: condicion === 2 ? plazoDias : null,
            forma_pago: formaPago, observaciones: observaciones?.trim() || null, client_uuid: clientUuid,
        }).select('id').single();
        if (error) throw error;
        pedidoId = data.id;
    }
    // Los renglones van con precio 0: el trigger pone el del catálogo.
    const { error: eIt } = await supabase.from('dist_pedido_items').upsert(
        renglones.map(r => filaDeRenglon(pedidoId, r)),
        { onConflict: 'pedido_id,product_id,presentacion,lote_id' });
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

/**
 * Corrige un pedido que todavía no se facturó: sus datos y sus renglones.
 * Los renglones que ya no están se borran y el resto se reescribe; el precio
 * lo vuelve a poner el trigger desde el catálogo.
 */
export async function actualizarPedido(pedidoId, { tipoDocumento, condicion, plazoDias, formaPago, observaciones, renglones }) {
    const { error } = await supabase.from('dist_pedidos').update({
        tipo_documento: tipoDocumento, condicion, plazo_dias: condicion === 2 ? plazoDias : null, forma_pago: formaPago,
        observaciones: observaciones?.trim() || null,
    }).eq('id', pedidoId).eq('estado', 'confirmado');
    if (error) throw error;
    // Se borran los renglones que ya no están: la clave es producto +
    // presentación + lote (el mismo producto en dos lotes son dos renglones).
    const clave = (x) => `${x.product_id}|${x.presentacion || 'UNIDAD'}|${x.lote_id ?? ''}`;
    const quedan = new Set(renglones.map(clave));
    const { data: previos, error: ePrev } = await supabase.from('dist_pedido_items')
        .select('id, product_id, presentacion, lote_id').eq('pedido_id', pedidoId);
    if (ePrev) throw ePrev;
    const sobran = (previos ?? []).filter(p => !quedan.has(clave(p))).map(p => p.id);
    if (sobran.length) {
        const { error: eBorrar } = await supabase.from('dist_pedido_items').delete().in('id', sobran);
        if (eBorrar) throw eBorrar;
    }
    const { error: eIt } = await supabase.from('dist_pedido_items').upsert(
        renglones.map(r => filaDeRenglon(pedidoId, r)),
        { onConflict: 'pedido_id,product_id,presentacion,lote_id' });
    if (eIt) throw eIt;
}

/**
 * Pide aprobación para los descuentos que quien vende no puede dar solo. La
 * base ya dejó esos renglones en «pendiente» (y en cero) al guardarlos; esto
 * arma UNA solicitud por venta en Solicitudes y avisa a quien puede decidirla.
 * Si ya no queda nada pendiente, retira la solicitud abierta. Devuelve su id o null.
 */
export async function pedirDescuento(pedidoId, nota) {
    const { data, error } = await supabase.rpc('dist_pedir_descuento', { p_pedido: pedidoId, p_nota: nota?.trim() || null });
    if (error) throw error;
    return data;
}

/**
 * Las solicitudes de descuento, para la sección Solicitudes de la
 * distribuidora. El RLS decide qué llega: quien pidió ve las suyas; quien
 * puede verlas en la sala, todas. Tabla chica por tipo, pero paginada igual.
 */
export async function fetchSolicitudesDescuento() {
    const rows = await fetchAllRows(() => supabase
        .from('approval_requests')
        .select('id, status, note, approver_note, metadata, created_at, updated_at, employee_id, approver_id, '
            + 'solicitante:employees!approval_requests_employee_id_fkey(name), '
            + 'decidio:employees!approval_requests_approver_id_fkey(name)')
        .eq('type', 'DIST_DESCUENTO')
        .order('created_at', { ascending: false }));
    if (rows === null) throw new Error('No se pudieron cargar las solicitudes.');
    return rows;
}

/** Cuántos descuentos esperan decisión (el número del menú de la distribuidora). */
export async function contarDescuentosPendientes() {
    const { count, error } = await supabase.from('approval_requests')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'DIST_DESCUENTO').eq('status', 'PENDING');
    if (error) throw error;
    return count ?? 0;
}

/** Aprueba (aplica a la venta) o rechaza (con motivo) un descuento pedido. */
export async function resolverDescuento(solicitudId, aprobar, nota) {
    const { data, error } = await supabase.rpc('dist_resolver_descuento', {
        p_solicitud: solicitudId, p_aprobar: aprobar, p_nota: nota?.trim() || null,
    });
    if (error) throw error;
    return data;
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
            .select('id, tipo, ambiente, numero_control, codigo_generacion, fec_emi, hor_emi, total_pagar, estado, sello_recibido, '
                + 'descripcion_msg, observaciones_mh, intentos, ultimo_intento_at, pedido_id, invalidacion_estado, reemplazo_id, '
                // Para saber si un rechazo sigue pendiente: su pedido todavía por facturar.
                + 'pedido:dist_pedidos!dist_dte_pedido_fk(estado, dte_id), dist_clientes(nombre)')
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
export const descartarDocumento = (dteId) => invocar({ accion: 'descartar', dte_id: dteId });
/** Documento sellado: abre un pedido nuevo que, al facturarse, lo reemplaza y lo invalida. */
export const corregirDocumentoSellado = (dteId) => invocar({ accion: 'corregir_sellado', dte_id: dteId });
/** Documento sellado sin reemplazo: se deshizo la venta. */
export const anularVenta = (dteId, motivo) => invocar({ accion: 'anular_venta', dte_id: dteId, motivo });
export const reenviarInvalidacion = (dteId) => invocar({ accion: 'enviar_invalidacion', dte_id: dteId });

// ── Pagos ──────────────────────────────────────────────────────────────────

/** Formas que llevan comprobante (CAT-017): todo lo que no es efectivo ni crédito. */
export const LLEVA_COMPROBANTE = new Set(['02', '03', '04', '05', '08', '99']);

export async function fetchPagos(pedidoId) {
    const { data, error } = await supabase.from('dist_pagos')
        .select('id, orden, forma, monto, referencia, efectivo_recibido, comprobante_url, monto_leido, verificacion, nota, lectura')
        .eq('pedido_id', pedidoId).order('orden');
    if (error) throw error;
    return data;
}

/** Cuántos pagos esperan su comprobante (para la tarjeta de la vista). */
export async function contarPagosSinComprobante() {
    const { count, error } = await supabase.from('dist_pagos')
        .select('id', { count: 'exact', head: true }).eq('verificacion', 'pendiente');
    if (error) throw error;
    return count ?? 0;
}

/**
 * Reemplaza las formas de pago de un pedido por facturar. La última puede ir
 * sin monto: es «el resto», y la calcula el servidor al facturar.
 */
export async function guardarPagos(pedidoId, filas) {
    const { error: eBorrar } = await supabase.from('dist_pagos').delete().eq('pedido_id', pedidoId);
    if (eBorrar) throw eBorrar;
    if (!filas.length) return [];
    const { data, error } = await supabase.from('dist_pagos').insert(filas.map((f, i) => ({
        pedido_id: pedidoId, orden: i + 1, forma: f.forma,
        monto: i === filas.length - 1 && f.resto ? null : f.monto,
        referencia: f.referencia?.trim() || null,
        efectivo_recibido: f.forma === '01' && Number(f.recibido) > 0 ? Number(f.recibido) : null,
        // Al corregir un pedido, el comprobante que ya estaba se conserva.
        ...(f.comprobante_url ? {
            comprobante_url: f.comprobante_url, lectura: f.lectura ?? null, monto_leido: f.monto_leido ?? null,
            verificacion: f.verificacion, nota: f.nota ?? null,
        } : {}),
    }))).select('id, orden');
    if (error) throw error;
    return data;
}

/** El archivo en base64, sin prefijo (lo que espera el lector). Puro JS, sin FileReader. */
async function aBase64(archivo) {
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

/**
 * Lee el comprobante y lo cuadra contra el monto. Nunca lanza por la lectura:
 * si el lector no está o falla, devuelve `sinLector` y la pantalla sigue a mano.
 */
export async function leerComprobante(archivo, montoEsperado, forma) {
    const { data, error } = await supabase.functions.invoke('distribucion-comprobante', {
        body: { imagenBase64: await aBase64(archivo), mimeType: archivo.type || 'image/jpeg', esperado: { monto: montoEsperado, forma } },
    });
    if (error) return { sinLector: true, leido: null, coincide: null, error: error.message };
    return data;
}

/** Sube el comprobante al bucket privado. Guarda la URL en formato público (regla 10). */
export async function subirComprobante(archivo, pedidoId) {
    const ext = (archivo.name?.split('.').pop() || 'jpg').toLowerCase();
    const path = `distribucion/${pedidoId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('dist-comprobantes').upload(path, archivo, { contentType: archivo.type });
    if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);
    return supabase.storage.from('dist-comprobantes').getPublicUrl(path).data?.publicUrl ?? null;
}

/** Deja el comprobante y lo que se decidió sobre él en el pago. */
export async function adjuntarComprobante(pagoId, { url, lectura, montoLeido, verificacion, nota }) {
    const { error } = await supabase.from('dist_pagos').update({
        comprobante_url: url, lectura: lectura ?? null, monto_leido: montoLeido ?? null,
        verificacion, nota: nota?.trim() || null,
    }).eq('id', pagoId);
    if (error) throw error;
}

// ── Ventas perdidas ────────────────────────────────────────────────────────
// Lo que un cliente pidió y no se le pudo vender: un producto del catálogo sin
// existencia, un medicamento buscado en la SRS o un insumo escrito a mano. Es
// la lista de compras de la distribuidora (borrador 0010). `reportado_por` lo
// pone la base.

const SELECT_PERDIDA = 'id, cliente_id, product_id, pedido_id, origen, producto, registro_srs, principio_activo, laboratorio, '
    + 'buscado, cantidad, estado, nota, created_at, resuelto_at, dist_clientes(nombre), '
    + 'employees:reportado_por(id, name, photo_url)';

export async function fetchVentasPerdidas({ estado } = {}) {
    const rows = await fetchAllRows(() => {
        let q = supabase.from('dist_ventas_perdidas').select(SELECT_PERDIDA).order('created_at', { ascending: false });
        if (estado) q = q.eq('estado', estado);
        return q;
    });
    if (rows === null) throw new Error('No se pudieron cargar las ventas perdidas.');
    return rows;
}

export async function anotarVentaPerdida({ emisorId, clienteId, productId, pedidoId, origen, producto, registroSrs, principioActivo, laboratorio, buscado, cantidad }) {
    const { data, error } = await supabase.from('dist_ventas_perdidas').insert({
        emisor_id: emisorId, cliente_id: clienteId ?? null, product_id: productId ?? null, pedido_id: pedidoId ?? null,
        origen, producto: producto.trim(), registro_srs: registroSrs || null, principio_activo: principioActivo || null,
        laboratorio: laboratorio || null, buscado: buscado?.trim() || null, cantidad,
    }).select('id').single();
    if (error) throw error;
    return data.id;
}

/** Atendida (se compró / se consiguió) o descartada. Quién y cuándo lo pone la base. */
export async function resolverVentaPerdida(id, estado, nota) {
    const { data, error } = await supabase.from('dist_ventas_perdidas')
        .update({ estado, nota: nota?.trim() || null }).eq('id', id).select('id');
    if (error) throw error;
    // Sin policy que lo deje, el update «funciona» y no cambia nada: se dice.
    if (!data?.length) throw new Error('No tienes permiso para resolver ventas perdidas.');
}

// ── Tablero ────────────────────────────────────────────────────────────────
// Todo el Inicio de la distribuidora en UNA llamada (`dist_tablero`, borrador
// 0011): un solo JSON con las cuentas hechas en la base, así el navegador no
// suma miles de renglones ni cae bajo el techo de 1000 filas.
export async function fetchTablero({ desde, hasta, ruta = null, vendedor = null }) {
    const { data, error } = await supabase.rpc('dist_tablero', {
        p_desde: desde, p_hasta: hasta, p_ruta: ruta || null, p_vendedor: vendedor || null,
    });
    if (error) throw error;
    return data;
}

// ── Reservas (borrador 0012) ─────────────────────────────────────────────────
// Lo que está en una venta —en vivo o guardada como preventa— queda apartado
// 30 minutos desde el primer producto. La pantalla manda el carrito entero
// (por lote) cada vez que cambia; la base aparta lo que siga libre y dice
// quién tiene el resto.
export async function reservar(sesion, { clienteId = null, pedidoId = null, porLote = [] } = {}) {
    const { data, error } = await supabase.rpc('dist_reservar', {
        p_sesion: sesion, p_cliente: clienteId ? Number(clienteId) : null, p_pedido: pedidoId ?? null,
        p_renglones: porLote,
    });
    if (error) throw error;
    return data;
}

/** Las reservas vigentes de todos (para descontar lo que apartaron otras ventas). */
export async function fetchReservasVigentes() {
    const { data, error } = await supabase.rpc('dist_reservas_vigentes');
    if (error) throw error;
    return data ?? [];
}

/** Cuánto falta con Hacienda, por cubeta (el número del menú de Facturación). Borrador 0013. */
export async function contarFacturacionPendiente() {
    const { data, error } = await supabase.rpc('dist_facturacion_pendiente');
    if (error) throw error;
    return data ?? { por_enviar: 0, contingencia: 0, rechazados: 0, invalidaciones: 0 };
}
