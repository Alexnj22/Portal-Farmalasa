import { supabase } from '../supabaseClient';

// Enviar producto a otra sala: el traslado al REVÉS.
//
// La otra familia —`data/traslados.js`— es la de PEDIR: la sala que no tiene
// abre una solicitud y la que tiene confirma. Ésta es la de EMPUJAR, que es el
// movimiento más común de una bodega: llega un producto nuevo y hay que
// repartirlo, o uno está próximo a vencer y en esta sala no rota.
//
// ── La diferencia que ordena todo ─────────────────────────────────────────
// El producto sale ANTES de que nadie del otro lado opine, porque la caja va
// con el motorista. Así que acá se crea la fila, se despacha, y la decisión de
// la otra sala llega después. Por eso son dos llamadas y no una: la primera
// deja el rastro en la base —con sus renglones, en la misma transacción— y la
// segunda mueve el inventario. Si la segunda no sale, el envío queda con todo
// por despachar y el botón lo retoma; lo que NO puede pasar es que el producto
// se mueva sin que exista la fila que lo explica.
//
// ── Lo que este archivo NO hace ───────────────────────────────────────────
// No elige a quién avisar —eso lo resuelve la base con la cascada de la sala de
// destino— ni habla con el sistema de origen: sus credenciales viven en un
// secreto y quien las tiene puede mover inventario de cualquier sala.

/**
 * Los motivos por los que una sala manda producto a otra.
 *
 * La lista vive TAMBIÉN en la base (`motivos_envio()`), que es la que manda: si
 * se agrega uno acá sin agregarlo allá, el envío rebota — a propósito. Está
 * repetida para poder ofrecerla sin una consulta, no para decidir.
 */
export const MOTIVOS_ENVIO = [
    'Producto nuevo',
    'Próximo a vencer',
    'Sobrestock',
    'Lo pidieron',
    'Otro',
];

/**
 * Y los motivos por los que la sala de destino devuelve un renglón.
 *
 * Son otros: acá no se está diciendo «no te lo puedo mandar» —eso es el
 * rechazo del traslado— sino «esto que me mandaste no lo quiero, y por qué».
 * Mismo trato: la base los valida (`motivos_rechazo_envio()`).
 */
export const MOTIVOS_RECHAZO_ENVIO = [
    'No lo vendo en mi sala',
    'Ya tengo suficiente',
    'Producto dañado',
    'Muy próximo a vencer',
    'No me corresponde',
    'Otro',
];

/** Crea el envío. Los renglones, el aprobador y la validación los pone la base. */
export function crearEnvio(payload) {
    return supabase.from('approval_requests').insert(payload).select('id').single();
}

/**
 * Nunca lanza: devuelve `{ ok, ... }` y el llamador decide qué mostrar.
 *
 * `functions.invoke` marca error para cualquier status >= 400, pero el motivo
 * real viaja en el cuerpo — sin leerlo, todo fallo se ve como un
 * "non-2xx status code" indistinguible.
 */
async function invocar(body) {
    try {
        const { data, error } = await supabase.functions.invoke('enviar-producto-erp', { body });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return cuerpo;
        } catch { /* el cuerpo no era JSON */ }
        return { ok: false, error: error.message ?? 'No se pudo enviar.' };
    } catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}

/** Saca el producto de la sala: un movimiento por renglón. Retomable. */
export const despacharEnvio = (requestId) =>
    invocar({ request_id: requestId, accion: 'despachar' });

/**
 * Lo que la sala de destino decide, renglón por renglón.
 *
 * `decisiones` viaja como POSICIONES —`[{ i, aceptar, motivo, nota }]`— y nunca
 * como los renglones: con los renglones, el navegador elegiría qué producto se
 * mueve, y del otro lado hay credenciales para mover inventario de cualquier
 * sala. Mismo contrato que `lineas_aceptadas` del traslado.
 */
export const decidirEnvio = (requestId, decisiones, nota = '') =>
    invocar({ request_id: requestId, accion: 'decidir', decisiones, nota });

/** Lo devuelto, de vuelta en el estante de quien lo mandó. */
export const recibirDevolucion = (requestId) =>
    invocar({ request_id: requestId, accion: 'recibir_devolucion' });

/**
 * Los envíos que todavía tienen algo que hacer, con sus renglones adentro.
 *
 * Una sola consulta para los tres momentos —falta despachar, falta decidir,
 * falta recibir la devolución—: los tres miran las mismas filas desde distinto
 * lado y partirlos en tres viajes haría que la baldosa pague tres veces por lo
 * mismo. Quién ve qué lo decide el RLS, no un filtro de acá.
 */
export async function fetchEnviosVivos() {
    const { data, error } = await supabase.rpc('get_envios_vivos');
    return { envios: data ?? [], error };
}

/** Los que ya se cerraron. Sin esto, un envío desaparece en cuanto termina. */
export async function fetchEnviosHistorial(limite = 100) {
    const { data, error } = await supabase.rpc('get_envios_historial', { p_limite: limite });
    return { envios: data ?? [], error };
}

/**
 * En qué momento está un envío, mirado desde MI sala.
 *
 * Un envío le aparece a las dos salas y NO dice lo mismo a cada una: para quien
 * lo mandó es «va en camino», para quien lo recibe es «hay que decidir». La
 * pregunta se contesta una vez, acá, y no en cada tarjeta — dos lugares que la
 * respondan por su cuenta terminan mostrando estados distintos del mismo envío.
 */
export function momentoDelEnvio(envio, miBranch) {
    const lineas = envio?.lineas ?? [];
    const soyOrigen  = String(envio?.origen_branch_id ?? '') === String(miBranch ?? '');
    const hay = (estado) => lineas.some(l => l.estado === estado);

    if (hay('por_enviar') || hay('error')) return soyOrigen ? 'por_despachar' : 'preparando';
    if (hay('devuelta'))                   return soyOrigen ? 'por_recibir_devolucion' : 'devuelto';
    if (hay('enviada'))                    return soyOrigen ? 'en_camino' : 'por_decidir';
    return 'cerrado';
}
