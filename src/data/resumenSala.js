// El resumen diario de cada sala (PENDIENTES 31 y 32). Lo escribe el cron de
// las 5:30 (`resumen-diario-salas`); acá sólo se lee. El RLS de la tabla
// decide qué salas ve cada quien.
import { supabase } from '../supabaseClient';

/**
 * Sin sala: el último resumen de cada una (para las tarjetas).
 * Con sala: sus últimos `dias`, con los números del día (para la ficha).
 */
export async function fetchResumenDeSalas({ branchId = null, dias = 1 } = {}) {
    const { data, error } = await supabase.rpc('get_resumen_de_salas', {
        p_branch_id: branchId ? Number(branchId) : null,
        p_dias: dias,
    });
    if (error) return { resumenes: [], error };
    return { resumenes: data ?? [], error: null };
}

/** El tono del resumen: «alta» si alguna novedad lo es, «nada» sin novedades. */
export function tonoDelResumen(r) {
    const nov = Array.isArray(r?.novedades) ? r.novedades : [];
    if (!nov.length) return 'nada';
    return nov.some(n => n.nivel === 'alta') ? 'alta' : 'media';
}

/**
 * Qué siente Saly con el día de una sala. Sale de las novedades —nunca de
 * la IA—, así que su color cuenta lo mismo que los números:
 * - algo «alta» (vencidos a la venta, un faltante en caja, la venta hundida) → preocupacion
 * - nada fuera de lo normal, o sólo buenas noticias (`buena`: la venta subió) → alegria
 * - lo demás (algo para mirar) → atencion
 */
export function animoDeSaly(r) {
    const nov = Array.isArray(r?.novedades) ? r.novedades : [];
    if (nov.some(n => n.nivel === 'alta')) return 'preocupacion';
    if (nov.every(n => n.buena === true)) return 'alegria';
    return 'atencion';
}
