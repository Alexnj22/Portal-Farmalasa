// src/utils/timeClock.audit.js
import { 
  CheckCircle2, 
  Utensils, 
  Baby, 
  LogOut, 
  ShieldAlert, 
  AlertTriangle, 
  CalendarHeart,  
  DoorOpen, 
  CircleCheck
} from 'lucide-react';
import { claveDeDia } from './scheduleHelpers';

// -----------------------------------------------------------------------------
// 🧾 TimeClock • Auditoría (Modo Pro)
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} KioskAuditInfo
 * @property {string|number=} employee_id
 * @property {string=} employee_name
 * @property {string=} employee_code
 * @property {string=} employee_dui
 * @property {string|number=} branch_id
 * @property {string=} branch_name
 * @property {string=} device_name
 * @property {string=} input_method
 * @property {string=} action_type
 */

// -------------------------
// Defaults / Enums
// -------------------------
export const AUDIT_SOURCE = {
  ADMIN: 'ADMIN_PANEL',
  KIOSK: 'KIOSK',
  SYSTEM: 'SYSTEM',
};

export const AUDIT_SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
};

export const INPUT_METHOD = {
  MANUAL: 'TECLADO_MANUAL',
  SCANNER: 'ESCANER_INFRARROJO',
  UNKNOWN: 'DESCONOCIDO',
};

// -------------------------
// Guardrails (tamaño / forma)
// -------------------------
export const DETAILS_MAX_BYTES = 20_000;





// -------------------------
// Helpers
// -------------------------
const asText = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const asUpper = (v) => {
  const s = asText(v);
  return s ? s.toUpperCase() : null;
};

const safeObj = (v) => (v && typeof v === 'object' ? v : {});

const safeClone = (obj) => {
  try {
    return JSON.parse(JSON.stringify(obj || {}));
  } catch {
    return {};
  }
};

export const redactSensitive = (details = {}) => {
  const d = safeClone(details);
  delete d.employee_dui;
  delete d.dui;
  delete d.password;
  delete d.pin_ingresado;
  delete d.token;
  delete d.access_token;
  delete d.refresh_token;
  delete d.authorization;
  delete d.auth;
  delete d.headers;
  return d;
};

export const normalizeKioskAuditInfo = (raw) => {
  const r = safeObj(raw);

  const branch_id = asText(r.branch_id ?? r.branchId);
  const branch_name = asText(r.branch_name ?? r.branchName);
  const device_name = asText(r.device_name ?? r.deviceName) || 'Kiosco Autorizado';
  const input_method = asUpper(r.input_method ?? r.inputMethod) || INPUT_METHOD.UNKNOWN;

  const employee_name = asText(r.employee_name ?? r.employeeName);
  const employee_code = asText(r.employee_code ?? r.employeeCode);
  const employee_id = asText(r.employee_id ?? r.employeeId);
  const action_type = asText(r.action_type ?? r.actionType);

  const employee_dui = asText(r.employee_dui ?? r.employeeDui);
  return {
    branch_id,
    branch_name,
    device_name,
    input_method,
    employee_name,
    employee_code,
    employee_id,
    action_type,
    employee_dui,
  };
};








export const buildKioskAuditInfo = ({
  employee = null,
  kioskConfig = null,
  actionType = null,
  inputMethod = null,
} = {}) => {
  return normalizeKioskAuditInfo({
    employee_id: employee?.id,
    employee_name: employee?.name,
    employee_code: employee?.code,
    employee_dui: employee?.dui,
    ...kioskConfig,
    action_type: actionType,
    input_method: inputMethod ?? kioskConfig?.inputMethod ?? kioskConfig?.input_method,
  });
};

export const buildLateOutAdjustedMetadata = ({
  shiftEndDate = null,
  now = new Date(),
} = {}) => {
  if (!shiftEndDate) return {};

  return {
    adjustedTimestamp: shiftEndDate.toISOString(),
    actualPunchTime: now.toISOString(),
    note: `Marcaje real a las ${now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}. Ajustado a fin de turno para planilla.`,
  };
};

export const buildEarlyExitMetadata = ({
  reason = '',
  notes = '',
  adjustedTimestamp = null,
  actualPunchTime = null,
} = {}) => {
  const isMedical = reason === 'Permiso Médico / Consulta';
  const isBusiness = reason === 'Gestión Laboral Externa';
  const skippedLunch = reason === 'Omisión de Almuerzo';

  const metadata = {
    reason: asText(reason),
    notes: asText(notes),
    
    // 🚨 Banderas Inteligentes para RRHH / Planilla
    requiresAttachment: isMedical, // RRHH pedirá el comprobante
    isPendingMedical: isMedical, // Congela el descuento de horas temporalmente
    isPaidBusiness: isBusiness, // RRHH toma la jornada como completa
    skippedLunch: skippedLunch, // RRHH ignora la salida anticipada
  };

  // 🚨 Ajuste silencioso para Planilla (Si salió 30 min antes sin almuerzo, se calcula como salida normal)
  if (adjustedTimestamp) {
    metadata.adjustedTimestamp = adjustedTimestamp;
    metadata.actualPunchTime = actualPunchTime;
    metadata.note = `Jornada sin almuerzo. Ajustado a fin de turno para cálculo de planilla.`;
  }

  return metadata;
};



