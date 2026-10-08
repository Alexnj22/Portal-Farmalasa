import { supabase } from '../supabaseClient';

/**
 * Clientes Mayoristas (2026-10-08) — Condiciones del Cliente Mayorista y
 * Procedimiento de Clientes (docs/legal). Todo pasa por funciones de la base
 * con su propia guarda (módulo `mayoristas`): ver, proponer (editar) y
 * resolver (aprobar). El listado sale de `mayoristas_resumen_mensual`, que se
 * rehace cada noche: leer las ventas en vivo eran 625 MB por consulta.
 */
const sinError = ({ data, error }) => {
    if (error) throw error;
    return data;
};

export const PRECIOS = { mayoreo: 'Mayoreo', mayoreo_plus: 'Mayoreo Plus' };
export const RANGOS = {
    jade: { nombre: 'Jade', desde: 0, puntos: 0.25 },
    zafiro: { nombre: 'Zafiro', desde: 300, puntos: 0.5 },
    rubi: { nombre: 'Rubí', desde: 800, puntos: 0.75 },
    diamante: { nombre: 'Diamante', desde: 2000, puntos: 1 },
};
export const ESTADOS = {
    solicitado: { label: 'En revisión', variant: 'warning' },
    aprobado: { label: 'Mayorista', variant: 'success' },
    rechazado: { label: 'Rechazado', variant: 'danger' },
    retirado: { label: 'Retirado', variant: 'neutral' },
};
export const ORIGENES = { app: 'Desde la app', sala: 'Propuesto en sala', portal: 'Administración' };

export async function fetchMayoristas() {
    return sinError(await supabase.rpc('mayoristas_listado')) ?? [];
}

export async function fetchDetalleMayorista(customerId) {
    return sinError(await supabase.rpc('mayorista_detalle', { p_customer: Number(customerId) }));
}

/** El historial de todos, lo más reciente primero (una tabla chica, sin paginar). */
export async function fetchHistorialMayoristas(limite = 300) {
    return sinError(await supabase.from('clientes_mayoristas_historial')
        .select('id, customer_id, accion, estado, precio, origen, nota, created_at, customers(name), employees(name)')
        .order('created_at', { ascending: false }).limit(limite)) ?? [];
}

export async function proponerMayorista(customerId, precio, nota) {
    return sinError(await supabase.rpc('mayorista_proponer', { p_customer: Number(customerId), p_precio: precio, p_nota: nota ?? '' }));
}

/** `accion`: 'aprobar' | 'rechazar' | 'cambiar_precio' | 'retirar'. */
export async function resolverMayorista(customerId, accion, precio, nota) {
    return sinError(await supabase.rpc('mayorista_resolver', {
        p_customer: Number(customerId), p_accion: accion, p_precio: precio ?? null, p_nota: nota ?? '',
    }));
}
