// Cortes de caja — la diferencia por tramo y las pistas de revisión.
//
// Vive fuera de la vista a propósito: es la parte que decide si a alguien se le
// señala un faltante, y tiene que poder mirarse (y corregirse) sin abrir un
// componente de 400 líneas.

import { formatMoney } from './formatNumber';

const CENTAVO = 0.005;
const redondear = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null ? null : Number(v));

/**
 * Los cortes de caja son ACUMULATIVOS dentro del día: el de la noche contiene
 * al de la mañana. Entonces la diferencia que importa —la que señala un turno—
 * no es la del corte, es cuánto se movió DESDE el corte anterior.
 *
 * Regla del usuario (2026-08-14): «si en el primer corte confirmado hay
 * diferencia de +$0.25, en el de la noche como mínimo debe haber +$0.25; si no
 * pasa eso, entonces faltan $0.25 en el corte de la noche».
 *
 * Los DESCARTADOS no cuentan ni como base ni como tramo: un conteo mal hecho no
 * puede desplazar la referencia de los que vienen después. Ejemplo real del
 * 13-ago en Salud 1: 19:52 declaró $834.28 con −$621.17 y 19:53 declaró
 * $1,456.00 con +$0.55 — descartado el primero, el tramo de las 19:53 se mide
 * contra el corte de las 13:22, que es lo correcto.
 *
 * @param {Array} cortesDeLaSala ordenados por hora ascendente
 */
export function conTramo(cortesDeLaSala) {
    let previa = 0;
    return cortesDeLaSala.map((c) => {
        if (c.tipo !== 'C' || c.estado === 'DESCARTADO') return { ...c, tramo: null };
        const dif = num(c.diferencia_erp) ?? 0;
        const tramo = redondear(dif - previa);
        previa = dif;
        return { ...c, tramo };
    });
}

/** El estado de la sala en el día: la diferencia del último corte vivo. */
export function estadoDelDia(cortesDeLaSala) {
    const vivos = cortesDeLaSala.filter((c) => c.tipo === 'C' && c.estado !== 'DESCARTADO');
    const ultimo = vivos[vivos.length - 1];
    return {
        acumulado: ultimo ? (num(ultimo.diferencia_erp) ?? 0) : 0,
        cortes: vivos.length,
        pendientes: vivos.filter((c) => c.estado === 'PENDIENTE').length,
        cierre: cortesDeLaSala.find((c) => c.tipo === 'Z') || null,
    };
}

/** 'ok' | 'sobra' | 'falta' — la forma, no sólo el color. */
export function severidad(monto) {
    const n = num(monto) ?? 0;
    if (Math.abs(n) < 0.01) return 'ok';
    return n < 0 ? 'falta' : 'sobra';
}

/**
 * Qué revisar cuando un tramo no cuadra.
 *
 * La primera pista es la más útil y la más barata: cuando la diferencia es un
 * múltiplo exacto de un movimiento que YA existe en el día, casi siempre es que
 * falta registrar otro igual. Salió sola de los datos del 13-ago en La Popular
 * —diferencia $13.80, con dos «POR ABONO A CREDITO» de $4.60 anotados: 3 × 4.60—
 * y es una hipótesis para confirmar en la sala, no un veredicto.
 *
 * @param {object} corte      corte ya pasado por `conTramo`
 * @param {Array}  movimientos movimientos de caja de ESA sala en ese día
 */
