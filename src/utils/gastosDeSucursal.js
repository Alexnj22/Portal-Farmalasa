/**
 * Los gastos de una sucursal: el estado de cada servicio (arrendamiento, luz,
 * agua, internet, celular, impuestos), el total operativo del mes, la tendencia
 * de los últimos seis meses y su variación. Vivía dentro de
 * `views/branch-tabs/TabExpenses.jsx`; se mudó para que la ficha de la app diga
 * lo mismo que el portal.
 */

/**
 * El estado de un servicio. `paidThrough` es 'AAAA-MM' (el último mes pagado).
 *   paid            — pagado este mes o adelantado
 *   pending         — se debe el mes pasado y todavía no llega su día de pago
 *   expired         — vencido
 *   pending_receipt — pagado, falta subir el recibo
 *   unknown         — sin configurar
 */
import { fechaTexto } from './fecha';

export function estadoDeServicio(dueDay, paidThrough, isReceiptPending, hoy = new Date()) {
    if (!dueDay || !paidThrough) return { state: 'unknown', label: 'Sin configurar', variant: 'neutral' };
    if (isReceiptPending) return { state: 'pending_receipt', label: 'Recibo pendiente', variant: 'chart-6' };
    const currentYear = hoy.getFullYear();
    const currentMonth = hoy.getMonth() + 1;
    const currentDay = hoy.getDate();
    const [ptYearStr, ptMonthStr] = String(paidThrough).split('-');
    const ptYear = parseInt(ptYearStr, 10);
    const ptMonth = parseInt(ptMonthStr, 10);
    if (ptYear > currentYear || (ptYear === currentYear && ptMonth >= currentMonth)) {
        return { state: 'paid', label: 'Al día', variant: 'success' };
    }
    if (ptYear === currentYear && ptMonth === currentMonth - 1) {
        return currentDay > dueDay
            ? { state: 'expired', label: 'Vencido', variant: 'danger' }
            : { state: 'pending', label: 'Vence pronto', variant: 'warning' };
    }
    return { state: 'expired', label: 'Vencido', variant: 'danger' };
}

const esAlquilada = (b) => b?.settings?.propertyType === 'RENTED' || b?.propertyType === 'RENTED' || b?.propertyType === 'ALQUILADO';

/** Los servicios que se le muestran a esta sucursal, cada uno con su estado. */
export function serviciosDeSucursal(b, hoy = new Date()) {
    const tipo = b?.type || 'FARMACIA';
    const conServicios = tipo === 'FARMACIA';
    const rent = b?.settings?.rent || {};
    const s = b?.settings?.services || {};
    const fila = (clave, titulo, d, provider) => ({
        clave, titulo, provider: provider ?? d?.provider ?? null, amount: d?.amount ?? null,
        dueDay: d?.dueDay ?? null, paidThrough: d?.paidThrough ?? null, isReceiptPending: !!d?.isReceiptPending,
        estado: estadoDeServicio(d?.dueDay, d?.paidThrough, d?.isReceiptPending, hoy),
    });
    return [
        ...(esAlquilada(b) ? [fila('rent', 'Arrendamiento', rent, rent.landlordName)] : []),
        ...(conServicios ? [fila('light', 'Energía eléctrica', s.light), fila('water', 'Agua potable', s.water), fila('internet', 'Internet fijo', s.internet)] : []),
        fila('phone', 'Plan celular', s.phone),
        fila('taxes', 'Impuestos / Alcaldía', s.taxes),
    ];
}

/** Lo que se paga al mes (aprox.), con lo configurado en la ficha. */
export function totalOperativo(b) {
    const conServicios = (b?.type || 'FARMACIA') === 'FARMACIA';
    const rent = b?.settings?.rent || {};
    const s = b?.settings?.services || {};
    let total = 0;
    if (esAlquilada(b) && rent.amount) total += Number(rent.amount) || 0;
    if (conServicios) for (const k of ['light', 'water', 'internet']) total += Number(s[k]?.amount) || 0;
    for (const k of ['phone', 'taxes']) total += Number(s[k]?.amount) || 0;
    return total;
}

/** Lo pagado agrupado por mes (`billing_month` 'AAAA-MM'), los últimos seis. */
export function gastosPorMes(filas) {
    const porMes = (filas || []).reduce((acc, curr) => {
        const k = curr.billing_month;
        if (!k) return acc;
        if (!acc[k]) {
            const label = fechaTexto(`${k}-01`, { month: 'short', year: '2-digit' }).replace('.', '').toUpperCase();
            acc[k] = { name: label, total: 0, rawMonth: k };
        }
        acc[k].total += Number(curr.amount) || 0;
        return acc;
    }, {});
    return Object.values(porMes).sort((a, b) => a.rawMonth.localeCompare(b.rawMonth)).slice(-6);
}

/** Cuánto cambió el último mes contra el anterior, y el servicio más caro. */
export function variacionDeGastos(historial, b) {
    const rent = b?.settings?.rent || {};
    const s = b?.settings?.services || {};
    let mayor = 'Arrendamiento';
    let maxVal = rent.amount ? Number(rent.amount) : 0;
    for (const [k, n] of [['light', 'Energía eléctrica'], ['water', 'Agua potable'], ['internet', 'Internet fijo'], ['phone', 'Plan celular'], ['taxes', 'Impuestos']]) {
        const v = s[k]?.amount ? Number(s[k].amount) : 0;
        if (v > maxVal) { maxVal = v; mayor = n; }
    }
    if (!historial || historial.length < 2) return { variation: 0, isUp: false, highestService: 'Sin datos suficientes' };
    const actual = historial[historial.length - 1].total;
    const previo = historial[historial.length - 2].total;
    const variation = previo > 0 ? ((actual - previo) / previo) * 100 : 0;
    return { variation, isUp: variation > 0, highestService: maxVal > 0 ? mayor : 'Sin pagos' };
}
