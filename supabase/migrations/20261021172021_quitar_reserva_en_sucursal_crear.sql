-- La función vieja del alta con anticipo (2026-10-07). Desde el 2026-10-20 el
-- alta va por `DialogoApartar` + `apartado_aplicar`, porque ésta guardaba un
-- anticipo que no entraba a ninguna caja. Nadie la llama: ni `src/`, ni
-- `apps/`, ni `supabase/functions/`, ni otra función de la base (prosrc), ni un
-- cron. Tenía una sola sobrecarga.
SET lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.reserva_en_sucursal_crear(bigint, bigint, bigint, text, integer, numeric, numeric, text);
