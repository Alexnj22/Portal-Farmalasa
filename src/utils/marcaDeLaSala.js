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

/**
 * El logo de la EMPRESA — «Farmacias La Popular y La Salud».
 *
 * Va en el carné de todo el mundo: *«debe salir el logo completo, el de
 * Farmacias La Popular y La Salud para todos, ya que ésa es la empresa»*
 * (usuario, 2026-08-31). Un carné acredita a alguien ante la EMPRESA y no ante
 * la sucursal donde le tocó ese mes — quien se traslada de Salud 3 a La Popular
 * no cambia de patrono.
 *
 * ── Este archivo está APROBADO, y la vuelta que dio importa ────────────────
 *
 * Se armó a pedido del usuario juntando el icono aprobado con el nombre de la
 * empresa. Después llegó su regla —*«no se crean logos, ni se generan logos de
 * la nada»*— y se borró: yo lo había compuesto, así que caía de lleno.
 *
 * Y estaba mal borrarlo. Él lo había pedido y lo había visto: *«pero ese logo
 * sí te lo validé, yo te lo pedí»*. **Lo que hace aprobado a un logo es que la
 * empresa lo apruebe**, no que lo haya dibujado un diseñador — y la regla
 * existe para que nadie invente marca por su cuenta, no para tirar la que sí se
 * revisó.
 *
 * O sea que la regla se aplicó bien al procedimiento y mal al caso. Sigue
 * valiendo entera: lo que NO se puede es componer uno nuevo y usarlo sin que
 * nadie lo mire. Éste se miró.
 *
 * Lo único que arrastra y conviene saber: **la tipografía no es la de la
 * marca** —no vino con los archivos originales— así que es la más cercana
 * disponible. Si algún día llega la de verdad, se rehace y se reemplaza el
 * archivo; el código no cambia.
 */
export const LOGO_DE_LA_EMPRESA = '/logo-farmacias.png';

/**
 * El logo como data URL, **con sus medidas**.
 *
 * ── Por qué devuelve el tamaño y no sólo la imagen ─────────────────────────
 *
 * Porque quien lo dibuja tiene que respetar su proporción, y ésa cambia según
 * cuál sea. Los de sala son ~3.55:1 y el de la empresa entera es **7.34:1**:
 * con el alto y el ancho escritos a mano para uno, el otro sale aplastado — y
 * un logo aplastado no da error, se imprime igual.
 *
 * Midiéndolo del propio archivo, cambiar el logo por otro no lo deforma. Es la
 * otra mitad de la regla de no componer logos: tampoco se les cambia la forma.
 *
 * Devuelve `null` si no se pudo traer: el carné tiene que salir igual, con el
 * icono aprobado y el nombre de la empresa en texto. Un documento que no se
 * genera porque no cargó una imagen es peor que uno con menos marca.
 *
 * @returns {Promise<{dataUrl: string, ancho: number, alto: number} | null>}
 */
export async function logoComoDataUrl(ruta) {
    if (typeof document === 'undefined') return null;
    try {
        const r = await fetch(ruta);
        if (!r.ok) return null;
        const blob = await r.blob();
        const dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
        });
        const { ancho, alto } = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res({ ancho: im.naturalWidth, alto: im.naturalHeight });
            im.onerror = rej;
            im.src = dataUrl;
        });
        if (!ancho || !alto) return null;
        return { dataUrl, ancho, alto };
    } catch {
        return null;
    }
}

/**
 * Cómo se llama la sede de alguien en un carné.
 *
 * ── Por qué no alcanza con el nombre de la sucursal ────────────────────────
 *
 * El carné decía «Sala · Administracion» para quien trabaja en casa matriz, y
 * el usuario lo levantó: *«en el caso de Edemir, que no tiene un área en
 * específico, ¿no debería salir como casa matriz?»*.
 *
 * Tiene razón dos veces. **«Sala» es de las farmacias**: un técnico de
 * mantenimiento no tiene sala, tiene sede. Y **«Administracion» es el nombre
 * interno de una sucursal en la tabla**, no como se llama ese lugar cuando se lo
 * nombra afuera — el reglamento interno lo llama **casa matriz** (Art. 6:
 * «La Empresa tiene su casa matriz en Calle Morazán, casa No. 39…»), y ése es el
 * término de la empresa, no uno inventado acá.
 *
 * ── Se decide por el TIPO, nunca por el nombre ─────────────────────────────
 *
 * `branches.type` ya distingue FARMACIA, BODEGA y ADMINISTRATIVA. Mirar el
 * nombre en su lugar sería cruzar por un rótulo —«¿se llama Administracion?»— y
 * el día que alguien lo renombre a «Oficinas» el carné volvería a decir «Sala ·
 * Oficinas» sin que nada falle. Es la regla del proyecto: un rótulo no es una
 * clave.
 *
 * Bodega sí se nombra: es un lugar de verdad y quien trabaja ahí trabaja ahí.
 * Lo que no es una sala es la casa matriz.
 *
 * @param {string} nombre  `branches.name`
 * @param {string} tipo    `branches.type` — FARMACIA · BODEGA · ADMINISTRATIVA
 */
export function comoSeLlamaLaSede(nombre, tipo) {
    if (tipo === 'ADMINISTRATIVA') return 'Casa Matriz';
    if (tipo === 'BODEGA') return nombre || 'Bodega';
    // Sin tipo se cae del lado de la farmacia, que son seis de las ocho sedes y
    // el único caso donde «Sala ·» es cierto.
    return nombre ? `Sala · ${nombre}` : '';
}
