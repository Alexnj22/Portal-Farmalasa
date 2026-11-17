// Novedades (2026-11-16): el correo para la prueba interna de Android y la
// lista que administración agrega en Google Play.
//
// El correo se guarda en UNA llamada (`novedades_correo_android`): pone al día
// la ficha del empleado (el anterior pasa a correos adicionales) y deja la fila
// en `app_pruebas_android`. Si el empleado tiene UNA ficha de cliente con su
// DUI, la base la devuelve y aquí se actualiza por `updateCustomerFiscal`, que
// es el único camino de escritura de `customers`.
import { supabase } from '../supabaseClient';
import { anotar } from './audit';
import { updateCustomerFiscal, pushClienteAlErp } from './customers';
import { fetchRolePermissionsForRoles } from './permissions';
import { fetchAllRows } from '../utils/supabaseUtils';

const ERRORES = {
    CORREO_INVALIDO: 'Revisa el correo: debe verse como nombre@gmail.com.',
    SIN_EMPLEADO: 'Tu usuario no está ligado a una ficha de empleado. Escríbele a Soporte.',
    FORBIDDEN: 'No tienes permiso para hacer esto.',
};

export function mensajeDeNovedades(err) {
    const msg = err?.message || '';
    const clave = Object.keys(ERRORES).find((c) => msg.includes(c));
    return clave ? ERRORES[clave] : 'No se pudo guardar. Intenta de nuevo.';
}

/**
 * Guarda el correo de Android. Devuelve qué se actualizó:
 * `{ correo, correoAnterior, fichaDeCliente: 'actualizada'|'igual'|'sin_ficha'|'pendiente' }`.
 * La ficha de cliente es un extra: si falla, el correo del empleado y la lista
 * de la prueba ya quedaron guardados, así que no se lanza por ella.
 */
export async function registrarCorreoAndroid(email) {
    const { data, error } = await supabase.rpc('novedades_correo_android', { p_email: email });
    if (error) throw error;
    const r = /** @type {any} */ (data) || {};
    anotar('NOVEDADES_CORREO_ANDROID', null, { correo: r.correo, cambio: r.correo_anterior !== r.correo });

    let fichaDeCliente = 'sin_ficha';
    if (r.cliente_id) {
        if (String(r.correo_cliente || '').toLowerCase() === r.correo) {
            fichaDeCliente = 'igual';
        } else {
            try {
                await updateCustomerFiscal(r.cliente_id, { email: r.correo }, {}, { origen: 'novedades' });
                pushClienteAlErp(r.cliente_id);
                fichaDeCliente = 'actualizada';
            } catch (e) {
                console.error('novedades: ficha de cliente', e);
                fichaDeCliente = 'pendiente';
            }
        }
    }
    return { correo: r.correo, correoAnterior: r.correo_anterior ?? null, fichaDeCliente };
}

/** El correo que la persona ya dejó, o `null`. */
export async function fetchMiCorreoAndroid(employeeId) {
    if (!employeeId) return null;
    const { data, error } = await supabase.from('app_pruebas_android')
        .select('email, agregado_at').eq('employee_id', employeeId).maybeSingle();
    if (error) throw error;
    return data;
}

