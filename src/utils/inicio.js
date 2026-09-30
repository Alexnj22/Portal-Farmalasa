// Los números del Inicio, sin pantalla: los usa el tablero del portal
// (`DashboardView`) y el Inicio nativo de la app (2026-09-30). Estaban
// escritos adentro de la vista de 4,000 líneas; la app los habría tenido que
// copiar, y dos «presentes hoy» con dos reglas es la clase de número que no
// cuadra sin que nadie sepa por qué.

import { ordenDeSala } from '../constants/erp';

// Las salas siempre en el orden del negocio (La Popular, Salud 1…), nunca por
// venta: así cada una está donde uno la busca todos los días.
const enOrdenDeSala = (a, b) => ordenDeSala(a.branchId) - ordenDeSala(b.branchId) || Number(a.branchId) - Number(b.branchId);

const diaDe = (a) => a?.date || a?.timestamp?.split('T')[0];
const salaDe = (e) => String(e?.branchId ?? e?.branch_id ?? '');

/** Quienes siguen en planilla (ni inactivos ni liquidados). */
export const empleadosActivos = (empleados = []) =>
    empleados.filter((e) => e.status !== 'INACTIVO' && e.status !== 'LIQUIDADO');

/** Cuántas personas marcaron `fecha` (AAAA-MM-DD). `sala` acota a una sucursal. */
export function presentesEl(empleados = [], fecha, sala = '') {
    const ids = new Set();
    for (const e of empleados) {
        if (sala && salaDe(e) !== String(sala)) continue;
        for (const a of e.attendance || []) if (diaDe(a) === fecha) { ids.add(e.id); break; }
    }
    return ids.size;
}

/** El problema de una sucursal que merece alerta, o null. */
export function problemaDeSucursal(b) {
    if (!b?.address) return 'Sin dirección registrada';
    if (!b.phone && !b.cell) return 'Sin teléfono de contacto';
    if (b.propertyType === 'RENTED' && b.rent?.contract?.endDate) {
        const d = Math.ceil((new Date(b.rent.contract.endDate) - new Date()) / 86400000);
        if (d <= 60) return `Contrato vence en ${d} días`;
    }
    return null;
}

/**
 * Las ventas de un día por sala: total, transacciones y la curva por hora
 * (7 a. m. a 9 p. m.), a partir de las filas de `branch_hourly_sales`.
 * @returns {Array<{ branchId: string, total: number, tickets: number, porHora: number[], ticketsPorHora: number[] }>}
 */
export function ventasPorSala(filas = [], { desde = 7, hasta = 21 } = {}) {
    const por = new Map();
    for (const f of filas) {
        const k = String(f.branch_id);
        if (!por.has(k)) por.set(k, { branchId: k, total: 0, tickets: 0, porHora: Array(hasta - desde + 1).fill(0), ticketsPorHora: Array(hasta - desde + 1).fill(0) });
        const s = por.get(k);
        const monto = Number(f.total_sales) || 0;
        s.total += monto;
        s.tickets += Number(f.transaction_count) || 0;
        const h = Number(f.sale_hour);
        if (h >= desde && h <= hasta) {
            s.porHora[h - desde] += monto;
            s.ticketsPorHora[h - desde] += Number(f.transaction_count) || 0;
        }
    }
    return [...por.values()].sort(enOrdenDeSala);
}

/**
 * Todas las salas que venden, aunque hoy todavía no hayan vendido nada.
 *
 * `ventasPorSala` sólo conoce las salas con filas HOY, así que a media mañana
 * una sala que no ha abierto simplemente no existía — y el Inicio mostraba
 * cinco de siete sin decir que faltaban dos. La lista de salas sale de las que
 * vendieron en los últimos días (`fetchSalesBranchIdsSince`, la misma regla
 * del tablero del portal) y las que no tienen venta hoy entran en cero.
 */
export function conTodasLasSalas(ventas = [], idsDeVenta = [], { desde = 7, hasta = 21 } = {}) {
    const n = hasta - desde + 1;
    const por = new Map(ventas.map((v) => [v.branchId, v]));
    for (const id of idsDeVenta) {
        const k = String(id);
        if (!por.has(k)) por.set(k, { branchId: k, total: 0, tickets: 0, porHora: Array(n).fill(0), ticketsPorHora: Array(n).fill(0) });
    }
    return [...por.values()].sort(enOrdenDeSala);
}

/**
 * Qué tan cargada estuvo una hora, por tickets — la escala del tablero del
 * portal (10 min por ticket → 6 por hora por persona): hasta 4 es una hora
 * MUERTA (sobra gente), más de 12 es PICO y más de 18 CRÍTICA (hacen falta
 * tres). El color de cada nivel es `--txvol-<nivel>`.
 */
export function nivelDeVolumen(tickets) {
    const t = Number(tickets) || 0;
    if (t > 18) return 'critica';
    if (t > 12) return 'pico';
    if (t > 4) return 'normal';
    return 'muerta';
}

/** «Buenos días / tardes / noches» según la hora. */
export function saludoDeLaHora(fecha = new Date()) {
    const h = fecha.getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
}

const meta = (m) => (typeof m === 'string' ? (() => { try { return JSON.parse(m); } catch { return {}; } })() : (m || {}));

