import {
  buildDateFromTime,
  checkLateness,
  findLastPunchOfTypes,
  getNextWorkDayText,
  getTodayPunches,
} from './timeClock.helpers';
import { getTodayScheduleConfig } from '../utils/helpers';

const OPEN_PUNCH_TYPES = ['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN'];

// ============================================================
// ✅ BUILD CUSTOM CONFIG (Compat para el Engine)
// ============================================================
// Orquesta: lee la configuración del día (turno/almuerzo/lactancia) y construye
// el objeto `customConfig` con fechas calculadas y el último evento (lastPunch).
export const buildCustomConfig = ({
  employee,
  now = new Date(),
  shifts = [],
  todayPunches = [], // 🚨 Agregamos todayPunches a los parámetros esperados
  scheduleResolver = getTodayScheduleConfig
}) => {
  const config = scheduleResolver(employee, shifts, now);
  
  // Extraemos de forma segura el último registro del día
  const validPunches = Array.isArray(todayPunches) ? todayPunches : [];
  const lastPunch = validPunches.length > 0 ? validPunches[validPunches.length - 1] : null;

  return buildTimeClockConfig(employee, config, now, lastPunch);
};

export const buildTimeClockConfig = (employee, config, now = new Date(), lastPunch = null) => {
  const shiftStartD = config?.shift?.start ? buildDateFromTime(config.shift.start, now) : null;
  const shiftEndDBase = config?.shift?.end ? buildDateFromTime(config.shift.end, now) : null;

  let shiftEndD = shiftEndDBase;
  if (shiftStartD && shiftEndD && shiftEndD < shiftStartD) {
    shiftEndD = new Date(shiftEndD);
    shiftEndD.setDate(shiftEndD.getDate() + 1);
  }

  const lunchStartD = config?.lunchTime ? buildDateFromTime(config.lunchTime, now) : null;
  const lunchEndD = lunchStartD ? new Date(lunchStartD.getTime() + 60 * 60000) : null;

  const lactStartD = config?.lactationTime ? buildDateFromTime(config.lactationTime, now) : null;
  const lactEndD = lactStartD ? new Date(lactStartD.getTime() + 60 * 60000) : null;

  const isGluedToIn = !!(lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime());
  const isGluedToOut = !!(lactEndD && shiftEndD && lactEndD.getTime() === shiftEndD.getTime());
  const isGluedToLunch = !!(lactStartD && lunchEndD && lactStartD.getTime() === lunchEndD.getTime());
  const needsSeparateLactationPunch = !!(lactStartD && !isGluedToIn && !isGluedToOut && !isGluedToLunch);

  let expectedIn = shiftStartD;
  if (isGluedToIn && lactEndD) {
    expectedIn = lactEndD;
  }

  return {
    employee,
    config,
    shiftStartD,
    shiftEndD,
    lunchStartD,
    lunchEndD,
    lactStartD,
    lactEndD,
    isGluedToIn,
    isGluedToOut,
    isGluedToLunch,
    needsSeparateLactationPunch,
    expectedIn,
    lastPunch, // 🚨 ¡AHORA SÍ ENVIAMOS EL ÚLTIMO REGISTRO AL ENGINE!
  };
};

