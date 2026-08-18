// La decisión de una diferencia del pedido.
//
// Regla del usuario (2026-08-17/18): toda diferencia tiene DOS salidas, y lo
// que las separa es **en qué plano se arregla**:
//
//   · en el SISTEMA  → sale un traslado (bodega → sala, o sala → bodega)
//   · en FÍSICO      → no hay asiento: sólo la decisión y la firma de quien
//                      recibe el producto
//
// La propone la SALA —que es la que está revisando—, bodega acepta o
// contrapropone la otra, y si no se ponen de acuerdo decide SUPERVISIÓN.
// Nada se mueve hasta que coinciden dos personas distintas.
//
// ── Lo que este archivo NO hace ────────────────────────────────────────────
// No decide ni mueve. Los turnos, las guardas y el movimiento viven en
// `decidir_diferencia_pedido` (base) y en las edge functions. Acá sólo se
// pregunta y se llama.
import { supabase } from '../supabaseClient';

/**
 * El catálogo de salidas, por tipo de diferencia.
 *
 * Sale de la tabla `diferencia_opcion` y NO está escrito acá a propósito: es la
 * misma lista que la base usa para validar, así que el valor que se elige
 * coincide con el que se acepta *por construcción* y no por suerte. Es
 * `feedback_lista_a_mano_se_desincroniza_del_registro` aplicado a este catálogo.
 *
 * Se pide una vez por sesión: son doce filas que no cambian mientras el portal
 * está abierto.
 */
let cache = null;
export async function fetchOpcionesDiferencia() {
    if (cache) return cache;
    const { data, error } = await supabase
        .from('diferencia_opcion')
        .select('error_tipo, valor, rotulo, ayuda, orden, mueve, cierra_con')
        .order('error_tipo').order('orden');
    if (error) {
        console.error('opciones de diferencia:', error.message);
        return {};   // sin catálogo no se ofrece nada: es preferible a inventarlo
    }
    const porTipo = {};
    (data ?? []).forEach(o => { (porTipo[o.error_tipo] ??= []).push(o); });
    cache = porTipo;
    return cache;
}

/** Las salidas de un tipo de diferencia, ya cargado el catálogo. */
export const opcionesDe = (catalogo, errorTipo) => catalogo?.[errorTipo] ?? [];

/** La salida elegida, para saber qué mueve y quién la cierra. */
export const opcionElegida = (catalogo, errorTipo, valor) =>
    opcionesDe(catalogo, errorTipo).find(o => o.valor === valor) ?? null;

/**
 * Un turno de la conversación.
 *
 * `accion` es uno de: proponer | aceptar | contraproponer | rechazar | supervisar.
 * De quién es el turno lo decide la base, no esta llamada — acá se manda lo que
 * la pantalla ofreció y si no correspondía, rebota con su motivo.
 *
 * Devuelve `{ estado, opcion, rotulo, mueve, cierra_con, devolucion_id }`.
 * Cuando `mueve` es 'devolucion' viene además el `devolucion_id`: esa devolución
 * nace YA ACEPTADA —el acuerdo se dio en este mismo turno— y lo único que falta
 * es sacarla de la sala.
 */
export function decidirDiferencia({ itemId, accion, tipo = null, nota = null, evidencia = [] }) {
    return supabase.rpc('decidir_diferencia_pedido', {
        p_item_id:   itemId,
        p_accion:    accion,
        p_tipo:      tipo,
        p_nota:      nota || null,
        p_evidencia: evidencia,
    });
}

/**
 * «Ya lo tengo en la mano.»
 *
 * Las dos salidas que se arreglan en FÍSICO no mueven nada en el sistema, pero
 * igual tienen que cerrarse con alguien viendo el producto: el que va a la sala
 * lo firma la sala, y el que vuelve a bodega lo firma bodega. Nunca se firma
 * solo — es la misma regla que la entrada de una devolución.
 */
export function confirmarLlegadaDiferencia(itemId, nota = null) {
    return supabase.rpc('confirmar_llegada_diferencia', {
        p_item_id: itemId, p_nota: nota || null,
    });
}
