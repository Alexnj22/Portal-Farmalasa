import { supabase } from '../supabaseClient';
import { buscarProductos as buscarPorRegla } from './busquedaProductos';
import { anotar } from './audit';

// Cargar compra desde el documento — la capa de datos.
//
// **Nada de esto escribe en el sistema de origen.** La pantalla arma la compra
// y la muestra, y `simularCarga` arma el formulario exacto que se mandaría y lo
// revisa — sólo leyendo del otro lado. `enviarCarga` manda la revisada; la
// función la tiene detrás de un interruptor (docs/PLAN-CARGAR-COMPRAS-EN-BODEGA-2026-10-29.md).
//
// La propuesta la calcula la edge function `leer-dte-json`, que es la única que
// puede leer el JSON y el PDF del bucket privado. Se la invoca con la sesión de
// quien mira la pantalla —la función comprueba el permiso del módulo— y no con
// el secreto de servicio, que es sólo para los barridos desde Postgres.

/** Los documentos recibidos que todavía no tienen compra registrada. */
export async function fetchDocumentosSinCargar(dias = 60) {
    const { data, error } = await supabase.rpc('get_documentos_sin_cargar', { p_dias: dias });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

/**
 * Lo que pasó con cada documento al mandarlo a Bodega desde el portal:
 * `{ document_id: { estado, erp_compra_id, updated_at } }`, con el envío MÁS
 * RECIENTE de cada uno. Las revisiones (`simulada`) no cuentan: revisar no es
 * procesar. Sin fila, el documento está pendiente.
 *
 * Por tandas de 200 ids: `document_id` se repite (un reintento deja otra fila),
 * así que acotar la entrada no acota la salida — pero sin las revisiones son
 * pocas filas por documento, muy lejos del techo de 1000.
 */
export async function fetchEstadosDeCarga(documentIds = []) {
    const ids = [...new Set(documentIds.filter(Boolean))];
    const tandas = [];
    for (let i = 0; i < ids.length; i += 200) tandas.push(ids.slice(i, i + 200));
    const res = await Promise.all(tandas.map((t) => supabase.from('compra_carga')
        .select('document_id, estado, erp_compra_id, updated_at')
        .in('document_id', t).neq('estado', 'simulada')));
    const err = res.find((r) => r.error)?.error;
    if (err) return { estados: {}, error: err };
    const estados = {};
    for (const r of res.flatMap((x) => x.data ?? [])) {
        const prev = estados[r.document_id];
        if (!prev || r.updated_at > prev.updated_at) estados[r.document_id] = r;
    }
    return { estados, error: null };
}

/**
 * Pistas para la cola, por documento: la compra que PARECE ser la misma
 * cargada a mano con otro número (`compra`), y si el proveedor está
 * clasificado como gasto (`gasto`, el nombre de la categoría). Es una
 * sugerencia: nada sale de la cola hasta que alguien la confirma.
 */
export async function fetchPistasSinCargar(documentIds = []) {
    const ids = [...new Set(documentIds.filter(Boolean))];
    if (!ids.length) return { pistas: {}, error: null };
    const { data, error } = await supabase.rpc('get_pistas_documentos_sin_cargar', { p_ids: ids });
    if (error) return { pistas: {}, error };
    return { pistas: Object.fromEntries((data ?? []).map(r => [r.document_id, r])), error: null };
}

/**
 * Saca un documento de la cola por decisión de una persona:
 *   'cargada_a_mano' (con la compra que es), 'no_va_a_bodega' (sólo éste), o
 *   'proveedor_no_va' (todo lo de ese proveedor, hoy y en adelante).
 */
export async function resolverDocumento(documentId, motivo, receiptId = null) {
    const { data, error } = await supabase.rpc('compra_resolver_documento', {
        p_document_id: documentId, p_motivo: motivo, p_receipt_id: receiptId,
    });
    return { data, error: error?.message ?? null };
}

/**
 * La compra armada de un documento: encabezado y renglones, cada uno diciendo
 * **de dónde salió** su producto (código de barras, diccionario o parecido) y
 * su lote y vencimiento (la descripción o el PDF).
 *
 * Medido sobre 36 facturas de 12 proveedores: 94.3% de los renglones con
 * producto propuesto, 93.5% con lote, 92.1% con vencimiento.
 */
export async function fetchPropuesta(documentId) {
    const { data, error } = await supabase.functions.invoke('leer-dte-json', {
        body: { document_ids: [documentId], modo: 'propuesta', max_items: 30 },
    });
    if (error) return { propuesta: null, error: error.message ?? 'No se pudo leer el documento.' };
    const doc = data?.documentos?.[0];
    if (!doc) return { propuesta: null, error: 'El documento no devolvió nada.' };
    if (doc.error) return { propuesta: null, error: doc.error };
    return { propuesta: doc, error: null };
}

/**
 * Guardar que ese código de ese proveedor ES ese producto.
 *
 * Es la pieza que hace que el trabajo baje solo: está medido que **el 87% de
 * los renglones usan un código de proveedor que se repite**, así que cada
 * confirmación deja de preguntarse para siempre. El diccionario **no aprende de
 * lo que adivinó el parecido de nombre** — sólo de esto y del código de barras.
 */
//
// Anota su propia entrada en la bitácora (D3, 2026-09-28). `contexto` lleva lo
// legible que sólo la pantalla conoce (el nombre del proveedor y del producto).
//
// `factor`: cuántas unidades del producto trae cada unidad que factura el
// proveedor («CJA 10 U» → 10). Se aprende junto con el producto.
export async function confirmarProducto(emisorNit, codigoProveedor, productId, contexto = {}, factor = 1) {
    const { error } = await supabase.rpc('confirmar_alias_producto', {
        p_emisor_nit: emisorNit,
        p_codigo_prov: codigoProveedor,
        p_product_id: Number(productId),
        p_factor: Number(factor) > 0 ? Number(factor) : 1,
    });
    if (!error) {
        anotar('COMPRA_ALIAS_CONFIRMADO', productId, { codigo: codigoProveedor, factor, ...contexto });
    }
    return { error: error?.message ?? null };
}

/**
 * La lista completa de preguntas distintas, ordenada por cuánto destraba cada
 * una.
 *
 * Es lo que evita abrir factura por factura: la pregunta es
 * `(proveedor, su código)`, no `renglón`, y está medido que el 87% de los
 * renglones usan un código que se repite. Responder la primera de la lista
 * resuelve más renglones que responder cualquier otra.
 *
 * **El estado lo recorta la BASE, no el navegador**, y no es un detalle: son
 * 3,016 renglones distintos y la consulta trae 500. Ordenados con los
 * pendientes adelante —que son 3,003—, un apartado o un confirmado no entraba
 * nunca en esos 500. El filtro «Todos» mostraba una sola cosa y no había forma
 * de llegar a los otros dos estados desde la pantalla.
 *
 * `estado`: `pendientes` · `apartados` · `resueltos` · `todos`.
 */
export async function fetchProductosPorConfirmar(estado = 'pendientes', limite = 500) {
    const { data, error } = await supabase.rpc('get_productos_por_confirmar', {
        p_estado: estado, p_limite: limite,
    });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}

/**
 * Leer una tanda de documentos para armar esa lista.
 *
 * Corre por tandas y devuelve cuánto queda porque son 615 documentos y una
 * Edge Function vive 150 segundos. **Un documento leído no se vuelve a leer**
 * —la cuenta de renglones se acumula, y leerlo dos veces la inflaría—, así que
 * llamar de más no rompe nada: simplemente no hace nada.
 */
export async function barrerDocumentos({ dias = 90, tanda = 40 } = {}) {
    const { data, error } = await supabase.functions.invoke('leer-dte-json', {
        body: { modo: 'barrido', dias, tanda },
    });
    if (error) return { resultado: null, error: error.message ?? 'No se pudo leer los documentos.' };
    return { resultado: data, error: null };
}

/**
 * Apartar un renglón que no es un producto nuestro (un flete, un servicio).
 *
 * Sin esto la lista no se termina nunca: siempre quedarían abajo las mismas
 * diez líneas que nadie va a emparejar con nada.
 *
 * **Es un clic: no pide motivo.** Preguntarle «¿por qué?» a cada flete costaba
 * una segunda decisión sobre justo los renglones que uno quiere sacarse de
 * encima rápido. Lo que se pierde no es la trazabilidad —la base guarda quién y
 * cuándo, y el portal lo anota en la bitácora—: se pierde una excusa escrita que
 * nadie iba a leer. Y como se ven con el filtro «No son productos», un error se
 * revisa mirando la lista, no leyendo motivos.
 */
//
// Apartar y devolver anotan su entrada en la bitácora desde acá (D3).
export async function apartarRenglon(id, deshacer = false, contexto = {}) {
    const { error } = await supabase.rpc('ignorar_renglon_pendiente', {
        p_id: id, p_motivo: null, p_deshacer: deshacer,
    });
    if (!error) {
        anotar(deshacer ? 'COMPRA_RENGLON_DEVUELTO' : 'COMPRA_RENGLON_APARTADO', id, contexto);
    }
    return { error: error?.message ?? null };
}

/** Buscar un producto para corregir a mano lo que el matcher no acertó. */
export async function buscarProductos(texto, limite = 12) {
    const q = String(texto ?? '').trim();
    if (q.length < 3) return { filas: [], error: null };
    const { data, error, aproximado } = await buscarPorRegla(q, {
        select: 'id, nombre, codigo_barras', limite,
    });
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null, aproximado };
}

