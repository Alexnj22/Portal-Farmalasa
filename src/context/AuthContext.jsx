import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { CACHE_KEYS } from "../store/utils";

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
const LS_USER = "sb_user";
const LS_LAST = "sb_last_activity_at";

const ERP_CACHE_KEYS = [
  CACHE_KEYS.BRANCHES,
  CACHE_KEYS.EMPLOYEES,
  CACHE_KEYS.SHIFTS,
  CACHE_KEYS.ROLES,
  CACHE_KEYS.ANNOUNCEMENTS,
  CACHE_KEYS.AUDIT,
  CACHE_KEYS.AT,
];

const IDLE_EMP_MS = 5 * 60 * 1000;       
const IDLE_ADMIN_MS = 12 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 30 * 1000;          
const ACTIVITY_THROTTLE_MS = 2000;         

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rolePerms, setRolePerms] = useState(null); // { module_key: { can_view, can_edit, can_approve } }
  const [permsLoading, setPermsLoading] = useState(false);

  const idleIntervalRef = useRef(null);
  const lastWriteRef = useRef(0);
  const aliveRef = useRef(true);
  const userRef = useRef(null);
  const skipAuthListener = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Carga permisos del rol cuando el usuario cambia
  useEffect(() => {
    if (!user) { setRolePerms(null); setPermsLoading(false); return; }
    const systemRole = user.systemRole || 'EMPLEADO';
    // SUPERADMIN tiene acceso total hardcoded — no necesita DB
    if (systemRole === 'SUPERADMIN') {
      setRolePerms('ALL');
      setPermsLoading(false);
      return;
    }
    setRolePerms(null);
    setPermsLoading(true);
    // user.roleId: campo explícito del Edge Function (nuevo)
    // user.role como integer: viene de loginWithUsername
    // user.role como string (nombre del cargo): versión vieja del Edge Function — no sirve como ID
    const roleId = user.roleId ?? (Number.isInteger(user.role) ? user.role : null);
    const query = roleId
      ? supabase.from('role_permissions').select('module_key, can_view, can_edit, can_approve').eq('role_id', roleId)
      : supabase.from('role_permissions').select('module_key, can_view, can_edit, can_approve').eq('system_role', systemRole);
    query.then(({ data }) => {
      const map = {};
      (data || []).forEach(p => { map[p.module_key] = { can_view: p.can_view, can_edit: p.can_edit, can_approve: p.can_approve }; });
      setRolePerms(map);
      setPermsLoading(false);
    });
  }, [user?.id, user?.roleId, user?.role, user?.systemRole]);

  // -------------------------
  // Helpers de Inactividad
  // -------------------------
  const getIdleLimitMs = (u) => (u?.isAdmin || u?.is_admin ? IDLE_ADMIN_MS : IDLE_EMP_MS);

  const writeLastActivity = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastWriteRef.current = now;
    localStorage.setItem(LS_LAST, String(now));
  };

  const onActivity = () => {
    if (!userRef.current) return;
    writeLastActivity(false);
  };

  const onVisibilityChange = () => {
    if (!userRef.current) return;
    if (document.visibilityState === "visible") writeLastActivity(true);
  };

  const stopIdleWatcher = () => {
    if (idleIntervalRef.current) {
      clearInterval(idleIntervalRef.current);
      idleIntervalRef.current = null;
    }
    window.removeEventListener("mousemove", onActivity, true);
    window.removeEventListener("keydown", onActivity, true);
    window.removeEventListener("wheel", onActivity, true);
    window.removeEventListener("click", onActivity, true);
    window.removeEventListener("touchstart", onActivity, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
  };

  const clearErpCache = () => {
    ERP_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
  };

  const clearAuthCache = () => {
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_LAST);
  };

  // 🚨 LOGOUT FLUIDO (OPTIMISTIC UI)
  const doLogout = (reason = "LOGOUT") => {
    // 1. Detenemos los relojes de inmediato
    stopIdleWatcher();

    // 2. Limpiamos la memoria local
    clearAuthCache();
    clearErpCache();

    // 3. Vaciamos el usuario — React Router redirige a /login al instante
    setUser(null);
    setRolePerms(null);
    setPermsLoading(false);

    // 4. Supabase signOut en background — no bloqueamos la UI
    supabase.auth.signOut().catch(() => {});
  };

  const isExpiredByIdle = (u) => {
    const last = parseInt(localStorage.getItem(LS_LAST) || "0", 10);
    if (!last || last > Date.now()) return false;
    if (Date.now() - last < 5000) return false;
    return Date.now() - last >= getIdleLimitMs(u);
  };

  const startIdleWatcher = (u) => {
    stopIdleWatcher();

    if (!localStorage.getItem(LS_LAST)) writeLastActivity(true);

    window.addEventListener("mousemove", onActivity, true);
    window.addEventListener("keydown", onActivity, true);
    window.addEventListener("wheel", onActivity, true);
    window.addEventListener("click", onActivity, true);
    window.addEventListener("touchstart", onActivity, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);

    const limit = getIdleLimitMs(u);

    idleIntervalRef.current = setInterval(() => {
      const last = parseInt(localStorage.getItem(LS_LAST) || "0", 10);
      if (!last) return;

      const diff = Date.now() - last;
      if (diff >= limit) {
          doLogout("IDLE_TIMEOUT");
      }
    }, CHECK_EVERY_MS);
  };

  // -------------------------
  // ✅ Boot Inicial: Verificación local ultrarrápida
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
          setPermsLoading(true);
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
  // ✅ Rehidratación de Supabase (Sincronización de fondo)
  // -------------------------
  useEffect(() => {
    aliveRef.current = true;

    const rehydrate = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 3500, "getSession timeout");
        if (!aliveRef.current) return;

        const sessionUser = data?.session?.user;
        if (!sessionUser) return; // Si no hay sesión válida, onAuthStateChange se encargará

        const code =
          (sessionUser.user_metadata?.code && String(sessionUser.user_metadata.code)) ||
          (sessionUser.email ? String(sessionUser.email).split("@")[0] : "") ||
          "";

        const cleanCode = code.trim().toUpperCase();
        if (!cleanCode) return;

        const { data: ensured, error: fnErr } = await withTimeout(
          supabase.functions.invoke("ensure_user_by_code", { body: { code: cleanCode } }),
          5000,
          "ensure_user_by_code timeout"
        );

        if (!aliveRef.current) return;
        if (fnErr || !ensured?.ok || !ensured?.user) return;

        const u = ensured.user;

        // No restaurar sesión si debe cambiar contraseña
        const meta = sessionUser?.user_metadata;
        const mustChange = meta?.must_change_password !== false;
        if (mustChange) return;

        writeLastActivity(true);

        if (isExpiredByIdle(u)) {
          doLogout("REHYDRATE_IDLE_EXPIRED");
          return;
        }

        setPermsLoading(true);
        setUser(u);
        localStorage.setItem(LS_USER, JSON.stringify(u));
        startIdleWatcher(u);
      } catch {
        // Silencioso, seguimos confiando en el caché local
      }
    };

    rehydrate();

    // 🚨 Listener Maestro de Estado de Sesión
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        if (skipAuthListener.current) return;

        // Si el evento es SIGNED_OUT o ya no hay sesión (ej. en otra pestaña)
        if (event === 'SIGNED_OUT' || !session?.user) {
          stopIdleWatcher();
          clearAuthCache();
          clearErpCache();
          setUser(null); // Esto causará un redirect súper fluido al login
          return;
        }

        // Verificar must_change_password ANTES de setUser
        const meta = session.user?.user_metadata;
        const mustChange = meta?.must_change_password !== false;
        if (mustChange) {
          // Usuario con contraseña temporal — limpiar caché, no setUser
          // loginWithUsername se encarga del flujo de cambio de contraseña
          clearAuthCache();
          clearErpCache();
          return;
        }

        const code =
          session.user.user_metadata?.code ||
          (session.user.email ? session.user.email.split("@")[0] : "");

        const cleanCode = String(code || "").trim().toUpperCase();
        if (!cleanCode) return;

        const { data: ensured, error: fnErr } = await withTimeout(
          supabase.functions.invoke("ensure_user_by_code", { body: { code: cleanCode } }),
          5000,
          "ensure_user_by_code timeout"
        );

        if (fnErr || !ensured?.ok || !ensured?.user) return;

        const u = ensured.user;

        if (isExpiredByIdle(u)) {
          doLogout("AUTHCHANGE_IDLE_EXPIRED");
          return;
        }

        setPermsLoading(true);
        setUser(u);
        localStorage.setItem(LS_USER, JSON.stringify(u));
        startIdleWatcher(u);
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
  // ✅ Proceso de Login Centralizado
  // -------------------------
  const login = async (identifier) => {
    const cleanId = String(identifier ?? "").trim().toUpperCase();
    if (!cleanId) return false;

    try {
      const { data: ensured, error: fnErr } = await supabase.functions.invoke("ensure_user_by_code", {
        body: { code: cleanId },
      });

      if (fnErr || !ensured?.ok || !ensured?.user) return false;

      const u = ensured.user;
      const email = u.email || `${cleanId}@staff.local`;
      const password = cleanId;

      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authErr || !authData?.session) return false;

      // 🚨 FLUIDEZ: Limpiamos caché viejo, guardamos nuevo, actualizamos el state y devolvemos true INMEDIATAMENTE
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);

      setPermsLoading(true);
      setUser(u);
      startIdleWatcher(u);

      return true;
    } catch (e) {
        return false;
    }
  };

  const loginWithEmail = async (email, password) => {
    try {
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr || !authData?.session) return false;

      const sessionUser = authData.session.user;
      const code =
        (sessionUser.user_metadata?.code && String(sessionUser.user_metadata.code)) ||
        (sessionUser.email ? sessionUser.email.split("@")[0] : "");
      const cleanCode = String(code || "").trim().toUpperCase();
      if (!cleanCode) return false;

      const { data: ensured, error: fnErr } = await supabase.functions.invoke("ensure_user_by_code", {
        body: { code: cleanCode },
      });
      if (fnErr || !ensured?.ok || !ensured?.user) return false;

      const u = ensured.user;
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);
      setPermsLoading(true);
      setUser(u);
      startIdleWatcher(u);
      return true;
    } catch {
      return false;
    }
  };
  const loginWithUsername = async (username, password) => {
    try {
      const cleanUsername = username.toLowerCase().trim();
      const emailToLogin = `${cleanUsername}@farmalasa.app`;

      // Bloquear onAuthStateChange hasta saber si debe cambiar contraseña
      skipAuthListener.current = true;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailToLogin,
        password,
      });

      if (error) {
        skipAuthListener.current = false;
        if (error.message.includes('Invalid login credentials')) {
          return { ok: false, error: 'Usuario no encontrado o contraseña incorrecta.' };
        }
        return { ok: false, error: error.message };
      }

      if (!data?.session) return { ok: false, error: 'Error de sesión. Intenta de nuevo.' };

      const { data: emp } = await supabase
        .from('employees_safe')
        .select('*')
        .eq('username', cleanUsername)
        .single();

      if (!emp) return { ok: false, error: 'Usuario no encontrado en el sistema.' };

      const u = {
        id: emp.id,
        name: emp.name,
        code: emp.code,
        username: emp.username,
        branchId: emp.branch_id,
        photo: emp.photo_url,
        isAdmin: emp.is_admin === true,
        userType: emp.is_admin ? 'admin' : 'employee',
        role: emp.role_id,
        roleId: emp.role_id ?? null,
        systemRole: emp.system_role || 'EMPLEADO',
      };

      const meta = data.session.user?.user_metadata;
      const mustChange = meta?.must_change_password !== false;

      if (mustChange) {
        // No llamar setUser — LoginView lo hace después del cambio de contraseña
        return { ok: true, mustChangePassword: true, user: u };
      }

      // Flujo normal: resetear flag y completar login
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

  const logout = async () => {
    await doLogout("MANUAL_LOGOUT");
  };

  // ✅ Exposición de valores
  const value = useMemo(() => {
    const systemRole = user?.systemRole || 'EMPLEADO';
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(systemRole)
      || user?.isAdmin === true || user?.is_admin === true || user?.userType === 'admin';
    const isJefe = ['JEFE', 'SUBJEFE'].includes(systemRole);
    const isSupervisor = systemRole === 'SUPERVISOR';
    const canApprove = ['ADMIN', 'SUPERADMIN', 'SUPERVISOR', 'JEFE', 'SUBJEFE'].includes(systemRole);
    // hasPermission('requests', 'can_approve') → true/false
    const hasPermission = (moduleKey, action = 'can_view') => {
      if (rolePerms === 'ALL') return true;
      if (!rolePerms) return false; // mientras carga, negar todo
      return !!(rolePerms[moduleKey]?.[action]);
    };

    return {
      user,
      isAuthenticated: !!user,
      isAdmin,
      isJefe,
      isSupervisor,
      canApprove,
      systemRole,
      rolePerms,
      permsLoading,
      hasPermission,
      loading,
      completeLogin,
      completePasswordChange,
      login,
      loginWithEmail,
      loginWithUsername,
      logout,
    };
  }, [user, loading, rolePerms]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;