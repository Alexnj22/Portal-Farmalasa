// Torogoz, la caja: la liquidación del vendedor, su caja del día y el cierre
// del día de la empresa (borradores 0020, 0024 y 0031).
//
// Vivían dentro de `TabLiquidacion`, `CajaDelVendedor` y `TabCierreDia`. Se
// mudaron acá el 2026-10-07 para que la app nativa cuente igual que el portal:
// lo que no puede pasar es que el teléfono diga «cuadra» y el portal «faltan
// $5» sobre la misma liquidación. Quien decide sigue siendo la base; esto es lo
// que se muestra ANTES de cerrar.
import { leerMonto } from './distribucionComun';

const c = (n) => Math.round(Number(n || 0) * 100);

/** Las dos vistas de «Caja y liquidación». El cierre del día es de quien administra. */
export const VISTAS_CAJA = [
    { key: 'vendedor', label: 'Por vendedor' },
    { key: 'dia', label: 'Cierre del día' },
];

// ── La liquidación ─────────────────────────────────────────────────────────

/** Lo vendido y cobrado del día, sumado por forma de pago. */
export function formasDeLaLiquidacion(liq) {
    const m = new Map();
    for (const f of liq?.por_forma ?? []) {
        const x = m.get(f.forma) ?? { forma: f.forma, ventas: 0, cobros: 0 };
        x[f.origen] = (x[f.origen] ?? 0) + Number(f.monto);
        m.set(f.forma, x);
    }
    return [...m.values()];
}

/**
 * El efectivo contado contra el esperado: la diferencia (null si no se escribió
 * un monto) y si se puede cerrar —cuadra, o hay motivo escrito—.
 */
export function cuentaDelCierre(esperado, contadoTexto, nota) {
    const cont = leerMonto(contadoTexto);
    const dif = cont == null ? null : (c(cont) - c(esperado)) / 100;
    return { contado: cont, diferencia: dif, listo: cont != null && (dif === 0 || String(nota ?? '').trim() !== '') };
}

/** «Sin diferencia» / «Sobrante $x» / «Faltante $x». */
export function rotuloDiferencia(dif, formatMoney) {
    const n = Number(dif);
    if (!n) return 'Sin diferencia';
    return `${n > 0 ? 'Sobrante' : 'Faltante'} ${formatMoney(Math.abs(n))}`;
}

/** La mercadería del camión ese día (0031), sumada. */
export function resumenDelCamion(cargas) {
    const t = (cargas ?? []).reduce((a, g) => ({
        cargado: a.cargado + Number(g.cargado), vendido: a.vendido + Number(g.vendido), devuelto: a.devuelto + Number(g.devuelto),
        queda: a.queda + Number(g.queda), faltante: a.faltante + Number(g.faltante), costo: a.costo + Number(g.faltante_costo),
    }), { cargado: 0, vendido: 0, devuelto: 0, queda: 0, faltante: 0, costo: 0 });
    const abierta = (cargas ?? []).some(g => g.estado === 'abierta');
    return {
        ...t,
        abierta,
        notas: (cargas ?? []).map(g => (g.nota_remision ? `NR ${g.nota_remision.slice(-6)}` : 'sin Nota de Remisión')).join(' · '),
        notaDeCierre: (cargas ?? []).find(g => g.nota_cierre)?.nota_cierre ?? null,
        filas: [
            ['Cargado', t.cargado], ['Vendido', t.vendido], ['Volvió a bodega', t.devuelto],
            ...(abierta ? [['Sigue en el camión', t.queda]] : []),
        ],
    };
}

/** Los vendedores que se pueden elegir: los del día primero, después el resto. */
export function vendedoresParaElegir(delDia, todos) {
    return [...(delDia ?? []), ...(todos ?? []).filter(v => !(delDia ?? []).some(d => d.id === v.id))];
}

// ── La caja del vendedor ───────────────────────────────────────────────────

