import { supabase } from '../supabaseClient';
import { anotar } from './audit';

// ─── Las bolsas de traslado que viajan con la ruta de reparto ──────────────
//
// Punto 6 de traslados (usuario, 2026-11-12): el motorista ya hace cada día la
// ruta del pedido semanal; ahora también recoge las bolsas de traslado que van
// a sus paradas, escaneando el ticket, y al entregar la parada se entregan
// solas las de esa sala. Así queda quién la tenía, cuándo y dónde.
//
// Todo lo que decide vive en la base (`ruta_bolsas`, `ruta_recoger_bolsa`,
// `ruta_entregar_bolsa`, `ruta_soltar_bolsa`): quién puede, qué bolsa está por
// llevar y cuál ya la lleva otro. Acá sólo se llama, se anota en la bitácora y
// se traduce el desenlace. Ninguna función lanza.

const vacio = { llevas: [], sugeridas: [] };

/** Lo que lleva encima la ruta y lo que puede llevarse de paso. */
export async function fetchBolsasDeRuta(rutaId) {
    if (!rutaId) return { ...vacio, error: null };
    const { data, error } = await supabase.rpc('ruta_bolsas', { p_ruta_id: rutaId });
    if (error) {
        console.error('rutaBolsas: ruta_bolsas failed:', error.message);
        return { ...vacio, error };
    }
    if (!data?.ok) return { ...vacio, error: { message: data?.error ?? 'No se pudieron leer las bolsas.' } };
    return { llevas: data.llevas ?? [], sugeridas: data.sugeridas ?? [], error: null };
}

const posicion = (pos) => ({ p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });

/** Recoger una bolsa escaneando su ticket. `pos` = `{ lat, lng }` del teléfono, si hay. */
export async function recogerBolsa(rutaId, codigo, pos = null) {
    const { data, error } = await supabase.rpc('ruta_recoger_bolsa', { p_ruta_id: rutaId, p_codigo: String(codigo ?? ''), ...posicion(pos) });
    if (error) return { ok: false, error: error.message };
    if (data?.ok) anotar('RUTA_BOLSA_RECOGIDA', data.request_id, { ruta: rutaId, codigo: data.codigo, origen: data.origen, destino: data.destino, desde: 'app' });
    return data ?? { ok: false, error: 'Sin respuesta.' };
}

/** Entregar una bolsa suelta (la que va a una sala que no es parada de la ruta). */
export async function entregarBolsa(bolsa, pos = null) {
    const { data, error } = await supabase.rpc('ruta_entregar_bolsa', { p_id: bolsa.id, ...posicion(pos) });
    if (error) return { ok: false, error: error.message };
    if (data?.ok) anotar('RUTA_BOLSA_ENTREGADA', bolsa.request_id, { codigo: bolsa.codigo, destino: bolsa.destino, desde: 'app' });
    return data ?? { ok: false, error: 'Sin respuesta.' };
}

/** Soltar: la recogió por error o la dejó donde estaba. Queda que la tuvo. */
export async function soltarBolsa(bolsa) {
    const { data, error } = await supabase.rpc('ruta_soltar_bolsa', { p_id: bolsa.id });
    if (error) return { ok: false, error: error.message };
    if (data?.ok) anotar('RUTA_BOLSA_SOLTADA', bolsa.request_id, { codigo: bolsa.codigo, destino: bolsa.destino, desde: 'app' });
    return data ?? { ok: false, error: 'Sin respuesta.' };
}
