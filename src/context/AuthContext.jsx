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

  const idleIntervalRef = useRef(null);
  const lastWriteRef = useRef(0);
  const aliveRef = useRef(true);
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

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
    // 🛡️ MEJORA: `wheel` es mucho más seguro que `scroll` para detectar inactividad real.
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

  const doLogout = async (reason = "LOGOUT") => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
    } finally {
      stopIdleWatcher();
      setUser(null);
      clearAuthCache();
      clearErpCache();

      // 🛡️ MEJORA: Evitar un Reload Loop si la sesión expira cuando ya estamos en login.
      if (window.location.pathname !== "/login" && window.location.pathname !== "/kiosk") {
          window.location.href = "/login";
      }
    }
  };

  const isExpiredByIdle = (u) => {
    const last = parseInt(localStorage.getItem(LS_LAST) || "0", 10);
    // 🛡️ MEJORA: Si no hay registro de tiempo o el tiempo es del futuro (reloj desincronizado), no expiramos.
    if (!last || last > Date.now()) return false;
    
    // Si la última actividad fue hace menos de 5 segundos, asumimos que acaba de iniciar sesión.
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
  // ✅ Boot Inicial: Verificación local
  // -------------------------
  useEffect(() => {
    const cached = localStorage.getItem(LS_USER);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);

        if (isExpiredByIdle(parsed)) {
          setTimeout(() => doLogout("BOOT_IDLE_EXPIRED"), 0);
        } else {
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
  // ✅ Rehidratación de Supabase (Sincronización Auth real)
  // -------------------------
  useEffect(() => {
    aliveRef.current = true;

    const rehydrate = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 3500, "getSession timeout");
        if (!aliveRef.current) return;

        const sessionUser = data?.session?.user;
        if (!sessionUser) return;

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

        // 🚨 Asegurarnos de que actualizamos la actividad si la sesión sigue viva al refrescar (F5)
        writeLastActivity(true);

        if (isExpiredByIdle(u)) {
          await doLogout("REHYDRATE_IDLE_EXPIRED");
          return;
        }

        setUser(u);
        localStorage.setItem(LS_USER, JSON.stringify(u));
        startIdleWatcher(u);
      } catch {
        // silencioso en caso de red inestable
      }
    };

    rehydrate();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (!session?.user) {
          stopIdleWatcher();
          setUser(null);
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
          await doLogout("AUTHCHANGE_IDLE_EXPIRED");
          return;
        }

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

      setUser(u);
      
      localStorage.setItem(LS_USER, JSON.stringify(u));
      clearErpCache();
      
      writeLastActivity(true);
      startIdleWatcher(u);

      return true;
    } catch (e) {
        return false;
    }
  };

  const logout = async () => {
    await doLogout("MANUAL_LOGOUT");
  };

  // ✅ Exposición de valores y funciones
  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: user?.isAdmin === true || user?.is_admin === true || user?.userType === "admin",
      loading,
      login,
      logout,
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;