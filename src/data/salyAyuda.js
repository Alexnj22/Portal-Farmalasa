import { supabase } from '../supabaseClient';

// Saly, ayuda en pantalla. La pregunta va a `saly-ayuda`, que valida la
// sesión, cuenta el tope diario en la base y anota el registro. Devuelven
// `{ data, error }` como `functions.invoke`.

/** `{ modulo, pregunta, pantalla, filtros, senalado? }` → `{ id, animo, piezas, filtros, quedan }`. */
export const preguntarAyudaDeSaly = (body) => supabase.functions.invoke('saly-ayuda', { body });

/** 👍/👎 sobre una respuesta propia. */
export const calificarAyudaDeSaly = (id, util) =>
    supabase.rpc('saly_ayuda_calificar', { p_id: id, p_util: util });

/**
 * Lo que se le preguntó a Saly en los últimos 7 días, para quien tiene
 * Auditoría (la policy decide: sin el permiso devuelve sólo lo propio). Tope
 * de 200 deliberado: es para leer de un vistazo, no un reporte.
 */
export async function fetchPreguntasDeLaSemana() {
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await supabase.from('saly_ayuda_registro')
        .select('id, modulo, pregunta, util, created_at')
        .gte('created_at', desde).order('created_at', { ascending: false }).limit(200);
    return { data: data || [], error };
}
