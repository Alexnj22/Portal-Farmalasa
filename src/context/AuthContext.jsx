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
  const doLogout = async (reason = "LOGOUT") => {
    // 1. Detenemos los relojes de inmediato
    stopIdleWatcher();
    
    // 2. Limpiamos la memoria local
    clearAuthCache();
    clearErpCache();

    // 3. 🚨 ESTO ES LA MAGIA: Vaciamos el usuario. 
    // React Router detectará esto al instante y te enviará a /login 
    // sin necesidad de recargar la página bruscamente.
    setUser(null);
    
    // 4. Avisamos a Supabase que cierre la sesión en el servidor en segundo plano
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("SignOut silencioso falló:", e);
    }
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
          setUser(parsed);
          startIdleWatcher(parsed);
        }
      } catch {
        clearAuthCache();
        clearErpCache();
      }
    }
    // Quitamos la pantalla de carga casi instantáneamente
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

        writeLastActivity(true);

        if (isExpiredByIdle(u)) {
          doLogout("REHYDRATE_IDLE_EXPIRED");
          return;
        }

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
        // Si el evento es SIGNED_OUT o ya no hay sesión (ej. en otra pestaña)
        if (event === 'SIGNED_OUT' || !session?.user) {
          stopIdleWatcher();
          clearAuthCache();
          clearErpCache();
          setUser(null); // Esto causará un redirect súper fluido al login
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
      console.log('LOGIN DEBUG - cleanId:', cleanId);
      console.log('LOGIN DEBUG - calling ensure_user_by_code with:', { code: cleanId });
      const { data: ensured, error: fnErr } = await supabase.functions.invoke("ensure_user_by_code", {
        body: { code: cleanId },
      });
      console.log('LOGIN DEBUG - ensured response:', ensured);
      console.log('LOGIN DEBUG - fnErr:', fnErr);

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

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailToLogin,
        password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          return { ok: false, error: 'Usuario no encontrado o contraseña incorrecta.' };
        }
        return { ok: false, error: error.message };
      }

      if (!data?.session) return { ok: false, error: 'Error de sesión. Intenta de nuevo.' };

      const usernameFromEmail = emailToLogin.split('@')[0];
      const { data: ensured, error: fnErr } = await supabase.functions.invoke('ensure_user_by_code', {
        body: { code: usernameFromEmail.toUpperCase() },
      });

      if (fnErr || !ensured?.ok || !ensured?.user) {
        return { ok: false, error: 'Usuario no encontrado en el sistema.' };
      }

      const u = ensured.user;
      clearErpCache();
      localStorage.setItem(LS_USER, JSON.stringify(u));
      writeLastActivity(true);
      setUser(u);
      startIdleWatcher(u);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Error de conexión con el servidor.' };
    }
  };

  const logout = async () => {
    await doLogout("MANUAL_LOGOUT");
  };

  // ✅ Exposición de valores
  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: user?.isAdmin === true || user?.is_admin === true || user?.userType === "admin",
      loading,
      login,
      loginWithEmail,
      loginWithUsername,
      logout,
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;