// Registrar el pago de un servicio de la sala (arrendamiento, luz, agua…),
// escrito UNA vez para el portal (`FormRegisterPayment` + `UnifiedModal`) y la
// app: qué mes toca, si ese mes ya estaba pagado, el registro que se guarda
// (con su fecha de vencimiento del día de pago configurado) y la entrada de la
// bitácora. Guardarlo lo hace `registerBranchExpense` del store, igual en los
// dos lados.
import { formatMoney } from './formatNumber';

export const SERVICIOS_DE_PAGO = {
    rent: 'Arrendamiento',
    light: 'Energía eléctrica',
    water: 'Agua potable',
    internet: 'Internet fijo',
    phone: 'Plan celular',
    taxes: 'Impuestos / Alcaldía',
};

/** «2026-09» → «2026-10»; sin mes, el actual. */
export function mesSiguiente(yyyymm, hoy = new Date()) {
    if (!yyyymm) return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = yyyymm.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** La configuración del servicio en los ajustes de la sala. */
export const datosDelServicio = (settings, servicio) => (servicio === 'rent'
    ? (settings?.rent || {})
    : ((settings?.services || {})[servicio] || {}));

/** El mes con el que arranca el formulario: el siguiente al último pagado, o ese mismo si se sube el comprobante pendiente. */
export const mesInicialDelPago = (settings, servicio, subiendoComprobante = false) => {
    const pagadoHasta = datosDelServicio(settings, servicio).paidThrough;
    return subiendoComprobante ? pagadoHasta : mesSiguiente(pagadoHasta);
};

/** ¿Ese mes ya estaba pagado? (sólo importa cuando no se está subiendo un comprobante pendiente) */
export function yaEstabaPagado(pagadoHasta, mes) {
    if (!pagadoHasta || !mes) return false;
    const [cy, cm] = pagadoHasta.split('-').map(Number);
    const [sy, sm] = mes.split('-').map(Number);
    return sy < cy || (sy === cy && sm <= cm);
}

/** Por qué no se puede registrar, o null. */
export const problemaDelPago = (pago) => (!pago?.amount || !(Number(pago.amount) > 0) || !pago?.billing_month
    ? 'El monto exacto y el mes que cubre son obligatorios.'
    : null);

/** Lo que recibe `registerBranchExpense`. */
export function registroDelPago(settings, servicio, pago) {
    const dia = datosDelServicio(settings, servicio).dueDay || 1;
    return {
        expense_type: servicio,
        billing_month: pago.billing_month,
        amount: Number(pago.amount),
        due_date: `${pago.billing_month}-${String(dia).padStart(2, '0')}`,
        receiptFile: pago.receiptFile || null,
        notes: pago.notes || null,
    };
}

/** La entrada de la bitácora del pago. */
export function auditoriaDelPago(settings, servicio, pago) {
    const pagadoHasta = datosDelServicio(settings, servicio).paidThrough;
    return {
        timeline_title: `Pago de ${SERVICIOS_DE_PAGO[servicio] || 'Servicio'}`,
        dimension: 'FINANZAS',
        old_value: pagadoHasta || 'Sin pagos previos',
        new_value: `Mes: ${pago.billing_month} | Monto: ${formatMoney(Number(pago.amount) || 0)} | ${pago.receiptFile ? 'Comprobante adjunto' : '⚠️ COMPROBANTE PENDIENTE'}`,
        notas: pago.notes || '',
    };
}
