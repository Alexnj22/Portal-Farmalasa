// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de un AuthProvider");
  return ctx;
};

const withTimeout = (promise, ms, label = "timeout") =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms))]);

// -------------------------
// ⏱️ Idle logout settings
// -------------------------
const LS_USER = "sb_user";
const LS_LAST = "sb_last_activity_at";

const IDLE_EMP_MS = 15 * 60 * 1000;        // 15 min
const IDLE_ADMIN_MS = 12 * 60 * 60 * 1000; // 12h
const CHECK_EVERY_MS = 15 * 1000;          // revisar cada 15s
const ACTIVITY_THROTTLE_MS = 2000;         // escribir lastActivity máx cada 2s

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
  // Helpers idle
  // -------------------------
  const getIdleLimitMs = (u) => (u?.isAdmin ? IDLE_ADMIN_MS : IDLE_EMP_MS);

  const writeLastActivity = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastWriteRef.current = now;
    localStorage.setItem(LS_LAST, String(now));
  };

  function onActivity() {
    if (!userRef.current) return;
    writeLastActivity(false);
  }

  function onVisibilityChange() {
    if (!userRef.current) return;
    if (document.visibilityState === "visible") writeLastActivity(true);
  }

  const stopIdleWatcher = () => {
    if (idleIntervalRef.current) {
      clearInterval(idleIntervalRef.current);
      idleIntervalRef.current = null;
    }
    window.removeEventListener("mousemove", onActivity, true);
    window.removeEventListener("keydown", onActivity, true);
    window.removeEventListener("scroll", onActivity, true);
    window.removeEventListener("click", onActivity, true);
    window.removeEventListener("touchstart", onActivity, true);
    document.removeEventListener("visibilitychange", onVisibilityChange, true);
  };

  const doLogout = async (reason = "LOGOUT") => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("signOut error:", e?.message || e);
    } finally {
      stopIdleWatcher();
      setUser(null);
      localStorage.removeItem(LS_USER);
      localStorage.removeItem(LS_LAST);
      // console.log("🔒 Logout:", reason);
    }
  };

  const isExpiredByIdle = (u) => {
    const last = parseInt(localStorage.getItem(LS_LAST) || "0", 10);
    if (!last) return false;
    return Date.now() - last >= getIdleLimitMs(u);
  };

  const startIdleWatcher = (u) => {
    stopIdleWatcher();

    if (!localStorage.getItem(LS_LAST)) writeLastActivity(true);

    window.addEventListener("mousemove", onActivity, true);
    window.addEventListener("keydown", onActivity, true);
    window.addEventListener("scroll", onActivity, true);
    window.addEventListener("click", onActivity, true);
    window.addEventListener("touchstart", onActivity, true);
    document.addEventListener("visibilitychange", onVisibilityChange, true);

    const limit = getIdleLimitMs(u);

    idleIntervalRef.current = setInterval(() => {
      const last = parseInt(localStorage.getItem(LS_LAST) || "0", 10);
      if (!last) return;

      const diff = Date.now() - last;
      if (diff >= limit) doLogout("IDLE_TIMEOUT");
    }, CHECK_EVERY_MS);
  };

  // -------------------------
  // ✅ Boot: SOLO Admin puede persistir en refresh
  // -------------------------
  useEffect(() => {
    const cached = localStorage.getItem(LS_USER);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);

        // 🔥 Si es EMPLEADO: NO persistimos -> limpiar y arrancar en login
        if (!parsed?.isAdmin) {
          localStorage.removeItem(LS_USER);
          localStorage.removeItem(LS_LAST);
          setUser(null);
          setLoading(false);
          return;
        }

        // Admin: ok
        setUser(parsed);

        if (isExpiredByIdle(parsed)) {
          setTimeout(() => doLogout("BOOT_IDLE_EXPIRED"), 0);
        } else {
          startIdleWatcher(parsed);
        }
      } catch {
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_LAST);
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // ✅ Rehidratar en background (Admin only)
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

        // 🔥 Si es EMPLEADO: al refresh, forzar logout y no rehidratar
        if (!u.isAdmin) {
          await doLogout("EMP_REFRESH_FORCE_LOGIN");
          return;
        }

        if (isExpiredByIdle(u)) {
          await doLogout("REHYDRATE_IDLE_EXPIRED");
          return;
        }

        setUser(u);
        localStorage.setItem(LS_USER, JSON.stringify(u));
        startIdleWatcher(u);
      } catch {
        // silencioso
      }
    };

    rehydrate();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (!session?.user) {
          stopIdleWatcher();
          setUser(null);
          localStorage.removeItem(LS_USER);
          localStorage.removeItem(LS_LAST);
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

        // 🔥 EMPLEADO: no persistir + si esto ocurre por refresh, se queda logueado
        // pero tu requisito es: al refresh -> login. Entonces: forzar signOut.
        if (!u.isAdmin) {
          await doLogout("EMP_SESSION_DETECTED");
          return;
        }

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
  // ✅ Login por código (Edge -> Auth)
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

      // ✅ Set en memoria siempre
      setUser(u);

      // ✅ Timers (ambos)
      writeLastActivity(true);
      startIdleWatcher(u);

      // ✅ Persistencia SOLO si admin
      if (u.isAdmin) {
        localStorage.setItem(LS_USER, JSON.stringify(u));
      } else {
        localStorage.removeItem(LS_USER);
      }

      return true;
    } catch {
      return false;
    }
  };

  const logout = async () => {
    await doLogout("MANUAL");
  };

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: user?.isAdmin === true || user?.userType === "admin",
      isEmployee: user?.userType === "employee",
      loading,
      login,
      logout,
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;