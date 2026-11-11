-- El aviso de choque de horario decía «08:00 AM»; el portal escribe las horas
-- como «8:00 a. m.» (src/utils/hora.js). Y `soy_el_regente` devolvía null en
-- una sala sin regente: ahora false.
SET lock_timeout = '5s';
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.regencia_registrar_visita(bigint, date, time, time, text[], text)'::regprocedure);
  IF (length(d) - length(replace(d, 'to_char(v_choque.entrada, ''HH12:MI AM''), to_char(v_choque.salida, ''HH12:MI AM'')', ''))) = 0 THEN
    RAISE EXCEPTION 'no se encontró el formato a reemplazar';
  END IF;
  d := replace(d, 'to_char(v_choque.entrada, ''HH12:MI AM''), to_char(v_choque.salida, ''HH12:MI AM'')',
    'to_char(v_choque.entrada, ''FMHH12:MI'') || CASE WHEN v_choque.entrada < ''12:00'' THEN '' a. m.'' ELSE '' p. m.'' END, '
    || 'to_char(v_choque.salida, ''FMHH12:MI'') || CASE WHEN v_choque.salida < ''12:00'' THEN '' a. m.'' ELSE '' p. m.'' END');
  EXECUTE d;

  d := pg_get_functiondef('public.regencia_de_sala(bigint, date)'::regprocedure);
  IF position('''soy_el_regente'', v_yo IS NOT NULL AND v_yo::text = v_legal->>''regentEmployeeId''' IN d) = 0 THEN
    RAISE EXCEPTION 'no se encontró soy_el_regente';
  END IF;
  d := replace(d, '''soy_el_regente'', v_yo IS NOT NULL AND v_yo::text = v_legal->>''regentEmployeeId''',
                  '''soy_el_regente'', coalesce(v_yo::text = v_legal->>''regentEmployeeId'', false)');
  EXECUTE d;
END $$;
