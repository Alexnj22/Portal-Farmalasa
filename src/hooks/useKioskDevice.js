import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';

// LocalStorage key (single source of truth)
const KIOSK_LS_KEY = 'kiosk_config';

/**
 * ✅ useKioskDevice
 *
 * Encapsula toda la lógica de:
 * - Leer / escribir configuración local del kiosco
 * - Verificar token contra Supabase
 * - Resolver nombre de sucursal desde el store
 * - Revocar permisos localmente
 */
export default function useKioskDevice() {
  const branches = useStaff((s) => s.branches) || [];
  const validateKioskToken = useStaff((s) => s.validateKioskToken);

  const [kioskConfig, setKioskConfig] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastError, setLastError] = useState(null);

  // -----------------------------
  // Helpers
  // -----------------------------
  const readLocalConfig = useCallback(() => {
    try {
      const raw = localStorage.getItem(KIOSK_LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      
      // Flexibilizamos la validación inicial: solo requerimos branchId para no romper configuraciones a medias
      if (!parsed || !parsed.branchId) return null;
      
      return {
        // Normalizamos a String para evitar fallos de comparación estricta (===)
        branchId: String(parsed.branchId),
        branchName: parsed.branchName || null,
        deviceId: parsed.deviceId ? String(parsed.deviceId) : null,
        deviceToken: parsed.deviceToken ? String(parsed.deviceToken) : null,
        deviceName: parsed.deviceName || parsed.device_name || null,
      };
    } catch {
      return null;
    }
  }, []);

  const writeLocalConfig = useCallback((config) => {
    if (!config) return;
    localStorage.setItem(KIOSK_LS_KEY, JSON.stringify(config));
    setKioskConfig(config);
  }, []);

  const revokeLocalConfig = useCallback(() => {
    localStorage.removeItem(KIOSK_LS_KEY);
    setKioskConfig(null);
  }, []);

  // Resolver branchName desde el store si falta o cambió
  const resolvedConfig = useMemo(() => {
    if (!kioskConfig) return null;
    
    // Buscamos la sucursal asegurando que ambos IDs sean String
    const b = branches.find((x) => String(x.id || x.branchId) === String(kioskConfig.branchId));
    
    // Soportamos name o branchName para alinearnos con los alias de App.jsx
    const branchName = b?.name || b?.branchName || kioskConfig.branchName || null;
    
    // Si ya coincide, retornamos igual; si no, retornamos versión "resuelta"
    if (branchName === kioskConfig.branchName) return kioskConfig;
    return { ...kioskConfig, branchName };
  }, [kioskConfig, branches]);

  // Persistimos el branchName resuelto una sola vez (sin loops)
  useEffect(() => {
    if (!resolvedConfig || !kioskConfig) return;
    if (resolvedConfig.branchName && resolvedConfig.branchName !== kioskConfig.branchName) {
      writeLocalConfig(resolvedConfig);
    }
  }, [resolvedConfig, kioskConfig, writeLocalConfig]);

  // Cargar config al montar
  useEffect(() => {
    const local = readLocalConfig();
    if (local) setKioskConfig(local);
  }, [readLocalConfig]);

  // -----------------------------
  // API pública
  // -----------------------------
  const verifyDevice = useCallback(async () => {
    setLastError(null);

    const local = readLocalConfig();
    if (!local || !local.deviceId || !local.deviceToken) {
      revokeLocalConfig();
      return null;
    }

    if (typeof validateKioskToken !== 'function') {
      // Si el slice aún no está listo o cambió de nombre
      setLastError('La función de validación no está disponible en el store.');
      return null;
    }

    setIsVerifying(true);
    try {
      const ok = await validateKioskToken(local.deviceId, local.deviceToken);
      if (!ok) {
        revokeLocalConfig();
        setLastError('Kiosco no autorizado o token revocado.');
        return null;
      }

      // ✅ Autorizado
      const b = branches.find((x) => String(x.id || x.branchId) === String(local.branchId));
      const next = { ...local, branchName: b?.name || b?.branchName || local.branchName || null };
      writeLocalConfig(next);
      return next;
    } catch (e) {
      setLastError(e?.message || 'Error verificando kiosco.');
      return null;
    } finally {
      setIsVerifying(false);
    }
  }, [branches, readLocalConfig, revokeLocalConfig, validateKioskToken, writeLocalConfig]);

  /**
   * Guardar configuración (cuando el usuario vincula el dispositivo)
   */
  const saveConfig = useCallback((config) => {
    setLastError(null);
    if (!config?.branchId) {
      setLastError('Configuración incompleta: Falta la sucursal.');
      return false;
    }
    const normalized = {
      branchId: String(config.branchId),
      branchName: config.branchName || null,
      deviceId: config.deviceId ? String(config.deviceId) : null,
      deviceToken: config.deviceToken ? String(config.deviceToken) : null,
      deviceName: config.deviceName || config.device_name || null,
    };
    writeLocalConfig(normalized);
    return true;
  }, [writeLocalConfig]);

  const revokeConfig = useCallback(() => {
    setLastError(null);
    revokeLocalConfig();
  }, [revokeLocalConfig]);

  const isAuthorized = !!resolvedConfig;

  return {
    kioskConfig: resolvedConfig,
    isAuthorized,
    isVerifying,
    lastError,

    // actions
    verifyDevice,
    saveConfig,
    revokeConfig,
    readLocalConfig,
  };
}