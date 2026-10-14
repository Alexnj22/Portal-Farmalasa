import { supabase } from '../supabaseClient';
import { anotar } from './audit';

/**
 * Chat con los clientes de la app Puntos Salud (2026-10-12).
 *
 * Un cliente tiene UNA conversación (`app_chat_conversaciones.customer_id` es
 * único); contesta cualquiera con el permiso `chat_clientes`. Todo lo que
 * escribe el equipo pasa por funciones de la base con su propia guarda
 * (`chat_responder`, `chat_tomar`, `chat_resolver`, `cliente_foto_quitar`): la
 * conversación se actualiza sola por el trigger de cada mensaje, y el aviso al
 * teléfono del cliente sale de `chat_responder`.
 *
 * Los archivos viven en el bucket PRIVADO `app-clientes-archivos`: el portal
 * los lee con URL firmada (la policy decide por carpeta) y sube las fotos del
 * equipo a `chat/<cliente>/equipo/…`, que es lo único que la policy de INSERT
 * le deja escribir.
 *
 * Ninguna lectura se acerca a 1000 filas: la bandeja trae 40 por página (la
 * función lo fija) y los mensajes se piden de a 50.
 */

export const BUCKET_APP_CLIENTES = 'app-clientes-archivos';
export const MENSAJES_POR_PAGINA = 50;
const FIRMA_SEGUNDOS = 3600;

const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

/** Firma varias rutas del bucket en una sola llamada. Devuelve `Map<ruta, url>`. */
export async function firmarRutas(rutas) {
    const unicas = [...new Set((rutas || []).filter(Boolean))];
    if (!unicas.length) return new Map();
    const { data, error } = await supabase.storage.from(BUCKET_APP_CLIENTES).createSignedUrls(unicas, FIRMA_SEGUNDOS);
    if (error) {
        console.error('chatClientes.js: no se pudieron firmar los archivos', error);
        return new Map();
    }
    return new Map((data ?? []).filter((f) => f.signedUrl).map((f) => [f.path, f.signedUrl]));
}

/** Una sola ruta firmada (la receta de una reserva, la foto ampliada). */
export async function firmarRuta(ruta, segundos = FIRMA_SEGUNDOS) {
    if (!ruta) return null;
    const { data, error } = await supabase.storage.from(BUCKET_APP_CLIENTES).createSignedUrl(ruta, segundos);
    if (error) {
        console.error('chatClientes.js: no se pudo firmar', error);
        return null;
    }
    return data?.signedUrl ?? null;
}

// ── Bandeja ─────────────────────────────────────────────────────────────────

/**
 * Las conversaciones, la más reciente primero (40 por página). `antes` es el
 * `ultimo_mensaje_at` de la última fila de la página anterior.
 * `estado`: 'abierta' | 'resuelta'.
 */
export async function fetchConversaciones(estado = 'abierta', antes = null) {
    const filas = sinError(await supabase.rpc('chat_conversaciones', { p_estado: estado, p_antes: antes })) ?? [];
    const firmadas = await firmarRutas(filas.map((f) => f.foto_ruta));
    return filas.map((f) => ({ ...f, foto_url: f.foto_ruta ? firmadas.get(f.foto_ruta) ?? null : null }));
}

/**
 * Los mensajes de una conversación, en orden de llegada. Sin cursores trae los
 * últimos 50; `antesDe` (un id) pide la página anterior y `despuesDe` (un id)
 * sólo lo que llegó después — es lo que usa el refresco en vivo para no volver
 * a bajar el hilo entero.
 */
export async function fetchMensajes(conversacionId, { antesDe = null, despuesDe = null } = {}) {
    // `cita` es el mensaje al que responde (`respuesta_a`), para su recorte.
    let q = supabase.from('app_chat_mensajes')
        .select('id, autor, employee_id, texto, foto_ruta, adjunto, created_at, respuesta_a, cita:respuesta_a(id, autor, employee_id, texto, foto_ruta)')
        .eq('conversacion_id', Number(conversacionId));
    if (antesDe != null) q = q.lt('id', Number(antesDe));
    if (despuesDe != null) q = q.gt('id', Number(despuesDe));
    const filas = sinError(await q.order('id', { ascending: false }).limit(MENSAJES_POR_PAGINA)) ?? [];
    const firmadas = await firmarRutas(filas.map((f) => f.foto_ruta));
    return filas
        .map((f) => ({ ...f, foto_url: f.foto_ruta ? firmadas.get(f.foto_ruta) ?? null : null }))
        .reverse();
}

