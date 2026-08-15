-- `laboratorios` tenía RLS activo y NINGUNA policy que concediera escritura: sólo
-- `laboratorios_read` (SELECT) y `bloqueo_global`, que es RESTRICTIVE y por tanto
-- sólo restringe, nunca concede. Sin una policy permisiva para UPDATE, Postgres
-- deniega y ningún JWT lo cambia.
--
-- O sea que ocultar un laboratorio de MIN·MAX (`LabsPanel.jsx:48`) NUNCA
-- funcionó desde el navegador. Y falla en silencio, que es lo peor: el código sí
-- comprueba `error`, pero una denegación de RLS en un UPDATE devuelve 200 con
-- CERO filas, no un error — así que la pantalla decía que había guardado.
--
-- El módulo es `minmax` y no `laboratorios`: la ÚNICA escritura a esta tabla en
-- todo el portal es esa casilla, que vive dentro de MIN·MAX (verificado por
-- barrido: `TabLaboratorios` escribe `lab_locations`, que es otra tabla y ya
-- tiene sus policies). Un solo módulo a propósito — una lista de dos concede
-- siempre el más ancho, que es el defecto que se corrigió en 20260815172625.
--
-- Sólo UPDATE: el catálogo de laboratorios lo puebla el sync con service_role,
-- que no pasa por RLS. Nadie crea ni borra un laboratorio desde el portal.
SET lock_timeout = '5s';

DROP POLICY IF EXISTS laboratorios_update ON public.laboratorios;
CREATE POLICY laboratorios_update ON public.laboratorios
  FOR UPDATE TO authenticated
  USING      ((SELECT public.auth_can_edit_any(ARRAY['minmax'::text])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['minmax'::text])));
