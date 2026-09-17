/**
 * Qué pasa cuando ese número de boleta YA está anotado en la sala.
 *
 * ── Por qué el número basta ─────────────────────────────────────────────────
 *
 * El número de una boleta de POS es el ID de la transacción: el aparato no lo
 * repite nunca. Así que dos movimientos con el mismo número en la misma sala
 * hablan SIEMPRE de la misma operación. No hay coincidencia posible.
 *
 * ── Pero hay DOS desenlaces, y no son el mismo ──────────────────────────────
 *
 * Medido sobre los repetidos reales de septiembre de 2026:
 *
 *   · **Mismo sentido** (dos entradas, o dos salidas) → es un DUPLICADO. El
 *     dinero se contaría dos veces por una sola operación. Frena.
 *
 *   · **Sentido contrario** (una entrada y una salida) → es una CORRECCIÓN.
 *     Alguien anotó una remesa como ingreso —siendo que una remesa sale del
 *     cajón— y la contra-anotó para arreglarlo. Las tres correcciones reales
 *     tienen esa forma y lo dicen en el concepto: «se realizó entrada y era
 *     remesa», «corrección de remesa que se hizo como ingreso». Eso se avisa y
 *     quien registra decide.
 *
 * Frenar la corrección sería dejar sin salida a quien ya se equivocó, que es la
 * peor manera de castigar un error honesto. Y no frenar el duplicado es lo que
 * costó $377.61 en doce días.
 *
 * ── Por qué vive acá y no en el componente ──────────────────────────────────
 *
 * Porque es una REGLA, y una regla escrita dentro de un `useMemo` no se puede
 * probar sin dibujar la pantalla entera. El texto que se muestra sí se arma
 * allá: eso es redacción, no decisión.
 *
 * @param {Array<{tipo: string}>} repetidas  lo que devolvió `boleta_ya_en_caja`
 * @param {boolean} entra  si lo que se está anotando es un ingreso
 * @returns {{bloquea: boolean, movimiento: object}|null} `null` = no hay choque
 */
export function choqueDeBoleta(repetidas, entra) {
    const lista = Array.isArray(repetidas) ? repetidas : [];
    if (!lista.length) return null;

    const sentido = entra ? 'ENTRADA' : 'SALIDA';
    const mismoSentido = lista.find((m) => String(m?.tipo || '').toUpperCase() === sentido);

    // El duplicado gana sobre la corrección: si entre los repetidos hay uno del
    // mismo sentido, eso es lo que hay que decir aunque además haya otro del
    // contrario. Al revés se avisaría «es una corrección» sobre un duplicado.
    if (mismoSentido) return { bloquea: true, movimiento: mismoSentido };
    return { bloquea: false, movimiento: lista[0] };
}

export default choqueDeBoleta;