/** Las fichas de quienes contestaron, para su nombre corto y su foto. */
export async function fetchAutoresDelEquipo(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return [];
    return sinError(await supabase.from('employees')
        .select('id, name, first_names, last_names, photo_url')
        .in('id', unicos)
        .limit(200)) ?? [];
}

// ── Quién escribe y si el cliente ya leyó (2026-10-12) ─────────────────────

/** Las columnas de «presencia» de una conversación: no las trae la bandeja. */
export const COLUMNAS_PRESENCIA = ['sin_leer_cliente', 'escribiendo_por', 'escribiendo_at', 'cliente_escribiendo_at', 'visto_equipo_at'];

/**
 * La presencia de las conversaciones que están en pantalla: quién del equipo
 * escribe, si el cliente escribe y si ya leyó lo nuestro (`sin_leer_cliente`
 * en 0). `chat_conversaciones` no las devuelve; se leen aparte, sólo para los
 * ids de la bandeja (≤400: el tope de 10 páginas de 40). Devuelve `Map<id, fila>`.
 */
export async function fetchPresenciaDeConversaciones(ids) {
    const unicos = [...new Set((ids || []).filter((x) => x != null).map(Number))];
    if (!unicos.length) return new Map();
    const filas = sinError(await supabase.from('app_chat_conversaciones')
        .select(`id, ${COLUMNAS_PRESENCIA.join(', ')}`)
        .in('id', unicos)
        .limit(500)) ?? [];
    return new Map(filas.map((f) => [f.id, f]));
}

/** «Estoy escribiendo»: vale 6 s. El compositor la llama a lo sumo cada 3 s. */
export async function marcarEscribiendo(conversacionId) {
    return sinError(await supabase.rpc('chat_escribiendo', { p_conversacion: Number(conversacionId) }));
}

// ── Acciones ────────────────────────────────────────────────────────────────

/** «Estoy respondiendo»: vence sola a los 10 minutos. `soltar` la libera. */
export async function tomarConversacion(conversacionId, soltar = false) {
    return sinError(await supabase.rpc('chat_tomar', { p_conversacion: Number(conversacionId), p_soltar: !!soltar }));
}

/**
 * Responde con texto, una foto ya subida (`fotoRuta`) o un adjunto
 * (`{ tipo: 'producto', id, nombre, precio }` | `{ tipo: 'oferta', id, titulo }`).
 * El mensaje mismo es el registro: lleva la ficha de quien lo escribió.
 */
export async function responderConversacion(conversacionId, { texto = '', fotoRuta = null, adjunto = null, respuestaA = null } = {}) {
    return sinError(await supabase.rpc('chat_responder', {
        p_conversacion: Number(conversacionId),
        p_texto: String(texto ?? '').trim() || null,
        p_foto_ruta: fotoRuta,
        p_adjunto: adjunto,
        p_respuesta_a: respuestaA != null ? Number(respuestaA) : null,
    }));
}

// ── Reacciones (2026-10-12) ─────────────────────────────────────────────────

/** Los seis emojis que se pueden poner (los mismos que acepta la base). */
export const EMOJIS_DE_REACCION = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
const IDS_POR_TANDA = 100;
const REACCIONES_POR_TANDA = 900;

/**
 * Las reacciones de los mensajes que están en pantalla. `mensaje_id` se repite
 * (una reacción por persona y mensaje), así que acotar la entrada no acota la
 * salida: va en tandas de 100 mensajes con tope de 900 filas cada una — con
 * seis emojis y una reacción por persona, 9 por mensaje es un hilo con nueve
 * personas reaccionando a TODO. Si una tanda vuelve llena, se avisa.
 */
export async function fetchReacciones(mensajeIds) {
    const ids = [...new Set((mensajeIds || []).filter((x) => x != null).map(Number))];
    if (!ids.length) return [];
    const tandas = [];
    for (let i = 0; i < ids.length; i += IDS_POR_TANDA) tandas.push(ids.slice(i, i + IDS_POR_TANDA));
    const resultados = await Promise.all(tandas.map(async (tanda) => {
        const filas = sinError(await supabase.from('app_chat_reacciones')
            .select('id, mensaje_id, autor, employee_id, emoji')
            .in('mensaje_id', tanda)
            .order('id', { ascending: true })
            .limit(REACCIONES_POR_TANDA)) ?? [];
        if (filas.length >= REACCIONES_POR_TANDA) console.warn('chatClientes.js: una tanda de reacciones llegó al tope; pueden faltar');
        return filas;
    }));
    return resultados.flat();
}

