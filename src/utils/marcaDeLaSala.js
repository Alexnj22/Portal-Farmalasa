/**
 * De qué farmacia es una sala, y con qué logo se la nombra.
 *
 * ── La regla, dicha por el usuario ─────────────────────────────────────────
 *
 * *«Según quién vea: si La Popular o La Salud (todos los demás)»* (2026-08-31).
 *
 * O sea que **La Popular es la excepción y La Salud el resto**, y así está
 * escrito acá: no como una lista de las salas de La Salud —que habría que
 * ampliar cada vez que abra una— sino como «¿es La Popular? entonces Popular;
 * si no, Salud». Una sala nueva cae del lado correcto sin que nadie la agregue,
 * que es la diferencia entre una regla y un catálogo escrito a mano.
 *
 * Bodega y Administración caen en La Salud, y es lo correcto: no son salas de La
 * Popular.
 */

/** El único nombre que manda a La Popular. */
const POPULAR = /popular/i;

/**
 * @param {string} sala  el NOMBRE de la sucursal, como lo dice `branches.name`
 * @returns {'popular' | 'salud'}
 */
export function marcaDeLaSala(sala) {
    return POPULAR.test(String(sala || '')) ? 'popular' : 'salud';
}

/** El archivo del logo que le toca a esa sala. */
export function logoDeLaSala(sala) {
    return marcaDeLaSala(sala) === 'popular'
        ? '/logo-la-popular.png'
        : '/logo-la-salud.png';
}

/** El logo de las DOS farmacias, para cuando no se habla de una sala concreta. */
export const LOGO_DE_LAS_DOS = '/logo-farmacias.png';

/**
 * El logo como data URL, que es lo que necesita pdfmake.
 *
 * Devuelve `null` si no se pudo traer: el carné tiene que salir igual, con el
 * icono dibujado que ya usaba. Un documento que no se genera porque no cargó
 * una imagen es peor que uno con el logo viejo.
 */
export async function logoComoDataUrl(ruta) {
    if (typeof document === 'undefined') return null;
    try {
        const r = await fetch(ruta);
        if (!r.ok) return null;
        const blob = await r.blob();
        return await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}