export const getApplicableAnnouncement = ({ announcements, employee }) => {
  if (!announcements || !employee) return null;

  return announcements.find(ann => {
    if (ann.isArchived) return false;

    const hasRead = (ann.readBy || []).some(
      r => String(typeof r === 'object' ? r.employeeId : r) === String(employee.id)
    );
    if (hasRead) return false;

    const empIdStr = String(employee.id);
    const empBranchStr = String(employee.branchId || employee.branch_id || '');
    const empRoleStr = String(employee.role || '').toLowerCase();

    const targetVal = ann.targetValue;

    switch (ann.targetType) {
      case 'GLOBAL': return true;
      case 'BRANCH': return empBranchStr === String(targetVal);
      case 'ROLE': return empRoleStr === String(targetVal).toLowerCase();
      case 'EMPLOYEE': {
        if (!targetVal) return false;
        const targets = Array.isArray(targetVal) ? targetVal : [targetVal];
        return targets.map(String).includes(empIdStr);
      }
      default: return false;
    }
  });
};

// Returns a birthday announcement object if applicable for this punch, else null.
// Logic:
//   - Birthday TODAY: show on any punch (IN or OUT)
//   - Birthday TOMORROW + tomorrow is day-off: show on OUT today (advance notice)
//   - Birthday TOMORROW + has shift tomorrow: let it trigger naturally on the birthday day
export const getBirthdayAnnouncement = ({ employee, rawType, nowDate }) => {
  const bd = employee?.birthDate || employee?.birth_date;
  if (!bd) return null;

  const today = nowDate || new Date();
  const pad = n => String(n).padStart(2, '0');
  const todayMD = `${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const bdMD = bd.slice(5, 10); // "MM-DD"
  const isBirthdayToday = todayMD === bdMD;

  const tomorrowDate = new Date(today);
  tomorrowDate.setDate(today.getDate() + 1);
  const tomorrowMD = `${pad(tomorrowDate.getMonth() + 1)}-${pad(tomorrowDate.getDate())}`;
  const isBirthdayTomorrow = tomorrowMD === bdMD;

  const firstName = (employee.name || '').split(' ')[0];

  if (isBirthdayToday) {
    const year = today.getFullYear();
    const birthYear = Number(bd.slice(0, 4));
    const age = year - birthYear;
    return {
      id: `birthday_${employee.id}`,
      title: `¡Feliz Cumpleaños, ${firstName}! 🎂`,
      message: `Hoy cumples ${age} años. ¡Todo el equipo de Farmacias La Popular y La Salud te desea un día increíble lleno de alegría y celebración! 🎉🥳`,
      priority: 'BIRTHDAY',
      isBirthday: true,
    };
  }

  if (isBirthdayTomorrow && String(rawType || '').startsWith('OUT')) {
    // Check if tomorrow is a day off
    const dbDay = claveDeDia(tomorrowDate);
    const schedule = employee.weeklySchedule || employee.weekly_schedule || employee.weekly_roster || {};
    const tomorrowConfig = schedule[dbDay] || schedule[Number(dbDay)];
    const tomorrowIsOff = !tomorrowConfig || tomorrowConfig.isOffDay || (!tomorrowConfig.shiftId && !tomorrowConfig.shift_id);

    if (tomorrowIsOff) {
      const year = tomorrowDate.getFullYear();
      const birthYear = Number(bd.slice(0, 4));
      const age = year - birthYear;
      return {
        id: `birthday_tomorrow_${employee.id}`,
        title: `¡Mañana es tu Cumpleaños! 🎂`,
        message: `${firstName}, mañana cumples ${age} años y tienes el día libre. ¡Que lo disfrutes muchísimo! Todo el equipo te manda un abrazo. 🎉`,
        priority: 'BIRTHDAY',
        isBirthday: true,
      };
    }
  }

  return null;
};

export const buildAuthPromptState = ({
  employee,
  type,
  customConfig,
  kioskData = null,
  extraMins = null,
} = {}) => ({
  employee,
  type,
  customConfig,
  kioskData,
  extraMins,
});

// 🚨 MAPEO DINÁMICO DE ICONOS
const ICON_MAP = {
  check: CheckCircle2,
  utensils: Utensils,
  baby: Baby,
  logout: LogOut,
  alert: AlertTriangle,
  shield: ShieldAlert,
  calendarHeart: CalendarHeart,
  plus: CircleCheck,
  doorOpen: DoorOpen,
};

export const buildFeedbackState = ({
  employee,
  theme,
  now = new Date(),
  announcement = null,
  warning = '',
  shiftName = 'General',
} = {}) => ({
  status: 'success',
  employee,
  ...theme,
  // 🚨 Inyectamos el componente React real en lugar de pasar un string vacío
  icon: ICON_MAP[theme?.iconKey] || CheckCircle2, 
  time: now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }),
  shiftName,
  announcement,
  warning: warning || '',
});