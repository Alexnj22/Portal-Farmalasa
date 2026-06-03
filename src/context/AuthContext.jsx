import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { CACHE_KEYS } from "../store/utils";
import { useStaffStore } from "../store/staffStore";

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return ctx;
};

const withTimeout = (promise, ms, label = "timeout") =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);

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
    const permsQuery = roleId
      ? supabase.from('role_permissions').select('module_key, can_view, can_edit, can_approve, scope').eq('role_id', roleId)
      : Promise.resolve({ data: [] });
    const priceLevelQuery = roleId
      ? supabase.from('roles').select('max_price_level, is_su').eq('id', roleId).single()
      : Promise.resolve({ data: null });

    Promise.all([permsQuery, priceLevelQuery])
      .then(([{ data, error }, { data: roleData }]) => {
        // No sobreescribir en error de red — conservar permisos previos
        if (error || !data) { setPermsLoading(false); return; }
        const map = {};
        data.forEach(p => {
          map[p.module_key] = { can_view: p.can_view, can_edit: p.can_edit, can_approve: p.can_approve, scope: p.scope || 'ALL' };
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
  }, [user?.id, user?.roleId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const channel = supabase
      .channel(`role_perms_${roleId}_${user?.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'role_permissions', filter: `role_id=eq.${roleId}` },
        () => refreshPermissions()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, user?.roleId, refreshPermissions]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const startIdleWatcher = (u) => {
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

        // Usuario con contraseña temporal: loginWithUsername maneja ese flujo
        const meta = session.user?.user_metadata;
        if (meta?.must_change_password !== false) {
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

        const u = ensured.user;
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
    if (!cleanId) return false;
    try {
      const { data: ensured, error: fnErr } = await supabase.functions.invoke('ensure_user_by_code', {
        body: { code: cleanId },
      });
      if (fnErr || !ensured?.ok || !ensured?.user?.email) return false;

      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: ensured.user.email,
        password: cleanId,
      });
      if (authErr || !authData?.session) return false;

      clearErpCache();
      writeLastActivity(true);
      return true;
      // El perfil llega vía onAuthStateChange
    } catch {
      return false;
    }
  };

  // -------------------------
  // 🔐 Login — Email + password
  // -------------------------
  const loginWithEmail = async (email, password) => {
    skipAuthListener.current = true;
    try {
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr || !authData?.session) {
        skipAuthListener.current = false;
        return false;
      }

      const sessionUser = authData.session.user;
      const code = (sessionUser.user_metadata?.code && String(sessionUser.user_metadata.code)) ||
        (sessionUser.email ? sessionUser.email.split('@')[0] : '');
      const cleanCode = String(code || '').trim().toUpperCase();
      if (!cleanCode) { skipAuthListener.current = false; return false; }

      const { data: ensured, error: fnErr } = await supabase.functions.invoke('ensure_user_by_code', {
        body: { code: cleanCode },
      });
      if (fnErr || !ensured?.ok || !ensured?.user) { skipAuthListener.current = false; return false; }

      const u = ensured.user;
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

      const { data, error } = await supabase.auth.signInWithPassword({ email: emailToLogin, password });

      if (error) {
        skipAuthListener.current = false;
        return error.message.includes('Invalid login credentials')
          ? { ok: false, error: 'Usuario no encontrado o contraseña incorrecta.' }
          : { ok: false, error: error.message };
      }

      if (!data?.session) {
        skipAuthListener.current = false;
        return { ok: false, error: 'Error de sesión. Intenta de nuevo.' };
      }

      const { data: emp, error: empError } = await supabase
        .from('employees_safe')
        .select('*')
        .eq('username', cleanUsername)
        .single();

      if (empError && empError.code !== 'PGRST116') {
        skipAuthListener.current = false;
        return { ok: false, error: 'Error de conexión. Intenta de nuevo.' };
      }
      if (!emp) {
        skipAuthListener.current = false;
        return { ok: false, error: 'Usuario no encontrado en el sistema.' };
      }

      const u = {
        id:         emp.id,
        name:       emp.name,
        code:       emp.code,
        username:   emp.username,
        branchId:   emp.branch_id,
        photo:      emp.photo_url,
        role:       emp.role_id,
        roleId:     emp.role_id ?? null,
        systemRole: emp.system_role || 'EMPLEADO',
      };

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
    } catch {
      skipAuthListener.current = false;
      return { ok: false, error: 'Error de conexión con el servidor.' };
    }
  };

  const completeLogin = (u) => {
    clearErpCache();
    localStorage.setItem(LS_USER, JSON.stringify(u));
    writeLastActivity(true);
    setPermsLoading(true);
    setUser(u);
    startIdleWatcher(u);
  };

  const completePasswordChange = (u) => {
    skipAuthListener.current = false;
    clearErpCache();
    localStorage.setItem(LS_USER, JSON.stringify(u));
    writeLastActivity(true);
    setPermsLoading(true);
    setUser(u);
    startIdleWatcher(u);
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
