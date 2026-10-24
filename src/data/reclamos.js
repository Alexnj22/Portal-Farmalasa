import { supabase } from '../supabaseClient';
import { sumarDiasHabiles, diasHabilesEntre } from './solicitudesDatos';

/**
 * Reclamos de clientes en sala (2026-10-24) — Reglamento de Puntos Salud §12,
 * Reglamento de Reservas §10 y Condiciones del Cliente Mayorista §7. Los tres
 * dicen lo mismo: el reclamo se presenta en cualquier sala, queda registrado y
 * la Empresa responde en diez días hábiles.
 *
 * Se escribe SÓLO por `reclamo_registrar` (compara la sala contra la de quien
 * llama) y `reclamo_responder` (exige aprobar): la tabla no tiene policies de
 * escritura. La lectura respeta el alcance: una sala ve los suyos.
 * Lo usan el portal (`ReclamosClientesView`) y la app (`apps/mobile/app/reclamos-clientes.js`).
 */
export const PROGRAMAS = [
    { value: 'puntos', label: 'Puntos Salud' },
    { value: 'reservas', label: 'Reservas' },
    { value: 'mayorista', label: 'Cliente Mayorista' },
];
export const ROTULO_PROGRAMA = Object.fromEntries(PROGRAMAS.map((p) => [p.value, p.label]));

export const VIAS = [
    { value: 'SALA', label: 'En la sala' },
    { value: 'TELEFONO', label: 'Por teléfono' },
    { value: 'CORREO', label: 'Por correo' },
    { value: 'APP', label: 'Por la app' },
];
export const ROTULO_VIA = Object.fromEntries(VIAS.map((v) => [v.value, v.label]));

export const DIAS_PARA_RESPONDER = 10;

/** Cuánto le queda a un reclamo abierto, o `null` si ya se respondió. */
export function plazoDeReclamo(r, ahora = new Date()) {
    if (!r || r.respondido_at) return null;
    const restan = DIAS_PARA_RESPONDER - diasHabilesEntre(r.recibido_at, ahora);
    return { restan, vencido: restan < 0, apremia: restan >= 0 && restan <= 2 };
}

/** ¿Se respondió dentro de los diez días hábiles? `null` si sigue abierto. */
export function respondidoATiempo(r) {
    if (!r?.respondido_at) return null;
    return new Date(r.respondido_at) <= sumarDiasHabiles(r.recibido_at, DIAS_PARA_RESPONDER + 1);
}

/** Pocos por diseño (reclamos de sala), con un techo deliberado bajo el de PostgREST. */
export async function fetchReclamos() {
    const { data, error } = await supabase.from('reclamos_clientes')
        .select('*, recibio:employees!reclamos_clientes_recibido_por_fkey(id, name), respondio:employees!reclamos_clientes_respondido_por_fkey(id, name), sala:branches(id, name)')
        .order('recibido_at', { ascending: false }).range(0, 499);
    if (error) throw error;
    return data ?? [];
}

export async function registrarReclamo({ programa, branchId, tema, customerId = null, nombre = null, telefono = null }) {
    const { data, error } = await supabase.rpc('reclamo_registrar', {
        p_programa: programa, p_branch_id: branchId, p_tema: tema,
        p_customer_id: customerId, p_nombre: nombre, p_telefono: telefono,
    });
    if (error) throw error;
    return data;
}

export async function responderReclamo(id, respuesta, via) {
    const { data, error } = await supabase.rpc('reclamo_responder', { p_id: id, p_respuesta: respuesta, p_via: via });
    if (error) throw error;
    return data;
}
