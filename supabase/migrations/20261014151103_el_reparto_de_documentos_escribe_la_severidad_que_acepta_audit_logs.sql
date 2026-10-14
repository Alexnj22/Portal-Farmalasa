-- El reparto de documentos colectivos escribía la bitácora con severity 'info'
-- en minúscula (2026-10-14). audit_logs_severity_check sólo acepta
-- 'INFO' | 'WARNING' | 'CRITICAL', así que el INSERT lanzaba y la transacción
-- deshacía el reparto entero. Hasta 20261014143719 nunca se llegaba a esa línea
-- porque antes fallaba el permiso.
--
-- Se reescribe desde la definición VIVA de cada función y se cambia sólo el
-- literal; si el patrón no aparece exactamente una vez, se aborta.
SET lock_timeout = '5s';

DO $$
DECLARE
  v_fn  regprocedure;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.asignar_documento_a_empleados(uuid[], jsonb)'::regprocedure,
    'public.aplicar_documentos_pendientes(uuid)'::regprocedure
  ] LOOP
    v_def := pg_get_functiondef(v_fn);
    IF (length(v_def) - length(replace(v_def, $q$'portal', 'info'$q$, ''))) / length($q$'portal', 'info'$q$) <> 1 THEN
      RAISE EXCEPTION 'Patrón de severidad inesperado en %', v_fn;
    END IF;
    v_new := replace(v_def, $q$'portal', 'info'$q$, $q$'portal', 'INFO'$q$);
    EXECUTE v_new;
  END LOOP;
END;
$$;
