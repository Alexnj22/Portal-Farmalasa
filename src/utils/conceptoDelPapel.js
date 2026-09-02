/**
 * Qué operación fue, dicho por el papel.
 *
 * ── Por qué es una frase y no un catálogo ──────────────────────────────────
 * `tipo_operacion` + el nombre impreso son lo que el lector de boletas ya
 * extrae, y juntos dicen exactamente lo que alguien escribiría a mano: «Pago de
 * CAESS», «Remesa MONEY GRAM WS», «Retiro de efectivo». Un catálogo obligaría a
 * mantener una lista de operaciones del POS que nadie controla — las agrega el
 * banco, no el portal— y a elegir de esa lista, que es justamente lo que este
 * campo existe para evitar.
 *
 * ── Vive acá y no dentro de una pantalla ───────────────────────────────────
 * Lo usan los DOS lados del POS Promerica: la entrada (`MiCajaView`) y la
 * salida (`SalidaDeBolsa`). Escrito dos veces, el día que una remesa cambie de
 * redacción sólo cambiaría en una mitad y el mismo papel diría dos cosas según
 * por dónde entró.
 *
 * ── La remesa sale SÓLO de `red_remesas` ───────────────────────────────────
 * Y no de `entidad`, que es el nombre de la cabecera. La boleta de una remesa
 * la imprime el POS y arriba lleva el banco que procesa el cobro —«BANCO
 * PROMERICA»—, no la red que entrega el dinero: tomarlo de ahí escribiría
 * «Remesa BANCO PROMERICA», que nombra al aparato y no a la operación. Es la
 * misma trampa que costó una remesa trabada el 2026-08-21.
 *
 * Cuando el papel no nombra a nadie queda la operación sola («Remesa»,
 * «Depósito»): decir menos es correcto, inventar el nombre no. Y si tampoco se
 * pudo leer la operación, se devuelve el nombre impreso —mejor que nada— o
 * cadena vacía, que es lo que abre el campo para escribirlo a mano.
 */
export function conceptoDelPapel(leido) {
    const red = String(leido?.red_remesas || '').trim();
    const quien = red || String(leido?.entidad || '').trim();
    switch (String(leido?.tipo_operacion || '').toUpperCase()) {
        case 'REMESA':        return red ? `Remesa ${red}` : 'Remesa';
        case 'PAGO_SERVICIO': return quien ? `Pago de ${quien}` : 'Pago de servicio';
        // El POS entrega efectivo contra una tarjeta, un token o una cuenta. No
        // lleva a quién: el nombre impreso ahí es el banco del aparato.
        case 'RETIRO':        return 'Retiro de efectivo';
        case 'DEPOSITO':      return quien ? `Depósito ${quien}` : 'Depósito';
        case 'COMPRA':        return quien ? `Compra en ${quien}` : 'Compra';
        default:              return quien;
    }
}

export default conceptoDelPapel;