/** Abrir y recibir una entrega es de quien administra; el gasto lo anota el vendedor. */
export const TIPOS_MOVIMIENTO_CAJA = [
    { value: 'gasto', label: 'Gasto de ruta' },
    { value: 'entrega', label: 'Entrega parcial' },
    { value: 'ingreso', label: 'Otro ingreso' },
];
export const ROTULO_MOVIMIENTO_CAJA = { gasto: 'Gasto', entrega: 'Entrega parcial', ingreso: 'Ingreso' };

export const tiposDeMovimiento = (puedeAdministrar) => TIPOS_MOVIMIENTO_CAJA.filter(t => puedeAdministrar || t.value === 'gasto');

/** El ejemplo del concepto, según el tipo. */
export const ejemploDeConcepto = (tipo) => (tipo === 'gasto' ? 'Combustible, parqueo…' : tipo === 'entrega' ? 'Corte del mediodía' : 'Qué es');

/** ¿Se puede registrar el movimiento? Una entrega exige lo contado en mano. */
export function movimientoListo({ tipo, monto, concepto, contado }) {
    const nMonto = leerMonto(monto);
    const nContado = leerMonto(contado);
    return { monto: nMonto, contado: nContado, listo: nMonto > 0 && String(concepto ?? '').trim() !== '' && (tipo !== 'entrega' || nContado != null) };
}

/** Lo que se le dice a quien registró una entrega que no cuadró. */
export function avisoDeEntrega(r, contado, formatMoney) {
    if (r?.esperado == null || contado == null || c(contado) === c(r.esperado)) return null;
    return `Al contar tenía ${formatMoney(contado)} y debía tener ${formatMoney(Number(r.esperado))}.`;
}

/** El desglose de lo que tiene en mano (con «Otros ingresos» sólo si hubo). */
export function desgloseDeCaja(e) {
    return [
        ['Fondo de cambio', Number(e?.fondo ?? 0)],
        ['+ Ventas en efectivo', Number(e?.ventas ?? 0)],
        ['+ Cobros en efectivo', Number(e?.cobros ?? 0)],
        ...(Number(e?.ingresos) > 0 ? [['+ Otros ingresos', Number(e.ingresos)]] : []),
        ['− Gastos de ruta', Number(e?.gastos ?? 0)],
        ['− Entregas parciales', Number(e?.entregas ?? 0)],
    ];
}

// ── El cierre del día ──────────────────────────────────────────────────────

/** Recibido − depositado = lo que queda en caja fuerte. */
export function cuentaDelDia(d) {
    const recibido = Number(d?.efectivo_recibido ?? 0);
    const depositado = Number(d?.depositado ?? 0);
    return { recibido, depositado, queda: (c(recibido) - c(depositado)) / 100 };
}

/** Lo vendido por forma de pago, sumado. */
export function formasDelDia(d) {
    const m = new Map();
    for (const f of d?.por_forma ?? []) m.set(f.forma, (m.get(f.forma) ?? 0) + Number(f.monto));
    return [...m.entries()];
}

/** ¿Se puede cerrar el día? No con vendedores sin liquidar, y lo no depositado exige decir dónde quedó. */
export function cierreDelDiaListo(d, queda, nota) {
    if (!d || d.cierre) return { listo: false, motivo: null };
    if (d.pendientes > 0) {
        return { listo: false, motivo: `${d.pendientes === 1 ? 'Falta 1 vendedor por liquidar' : `Faltan ${d.pendientes} vendedores por liquidar`}: el día se cierra cuando todos entregaron.` };
    }
    if (queda !== 0 && !String(nota ?? '').trim()) return { listo: false, motivo: null };
    return { listo: true, motivo: null };
}

/** La pregunta del campo de nota del cierre. */
export const preguntaDelCierre = (queda, formatMoney) =>
    (queda > 0 ? `Quedan ${formatMoney(queda)} sin depositar: ¿dónde?` : 'Se depositó más de lo recibido: ¿por qué?');

/** Un depósito tiene monto, banco y número de boleta. */
export function depositoListo(dep) {
    const monto = leerMonto(dep?.monto);
    return { monto, listo: monto > 0 && !!String(dep?.banco ?? '').trim() && !!String(dep?.referencia ?? '').trim() };
}
