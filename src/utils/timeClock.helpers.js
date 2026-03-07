export const buildDateFromTime = (baseDate, timeStr) => {
  if (!baseDate || !timeStr) return null;

  const d = new Date(baseDate);
  const [h, m] = String(timeStr)
    .split(':')
    .map((value) => Number(value));

  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  d.setHours(h, m, 0, 0);
  return d;
};

export const format12hWithSeconds = (dateObj) => {
  if (!dateObj) return '';

  return new Date(dateObj).toLocaleTimeString('es-ES', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
};

export const format12hNoSeconds = (dateObj) => {
  if (!dateObj) return '';

  return new Date(dateObj).toLocaleTimeString('es-ES', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

export const formatDuration = (totalMins) => {
  const mins = Number(totalMins || 0);

  if (Number.isNaN(mins) || mins <= 0) return '0 min';

  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} h y ${m} min` : `${h} h`;
  }

  return `${mins} min`;
};

export const toLocalISODate = (dateObj = new Date()) => {
  const d = new Date(dateObj);
  if (Number.isNaN(d.getTime())) return '';
  
  // Mejorado: Usar métodos locales de Date para extraer YYYY-MM-DD sin depender de offsets manuales
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

export const toLocalISOFromTimestamp = (timestamp) => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return toLocalISODate(d);
};

export const checkLateness = (expectedDate, currentDate) => {
  if (!expectedDate || !currentDate) return { isLate: false };

  const expected = new Date(expectedDate);
  const current = new Date(currentDate);

  if (Number.isNaN(expected.getTime()) || Number.isNaN(current.getTime())) {
    return { isLate: false };
  }

  const diffMins = Math.floor((current - expected) / 60000);

  if (diffMins > 5) {
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;

    return {
      isLate: true,
      diffMins,
      text: h > 0 ? `${h}h y ${m}m tarde` : `${m} min tarde`,
    };
  }

  return { isLate: false, diffMins: Math.max(0, diffMins) };
};

export const detectInputMethod = (keystrokeTimestamps = []) => {
  const times = Array.isArray(keystrokeTimestamps) ? keystrokeTimestamps.filter(t => typeof t === 'number' && !Number.isNaN(t)) : [];

  if (times.length < 2) return 'TECLADO_MANUAL';

  const totalTime = times[times.length - 1] - times[0];
  const intervals = Math.max(1, times.length - 1);
  const avgTimePerChar = totalTime / intervals;

  // Evitar NaN o Infinity si los timestamps son idénticos o defectuosos
  if (!Number.isFinite(avgTimePerChar)) return 'TECLADO_MANUAL';

  return avgTimePerChar < 40 ? 'ESCANER_INFRARROJO' : 'TECLADO_MANUAL';
};

export const getKioskInputMethod = (keystrokeTimestamps = []) => {
  return detectInputMethod(keystrokeTimestamps);
};

export const getTodayPunches = (employee, dateObj = new Date()) => {
  const isoDate = toLocalISODate(dateObj);
  return (employee?.attendance || []).filter((punch) => punch.timestamp?.startsWith(isoDate));
};

export const getLastPunchOfDay = (employee, dateObj = new Date()) => {
  const punches = getTodayPunches(employee, dateObj);
  return punches.length ? punches[punches.length - 1] : null;
};

export const resolveAttendanceFlow = ({
  employee,
  currentDate = new Date(),
  customConfig,
  specialMode = false,
}) => {
  const lastPunch = getLastPunchOfDay(employee, currentDate);
  const config = customConfig?.config || {};
  const shiftEndD = customConfig?.shiftEndD ? new Date(customConfig.shiftEndD) : null;
  const expectedIn = customConfig?.expectedIn ? new Date(customConfig.expectedIn) : null;
  const lunchStartD = config?.lunchTime ? buildDateFromTime(currentDate, config.lunchTime) : null;
  const lactStartD = customConfig?.lactStartD ? new Date(customConfig.lactStartD) : null;
  const needsSeparateLactationPunch = Boolean(
    lactStartD &&
      !customConfig?.isGluedToIn &&
      !customConfig?.isGluedToOut &&
      !customConfig?.isGluedToLunch
  );

  if (specialMode) {
    const isCurrentlyWorking = Boolean(
      lastPunch && ['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN', 'IN_EXTRA'].includes(lastPunch.type)
    );

    return {
      type: null,
      requiresAuth: isCurrentlyWorking,
      authType: isCurrentlyWorking ? 'SPECIAL_OUT_REQUEST' : null,
      blockedReason: isCurrentlyWorking ? null : 'TURNO_INACTIVO',
      lastPunch,
    };
  }

  if (config?.isOffDay) {
    if (!lastPunch || ['OUT_EXTRA', 'OUT', 'OUT_EARLY'].includes(lastPunch.type)) {
      return { type: 'IN_EXTRA', requiresAuth: true, authType: 'IN_EXTRA', lastPunch };
    }

    if (lastPunch.type === 'IN_EXTRA') {
      return { type: 'OUT_EXTRA', requiresAuth: false, authType: null, lastPunch };
    }

    return { type: 'OUT_EXTRA', requiresAuth: false, authType: null, lastPunch };
  }

  let type = 'IN';

  const currentDateTime = new Date(currentDate).getTime();

  if (!lastPunch) {
    type = 'IN';
  } else {
    const lastType = lastPunch.type;

    if (['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN'].includes(lastType)) {
      const pendingOuts = [];

      if (lunchStartD && !findLastPunchByType(employee, 'OUT_LUNCH', currentDate)) {
        pendingOuts.push({ type: 'OUT_LUNCH', targetTime: lunchStartD.getTime() });
      }

      if (needsSeparateLactationPunch && !findLastPunchByType(employee, 'OUT_LACTATION', currentDate)) {
        pendingOuts.push({ type: 'OUT_LACTATION', targetTime: lactStartD.getTime() });
      }

      pendingOuts.push({
        type: 'OUT',
        targetTime: shiftEndD ? shiftEndD.getTime() : currentDateTime + 999999,
      });

      pendingOuts.sort((a, b) => Math.abs(currentDateTime - a.targetTime) - Math.abs(currentDateTime - b.targetTime));
      type = pendingOuts[0]?.type || 'OUT';
    } else if (lastType === 'OUT_EARLY') {
      type = 'IN_RETURN';
    } else if (lastType === 'OUT_LUNCH') {
      type = 'IN_LUNCH';
    } else if (lastType === 'OUT_LACTATION') {
      type = 'IN_LACTATION';
    } else if (['OUT', 'OUT_EXTRA'].includes(lastType)) {
      type = 'IN_EXTRA';
    } else if (lastType === 'IN_EXTRA') {
      type = 'OUT_EXTRA';
    }
  }

  const currentTime = new Date(currentDate);

  if (type === 'IN' && expectedIn) {
    const diffMins = Math.floor((currentTime - expectedIn) / 60000);
    if (diffMins < -5) {
      return { type: 'IN', requiresAuth: true, authType: 'IN_EARLY', lastPunch };
    }
  }

  if (type === 'IN' && shiftEndD && currentTime > shiftEndD) {
    return { type: 'IN', requiresAuth: true, authType: 'IN_AFTER_SHIFT', lastPunch };
  }

  if (type === 'OUT' && shiftEndD && currentTime > shiftEndD) {
    const diffMins = Math.floor((currentTime - shiftEndD) / 60000);

    if (diffMins > 15) {
      return { type: 'OUT', requiresAuth: true, authType: 'OUT_LATE', extraMins: diffMins, lastPunch };
    }

    if (diffMins > 0) {
      return {
        type: 'OUT',
        requiresAuth: false,
        authType: null,
        adjustedTimestamp: shiftEndD.toISOString(),
        actualPunchTime: currentTime.toISOString(),
        note: `Marcaje real a las ${format12hNoSeconds(currentTime)}. Ajustado a fin de turno (${format12hNoSeconds(shiftEndD)}) para planilla.`,
        lastPunch,
      };
    }
  }

  if (type === 'IN_EXTRA') {
    return { type: 'IN_EXTRA', requiresAuth: true, authType: 'IN_EXTRA', lastPunch };
  }

  return { type, requiresAuth: false, authType: null, lastPunch };
};

export const findLastPunchByType = (employee, type, dateObj = new Date()) => {
  const punches = getTodayPunches(employee, dateObj);
  return [...punches].reverse().find((punch) => punch.type === type) || null;
};

export const findLastPunchOfTypes = (employee, types, dateObj = new Date()) => {
  const list = Array.isArray(types) ? types : [types];
  const typeSet = new Set(list.filter(Boolean));
  if (typeSet.size === 0) return null;

  const punches = getTodayPunches(employee, dateObj);
  return [...punches].reverse().find((punch) => typeSet.has(punch.type)) || null;
};

export const getNextWorkDayText = (employee, referenceDate, shifts, getTodayScheduleConfig) => {
  if (!employee || typeof getTodayScheduleConfig !== 'function') return 'pronto';

  const current = new Date(referenceDate || new Date());
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  for (let i = 1; i <= 7; i += 1) {
    const nextDate = new Date(current);
    nextDate.setDate(current.getDate() + i);

    const config = getTodayScheduleConfig(employee, shifts, nextDate);
    if (config && !config.isOffDay && config.shift) {
      return i === 1 ? 'mañana' : `el ${dayNames[nextDate.getDay()]}`;
    }
  }

  return 'pronto';
};

export const createAuditInfo = ({
  employee,
  kioskConfig,
  actionType,
  inputMethod,
}) => ({
  employee_name: employee?.name || null,
  employee_code: employee?.code || null,
  employee_dui: employee?.dui || null,
  branch_id: kioskConfig?.branchId || null,
  branch_name: kioskConfig?.branchName || null,
  device_name: kioskConfig?.deviceName || kioskConfig?.device_name || 'Kiosco Autorizado',
  input_method: inputMethod || kioskConfig?.inputMethod || 'DESCONOCIDO',
  action_type: actionType || null,
});

export const mergeAttendanceMetadata = ({
  baseMetadata,
  employee,
  kioskConfig,
  actionType,
  inputMethod,
}) => {
  const next = baseMetadata ? { ...baseMetadata } : {};

  next.audit_info = createAuditInfo({
    employee,
    kioskConfig,
    actionType,
    inputMethod,
  });

  return next;
};