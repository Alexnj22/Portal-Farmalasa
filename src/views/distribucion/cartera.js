// Reglas puras de la cartera (sin React), gemelas de la base (borrador 0014).
// Sirven para MOSTRAR antes de cobrar; quien decide es `dist_cobrar`.

const c = (n) => Math.round(Number(n || 0) * 100);

/**
 * Reparte un cobro como lo hace la base cuando no se reparte a mano: primero
 * lo que vence antes (y a igual vencimiento, el más viejo). Devuelve
 * [{ cxc_id, monto, saldo, queda }]; `sobra` si el monto pasa de lo que debe.
 */
export function repartirCobro(cuentas, monto) {
    let falta = c(monto);
    const orden = [...(cuentas ?? [])].filter(x => x.estado === 'abierta' && c(x.saldo) > 0)
        .sort((a, b) => String(a.vence).localeCompare(String(b.vence)) || a.id - b.id);
    const reparto = [];
    for (const x of orden) {
        if (falta <= 0) break;
        const toma = Math.min(falta, c(x.saldo));
        reparto.push({ cxc_id: x.id, monto: toma / 100, saldo: c(x.saldo) / 100, queda: (c(x.saldo) - toma) / 100 });
        falta -= toma;
    }
    return { reparto, sobra: falta > 0 ? falta / 100 : 0 };
}

/** Los tramos de antigüedad, con los mismos cortes que `dist_cartera`. */
export const TRAMOS = [
    { key: 'al_dia', label: 'Al día', desde: -Infinity, hasta: 0 },
    { key: '1_30', label: '1–30 días', desde: 1, hasta: 30 },
    { key: '31_60', label: '31–60', desde: 31, hasta: 60 },
    { key: '61_90', label: '61–90', desde: 61, hasta: 90 },
    { key: 'mas_90', label: 'Más de 90', desde: 91, hasta: Infinity },
];
export const tramoDe = (dias) => TRAMOS.find(t => Number(dias) >= t.desde && Number(dias) <= t.hasta)?.key ?? 'al_dia';

/** Las pestañas de la cartera (van en `?cartera=`). */
export const VISTAS_CARTERA = [
    { key: 'saldo', label: 'Con saldo' },
    { key: 'vencidos', label: 'Atrasados' },
    { key: 'limite', label: 'Sobre el límite' },
];
