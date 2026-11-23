import {
  buildDateFromTime,
  checkLateness,
  findLastPunchOfTypes,
  getNextWorkDayText,
  getTodayPunches,
} from './timeClock.helpers';
import { getTodayScheduleConfig } from '../utils/helpers';
import { hora12 } from './hora';
import { MINUTOS_DE_PAUSA, regresoEsperadoDeLaPausa } from './turnoDelDia';

export { regresoEsperadoDeLaPausa };

/** Minutos de la lactancia cuyo horario está más cerca de `cuando`: con la
 *  lactancia partida (Art. 61) son dos pausas de 30, no una hora. */
const minutosDeLactanciaCercana = (cfg, cuando) => {
  const t = new Date(cuando).getTime();
  const primera = { inicio: cfg?.lactStartD, minutos: Number(cfg?.lactationMinutes) || MINUTOS_DE_PAUSA };
  const segunda = cfg?.lact2StartD ? { inicio: cfg.lact2StartD, minutos: Number(cfg?.lact2Minutes) || MINUTOS_DE_PAUSA / 2 } : null;
  if (!segunda || !primera.inicio) return primera.minutos;
  const d1 = Math.abs(t - new Date(primera.inicio).getTime());
  const d2 = Math.abs(t - new Date(segunda.inicio).getTime());
  return d2 < d1 ? segunda.minutos : primera.minutos;
};

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
  const shiftStartD = config?.shift?.start ? buildDateFromTime(now, config.shift.start) : null;
  const shiftEndDBase = config?.shift?.end ? buildDateFromTime(now, config.shift.end) : null;

  let shiftEndD = shiftEndDBase;
  if (shiftStartD && shiftEndD && shiftEndD < shiftStartD) {
    shiftEndD = new Date(shiftEndD);
    shiftEndD.setDate(shiftEndD.getDate() + 1);
  }

  // La duración de cada pausa sale del HORARIO del día (`resolverTurnoDelDia`),
  // no de una hora fija: la jornada partida tiene una pausa de 4 h y la
  // lactancia partida, dos de 30 min (2026-11-23).
  const lunchMinutes = Number(config?.lunchMinutes) || MINUTOS_DE_PAUSA;
  const lactationMinutes = Number(config?.lactationMinutes) || MINUTOS_DE_PAUSA;
  const lunchStartD = config?.lunchTime ? buildDateFromTime(now, config.lunchTime) : null;
  const lunchEndD = lunchStartD ? new Date(lunchStartD.getTime() + lunchMinutes * 60000) : null;

  const lactStartD = config?.lactationTime ? buildDateFromTime(now, config.lactationTime) : null;
  const lactEndD = lactStartD ? new Date(lactStartD.getTime() + lactationMinutes * 60000) : null;
  const lact2StartD = config?.lactation2Time ? buildDateFromTime(now, config.lactation2Time) : null;
  const lact2Minutes = Number(config?.lactation2Minutes) || MINUTOS_DE_PAUSA / 2;

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
    lact2StartD,
    lunchMinutes,
    lactationMinutes,
    lact2Minutes,
    esJornadaPartida: Boolean(config?.esJornadaPartida),
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
  const minutosDePausa = Number(customConfig?.lunchMinutes) || MINUTOS_DE_PAUSA;
  const minutosDeLactancia = Number(customConfig?.lactationMinutes) || MINUTOS_DE_PAUSA;
  // Lo que se espera que dure la salida a la pausa: la pausa del horario, más
  // la lactancia si va pegada detrás.
  const minutosFueraEnLaPausa = minutosDePausa + (isGluedToLunch ? minutosDeLactancia : 0);
  const partida = Boolean(customConfig?.esJornadaPartida);

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

  if (rawType === 'IN_EARLY_EXTRA') {
    presentation.finalType = 'IN';
    presentation.metadata.extraTimeAuthorized = true;
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
      } else if (rawType === 'IN_EARLY_EXTRA') {
        presentation.message = 'Tiempo extra registrado';
        presentation.subtext = `Entrada con hora real autorizada`;
        presentation.color = 'purple';
        presentation.iconKey = 'plus';
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
      // El regreso es el fin de la pausa del horario; si salió tarde, la
      // pausa completa desde que salió.
      const finProgramado = lunchEndD
        ? new Date(lunchEndD.getTime() + (isGluedToLunch ? minutosDeLactancia * 60000 : 0))
        : null;
      const desdeQueSalio = new Date(now.getTime() + minutosFueraEnLaPausa * 60000);
      const expectedReturn = finProgramado && finProgramado > desdeQueSalio ? finProgramado : desdeQueSalio;
      presentation.message = partida ? 'Pausa registrada' : 'Buen provecho';
      presentation.subtext = `Regreso esperado: ${hora12(expectedReturn)}`;
      presentation.color = isGluedToLunch ? 'pink' : 'orange';
      presentation.iconKey = isGluedToLunch ? 'baby' : 'utensils';
      presentation.isLactationAction = isGluedToLunch;
      break;
    }

    case 'IN_LUNCH': {
      // La tardanza se mide contra el FIN DE LA PAUSA PROGRAMADA de ese día
      // (4 h en la jornada partida), no contra 60 min fijos. Si salió tarde a
      // la pausa, tiene la pausa completa desde que salió.
      const expectedReturn = regresoEsperadoDeLaPausa({
        lunchEndD,
        extraMinutos: isGluedToLunch ? minutosDeLactancia : 0,
        salida: [...todayPunches].reverse().find((p) => p.type === 'OUT_LUNCH'),
        minutosFuera: minutosFueraEnLaPausa,
      });

      presentation.lateStatus = checkLateness(expectedReturn, now);
      presentation.message = 'Bienvenido de vuelta';
      presentation.subtext = partida ? 'Regreso de la pausa registrado' : 'Regreso de almuerzo registrado';
      presentation.color = 'blue';
      presentation.iconKey = 'check';
      presentation.isLactationAction = isGluedToLunch;
      break;
    }

    case 'OUT_LACTATION': {
      const expectedReturn = new Date(now.getTime() + minutosDeLactanciaCercana(customConfig, now) * 60000);
      presentation.message = 'Hora de lactancia';
      presentation.subtext = `Regreso esperado: ${hora12(expectedReturn)}`;
      presentation.color = 'pink';
      presentation.iconKey = 'baby';
      presentation.isLactationAction = true;
      break;
    }

    case 'IN_LACTATION': {
      let expectedReturn = lactEndD;
      const outLactationPunch = [...todayPunches].reverse().find((p) => p.type === 'OUT_LACTATION');
      if (outLactationPunch) {
        const salida = new Date(outLactationPunch.timestamp);
        expectedReturn = new Date(salida.getTime() + minutosDeLactanciaCercana(customConfig, salida) * 60000);
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
          ? `Hora planilla: ${hora12(presentation.metadata.adjustedTimestamp)}. Nos vemos ${nextDayText}`
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

  // Sin horario cargado no hay turno contra el cual medir nada: el marcaje se
  // registra igual y queda señalado para la revisión de Talento Humano.
  if (config?.sinHorario) {
    presentation.metadata.sinHorario = true;
    presentation.metadata.pendingHRReview = true;
    presentation.shiftName = 'Sin horario';
    presentation.warning = presentation.warning
      || 'Aún no tienes horario cargado para esta semana. Talento Humano lo revisará.';
  }

  if (presentation.lateStatus?.isLate) {
    presentation.message = 'Registro con atraso';
    presentation.subtext = presentation.lateStatus.text || 'Marcación tardía';
    presentation.color = 'red';
    presentation.iconKey = 'alert';
    presentation.isLactationAction = false;
  }

  return presentation;
};