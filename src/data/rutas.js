// ─────────────────────────────────────────────────────────────────────────────
// Rutas de entrega — las escrituras que tienen que ser ATÓMICAS.
// ─────────────────────────────────────────────────────────────────────────────
//
// Hasta el 2026-10-08 una ruta sólo se podía cerrar con TODAS sus paradas
// entregadas, y una parada sólo la marcaba el conductor. Si una sala estaba
// cerrada o el pedido no se pudo bajar, la ruta quedaba «en ruta» para
// siempre y esas cajas no podían salir en otra.
//
// Las dos salidas nuevas tocan varias tablas a la vez (la parada, la ruta, la
// sala del pedido que vuelve a quedar disponible), así que viven en la base
// como funciones y no como tres `update` desde el navegador:
//
//   ruta_parada_no_entregada(p_ruta_id uuid, p_pedido_id uuid, p_sucursal_id int, p_motivo text)
//   cerrar_ruta(p_ruta_id uuid, p_motivo text)
//
// Si la función todavía no existe en la base (PGRST202 / 42883), se devuelve
// un error con un mensaje claro en vez del genérico.
import { supabase } from '../supabaseClient';
import { conBitacora } from './audit';

export const MSG_FUNCION_DE_RUTA_FALTA =
    'Esta acción todavía no está disponible. Avisa al equipo de sistemas.';

/** ¿El error dice que la función no existe en la base? */
export function esFuncionInexistente(error) {
    if (!error) return false;
    const code = String(error.code ?? '');
    if (code === 'PGRST202' || code === '42883') return true;
    return /could not find the function|function .* does not exist/i.test(String(error.message ?? ''));
}

async function llamarRpc(nombre, params) {
    // `rpc` con un nombre que los tipos generados todavía no conocen: la
    // función la instala otra pieza del trabajo. Se castea para que el
    // contrato de tipos no frene una llamada que ya maneja su ausencia.
    const res = await /** @type {any} */ (supabase).rpc(nombre, params);
    if (res.error && esFuncionInexistente(res.error)) {
        return { data: null, error: Object.assign(new Error(MSG_FUNCION_DE_RUTA_FALTA), { code: res.error.code, falta: true }) };
    }
    return res;
}

/**
 * Una parada que no se pudo entregar: la base la marca así y la sala del
 * pedido vuelve a quedar disponible para otra ruta.
 */
export function marcarParadaNoEntregada({ rutaId, pedidoId, sucursalId, motivo }) {
    return conBitacora(
        llamarRpc('ruta_parada_no_entregada', {
            p_ruta_id: rutaId, p_pedido_id: pedidoId, p_sucursal_id: sucursalId, p_motivo: motivo,
        }),
        'RUTA_PARADA_NO_ENTREGADA', rutaId, { pedido_id: pedidoId, sucursal_id: sucursalId, motivo },
    );
}

/** Cierra la ruta aunque queden paradas pendientes, con su motivo. */
export function cerrarRutaConMotivo({ rutaId, motivo }) {
    return conBitacora(
        llamarRpc('cerrar_ruta', { p_ruta_id: rutaId, p_motivo: motivo }),
        'RUTA_CERRADA_CON_PENDIENTES', rutaId, { motivo },
    );
}

// ── Quién puede conducir una ruta ───────────────────────────────────────────
// El conductor es quien marca las entregas, y eso pide `can_edit` en
// `pedidos_tab_rutas` (las policies de `ruta_pedidos`). O sea que la lista de
// conductores posibles es exactamente la gente activa cuyo cargo tiene ese
// permiso: elegir a alguien sin él dejaría una ruta que su conductor no puede
// mover. No existe un cargo «conductor» (medido el 2026-10-08 en producción y
// en pruebas): sólo «Repartidor de Mayoreo», que es de la distribuidora.
export async function fetchConductoresPosibles() {
    const permisos = await supabase.from('role_permissions')
        .select('role_id').eq('module_key', 'pedidos_tab_rutas').eq('can_edit', true);
    if (permisos.error) return { data: null, error: permisos.error };
    const roles = [...new Set((permisos.data ?? []).map(r => r.role_id))];
    if (!roles.length) return { data: [], error: null };
    const emp = await supabase.from('employees')
        .select('id, first_names, last_names, photo_url, role_id')
        .eq('status', 'ACTIVO').in('role_id', roles)
        .order('first_names');
    return { data: emp.data ?? null, error: emp.error ?? null };
}
