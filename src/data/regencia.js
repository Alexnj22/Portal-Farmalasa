// La regencia de una sala: el regente asignado, sus horas y sus visitas
// (2026-11-10). La base decide el permiso y valida cada visita
// (`regencia_registrar_visita`: el regente de la sala o la administración,
// horario que no choque con otra visita del mismo regente). Ver
// supabase/migrations/20261111034449_regencia_asistencia_del_regente.sql.
import { supabase } from '../supabaseClient';
import { signPhotosDeep } from '../utils/storageFiles';
import { mensajeAmigable } from '../utils/errorMessages';

/** Las actividades que se pueden anotar en una visita (las valida la base). */
export const ACTIVIDADES_DE_REGENCIA = Object.freeze([
    { value: 'controlados', label: 'Revisión de controlados' },
    { value: 'recetas_antibioticos', label: 'Revisión de recetas de antibióticos' },
    { value: 'vencidos', label: 'Vencidos y próximos a vencer' },
    { value: 'bitacoras', label: 'Temperatura, humedad y refrigerador' },
    { value: 'recepcion', label: 'Recepción de producto' },
    { value: 'capacitacion', label: 'Capacitación al personal' },
    { value: 'farmacovigilancia', label: 'Farmacovigilancia' },
    { value: 'autoinspeccion', label: 'Autoinspección' },
    { value: 'otro', label: 'Otra' },
]);

/** La base escribe el motivo de cada rechazo en el `hint`, ya en palabras de la sala. */
export const mensajeDeRegencia = (e) => e?.hint || mensajeAmigable(e);

export const rotuloDeActividad = (valor) =>
    ACTIVIDADES_DE_REGENCIA.find((a) => a.value === valor)?.label ?? valor;

/** La regencia de la sala y sus visitas del mes de `fecha` (YYYY-MM-DD). */
export async function fetchRegenciaDeSala(branchId, fecha) {
    if (!branchId) return { regencia: null, error: null };
    const { data, error } = await supabase.rpc('regencia_de_sala', {
        p_branch_id: Number(branchId),
        p_mes: fecha,
    });
    if (error) return { regencia: null, error };
    if (data) await signPhotosDeep(data);
    return { regencia: data ?? null, error: null };
}

/** Anota una visita del regente. Devuelve `{ id, error }`. */
export async function registrarVisitaDeRegencia({ branchId, fecha, entrada, salida, actividades, notas }) {
    const { data, error } = await supabase.rpc('regencia_registrar_visita', {
        p_branch_id: Number(branchId),
        p_fecha: fecha,
        p_entrada: entrada,
        p_salida: salida,
        p_actividades: actividades,
        p_notas: notas || null,
    });
    return { id: data?.id ?? null, error };
}

/** Anula una visita con su motivo. Nunca se borra. */
export async function anularVisitaDeRegencia(id, motivo) {
    const { error } = await supabase.rpc('regencia_anular_visita', { p_id: Number(id), p_motivo: motivo });
    return { error };
}
