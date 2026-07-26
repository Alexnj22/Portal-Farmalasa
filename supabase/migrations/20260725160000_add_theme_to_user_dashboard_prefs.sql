-- Agrega la preferencia de tema (liquid/dark/solid/solid-dark) a la misma
-- tabla de prefs por usuario que ya existe para el layout del Dashboard
-- (user_dashboard_prefs, PK user_id, RLS owner_select/owner_update/owner_upsert
-- ya cubren esta columna nueva sin cambios). NULL = sin preferencia guardada
-- todavía, el cliente sigue resolviendo por localStorage/prefers-color-scheme
-- como fallback (ver ThemeContext.jsx resolveInitialTheme).
SET lock_timeout = '5s';

ALTER TABLE public.user_dashboard_prefs
  ADD COLUMN theme text
  CHECK (theme IS NULL OR theme IN ('liquid', 'dark', 'solid', 'solid-dark'));
