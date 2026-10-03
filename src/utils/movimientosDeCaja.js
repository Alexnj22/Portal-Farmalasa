/**
 * La lista de movimientos de caja de un período, armada y filtrada: los
 * movimientos del sistema de la caja, los cobros de crédito que no casaron con
 * ninguno y las salidas de bolsa sin vale, en UNA lista ordenada; y el filtro
 * por tipo, estado (vigente, editado, ya no está) y búsqueda. Vivía dentro de
 * `components/cortes/MovimientosDeCaja.jsx`; se mudó el 2026-10-02 para que la
 * app del teléfono muestre la misma lista.
 */
import { tokenMatch } from './searchUtils';
import { emparejarCobrosConMovimientos } from './cortesDiagnostico';
import { cobroEnEfectivo } from '../data/creditos';
import { diaSV } from './fecha';

const diaDe = (iso) => (iso ? diaSV(iso) : null);
const desempatar = (a, b) => {
    const na = Number(a), nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
    return String(b ?? '').localeCompare(String(a ?? ''));
};

/** La historia de cada movimiento (`cortes_caja_movimientos_historial`), por `sala:id`. */
export function historiaPorMovimiento(historial = []) {
    const m = new Map();
    for (const h of historial) {
        const clave = `${h.branch_id}:${h.erp_movimiento_id}`;
        if (!m.has(clave)) m.set(clave, []);
        m.get(clave).push(h);
    }
    return m;
}
export const historiaDe = (porMov, mov) => porMov.get(`${mov.branch_id}:${mov.erp_movimiento_id}`) || [];
export const fueEditado = (porMov, mov) => historiaDe(porMov, mov).some((h) => h.cambio === 'EDITADO');

/** Qué parte de cada salida de bolsa corresponde a cada vale de la caja, por `sala:vale`. */
export function desglosePorVale(salidasDeBolsa = []) {
    const m = new Map();
    for (const op of salidasDeBolsa) {
        for (const [erp, monto] of op.porVale || []) {
            const clave = `${op.branch_id}:${erp}`;
            if (!m.has(clave)) m.set(clave, []);
            m.get(clave).push({ op, monto });
        }
    }
    for (const lista of m.values()) lista.sort((a, b) => b.monto - a.monto);
    return m;
}

/**
 * Lo que el portal anotó en la caja (`caja_movimientos_portal`), por
 * `sala:número de la caja`. Es lo que la captura no sabe de un renglón: el
 * concepto entero, la boleta, quién y a qué hora exacta.
 */
export function anotadosPorMovimiento(anotados = []) {
    const m = new Map();
    for (const a of anotados) {
        if (a.erp_movimiento_id == null) continue;
        m.set(`${a.branch_id}:${a.erp_movimiento_id}`, a);
    }
    return m;
}

/**
 * La lista unida, la más reciente primero. Cada renglón es `{ kind: 'mov'|'cobro'|'bolsa', clave, … }`.
 * Un cobro en efectivo que casó con su movimiento va DENTRO de ese renglón
 * (`cobro`); sólo los que no casaron salen sueltos.
 */
export function renglonesDeMovimientos({ movimientos = [], cobros = [], salidasDeBolsa = [], anotados = [] }) {
    const { porMovimiento, sueltos } = emparejarCobrosConMovimientos(movimientos, cobros, cobroEnEfectivo);
    const porVale = desglosePorVale(salidasDeBolsa);
    const delPortal = anotadosPorMovimiento(anotados);
    return [
        ...movimientos.map((mv) => ({
            kind: 'mov', clave: `m${mv.id}`, mv, cobro: porMovimiento.get(mv.id) || null,
            desglose: porVale.get(`${mv.branch_id}:${mv.erp_movimiento_id}`) || null,
            anotado: delPortal.get(`${mv.branch_id}:${mv.erp_movimiento_id}`) || null,
            fecha: mv.fecha, branchId: mv.branch_id, orden: mv.created_at, desempate: mv.erp_movimiento_id,
        })),
        ...sueltos.map((cb) => ({
            kind: 'cobro', clave: `c${cb.id}`, cb,
            fecha: diaDe(cb.created_at), branchId: cb.branch_id, orden: cb.created_at, desempate: cb.id,
        })),
        ...salidasDeBolsa.filter((op) => op.montoSinVale > 0.005).map((op) => ({
            kind: 'bolsa', clave: `b${op.id}`, op,
            fecha: diaDe(op.registrado_at), branchId: op.branch_id, orden: op.registrado_at, desempate: op.id,
        })),
    ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
        || String(b.orden || '').localeCompare(String(a.orden || ''))
        || desempatar(a.desempate, b.desempate));
}

/**
 * El filtro. `tipo`: TODOS | ENTRADA | SALIDA. `estado`: TODOS | VIGENTES |
 * EDITADOS | DESAPARECIDOS — un cobro o una salida de bolsa no se editan ni
 * desaparecen en la caja, así que esos dos estados los dejan fuera.
 */
export function filtrarMovimientos(renglones, {
    tipo = 'TODOS', estado = 'TODOS', busqueda = '', salas, cobraron, sacaron, anotaron,
    etiquetaDeSalida = (c) => c, porMov = new Map(),
} = {}) {
    return renglones.filter((it) => {
        if (it.kind === 'cobro') {
            const c = it.cb;
            if (tipo === 'SALIDA') return false;
            if (estado === 'VIGENTES' && c.anulado_at) return false;
            if (estado === 'EDITADOS' || estado === 'DESAPARECIDOS') return false;
            return tokenMatch(busqueda, c.cliente, `crédito ${c.credito_erp}`, c.forma,
                c.documento, cobraron?.get(c.abonado_por)?.name,
                salas?.get(c.branch_id), String(c.monto), 'ENTRADA');
        }
        if (it.kind === 'bolsa') {
            const op = it.op;
            if (tipo === 'ENTRADA') return false;
            if (estado === 'VIGENTES' && op.anulada_at) return false;
            if (estado === 'EDITADOS' || estado === 'DESAPARECIDOS') return false;
            return tokenMatch(busqueda, op.folio, etiquetaDeSalida(op.tipo), op.entidad,
                op.numero_boleta, sacaron?.get(op.registrado_por)?.name,
                salas?.get(op.branch_id), String(op.monto), 'SALIDA');
        }
        const m = it.mv;
        if (tipo !== 'TODOS' && m.tipo !== tipo) return false;
        if (estado === 'VIGENTES' && m.desaparecido_at) return false;
        if (estado === 'DESAPARECIDOS' && !m.desaparecido_at) return false;
        if (estado === 'EDITADOS' && !fueEditado(porMov, m)) return false;
        return tokenMatch(busqueda, m.concepto, salas?.get(m.branch_id), String(m.monto), m.tipo,
            it.anotado?.detalle, it.anotado?.numero_boleta,
            it.anotado && anotaron?.get(it.anotado.registrado_por)?.name,
            it.cobro?.cliente, it.cobro && `crédito ${it.cobro.credito_erp}`,
            it.cobro && cobraron?.get(it.cobro.abonado_por)?.name,
            ...(it.desglose || []).flatMap((d) => [d.op.folio, d.op.entidad, etiquetaDeSalida(d.op.tipo)]));
    });
}
