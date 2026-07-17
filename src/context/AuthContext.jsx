import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { CACHE_KEYS } from "../store/utils";
import { useStaffStore } from "../store/staffStore";
import { getSignedFileUrl } from "../utils/storageFiles";
import { fetchRolePermissionsForRoles, fetchRolePriceLevelAndSU } from "../data/permissions";
import { fetchEmployeeSafeByUsername } from "../data/auth";

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components -- patrón estándar de contexto+hook; separar useAuth a otro archivo tocaría decenas de imports para una mejora de solo Fast Refresh en dev
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return ctx;
};

const withTimeout = (promise, ms, label = "timeout") =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);

// Transient DNS/network failures (ERR_NAME_NOT_RESOLVED, etc.) surface as "Failed to fetch"
// from the browser's fetch API, regardless of which Supabase client (auth/postgrest/functions) made the call.
const NETWORK_ERROR_MSG = 'No se pudo conectar a internet. Revisa tu WiFi/datos e intenta de nuevo.';
const isNetworkError = (err) => {
  if (!err) return false;
  const text = String(err.message || err.name || '');
  return err.name === 'AuthRetryableFetchError' || /Failed to fetch|NetworkError|Load failed/i.test(text);
};
// Retries a Supabase call ({data,error} shape) up to `attempts` times when the failure
// looks like a transient network blip — most DNS/connectivity hiccups clear within a couple seconds.
const withNetworkRetry = async (fn, attempts = 3, delayMs = 1200) => {
  let result;
  for (let i = 0; i < attempts; i++) {
    result = await fn();
    if (!isNetworkError(result?.error)) return result;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return result;
};

// El bucket de fotos de empleados es privado: `photo` lleva URL firmada (7d)
// y `photoRaw` conserva el identificador crudo para poder re-firmar al arrancar
// desde caché sin red round-trip al perfil.
const withSignedPhoto = async (u) => {
  if (!u) return u;
  const raw = u.photoRaw || u.photo;
  if (!raw) return u;
  try {
    const signed = await getSignedFileUrl(raw, 604800);
    return { ...u, photo: signed || raw, photoRaw: raw };
  } catch {
    return { ...u, photoRaw: raw };
  }
};

// -------------------------
// ⏱️ Configuraciones de Sesión e Inactividad
// -------------------------
const LS_USER  = "sb_user";
const LS_LAST  = "sb_last_activity_at";
const LS_PERMS = "sb_role_perms";
const LS_PRICE = "sb_max_price_level";

const ERP_CACHE_KEYS = [
  CACHE_KEYS.BRANCHES,
  CACHE_KEYS.EMPLOYEES,
  CACHE_KEYS.SHIFTS,
  CACHE_KEYS.ROLES,
  CACHE_KEYS.ANNOUNCEMENTS,
  CACHE_KEYS.AUDIT,
  CACHE_KEYS.AT,
];

const IDLE_EMP_MS   = 5 * 60 * 1000;
const IDLE_ADMIN_MS = 12 * 60 * 60 * 1000;
const IDLE_MOBILE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — PWA / mobile browser
const CHECK_EVERY_MS        = 30 * 1000;
const ACTIVITY_THROTTLE_MS  = 2000;

// True when running as installed PWA (standalone) or any mobile browser.
const IS_MOBILE_SESSION = (() => {
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return standalone || mobile;
  } catch { return false; }
})();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rolePerms, setRolePerms] = useState(null);
  const [permsLoading, setPermsLoading] = useState(false);
  const [maxPriceLevel, setMaxPriceLevel] = useState(null);

  const idleIntervalRef  = useRef(null);
  const lastWriteRef     = useRef(0);
  const aliveRef         = useRef(true);
  const userRef          = useRef(null);
  const skipAuthListener = useRef(false);

  useEffect(() => { userRef.current = user; }, [user]);

  // -------------------------
  // 🔑 Permisos de rol
  // -------------------------
  const refreshPermissions = useCallback((currentUser) => {
    const u = currentUser ?? userRef.current;
    if (!u) { setRolePerms(null); setPermsLoading(false); setMaxPriceLevel(null); return; }

    const roleId = u.roleId ?? (Number.isInteger(u.role) ? u.role : null);
    const secondaryRoleId = Number.isInteger(u.secondaryRoleId) ? u.secondaryRoleId : null;
    const roleIds = [roleId, secondaryRoleId].filter(Number.isInteger);
    const permsQuery = roleIds.length
      ? fetchRolePermissionsForRoles(roleIds)
      : Promise.resolve({ data: [] });
    const priceLevelQuery = roleId
      ? fetchRolePriceLevelAndSU(roleId)
      : Promise.resolve({ data: null });

    Promise.all([permsQuery, priceLevelQuery])
      .then(([{ data, error }, { data: roleData }]) => {
        // No sobreescribir en error de red — conservar permisos previos
        if (error || !data) { setPermsLoading(false); return; }
        // Bloque 8 — modelo de unión: el permiso efectivo por module_key es el OR
        // entre lo que da el rol primario y lo que da el secundario (si existe);
        // el secundario rellena lo que le falta al primario, nunca lo reemplaza.
        // Empate de scope: gana el más permisivo ('ALL').
        const map = {};
        data.forEach(p => {
          const prev = map[p.module_key];
          if (!prev) {
            map[p.module_key] = { can_view: p.can_view, can_edit: p.can_edit, can_approve: p.can_approve, scope: p.scope || 'ALL' };
          } else {
            map[p.module_key] = {
              can_view: prev.can_view || p.can_view,
              can_edit: prev.can_edit || p.can_edit,
              can_approve: prev.can_approve || p.can_approve,
              scope: (prev.scope === 'ALL' || p.scope === 'ALL') ? 'ALL' : (prev.scope || p.scope || 'ALL'),
            };
          }
        });
        const price = roleData?.max_price_level ?? null;
        const isSU  = roleData?.is_su ?? false;
        setRolePerms(map);
        setMaxPriceLevel(price);
        // Persist isSU on user object so idle-timeout survives page reload from cache
        setUser(prev => {
          if (!prev || prev.isSU === isSU) return prev;
          const updated = { ...prev, isSU };
          try { localStorage.setItem(LS_USER, JSON.stringify(updated)); } catch { /* ignore */ }
          return updated;
        });
        setPermsLoading(false);
        try {
          localStorage.setItem(LS_PERMS, JSON.stringify(map));
          localStorage.setItem(LS_PRICE, JSON.stringify(price));
        } catch { /* storage lleno — ignorar */ }
      })
      .catch(() => { setPermsLoading(false); });
  }, []);

  // Dispara refresh cuando cambia el usuario (id, rol o systemRole)
  // user?.role excluido a propósito: loginWithUsername pone el número, la edge function el nombre
  // — ambos casos tienen roleId correcto, no queremos doble refresh.
  useEffect(() => {
    refreshPermissions(user);
  }, [user?.id, user?.roleId, user?.secondaryRoleId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresca permisos solo al VOLVER a la pestaña (no al ocultarla)
  useEffect(() => {
    const onVisible = () => {
      if (userRef.current && document.visibilityState === 'visible') refreshPermissions();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshPermissions]);

  // Realtime: refresca permisos en el instante que el admin cambia role_permissions
  // del rol del usuario actual — menú y PermissionGuard reaccionan sin recargar.
  useEffect(() => {
    const roleId = user?.roleId ?? (Number.isInteger(user?.role) ? user?.role : null);
    if (!roleId) return;
    const secondaryRoleId = Number.isInteger(user?.secondaryRoleId) ? user.secondaryRoleId : null;
    const filter = secondaryRoleId
      ? `role_id=in.(${roleId},${secondaryRoleId})`
      : `role_id=eq.${roleId}`;
    const channel = supabase
      .channel(`role_perms_${roleId}_${secondaryRoleId ?? 'x'}_${user?.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'role_permissions', filter },
        () => refreshPermissions()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.roleId, user?.secondaryRoleId, refreshPermissions]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------
  // ⏱️ Inactividad
  // -------------------------
  const getIdleLimitMs = (u) => {
    if (IS_MOBILE_SESSION) return IDLE_MOBILE_MS;
    if (u?.isSU) return IDLE_ADMIN_MS;
    try {
      const cached = localStorage.getItem(LS_PERMS);
      if (cached) {
        const perms = JSON.parse(cached);
        const mgmt = ['staff_list','schedules','monitor','requests','time_audit','permissions','announcements'];
        if (mgmt.some(m => perms[m]?.can_view)) return IDLE_ADMIN_MS;
      }
    } catch { /* corrupt cache */ }
    return IDLE_EMP_MS;
  };

  const writeLastActivity = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastWriteRef.current = now;
    localStorage.setItem(LS_LAST, String(now));
  };

  const onActivity = useCallback(() => { if (userRef.current) writeLastActivity(false); }, []);

  const onVisibilityChange = useCallback(() => {
    if (!userRef.current) return;
    if (document.visibilityState === 'visible') writeLastActivity(true);
  }, []);

  const stopIdleWatcher = () => {
    if (idleIntervalRef.current) { clearInterval(idleIntervalRef.current); idleIntervalRef.current = null; }
    window.removeEventListener('mousemove',   onActivity, true);
    window.removeEventListener('keydown',     onActivity, true);
    window.removeEventListener('wheel',       onActivity, true);
    window.removeEventListener('click',       onActivity, true);
    window.removeEventListener('touchstart',  onActivity, true);
    document.removeEventListener('visibilitychange', onVisibilityChange, true);
  };

  const clearErpCache  = () => ERP_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
  const clearAuthCache = () => {
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_LAST);
    localStorage.removeItem(LS_PERMS);
    localStorage.removeItem(LS_PRICE);
  };

  const doLogout = () => {
    stopIdleWatcher();
    clearAuthCache();
    clearErpCache();
    setUser(null);
    setRolePerms(null);
    setPermsLoading(false);
    setMaxPriceLevel(null);
    useStaffStore.getState().resetBootState();
    supabase.auth.signOut().catch(() => {});
  };

  const isExpiredByIdle = (u) => {
    const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
    if (!last || last > Date.now()) return false;
    if (Date.now() - last < 5000) return false;
    return Date.now() - last >= getIdleLimitMs(u);
  };

  const startIdleWatcher = () => {
    stopIdleWatcher();
    if (!localStorage.getItem(LS_LAST)) writeLastActivity(true);

    window.addEventListener('mousemove',  onActivity, true);
    window.addEventListener('keydown',    onActivity, true);
    window.addEventListener('wheel',      onActivity, true);
    window.addEventListener('click',      onActivity, true);
    window.addEventListener('touchstart', onActivity, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);

    idleIntervalRef.current = setInterval(() => {
      // Skip while app is backgrounded — prevents iOS from firing stale checks
      // on resume before visibilitychange can refresh the activity timestamp.
      if (document.visibilityState === 'hidden') return;
      const last = parseInt(localStorage.getItem(LS_LAST) || '0', 10);
      if (!last) return;
      // Re-read limit each tick so it reflects permissions loaded after login.
      if (Date.now() - last >= getIdleLimitMs(userRef.current)) doLogout();
    }, CHECK_EVERY_MS);
  };

  // -------------------------
  // ✅ Boot: cache local instantáneo
  // -------------------------
  useEffect(() => {
    const cached = localStorage.getItem(LS_USER);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (isExpiredByIdle(parsed)) {
          clearAuthCache();
          clearErpCache();
        } else {
          // Load cached perms instantly — avoids the network round-trip that
          // previously blocked the UI with permsLoading=true on every page load.
          // refreshPermissions() will update them silently in the background.
          const cachedPerms = localStorage.getItem(LS_PERMS);
          if (cachedPerms) {
            try {
              setRolePerms(JSON.parse(cachedPerms));
              const cachedPrice = localStorage.getItem(LS_PRICE);
              setMaxPriceLevel(cachedPrice ? JSON.parse(cachedPrice) : null);
              // permsLoading stays false — cached perms are ready immediately
            } catch {
              setPermsLoading(true); // corrupt cache — fall back to network
            }
          } else {
            setPermsLoading(true); // first login — must fetch from network
          }
          setUser(parsed);
          startIdleWatcher(parsed);
          // Re-firmar la foto (la firmada cacheada puede haber expirado)
          if (parsed.photoRaw) {
            getSignedFileUrl(parsed.photoRaw, 604800).then((signed) => {
              if (signed && signed !== parsed.photo) {
                setUser(prev => {
                  if (!prev) return prev;
                  const updated = { ...prev, photo: signed };
                  try { localStorage.setItem(LS_USER, JSON.stringify(updated)); } catch { /* ignore */ }
                  return updated;
                });
              }
            }).catch(() => {});
          }
        }
      } catch {
        clearAuthCache();
        clearErpCache();
      }
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // ✅ Validación de sesión + listener de estado
  // -------------------------
  useEffect(() => {
    aliveRef.current = true;

    // Solo verifica que la sesión sigue activa.
    // onAuthStateChange (INITIAL_SESSION) maneja el refresh de perfil.
    // Duplicar ensure_user_by_code aquí generaría el doble de llamadas a la edge function.
    const validateSession = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 3500, 'getSession timeout');
        if (!aliveRef.current) return;
        if (!data?.session?.user && userRef.current) doLogout();
      } catch {
        // Red inestable → confiamos en el cache local
      }
    };

    validateSession();

    // Listener maestro: INITIAL_SESSION, TOKEN_REFRESHED, SIGNED_OUT
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (skipAuthListener.current) return;

        if (event === 'SIGNED_OUT' || !session?.user) {
          stopIdleWatcher();
          clearAuthCache();
          clearErpCache();
          setUser(null);
          return;
        }

        // Usuario con contraseña temporal: loginWithUsername maneja ese flujo.
        // Las cuentas kiosk/carné (@staff.local) no usan contraseña personal — se exentan.
        const meta = session.user?.user_metadata;
        if (!meta?.kiosk && meta?.must_change_password !== false) {
          clearAuthCache();
          clearErpCache();
          return;
        }

        const code = meta?.code || (session.user.email ? session.user.email.split('@')[0] : '');
        const cleanCode = String(code || '').trim().toUpperCase();
        if (!cleanCode) return;

        const { data: ensured, error: fnErr } = await withTimeout(
          supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanCode } }),
          5000,
          'ensure_user_by_code timeout',
        );

        if (fnErr || !ensured?.ok || !ensured?.user) return;

        const u = await withSignedPhoto(ensured.user);
        if (isExpiredByIdle(u)) { doLogout(); return; }

        setUser(u);
        localStorage.setItem(LS_USER, JSON.stringify(u));
        startIdleWatcher(u);
        refreshPermissions(u);
      } catch {
        // silencioso
      }
    });

    return () => {
      aliveRef.current = false;
      sub?.subscription?.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // 🔐 Login — Kiosk (por código/PIN)
  // -------------------------
  const login = async (identifier) => {
    const cleanId = String(identifier ?? '').trim().toUpperCase();
    if (!cleanId) return { ok: false };
    skipAuthListener.current = true;
    try {
      const { data: ensured, error: fnErr } = await withNetworkRetry(() =>
        supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanId } })
      );
      if (isNetworkError(fnErr)) return { ok: false, error: NETWORK_ERROR_MSG };
      if (fnErr || !ensured?.ok || !ensured?.user?.email) return { ok: false };

      const { data: authData, error: authErr } = await withNetworkRetry(() =>
        supabase.auth.signInWithPassword({ email: ensured.user.email, password: cleanId })
      );
      if (isNetworkError(authErr)) return { ok: false, error: NETWORK_ERROR_MSG };
      if (authErr || !authData?.session) return { ok: false };

      // Segunda llamada (ya autenticada): devuelve el perfil completo y sincroniza
      // metadata del JWT. Completar aquí mismo evita depender del listener.
      const { data: profile, error: profErr } = await withNetworkRetry(() =>
        supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanId } })
      );
      if (isNetworkError(profErr)) return { ok: false, error: NETWORK_ERROR_MSG };
      if (profErr || !profile?.ok || !profile?.user?.id) return { ok: false };

      completeLogin(profile.user);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: isNetworkError(err) ? NETWORK_ERROR_MSG : undefined };
    } finally {
      skipAuthListener.current = false;
    }
  };

  // -------------------------
  // 🔐 Login — Email + password
  // -------------------------
  const loginWithEmail = async (email, password) => {
    skipAuthListener.current = true;
    try {
      const { data: authData, error: authErr } = await withNetworkRetry(() =>
        supabase.auth.signInWithPassword({ email, password })
      );
      if (authErr || !authData?.session) {
        skipAuthListener.current = false;
        return false;
      }

      const sessionUser = authData.session.user;
      const code = (sessionUser.user_metadata?.code && String(sessionUser.user_metadata.code)) ||
        (sessionUser.email ? sessionUser.email.split('@')[0] : '');
      const cleanCode = String(code || '').trim().toUpperCase();
      if (!cleanCode) { skipAuthListener.current = false; return false; }

      const { data: ensured, error: fnErr } = await withNetworkRetry(() =>
        supabase.functions.invoke('ensure_user_by_code', { body: { code: cleanCode } })
      );
      if (fnErr || !ensured?.ok || !ensured?.user) { skipAuthListener.current = false; return false; }

      const u = await withSignedPhoto(ensured.user);
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);
      setPermsLoading(true);
      setUser(u);
      startIdleWatcher(u);
      skipAuthListener.current = false;
      return true;
    } catch {
      skipAuthListener.current = false;
      return false;
    }
  };

  // -------------------------
  // 🔐 Login — Username + password (portal principal)
  // -------------------------
  const loginWithUsername = async (username, password) => {
    skipAuthListener.current = true;
    try {
      const cleanUsername = username.toLowerCase().trim();
      const emailToLogin  = `${cleanUsername}@farmalasa.app`;

      const { data, error } = await withNetworkRetry(() =>
        supabase.auth.signInWithPassword({ email: emailToLogin, password })
      );

      if (error) {
        skipAuthListener.current = false;
        if (isNetworkError(error)) return { ok: false, error: NETWORK_ERROR_MSG };
        return error.message.includes('Invalid login credentials')
          ? { ok: false, error: 'Usuario no encontrado o contraseña incorrecta.' }
          : { ok: false, error: error.message };
      }

      if (!data?.session) {
        skipAuthListener.current = false;
        return { ok: false, error: 'Error de sesión. Intenta de nuevo.' };
      }

      const { data: emp, error: empError } = await withNetworkRetry(() =>
        fetchEmployeeSafeByUsername(cleanUsername)
      );

      if (empError && empError.code !== 'PGRST116') {
        skipAuthListener.current = false;
        if (isNetworkError(empError)) return { ok: false, error: NETWORK_ERROR_MSG };
        return { ok: false, error: 'Error de conexión. Intenta de nuevo.' };
      }
      if (!emp) {
        skipAuthListener.current = false;
        return { ok: false, error: 'Usuario no encontrado en el sistema.' };
      }

      // Empleado dado de baja: la cuenta Auth queda baneada por disable-employee-auth,
      // pero este gate cubre bajas previas al ban y cierra la sesión recién creada.
      if (emp.status && emp.status !== 'ACTIVO') {
        skipAuthListener.current = false;
        supabase.auth.signOut().catch(() => {});
        return { ok: false, error: 'Tu cuenta está desactivada. Contacta a Recursos Humanos.' };
      }

      const u = await withSignedPhoto({
        id:         emp.id,
        name:       emp.name,
        code:       emp.code,
        username:   emp.username,
        branchId:   emp.branch_id,
        photo:      emp.photo_url,
        role:       emp.role_id,
        roleId:     emp.role_id ?? null,
        secondaryRoleId: emp.secondary_role_id ?? null,
        systemRole: emp.system_role || 'EMPLEADO',
      });

      const meta       = data.session.user?.user_metadata;
      const mustChange = meta?.must_change_password !== false;

      if (mustChange) {
        // skipAuthListener se mantiene true hasta que completePasswordChange lo restaure
        return { ok: true, mustChangePassword: true, user: u };
      }

      skipAuthListener.current = false;
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);
      setPermsLoading(true);
      setUser(u);
      startIdleWatcher(u);
      return { ok: true };
    } catch (err) {
      skipAuthListener.current = false;
      return { ok: false, error: isNetworkError(err) ? NETWORK_ERROR_MSG : 'Error de conexión con el servidor.' };
    }
  };

  const completeLogin = async (u) => {
    const su = await withSignedPhoto(u);
    clearErpCache();
    localStorage.setItem(LS_USER, JSON.stringify(su));
    writeLastActivity(true);
    setPermsLoading(true);
    setUser(su);
    startIdleWatcher(su);
  };

  const completePasswordChange = async (u) => {
    const su = await withSignedPhoto(u);
    skipAuthListener.current = false;
    clearErpCache();
    localStorage.setItem(LS_USER, JSON.stringify(su));
    writeLastActivity(true);
    setPermsLoading(true);
    setUser(su);
    startIdleWatcher(su);
  };

  const logout = async () => doLogout();

  // -------------------------
  // 📦 Contexto expuesto
  // -------------------------
  const value = useMemo(() => {
    const isSU = !!user?.isSU;

    const getScope = (moduleKey) => rolePerms?.[moduleKey]?.scope ?? 'ALL';

    const hasPermission = (moduleKey, action = 'can_view') => {
      if (isSU) return true;
      if (!rolePerms) return false;
      return !!(rolePerms[moduleKey]?.[action]);
    };

    return {
      user, isAuthenticated: !!user,
      isSU, getScope,
      rolePerms, permsLoading, hasPermission,
      maxPriceLevel, loading,
      completeLogin, completePasswordChange,
      login, loginWithEmail, loginWithUsername, logout,
      refreshPermissions,
    };
  }, [user, loading, rolePerms, refreshPermissions]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
