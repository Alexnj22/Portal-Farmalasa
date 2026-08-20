// Capa de datos del carné de papel — el que vale sólo hasta medianoche.
//
// El carné de PLÁSTICO lleva impreso el `kiosk_pin`, que es la contraseña del
// portal de esa persona (`ensure_user_by_code` abre `{pin}@staff.local` con ese
// valor). Imprimirlo en un ticket dejaría esa credencial permanente sobre un
// mostrador. Éste es otro secreto: aleatorio, guardado hasheado y con
// vencimiento — ver `supabase/migrations/*_carne_de_papel_que_vale_solo_hoy`.
//
// Emitir pasa por una edge function y no por el RPC a secas porque el papel
// también abre sesión, y para eso hace falta una cuenta de Auth con ese secreto
// por contraseña — sólo la llave de servicio puede crearla. El PERMISO igual lo
// decide la base: la función llama al RPC con el JWT de quien apretó el botón.

import { supabase } from '../supabaseClient';

/**
 * Emite un carné de papel para esa persona y devuelve su secreto.
 *
 * El secreto viaja UNA sola vez y no se guarda en ninguna parte: lo que sigue
 * es imprimirlo. Si esto falla, no hay papel — que es la falla correcta.
 *
 * `impresoEn` es la sucursal por cuya ticketera se manda el papel (null = esta
 * computadora). Se guarda CON el carné y no después: si se escribiera en un
 * segundo paso, un fallo entre los dos dejaría un carné del que nadie sabe por
 * dónde salió — y ése es justo el dato que se pide para poder auditarlo.
 *
 * @returns {Promise<{ok:boolean, secreto?:string, vence_el?:string, nombre?:string, motivo?:string}>}
 */
export async function emitirCarneTemporal(employeeId, motivo = null, impresoEn = null) {
    const { data, error } = await supabase.functions.invoke('emitir-carne-temporal', {
        body: { employee_id: employeeId, motivo, impreso_en: impresoEn },
    });

    if (error) return { ok: false, motivo: 'No se pudo emitir el carné. Revisa tu conexión.' };
    if (!data?.ok) {
        if (data?.error === 'SIN_PERMISO') {
            return { ok: false, motivo: 'No tienes permiso para emitir carnés.' };
        }
        return { ok: false, motivo: data?.details || 'No se pudo emitir el carné.' };
    }
    return data;
}

/** Los carnés de papel de una persona, el más reciente primero. */
export function fetchCarnesTemporales(employeeId, limite = 10) {
    return supabase
        .from('carnes_temporales')
        .select('id, created_at, vence_el, anulado_el, motivo, emitido_por, impreso_en')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(limite);
}

/**
 * Todos los carnés de papel que están vivos ahora mismo, de todo el personal.
 *
 * Es la lista de la pantalla de Sistema: lo que se puede anular. No se pagina y
 * no hace falta — un carné vivo por persona como mucho, y el personal activo son
 * decenas. El tope explícito es un freno por si algún día eso deja de ser
 * cierto: **50 filas es un número deliberado**, no el cap de 1000 de PostgREST,
 * que trunca en silencio (regla de CLAUDE.md).
 *
 * La condición de «vivo» se escribe acá IGUAL que en el servidor
 * (`resolver_carne_temporal`). Si las dos se separan, esta pantalla mostraría
 * como anulable algo que ya no lo es, o —peor— escondería un papel que sigue
 * abriendo el portal.
 */
export function fetchCarnesVigentes(limite = 50) {
    return supabase
        .from('carnes_temporales')
        .select('id, created_at, vence_el, anulado_el, motivo, employee_id, emitido_por, branch_id, impreso_en')
        .is('anulado_el', null)
        .gt('vence_el', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(limite);
}

/** Mata un carné antes de su vencimiento (el papel se perdió, por ejemplo). */
export async function anularCarneTemporal(id) {
    const { data, error } = await supabase.rpc('anular_carne_temporal', { p_id: id });
    if (error) return { ok: false, motivo: 'No se pudo anular el carné.' };
    return data ?? { ok: false, motivo: 'No se pudo anular el carné.' };
}

/** ¿Este carné sigue sirviendo? Es la misma condición que aplica el servidor. */
export const carneVigente = (fila) =>
    !!fila && !fila.anulado_el && new Date(fila.vence_el).getTime() > Date.now();
