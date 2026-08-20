SET lock_timeout = '5s';

-- El tema deja de ser UNO por usuario y pasa a ser uno por FORMATO de aparato:
-- `theme` es el de escritorio y `mobile_theme` el del teléfono. Mismo criterio
-- —y mismo prefijo— que `mobile_layout`/`mobile_sizes`, que ya partían la
-- preferencia del tablero por esta misma razón.
--
-- Nullable y sin default a propósito: `null` significa «este usuario nunca
-- eligió tema en el teléfono», y ahí manda lo que resuelva el navegador
-- (localStorage, o prefers-color-scheme). Un default acá le impondría un tema
-- a todo el mundo en su primera sesión desde el teléfono.
ALTER TABLE public.user_dashboard_prefs
  ADD COLUMN IF NOT EXISTS mobile_theme text;

COMMENT ON COLUMN public.user_dashboard_prefs.theme IS
  'Tema elegido en ESCRITORIO (puntero fino). Ver mobile_theme.';
COMMENT ON COLUMN public.user_dashboard_prefs.mobile_theme IS
  'Tema elegido en TELÉFONO/tablet (hover: none). Separado de theme para que el teléfono y la computadora del trabajo no se pisen el tema entre sí.';
