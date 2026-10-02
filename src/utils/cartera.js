/**
 * Lo que decide la vista de Cuentas por cobrar sin tocar la base: qué créditos
 * se ven, cuánto lleva pagado cada uno, cómo se nombra su edad, si la lista está
 * al día, y la historia de abonos de un crédito unida desde las dos fuentes.
 * Vivía dentro de `views/CuentasPorCobrarView.jsx`; se mudó el 2026-10-02 para
 * que la app del teléfono cuente y nombre la cartera con la MISMA regla.
 */
import { severidadDeDias } from '../data/creditos';
import { tokenMatch } from './searchUtils';

/** Lo que se puede ver: con saldo (el arranque), pasados del plazo, o todos. */
export const VER_CARTERA = [
    { value: 'DEBEN', label: 'Con saldo' },
    { value: 'VENCIDOS', label: 'Pasados del plazo' },
    { value: 'TODOS', label: 'Todos' },
];

/** El nombre de la edad de un crédito, en cuatro escalones. */
export function tituloDeDias(dias, saldo) {
    const s = severidadDeDias(dias, saldo);
    if (s.grave) return 'Más de dos meses sin pagar';
    if (s.variant === 'danger') return 'Pasado del plazo';
    if (s.porVencer) return 'Vence esta semana';
    return 'Dentro del plazo';
}

/** Cuánto lleva pagado, en %, entre 0 y 100. */
export function pagadoPct(c) {
    const total = Number(c?.total) || 0;
    if (total <= 0) return 0;
    const pagado = total - (Number(c?.saldo) || 0);
    return Math.max(0, Math.min(100, Math.round((pagado / total) * 100)));
}

/** Si la lista está al día. Una lista congelada se ve igual de bien que una fresca. */
export function desdeLaLectura(iso, ahora = Date.now()) {
    const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
    if (min < 2) return 'Al día';
    if (min < 60) return `Leído hace ${min} min`;
    return `Leído hace ${Math.round(min / 60)} h`;
}

/**
 * Los créditos que se ven, el más viejo primero. Recibe los créditos YA con su
 * edad (`edadDelCredito`). Con saldo exige saldo; pasados del plazo exige
 * además `vencido`. La búsqueda mira cliente, documento, sala y saldo.
 */
export function carteraFiltrada(conEdad, { ver = 'DEBEN', busqueda = '', nombreDeSala = new Map() } = {}) {
    return (conEdad || []).filter((c) => {
        if (ver === 'DEBEN' && c.saldo <= 0.004) return false;
        if (ver === 'VENCIDOS' && (c.saldo <= 0.004 || !c.vencido)) return false;
        return tokenMatch(busqueda, c.cliente, c.documento, nombreDeSala.get(c.branch_id), String(c.saldo));
    }).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));
}

/**
 * La historia de abonos de un crédito. La caja es la fuente de verdad (ahí
 * están TODOS, también los que se cobraron allá); el portal sabe quién cobró.
 * Se casan por monto y día, uno a uno. Si el historial de la caja no se pudo
 * leer (`delOrigen` nulo), quedan sólo los del portal.
 */
export function abonosDelCredito(delOrigen, delPortal = []) {
    if (!delOrigen) return delPortal.map((a) => ({ ...a, origen: 'portal' }));
    const libres = [...delPortal];
    return delOrigen.map((o) => {
        const i = libres.findIndex((p) => Math.abs(Number(p.monto) - Number(o.monto)) < 0.005
            && String(p.created_at).slice(0, 10) === o.fecha);
        const par = i >= 0 ? libres.splice(i, 1)[0] : null;
        return {
            id: o.erp_id || `${o.fecha}-${o.monto}`,
            erp_id_borrable: o.erp_id,
            monto: o.monto, forma: o.forma, documento: o.documento,
            fecha: o.fecha, hora: o.hora,
            abonado_por: par?.abonado_por ?? null,
            cobrado_por: par?.cobrado_por ?? null,
            saldo_despues: par?.saldo_despues ?? null,
            origen: par ? 'portal' : 'caja',
        };
    });
}
