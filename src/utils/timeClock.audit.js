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
  WARN: 'WARN',
  ERROR: 'ERROR',
  SECURITY: 'SECURITY',
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

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const jsonSizeBytes = (obj) => {
  try {
    return new TextEncoder().encode(JSON.stringify(obj ?? {})).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const compactIfTooLarge = (details, maxBytes = DETAILS_MAX_BYTES) => {
  const bytes = jsonSizeBytes(details);
  if (bytes <= maxBytes) return details;

  const keys = isPlainObject(details) ? Object.keys(details) : [];
  return {
    __truncated: true,
    __bytes: bytes,
    __max_bytes: maxBytes,
    __keys: keys.slice(0, 60),
    message: 'Details exceden el tamaño permitido. Se guardó un resumen.',
  };
};

const pickEnum = (value, allowedSet, fallback) => {
  const v = asUpper(value);
  if (!v) return fallback;
  return allowedSet.has(v) ? v : fallback;
};

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

export const deriveSeverity = (action) => {
  const a = asUpper(action) || '';
  if (a.includes('INTENTO_PIN_INCORRECTO') || a.includes('SECURITY')) return AUDIT_SEVERITY.SECURITY;
  if (a.includes('ERROR') || a.includes('FALLO') || a.includes('EXCEPTION')) return AUDIT_SEVERITY.ERROR;
  if (a.includes('REVOCAR') || a.includes('VINCULAR') || a.includes('BORRAR') || a.includes('ELIMINAR')) return AUDIT_SEVERITY.WARN;
  return AUDIT_SEVERITY.INFO;
};

export const deriveSource = ({ isKiosk } = {}) => {
  return isKiosk ? AUDIT_SOURCE.KIOSK : AUDIT_SOURCE.ADMIN;
};

export const buildAuditPayload = ({
  action,
  targetId = null,
  details = {},
  actor = null,
  kioskAuditInfo = null,
  isKiosk = false,
  source = null,
  severity = null,
} = {}) => {
  const norm = normalizeKioskAuditInfo(kioskAuditInfo);

  const sourceValue = pickEnum(source, new Set(Object.values(AUDIT_SOURCE).map((s) => String(s).toUpperCase())), deriveSource({ isKiosk }));
  const severityValue = pickEnum(severity, new Set(Object.values(AUDIT_SEVERITY).map((s) => String(s).toUpperCase())), deriveSeverity(action));
  const inputMethodValue = pickEnum(norm.input_method, new Set(Object.values(INPUT_METHOD).map((s) => String(s).toUpperCase())), INPUT_METHOD.UNKNOWN);

  const payload = {
    action: asText(action) || 'UNKNOWN',
    target_id: asText(targetId),
    user_id: asText(actor?.id),
    user_name: asText(actor?.name) || (isKiosk ? (norm.employee_name ? `${norm.employee_name} (Vía Kiosco)` : 'Kiosco') : 'Sistema/Anónimo'),

    source: asText(sourceValue),
    severity: asText(severityValue),

    branch_id: asText(norm.branch_id),
    branch_name: asText(norm.branch_name),
    device_name: asText(norm.device_name),
    input_method: asText(inputMethodValue),

    details: compactIfTooLarge(
      redactSensitive({
        __schema: 'audit_details_v1',
        __ts_client: new Date().toISOString(),
        ...safeClone(details),
        audit_info: {
          employee_id: asText(norm.employee_id),
          employee_name: asText(norm.employee_name),
          employee_code: asText(norm.employee_code),
          action_type: asText(norm.action_type) || asText(action),
          branch_id: asText(norm.branch_id),
          branch_name: asText(norm.branch_name),
          device_name: asText(norm.device_name),
          input_method: asText(inputMethodValue),
        },
      })
    ),
  };

  return payload;
};

export const buildKioskAttendanceDetails = ({
  employee,
  actionType,
  kioskAuditInfo,
  extra = {},
} = {}) => {
  const norm = normalizeKioskAuditInfo(kioskAuditInfo);
  const inputMethodValue = pickEnum(norm.input_method, new Set(Object.values(INPUT_METHOD).map((s) => String(s).toUpperCase())), INPUT_METHOD.UNKNOWN);
  return compactIfTooLarge(
    redactSensitive({
      __schema: 'attendance_details_v1',
      __ts_client: new Date().toISOString(),
      ...safeClone(extra),
      audit_info: {
        employee_id: asText(employee?.id ?? norm.employee_id),
        employee_name: asText(employee?.name ?? norm.employee_name),
        employee_code: asText(employee?.code ?? norm.employee_code),
        branch_id: asText(norm.branch_id),
        branch_name: asText(norm.branch_name),
        device_name: asText(norm.device_name),
        input_method: asText(inputMethodValue),
        action_type: asText(actionType),
      },
    })
  );
};

export const isSecurityEvent = (action) => {
  const a = asUpper(action) || '';
  return (
    a.includes('INTENTO_PIN_INCORRECTO') ||
    a.includes('MANIPULACION') ||
    a.includes('SECURITY') ||
    a.includes('INTRUSION')
  );
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
} = {}) => {
  return {
    reason: asText(reason),
    notes: asText(notes),
    requiresAttachment: reason === 'Permiso Médico / Consulta',
  };
};

export const buildYesterdayMissedPunchWarning = ({
  employee = null,
  now = new Date(),
} = {}) => {
  const attendance = employee?.attendance || [];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];

  const yesterdayPunches = attendance.filter((a) => a.timestamp?.startsWith(yStr));
  if (!yesterdayPunches.length) return '';

  const lastType = yesterdayPunches[yesterdayPunches.length - 1]?.type;
  const closingTypes = ['OUT', 'OUT_EXTRA', 'OUT_EARLY'];

  if (!closingTypes.includes(lastType)) {
    return '⚠️ NOTA: Olvidaste marcar tu salida el día de ayer.';
  }

  return '';
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
      case 'EMPLOYEE':
        if (!targetVal) return false;
        const targets = Array.isArray(targetVal) ? targetVal : [targetVal];
        return targets.map(String).includes(empIdStr);
      default: return false;
    }
  });
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