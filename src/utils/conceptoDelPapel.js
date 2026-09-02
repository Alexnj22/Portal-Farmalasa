/**
 * Qué operación fue, dicho por el papel.
 *
 * ── Por qué es una frase y no un catálogo ──────────────────────────────────
 * `tipo_operacion` + el nombre impreso son lo que el lector de boletas ya
 * extrae, y juntos dicen exactamente lo que alguien escribiría a mano: «Pago de
 * CAESS», «Remesa Money Gram WS», «Retiro Token». Un catálogo obligaría a
 * mantener una lista de operaciones del POS que nadie controla —las agrega el
 * banco, no el portal— y a elegir de esa lista, que es justamente lo que este
 * campo existe para evitar.
 *
 * ── Manda lo IMPRESO, no el enum ───────────────────────────────────────────
 * `tipo_operacion` agrupa y el papel distingue. Dos boletas reales de Banco
 * Promerica del 2-sep-2026 lo muestran: una dice «RETIRO TOKEN / PAGO CTK» y la
 * otra «REMESA / MONEY GRAM WS», y las dos caen en un solo valor del enum cada
 * una. Con el enum solo, la primera se resumía a «Retiro de efectivo» y perdía
 * el «Token» — que es la palabra con la que la sala la reconoce y la que el
 * usuario nombró al dar la referencia. Por eso el lector devuelve además
 * `operacion_impresa`, y ésa es la que se escribe cuando existe.
 *
 * ── LA CABECERA NO ES LA CONTRAPARTE ───────────────────────────────────────
 * Es la regla que gobierna todo este archivo. La boleta la imprime el POS y
 * arriba lleva el banco que procesa el cobro —«BANCO PROMERICA»—, que es el
 * aparato de la farmacia y NUNCA con quién se hizo la operación. Quién es la
 * contraparte vive en el renglón de abajo de la línea de la operación, y el
 * lector lo devuelve con el nombre que le corresponde: `red_remesas` para una
 * remesa, `servicio` para el pago de un recibo.
 *
 * Costó una remesa trabada el 2026-08-21, y del lado de los pagos se estaba
 * cobrando sola: el 2-sep había **siete entradas del día** diciendo «Pago de
 * Banco Promerica», «Depósito Banco Promerica» y «Compra en Banco Promerica»
 * sobre recibos de luz, agua y teléfono. Ninguna decía qué se pagó, y ninguna
 * dio error — el nombre estaba impreso en el papel, sólo que era el del
 * procesador.
 *
 * Por eso `PAGO_SERVICIO` y `DEPOSITO` NO caen a `entidad`: sin el dato del
 * detalle prefieren decir menos («Pago de servicio») antes que decir el
 * nombre equivocado con seguridad. `COMPRA` sí lo usa, y es la excepción real:
 * en el tiquete de una tienda la cabecera ES el comercio —«FERRETERIA DON
 * GENARO»—, que es justo a quién se le compró.
 *
 * Cuando el papel no nombra a nadie queda la operación sola («Remesa»,
 * «Depósito»): decir menos es correcto, inventar el nombre no. Y si tampoco se
 * pudo leer la operación, se devuelve el nombre impreso —mejor que nada— o
 * cadena vacía, que es lo que abre el campo para escribirlo a mano.
 *
 * ── Vive acá y no dentro de una pantalla ───────────────────────────────────
 * Lo usan los DOS lados del POS Promerica: la entrada (`MiCajaView`) y la
 * salida (`SalidaDeBolsa`). Escrito dos veces, el día que una remesa cambie de
 * redacción sólo cambiaría en una mitad y el mismo papel diría dos cosas según
 * por dónde entró.
 */

/**
 * El papel imprime TODO en mayúsculas, y «RETIRO TOKEN» gritado en pantalla se
 * lee peor que «Retiro Token». Se capitaliza sólo si venía toda en mayúsculas:
 * `MoneyGram` ya trae su forma y volverlo `Moneygram` sería romperlo para
 * «arreglarlo».
 *
 * Las palabras SIN VOCALES se quedan como estaban: son siglas —«WS», «CTK»—, y
 * «Ws» no es el nombre de nada. La regla es ésa y no «las cortas», que fue el
 * primer intento y devolvía «Ferreteria DON Genaro»: «DON» también tiene tres
 * letras.
 *
 * ⚠️ Se aplica SÓLO a `operacion_impresa`. La entidad y la red se escriben tal
 * como el papel las trae, porque ahí las siglas sí llevan vocales —CAESS, ANDA,
 * RIA— y capitalizarlas las rompe. Lo que se gana es cosmético; lo que se
 * perdería es el nombre de a quién se le pagó.
 */
function enTitulo(texto) {
    const t = String(texto ?? '').trim();
    if (!t || t !== t.toUpperCase()) return t;
    return t.split(/\s+/)
        .map((p) => (/[AEIOU]/.test(p) ? p[0] + p.slice(1).toLowerCase() : p))
        .join(' ');
}

export function conceptoDelPapel(leido) {
    const impresa = enTitulo(leido?.operacion_impresa);
    // Los dos salen del DETALLE, no de la cabecera. Ver el comentario de arriba.
    const red = String(leido?.red_remesas || '').trim();
    const servicio = String(leido?.servicio || '').trim();
    // La cabecera. Se usa en un solo caso, y está dicho por qué.
    const cabecera = String(leido?.entidad || '').trim();
    switch (String(leido?.tipo_operacion || '').toUpperCase()) {
        // La red va primero aunque haya línea impresa: ésta dice «REMESA» a
        // secas y la red es lo que distingue una remesa de otra.
        case 'REMESA':        return red ? `Remesa ${red}` : (impresa || 'Remesa');
        case 'PAGO_SERVICIO': return servicio ? `Pago de ${servicio}` : (impresa || 'Pago de servicio');
        // El POS entrega efectivo contra una tarjeta, un token o una cuenta. No
        // lleva a quién: el nombre impreso ahí es el banco del aparato — lo que
        // sí distingue es CÓMO se retiró, y eso lo dice la línea del papel.
        case 'RETIRO':        return impresa || 'Retiro de efectivo';
        case 'DEPOSITO':      return servicio ? `Depósito ${servicio}` : (impresa || 'Depósito');
        // La única que usa la cabecera, y a propósito: en el tiquete de una
        // tienda el nombre de arriba ES el comercio donde se compró.
        case 'COMPRA':        return cabecera ? `Compra en ${cabecera}` : (impresa || 'Compra');
        default:              return impresa || cabecera;
    }
}

export default conceptoDelPapel;
