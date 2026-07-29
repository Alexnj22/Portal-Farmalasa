-- 20260729_kiosk_credentials_revoke_grants
--
-- Defensa en profundidad sobre las tablas creadas en
-- 20260729_kiosk_credentials_store.
--
-- Las default privileges de Supabase le dan a `anon` y `authenticated`
-- privilegios COMPLETOS sobre toda tabla nueva de public — incluidos DELETE y
-- TRUNCATE. Verificado post-creación:
--
--   anon          | kiosk_credentials | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   authenticated | kiosk_credentials | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--
-- Hoy no filtra porque RLS está activo sin policies (deny por defecto), pero eso
-- deja el almacén de credenciales a un `CREATE POLICY` descuidado de quedar
-- abierto — y un TRUNCATE accidental dejaría a los 46 empleados sin poder
-- marcar. El acceso legítimo es solo vía las RPC SECURITY DEFINER
-- (verify_kiosk_pin / set_kiosk_pin) y service_role, que tiene BYPASSRLS y no
-- depende de estos grants.

SET lock_timeout = '5s';

REVOKE ALL ON public.kiosk_credentials  FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.kiosk_pin_attempts FROM anon, authenticated, PUBLIC;

REVOKE ALL ON SEQUENCE public.kiosk_pin_attempts_id_seq FROM anon, authenticated, PUBLIC;
