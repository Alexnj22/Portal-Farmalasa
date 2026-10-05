/**
 * El estado de asistencia de una persona AHORA — trabajando, en almuerzo, sin
 * marcar, finalizado…—, si llegó tarde y cuánto, y su horario de hoy. Era
 * `evaluateEmployeeStatus` de `AttendanceMonitorView`; se mudó el 2026-10-05
 * para que el monitor de la app diga exactamente lo mismo.
 *
 * Las 4 columnas del tablero cubren, entre todas, los 9 estados posibles —
 * ningún empleado queda sin columna.
 */
import { getTodayScheduleConfig } from './helpers';
import { toLocalISODate } from './timeClock.helpers';
import { hora12 } from './hora';

export const COLUMNAS_DE_ASISTENCIA = [
    { id: 'working',  label: 'Trabajando',         estados: ['WORKING', 'EXTRA_WORKING'] },
    { id: 'pause',    label: 'En pausa',           estados: ['LUNCH', 'LACTATION', 'BUSINESS_OUT'] },
    { id: 'pending',  label: 'Sin marcar',         estados: ['PENDING'] },
    { id: 'finished', label: 'Finalizado / libre', estados: ['FINISHED', 'EARLY_EXIT', 'OFF_DAY'] },
];

export const ROTULO_ESTADO_ASISTENCIA = {
    WORKING: 'Trabajando', EXTRA_WORKING: 'Horas extra', LUNCH: 'Almuerzo', LACTATION: 'Lactancia',
    BUSINESS_OUT: 'Salida de trabajo', EARLY_EXIT: 'Salió temprano', FINISHED: 'Terminó', OFF_DAY: 'Libre hoy', PENDING: 'Sin marcar',
};

const buildDateFromTime = (timeStr, baseDate) => {
    if (!timeStr) return null;
    const d = new Date(baseDate);
    const [h, m] = String(timeStr).split(":").map(Number);
    d.setHours(h, m, 0, 0);
    return d;
  };

export function estadoDeAsistencia(emp, shifts, currentTime, todayStr = toLocalISODate(currentTime)) {
    const punches = (emp.attendance || []).filter((a) =>
      a.timestamp && toLocalISODate(new Date(a.timestamp)) === todayStr
    );

    const config = getTodayScheduleConfig(emp, shifts);

    let status = config?.isOffDay ? "OFF_DAY" : "PENDING";
    let isLate = false;
    let lateText = "";
    let lastActionTime = null;

    const checkLateness = (punchDateObj, expectedDateObj) => {
      if (!expectedDateObj || !punchDateObj) return false;
      const diffMins = Math.floor((punchDateObj - expectedDateObj) / 60000);
      if (diffMins > 5) {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        lateText = h > 0 ? `${h}h ${m}m tarde` : `${m} min tarde`;
        return true;
      }
      return false;
    };

    const shiftStartD = config?.shift ? buildDateFromTime(config.shift.start, currentTime) : null;

    const lunchStartD = config?.lunchTime ? buildDateFromTime(config.lunchTime, currentTime) : null;
    const lunchEndD = lunchStartD ? new Date(lunchStartD.getTime() + 60 * 60000) : null;

    const lactStartD = config?.lactationTime ? buildDateFromTime(config.lactationTime, currentTime) : null;
    const lactEndD = lactStartD ? new Date(lactStartD.getTime() + 60 * 60000) : null;

    const lastPunch = punches.length > 0 ? punches[punches.length - 1] : null;

    if (lastPunch) {
      lastActionTime = hora12(lastPunch.timestamp);

      const lastType = lastPunch.type;

      if (["IN", "IN_LUNCH", "IN_LACTATION", "IN_RETURN"].includes(lastType)) {
        status = "WORKING";

        if (lastType === "IN" || lastType === "IN_RETURN") {
          let expectedIn = shiftStartD;

          // lactancia pegada al IN: inicio real después de lactancia
          const isGluedToIn =
            lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime();

          if (isGluedToIn) expectedIn = lactEndD;

          if (lastType === "IN") isLate = checkLateness(new Date(lastPunch.timestamp), expectedIn);
        }

        if (lastType === "IN_LUNCH") {
          const punchOutLunch = [...punches].reverse().find((p) => p.type === "OUT_LUNCH");
          if (punchOutLunch) {
            const isGluedToLunch =
              lactStartD && lunchEndD && lactStartD.getTime() === lunchEndD.getTime();
            const minsAllowed = isGluedToLunch ? 120 : 60;
            const expectedReturn = new Date(new Date(punchOutLunch.timestamp).getTime() + minsAllowed * 60000);
            isLate = checkLateness(new Date(lastPunch.timestamp), expectedReturn);
          }
        }

        if (lastType === "IN_LACTATION") {
          const punchOutLact = [...punches].reverse().find((p) => p.type === "OUT_LACTATION");
          if (punchOutLact) {
            const expectedReturn = new Date(new Date(punchOutLact.timestamp).getTime() + 60 * 60000);
            isLate = checkLateness(new Date(lastPunch.timestamp), expectedReturn);
          }
        }
      } else if (lastType === "OUT_LUNCH") status = "LUNCH";
      else if (lastType === "OUT_LACTATION") status = "LACTATION";
      else if (lastType === "OUT" || lastType === "OUT_EXTRA") status = "FINISHED";
      else if (lastType === "OUT_EARLY") status = "EARLY_EXIT";
      else if (lastType === "OUT_BUSINESS") status = "BUSINESS_OUT";
      else if (lastType === "IN_EXTRA") status = "EXTRA_WORKING";
    }

    return {
      status,
      isLate,
      lateText,
      punches,
      lastActionTime,
      shiftName: config?.shift?.name || "Libre",
      role: emp?.role || "",
      scheduleDetails: {
        start: config?.shift?.start,
        end: config?.shift?.end,
        lunch: config?.lunchTime,
        lactation: config?.lactationTime,
      },
    };
}

const ORDEN = { PENDING: 1, WORKING: 2, LUNCH: 3, LACTATION: 3, EXTRA_WORKING: 4, EARLY_EXIT: 5, BUSINESS_OUT: 5, FINISHED: 6, OFF_DAY: 7 };

/**
 * El orden del tablero: primero quien llegó tarde (y sigue en turno), después
 * quien no ha marcado, quien trabaja… y al final quien está libre; a igual
 * estado, por nombre. Recibe filas `{ emp, status, isLate }`.
 */
export function compararAsistencia(a, b) {
    const clave = (f) => (f.isLate && f.status !== 'FINISHED' ? -1 : ORDEN[f.status] ?? 99);
    return clave(a) - clave(b) || String(a.emp?.name).localeCompare(String(b.emp?.name));
}
