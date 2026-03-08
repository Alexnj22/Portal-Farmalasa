import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';

const KIOSK_LS_KEY = 'kiosk_config';

// 🚨 Sacamos esta función fuera del hook para usarla en el estado inicial
// y evitar el "parpadeo" de la UI al recargar la página.
const readLocalConfigSafe = () => {
  try {
    const raw = localStorage.getItem(KIOSK_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    
    // Flexibilizamos la validación inicial: solo requerimos branchId
    if (!parsed || !parsed.branchId) return null;
    
    return {
      branchId: String(parsed.branchId),
      branchName: parsed.branchName || null,
      deviceId: parsed.deviceId ? String(parsed.deviceId) : null,
      deviceToken: parsed.deviceToken ? String(parsed.deviceToken) : null,
      deviceName: parsed.deviceName || parsed.device_name || null,
    };
  } catch {
    return null;
  }
};

/**
 * ✅ useKioskDevice
 */
export default function useKioskDevice() {
  const branches = useStaff((s) => s.branches) || [];
  const validateKioskToken = useStaff((s) => s.validateKioskToken);

  // 🚨 Inicialización perezosa: El estado arranca con el valor real, cero parpadeos.
  const [kioskConfig, setKioskConfig] = useState(readLocalConfigSafe);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lastError, setLastError] = useState(null);

  // -----------------------------
  // Helpers
  // -----------------------------
  const writeLocalConfig = useCallback((config) => {
    if (!config) return;
    localStorage.setItem(KIOSK_LS_KEY, JSON.stringify(config));
    setKioskConfig(config);
  }, []);

  const revokeLocalConfig = useCallback(() => {
    localStorage.removeItem(KIOSK_LS_KEY);
    setKioskConfig(null);
  }, []);

  // Resolver branchName desde el store si falta o cambió en la base de datos
  const resolvedConfig = useMemo(() => {
    if (!kioskConfig) return null;
    
    const b = branches.find((x) => String(x.id || x.branchId) === String(kioskConfig.branchId));
    const branchName = b?.name || b?.branchName || kioskConfig.branchName || null;
    
    if (branchName === kioskConfig.branchName) return kioskConfig;
    return { ...kioskConfig, branchName };
  }, [kioskConfig, branches]);

  // Sincronizar el nombre resuelto con el estado y localStorage
  useEffect(() => {
    if (!resolvedConfig || !kioskConfig) return;
    if (resolvedConfig.branchName && resolvedConfig.branchName !== kioskConfig.branchName) {
      writeLocalConfig(resolvedConfig);
    }
  }, [resolvedConfig, kioskConfig, writeLocalConfig]);

  // -----------------------------
  // API pública
  // -----------------------------
  const verifyDevice = useCallback(async () => {
    setLastError(null);

    const local = readLocalConfigSafe();
    if (!local || !local.deviceId || !local.deviceToken) {
      revokeLocalConfig();
      return null;
    }

    if (typeof validateKioskToken !== 'function') {
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
  }, [branches, revokeLocalConfig, validateKioskToken, writeLocalConfig]);

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

  return {
    kioskConfig: resolvedConfig,
    isAuthorized: !!resolvedConfig,
    isVerifying,
    lastError,
    // actions
    verifyDevice,
    saveConfig,
    revokeConfig,
    readLocalConfig: readLocalConfigSafe, // Exportamos la versión segura
  };
}