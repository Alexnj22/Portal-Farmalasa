// ── Una función de la base que puede no existir todavía ─────────────────────
//
// Los pasos del pedido que el navegador hacía en tres a siete escrituras
// sueltas (finalizar, la llegada, el reenvío, programar la entrega, las hojas)
// pasan a UNA función de la base cada uno, que los hace en una transacción
// (2026-10-08). Pero esas funciones llegan a producción DESPUÉS que el código:
// la pantalla nueva tiene que andar igual contra una base que todavía no las
// tiene.
//
// `rpcConRespaldo(nombre, params, respaldo)` intenta la función y, sólo si la
// base contesta que NO EXISTE, corre `respaldo` —el camino de pasos sueltos de
// siempre— y RECUERDA que no existe para no volver a preguntar en cada clic.
// Cualquier otro error (permiso, YA_FINALIZADO, red) se devuelve tal cual: el
// respaldo no es un reintento, y correrlo después de un rechazo de negocio
// haría justo lo que la función se negó a hacer.
//
// «No existe» son dos códigos: `PGRST202` lo da PostgREST cuando no encuentra
// la función con esos parámetros en su caché, y `42883` lo da Postgres cuando
// la llamada llega igual (caché vieja). La memoria vive lo que vive el módulo:
// al recargar la página se vuelve a preguntar, que es lo que hace que el día
// que la función llegue a producción se empiece a usar sin tocar nada.
//
// Devuelve `{ data, error, camino }` — `camino` es 'rpc' o 'respaldo', para
// quien necesite saber qué forma tiene `data`. `respaldo` devuelve
// `{ data, error }` o lanza; si lanza, se devuelve como `error`.
import { supabase } from '../supabaseClient';

const CODIGOS_DE_FUNCION_INEXISTENTE = new Set(['PGRST202', '42883']);
const inexistentes = new Set();

export function esFuncionInexistente(error) {
    return !!error && CODIGOS_DE_FUNCION_INEXISTENTE.has(error.code);
}

// Los rechazos de negocio llegan como `CÓDIGO: texto` (`RAISE EXCEPTION
// 'YA_FINALIZADO: …'`). Devuelve el código, o null si no tiene esa forma.
export function codigoDeNegocio(error) {
    const m = /^([A-Z][A-Z_]+):/.exec(typeof error === 'string' ? error : (error?.message ?? ''));
    return m ? m[1] : null;
}

export async function rpcConRespaldo(nombre, params, respaldo) {
    if (!inexistentes.has(nombre)) {
        const res = await supabase.rpc(nombre, params);
        if (!esFuncionInexistente(res?.error)) {
            return { data: res?.data ?? null, error: res?.error ?? null, camino: 'rpc' };
        }
        inexistentes.add(nombre);
        console.warn(`[rpcConRespaldo] ${nombre} no existe en esta base: se usa el camino de pasos sueltos.`);
    }
    try {
        const r = await respaldo();
        return { data: r?.data ?? null, error: r?.error ?? null, camino: 'respaldo' };
    } catch (error) {
        return { data: null, error, camino: 'respaldo' };
    }
}

/** Sólo para pruebas: olvida qué funciones se dieron por inexistentes. */
export function olvidarFuncionesInexistentes() {
    inexistentes.clear();
}
