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
    // Un código de la base que no está en la lista trae su propia explicación
    // después de los dos puntos (con las cifras reales, p. ej. cuánto debe el
    // cliente): se muestra esa parte y no el código.
    const propio = texto.match(/\bDIST_[A-Z_]+:\s*(.+)$/s);
    if (propio) return propio[1].charAt(0).toUpperCase() + propio[1].slice(1);
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
        .select('emisor_id, product_id, precio_con_iva, venta_libre, activo, costo_promedio, descuento_pct, descuento_desde, descuento_hasta, descuento_max_pct, products(nombre, codigo_barras, es_antibiotico, requiere_receta, regulado)')
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

const SELECT_PEDIDO = 'id, cliente_id, vendedor_id, estado, tipo_documento, condicion, forma_pago, plazo_dias, observaciones, created_at, dte_id, descuento_solicitud_id, desde_camion, '
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
            .select('id, cliente_id, estado, tipo_documento, condicion, forma_pago, plazo_dias, observaciones, reemplaza_dte_id, descuento_solicitud_id, client_uuid, desde_camion')
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
export async function crearPedido({ emisorId, clienteId, tipoDocumento, condicion, plazoDias, formaPago, observaciones, clientUuid, renglones, desdeCamion = false }) {
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
            // Autoventa (0030): sale del camión de quien vende, no de bodega.
            desde_camion: !!desdeCamion,
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
                + 'descripcion_msg, observaciones_mh, intentos, ultimo_intento_at, pedido_id, invalidacion_estado, reemplazo_id, contingencia_id, '
                // Para saber si un rechazo sigue pendiente: su pedido todavía por facturar.
                + 'pedido:dist_pedidos!dist_dte_pedido_fk(estado, dte_id), dist_clientes(nombre, correo), correo:dist_correo_vigente(estado, destinatario, enviado_at)')
            .order('id', { ascending: false });
        if (desde) q = q.gte('fec_emi', desde);
        return q;
    });
    if (rows === null) throw new Error('No se pudieron cargar los documentos.');
    return rows;
}

export async function fetchDocumento(id) {
    const { data, error } = await supabase.from('dist_dte')
        .select('*, dist_clientes(nombre, correo), correo:dist_correo_vigente(estado, destinatario, enviado_at, ultimo_error)').eq('id', id).single();
    if (error) throw error;
    return data;
}

/** Los puntos de venta de los vendedores (borrador 0028): uno por vendedor, se crea al emitir. */
export async function fetchPuntosVenta(emisorId) {
    const { data, error } = await supabase.from('dist_puntos_venta')
        .select('codigo, activo, empleado:employees(id, name)').eq('emisor_id', emisorId).order('codigo');
    if (error) throw error;
    return data ?? [];
}

/**
 * Hasta cuándo se puede invalidar un documento sellado (Normativa DTE v2.0,
 * regla 13.1). El juez es `dist_plazo_invalidacion`, el mismo que consulta la
 * edge function antes de firmar el evento: la pantalla avisa, el servidor frena.
 * → { limite, limite_medicamentos, estado: 'vigente'|'gracia'|'medicamentos'|'vencido', dias }
 */
