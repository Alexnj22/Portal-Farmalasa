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
  // `ready` se DERIVA de para qué usuario ya se cargó el tema, en vez de ser
  // un estado que el effect apaga y prende. El `setReady(false)` síncrono que
  // había acá es lo que marcaba `react-hooks/set-state-in-effect`: un setState
  // en el cuerpo del effect fuerza un render extra en cadena.
  //
  // De paso cierra una carrera que existía de verdad: si el usuario cambiaba
  // con un fetch en vuelo, la respuesta vieja llegaba después y aplicaba el
  // tema del usuario anterior. `cancelado` la descarta.
  const [cargadoPara, setCargadoPara] = useState(null);
  const ready = !!user?.id && cargadoPara === user.id;
  const saveTimerRef = useRef(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    fetchUserTheme(user.id).then(({ data, error }) => {
      if (cancelado) return;
      if (error) console.error('[theme sync] load', error);
      if (data?.theme) setTheme(data.theme);
      setCargadoPara(user.id);
    });
    return () => { cancelado = true; };
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
