// Cumplimiento sanitario (2026-11-11): los registros que la norma pide en cada
// sala. La base decide el permiso (módulo + pestaña + sala dentro del alcance)
// y valida los campos obligatorios de cada tipo — ver
// supabase/migrations/20261111152646_cumplimiento_sanitario_registros.sql.
import { supabase } from '../supabaseClient';
import { signPhotosDeep } from '../utils/storageFiles';
import { mensajeAmigable } from '../utils/errorMessages';

/** La base escribe el motivo del rechazo en el `hint`, ya en palabras de la sala. */
export const mensajeDeCumplimiento = (e) => e?.hint || mensajeAmigable(e);

/** Por sala: lo que está al día y lo que no. */
export async function fetchResumenDeCumplimiento() {
    const { data, error } = await supabase.rpc('cumplimiento_resumen');
    return { salas: error ? [] : (data ?? []), error };
}

/** Los registros de uno o varios tipos. `branchId` null = todas (si el alcance lo permite). */
export async function fetchRegistrosDeCumplimiento({ tipos, branchId = null, desde = null, hasta = null }) {
    const { data, error } = await supabase.rpc('cumplimiento_lista', {
        p_tipos: tipos,
        p_branch_id: branchId ? Number(branchId) : null,
        p_desde: desde,
        p_hasta: hasta,
    });
    return { registros: error ? [] : (data ?? []), error };
}

/** Crea (id null) o corrige un registro abierto. Devuelve `{ id, error }`. */
export async function guardarRegistroDeCumplimiento({ id = null, branchId, tipo, fecha, datos }) {
    const { data, error } = await supabase.rpc('cumplimiento_guardar', {
        p_id: id ? Number(id) : null,
        p_branch_id: Number(branchId),
        p_tipo: tipo,
        p_fecha: fecha,
        p_datos: datos,
    });
    return { id: data?.id ?? null, error };
}

/** Cierra un registro agregándole los datos del cierre. */
export async function cerrarRegistroDeCumplimiento(id, datos) {
    const { error } = await supabase.rpc('cumplimiento_cerrar', { p_id: Number(id), p_datos: datos || {} });
    return { error };
}

/** Anula con motivo. Nunca se borra. */
export async function anularRegistroDeCumplimiento(id, motivo) {
    const { error } = await supabase.rpc('cumplimiento_anular', { p_id: Number(id), p_motivo: motivo });
    return { error };
}

/** Un retiro de lote anotado una vez para todas las salas. Devuelve `{ salas, error }`. */
export async function avisarRetiroATodas(fecha, datos) {
    const { data, error } = await supabase.rpc('cumplimiento_retiro_a_todas', { p_fecha: fecha, p_datos: datos });
    return { salas: data?.salas ?? 0, error };
}

/** Quién atiende el mostrador de la sala y si tiene su acreditación. */
export async function fetchDependientesDeSala(branchId) {
    if (!branchId) return { personas: [], error: null };
    const { data, error } = await supabase.rpc('cumplimiento_dependientes', { p_branch_id: Number(branchId) });
    if (error) return { personas: [], error };
    const personas = data ?? [];
    await signPhotosDeep(personas);
    return { personas, error: null };
}
