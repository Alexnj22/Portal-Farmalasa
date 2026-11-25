-- get_metas_mes_en_curso: «¿ese día trabaja?» por turno_del_dia, no por
-- coalesce(isOff, true). Un día sin la clave `isOff` TRABAJA (horario-del-dia.md);
-- con el default invertido salía «N días sin turno» en gente con horario completo.
-- Hoy en producción todos los horarios traen la clave (211 de 211 días con venta y
-- horario), así que el resultado no cambia: se cierra la trampa antes de que pegue.
-- Se reescribe sobre la definición VIVA (md5 58743a6941b66d2414317c841932ca79).
SET lock_timeout = '5s';
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.get_metas_mes_en_curso(bigint)'::regprocedure);
  v_viejo text := $v$AND coalesce((r.schedule_data -> k.dia ->> 'isOff')::boolean, true) = false$v$;
  v_nuevo text := $v$AND coalesce((public.turno_del_dia(r.schedule_data -> k.dia, to_jsonb(sh)) ->> 'trabaja')::boolean, false)$v$;
BEGIN
  IF md5(v_def) <> '58743a6941b66d2414317c841932ca79' THEN
    RAISE EXCEPTION 'get_metas_mes_en_curso cambió desde que se leyó (md5 %)', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 THEN
    RAISE EXCEPTION 'el predicado viejo no aparece exactamente una vez';
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END $$;
