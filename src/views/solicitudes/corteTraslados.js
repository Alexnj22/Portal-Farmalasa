/**
 * El corte de traslados del centro de solicitudes.
 *
 * El traslado es la única familia donde el asunto es de OTRA sala: se lo pide
 * una a otra. Mezclado con lo propio —descartes, cargas, cambios a facturación—
 * llenaba la bandeja de trabajo ajeno, así que por defecto no sale.
 *
 * Tres estados y no un interruptor, porque esconder algo sin dejar cómo verlo
 * es esconderlo de verdad:
 *
 *   · `SIN`   — lo de siempre menos los traslados. Es el arranque.
 *   · `TODAS` — sin corte.
 *   · `SOLO`  — nada más los traslados. Es la bandeja de quien vive de
 *               contestarlos, que en la práctica es Bodega.
 *
 * ── Por qué vive acá y no dentro de la vista ────────────────────────────────
 * Porque es la clase de lógica que se invierte sola y en silencio: si `SOLO` y
 * `SIN` se cruzan, las dos pantallas siguen mostrando solicitudes y nadie ve un
 * error — sólo las de al lado. Un módulo aparte se puede fijar con una prueba;
 * dentro del componente habría que montar React, el router y el store para
 * comprobar tres booleanos.
 */
export const MODOS_TRASLADO = ['SIN', 'TODAS', 'SOLO'];

export const TIPO_TRASLADO = 'INVENTORY_TRANSFER_REQUEST';

/**
 * La sala que SURTE, por `branch_id` del portal: Bodega.
 *
 * Es el id y no el nombre a propósito —«un rótulo no es una clave»—, y va
 * escrito acá y no suelto en la vista para que se vea qué significa.
 *
 * Existe porque el corte de arriba, aplicado parejo, le deja la bandeja VACÍA:
 * hoy Bodega tiene 4 traslados pendientes y ninguna otra solicitud, así que
 * entraría y no vería nada. Para el resto de las salas un traslado es trabajo
 * ajeno; para ésta es el trabajo.
 *
 * No se puede deducir de los permisos: `traslados.can_approve` lo tienen 12
 * cargos —incluidos los 21 dependientes de farmacia— así que usarlo como señal
 * le devolvería los traslados a todo el mundo y anularía el corte. Medido
 * contra prod el 2026-08-17.
 */
export const SALA_QUE_SURTE = 30;

/**
 * Con qué estado arranca la pantalla para esta persona.
 *
 * `TODAS` y no `SOLO` para la sala que surte: `SOLO` le escondería sus propios
 * descartes y cargas, que es la misma clase de fallo que este arranque viene a
 * evitar. Se esconde de menos, no de más.
 */
export function modoInicialDeTraslados(branchId) {
    return String(branchId) === String(SALA_QUE_SURTE) ? 'TODAS' : 'SIN';
}

/**
 * ¿Esta solicitud pasa el corte?
 *
 * `esAmbitoSucursal` en false devuelve siempre true a propósito: un traslado no
 * es una solicitud personal de nadie, así que en el ámbito de personas el corte
 * no existe y no debe recortar nada.
 *
 * Un modo desconocido se trata como `SIN` —el arranque— y no como «mostrar
 * todo»: si algún día alguien agrega un cuarto valor y olvida esta función, el
 * error es una bandeja de menos, que se nota, y no una de más.
 */
export function pasaCorteDeTraslados(tipo, modo, esAmbitoSucursal = true) {
    if (!esAmbitoSucursal) return true;
    if (modo === 'TODAS') return true;
    if (modo === 'SOLO')  return tipo === TIPO_TRASLADO;
    return tipo !== TIPO_TRASLADO;
}
