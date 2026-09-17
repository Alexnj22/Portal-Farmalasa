/**
 * Una acción que no se ejecuta dos veces a la vez.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Un botón `disabled={ocupado}` NO alcanza cuando lo que apaga `ocupado` llega
 * después de un `await`. El caso medido (2026-09-17, movimientos de caja):
 *
 *     const guardar = async () => {
 *         if (foto) fotoUrl = await subirComprobante(foto, …);  // ← cientos de ms
 *         onAnotar({ … });                                       // ← recién acá
 *     };                                                         //   se enciende `ocupado`
 *
 * Mientras la foto sube, el botón sigue vivo. Un segundo toque arranca un
 * `guardar()` entero y paralelo, y los dos terminan escribiendo. En producción
 * eso dejó **13 movimientos de más y $377.61 duplicados** entre el 4 y el 16 de
 * septiembre, con los pares separados por 34 a 73 milisegundos — y un caso con
 * TRES registros en un solo segundo.
 *
 * El tell que lo delató: los duplicados instantáneos aparecen SÓLO en los tipos
 * que piden foto (9 de 9 en POS Promerica) y en NINGUNO de los que no la piden
 * (0 de 55 en aplicación de inyección y glucosa). No era la sala escribiendo
 * dos veces: era la ventana de la subida.
 *
 * ── Por qué un `useState` no sirve para esto ────────────────────────────────
 *
 * `setEnviando(true)` no cambia nada hasta el próximo render. Dos toques dentro
 * del mismo tick pasan los dos por el `if`. Por eso el cerrojo tiene que ser
 * SÍNCRONO —una variable que se escribe y se lee en la misma vuelta—, y el
 * estado queda sólo para apagar el botón a la vista.
 *
 * ── Qué NO es ───────────────────────────────────────────────────────────────
 *
 * No es una protección contra escribir dos veces: para eso está la clave de
 * envío y su índice único en la base, que sí cubren dos pestañas, un reintento
 * de red o dos personas. Esto evita el caso común —el doble toque— y hace que
 * el segundo toque no tenga efecto, pero la garantía vive en el servidor.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn
 * @returns {F} la misma función, que mientras esté en vuelo devuelve la promesa
 *   de la primera llamada en vez de arrancar otra.
 */
export function unaSolaVez(fn) {
    let enVuelo = null;
    return /** @type {any} */ ((...args) => {
        // Devuelve la promesa EN CURSO y no `undefined`: quien llamó segundo
        // sigue pudiendo `await` y enterarse de cómo terminó. Contestarle
        // `undefined` lo obligaría a distinguir «no corrió» de «terminó sin
        // valor», que es justo la confusión que este archivo viene a evitar.
        if (enVuelo) return enVuelo;
        enVuelo = (async () => fn(...args))()
            // El cerrojo se suelta PASE LO QUE PASE. Si sólo se soltara al
            // terminar bien, un fallo de red dejaría el botón muerto y la
            // única salida sería recargar la página — perdiendo lo escrito.
            .finally(() => { enVuelo = null; });
        return enVuelo;
    });
}
