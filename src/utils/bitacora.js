import { diaSV, fechaNumerica } from './fecha';
// La entrada de la bitácora, armada en UN solo sitio.
//
// Vivía dentro de `store/slices/auditSlice.js`, así que sólo podía anotar quien
// tuviera el store a mano —o sea, las pantallas—. Desde el 2026-09-28 (D3 del
// plan del núcleo portable) la anotan también las funciones de `src/data` que
// guardan, para que la app del teléfono la herede al llamar a la misma función;
// y el store delega acá. Lógica pura: no conoce al navegador ni a Supabase.

export const AUDIT_SOURCES = {
  ADMIN_PANEL: 'ADMIN_PANEL',
  KIOSK: 'KIOSK',
  SYSTEM: 'SYSTEM',
};

// 🚨 CORRECCIÓN: Alineado estrictamente con el constraint de PostgreSQL
export const AUDIT_SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
};

const ALLOWED_SOURCES = new Set(Object.values(AUDIT_SOURCES));
const ALLOWED_SEVERITY = new Set(Object.values(AUDIT_SEVERITY));

const normalizeAction = (action) => String(action || '').trim();

const inferSource = (details) => {
  if (details?.audit_info) return AUDIT_SOURCES.KIOSK;
  if (details?.source) return String(details.source).toUpperCase();
  return AUDIT_SOURCES.ADMIN_PANEL;
};

const inferSeverity = (action, details) => {
  const explicit = details?.severity ? String(details.severity).toUpperCase() : null;
  if (explicit && ALLOWED_SEVERITY.has(explicit)) return explicit;

  const a = String(action || '').toUpperCase();

  // CRITICAL: acciones de alto riesgo o intentos.
  if (
    a.includes('ELIMINAR') ||
    a.includes('REVOCAR') ||
    a.includes('VINCULAR_KIOSCO') ||
    a.includes('INTENTO') ||
    a.includes('DENEG') ||
    a.includes('FRAUDE')
  ) {
    return AUDIT_SEVERITY.CRITICAL; // 🚨 Ajustado a CRITICAL
  }

  // WARNING: fallos, inconsistencias, casos a revisar.
  if (a.includes('FALLO') || a.includes('ERROR') || a.includes('WARNING')) {
    return AUDIT_SEVERITY.WARNING; // 🚨 Ajustado a WARNING
  }

  return AUDIT_SEVERITY.INFO;
};

const pickBranchContext = (details) => {
  const ai = details?.audit_info || {};
  return {
    branch_id:
      ai.branch_id != null
        ? String(ai.branch_id)
        : details?.branch_id != null
          ? String(details.branch_id)
          : null,
    branch_name:
      ai.branch_name != null
        ? String(ai.branch_name)
        : details?.branch_name != null
          ? String(details.branch_name)
          : null,
    device_name:
      ai.device_name != null
        ? String(ai.device_name)
        : details?.device_name != null
          ? String(details.device_name)
          : null,
    input_method:
      ai.input_method != null
        ? String(ai.input_method)
        : details?.input_method != null
          ? String(details.input_method)
          : null,
  };
};

const safeDetails = (raw) => {
  const details = raw && typeof raw === 'object' ? raw : {};

  // Extraemos las propiedades que ya tienen su propia columna para no duplicarlas en el JSONB
  // eslint-disable-next-line no-unused-vars
  const { source, severity, branch_id, branch_name, device_name, input_method, ...rest } = details;

  try {
    const json = JSON.stringify(rest);
    if (json.length <= 20000) return rest;
    return {
      __truncated: true,
      __size: json.length,
      note: 'details excedía el límite, se truncó',
    };
  } catch {
    return {
      __invalid: true,
      note: 'details no serializable (cíclico u objeto inválido)',
    };
  }
};

/**
 * La fila que se manda a `registrar_bitacora`, o `null` si no hay acción.
 * Acepta la forma de siempre (`accion, id, detalles`) o un objeto
 * `{ action, targetId|target_id, details, userName|user_name, source, severity }`.
 */
