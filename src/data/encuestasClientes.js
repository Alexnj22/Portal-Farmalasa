import { supabase } from '../supabaseClient';
import { anotar } from './audit';
import { signPhotosDeep } from '../utils/storageFiles';

/**
 * Encuestas a clientes — migración `encuestas_clientes_base`.
 *
 * El diseño (nombre, cuestionario, canales, fechas, sucursales) se escribe
 * directo: el RLS exige el permiso de diseñar y un trigger rechaza cualquier
 * cambio fuera de borrador. Lo que mueve el CICLO —enviar, aprobar, publicar,
 * cerrar, duplicar— va por RPC, que firma y deja el historial.
 *
 * Ninguna lista se acerca a 1000 filas: son decenas de encuestas al año.
 */

const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

const CAMPOS_DISENO = [
    'nombre', 'objetivo', 'cuestionario', 'canales', 'alcance', 'meta_total', 'fecha_inicio', 'fecha_fin',
    'incentivo_tipo', 'incentivo_puntos', 'incentivo_descripcion', 'texto_consentimiento',
    'mensaje_bienvenida', 'mensaje_cierre',
];

// ── Catálogos ──────────────────────────────────────────────────────────────

/** Las sucursales donde se atiende clientes (no bodega ni administración). */
export async function fetchSalas() {
    const data = sinError(await supabase.from('branches').select('id, name').eq('type', 'FARMACIA').order('name'));
    return data || [];
}

export async function fetchDimensiones() {
    return sinError(await supabase.from('encuesta_cliente_dimensiones')
        .select('clave, nombre, descripcion, color, activo, orden').order('orden')) || [];
}

export async function guardarDimension(dim, nueva) {
    const fila = { nombre: dim.nombre.trim(), descripcion: dim.descripcion?.trim() || null, activo: dim.activo !== false };
    const q = nueva
        ? supabase.from('encuesta_cliente_dimensiones').insert({ ...fila, clave: dim.clave, orden: dim.orden ?? 99 }).select().single()
        : supabase.from('encuesta_cliente_dimensiones').update(fila).eq('clave', dim.clave).select().single();
    const data = sinError(await q);
    anotar(nueva ? 'ENCUESTA_CLIENTE_DIMENSION_CREAR' : 'ENCUESTA_CLIENTE_DIMENSION_EDITAR', data.clave, fila);
    return data;
}

/** Tickets de los últimos 30 días por sucursal, para sugerir la muestra. */
export async function fetchPoblacion() {
    const data = sinError(await supabase.rpc('encuesta_cliente_poblacion'));
    return Object.fromEntries((data || []).map((r) => [r.branch_id, r.tickets]));
}

// ── Encuestas ──────────────────────────────────────────────────────────────

const LISTA_SELECT = 'id, nombre, objetivo, es_plantilla, estado, version, origen_id, canales, alcance, meta_total, '
    + 'fecha_inicio, fecha_fin, incentivo_tipo, incentivo_puntos, created_by, created_at, updated_at, '
    + 'enviada_at, aprobada_at, publicada_at, cerrada_at, cuestionario, sucursales:encuesta_cliente_sucursales(branch_id, meta)';

export async function fetchEncuestas() {
    return sinError(await supabase.from('encuestas_cliente').select(LISTA_SELECT)
        .order('updated_at', { ascending: false })) || [];
}

export async function fetchEncuesta(id) {
    return sinError(await supabase.from('encuestas_cliente')
        .select('*, sucursales:encuesta_cliente_sucursales(branch_id, meta, token)').eq('id', id).maybeSingle());
}

export async function fetchEventos(id) {
    return sinError(await supabase.from('encuesta_cliente_eventos')
        .select('id, tipo, comentario, autor_id, created_at').eq('encuesta_id', id).order('created_at', { ascending: false })) || [];
}

/** Lo que falta para poder enviarla a revisión. Vacío = lista. */
export async function fetchProblemas(id) {
    return sinError(await supabase.rpc('encuesta_cliente_problemas', { p_id: id })) || [];
}

export async function crearEncuesta({ nombre, es_plantilla = false }) {
    const data = sinError(await supabase.from('encuestas_cliente')
        .insert({ nombre: nombre.trim(), es_plantilla }).select('id').single());
    anotar('ENCUESTA_CLIENTE_CREAR', data.id, { nombre, es_plantilla });
    return data.id;
}

/**
 * Guarda el diseño. El constructor lo llama solo, unos instantes después de
 * cada cambio: por eso no se anota cada vez en la bitácora (sería una entrada
 * por tecla) — el historial que importa es el del ciclo.
 */
export async function guardarDiseno(id, cambios) {
    // Sin bitácora a propósito (exención en scripts/auditoria-barrido.mjs): es
    // el autoguardado en cada pausa al teclear; lo que se audita es el ciclo.
    const fila = {};
    for (const k of CAMPOS_DISENO) if (k in cambios) fila[k] = cambios[k];
    if (!Object.keys(fila).length) return null;
    return sinError(await supabase.from('encuestas_cliente').update(fila).eq('id', id).select('id, updated_at').single());
}

