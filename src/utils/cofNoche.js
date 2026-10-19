// ─────────────────────────────────────────────────────────────────────────────
// Consumidor final emitido de las 6:00 p. m. en adelante: NO se envía a
// Hacienda (decisión del usuario, 2026-10-19, todas las sucursales).
//
// No es pendiente, no se avisa, y anularlo es sólo anularlo en la caja. La
// regla canónica es `public.cof_no_se_envia_mh(tipo, fecha, hora)`; ésta es su
// gemela del frente, y `regularizar-dte` tiene la tercera (`COF_SIN_ENVIO_*`).
// **Al cambiar una, cambiar las tres** — si divergen, una pantalla dice
// «pendiente» de algo que el envío ya decidió no mandar.
// ─────────────────────────────────────────────────────────────────────────────

export const COF_SIN_ENVIO_DESDE = '2026-10-19';
export const COF_SIN_ENVIO_HORA = '18:00:00';

/** ¿Este documento es un COF de la noche, de los que no se envían? */
export function cofNoSeEnviaMh(tipoDocumento, fecha, hora) {
    return tipoDocumento === 'COF'
        && !!fecha && String(fecha) >= COF_SIN_ENVIO_DESDE
        && !!hora && String(hora) >= COF_SIN_ENVIO_HORA;
}

/**
 * Las condiciones de PostgREST para «NO es un COF de la noche», por la
 * positiva y con los NULL adentro (en SQL la función los da por enviables, y
 * `neq` con NULL deja la fila afuera). Para meter dentro de un `or(...)`.
 */
export const NO_ES_COF_NOCHE =
    `tipo_documento.is.null,tipo_documento.neq.COF,fecha.is.null,fecha.lt.${COF_SIN_ENVIO_DESDE},` +
    `hora.is.null,hora.lt.${COF_SIN_ENVIO_HORA}`;
