import { supabase } from '../supabaseClient';
import { anotar } from './audit';
import { subirArchivo, signPhotosDeep, signStorageUrls } from '../utils/storageFiles';
import { primerDia } from '../utils/marketing';

/**
 * Planificador de contenido — migración `marketing_planificador`.
 *
 * Lo que se escribe directo (piezas, pauta, solicitudes, comentarios) lo
 * recorta el RLS por permiso del módulo `marketing`. Lo que cambia el ESTADO
 * de la revisión —publicar el mes, aprobar, pedir cambios— va por RPC: un
 * trigger impide que quien edita se dé por aprobado con un `update`.
 *
 * Ninguna lista pasa de 1000 filas: un mes trae decenas de piezas. La única
 * que crece sin techo son las solicitudes, y se cortan en 300 a propósito.
 */

export const BUCKET_MARKETING = 'marketing';
const TOPE_SOLICITUDES = 300;

const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

// ── Catálogos ──────────────────────────────────────────────────────────────

export async function fetchCatalogos() {
    const [marcas, redes] = await Promise.all([
        supabase.from('marketing_marcas').select('id, nombre, color, activo, orden').order('orden').order('nombre'),
        supabase.from('marketing_redes').select('clave, nombre, activo, orden').order('orden'),
    ]);
    return { marcas: sinError(marcas) || [], redes: sinError(redes) || [] };
}

export async function guardarMarca(marca) {
    const fila = { nombre: marca.nombre.trim(), color: marca.color, activo: marca.activo, orden: marca.orden ?? 0 };
    const q = marca.id
        ? supabase.from('marketing_marcas').update(fila).eq('id', marca.id).select().single()
        : supabase.from('marketing_marcas').insert(fila).select().single();
    const data = sinError(await q);
    anotar(marca.id ? 'MARKETING_MARCA_EDITAR' : 'MARKETING_MARCA_CREAR', String(data.id), { nombre: data.nombre });
    return data;
}

export async function activarRed(clave, activo) {
    sinError(await supabase.from('marketing_redes').update({ activo }).eq('clave', clave).select().single());
    anotar('MARKETING_RED_ACTIVAR', clave, { activo });
}

// ── El mes ─────────────────────────────────────────────────────────────────

/** El mes `YYYY-MM`, o `null` si todavía no se empezó a planificar. */
export async function fetchMes(mes) {
    return sinError(await supabase.from('marketing_meses')
        .select('*').eq('mes', primerDia(mes)).maybeSingle());
}

export async function crearMes(mes) {
    const data = sinError(await supabase.from('marketing_meses')
        .insert({ mes: primerDia(mes) }).select().single());
    anotar('MARKETING_MES_CREAR', data.id, { mes: primerDia(mes) });
    return data;
}

export async function actualizarMes(id, cambios) {
    const fila = {
        objetivo: cambios.objetivo?.trim() || null,
        presupuesto_pauta: Number(cambios.presupuesto_pauta) || 0,
    };
    const data = sinError(await supabase.from('marketing_meses').update(fila).eq('id', id).select().single());
    anotar('MARKETING_MES_EDITAR', id, fila);
    return data;
}

export async function publicarMes(mesId, nota) {
    const data = sinError(await supabase.rpc('marketing_publicar_mes', { p_mes_id: mesId, p_nota: nota || null }));
    anotar('MARKETING_MES_PUBLICAR', mesId, { version: data?.version });
    return data;
}

export async function aprobarMes(mesId, texto) {
    const data = sinError(await supabase.rpc('marketing_aprobar_mes', { p_mes_id: mesId, p_texto: texto || null }));
    anotar('MARKETING_MES_APROBAR', mesId, { piezas: data?.piezas_aprobadas });
    return data;
}

// ── Las piezas ─────────────────────────────────────────────────────────────

const PIEZA_SELECT = '*, pauta:marketing_pautas(*), archivos:marketing_archivos(id, url, enlace, nombre, mime, orden, created_at)';

export async function fetchPiezas(mesId) {
    const data = sinError(await supabase.from('marketing_piezas')
        .select(PIEZA_SELECT).eq('mes_id', mesId)
        .order('fecha').order('hora', { nullsFirst: false }));
    // `pauta` llega como objeto (1:1 por PK) o como arreglo según la versión
    // de PostgREST; la pantalla siempre recibe objeto o null.
    return (data || []).map((p) => ({
        ...p,
        pauta: Array.isArray(p.pauta) ? (p.pauta[0] || null) : p.pauta,
        archivos: (p.archivos || []).sort((a, b) => a.orden - b.orden || String(a.created_at).localeCompare(b.created_at)),
    }));
}

const CAMPOS_PIEZA = ['marca_id', 'fecha', 'hora', 'formato', 'redes', 'pilar', 'titulo', 'copy',
    'hashtags', 'notas', 'estado', 'pautar', 'solicitud_id', 'enlace_publicado', 'publicado_en'];