export function armarEntrada(actionOrObj, targetId = null, details = {}, nombre = null) {
  let action = actionOrObj;
  let tId = targetId;
  let det = details;
  let overrideName = nombre;

  if (actionOrObj && typeof actionOrObj === 'object' && !Array.isArray(actionOrObj)) {
    action = actionOrObj.action;
    tId = actionOrObj.targetId ?? actionOrObj.target_id ?? null;
    det = actionOrObj.details ?? {};
    overrideName = actionOrObj.userName ?? actionOrObj.user_name ?? nombre;

    if (actionOrObj.source) det = { ...det, source: actionOrObj.source };
    if (actionOrObj.severity) det = { ...det, severity: actionOrObj.severity };
  }

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return null;

  const ctx = pickBranchContext(det || {});

  const sourceCandidate = String(inferSource(det) || AUDIT_SOURCES.ADMIN_PANEL).toUpperCase();
  const severityCandidate = String(inferSeverity(normalizedAction, det) || AUDIT_SEVERITY.INFO).toUpperCase();

  const source = ALLOWED_SOURCES.has(sourceCandidate) ? sourceCandidate : AUDIT_SOURCES.ADMIN_PANEL;
  const severity = ALLOWED_SEVERITY.has(severityCandidate) ? severityCandidate : AUDIT_SEVERITY.INFO;

  // Quién firma NO se manda desde acá: lo resuelve `registrar_bitacora` con
  // `auth_employee_id()`. El navegador conoce la CUENTA y la bitácora se firma
  // con la FICHA, y elegir mal ese id es lo que la dejó muda 22 días — ver el
  // encabezado de `src/data/audit.js`. `user_name` viaja sólo de respaldo,
  // para el caso en que la ficha no se pueda resolver.
  return {
    user_name: overrideName || 'Sistema/Anónimo',
    action: normalizedAction,
    target_id: tId != null && String(tId).trim() !== '' ? String(tId) : null,
    details: safeDetails(det),
    source,
    severity,
    branch_id: ctx.branch_id,
    branch_name: ctx.branch_name,
    device_name: ctx.device_name,
    input_method: ctx.input_method,
  };
}

// ── La pantalla de Auditoría: filtro y orden (2026-10-05) ───────────────────
// Vivía en `AuditView`; se mudó para que la app filtre igual. El día de un
// registro es el de El Salvador (`diaSV`), NO el del UTC: con `toISOString()`,
// lo que pasó después de las 6 p. m. caía en el día siguiente y desaparecía
// del filtro «hoy».

export const ACCIONES_DE_BITACORA = [
    { value: 'ALL', label: 'Todas' },
    { value: 'REGISTRO_ASISTENCIA', label: 'Asistencias' },
    { value: 'CREAR_EMPLEADO', label: 'Creaciones' },
    { value: 'EDITAR_EMPLEADO', label: 'Ediciones' },
    { value: 'ELIMINAR_EMPLEADO', label: 'Eliminaciones' },
];

export function filtrarBitacora(logs, { accion = 'ALL', desde = '', hasta = '' } = {}) {
    return (logs || []).filter((log) => {
        if (accion !== 'ALL' && log.action !== accion) return false;
        if (desde || hasta) {
            const dia = diaSV(log.created_at);
            if (desde && dia < desde) return false;
            if (hasta && dia > hasta) return false;
        }
        return true;
    });
}

/** Ordena por una columna; la fecha como instante y lo demás como texto sin mayúsculas. */
export function ordenarBitacora(logs, { key = 'created_at', direction = 'desc' } = {}) {
    const valor = (l) => (key === 'created_at' ? new Date(l.created_at || 0).getTime() : String(l[key] || '').toLowerCase());
    return [...(logs || [])].sort((a, b) => {
        const x = valor(a), y = valor(b);
        if (x < y) return direction === 'asc' ? -1 : 1;
        if (x > y) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

/** La severidad de un registro, como variante de `Badge`. */
export const varianteDeSeveridad = (s) => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warning' : 'info');

/** De dónde vino el registro, en palabras. */
export const ROTULO_DE_ORIGEN = { KIOSK: 'Kiosco', SYSTEM: 'Sistema', ADMIN_PANEL: 'Portal' };

/**
 * Las columnas y filas del CSV de la bitácora — el portal y la app exportan lo
 * mismo. Cada fila son valores crudos; el escape lo pone quien escribe el
 * archivo.
 */
export const COLUMNAS_CSV_BITACORA = [
    'Fecha', 'Hora', 'Usuario', 'Acción', 'Severidad',
    'Origen', 'Sucursal', 'Dispositivo', 'Método de Ingreso',
    'ID Objetivo', 'Detalles JSON',
];
export function filasCsvDeBitacora(logs, hora12ConSegundos) {
    return (logs || []).map((log) => {
        const d = new Date(log.created_at);
        return [
            // La fecha en El Salvador y con el formato de toda la app (gate:hora).
            fechaNumerica(log.created_at), hora12ConSegundos ? hora12ConSegundos(d) : d.toISOString().slice(11, 19),
            log.user_name, log.action, log.severity, log.source, log.branch_name,
            log.device_name, log.input_method, log.target_id, JSON.stringify(log.details || {}),
        ].map((v) => String(v ?? ''));
    });
}
