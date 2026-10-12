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
    let q = supabase.from('app_chat_mensajes')
        .select('id, autor, employee_id, texto, foto_ruta, adjunto, created_at')
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
export async function responderConversacion(conversacionId, { texto = '', fotoRuta = null, adjunto = null } = {}) {
    return sinError(await supabase.rpc('chat_responder', {
        p_conversacion: Number(conversacionId),
        p_texto: String(texto ?? '').trim() || null,
        p_foto_ruta: fotoRuta,
        p_adjunto: adjunto,
    }));
}

/** Sube una foto del equipo al chat de ese cliente y devuelve su ruta. */
export async function subirFotoDelEquipo(customerId, archivo) {
    const tipo = archivo?.type || 'image/jpeg';
    const ext = tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : tipo === 'image/heic' ? 'heic' : 'jpg';
    const ruta = `chat/${Number(customerId)}/equipo/${Date.now()}.${ext}`;
    sinError(await supabase.storage.from(BUCKET_APP_CLIENTES).upload(ruta, archivo, { contentType: tipo, upsert: false }));
    return ruta;
}

export async function resolverConversacion(conversacionId) {
    const r = sinError(await supabase.rpc('chat_resolver', { p_conversacion: Number(conversacionId) }));
    anotar('CHAT_CLIENTE_RESOLVER', String(conversacionId), {});
    return r;
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