/** Pone (o cambia) mi reacción a un mensaje; `null` la quita. */
export async function reaccionarAMensaje(mensajeId, emoji) {
    return sinError(await supabase.rpc('chat_reaccionar', { p_mensaje: Number(mensajeId), p_emoji: emoji ?? null }));
}

/** Sube una foto del equipo al chat de ese cliente y devuelve su ruta. */
export async function subirFotoDelEquipo(customerId, archivo) {
    // Del navegador llega un `File`; de la app, `{ body: ArrayBuffer, contentType }`.
    const tipo = archivo?.type || archivo?.contentType || 'image/jpeg';
    const ext = tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : tipo === 'image/heic' ? 'heic' : 'jpg';
    const ruta = `chat/${Number(customerId)}/equipo/${Date.now()}.${ext}`;
    sinError(await supabase.storage.from(BUCKET_APP_CLIENTES).upload(ruta, archivo?.body ?? archivo, { contentType: tipo, upsert: false }));
    return ruta;
}

export async function resolverConversacion(conversacionId) {
    const r = sinError(await supabase.rpc('chat_resolver', { p_conversacion: Number(conversacionId) }));
    anotar('CHAT_CLIENTE_RESOLVER', String(conversacionId), {});
    return r;
}

/**
 * Las etiquetas de una conversación (= de ese cliente): reemplaza la lista
 * entera. Claves del catálogo `ETIQUETAS` de `utils/chatClientes`; la base las
 * valida con su CHECK y `chat_etiquetar` exige `chat_clientes` para editar.
 */
export async function etiquetarConversacion(conversacionId, etiquetas, antes = []) {
    const lista = [...new Set((etiquetas || []).filter(Boolean))];
    const r = sinError(await supabase.rpc('chat_etiquetar', { p_conversacion: Number(conversacionId), p_etiquetas: lista }));
    anotar('CHAT_CLIENTE_ETIQUETAR', String(conversacionId), { antes, despues: lista });
    return r;
}

/**
 * Las calificaciones que dejaron los clientes en los últimos `dias` días, para
 * el promedio del encabezado. Una fila por conversación calificada; tope de
 * 500 deliberado (no el de PostgREST): 500 calificaciones en un mes es otro
 * volumen de chat y el promedio de esas ya dice lo mismo.
 */
export async function fetchCalificacionesRecientes(dias = 30) {
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    return sinError(await supabase.from('app_chat_conversaciones')
        .select('id, calificacion, calificada_at')
        .not('calificacion', 'is', null)
        .gte('calificada_at', desde)
        .order('calificada_at', { ascending: false })
        .limit(500)) ?? [];
}

/** Quita la foto de perfil de un cliente (puede subir otra desde la app). */
export async function quitarFotoDeCliente(customerId) {
    const r = sinError(await supabase.rpc('cliente_foto_quitar', { p_customer: Number(customerId) }));
    anotar('CLIENTE_FOTO_QUITAR', String(customerId), {});
    return r;
}

// ── Respuestas rápidas (compartidas por todo el equipo) ─────────────────────

export async function fetchRespuestasRapidas() {
    return sinError(await supabase.from('app_chat_respuestas')
        .select('id, titulo, texto, creada_por, created_at')
        .order('titulo', { ascending: true })
        .limit(200)) ?? [];
}

/** `employeeId` es la FICHA (la policy exige `creada_por = auth_employee_id()`). */
export async function guardarRespuestaRapida({ titulo, texto }, employeeId) {
    const fila = sinError(await supabase.from('app_chat_respuestas')
        .insert({ titulo: String(titulo).trim().slice(0, 60), texto: String(texto).trim().slice(0, 1000), creada_por: employeeId })
        .select('id').single());
    anotar('CHAT_RESPUESTA_CREAR', String(fila.id), { titulo });
    return fila.id;
}

