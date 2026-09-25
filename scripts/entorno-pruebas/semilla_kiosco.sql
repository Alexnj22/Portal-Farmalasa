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

-- ── La persona que marca: Marta Alfaro, Salud 1 ─────────────────────────────
-- Código 9101; el PIN del carné lo deriva `derivar_kiosk_pin` del código, así
-- que no se escribe acá (SHA-256 → base64 → alfanuméricos → 8). Horario
-- PUBLICADO de esta semana con el turno de HOY empezando 10 minutos antes de
-- correr la semilla y durando 8 horas: el primer carné es una entrada a tiempo y
-- el segundo abre la salida anticipada. Volver a correrla corre el turno a hoy.
DO $$
DECLARE
  v_id      uuid;
  v_ahora   timestamp := now() AT TIME ZONE 'America/El_Salvador';
  v_lunes   date := (date_trunc('week', v_ahora))::date;
  v_dia     text := extract(dow from v_ahora)::int::text;
  v_inicio  text := to_char(v_ahora - interval '10 minutes', 'HH24:MI');
  v_fin     text := to_char(least(v_ahora + interval '8 hours', date_trunc('day', v_ahora) + interval '23 hours 59 minutes'), 'HH24:MI');
BEGIN
  IF (SELECT count(*) FROM public.employees WHERE code <> '9101') > 1 THEN
    RAISE EXCEPTION 'semilla_kiosco: esta base no es la de pruebas';
  END IF;

  -- `name` no se escribe: es una columna generada de nombres y apellidos.
  INSERT INTO public.employees (code, first_names, last_names, branch_id, status)
  VALUES ('9101', 'Marta', 'Alfaro', 4, 'ACTIVO')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_id FROM public.employees WHERE code = '9101';
  UPDATE public.employees SET status = 'ACTIVO', branch_id = 4 WHERE id = v_id;

  DELETE FROM public.employee_rosters WHERE employee_id = v_id AND week_start_date = v_lunes;
  INSERT INTO public.employee_rosters (employee_id, week_start_date, status, schedule_data)
  VALUES (v_id, v_lunes, 'PUBLISHED',
          jsonb_build_object(v_dia, jsonb_build_object('customStart', v_inicio, 'customEnd', v_fin, 'isOff', false)));

  -- Sin marcaciones de hoy: cada corrida arranca desde la entrada.
  DELETE FROM public.attendance
   WHERE employee_id = v_id
     AND (timestamp AT TIME ZONE 'America/El_Salvador')::date = v_ahora::date;
END $$;
