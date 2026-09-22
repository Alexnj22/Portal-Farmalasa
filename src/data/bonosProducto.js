import { supabase } from '../supabaseClient';

/**
 * El bono de PRODUCTO se paga en la sala — docs/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md.
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

/** Reserva el pago: devuelve `{ clave, monto, concepto, tipo, employee_id }`. */
export async function reservarPagoBono(item) {
    const { data, error } = await supabase.rpc('reservar_pago_bono', { p_item: item });
    if (error) throw error;
    return data;
}

/** Por promoción terminada: lo pagado por sala, bodega y lo de administración. */
export async function fetchPagosBonoProducto() {
    const { data, error } = await supabase.rpc('get_pagos_bono_producto');
    if (error) throw error;
    return data ?? [];
}