function limpiarPieza(p) {
    const fila = {};
    for (const k of CAMPOS_PIEZA) if (k in p) fila[k] = p[k] === '' ? null : p[k];
    if (typeof fila.titulo === 'string') fila.titulo = fila.titulo.trim();
    return fila;
}

export async function guardarPieza(mesId, pieza) {
    const fila = limpiarPieza(pieza);
    const q = pieza.id
        ? supabase.from('marketing_piezas').update(fila).eq('id', pieza.id).select().single()
        : supabase.from('marketing_piezas').insert({ ...fila, mes_id: mesId }).select().single();
    const data = sinError(await q);
    anotar(pieza.id ? 'MARKETING_PIEZA_EDITAR' : 'MARKETING_PIEZA_CREAR', data.id,
        { titulo: data.titulo, fecha: data.fecha, estado: data.estado });
    return data;
}

/** Mover una pieza de estado (el tablero) o de día (el calendario). */
export async function moverPieza(id, cambios) {
    const data = sinError(await supabase.from('marketing_piezas').update(limpiarPieza(cambios)).eq('id', id).select().single());
    anotar('MARKETING_PIEZA_MOVER', id, cambios);
    return data;
}

export async function borrarPieza(id, titulo, archivos = []) {
    const { error, count } = await supabase.from('marketing_piezas').delete({ count: 'exact' }).eq('id', id);
    if (error) throw error;
    // Sin policy que lo permita (la pieza ya no está pendiente ni en proceso)
    // el DELETE «funciona» y borra cero filas. Eso es un error, no un éxito.
    if (!count) throw new Error('Sólo se puede quitar una pieza pendiente o en proceso.');
    // Las filas de sus archivos se van en cascada; los objetos del bucket no.
    // Se borran después: un archivo huérfano es el error barato.
    const rutas = archivos.map(rutaEnBucket).filter(Boolean);
    if (rutas.length) avisarSiFalla(await supabase.storage.from(BUCKET_MARKETING).remove(rutas), rutas);
    anotar('MARKETING_PIEZA_BORRAR', id, { titulo, archivos: rutas.length });
}

export async function revisarPieza(piezaId, decision, texto) {
    const data = sinError(await supabase.rpc('marketing_revisar_pieza',
        { p_pieza_id: piezaId, p_decision: decision, p_texto: texto || null }));
    anotar(decision === 'aprobar' ? 'MARKETING_PIEZA_APROBAR' : 'MARKETING_PIEZA_CAMBIOS', piezaId, { texto });
    return data;
}

// ── Archivos ───────────────────────────────────────────────────────────────

// La fila ya se borró: si el objeto del bucket no se pudo borrar queda
// huérfano, que no rompe nada en pantalla. No se lanza —la acción del usuario
// sí salió— pero queda en la consola para que no sea un hueco silencioso.
function avisarSiFalla({ error }, rutas) {
    if (error) console.warn('marketing: no se pudo borrar del bucket', rutas, error.message);
}

function rutaEnBucket(archivo) {
    const ruta = archivo?.url?.split(`/${BUCKET_MARKETING}/`)[1];
    return ruta ? decodeURIComponent(ruta.split('?')[0]) : null;
}

function nombreSeguro(nombre) {
    const limpio = String(nombre || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80);
    return limpio || 'archivo';
}

/** Sube un diseño a `<mes>/<pieza>/…`: el RLS del bucket mira la carpeta del mes. */
export async function subirDiseno({ mesId, piezaId, archivo, orden, subidoPor }) {
    const path = `${mesId}/${piezaId}/${Date.now()}-${nombreSeguro(archivo.name)}`;
    const url = await subirArchivo(BUCKET_MARKETING, path, archivo, { contentType: archivo.type });
    const data = sinError(await supabase.from('marketing_archivos').insert({
        pieza_id: piezaId, url, nombre: archivo.name, mime: archivo.type || null,
        orden: orden ?? 0, subido_por: subidoPor,
    }).select().single());
    anotar('MARKETING_ARCHIVO_SUBIR', piezaId, { nombre: archivo.name });
    return data;
}

export async function agregarEnlace({ piezaId, enlace, nombre, orden, subidoPor }) {
    const data = sinError(await supabase.from('marketing_archivos').insert({
        pieza_id: piezaId, enlace: enlace.trim(), nombre: nombre?.trim() || null, orden: orden ?? 0, subido_por: subidoPor,
    }).select().single());
    anotar('MARKETING_ARCHIVO_ENLACE', piezaId, { enlace });
    return data;
}

