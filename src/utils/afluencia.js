/**
 * La afluencia de una sala: cuántos tickets (y cuánta venta) tiene en un día
 * de la semana o en una hora, promediados sobre un período. Es el cálculo del
 * «Monitor de ventas» del portal (`FormWfmAnalytics.jsx`) y de la app
 * (`app/monitor-ventas.js`), y sobre él se arma el widget del tablero
 * (`promediosDeVentas` de `utils/inicio`).
 *
 * Estaba escrito dos veces —en el monitor y en el tablero— con dos lecturas
 * distintas del horario de la sala: el monitor descartaba los días cerrados y
 * aceptaba `open`/`close`, el tablero no. Se juntó el 2026-10-01, con la app.
 *
 * Las filas son las de `branch_hourly_sales` (`fetchBranchHourlySalesRange`):
 * `{ sale_date, sale_hour, transaction_count, total_sales }`.
 */

export const DIAS_DE_LA_SEMANA = [1, 2, 3, 4, 5, 6, 0];

const minutos = (s) => {
    const limpio = String(s || '').replace(/[^0-9:]/g, '').trim();
    if (!limpio) return null;
    const [h, m] = limpio.split(':');
    return Number(h) * 60 + Number(m || 0);
};

/**
 * La primera y la última hora abierta de la semana, desde `weekly_hours` (o
 * `settings.schedule`). Un día cerrado no cuenta. Sin horario: 7 a 18.
 */
export function horarioDeSala(sucursal) {
    let openH = 7, closeH = 18;
    let sch = sucursal?.weekly_hours || sucursal?.settings?.schedule;
    if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch { sch = null; } }
    if (sch && typeof sch === 'object') {
        let minO = 1440, maxC = 0;
        Object.values(sch).forEach((d) => {
            if (!d || d.isOpen === false || d.isClosed || d.isOff) return;
            const o = minutos(d.start ?? d.open);
            let c = minutos(d.end ?? d.close);
            if (o == null || c == null) return;
            if (c < o) c += 1440;
            if (o < minO) minO = o;
            if (c > maxC) maxC = c;
        });
        if (minO < 1440) openH = Math.floor(minO / 60);
        if (maxC > 0) closeH = Math.ceil(maxC / 60) - 1;
    }
    if (closeH <= openH) closeH = openH + 11;
    return { openH, closeH };
}

const diaDe = (fecha) => new Date(`${fecha}T00:00:00`).getDay();

/**
 * @param filas      las de `branch_hourly_sales`
 * @param sucursal   la fila de `branches` (para el horario)
 * @param vista      'dias' · 'horas' (toda la semana) · 0..6 (las horas de ese día)
 * @param hoy        true: las filas son de UN día y se muestran tal cual, sin promediar
 *
 * Devuelve `{ openH, closeH, items, fechas }`. Cada ítem trae:
 *   · `dia` o `hora` — la clave de la barra;
 *   · `tickets`      — en 'dias', el PERCENTIL 75 de las horas de ese día (no
 *                      lo mueve una sola hora atípica, y se lee en la misma
 *                      escala que la vista por hora); en horas, el promedio;
 *   · `ticketsDelDia` (sólo 'dias') — tickets promedio de un día entero;
 *   · `ventas`       — venta promedio (del día entero en 'dias', de la hora en horas);
 *   · `fechas`       — las fechas que entraron en esa barra.
 * El color sale de `nivelDeVolumen(tickets)` (utils/inicio).
 */
export function afluencia(filas = [], sucursal = null, { vista = 'dias', hoy = false } = {}) {
    const { openH, closeH } = horarioDeSala(sucursal);
    const validas = (filas || []).filter((r) => {
        const h = Number(r.sale_hour);
        return h >= openH && h <= closeH;
    });
    const todas = new Set(validas.map((r) => r.sale_date));

    if (vista === 'dias') {
        const porHora = {}, fechas = {}, ventas = {}, tickets = {};
        DIAS_DE_LA_SEMANA.forEach((d) => { porHora[d] = {}; fechas[d] = new Set(); ventas[d] = 0; tickets[d] = 0; });
        for (const r of validas) {
            const d = diaDe(r.sale_date);
            const h = Number(r.sale_hour);
            const t = Number(r.transaction_count || 0);
            porHora[d][h] = (porHora[d][h] || 0) + t;
            tickets[d] += t;
            ventas[d] += Number(r.total_sales || 0);
            fechas[d].add(r.sale_date);
        }
        const items = DIAS_DE_LA_SEMANA.map((d) => {
            const n = fechas[d].size || 1;
            const hrs = [];
            for (let h = openH; h <= closeH; h++) hrs.push(Math.round((porHora[d][h] || 0) / n));
            hrs.sort((a, b) => a - b);
            return {
                dia: d,
                tickets: hrs[Math.floor(hrs.length * 0.75)] || 0,
                ticketsDelDia: tickets[d] / n,
                ventas: ventas[d] / n,
                fechas: [...fechas[d]].sort(),
            };
        });
        return { openH, closeH, items, fechas: todas.size };
    }

    const delDia = vista === 'horas' ? validas : validas.filter((r) => diaDe(r.sale_date) === Number(vista));
    const n = hoy ? 1 : (new Set(delDia.map((r) => r.sale_date)).size || 1);
    const mapa = {};
    for (let h = openH; h <= closeH; h++) mapa[h] = { hora: h, t: 0, v: 0, f: new Set() };
    for (const r of delDia) {
        const m = mapa[Number(r.sale_hour)];
        if (!m) continue;
        m.t += Number(r.transaction_count || 0);
        m.v += Number(r.total_sales || 0);
        m.f.add(r.sale_date);
    }
    const items = Object.values(mapa).sort((a, b) => a.hora - b.hora).map((m) => ({
        hora: m.hora,
        tickets: hoy ? m.t : Math.round(m.t / n),
        ventas: m.v / n,
        fechas: [...m.f].sort(),
    }));
    return { openH, closeH, items, fechas: todas.size };
}