export async function fetchPlazoInvalidacion(dteId) {
    const { data, error } = await supabase.rpc('dist_plazo_invalidacion_de', { p_dte: dteId });
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

/**
 * Factura un pedido. Con `contingencia` es una venta hecha SIN SEÑAL que se
 * manda al volver: { tipo: 3, emitido_at, codigo_generacion } — el documento
 * sale en modelo diferido con la hora de la venta.
 */
export const facturarPedido = (pedidoId, { contingencia = null } = {}) =>
    invocar({ accion: 'facturar', pedido_id: pedidoId, ...(contingencia ? { contingencia } : {}) });
/** El aviso de contingencia a Hacienda, y después la transmisión de lo que cubre. */
export const enviarContingencia = () => invocar({ accion: 'enviar_contingencia' });

// ── Devoluciones con Nota de Crédito (borrador 0017) ───────────────────────

/** Qué se puede devolver de un documento, por renglón y lote, y si admite nota. */
export async function fetchDevolucionDisponible(dteId) {
    const { data, error } = await supabase.rpc('dist_devolucion_disponible', { p_dte: dteId });
    if (error) throw error;
    return data;
}

/**
 * Emite la Nota de Crédito de una devolución. `renglones`: [{ item_id, lote_id,
 * unidades, destino: 'reingreso'|'cuarentena' }]. Un reintento con el mismo
 * `clientUuid` no emite dos notas.
 */
export const emitirNotaCredito = ({ dteId, clientUuid, motivo, renglones }) =>
    invocar({ accion: 'nota_credito', dte_id: dteId, client_uuid: clientUuid, motivo, renglones });

// ── Correo al cliente (borrador 0019) ──────────────────────────────────────

/**
 * Le manda el documento al cliente. `pdfBase64` lo arma quien llama (la
 * representación gráfica vive en el navegador); el JSON con firma y sello lo
 * arma la función desde la base.
 */
export async function enviarCorreoDocumento(dteId, pdfBase64, { destinatario = null } = {}) {
    const { data, error } = await supabase.functions.invoke('distribucion-correo', {
        body: { dte_id: dteId, pdf_base64: pdfBase64, ...(destinatario ? { destinatario } : {}) },
    });
    if (error) {
        let motivo = error.message;
        try { motivo = (await error.context?.json())?.error ?? motivo; } catch { /* cuerpo no JSON */ }
        throw new Error(motivo);
    }
    return data;
}

// ── Liquidación del vendedor (borrador 0020) ───────────────────────────────

export async function fetchLiquidacion(vendedorId, fecha) {
    const { data, error } = await supabase.rpc('dist_liquidacion', { p_vendedor: vendedorId, p_fecha: fecha });
    if (error) throw error;
    return data;
}

/** Los vendedores que tuvieron movimiento ese día, con su cierre (sólo quien administra). */
export async function fetchLiquidacionesDelDia(fecha) {
    const { data, error } = await supabase.rpc('dist_liquidaciones_del_dia', { p_fecha: fecha });
    if (error) throw error;
    return data ?? [];
}

export async function cerrarLiquidacion(vendedorId, fecha, contado, nota) {
    const { data, error } = await supabase.rpc('dist_cerrar_liquidacion', {
        p_vendedor: vendedorId, p_fecha: fecha, p_contado: contado, p_nota: nota || null,
    });
    if (error) throw error;
    return data;
}

export async function reabrirLiquidacion(id, motivo) {
    const { error } = await supabase.rpc('dist_reabrir_liquidacion', { p_id: id, p_motivo: motivo });
    if (error) throw error;
}

// ── Caja del vendedor y cierre del día (borrador 0024) ─────────────────────

/** Los empleados que pueden vender en la distribuidora (sólo quien administra). */
export async function fetchVendedores() {
    const { data, error } = await supabase.rpc('dist_vendedores');
    if (error) throw error;
    return data ?? [];
}

/** La caja de hoy de quien está vendiendo (el RLS sólo deja ver la propia). */
export async function fetchMiCaja(vendedorId, fecha) {
    if (!vendedorId) return null;
    const { data, error } = await supabase.from('dist_cajas').select('id, estado, fondo').eq('vendedor_id', vendedorId).eq('fecha', fecha).maybeSingle();
    if (error) throw error;
    return data;
}

export async function abrirCaja(vendedorId, fecha, fondo, nota) {
    const { data, error } = await supabase.rpc('dist_abrir_caja', { p_vendedor: vendedorId, p_fecha: fecha, p_fondo: fondo, p_nota: nota || null });
    if (error) throw error;
    return data;
}

/** `tipo`: 'gasto' | 'entrega' (corte parcial, con `contado`) | 'ingreso'. */
export async function movimientoCaja(cajaId, tipo, monto, concepto, contado = null) {
    const { data, error } = await supabase.rpc('dist_movimiento_caja', {
        p_caja: cajaId, p_tipo: tipo, p_monto: monto, p_concepto: concepto, p_contado: contado,
    });
    if (error) throw error;
    return data;
}

export async function anularMovimientoCaja(id, motivo) {
    const { error } = await supabase.rpc('dist_anular_movimiento_caja', { p_id: id, p_motivo: motivo });
    if (error) throw error;
}

export async function fetchCierreDia(fecha) {
    const { data, error } = await supabase.rpc('dist_cierre_dia', { p_fecha: fecha });
    if (error) throw error;
    return data;
}

export async function registrarDeposito(fecha, monto, banco, referencia) {
    const { data, error } = await supabase.rpc('dist_registrar_deposito', { p_fecha: fecha, p_monto: monto, p_banco: banco, p_referencia: referencia });
    if (error) throw error;
    return data;
}

export async function cerrarDia(fecha, nota) {
    const { data, error } = await supabase.rpc('dist_cerrar_dia', { p_fecha: fecha, p_nota: nota || null });
    if (error) throw error;
    return data;
}

export async function reabrirDia(id, motivo) {
    const { error } = await supabase.rpc('dist_reabrir_dia', { p_id: id, p_motivo: motivo });
    if (error) throw error;
}

// ── Reposición (borrador 0025) ─────────────────────────────────────────────

export async function fetchReposicion() {
    const { data, error } = await supabase.rpc('dist_reposicion');
    if (error) throw error;
    return data;
}

/** `null` en los dos = volver al automático. */
export async function fijarMinMax(productId, minimo, maximo) {
    const { error } = await supabase.rpc('dist_fijar_minmax', { p_product: productId, p_minimo: minimo, p_maximo: maximo });
    if (error) throw error;
}

// ── Conteo físico y bajas (borrador 0026) ──────────────────────────────────

export async function fetchConteos() {
    const { data, error } = await supabase.from('dist_conteos').select('id, estado, nota, resumen, created_at, cerrado_at').order('id', { ascending: false }).limit(20);
    if (error) throw error;
    return data ?? [];
}

/** El conteo con sus renglones; a quien no administra no le trae lo que dice el sistema. */
export async function fetchConteo(id) {
    const { data, error } = await supabase.rpc('dist_conteo', { p_id: id });
    if (error) throw error;
    return data;
}

export async function iniciarConteo(productos, nota) {
    const { data, error } = await supabase.rpc('dist_iniciar_conteo', { p_productos: productos, p_nota: nota || null });
    if (error) throw error;
    return data;
}

export async function contar(itemId, contado, nota = null) {
    const { error } = await supabase.rpc('dist_contar', { p_item: itemId, p_contado: contado, p_nota: nota });
    if (error) throw error;
}

export async function cerrarConteo(id, nota) {
    const { data, error } = await supabase.rpc('dist_cerrar_conteo', { p_id: id, p_nota: nota || null });
    if (error) throw error;
    return data;
}

export async function anularConteo(id, motivo) {
    const { error } = await supabase.rpc('dist_anular_conteo', { p_id: id, p_motivo: motivo });
    if (error) throw error;
}

export async function fetchBajas() {
    const { data, error } = await supabase.from('dist_bajas')
        .select('id, lote_id, product_id, unidades, motivo, detalle, estado, costo_unitario, nota_resolucion, created_at, resuelto_at, products(nombre), dist_lotes(lote, vence), solicitante:employees!dist_bajas_solicitado_por_fkey(name)')
        .order('id', { ascending: false }).limit(100);
    if (error) throw error;
    return data ?? [];
}

export async function solicitarBaja(loteId, unidades, motivo, detalle) {
    const { data, error } = await supabase.rpc('dist_solicitar_baja', { p_lote: loteId, p_unidades: unidades, p_motivo: motivo, p_detalle: detalle });
    if (error) throw error;
    return data;
}

export async function resolverBaja(id, aprobar, nota) {
    const { error } = await supabase.rpc('dist_resolver_baja', { p_id: id, p_aprobar: aprobar, p_nota: nota || null });
    if (error) throw error;
}

// ── Rutas y visitas (borrador 0027) ────────────────────────────────────────

export async function fetchRutas() {
    const { data, error } = await supabase.from('dist_rutas')
        .select('id, nombre, vendedor_id, dias, activo, vendedor:employees!dist_rutas_vendedor_id_fkey(name)').order('nombre').limit(999);
    if (error) throw error;
    return data ?? [];
}

export async function guardarRuta({ id = null, nombre, vendedorId, dias, activo = true }) {
    const { data, error } = await supabase.rpc('dist_guardar_ruta', { p_id: id, p_nombre: nombre, p_vendedor: vendedorId || null, p_dias: dias, p_activo: activo });
    if (error) throw error;
    return data;
}

export async function fetchClientesDeRuta(rutaId) {
    const { data, error } = await supabase.from('dist_clientes').select('id, nombre, tipo, complemento, orden_ruta, activo')
        .eq('ruta_id', rutaId).order('orden_ruta', { nullsFirst: false }).order('nombre').limit(999);
    if (error) throw error;
    return data ?? [];
}

export async function ordenarRuta(rutaId, clienteIds) {
    const { error } = await supabase.rpc('dist_ordenar_ruta', { p_ruta: rutaId, p_clientes: clienteIds });
    if (error) throw error;
}

export async function fetchRutaDelDia(vendedorId, fecha) {
    const { data, error } = await supabase.rpc('dist_ruta_del_dia', { p_vendedor: vendedorId, p_fecha: fecha });
    if (error) throw error;
    return data;
}

export async function registrarVisita(clienteId, resultado, { nota = null, lat = null, lng = null } = {}) {
    const { data, error } = await supabase.rpc('dist_registrar_visita', { p_cliente: clienteId, p_resultado: resultado, p_nota: nota, p_lat: lat, p_lng: lng });
    if (error) throw error;
    return data;
}

export async function fetchCuarentena() {
    const { data, error } = await supabase
        .from('dist_cuarentena')
        .select('id, product_id, lote_id, unidades, motivo, estado, nota, created_at, resuelta_at, products(nombre), dist_lotes(lote, vence)')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(999);
    if (error) throw error;
    return data ?? [];
}

export async function resolverCuarentena(id, estado, nota) {
    const { data, error } = await supabase.rpc('dist_resolver_cuarentena', { p_id: id, p_estado: estado, p_nota: nota || null });
    if (error) throw error;
    return data;
}

/** El pedido de una venta por su `client_uuid` (para no facturar dos veces una venta sin señal). */
export async function fetchPedidoPorUuid(clientUuid) {
    const { data, error } = await supabase.from('dist_pedidos').select('id, estado, dte_id').eq('client_uuid', clientUuid).maybeSingle();
    if (error) throw error;
    return data;
}
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

// ── Cuentas por cobrar (borrador 0014) ──────────────────────────────────────
// La cartera nace del documento: la parte a crédito de cada Factura o CCF. El
// cobro lo hace `dist_cobrar` en UNA transacción (bloquea las cuentas del
// cliente, valida contra el saldo, reparte y devuelve el recibo), y un
// reintento con el mismo `clientUuid` devuelve el mismo recibo: no cobra dos veces.

/** Toda la cartera en un JSON: resumen, antigüedad y clientes con saldo. */
export async function fetchCartera() {
    const { data, error } = await supabase.rpc('dist_cartera');
    if (error) throw error;
    return data;
}

/** Cuentas, crédito y cobros de un cliente. */
export async function fetchEstadoCuenta(clienteId) {
    const { data, error } = await supabase.rpc('dist_estado_cuenta', { p_cliente: Number(clienteId) });
    if (error) throw error;
    return data;
}

/** Saldo, vencido y disponible de un cliente (la venta lo muestra al elegirlo). */
export async function fetchCreditoCliente(clienteId) {
    const { data, error } = await supabase.rpc('dist_credito_cliente', { p_cliente: Number(clienteId) });
    if (error) throw error;
    return data;
}

/**
 * Cobra. `aplicacion`: [{ cxc_id, monto }] para repartir a mano, o null para
 * que la base reparta primero lo que vence antes. Devuelve el recibo.
 */
export async function cobrar({ clienteId, monto, forma, clientUuid, referencia = null, recibido = null, nota = null, aplicacion = null }) {
    const { data, error } = await supabase.rpc('dist_cobrar', {
        p_cliente: Number(clienteId), p_monto: monto, p_forma: forma, p_client_uuid: clientUuid,
        p_referencia: referencia, p_recibido: recibido, p_nota: nota,
        p_aplicacion: aplicacion?.length ? aplicacion : null,
    });
    if (error) throw error;
    return data;
}

/** Anula un cobro (sólo quien administra, con motivo): el saldo vuelve. */
export async function anularRecibo(reciboId, motivo) {
    const { data, error } = await supabase.rpc('dist_anular_recibo', { p_recibo: reciboId, p_motivo: motivo });
    if (error) throw error;
    return data;
}

// ── Camiones: autoventa (borrador 0030) ────────────────────────────────────

/** Por camión: la carga abierta, su Nota de Remisión y lo que lleva por lote. */
export async function fetchCamiones() {
    const { data, error } = await supabase.rpc('dist_camiones');
    if (error) throw error;
    return data ?? [];
}

/** Carga el camión de un vendedor: [{ lote_id (bodega), unidades }]. Devuelve la carga. */
export async function cargarCamion(vendedorId, items, nota) {
    const { data, error } = await supabase.rpc('dist_cargar_camion', { p_vendedor: vendedorId, p_items: items, p_nota: nota || null });
    if (error) throw error;
    return data;
}

/** Descarga: [{ lote_id (camión), contado }]. Lo que falta exige nota. */
export async function descargarCamion(vendedorId, contado, nota) {
    const { data, error } = await supabase.rpc('dist_descargar_camion', { p_vendedor: vendedorId, p_contado: contado, p_nota: nota || null });
    if (error) throw error;
    return data;
}

/** Las cargas del camión de un vendedor que se abrieron, cerraron o siguen abiertas ese día (0031). */
export async function fetchCamionDelDia(vendedorId, fecha) {
    const { data, error } = await supabase.rpc('dist_camion_del_dia', { p_vendedor: vendedorId, p_fecha: fecha });
    if (error) throw error;
    return data ?? [];
}

/** La Nota de Remisión que ampara la carga (Código Tributario art. 109). */
export const emitirNotaRemision = (cargaId) => invocar({ accion: 'nota_remision', carga_id: cargaId });
