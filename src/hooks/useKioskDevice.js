import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';

const KIOSK_LS_KEY = 'kiosk_config';
const EMPTY_BRANCHES = [];
// 7B.8: ventana de gracia — si la última verificación exitosa fue hace menos
// de esto, un error de RED (no una revocación real) no bloquea el kiosco.
const GRACE_MS = 15 * 60 * 1000;

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
      lastVerifiedAt: parsed.lastVerifiedAt || null,
    };
  } catch {
    return null;
  }
};

/**
 * ✅ useKioskDevice
 */
export default function useKioskDevice() {
  const branches = useStaff((s) => s.branches) || EMPTY_BRANCHES;
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
  // 7B.8: devuelve { config, networkError } en vez de solo config — un error
  // de red (RPC no pudo ejecutarse) ya NO se trata igual que una revocación
  // real. Dentro de la ventana de gracia, se sigue confiando en la última
  // config verificada con éxito en vez de bloquear el marcaje.
  const resolveCachedConfig = useCallback((local) => {
    const b = branches.find((x) => String(x.id || x.branchId) === String(local.branchId));
    return { ...local, branchName: b?.name || b?.branchName || local.branchName || null };
  }, [branches]);

  const verifyDevice = useCallback(async () => {
    setLastError(null);

    const local = readLocalConfigSafe();
    if (!local || !local.deviceId || !local.deviceToken) {
      revokeLocalConfig();
      return { config: null, networkError: false };
    }

    if (typeof validateKioskToken !== 'function') {
      setLastError('La función de validación no está disponible en el store.');
      return { config: null, networkError: false };
    }

    setIsVerifying(true);
    try {
      const result = await validateKioskToken(local.deviceId, local.deviceToken);

      if (result?.networkError) {
        setLastError('Sin conexión con el servidor de verificación.');
        const ageMs = local.lastVerifiedAt ? Date.now() - new Date(local.lastVerifiedAt).getTime() : Infinity;
        if (ageMs <= GRACE_MS) {
          return { config: resolveCachedConfig(local), networkError: true };
        }
        return { config: null, networkError: true };
      }

      if (!result?.authorized) {
        revokeLocalConfig();
        setLastError('Kiosco no autorizado o token revocado.');
        return { config: null, networkError: false };
      }

      // ✅ Autorizado — marca el momento de esta verificación real para la
      // ventana de gracia de la próxima vez.
      const next = { ...resolveCachedConfig(local), lastVerifiedAt: new Date().toISOString() };
      writeLocalConfig(next);
      return { config: next, networkError: false };
    } catch (e) {
      // No debería pasar (validateKioskToken captura sus propios errores),
      // pero por seguridad se trata igual que un error de red.
      setLastError(e?.message || 'Error verificando kiosco.');
      const ageMs = local.lastVerifiedAt ? Date.now() - new Date(local.lastVerifiedAt).getTime() : Infinity;
      if (ageMs <= GRACE_MS) {
        return { config: resolveCachedConfig(local), networkError: true };
      }
      return { config: null, networkError: true };
    } finally {
      setIsVerifying(false);
    }
  }, [resolveCachedConfig, revokeLocalConfig, validateKioskToken, writeLocalConfig]);

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