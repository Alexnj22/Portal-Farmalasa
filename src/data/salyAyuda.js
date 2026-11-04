import { supabase } from '../supabaseClient';

// Saly, ayuda en pantalla. La pregunta va a `saly-ayuda`, que valida la
// sesión, cuenta el tope diario en la base y anota el registro. Devuelven
// `{ data, error }` como `functions.invoke`.

/** `{ modulo, pregunta, pantalla, filtros, senalado? }` → `{ id, animo, piezas, filtros, quedan }`. */
export const preguntarAyudaDeSaly = (body) => supabase.functions.invoke('saly-ayuda', { body });

/** 👍/👎 sobre una respuesta propia. */
export const calificarAyudaDeSaly = (id, util) =>
    supabase.rpc('saly_ayuda_calificar', { p_id: id, p_util: util });
