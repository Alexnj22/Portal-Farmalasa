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

/** Marca como agregados en Google Play. Devuelve cuántos se marcaron. */
export async function marcarAgregadosEnPlay(employeeIds) {
    const { data, error } = await supabase.rpc('novedades_android_agregados', { p_empleados: employeeIds });
    if (error) throw error;
    anotar('NOVEDADES_ANDROID_AGREGADOS', null, { cuantos: data });
    return Number(data) || 0;
}
