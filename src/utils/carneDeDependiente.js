/**
 * El carné de dependiente de farmacia, que ya no es un papel.
 *
 * ── Qué cambió ─────────────────────────────────────────────────────────────
 *
 * El Consejo Superior de Salud Pública lo digitalizó: en vez de una tarjeta que
 * se fotografía y se adjunta, entrega un **QR** que lleva a la ficha en línea,
 * del estilo
 *
 *     https://expedientes.srs.gob.sv/carnets/dependientes/1758306680151
 *
 * Lo que el expediente guarda es esa **dirección**, no una foto del QR. Guardar
 * el dibujo sería guardar la imagen de un puntero: la ficha de verdad vive en
 * el sitio del Consejo y se actualiza sola cuando la persona reacredita, así
 * que una foto envejece y la dirección no. Y con la dirección el portal puede
 * volver a pintar el QR cuando haga falta — al revés no se puede.
 *
 * ── Por qué se comprueba el DOMINIO y no la ruta ───────────────────────────
 *
 * Sin ninguna comprobación, este campo acepta cualquier enlace y el expediente
 * termina con un puntero a cualquier cosa. Atado a la ruta exacta, el día que
 * el Consejo reacomode su sitio el portal empieza a rechazar carnés válidos y
 * nadie va a saber por qué.
 *
 * El dominio es el punto medio, y la misma regla está escrita en el CHECK de la
 * base — las dos tienen que decir lo mismo: si la pantalla acepta algo que la
 * base rechaza, el guardado falla con un error de Postgres en la cara de quien
 * lo escribió.
 */

// `https` obligatorio, `srs.gob.sv` con o sin subdominio, y algo después de la
// barra. Lo último importa: `https://srs.gob.sv/` a secas no es el carné de
// nadie.
//
// El `([a-z0-9-]+\.)*` va ANCLADO contra el final del host por el `/` que
// sigue, y eso es lo que hace que `https://srs.gob.sv.otracosa.com/x` no pase
// — el truco del sufijo es la forma clásica de burlar una comprobación de
// dominio escrita con `includes()`.
const DEL_CSSP = /^https:\/\/([a-z0-9-]+\.)*srs\.gob\.sv\/./i;

/** ¿Ese texto es un carné del Consejo? */
export function esCarneDeDependiente(texto) {
    return DEL_CSSP.test(String(texto || '').trim());
}

/**
 * Limpia lo que se escaneó o se pegó.
 * Devuelve la dirección, o `null` si no es un carné del Consejo.
 */
export function normalizarCarne(texto) {
    const limpio = String(texto || '').trim();
    return esCarneDeDependiente(limpio) ? limpio : null;
}

/**
 * El número que el Consejo usa como identificador, para mostrarlo.
 *
 * Es el último tramo de la dirección. Se muestra sólo si son dígitos: mostrar
 * un tramo cualquiera como si fuera «el número del carné» sería inventar un
 * dato con forma de dato.
 */
export function numeroDelCarne(url) {
    if (!esCarneDeDependiente(url)) return null;
    const ultimo = String(url).trim().replace(/\/+$/, '').split('/').pop();
    return /^\d{4,}$/.test(ultimo) ? ultimo : null;
}

/** Por qué no se aceptó, dicho para quien lo escaneó. */
export function porQueNoSirve(texto) {
    const limpio = String(texto || '').trim();
    if (!limpio) return 'No se leyó nada. Acerca el código y vuelve a intentar.';
    if (!/^https?:\/\//i.test(limpio)) {
        return 'Ese código no lleva a ninguna dirección. Comprueba que sea el QR del carné.';
    }
    if (/^http:\/\//i.test(limpio) && /srs\.gob\.sv/i.test(limpio)) {
        return 'La dirección no va por conexión segura. Comprueba que sea el QR oficial.';
    }
    return 'Esa dirección no es del Consejo Superior de Salud Pública. Comprueba que sea el QR del carné.';
}