/**
 * Deja las sucursales exactamente como `lista` ([{ branch_id, meta }]). Se
 * actualizan las que siguen —no se borran y recrean— para que el QR de cada
 * una conserve su token.
 */
export async function guardarSucursales(id, lista, actuales) {
    const quedan = new Set(lista.map((s) => s.branch_id));
    const habia = new Map((actuales || []).map((s) => [s.branch_id, s]));
    const quitar = [...habia.keys()].filter((b) => !quedan.has(b));
    const nuevas = lista.filter((s) => !habia.has(s.branch_id));
    const cambian = lista.filter((s) => habia.has(s.branch_id) && (habia.get(s.branch_id).meta ?? null) !== (s.meta ?? null));
    if (quitar.length) {
        sinError(await supabase.from('encuesta_cliente_sucursales').delete().eq('encuesta_id', id).in('branch_id', quitar));
    }
    if (nuevas.length) {
        sinError(await supabase.from('encuesta_cliente_sucursales')
            .insert(nuevas.map((s) => ({ encuesta_id: id, branch_id: s.branch_id, meta: s.meta ?? null }))));
    }
    for (const s of cambian) {
        sinError(await supabase.from('encuesta_cliente_sucursales').update({ meta: s.meta ?? null })
            .eq('encuesta_id', id).eq('branch_id', s.branch_id));
    }
    if (quitar.length || nuevas.length || cambian.length) {
        anotar('ENCUESTA_CLIENTE_SUCURSALES', id, {
            quitadas: quitar, agregadas: nuevas.map((s) => s.branch_id), metas: cambian.map((s) => [s.branch_id, s.meta ?? null]),
        });
    }
}

export async function borrarEncuesta(id, nombre) {
    const data = sinError(await supabase.from('encuestas_cliente').delete().eq('id', id).select('id'));
    // Sin policy que lo permita (no es borrador) el delete devuelve cero filas
    // sin error: se dice, no se celebra.
    if (!data?.length) throw new Error('Sólo se puede borrar un borrador.');
    anotar('ENCUESTA_CLIENTE_BORRAR', id, { nombre });
}

// ── El ciclo ───────────────────────────────────────────────────────────────

const ciclo = (fn, accion) => async (id, args = {}) => {
    const data = sinError(await supabase.rpc(fn, { p_id: id, ...args }));
    anotar(accion, String(data?.id || id), args);
    return data;
};

export const enviarARevision = (id, nota) =>
    ciclo('encuesta_cliente_enviar', 'ENCUESTA_CLIENTE_ENVIAR')(id, { p_nota: nota || null });
export const revisarEncuesta = (id, decision, comentario) =>
    ciclo('encuesta_cliente_revisar', decision === 'aprobar' ? 'ENCUESTA_CLIENTE_APROBAR' : 'ENCUESTA_CLIENTE_RECHAZAR')(
        id, { p_decision: decision, p_comentario: comentario || null });
export const publicarEncuesta = (id) => ciclo('encuesta_cliente_publicar', 'ENCUESTA_CLIENTE_PUBLICAR')(id);
export const cerrarEncuesta = (id, motivo) =>
    ciclo('encuesta_cliente_cerrar', 'ENCUESTA_CLIENTE_CERRAR')(id, { p_motivo: motivo || null });
export const archivarEncuesta = (id) => ciclo('encuesta_cliente_archivar', 'ENCUESTA_CLIENTE_ARCHIVAR')(id);

/** Duplica y devuelve el id de la copia (un borrador nuevo). */
export async function duplicarEncuesta(id, comoPlantilla = false) {
    const nuevo = sinError(await supabase.rpc('encuesta_cliente_duplicar', { p_id: id, p_como_plantilla: comoPlantilla }));
    anotar('ENCUESTA_CLIENTE_DUPLICAR', nuevo, { origen: id, plantilla: comoPlantilla });
    return nuevo;
}

// ── Personas (para el historial) ───────────────────────────────────────────

export async function fetchPersonas(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return {};
    const data = sinError(await supabase.from('employees_safe').select('id, name, photo_url').in('id', unicos));
    const firmadas = await signPhotosDeep(data || []);
    return Object.fromEntries((firmadas || []).map((e) => [e.id, { ...e, photo: e.photo || e.photo_url }]));
}

// ── Captura (fase 2) ───────────────────────────────────────────────────────
//
// Las respuestas sólo entran por funciones de la base, que validan contra el
// cuestionario aprobado. El error que lanzan ya viene en palabras del cliente
// («Ese teléfono ya respondió esta encuesta»), así que se pasa tal cual.

const mensajeDe = (error) => new Error(String(error?.message || 'No se pudo enviar').replace(/^.*?:\s(?=[A-ZÁÉÍÓÚ¡¿])/, ''));

