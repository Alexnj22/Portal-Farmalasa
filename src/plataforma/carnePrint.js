// El carné de papel: el ticket que sale del rollo y se pasa por el lector.
//
// ── Qué lleva y por qué ─────────────────────────────────────────────────────
// El código de barras, el nombre de quien lo va a usar y hasta cuándo vale.
//
// **Lo que NO lleva es el código escrito.** Instrucción del usuario el
// 2026-08-20: «JAMÁS lo debes mostrar». Es una credencial —este papel abre el
// portal— y en claro basta una foto desde el otro lado del mostrador. Lo apaga
// `HRI_APAGADO` en `ticketPrint.js`, con el comando explícito y no confiando en
// el valor por defecto de la impresora.
//
// No lleva foto ni sello: es un papel térmico que se borra en semanas y que
// vale hasta medianoche. Confundirlo con el carné de plástico sería el peor
// resultado posible, así que el título lo dice y el pie lo repite.
//
// ── La simbología está en UNA constante a propósito ─────────────────────────
// Arranca en CODE128 porque es la del carné de plástico, o sea la única probada
// contra los lectores que ya hay en las salas. Pero eso está probado contra
// barras impresas por una impresora de etiquetas, no por una ticketera: la hoja
// de prueba (Sistema → Prueba de impresión) imprime las dos simbologías juntas
// para que el papel conteste cuál lee el lector de verdad. Si contesta CODE39,
// lo que cambia es esta línea y nada más.
import { imprimirDocumento } from '@nucleo/utils/ticketPrint';
import { construirCarneDePapel } from '@nucleo/utils/carneDePapel';

// El documento vive en el núcleo (`carneDePapel`): la app imprime el mismo.
export { SIMBOLOGIA_DEL_CARNE, construirCarneDePapel } from '@nucleo/utils/carneDePapel';

/**
 * Emite nada: recibe el carné ya emitido y lo manda al rollo.
 *
 * `sala` es la sucursal de QUIEN IMPRIME, no la del empleado: el papel se le
 * entrega en mano a alguien que está parado ahí. Mandarlo a la sala del
 * empleado lo haría salir en un mostrador donde no hay nadie esperándolo.
 */
export function imprimirCarneDePapel(datos, { sala = null, soloCola = false } = {}) {
    // `soloCola` viaja: con una sala ELEGIDA, si su caja no lo recibe se dice y
    // no sale por esta computadora — quien lo espera está en la otra sala.
    // Antes se descartaba al desestructurar y el papel caía acá en silencio.
    return imprimirDocumento(construirCarneDePapel(datos), { sala, soloCola });
}

// ── El carné de PLÁSTICO ────────────────────────────────────────────────────
//
// No vive acá: es la tarjeta DE PIE de `documentoDeBienvenida.js`
// (`descargarHojaDeCarnes`), la misma que sale al crear al empleado. Reimprimir
// usa ésa y no otro dibujo — el 2026-11-17 se armó aquí uno acostado y el
// usuario lo rechazó: «el que debe salir es el que se imprime al crear el
// empleado». NO va al rollo: lleva el `kiosk_pin`, la credencial permanente.
