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
 * `contenido` llega **en base64** y no es una precaución: un ticket es un flujo
 * de bytes —la letra normal se pide con `ESC ! \x00`— y un NUL no cabe en una
 * columna `text` de Postgres. El 17-ago-2026 esta llamada devolvía 400
 * «unsupported Unicode escape sequence» en cada intento, el portal lo leía como
 * «este camino no está» y caía al diálogo del navegador: el papel salía en la
 * computadora de quien apretaba el botón en vez de en la caja de la sala, que
 * es justo lo que la cola existe para evitar. Lo codifica
 * `ticketEnBase64` en `ticketPrint.js`, junto a los bytes que describe.
 *
 * Rechaza si esa sala no tiene una caja registrada, y eso es deliberado: una
 * cola que nadie lee es papel que nunca sale y nadie se entera. Quien llama
 * trata el rechazo como «este camino no está» y cae al siguiente.
 */
export function encolarImpresion({ branchId, titulo, contenidoB64 }) {
    return supabase.rpc('encolar_impresion', {
        p_branch_id: branchId,
        p_titulo: titulo,
        p_contenido: contenidoB64,
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
        .select('id, branch_id, nombre, equipo, impresora, activo, ultimo_latido, vinculada_at, created_at')
        .order('nombre');
    if (error) { console.error('impresion: fetchCajasDeImpresion failed:', error.message); return []; }
    return data || [];
}

/**
 * Crea la caja y devuelve un **código de 8 letras** para escribir en ella.
 *
 * Antes esto devolvía dos UUID que había que transcribir a mano a un archivo de
 * texto en la computadora de la caja. Eso no se le pide a nadie: se copia mal, y
 * un carácter cambiado da un error que no dice cuál de los dos está mal.
 *
 * El código vive 15 minutos y se usa una sola vez, así que ser corto no lo hace
 * inseguro — y el alfabeto no tiene O, 0, I ni 1, que son los que se confunden
 * al leerlos de una pantalla.
 */
export function crearCodigoDeVinculacion({ branchId, nombre }) {
    return supabase.rpc('crear_codigo_de_vinculacion', {
        p_branch_id: branchId, p_nombre: nombre,
    });
}

/**
 * Saca una caja de la lista. **Borra la fila, no la desactiva.**
 *
 * Existe porque registrar una caja es barato y equivocarse también: un código
 * que se generó dos veces, o una instalación que hubo que repetir porque no se
 * pudo entrar a esa computadora, deja filas que no contestan nunca. Salud 3
 * llegó a tener tres cajas —dos muertas y la buena— y una lista así hace dudar
 * de la única que sirve, que es justo lo que la pantalla existe para contestar.
 *
 * `activo = false` no habría alcanzado: la dejaría en la lista diciendo lo
 * mismo. El historial de lo que ya se imprimió por ella SÍ se conserva, sin el
 * puntero a la caja — eso lo resuelve la función en la base.
 *
 * Devuelve el nombre de la que se fue, para que la pantalla pueda decirlo.
 */
export function eliminarCajaDeImpresion(id) {
    return supabase.rpc('eliminar_caja_de_impresion', { p_id: id });
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