/** La lista para Google Play (sólo quien edita Novedades la recibe completa). */
export async function fetchPruebasAndroid() {
    const { data, error } = await supabase.from('app_pruebas_android')
        .select('employee_id, email, agregado_at, created_at, updated_at, empleado:employees!app_pruebas_android_employee_id_fkey(id, name, branch_id)')
        .order('agregado_at', { ascending: true, nullsFirst: true })
        .order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

/**
 * Marca como agregados en Google Play y les avisa (campana y teléfono) con el
 * enlace a sus pasos. Devuelve cuántos se marcaron.
 */
export async function marcarAgregadosEnPlay(employeeIds) {
    const { data, error } = await supabase.rpc('novedades_android_agregados', { p_empleados: employeeIds });
    if (error) throw error;
    anotar('NOVEDADES_ANDROID_AGREGADOS', null, { cuantos: data });
    return Number(data) || 0;
}

/** Vuelve a mandar el aviso «ya puedes descargarla» a quien ya está agregado. */
export async function reenviarAvisoAndroid(employeeIds) {
    const { data, error } = await supabase.rpc('novedades_android_avisar', { p_empleados: employeeIds });
    if (error) throw error;
    anotar('NOVEDADES_ANDROID_AVISO', null, { cuantos: data });
    return Number(data) || 0;
}

/**
 * Los permisos de un cargo, con la forma que usa `hasPermission`:
 * `{ [modulo]: { can_view, can_edit, can_approve } }`. Para «Ver como».
 */
export async function fetchPermisosDeCargo(roleId) {
    const { data, error } = await fetchRolePermissionsForRoles([roleId]);
    if (error) throw error;
    const mapa = {};
    for (const p of data ?? []) mapa[p.module_key] = { can_view: !!p.can_view, can_edit: !!p.can_edit, can_approve: !!p.can_approve };
    return mapa;
}

// ── Novedades vistas (2026-11-17) ──────────────────────────────────────────
// Lo visto vive en la base (`novedades_vistas`), no en el navegador: así sigue
// a la persona en cualquier dispositivo y administración sabe quién vio qué.
// Clave: `<tanda>:<novedad>`, y `entrada:<tanda>` para la pantalla de inicio.

/** Las claves que ya vio este empleado. */
export async function fetchMisVistas(employeeId) {
    if (!employeeId) return new Set();
    const { data, error } = await supabase.from('novedades_vistas')
        .select('clave').eq('employee_id', employeeId).limit(500);
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.clave));
}

/** Marca como vistas (la firma la pone la base). Devuelve cuántas eran nuevas. */
export async function marcarVistas(claves) {
    const lista = [...new Set((claves ?? []).filter(Boolean))];
    if (!lista.length) return 0;
    const { data, error } = await supabase.rpc('novedades_marcar_vistas', { p_claves: lista });
    if (error) throw error;
    return data ?? 0;
}

/**
 * Para «Quién las vio»: el personal activo, lo que vio cada uno y los permisos
 * de cada cargo (qué novedades le tocan sale de `novedadesVisibles`).
 */
export async function fetchQuienVioNovedades() {
    const [emp, vistas, roles] = await Promise.all([
        fetchAllRows(() => supabase.from('employees')
            .select('id, name, role_id, branch_id').eq('status', 'ACTIVO').order('name'), { completo: true }),
        fetchAllRows(() => supabase.from('novedades_vistas')
            .select('employee_id, clave, visto_at').order('employee_id').order('clave'), { completo: true }),
        // `roles` es tabla chica (<1000): va entera.
        supabase.from('roles').select('id, name, is_su'),
    ]);
    if (roles.error) throw roles.error;
    if (!emp || !vistas) throw new Error('No se pudo leer la lista completa.');
    const cargos = [...new Set(emp.map((e) => e.role_id).filter((r) => r != null))];
    // ~1,800 filas con todos los cargos: pasa el techo de 1000, va paginado.
    const perms = cargos.length
        ? await fetchAllRows(() => supabase.from('role_permissions')
            .select('role_id, module_key, can_view, can_edit, can_approve')
            .in('role_id', cargos).order('role_id').order('module_key'), { completo: true })
        : [];
    if (!perms) throw new Error('No se pudieron leer los permisos de los cargos.');
    const permisos = {};
    for (const p of perms) {
        (permisos[p.role_id] ??= {})[p.module_key] = { can_view: !!p.can_view, can_edit: !!p.can_edit, can_approve: !!p.can_approve };
    }
    // Por el cargo principal: un cargo secundario puede sumarle alguna novedad
    // que aquí no se cuenta.
    return { empleados: emp, vistas, permisos, cargos: roles.data ?? [] };
}