/**
 * Armar la compra como la recibiría el otro sistema y revisarla, SIN mandarla.
 *
 * `renglones` lleva sólo las decisiones —`{ [índice]: { product_id, factor,
 * lote, vence } }`—: cantidades, costos y totales la función los vuelve a leer
 * del documento. Devuelve `{ sobre, revision }`; `revision.problemas` vacío
 * significa que se podría mandar.
 */
export async function simularCarga({ documentId, uso, renglones, diasCredito }) {
    const { data, error } = await supabase.functions.invoke('cargar-compra-erp', {
        body: { document_id: documentId, uso, renglones, dias_credito: diasCredito },
    });
    if (error) {
        let msg = error.message;
        try { msg = (await error.context?.json?.())?.error ?? msg; } catch { /* sin cuerpo */ }
        return { resultado: null, error: msg ?? 'No se pudo armar la compra.' };
    }
    if (data?.error) return { resultado: null, error: data.error };
    anotar('COMPRA_SIMULADA', documentId, { uso, carga: data?.carga_id, listo: data?.revision?.listo });
    return { resultado: data, error: null };
}

/**
 * Manda la compra a Bodega: la MISMA que se revisó (`cargaId`). La función
 * vuelve a armarla y se niega si algo cambió. Respuesta:
 * `enviada: true` (con `verificada` y `erp_compra_id`), `false` (no entró, se
 * puede corregir y volver a mandar) o `null` (no se sabe: NO mandar de nuevo).
 */
