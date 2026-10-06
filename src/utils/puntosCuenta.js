// La cuenta de puntos de un cliente y el tablero del programa: las cuentas que
// el portal hacía dentro de `ClientePuntosModal` y `GraficasPuntos`, en el
// núcleo para que la app dibuje los mismos números (2026-10-06).

/* En qué se fue lo acumulado. Se cuenta desde los movimientos y no desde
 * `usados`, que suma canjes y vencimientos en un solo número. */
export function repartoDeCuenta(movimientos) {
    let canjeado = 0; let vencido = 0; let anulado = 0;
    for (const m of movimientos || []) {
        const p = Math.abs(Number(m.puntos) || 0);
        if (m.tipo === 'canje') canjeado += p;
        else if (m.tipo === 'vencimiento') vencido += p;
        else if (m.tipo === 'anulacion') anulado += p;
    }
    return { canjeado, vencido, anulado };
}

/* Las partes de la barra del reparto, sobre lo ganado: disponible, canjeado,
 * vencido y anulado, cada una con su porcentaje. Vacío si no ganó nada. */
export function partesDelReparto({ ganados, saldo, canjeado, vencido, anulado }) {
    const g = Number(ganados) || 0;
    if (g <= 0) return [];
    return [
        { clave: 'saldo',    rotulo: 'Disponibles', valor: Number(saldo) || 0 },
        { clave: 'canjeado', rotulo: 'Canjeados',   valor: canjeado },
        { clave: 'vencido',  rotulo: 'Vencidos',    valor: vencido },
        { clave: 'anulado',  rotulo: 'Anulados',    valor: anulado },
    ].filter((p) => p.valor > 0).map((p) => ({ ...p, pct: Math.round((p.valor / g) * 100) }));
}

/* La historia por mes, con el saldo al cierre de cada uno. El saldo se
 * reconstruye HACIA ATRÁS desde el de hoy: es el único dato firme, y así el
 * último mes cierra exactamente en lo que dice la cuenta. Devuelve los últimos
 * `n` meses con movimiento, del más viejo al más nuevo. */
export function mesesDeCuenta(movimientos, saldoHoy, n = 18) {
    const porMes = new Map();
    for (const m of movimientos || []) {
        const clave = String(m.fecha).slice(0, 7);
        const fila = porMes.get(clave) ?? { mes: clave, acumulado: 0, canjeado: 0, neto: 0 };
        const p = Number(m.puntos) || 0;
        // Un canje devuelto no es algo ganado: resta de lo canjeado del mes.
        if (m.tipo === 'canje_devuelto') fila.canjeado -= p;
        else if (p > 0) fila.acumulado += p;
        if (m.tipo === 'canje') fila.canjeado += -p;
        fila.neto += p;
        porMes.set(clave, fila);
    }
    const lista = [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
    let saldo = Number(saldoHoy) || 0;
    for (const f of lista) { f.saldo = saldo; saldo -= f.neto; }
    return lista.slice(0, n).reverse();
}

export const FILTROS_DE_MOVIMIENTO = [
    { value: 'todos',  label: 'Todos' },
    { value: 'entran', label: 'Acumulados' },
    { value: 'salen',  label: 'Canjes' },
];

/* El filtro por tipo y por mes (tocar una barra de la gráfica del cliente). */
export function movimientoPasaFiltro(m, filtro = 'todos', mes = null) {
    const p = Number(m.puntos) || 0;
    if (filtro === 'entran' && p <= 0) return false;
    if (filtro === 'salen' && m.tipo !== 'canje') return false;
    if (mes && String(m.fecha).slice(0, 7) !== mes) return false;
    return true;
}

/* Los meses de vencimiento desde el mes de hoy hasta el último que tenga
 * algo, CON los meses vacíos en el medio (un mes sin barra también es un dato:
 * ese mes no vence nada). Tope de 24. */
export function serieDeVencimientos(lista, hoy) {
    const porMes = new Map((lista ?? []).map((v) => [String(v.mes).slice(0, 7), v]));
    const inicio = String(hoy ?? new Date().toISOString()).slice(0, 7);
    const ultimo = [...porMes.keys()].sort().pop() ?? inicio;
    const datos = [];
    let [a, m] = inicio.split('-').map(Number);
    for (let i = 0; i < 24; i += 1) {
        const clave = `${a}-${String(m).padStart(2, '0')}`;
        const v = porMes.get(clave);
        datos.push({ clave, puntos: Number(v?.puntos) || 0, clientes: Number(v?.clientes) || 0 });
        if (clave >= ultimo) break;
        m += 1; if (m > 12) { m = 1; a += 1; }
    }
    return datos;
}

/* «+12% vs. sep» — el cambio contra el mes anterior, o null sin base. */
export function cambioContraAnterior(actual, anterior, rotuloAnterior) {
    const x = Number(actual) || 0; const y = Number(anterior) || 0;
    if (!y) return null;
    const pct = Math.round(((x - y) / y) * 100);
    return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}% vs. ${rotuloAnterior}`;
}
