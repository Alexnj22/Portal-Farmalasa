import { supabase } from '../supabaseClient';

// La cola de impresión de cada sala.
//
// Existe porque el camino directo (`http://localhost`) sólo alcanza la
// computadora que tiene el navegador abierto, y **no puede alcanzar otra**:
// apuntar a la IP de la caja es contenido mixto y el navegador lo corta; la
// exención vale sólo para `localhost` y no se hereda a una IP.
//
// El portal deja el papel acá con su sucursal y un programa que corre en la
// caja lo reclama y lo tubea a `lp -d pos-80 -o raw`. El agente vive en
// `scripts/agente-impresion/` y se identifica con dispositivo + token: nunca ve
// la llave de servicio.

/**
 * Deja un documento esperando en la caja de una sala.
 *
 * Rechaza si esa sala no tiene una caja registrada, y eso es deliberado: una
 * cola que nadie lee es papel que nunca sale y nadie se entera. Quien llama
 * trata el rechazo como «este camino no está» y cae al siguiente.
 */
export function encolarImpresion({ branchId, titulo, contenido }) {
    return supabase.rpc('encolar_impresion', {
        p_branch_id: branchId,
        p_titulo: titulo,
        p_contenido: contenido,
    });
}

/**
 * Las cajas registradas y cuándo dieron señales de vida por última vez.
 *
 * El token NO viene: la policy no lo publica. Se ve una sola vez, al registrar
 * la caja — un token que se puede volver a leer desde cualquier pantalla es un
 * token que viaja.
 */
export async function fetchCajasDeImpresion() {
    const { data, error } = await supabase.from('impresion_dispositivos')
        .select('id, branch_id, nombre, impresora, activo, ultimo_latido, created_at')
        .order('nombre');
    if (error) { console.error('impresion: fetchCajasDeImpresion failed:', error.message); return []; }
    return data || [];
}

/** Registra una caja y devuelve su token — la única vez que se puede leer. */
export function registrarCaja({ branchId, nombre, impresora }) {
    return supabase.rpc('registrar_caja_de_impresion', {
        p_branch_id: branchId, p_nombre: nombre, p_impresora: impresora || 'pos-80',
    });
}

/**
 * Lo último que pasó por la cola de una sala — para ver si el papel salió.
 *
 * Es la respuesta a algo que hasta ahora no se podía saber: por el camino
 * directo, `ok` significa «el programa recibió el pedido», nunca «salió papel».
 * Acá el agente contesta si el comando funcionó.
 */
export async function fetchColaDeImpresion({ branchId = null, limite = 25 } = {}) {
    let q = supabase.from('cola_impresion')
        .select('id, branch_id, titulo, estado, intentos, error, created_at, impreso_at')
        .order('id', { ascending: false })
        .limit(limite);
    if (branchId != null) q = q.eq('branch_id', branchId);
    const { data, error } = await q;
    if (error) { console.error('impresion: fetchColaDeImpresion failed:', error.message); return []; }
    return data || [];
}
