import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fetchUserTheme, upsertUserTheme } from '../data/dashboard';

// Mounted once in AppLayout.
// Sincroniza ThemeContext con user_dashboard_prefs.theme: al iniciar sesión
// trae el tema guardado del usuario (si existe) y lo aplica, sobreescribiendo
// el valor local que venía de localStorage/prefers-color-scheme; al cambiar
// de tema con sesión activa, lo guarda (debounced 800ms) para que viaje entre
// dispositivos. Antes de login (LoginView) y en el kiosco (TimeClockView)
// no hay user — ahí el tema sigue siendo puramente local, como antes.
export function useThemeSync() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!user?.id) { setReady(false); return; }
    setReady(false);
    fetchUserTheme(user.id).then(({ data, error }) => {
      if (error) console.error('[theme sync] load', error);
      if (data?.theme) setTheme(data.theme);
      setReady(true);
    });
  }, [user?.id, setTheme]);

  useEffect(() => {
    if (!ready || !user?.id) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      upsertUserTheme(user.id, theme).then(({ error }) => {
        if (error) console.error('[theme sync] save', error);
      });
    }, 800);
    return () => clearTimeout(saveTimerRef.current);
  }, [ready, theme, user?.id]);
}
