import { supabase } from '../supabaseClient';

/**
 * La consulta pública de puntos: DUI + teléfono, sin sesión.
 *
 * ── No lanza, y devuelve el mensaje ya escrito ──────────────────────────────
 * Del otro lado hay un cliente parado en una sala, no un empleado. Un error en
 * consola no le sirve de nada: cada final —no encontrado, demasiados intentos,
 * el servicio no responde— tiene que llegar como una frase que se pueda leer.
 * Por eso el servidor manda el texto y acá no se redacta: si el mensaje viviera
 * en los dos lados, un día dirían cosas distintas.
 *
 * ── Lo que NO vuelve, a propósito ──────────────────────────────────────────
 * Ni el documento ni el teléfono. Quien preguntó ya los tenía, y devolverlos
 * sólo agrega una copia más de un dato sensible viajando por la red.
 */
export async function consultarMisPuntos({ documento, dui, telefono }) {
    try {
        const { data, error } = await supabase.functions.invoke('mis-puntos', {
            // `documento` es el nombre nuevo: ya no es sólo un DUI, puede ser el
            // NIT, el pasaporte o el código que le dio la sala. `dui` sigue
            // viajando por si alguna pantalla vieja todavía lo manda así — la
            // edge function acepta los dos y prefiere `documento`.
            body: { documento: documento ?? dui, dui: documento ?? dui, telefono },
        });
        // `functions.invoke` marca error para cualquier código que no sea 2xx,
        // y el 429 del freno viene por ahí con su cuerpo adentro. Sin esto, a
        // quien se pasó de intentos le saldría «no se pudo conectar», que lo
        // manda a revisar su señal en vez de a esperar unos minutos.
        if (error && !data) {
            const cuerpo = await error?.context?.json?.().catch(() => null);
            if (cuerpo?.mensaje) {
                return { ok: false, motivo: cuerpo.motivo ?? 'no_disponible', mensaje: cuerpo.mensaje };
            }
            throw error;
        }
        if (data?.ok) return data;
        // `motivo` viaja además del mensaje: la pantalla decide con él, no
        // leyendo el texto. Un final que se distingue por su redacción se rompe
        // el día que alguien mejora la frase — y sólo uno de los tres se arregla
        // agregando un dato («no encontrado»: falta el teléfono). Al freno y a
        // la caída no hay dato que los cure.
        return {
            ok: false,
            motivo: data?.motivo ?? 'no_disponible',
            mensaje: data?.mensaje ?? 'No se pudo consultar en este momento. Intenta de nuevo en un rato.',
        };
    } catch (e) {
        console.error('misPuntos.js:', e);
        return {
            ok: false,
            motivo: 'sin_conexion',
            mensaje: 'No se pudo consultar en este momento. Revisa tu conexión e intenta de nuevo.',
        };
    }
}
