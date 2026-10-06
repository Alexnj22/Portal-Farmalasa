// Las transacciones promedio por hora y por día de una sala — la gráfica de
// Horarios («Tx promedio · últimos 3 meses») y la base de los «huecos
// críticos» de la cobertura. Vivía dentro de `SchedulesView`; se mudó al núcleo
// el 2026-10-06 para que la app dibuje la misma gráfica con la misma cuenta.
//
// `filas` son las de `fetchBranchHourlySales` ({ sale_date, sale_hour,
// transaction_count }); `sucursal` trae su horario (`weekly_hours`), que recorta
// las horas a las de apertura. Cada barra lleva `color` (la variable del
// portal, `--txvol-*`) y `nivel` (el mismo dato como palabra, para la app).
import { aMinutos as timeToMins } from './turnoDelDia';
import { hora12 } from './hora';

const DAY_NAMES = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };
const formatHourAMPM = (hour) => hora12(`${((hour % 24) + 24) % 24}:00`);

export function nivelDeTransacciones(txPorHora) {
    if (txPorHora > 18) return 'critica';
    if (txPorHora > 12) return 'pico';
    if (txPorHora > 4) return 'normal';
    return 'muerta';
}

export function estadisticasDeVentaPorHora(rawSalesData, currentBranch) {
    let openH = 7; let closeH = 18;

    if (currentBranch) {
        let sch = currentBranch.weekly_hours || currentBranch.settings?.schedule;
        if (typeof sch === 'string') { try { sch = JSON.parse(sch); } catch { sch = null; } }
        if (sch && typeof sch === 'object') {
            let minOpen = 1440; let maxClose = 0;
            Object.values(sch).forEach(d => {
                if (d && d.isOpen !== false && !d.isClosed && !d.isOff) {
                    const cleanStart = String(d.start || d.open || '').replace(/[^0-9:]/g, '').trim();
                    const cleanEnd   = String(d.end   || d.close || '').replace(/[^0-9:]/g, '').trim();
                    if (cleanStart && cleanEnd) {
                        const oMins = timeToMins(cleanStart);
                        let cMins   = timeToMins(cleanEnd);
                        if (cMins < oMins) cMins += 1440;
                        if (oMins < minOpen)  minOpen  = oMins;
                        if (cMins > maxClose) maxClose = cMins;
                    }
                }
            });
            if (minOpen  < 1440) openH  = Math.floor(minOpen / 60);
            if (maxClose > 0)    closeH = Math.ceil(maxClose / 60) - 1;
        }
    }

    if (closeH <= openH) closeH = openH + 11;

    const daysMap          = { 1:0,2:0,3:0,4:0,5:0,6:0,0:0 };
    const hourlyMap        = {};
    const specificHourlyMap = { 1:{},2:{},3:{},4:{},5:{},6:{},0:{} };
    const uniqueDatesByDay  = { 1:new Set(),2:new Set(),3:new Set(),4:new Set(),5:new Set(),6:new Set(),0:new Set() };
    const uniqueDates       = new Set();

    const validData = (rawSalesData || []).filter(row => {
        const hour = Number(row.sale_hour);
        return hour >= openH && hour <= closeH;
    });

    validData.forEach(row => {
        const h    = Number(row.sale_hour);
        const dStr = row.sale_date;
        const dNum = new Date(dStr + 'T00:00:00').getDay();
        const count= Number(row.transaction_count || 0);
        daysMap[dNum] += count;
        if (!hourlyMap[h]) hourlyMap[h] = 0;
        hourlyMap[h] += count;
        if (!specificHourlyMap[dNum][h]) specificHourlyMap[dNum][h] = 0;
        specificHourlyMap[dNum][h] += count;
        uniqueDates.add(dStr);
        uniqueDatesByDay[dNum].add(dStr);
    });

    const finalDays = [1,2,3,4,5,6,0].map(d => {
        const dc  = uniqueDatesByDay[d].size || 1;
        const hrs = [];
        for (let h = openH; h <= closeH; h++) hrs.push(Math.round((specificHourlyMap[d][h] || 0) / dc));
        hrs.sort((a,b) => a-b);
        const p75 = hrs[Math.floor(hrs.length * 0.75)] || 0;
        return { day: d, avg: p75, label: DAY_NAMES[d] };
    });

    const totalDays = uniqueDates.size || 1;
    const finalGeneralHours = [];
    for (let h = openH; h <= closeH; h++) {
        finalGeneralHours.push({ hour: h, avg: Math.round((hourlyMap[h] || 0) / totalDays), label: formatHourAMPM(h) });
    }

    const finalSpecificHours = {};
    [1,2,3,4,5,6,0].forEach(d => {
        finalSpecificHours[d] = [];
        const dCount = uniqueDatesByDay[d].size || 1;
        for (let h = openH; h <= closeH; h++) {
            finalSpecificHours[d].push({ hour: h, avg: Math.round((specificHourlyMap[d][h] || 0) / dCount), label: formatHourAMPM(h) });
        }
    });

    const applyColors = (arr) => {
        const max = Math.max(...arr.map(o => o.avg), 1);
        return arr.map(item => {
            const nivel = nivelDeTransacciones(item.avg);
            const hi = item.avg / max;
            return { ...item, nivel, color: `var(--txvol-${nivel})`, height: hi > 0 ? `${Math.max(hi * 100, 15)}%` : '0%' };
        });
    };

    return {
        days: applyColors(finalDays),
        generalHours: applyColors(finalGeneralHours),
        specificHours: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].map((d) => [d, applyColors(finalSpecificHours[d])])),
    };
}
