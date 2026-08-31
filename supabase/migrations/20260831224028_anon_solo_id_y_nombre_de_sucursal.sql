-- `anon` veía la fila ENTERA de cada sucursal, y sólo necesita dos columnas.
--
-- La policy `kiosk_read` (SELECT, anon, USING true) existe porque el kiosco
-- tiene que ofrecer la lista de salas antes de que nadie inicie sesión. El
-- motivo es bueno; el alcance no: RLS decide FILAS, no columnas, así que
-- `select=*` sin credenciales devolvía también `settings` —con los UUID de las
-- enfermeras de cada sala, la empresa de fumigación, los extintores y la
-- ubicación exacta—, más `phone`, `cell`, `address`, `weekly_hours` y los
-- códigos internos.
--
-- Lo que se corrige es el ALCANCE, no la puerta: la policy se queda y el
-- permiso pasa a ser por columna, que es la herramienta que sí distingue.
--
-- Medido antes de tocar nada:
--   · las 17 funciones que `anon` alcanza son SECURITY DEFINER, así que leen
--     `branches` sin pasar por este GRANT — `get_kiosk_boot_payload` ya
--     devuelve `(id, name)` y no cambia.
--   · el único camino que lee `branches` por PostgREST sin sesión es
--     `fetchKioskBoot`, y pide exactamente `select('id, name')`.
--   · el configurador del kiosco —el que usa la lista— exige sesión desde que
--     se cerró lo de la llave horaria, y con sesión manda `branches_select`.
SET lock_timeout = '5s';

REVOKE SELECT ON public.branches FROM anon;
GRANT SELECT (id, name) ON public.branches TO anon;

COMMENT ON POLICY kiosk_read ON public.branches IS
  'El kiosco lista las salas antes del login. RLS abre la FILA; el permiso por columna (id, name) es lo que acota QUÉ se ve — ver la migración del 2026-08-31.';
