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
 * @param {Array<{tabla: string, evento?: string, filtro?: string}>} escuchas
 * @param {(payload) => void} alCambiar
 * @returns {() => void}   cierra el canal
 */
export function escucharCambios(canal, escuchas, alCambiar) {
    let ch = supabase.channel(canal);
    for (const { tabla, evento = '*', filtro } of escuchas) {
        ch = ch.on('postgres_changes',
            { event: evento, schema: 'public', table: tabla, ...(filtro ? { filter: filtro } : {}) },
            alCambiar);
    }
    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
}
