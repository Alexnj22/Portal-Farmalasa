import { supabase } from '../supabaseClient';

/**
 * El bono de PRODUCTO se paga en la sala — docs/planes-cerrados/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md.
 *
 * El dinero sale por la salida de caja de siempre (`anotarSalida`, en
 * `bolsas.js`). Lo que vive acá es el candado del bono: la lista de lo que la
 * sala debe pagar y la reserva, que pone el monto desde el servidor y entrega
 * la clave que ata la salida a ESE bono. Si la salida no cuadra —otro monto,
 * otra persona, sin jefatura— la base la rechaza antes de tocar la caja.
 */

/** Lo que la sala tiene por pagar, y si quien mira es la jefatura que paga. */
export async function fetchBonosProductoSala(branchId) {
    const { data, error } = await supabase.rpc('get_bonos_producto_sala', {
        p_branch_id: Number(branchId),
    });
    if (error) throw error;
    return data ?? { items: [], puedo_pagar: false };
}

/**
 * ¿El pago de este bono quedó «sin confirmar»? (H20). Lo dicen dos lados: la
 * reserva (`reservar_pago_bono` lanza `SIN_CONFIRMAR`) y la salida
 * (`operar-caja` contesta `sin_confirmar` cuando la caja no respondió). En los
 * dos casos repetir puede pagar dos veces: hay que mirar la caja y resolverlo
 * con `resolverPagoBonoSinConfirmar`.
 */
export function esPagoSinConfirmar(err) {
    if (!err) return false;
    if (err.sinConfirmar === true) return true;
    const texto = typeof err === 'string' ? err : `${err.message ?? ''} ${err.details ?? ''}`;
    return /\bSIN_CONFIRMAR:/.test(texto);
}

/** Reserva el pago: devuelve `{ clave, monto, concepto, tipo, employee_id }`. */
export async function reservarPagoBono(item) {
    const { data, error } = await supabase.rpc('reservar_pago_bono', { p_item: item });
    if (error) throw error;
    return data;
}

/**
 * Un pago que quedó «en la caja» sin respuesta (la caja no contestó) se
 * resuelve a mano, mirando la caja: `salio` true lo da por pagado; false anula
 * el movimiento del portal y deja el bono para pagarse de nuevo. Sin esto, la
 * reserva lo dejaba repetir con otra clave y podía salir dos veces.
 */
export async function resolverPagoBonoSinConfirmar(item, salio, nota) {
    const { data, error } = await supabase.rpc('resolver_pago_bono_sin_confirmar', {
        p_item: item, p_salio: !!salio, p_nota: nota,
    });
    if (error) throw error;
    return data;
}

/** Por promoción terminada: lo pagado por sala, bodega y lo de administración. */
export async function fetchPagosBonoProducto() {
    const { data, error } = await supabase.rpc('get_pagos_bono_producto');
    if (error) throw error;
    return data ?? [];
}