/** Las ausencias aprobadas (vacaciones, incapacidad, permiso) vigentes `fecha`. */
export function ausenciasDelDia(filas = [], fecha) {
    return filas.filter((r) => {
        const m = meta(r.metadata);
        const dias = m.permissionDates || [];
        const inicio = m.startDate || dias[0];
        const fin = m.endDate || dias[dias.length - 1];
        return inicio && inicio <= fecha && (!fin || fin >= fecha);
    });
}

/** Quienes cumplen años `fecha` (AAAA-MM-DD). */
export function cumplenEl(empleados = [], fecha) {
    if (!fecha) return [];
    const md = fecha.slice(5);
    return empleadosActivos(empleados).filter((e) => e.birthDate && String(e.birthDate).slice(5, 10) === md);
}

/** La suma de varias salas (para «Todas»), con la misma forma que una. */
export function sumarSalas(salas = []) {
    const base = { branchId: 'todas', total: 0, tickets: 0, porHora: [], ticketsPorHora: [] };
    for (const s of salas) {
        base.total += s.total; base.tickets += s.tickets;
        s.porHora.forEach((v, i) => { base.porHora[i] = (base.porHora[i] || 0) + v; });
        s.ticketsPorHora.forEach((v, i) => { base.ticketsPorHora[i] = (base.ticketsPorHora[i] || 0) + v; });
    }
    return base;
}

/** Lo vendido hasta la hora `h` (incluida), para comparar «a esta hora». */
export const hastaLaHora = (s, h, desde = 7) => (s?.porHora || []).slice(0, Math.max(0, h - desde + 1)).reduce((a, b) => a + b, 0);


/**
 * El horario de apertura de una sala (primera y última hora abierta de la
 * semana), desde su `weekly_hours`. Sin horario: 7 a 18.
 */
export function horarioDeSala(sucursal) {
    let openH = 7, closeH = 18;
    let sch = sucursal?.weekly_hours || sucursal?.settings?.schedule;
    if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch { sch = null; } }
    if (sch && typeof sch === 'object') {
        const minutos = (s) => (s ? s.split(':').reduce((a, b, i) => a + (i === 0 ? +b * 60 : +b), 0) : 0);
        let minO = 1440, maxC = 0;
        Object.values(sch).forEach((d) => {
            if (!d || d.isOpen === false) return;
            const o = minutos(d.start);
            let c = minutos(d.end);
            if (c < o) c += 1440;
            if (o && o < minO) minO = o;
            if (c && c > maxC) maxC = c;
        });
        if (minO < 1440) openH = Math.floor(minO / 60);
        if (maxC > 0) closeH = Math.ceil(maxC / 60) - 1;
    }
    if (closeH <= openH) closeH = openH + 11;
    return { openH, closeH };
}

const DIAS_DE_LA_SEMANA = [1, 2, 3, 4, 5, 6, 0];

/**
 * Los promedios de tickets del widget «Ventas por día/hora» del tablero, a
 * partir de las filas de `fetchBranchHourlySalesRange` (90 días):
 *
 *   · `dias`    — por día de la semana: `avg` es el PERCENTIL 75 de sus horas
 *                 (resiste a una hora atípica) y `dailyAvg` el promedio simple.
 *   · `horas`   — por hora, sobre todos los días.
 *   · `porDia`  — las horas de cada día de la semana.
 *
 * Estaba escrito dentro de `DashboardView.jsx`; se mudó el 2026-09-30 con la
 * app. El color se decide afuera con `nivelDeVolumen(avg)`.
 */
export function promediosDeVentas(filas = [], sucursal = null) {
    const { openH, closeH } = horarioDeSala(sucursal);
    const dM = {}, hM = {}, shM = {}, udD = {};
    DIAS_DE_LA_SEMANA.forEach((d) => { dM[d] = 0; shM[d] = {}; udD[d] = new Set(); });
    const ud = new Set();
    for (const r of filas) {
        const h = Number(r.sale_hour);
        if (h < openH || h > closeH) continue;
        const d = new Date(`${r.sale_date}T00:00:00`).getDay();
        const c = Number(r.transaction_count || 0);
        dM[d] += c; hM[h] = (hM[h] || 0) + c; shM[d][h] = (shM[d][h] || 0) + c;
        ud.add(r.sale_date); udD[d].add(r.sale_date);
    }
    const tot = ud.size || 1;
    const dias = DIAS_DE_LA_SEMANA.map((d) => {
        const dc = udD[d].size || 1;
        const hrs = [];
        for (let h = openH; h <= closeH; h++) hrs.push(Math.round((shM[d][h] || 0) / dc));
        hrs.sort((a, b) => a - b);
        return { day: d, avg: hrs[Math.floor(hrs.length * 0.75)] || 0, dailyAvg: Math.round((dM[d] || 0) / dc / (closeH - openH + 1)) };
    });
    const horas = [];
    for (let h = openH; h <= closeH; h++) horas.push({ hour: h, avg: Math.round((hM[h] || 0) / tot) });
    const porDia = Object.fromEntries(DIAS_DE_LA_SEMANA.map((d) => {
        const dc = udD[d].size || 1;
        const arr = [];
        for (let h = openH; h <= closeH; h++) arr.push({ hour: h, avg: Math.round((shM[d][h] || 0) / dc) });
        return [d, arr];
    }));
    return { openH, closeH, dias, horas, porDia, diasConDatos: ud.size };
}

