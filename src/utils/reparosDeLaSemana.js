// Los reparos de una semana de horarios antes de publicarla — lo que el portal
// pregunta en «¿Publicar de todas formas?»: quién queda sin ningún descanso,
// quién pasa de 44 horas, quién tiene la semana incompleta y quién entra a
// menos de 8 horas de haber salido (Art. 21). Vivía en `SchedulesView`
// (`triggerPublishAudit`); se mudó al núcleo el 2026-10-06 para que «Publicar»
// en la app avise exactamente lo mismo.
import { calculateEmployeeWeeklyHoursLocal } from './scheduleHelpers';
import { claveDeDia, descansoInsuficiente, resolverTurnoDelDia, HORAS_SEMANA_DIURNA, DESCANSOS_POR_SEMANA } from './turnoDelDia';
import { shortEmployeeName } from './nameUtils';

const parse = (raw) => ((typeof raw === 'string') ? JSON.parse(raw || '{}') : (raw || {}));

/**
 * @returns {{ reparos: string[], porPublicar: number }} — `reparos` en el orden
 *   y con la redacción del portal; `porPublicar`, cuántos horarios faltan.
 */
export function reparosDeLaSemana({ personas = [], rosters = {}, turnos = [], fechas = [], publicados = new Set() }) {
    let incompletos = 0, excedidos = 0, sinDescanso = 0;
    const seguidos = [];
    personas.forEach((emp) => {
        const sch = parse(rosters[emp.id]);
        const horas = calculateEmployeeWeeklyHoursLocal(sch, turnos, emp.history, fechas);
        const dias = fechas.map((fecha) => ({ fecha, resuelto: resolverTurnoDelDia(sch[claveDeDia(new Date(`${fecha}T00:00:00`))], turnos) }));
        const descansos = dias.filter((d) => !d.resuelto.trabaja).length;
        if (descansos === 0) sinDescanso++;
        else if (horas > HORAS_SEMANA_DIURNA) excedidos++;
        else if (horas < HORAS_SEMANA_DIURNA || descansos > DESCANSOS_POR_SEMANA) incompletos++;
        if (descansoInsuficiente(dias).length > 0) seguidos.push(shortEmployeeName(emp));
    });
    const reparos = [];
    if (sinDescanso > 0) reparos.push(`${sinDescanso} sin ningún día de descanso.`);
    if (excedidos > 0) reparos.push(`${excedidos} con más de ${HORAS_SEMANA_DIURNA} horas.`);
    if (incompletos > 0) reparos.push(`${incompletos} con la semana incompleta.`);
    if (seguidos.length > 0) {
        reparos.push(seguidos.length === 1
            ? `${seguidos[0]} entra a menos de 8 horas de haber salido.`
            : `${seguidos.length} personas entran a menos de 8 horas de haber salido.`);
    }
    const porPublicar = personas.filter((e) => !publicados.has(String(e.id))).length;
    return { reparos, porPublicar };
}
