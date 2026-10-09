SET lock_timeout = '5s';
-- El canje gasta PRIMERO el cupón del mes y después los puntos (decisión del
-- usuario, 2026-10-09). El cupón vence a fin de mes; gastando del más viejo al
-- más nuevo, quien canjeaba ese mes se quedaba con el cupón vivo y lo perdía
-- al vencer. Sólo el CANJE: anular una venta, vencer o ajustar siguen con
-- puntos_consumir (del más viejo al más nuevo) — una anulación no debe
-- comerse el cupón.
CREATE OR REPLACE FUNCTION public.puntos_consumir_canje(p_customer_id bigint, p_puntos integer, p_salida_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET enable_seqscan TO 'off'
AS $function$
DECLARE
  v_falta integer := p_puntos;
  v_toma  integer;
  r       record;
BEGIN
  IF p_puntos <= 0 THEN RETURN 0; END IF;
  FOR r IN
    SELECT id, restantes FROM public.puntos_lote
    WHERE customer_id = p_customer_id AND restantes > 0
    ORDER BY (origen = 'cupon') DESC, ganado_el, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_falta <= 0;
    v_toma := least(v_falta, r.restantes);
    UPDATE public.puntos_lote SET restantes = restantes - v_toma WHERE id = r.id;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
      VALUES (p_salida_id, r.id, v_toma)
      ON CONFLICT (salida_id, lote_id) DO UPDATE SET puntos = puntos_salida_lote.puntos + EXCLUDED.puntos;
    v_falta := v_falta - v_toma;
  END LOOP;
  RETURN p_puntos - v_falta;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_consumir_canje(bigint, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_consumir_canje(bigint, integer, bigint) TO service_role;

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.puntos_registrar_canje(bigint, boolean)'::regprocedure);
  IF position('v_consumidos := public.puntos_consumir(v.customer_id, v_puntos, v_salida);' IN d) = 0 THEN
    RAISE EXCEPTION 'puntos_registrar_canje cambió: no se encontró la llamada a reemplazar';
  END IF;
  d := replace(d, 'v_consumidos := public.puntos_consumir(v.customer_id, v_puntos, v_salida);',
                  'v_consumidos := public.puntos_consumir_canje(v.customer_id, v_puntos, v_salida);');
  EXECUTE d;
END $$;