export async function quitarArchivo(archivo) {
    const { error, count } = await supabase.from('marketing_archivos').delete({ count: 'exact' }).eq('id', archivo.id);
    if (error) throw error;
    if (!count) throw new Error('No se pudo quitar el archivo.');
    // El objeto del bucket se borra después de la fila: si esto falla queda un
    // archivo huérfano, que es el error barato (la fila sin archivo sería el caro).
    const ruta = rutaEnBucket(archivo);
    if (ruta) avisarSiFalla(await supabase.storage.from(BUCKET_MARKETING).remove([ruta]), [ruta]);
    anotar('MARKETING_ARCHIVO_QUITAR', archivo.id, { nombre: archivo.nombre });
}

/**
 * Las URLs firmadas de los diseños de un mes, por URL guardada. Una sola
 * tanda: firmar pieza por pieza serían decenas de peticiones al abrir el mes.
 */
export async function firmarDisenos(piezas) {
    const urls = (piezas || []).flatMap((p) => (p.archivos || []).map((a) => a.url)).filter(Boolean);
    if (!urls.length) return new Map();
    return signStorageUrls(urls);
}

// ── La pauta ───────────────────────────────────────────────────────────────

const CAMPOS_PAUTA = ['redes', 'objetivo', 'publico', 'presupuesto', 'fecha_inicio', 'fecha_fin',
    'gastado', 'alcance', 'impresiones', 'interacciones', 'mensajes', 'clics', 'notas'];
const NUMERICOS = new Set(['presupuesto', 'gastado', 'alcance', 'impresiones', 'interacciones', 'mensajes', 'clics']);

export async function guardarPauta(piezaId, pauta) {
    const fila = { pieza_id: piezaId };
    for (const k of CAMPOS_PAUTA) {
        if (!(k in pauta)) continue;
        const v = pauta[k];
        // Un resultado vacío es «todavía no se anotó», no cero: un cero haría
        // creer que la pauta corrió y no trajo nada.
        fila[k] = v === '' || v == null ? (k === 'presupuesto' ? 0 : null) : (NUMERICOS.has(k) ? Number(v) : v);
    }
    const data = sinError(await supabase.from('marketing_pautas').upsert(fila).select().single());
    anotar('MARKETING_PAUTA_GUARDAR', piezaId, { presupuesto: data.presupuesto, gastado: data.gastado });
    return data;
}

export async function quitarPauta(piezaId) {
    sinError(await supabase.from('marketing_pautas').delete().eq('pieza_id', piezaId));
    anotar('MARKETING_PAUTA_QUITAR', piezaId);
}

// ── Comentarios ────────────────────────────────────────────────────────────

export async function fetchComentarios(mesId) {
    return sinError(await supabase.from('marketing_comentarios')
        .select('id, mes_id, pieza_id, tipo, texto, autor_id, resuelto, created_at')
        .eq('mes_id', mesId).order('created_at')) || [];
}

export async function comentar({ mesId, piezaId, texto, autorId }) {
    const data = sinError(await supabase.from('marketing_comentarios').insert({
        mes_id: mesId, pieza_id: piezaId || null, texto: texto.trim(), autor_id: autorId,
    }).select().single());
    anotar('MARKETING_COMENTAR', piezaId || mesId, { texto: texto.slice(0, 120) });
    return data;
}

export async function marcarResuelto(id, resuelto) {
    sinError(await supabase.from('marketing_comentarios').update({ resuelto }).eq('id', id).select('id').single());
    anotar('MARKETING_COMENTARIO_RESUELTO', id, { resuelto });
}

// ── Solicitudes ────────────────────────────────────────────────────────────

export async function fetchSolicitudes() {
    return sinError(await supabase.from('marketing_solicitudes')
        .select('*').order('created_at', { ascending: false }).limit(TOPE_SOLICITUDES)) || [];
}

export async function crearSolicitud(s, autorId) {
    const data = sinError(await supabase.from('marketing_solicitudes').insert({
        titulo: s.titulo.trim(), descripcion: s.descripcion?.trim() || null, marca_id: s.marca_id || null,
        formato: s.formato || null, fecha_deseada: s.fecha_deseada || null, prioridad: s.prioridad || 'normal',
        solicitado_por: autorId,
    }).select().single());
    anotar('MARKETING_SOLICITUD_CREAR', data.id, { titulo: data.titulo, prioridad: data.prioridad });
    return data;
}

export async function responderSolicitud(id, estado, respuesta) {
    const data = sinError(await supabase.from('marketing_solicitudes')
        .update({ estado, respuesta: respuesta?.trim() || null }).eq('id', id).select().single());
    anotar('MARKETING_SOLICITUD_' + estado.toUpperCase(), id, { respuesta });
    return data;
}

// ── Personas ───────────────────────────────────────────────────────────────

/** Nombre y foto de quienes aparecen (autores de comentarios, solicitantes). */
export async function fetchPersonas(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return {};
    const data = sinError(await supabase.from('employees_safe').select('id, name, photo_url').in('id', unicos));
    const firmadas = await signPhotosDeep(data || []);
    return Object.fromEntries((firmadas || []).map((e) => [e.id, { ...e, photo: e.photo || e.photo_url }]));
}
