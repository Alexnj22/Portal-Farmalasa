/**
 * alfabetico — en qué cajón A–Z cae un nombre, para un índice alfabético.
 *
 * No es "el primer carácter". En el catálogo de laboratorios **71 de 356**
 * empiezan con un prefijo numérico del ERP (`1-ABBOTT NUTRICIONAL`,
 * `1.1-INSUMOS`, `2 -BAYER`). Agrupar por el primer carácter mandaría a Abbott
 * al cajón "1", que es el último lugar donde alguien lo busca.
 *
 * Regla: se salta dígitos, espacios y puntuación del principio, y se agrupa por
 * la primera LETRA de lo que queda. Lo que no tiene ninguna letra cae en `#`.
 *
 * `claveAlfabetica` es además la clave de ORDEN. Las dos cosas tienen que salir
 * de la misma función: si se ordena por el nombre crudo y se agrupa por la letra
 * limpia, los grupos no quedan contiguos y un índice que salta a "B" aterriza en
 * cualquier parte.
 */

// Sin tildes, para que "ÁLAMO" caiga en A y no abra un cajón propio.
const sinTildes = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** El nombre sin su prefijo numérico, en mayúsculas. Clave de orden y de grupo. */
export function claveAlfabetica(label = '') {
    const plano = sinTildes(label);
    // Se saltan TODOS los caracteres iniciales que no son letra, no una lista
    // de los que se me ocurrieron: en el catálogo real aparece `3-*BONIN
    // SOLUCIONES`, y con una lista cerrada el `*` sobrevivía y mandaba a Bonin
    // al cajón `#` en vez de a la B.
    const limpio = plano.replace(/^[^A-Za-z]+/, '').trim().toUpperCase();
    // Si al quitar el prefijo no queda nada (ej. "123"), se usa el original:
    // vale más caer en `#` que desaparecer del índice.
    return limpio || plano.trim().toUpperCase();
}

/** La letra del cajón: `A`–`Z`, o `#` para lo que no empieza con letra. */
export function letraDe(label = '') {
    const c = claveAlfabetica(label).charAt(0);
    return c >= 'A' && c <= 'Z' ? c : '#';
}

/**
 * Agrupa y ordena una lista de opciones `{ value, label }` para un índice A–Z.
 * `#` va primero: es el cajón de lo que no encaja, y esconderlo al final de la Z
 * lo vuelve inalcanzable en una lista de 356.
 */
export function agruparPorLetra(opciones = []) {
    const ordenadas = [...opciones].sort((a, b) => {
        const la = letraDe(a.label), lb = letraDe(b.label);
        if (la !== lb) return la === '#' ? -1 : lb === '#' ? 1 : (la < lb ? -1 : 1);
        return claveAlfabetica(a.label).localeCompare(claveAlfabetica(b.label), 'es');
    });

    const grupos = [];
    for (const o of ordenadas) {
        const letra = letraDe(o.label);
        if (!grupos.length || grupos[grupos.length - 1].letra !== letra) grupos.push({ letra, items: [] });
        grupos[grupos.length - 1].items.push(o);
    }
    return grupos;
}
