import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { fetchUserTheme, upsertUserTheme } from '../data/dashboard';
import { COLUMNA_TEMA } from '../utils/temaPorDispositivo';

// Mounted once in AppLayout.
// Sincroniza ThemeContext con user_dashboard_prefs: al iniciar sesión trae el
// tema guardado del usuario (si existe) y lo aplica, sobreescribiendo el valor
// local que venía de localStorage/prefers-color-scheme; al cambiar de tema con
// sesión activa, lo guarda (debounced 800ms) para que viaje entre dispositivos.
// Antes de login (LoginView) y en el kiosco (TimeClockView) no hay user — ahí
// el tema sigue siendo puramente local, como antes.
//
// **Guarda y lee la columna de ESTE formato de aparato** (`COLUMNA_TEMA`:
// `theme` en escritorio, `mobile_theme` en teléfono). Con una sola columna,
// este mismo efecto era lo que IMPEDÍA tener un tema por aparato: el teléfono
// leía el tema del escritorio al iniciar sesión y lo pisaba encima del local,
// así que la preferencia del último aparato usado ganaba siempre. Sigue
// viajando entre dispositivos — un teléfono nuevo hereda el tema de teléfono,
// no el default.
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
  // Qué tema sabemos que ya está guardado en la base, para no reescribirlo.
  // Sin esto, cargar el tema disparaba el effect de guardado por el simple
  // hecho de haberlo aplicado, y **cada arranque del portal escribía una fila
  // idéntica** (§7.5 de AUDITORIA-COMPLETA-2026-07-30). Es el mismo antipatrón
  // que el proyecto ya prohíbe en los syncs: un upsert incondicional que no
  // aporta información y sí paga su WAL.
  const persistidoRef = useRef(undefined);

  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    persistidoRef.current = undefined;
    fetchUserTheme(user.id, COLUMNA_TEMA).then(({ data, error }) => {
      if (cancelado) return;
      if (error) console.error('[theme sync] load', error);
      // `null` cuando el usuario todavía no tiene fila —o nunca eligió tema en
      // este formato de aparato—: ahí el primer guardado sí corresponde.
      const guardado = data?.[COLUMNA_TEMA] ?? null;
      persistidoRef.current = guardado;
      if (guardado) setTheme(guardado);
      setCargadoPara(user.id);
    });
    return () => { cancelado = true; };
  }, [user?.id, setTheme]);

  useEffect(() => {
    if (!ready || !user?.id) return;
    if (persistidoRef.current === theme) return;   // nada que guardar
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const enVuelo = theme;
      upsertUserTheme(user.id, enVuelo, COLUMNA_TEMA).then(({ error }) => {
        if (error) { console.error('[theme sync] save', error); return; }
        persistidoRef.current = enVuelo;
      });
    }, 800);
    return () => clearTimeout(saveTimerRef.current);
  }, [ready, theme, user?.id]);
}
