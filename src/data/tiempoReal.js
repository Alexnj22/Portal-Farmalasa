import { supabase } from '../supabaseClient';

// ── Escuchar cambios de la base en vivo ──────────────────────────────────────
//
// Cinco pantallas abrían su canal de realtime a mano (F3 del núcleo portable):
// la barra de sincronización, el contador de ventas perdidas, las rutas y el
// mapa de una ruta. Esta es la pieza de abajo, sin política: abre el canal y
// devuelve cómo cerrarlo. Para una pantalla de trabajo compartido que además
// tiene que recuperar lo que se perdió con el socket caído, el hook correcto es
// `useRefrescoEnVivo`.

/**
 * @param {string} canal   nombre único del canal
 * @param {Array<{tabla: string, evento?: string, filtro?: string, alCambiar?: Function}>} escuchas
 *        cada una puede traer su propio `alCambiar`; si no, usa el general
 * @param {(payload) => void} [alCambiar]
 * @returns {() => void}   cierra el canal
 */
// `supabase.channel(nombre)` DEVUELVE el canal existente si ya hay uno con ese
// nombre, y agregarle escuchas a uno ya suscrito lanza («cannot add
// postgres_changes callbacks … after subscribe()»). Pasa cuando la misma
// pantalla queda dos veces en la pila de la app, o cuando el cierre del
// montaje anterior todavía no corrió. Por eso cada llamada abre el suyo.
let abiertos = 0;

export function escucharCambios(canal, escuchas, alCambiar) {
    abiertos += 1;
    let ch = supabase.channel(`${canal}#${abiertos}`);
    for (const { tabla, evento = '*', filtro, alCambiar: propio } of escuchas) {
        ch = ch.on('postgres_changes',
            { event: evento, schema: 'public', table: tabla, ...(filtro ? { filter: filtro } : {}) },
            propio ?? alCambiar);
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
}
