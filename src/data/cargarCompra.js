import { supabase } from '../supabaseClient';

// Cargar compra desde el documento — la capa de datos.
//
// **Nada de esto escribe en el sistema de origen.** La pantalla arma la compra
// y la muestra; registrarla allá es un paso posterior que todavía no existe.
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
export async function confirmarProducto(emisorNit, codigoProveedor, productId) {
    const { error } = await supabase.rpc('confirmar_alias_producto', {
        p_emisor_nit: emisorNit,
        p_codigo_prov: codigoProveedor,
        p_product_id: Number(productId),
    });
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
export async function apartarRenglon(id, deshacer = false) {
    const { error } = await supabase.rpc('ignorar_renglon_pendiente', {
        p_id: id, p_motivo: null, p_deshacer: deshacer,
    });
    return { error: error?.message ?? null };
}

/** Buscar un producto para corregir a mano lo que el matcher no acertó. */
export async function buscarProductos(texto, limite = 12) {
    const q = String(texto ?? '').trim();
    if (q.length < 3) return { filas: [], error: null };
    const { data, error } = await supabase
        .from('products')
        .select('id, nombre, codigo_barras')
        .ilike('nombre', `%${q}%`)
        .eq('activo', true)
        .order('nombre')
        .limit(limite);
    if (error) return { filas: [], error };
    return { filas: data ?? [], error: null };
}