export function sugerenciasDeCorte(corte, movimientos = []) {
    const tramo = corte?.tramo;
    if (tramo == null || Math.abs(tramo) < 0.01) return [];

    const objetivo = Math.abs(tramo);
    const falta = tramo < 0;
    const out = [];

    // ── 1. ¿La diferencia es N veces un movimiento conocido? ────────────────
    const porMonto = new Map();
    for (const m of movimientos) {
        const v = Math.abs(num(m.monto) ?? 0);
        // Debajo de $1 el múltiplo deja de ser señal: con centavos cualquier
        // cifra "calza" con algo y la pista se vuelve ruido.
        if (v < 1) continue;
        const clave = v.toFixed(2);
        const y = porMonto.get(clave);
        if (y) { y.veces += 1; } else { porMonto.set(clave, { monto: v, veces: 1, concepto: m.concepto }); }
    }

    const multiplos = [];
    for (const { monto, veces, concepto } of porMonto.values()) {
        const n = objetivo / monto;
        const entero = Math.round(n);
        if (entero < 1 || entero > 6) continue;
        if (Math.abs(n - entero) > CENTAVO) continue;
        multiplos.push({ monto, veces, concepto, entero });
    }
    // 1× primero (coincidencia exacta con un movimiento) y, a igual cantidad de
    // veces, el monto más grande: es el que menos se repite por casualidad.
    multiplos.sort((a, b) => a.entero - b.entero || b.monto - a.monto);

    for (const m of multiplos.slice(0, 2)) {
        out.push({
            tono: 'danger',
            titulo: m.entero === 1
                ? `Hay un movimiento de exactamente ${formatMoney(m.monto)}`
                : `${formatMoney(objetivo)} es exactamente ${m.entero} × ${formatMoney(m.monto)}`,
            detalle: m.entero === 1
                ? `«${m.concepto || 'sin concepto'}». Si se registró de más o de menos, cuadra la diferencia al centavo.`
                : `Hoy hay ${m.veces === 1 ? 'un movimiento' : `${m.veces} movimientos`} de ${formatMoney(m.monto)} («${m.concepto || 'sin concepto'}»). Si entró otro y no se registró, cuadra al centavo. Es una hipótesis para confirmar en la sala.`,
        });
    }

    // ── 2. La tarjeta, que es el número que se teclea ───────────────────────
    const tarjeta = num(corte.tk_tarjeta);
    if (tarjeta != null && tarjeta > 0) {
        out.push({
            tono: 'warning',
            titulo: `¿Cuadran los vouchers de tarjeta?`,
            detalle: `El sistema registra ${formatMoney(tarjeta)}. Ese monto lo escribe quien corta, y si va de más la diferencia se esconde sola.`,
        });
    }

    // ── 3. Vales: la salida de dinero que deja papel ────────────────────────
    const salidas = movimientos.filter((m) => m.tipo === 'SALIDA');
    if (salidas.length) {
        const total = salidas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            tono: 'warning',
            titulo: salidas.length === 1
                ? `Un vale por ${formatMoney(total)}`
                : `${salidas.length} vales por ${formatMoney(total)}`,
            detalle: 'Un vale sin su comprobante en la caja se ve igual que un faltante.',
        });
    }

    // ── 4. Cobros de crédito: entra efectivo sin documento de venta ─────────
    const cobros = num(corte.tk_cobros_credito);
    if (cobros != null && cobros > 0) {
        out.push({
            tono: 'info',
            titulo: `Cobros de crédito por ${formatMoney(cobros)}`,
            detalle: 'Es dinero que entra sin venta detrás. Si no llegó a la caja, aparece como faltante.',
        });
    }

    // ── 5. Ingresos varios (recibos que se cobran en el mostrador) ──────────
    const entradas = movimientos.filter((m) => m.tipo === 'ENTRADA');
    if (falta && entradas.length >= 5) {
        const total = entradas.reduce((a, m) => a + (num(m.monto) ?? 0), 0);
        out.push({
            tono: 'info',
            titulo: `${entradas.length} ingresos de caja por ${formatMoney(total)}`,
            detalle: 'Un recibo cobrado y no registrado se ve igual que un faltante.',
        });
    }

    // ── 6. Devoluciones y retención, cuando existen ─────────────────────────
    const devol = num(corte.tk_devoluciones);
    if (devol != null && devol > 0) {
        out.push({
            tono: 'info',
            titulo: `Devoluciones por ${formatMoney(devol)}`,
            detalle: 'Verifica que el dinero devuelto salió de esta caja y quedó documentado.',
        });
    }

    return out;
}
