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
    if (!data?.ok) return { ...vacio, error: { message: data?.error ?? 'No se pudieron leer los paquetes.' } };
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

// ─── La bolsa que llegó a la sala equivocada ───────────────────────────────
//
// La sala no puede ver traslados ajenos, así que su escáner decía «no
// encontramos ese ticket». `bolsa_ajena` dice sólo para qué sala es; con eso
// la sala la reporta (`bolsa_llego_por_error`): queda anotado dónde está, se
// avisa a Bodega y a quien la entregó, y las rutas la sugieren desde ahí.

/** ¿De quién es esta bolsa? `{ encontrada, origen, destino, es_para_esta_sala, ya_reportada_aqui }`. */
export async function fetchBolsaAjena(codigo, branchId = null) {
    const { data, error } = await supabase.rpc('bolsa_ajena', { p_codigo: String(codigo ?? ''), p_branch_id: branchId });
    if (error) {
        console.error('rutaBolsas: bolsa_ajena failed:', error.message);
        return { bolsa: null, error };
    }
    return { bolsa: data?.encontrada ? data : null, error: null };
}

/** «Llegó aquí por error». Nunca lanza. */
export async function reportarBolsaPorError(codigo, branchId = null) {
    const { data, error } = await supabase.rpc('bolsa_llego_por_error', { p_codigo: String(codigo ?? ''), p_branch_id: branchId });
    if (error) return { ok: false, error: error.message };
    if (data?.ok && !data.ya) anotar('BOLSA_LLEGO_POR_ERROR', null, { codigo: String(codigo ?? ''), destino: data.destino, sala: branchId });
    return data ?? { ok: false, error: 'Sin respuesta.' };
}

// ─── La firma de la sala en una parada (punto 6, parte 2) ──────────────────
//
// El conductor le pide el carné a quien recibe y lo escanea en su teléfono,
// ANTES de marcar la parada entregada. Opcional mientras
// `security_config('ruta_firma_sala')` no diga `exigir` (decisión del usuario,
// 2026-11-13: «opcional por ahora, anotada para convertirse en obligatorio»).

/** ¿Hoy es obligatoria la firma? Si no se puede leer, se asume que no. */
export async function fetchFirmaSalaExigida() {
    const { data, error } = await supabase.rpc('ruta_firma_sala_exigida');
    if (error) {
        console.error('rutaBolsas: ruta_firma_sala_exigida failed:', error.message);
        return false;
    }
    return data === true;
}

/** Firma de la sala con su carné. `{ ok, quien, sala, paquetes }`; nunca lanza. */
export async function firmarParadaConCarne(parada, codigo) {
    const { data, error } = await supabase.rpc('ruta_firma_sala_carne', { p_stop_id: parada.id, p_valor: String(codigo ?? '').trim() });
    if (error) return { ok: false, error: 'No se pudo confirmar el carné.' };
    if (data?.ok && !data.ya) anotar('RUTA_FIRMA_SALA', parada.ruta_id ?? null, { parada: parada.id, sucursal_id: parada.erp_sucursal_id, quien: data.quien, paquetes: data.paquetes, desde: 'app' });
    return data ?? { ok: false, error: 'Sin respuesta.' };
}