export async function borrarRespuestaRapida(id) {
    // `.select()` para saber si la borró: sin policy, el DELETE devuelve cero filas y ningún error.
    const filas = sinError(await supabase.from('app_chat_respuestas').delete().eq('id', Number(id)).select('id'));
    if (!filas?.length) throw new Error('No tienes permiso para borrar esa respuesta.');
    anotar('CHAT_RESPUESTA_BORRAR', String(id), {});
}

// ── Lo que se puede adjuntar ────────────────────────────────────────────────

/** Las ofertas que el cliente ve hoy en la app (publicadas y vigentes). */
export async function fetchOfertasVigentes(hoy) {
    return sinError(await supabase.from('ofertas_clientes')
        .select('id, titulo, etiqueta, fin')
        .eq('publicada', true)
        .lte('inicio', hoy)
        .gte('fin', hoy)
        .order('fin', { ascending: true })
        .limit(100)) ?? [];
}

// ── La burbuja y el panel del cliente (2026-10-12) ─────────────────────────

/**
 * Cuántos mensajes de clientes esperan respuesta en TODAS las conversaciones
 * abiertas — el número de la burbuja flotante. Devuelve `Map<id, sin_leer>`. No sale de la bandeja (que
 * trae 40 por página): se suma aparte, sólo sobre las que tienen algo sin
 * leer, así que el tope no recorta nada que importe (500 conversaciones con
 * mensajes sin leer a la vez es otro problema).
 */
export async function fetchSinLeerDelChat() {
    const filas = sinError(await supabase.from('app_chat_conversaciones')
        .select('id, sin_leer_equipo')
        .eq('estado', 'abierta')
        .gt('sin_leer_equipo', 0)
        .limit(500)) ?? [];
    // Por conversación y no la suma: así la burbuja aplica cada aviso de
    // realtime sobre su fila sin tener que volver a preguntar.
    return new Map(filas.map((f) => [f.id, Number(f.sin_leer_equipo) || 0]));
}

/**
 * Todo lo que sirve tener a mano mientras se le contesta a un cliente, en UNA
 * llamada (`chat_cliente_contexto`, DEFINER con la guarda de `chat_clientes`:
 * quien contesta el chat no necesariamente puede leer ventas, puntos o
 * reservas). Contrato:
 *
 *   { customer_id, cliente, telefono, foto_ruta, es_team, es_mayoreo, rango,
 *     compra_12m, nivel, saldo_puntos,
 *     compras:      [{ id, fecha, hora, tipo_documento, total, sala, n_productos,
 *                      productos: [{ descripcion, cantidad, total }] }]   ← 10, ≤30 renglones
 *     reservas:     [{ id, estado, pedido, producto_nombre, cantidad, entrega,
 *                      receta_estado, vence_at, created_at, sala }]       ← vivas, ≤20
 *     tratamientos: [{ id, nombre, intervalo_dias, ultima_compra, se_acaba, estado }] }
 *
 * `null` si el cliente ya no existe.
 */
export async function fetchContextoCliente(customerId) {
    const ctx = sinError(await supabase.rpc('chat_cliente_contexto', { p_customer: Number(customerId) }));
    if (!ctx) return null;
    const foto = ctx.foto_ruta ? await firmarRuta(ctx.foto_ruta) : null;
    return {
        ...ctx,
        foto_url: foto,
        compras: ctx.compras ?? [],
        reservas: ctx.reservas ?? [],
        tratamientos: ctx.tratamientos ?? [],
    };
}

// ── Incumplimientos (2026-10-14) ─────────────────────────────────────────

/**
 * Las esperas que pasaron de 20 minutos con el chat asignado a alguien que no
 * contestó (las registra `chat_vigilar_espera`), de los últimos `dias` días,
 * la más reciente primero. Tope de 300 deliberado (no el de PostgREST): 300
 * incumplimientos en un mes es otro problema, y la lista ya lo dice.
 * El cliente viene por la conversación; si la policy de `customers` no deja
 * leerlo, llega `null` y la vista lo completa con la bandeja.
 */
export const TOPE_INCUMPLIMIENTOS = 300;
export async function fetchIncumplimientosDelChat(dias = 30) {
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    return sinError(await supabase.from('app_chat_incumplimientos')
        .select('id, conversacion_id, employee_id, branch_id, esperando_desde, minutos, created_at, sala:branches(name), conversacion:app_chat_conversaciones(customer_id, cliente:customers(name))')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(TOPE_INCUMPLIMIENTOS)) ?? [];
}
