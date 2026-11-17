// Producto con vencimiento corto (usuario, 2026-11-17): al cargar una compra o
// recibir un pedido, lo que vence en 6 meses o menos se alerta en pantalla y se
// avisa a quien se queda con él (Bodega en la compra, la sucursal en el pedido).
//
// El corte es por MES, como se escribe el vencimiento (`YYYY-MM`): entra si el
// mes de vencimiento es a lo sumo el mes de hoy + 6, hora de El Salvador. Hoy
// noviembre 2026 → entra hasta mayo 2027. Lo vencido también entra.
//
// Gemelo de `public.notificar_vence_corto` (migración
// `20261117214042_vence_corto_aviso_al_cargar`): la base vuelve a filtrar con
// el mismo corte. Cambiar uno exige cambiar el otro.
import { hoySV } from './fecha';

export const MESES_VENCE_CORTO = 6;

/** Meses desde el mes de hoy hasta el del vencimiento (negativo = ya pasó). */
export function mesesParaVencer(vence, hoy = hoySV()) {
    const m = /^(\d{4})-(\d{2})/.exec(String(vence ?? ''));
    if (!m) return null;
    const mes = Number(m[2]);
    if (mes < 1 || mes > 12) return null;
    const [ay, am] = hoy.split('-').map(Number);
    return (Number(m[1]) - ay) * 12 + (mes - am);
}

/** ¿Vence en 6 meses o menos? Sin fecha válida, no. */
export function venceCorto(vence, hoy = hoySV()) {
    const n = mesesParaVencer(vence, hoy);
    return n != null && n <= MESES_VENCE_CORTO;
}

/** «05/2027», para el texto de la alerta. */
export function venceTexto(vence) {
    const m = /^(\d{4})-(\d{2})/.exec(String(vence ?? ''));
    return m ? `${m[2]}/${m[1]}` : '';
}
