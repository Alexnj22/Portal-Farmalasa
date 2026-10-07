// Reglas puras de la cartera de la distribuidora (sin React), gemelas de la
// base (borrador 0014). Sirven para MOSTRAR antes de cobrar; quien decide es
// `dist_cobrar`. Se mudaron de `views/distribucion/cartera.js` el
// 2026-10-07 para que la app nativa reparta y avise igual que el portal.
import { formatMoney } from './formatNumber';

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

/**
 * Lo que impide cobrar, dicho ANTES de apretar (mismo orden que la ficha de
 * cobro del portal). `null` = se puede. La base vuelve a validar todo: esto es
 * para que la pantalla no ofrezca lo que `dist_cobrar` va a rechazar.
 *
 * @param {{ puedeCobrar: boolean, montoFinal: number, saldo: number, aMano: boolean,
 *           reparto: {monto:number, saldo:number}[], forma: string, referencia: string,
 *           cambio: number|null }} p
 */
export function problemaDelCobro({ puedeCobrar, montoFinal, saldo, aMano, reparto, forma, referencia, cambio }) {
    if (!puedeCobrar) return 'No tienes permiso para cobrar.';
    if (!(montoFinal > 0)) return null;
    if (c(montoFinal) > c(saldo)) return `El cliente debe ${formatMoney(saldo)}: no se puede cobrar más.`;
    if (aMano && (reparto ?? []).some(r => c(r.monto) > c(r.saldo))) return 'A una cuenta se le abona más de lo que debe.';
    if (['04', '05'].includes(forma) && !String(referencia ?? '').trim()) return 'Un cheque o una transferencia llevan su número.';
    if (cambio != null && cambio < 0) return 'Lo entregado no alcanza.';
    return null;
}

/**
 * El reparto que se va a mandar: el automático de la base (primero lo que
 * vence antes) o lo escrito a mano por cuenta. `leer` convierte el texto de un
 * campo en monto (el `leerMonto` de la pantalla).
 */
export function repartoDelCobro(abiertas, { aMano, monto, manual, leer }) {
    if (!aMano) return repartirCobro(abiertas, monto).reparto;
    return (abiertas ?? []).map(x => {
        const m = leer(manual?.[x.id]) ?? 0;
        return { cxc_id: x.id, monto: m, saldo: Number(x.saldo), queda: Number(x.saldo) - m };
    }).filter(r => r.monto > 0);
}

/** El cambio de un cobro en efectivo (null si no es efectivo o no se escribió lo entregado). */
export const cambioDelCobro = (forma, recibido, monto) =>
    (forma === '01' && recibido != null ? (c(recibido) - c(monto)) / 100 : null);

/** La cartera filtrada como la ve la pestaña: con saldo, atrasados o sobre el límite, y el tramo. */
export function clientesDeLaCartera(clientes, { vista = 'saldo', tramo = '', coincide = null } = {}) {
    return (clientes ?? []).filter(x =>
        (vista !== 'vencidos' || Number(x.vencido) > 0)
        && (vista !== 'limite' || Number(x.saldo) > Number(x.limite_credito))
        && (!tramo || tramoDe(x.dias_atraso) === tramo)
        && (!coincide || coincide(x)));
}

/** Cuánto del límite de crédito usa (0–1) y si se pasó. */
export function usoDelLimite(cliente) {
    const saldo = Number(cliente?.saldo ?? 0);
    const limite = Number(cliente?.limite_credito) || 0;
    return { saldo, limite, uso: limite > 0 ? Math.min(1, saldo / limite) : 1, sobre: saldo > limite };
}
