-- Superficie de funciones expuesta a anon (plan F3, 2026-07-29)
--
-- Regla #4 de CLAUDE.md: toda función nueva va con
--   REVOKE EXECUTE ... FROM PUBLIC, anon + GRANT ... TO authenticated, service_role
-- Nunca se aplicó retroactivamente: hay ~28 funciones de negocio con EXECUTE
-- para PUBLIC (y por lo tanto anon), incluidas close_ventas_month,
-- upsert_customers, generate_wfm_snapshot, get_ventas_stats y get_vendedores_resumen.
--
-- Ninguna filtra HOY: son SECURITY INVOKER, así que RLS sigue aplicando y anon no
-- ve filas. Pero son superficie de ataque y DoS gratis — cualquiera en internet
-- puede invocarlas en bucle sin autenticarse, y cada llamada consume una de las
-- 60 conexiones.
--
-- CORRECCIÓN a la auditoría (S4): decía "5 funciones SECURITY DEFINER con anon,
-- solo dos justificadas". Las cinco son el set pre-login del kiosco y las cinco
-- son deliberadas:
--   get_kiosk_boot_payload, get_kiosk_coverage_employees  (excepciones ya documentadas)
--   verify_kiosk_device, verify_kiosk_pin, verify_kiosk_authorization
--     (construidas en las fases 1/2/4 del rediseño de credenciales del kiosco;
--      validan device_token internamente — son justamente lo que reemplazó a la
--      comparación client-side)
-- CLAUDE.md solo lista dos porque se escribió antes de esas fases. Lo que está
-- desactualizado es el doc, no los permisos. Estas cinco se preservan explícitamente.
--
-- Tampoco se tocan las funciones que pertenecen a una extensión (pg_trgm, pg_net):
-- revocarles EXECUTE rompe los índices de trigram y el operador %. Esas salen del
-- namespace público moviendo la extensión, que es otro trabajo (F4.5).

SET lock_timeout = '5s';

DO $$
DECLARE
  r          record;
  v_revocadas int := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure AS firma
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- solo las que hoy puede ejecutar anon
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      -- preservar el set pre-login del kiosco
      AND p.proname NOT IN (
            'get_kiosk_boot_payload',
            'get_kiosk_coverage_employees',
            'verify_kiosk_device',
            'verify_kiosk_pin',
            'verify_kiosk_authorization'
          )
      -- excluir funciones que pertenecen a una extensión (pg_trgm, pg_net, ...)
      AND NOT EXISTS (
            SELECT 1 FROM pg_depend d
            WHERE d.objid = p.oid
              AND d.classid = 'pg_proc'::regclass
              AND d.deptype = 'e'
          )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.firma);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated, service_role', r.firma);
    v_revocadas := v_revocadas + 1;
  END LOOP;

  RAISE NOTICE 'funciones cerradas a anon: %', v_revocadas;
END $$;