export async function enviarCarga({ documentId, cargaId, uso, renglones, diasCredito }) {
    const { data, error } = await supabase.functions.invoke('cargar-compra-erp', {
        body: { document_id: documentId, carga_id: cargaId, enviar: true, uso, renglones, dias_credito: diasCredito },
    });
    if (error) {
        let msg = error.message;
        try { msg = (await error.context?.json?.())?.error ?? msg; } catch { /* sin cuerpo */ }
        return { resultado: { enviada: null }, error: msg ?? 'No se supo si entró.' };
    }
    anotar('COMPRA_ENVIADA_A_BODEGA', documentId, {
        carga: cargaId, enviada: data?.enviada, verificada: data?.verificada, compra: data?.erp_compra_id, error: data?.error,
    });
    return { resultado: data, error: data?.error ?? null };
}

/**
 * Producto nuevo copiando a uno parecido — SIMULACRO: arma el alta como la
 * mandaría el sistema y la revisa (que no exista ya, que el precio cubra el
 * costo, que el modelo sirva). No crea nada.
 */
async function invocarProducto(body) {
    const { data, error } = await supabase.functions.invoke('cargar-compra-erp', { body: { accion: 'producto_nuevo', ...body } });
    if (error) {
        let msg = error.message;
        try { msg = (await error.context?.json?.())?.error ?? msg; } catch { /* sin cuerpo */ }
        return { resultado: null, error: msg ?? 'No se pudo revisar el producto.' };
    }
    if (data?.error) return { resultado: null, error: data.error };
    return { resultado: data, error: null };
}

/**
 * Revisa el alta de un producto nuevo sin crearlo. Devuelve lo sugerido
 * (proveedor de la factura, datos del parecido, precio con su margen) y, con
 * `catalogos`, las listas del formulario del sistema.
 */
export async function simularProductoNuevo(datos) {
    return invocarProducto({ ...datos, document_id: datos.documentId, modelo_id: datos.modeloId });
}

/** Lo da de alta de verdad, con lo MISMO que se revisó. */
export async function crearProductoNuevo(datos) {
    const r = await invocarProducto({ ...datos, document_id: datos.documentId, modelo_id: datos.modeloId, crear: true });
    anotar('PRODUCTO_NUEVO_CREADO', r.resultado?.producto?.id ?? datos.modeloId, {
        nombre: datos.nombre, ok: !r.error, verificado: r.resultado?.verificado ?? null, error: r.error,
    });
    return r;
}