/** La encuesta de un QR, sin sesión. `{ estado: 'abierta' | 'cerrada' | 'aun_no' | 'no_disponible' | 'no_existe', … }` */
export async function fetchEncuestaPublica(token) {
    const { data, error } = await supabase.rpc('encuesta_publica', { p_token: token });
    if (error) throw error;
    return data;
}

/** Responder desde el QR o la tablet (`modo: 'tablet'`), sin sesión. */
export async function responderEncuestaPublica(token, { respuestas, contacto, dispositivo, segundos, modo }) {
    const { data, error } = await supabase.rpc('encuesta_publica_responder', {
        p_token: token, p_respuestas: respuestas, p_contacto: contacto || null,
        p_dispositivo: dispositivo, p_duracion: segundos ?? null, p_modo: modo === 'tablet' ? 'tablet' : 'qr',
    });
    if (error) throw mensajeDe(error);
    return data;
}

/** Las encuestas que se pueden aplicar hoy, con sus sucursales y avance. */
export async function fetchParaAplicar() {
    return sinError(await supabase.rpc('encuestas_para_aplicar')) || [];
}

/** Guardar una entrevista. Quien entrevista lo firma la base. */
export async function guardarEntrevista(encuestaId, branchId, { respuestas, contacto, segundos }) {
    const { data, error } = await supabase.rpc('encuesta_cliente_entrevistar', {
        p_id: encuestaId, p_branch: branchId, p_respuestas: respuestas,
        p_contacto: contacto || null, p_duracion: segundos ?? null,
    });
    if (error) throw mensajeDe(error);
    anotar('ENCUESTA_CLIENTE_ENTREVISTA', data?.id, { encuesta: encuestaId, sucursal: branchId });
    return data;
}

/** Avance de una encuesta: total, por sucursal (con su token), por canal y por día. */
export async function fetchAvance(id) {
    return sinError(await supabase.rpc('encuesta_cliente_avance', { p_id: id }));
}

// ── Incentivos (fase 3) ────────────────────────────────────────────────────

/** Los incentivos de una encuesta, con el contacto de la respuesta. */
export async function fetchIncentivos(id) {
    return sinError(await supabase.rpc('encuesta_cliente_incentivos_de', { p_id: id })) || [];
}

/** Quien entrevista confirma que entregó la muestra médica. */
export async function marcarMuestraEntregada(respuestaId) {
    const { data, error } = await supabase.rpc('encuesta_cliente_muestra_entregada', { p_respuesta: respuestaId });
    if (error) throw mensajeDe(error);
    anotar('ENCUESTA_CLIENTE_MUESTRA_ENTREGADA', respuestaId, {});
    return data;
}

/** Asignar a mano la ficha de unos puntos pendientes (se acreditan en el acto). */
export async function asignarIncentivo(incentivoId, customerId) {
    const { data, error } = await supabase.rpc('encuesta_cliente_asignar_incentivo', { p_inc: incentivoId, p_customer: customerId });
    if (error) throw mensajeDe(error);
    anotar('ENCUESTA_CLIENTE_PUNTOS_ASIGNADOS', incentivoId, { customer_id: customerId, estado: data?.estado });
    return data;
}

// ── Resultados (fase 4) ────────────────────────────────────────────────────
//
// Todo se cuenta en la base y llega como un solo objeto: las respuestas crecen
// sin techo y PostgREST corta en 1000 sin avisar.

/** NPS, dimensiones, distribución por pregunta, por sucursal y por canal. */
export async function fetchResultados(id, branchId = null) {
    return sinError(await supabase.rpc('encuesta_cliente_resultados', { p_id: id, p_branch: branchId }));
}

/** Las respuestas abiertas, las 400 más recientes. */
export async function fetchComentarios(id, branchId = null) {
    return sinError(await supabase.rpc('encuesta_cliente_comentarios', { p_id: id, p_branch: branchId })) || [];
}

/** Las rondas de la misma encuesta (versiones publicadas), con su NPS. */
export async function fetchRondas(id) {
    return sinError(await supabase.rpc('encuesta_cliente_rondas', { p_id: id })) || [];
}

/** Una fila por respuesta, para el CSV. */
export async function fetchRespuestasParaExportar(id) {
    return sinError(await supabase.rpc('encuesta_cliente_respuestas_para_exportar', { p_id: id })) || [];
}

/** El resumen de IA guardado y cuántos comentarios nuevos entraron desde entonces. */
export async function fetchResumen(id, branchId = null) {
    return sinError(await supabase.rpc('encuesta_cliente_resumen', { p_id: id, p_branch: branchId }));
}

/** Guarda el resumen para que todos lo vean sin volver a llamar a la IA. */
export async function guardarResumen(id, branchId, texto, hasta) {
    return sinError(await supabase.rpc('encuesta_cliente_guardar_resumen', {
        p_id: id, p_branch: branchId, p_texto: texto, p_hasta: hasta,
    }));
}
