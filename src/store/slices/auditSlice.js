// src/store/slices/auditSlice.js
import { supabase } from '../../supabaseClient';
import { safeJsonParse, CACHE_KEYS } from '../utils';

// ==========================================================
// 🔐 Auditoría PRO (sin IP)
// - Enviamos contexto rico: source, severity, branch/device
// - Mantiene compatibilidad con llamadas existentes
// - Sanitiza details (evita datos enormes / cíclicos)
// ==========================================================

const AUDIT_SOURCES = {
  ADMIN_PANEL: 'ADMIN_PANEL',
  KIOSK: 'KIOSK',
  SYSTEM: 'SYSTEM',
};

// 🚨 CORRECCIÓN: Alineado estrictamente con el constraint de PostgreSQL
const AUDIT_SEVERITY = {
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

  const { source, severity, branch_id, branch_name, device_name, input_method, ...rest } = details;

  try {
    const json = JSON.stringify(rest);
    if (json.length <= 20000) return rest;
    return {
      __truncated: true,
      __size: json.length,
      note: 'details excedía el límite, se truncó',
    };
  } catch (e) {
    return {
      __invalid: true,
      note: 'details no serializable (cíclico u objeto inválido)',
    };
  }
};

let lastAuditFetchTime = 0;

export const createAuditSlice = (set, get) => ({
  auditLog: safeJsonParse(localStorage.getItem(CACHE_KEYS.AUDIT), []) || [],

  setAuditLog: (updater) =>
    set((state) => {
      const next = typeof updater === 'function' ? updater(state.auditLog) : updater;
      return { auditLog: next };
    }),

  appendAuditLog: async (actionOrObj, targetId = null, details = {}, override_user_name = null) => {
    const storedUser = safeJsonParse(localStorage.getItem('sb_user'));

    let action = actionOrObj;
    let tId = targetId;
    let det = details;
    let overrideName = override_user_name;

    if (actionOrObj && typeof actionOrObj === 'object' && !Array.isArray(actionOrObj)) {
      action = actionOrObj.action;
      tId = actionOrObj.targetId ?? actionOrObj.target_id ?? null;
      det = actionOrObj.details ?? {};
      overrideName = actionOrObj.userName ?? actionOrObj.user_name ?? null;

      if (actionOrObj.source) det = { ...det, source: actionOrObj.source };
      if (actionOrObj.severity) det = { ...det, severity: actionOrObj.severity };
    }

    const normalizedAction = normalizeAction(action);
    if (!normalizedAction) return; 

    const ctx = pickBranchContext(det || {});

    const sourceCandidate = String(inferSource(det) || AUDIT_SOURCES.ADMIN_PANEL).toUpperCase();
    const severityCandidate = String(inferSeverity(normalizedAction, det) || AUDIT_SEVERITY.INFO).toUpperCase();

    const source = ALLOWED_SOURCES.has(sourceCandidate) ? sourceCandidate : AUDIT_SOURCES.ADMIN_PANEL;
    // 🚨 Ahora si la severidad inferida es válida, pasará el chequeo de la base de datos
    const severity = ALLOWED_SEVERITY.has(severityCandidate) ? severityCandidate : AUDIT_SEVERITY.INFO;

    const logData = {
      user_id: storedUser?.id || null,
      user_name: overrideName || storedUser?.name || 'Sistema/Anónimo',
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

    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .insert([logData])
        .select(
          'id,user_id,user_name,action,target_id,details,source,severity,branch_id,branch_name,device_name,input_method,created_at'
        )
        .single();

      if (error) {
          throw error;
      }

      set((state) => {
        const insertedRow = data || { ...logData, created_at: new Date().toISOString() };
        const next = [insertedRow, ...(state.auditLog || [])];
        localStorage.setItem(CACHE_KEYS.AUDIT, JSON.stringify(next.slice(0, 1000)));
        return { auditLog: next };
      });
    } catch (err) {
    }
  },

fetchAuditLogs: async (limit = 1000) => {
    const now = Date.now();
    // 🚨 Reducimos el bloqueo a 1.5s (Anti-spam de clics, pero permite navegación fluida)
    if (now - lastAuditFetchTime < 1500) return; 
    lastAuditFetchTime = now;

    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          'id,user_id,user_name,action,target_id,details,source,severity,branch_id,branch_name,device_name,input_method,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(limit);
        
      if (error) throw error; // Dispara el error para que el catch lo atrape

      set({ auditLog: data || [] });
      localStorage.setItem(CACHE_KEYS.AUDIT, JSON.stringify(data || []));
      
    } catch (err) {
      // 🚨 ALERTA CRÍTICA: Ahora el sistema te gritará si falta una columna en la DB
      console.error("🔥 Error crítico en fetchAuditLogs de Supabase:", err.message || err);
    }
  },
});