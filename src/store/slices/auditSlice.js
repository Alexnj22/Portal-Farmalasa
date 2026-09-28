import { safeJsonParse, CACHE_KEYS } from '../utils';
import { anotar, escucharAnotaciones, fetchAuditLogs as fetchAuditLogsData } from '../../data/audit';
import * as almacen from '../../plataforma/almacen';

// ==========================================================
// 🔐 Auditoría PRO (sin IP)
// - Enviamos contexto rico: source, severity, branch/device
// - Mantiene compatibilidad con llamadas existentes
// - Sanitiza details (evita datos enormes / cíclicos)
// ==========================================================

let lastAuditFetchTime = 0;

export const createAuditSlice = (set) => {
  // Toda fila anotada —desde una pantalla o desde una función de datos— entra a
  // la lista local, que es la que muestra la bitácora sin volver a pedirla.
  escucharAnotaciones((fila) => set((state) => {
    const next = [fila, ...(state.auditLog || [])];
    almacen.guardar(CACHE_KEYS.AUDIT, JSON.stringify(next.slice(0, 1000)));
    return { auditLog: next };
  }));

  return {
  auditLog: safeJsonParse(almacen.leer(CACHE_KEYS.AUDIT), []) || [],

  setAuditLog: (updater) =>
    set((state) => {
      const next = typeof updater === 'function' ? updater(state.auditLog) : updater;
      return { auditLog: next };
    }),

  // Delega en `anotar` (src/data/audit.js), que es lo mismo que usan las
  // funciones de datos. La fila entra a la lista local por la escucha de arriba,
  // así que acá no se agrega a mano (se agregaría dos veces).
  appendAuditLog: async (actionOrObj, targetId = null, details = {}, override_user_name = null) => {
    const storedUser = safeJsonParse(almacen.leer('sb_user'));
    return anotar(actionOrObj, targetId, details, { nombre: override_user_name || storedUser?.name || null });
  },

  fetchAuditLogs: async (limit = 1000) => {
    const now = Date.now();
    // Reducimos el bloqueo a 1.5s (Anti-spam de clics, pero permite navegación fluida)
    if (now - lastAuditFetchTime < 1500) return; 
    lastAuditFetchTime = now;

    try {
      const { data, error } = await fetchAuditLogsData(limit);

      if (error) throw error; // Dispara el error para que el catch lo atrape

      set({ auditLog: data || [] });
      almacen.guardar(CACHE_KEYS.AUDIT, JSON.stringify(data || []));
      
    } catch (err) {
      // ALERTA CRÍTICA: Ahora el sistema te gritará si falta una columna en la DB
      console.error("🔥 Error crítico en fetchAuditLogs de Supabase:", err.message || err);
    }
  },
};
};
