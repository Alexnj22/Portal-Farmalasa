/**
 * El rótulo de un campo de formulario — una sola definición.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * El rótulo se escribía a mano en cada campo, y su alto salía de lo que
 * tuviera adentro. Medido con Chromium sobre el CSS compilado el 2026-08-26,
 * en el alta de personal:
 *
 *     sólo texto ............ 15px   (42 campos)
 *     con «Requerido» ....... 25px   (18 campos)
 *     con un botón chico .... 28px
 *     con un botón normal ... 36px   (y margen −2 en vez de 6)
 *
 * O sea que dos campos vecinos arrancaban hasta **21px** desalineados, y la
 * diferencia no dependía del diseño sino de si a ese campo le tocaba una
 * insignia. Es lo que reportó el usuario mirando teléfono y correo: *«aquí se
 * ve la diferencia aún, teléfono y correo tiene distinto tamaño»*.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * **El alto del rótulo lo fija el rótulo, no su contenido.** Son 20px, que es
 * lo que ocupa la insignia más chica; el texto (12px) y la acción (15px) se
 * centran adentro. Con el alto fijo, dos campos cualesquiera empiezan en el
 * mismo píxel — sin importar cuál lleve insignia y cuál no.
 *
 * Lo que entra en esos 20px tiene su límite:
 *   · una insignia va `size="sm"` (19.5px). La normal mide 25 y no cabe.
 *   · una acción va `size="rotulo"` (20px, con su área táctil de 44 por
 *     pseudo-elemento). Un botón `xs` mide 28 y tampoco cabe.
 */

/** El alto fijo de la fila del rótulo. Lo consume el gate y las pruebas. */
export const ALTO_ROTULO = 'h-5';

/**
 * @param {string} tono clase de color del texto (`text-content-3` por defecto)
 * @param {{ denso?: boolean }} opciones `denso` = el rótulo de un sub-campo
 *   dentro de una tarjeta, un punto más chico. El ALTO no cambia: si cambiara,
 *   volvería el mismo defecto un nivel más abajo.
 */
export function rotuloCampo(tono = 'text-content-3', { denso = false } = {}) {
    return [
        denso ? 'text-micro' : 'text-caption',
        'font-black uppercase tracking-widest',
        tono,
        'ml-1 mb-1.5',
        ALTO_ROTULO,
        'flex items-center justify-between gap-2',
        // ── El alto fijo no alcanza solo ────────────────────────────────────
        // Con el alto puesto y nada más, un aviso largo —«Debe ser posterior al
        // inicio»— parte en dos líneas y **se sale** del rótulo hacia abajo,
        // encima del campo: medido, la caja mide 20 y su contenido 27. O sea
        // que fijar el alto sin acotar el contenido cambia un desalineado por
        // un encimado, que es peor porque tapa un dato.
        //
        // Así que nada envuelve, nada se sale, y el que cede es el TEXTO del
        // rótulo —con puntos suspensivos— y no el aviso: el nombre del campo se
        // adivina por su lugar, el aviso no.
        'overflow-hidden whitespace-nowrap',
        '[&>span:first-child]:min-w-0 [&>span:first-child]:truncate',
        '[&>*:not(:first-child)]:shrink-0',
    ].join(' ');
}
