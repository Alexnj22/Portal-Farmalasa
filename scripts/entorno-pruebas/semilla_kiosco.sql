-- El dispositivo del kiosco que usa `tests/e2e/kiosco-marcacion.spec.js`.
--
-- La base de pruebas se rehace sola (`mantener_al_dia.mjs`) y ese dispositivo
-- se perdía en cada vuelta: la prueba del kiosco quedaba sin dónde correr. Se
-- corre con `execute_sql` sobre el branch de pruebas (NUNCA con
-- `apply_migration`, ver CLAUDE.md). Es idempotente.
--
-- Sólo el DISPOSITIVO. Alcanza para la pantalla de espera, la lectura del carné
-- por teclado y el carné no reconocido. La segunda prueba del spec —un carné
-- que marca de verdad— necesita además una persona con carné y horario
-- publicado, y eso todavía no está sembrado.
--
-- Freno: producción tiene decenas de fichas de empleado; el branch, una o dos.
-- Mismo criterio que la semilla que apaga los crons del branch.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.employees) > 2 THEN
    RAISE EXCEPTION 'semilla_kiosco: esta base no es la de pruebas (tiene % fichas)',
      (SELECT count(*) FROM public.employees);
  END IF;

  INSERT INTO public.kiosk_devices (id, branch_id, device_name, device_token, status)
  VALUES ('549b7f10-b7a7-4287-9e49-ab24363038b2', 4, 'Kiosco Salud 1 (pruebas)',
          '5f76390c-8d4f-4038-874b-ad19c540cd0f', 'ACTIVE')
  ON CONFLICT (id) DO UPDATE
    SET branch_id = EXCLUDED.branch_id, device_name = EXCLUDED.device_name,
        device_token = EXCLUDED.device_token, status = 'ACTIVE', revoked_at = NULL;
END $$;