// ============================================================
// ✅ PRESENTACIÓN VISUAL DEL MARCAJE
// ============================================================
export const buildFinalPunchPresentation = ({
  employee,
  type,
  rawType,
  customConfig,
  now,
  metadata = null,
  shifts = [],
}) => {
  const { config, isGluedToLunch, isGluedToOut, lactEndD, lunchEndD, expectedIn } = customConfig;

  let lateStatus = { isLate: false };
  let finalType = rawType || type;
  let finalMetadata = metadata ? { ...metadata } : {};

  const nextDayText = getNextWorkDayText(employee, now, shifts, getTodayScheduleConfig);
  const todayPunches = getTodayPunches(employee, now);

  const presentation = {
    finalType,
    metadata: finalMetadata,
    lateStatus,
    nextDayText,
    shiftName: config?.shift?.name || 'General',
    message: '',
    subtext: '',
    color: 'blue',
    iconKey: 'check',
    isLactationAction: false,
    warning: '',
  };

  if (rawType === 'IN_EARLY') {
    presentation.finalType = 'IN';
    presentation.metadata.authorizedEarly = true;
  }

  if (rawType === 'OUT_LATE') {
    presentation.finalType = 'OUT';
    presentation.metadata.authorizedLate = true;
  }

  if (rawType === 'IN_AFTER_SHIFT') {
    presentation.finalType = 'IN';
    presentation.metadata.authorizedAfterShift = true;
  }

  // 🚨 CORRECCIÓN: Cálculo real del día de ayer
  if (['IN', 'IN_EXTRA'].includes(presentation.finalType)) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const yesterdayOpenPunch = findLastPunchOfTypes(employee, OPEN_PUNCH_TYPES, yesterday);
    if (yesterdayOpenPunch) {
      presentation.warning = '⚠️ Nota: parece que faltó registrar una salida el día anterior.';
    }
  }

  switch (presentation.finalType) {
    case 'IN': {
      if (rawType === 'IN_AFTER_SHIFT') {
        presentation.message = 'Entrada especial autorizada';
        presentation.subtext = 'Registro fuera de horario';
        presentation.color = 'purple';
        presentation.iconKey = 'shield';
      } else {
        presentation.lateStatus = checkLateness(expectedIn, now);
        presentation.message = rawType === 'IN_EARLY' ? 'Entrada temprana autorizada' : 'Bienvenido';
        presentation.subtext = 'Entrada laboral registrada';
        presentation.color = rawType === 'IN_EARLY' ? 'purple' : 'green';
        presentation.iconKey = rawType === 'IN_EARLY' ? 'plus' : 'check';
      }
      break;
    }

    case 'OUT_LUNCH': {
      const minutesToAdd = isGluedToLunch ? 120 : 60;
      const expectedReturn = new Date(now.getTime() + minutesToAdd * 60000);
      presentation.message = 'Buen provecho';
      presentation.subtext = `Regreso esperado: ${expectedReturn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      presentation.color = isGluedToLunch ? 'pink' : 'orange';
      presentation.iconKey = isGluedToLunch ? 'baby' : 'utensils';
      presentation.isLactationAction = isGluedToLunch;
      break;
    }

    case 'IN_LUNCH': {
      let expectedReturn = lunchEndD;
      const outLunchPunch = [...todayPunches].reverse().find((p) => p.type === 'OUT_LUNCH');
      if (outLunchPunch) {
        const plusMinutes = isGluedToLunch ? 120 : 60;
        expectedReturn = new Date(new Date(outLunchPunch.timestamp).getTime() + plusMinutes * 60000);
      }

      presentation.lateStatus = checkLateness(expectedReturn, now);
      presentation.message = 'Bienvenido de vuelta';
      presentation.subtext = 'Regreso de almuerzo registrado';
      presentation.color = 'blue';
      presentation.iconKey = 'check';
      presentation.isLactationAction = isGluedToLunch;
      break;
    }

    case 'OUT_LACTATION': {
      const expectedReturn = new Date(now.getTime() + 60 * 60000);
      presentation.message = 'Hora de lactancia';
      presentation.subtext = `Regreso esperado: ${expectedReturn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      presentation.color = 'pink';
      presentation.iconKey = 'baby';
      presentation.isLactationAction = true;
      break;
    }

    case 'IN_LACTATION': {
      let expectedReturn = lactEndD;
      const outLactationPunch = [...todayPunches].reverse().find((p) => p.type === 'OUT_LACTATION');
      if (outLactationPunch) {
        expectedReturn = new Date(new Date(outLactationPunch.timestamp).getTime() + 60 * 60000);
      }

      presentation.lateStatus = checkLateness(expectedReturn, now);
      presentation.message = 'Bienvenido de vuelta';
      presentation.subtext = 'Regreso de lactancia registrado';
      presentation.color = 'pink';
      presentation.iconKey = 'check';
      presentation.isLactationAction = true;
      break;
    }

case 'OUT': {
      if (isGluedToOut) {
        presentation.message = 'Lactancia y salida';
        presentation.subtext = `Descansa, nos vemos ${nextDayText}`;
        presentation.color = 'pink';
        presentation.iconKey = 'calendarHeart';
        presentation.isLactationAction = true;
      } else if (presentation.metadata?.skippedLunch) {
        // 🚨 NUEVO: Presentación para Omisión de Almuerzo
        presentation.message = 'Salida registrada';
        presentation.subtext = 'Jornada continua (Sin almuerzo)';
        presentation.color = 'slate';
        presentation.iconKey = 'logout';
      } else {
        presentation.message = rawType === 'OUT_LATE' ? 'Horas extra autorizadas' : 'Salida registrada';
        presentation.subtext = presentation.metadata?.adjustedTimestamp
          ? `Hora planilla: ${new Date(presentation.metadata.adjustedTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Nos vemos ${nextDayText}`
          : `Buen descanso, nos vemos ${nextDayText}`;
        presentation.color = rawType === 'OUT_LATE' ? 'purple' : 'slate';
        presentation.iconKey = 'logout';
      }
      break;
    }
    case 'IN_EXTRA': {
      presentation.message = 'Entrada extra autorizada';
      presentation.subtext = 'Turno adicional iniciado';
      presentation.color = 'purple';
      presentation.iconKey = 'plus';
      break;
    }

    case 'OUT_EXTRA': {
      presentation.message = 'Salida extra registrada';
      presentation.subtext = 'Horas adicionales registradas';
      presentation.color = 'slate';
      presentation.iconKey = 'logout';
      break;
    }

case 'OUT_EARLY': {
      presentation.message = 'Permiso registrado';
      presentation.subtext = presentation.metadata?.reason || 'Salida anticipada autorizada';
      presentation.color = 'slate';
      presentation.iconKey = 'doorOpen';
      break;
    }

    // 🚨 NUEVO: Presentación para Gestión Externa
    case 'OUT_BUSINESS': {
      presentation.message = 'Gestión externa';
      presentation.subtext = presentation.metadata?.notes || 'En labores fuera de sucursal';
      presentation.color = 'blue';
      presentation.iconKey = 'check'; 
      break;
    }

    case 'IN_RETURN': {
      presentation.message = 'Bienvenido de vuelta';
      presentation.subtext = 'Regreso de permiso registrado';
      presentation.color = 'blue';
      presentation.iconKey = 'check';
      break;
    }

    default:
      break;
  }

  if (presentation.lateStatus?.isLate) {
    presentation.message = 'Registro con atraso';
    presentation.subtext = presentation.lateStatus.text || 'Marcaje tardío';
    presentation.color = 'red';
    presentation.iconKey = 'alert';
    presentation.isLactationAction = false;
  }

  return presentation;
};