-- La prórroga por solicitud vale también para lo que se rige por las
-- condiciones anteriores: después del 15-nov `encargo_prorrogable` (que mira
-- HOY) deja de ofrecer la prórroga directa a los encargos que llegaron antes,
-- y sin esto se quedaban sin ninguna. El encargo viejo cuenta los días
-- autorizados en vez de los 7 fijos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.parchar(p_fn regprocedure, p_viejo text, p_nuevo text, p_veces int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d text := pg_get_functiondef(p_fn); n int;
BEGIN
  n := (length(d) - length(replace(d, p_viejo, ''))) / length(p_viejo);
  IF n <> p_veces THEN RAISE EXCEPTION 'parche: «%» aparece % veces en % (se esperaban %)', left(p_viejo, 70), n, p_fn, p_veces; END IF;
  EXECUTE replace(d, p_viejo, p_nuevo);
END $$;

SELECT pg_temp.parchar('public.prorroga_registrar(text,bigint,bigint,integer,text,text,uuid)'::regprocedure,
  $x$  IF NOT v_v2 THEN
    RAISE EXCEPTION 'Esta reserva se rige por las condiciones anteriores: usa «Prorrogar».' USING ERRCODE = 'P0001';
  END IF;
$x$, '');

CREATE OR REPLACE FUNCTION public.encargo_retirar_hasta(e app_encargos)
 RETURNS date LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN e.estado = 'listo' AND e.listo_at IS NOT NULL THEN
    ((e.listo_at AT TIME ZONE 'America/El_Salvador')::date
      + CASE WHEN public.reservas_v2_rige(e.listo_at) THEN 90 + coalesce(e.prorroga_dias, 0)
             ELSE 7 + CASE WHEN e.prorrogado_at IS NOT NULL THEN coalesce(e.prorroga_dias, 7) ELSE 0 END END) END;
$function$;
