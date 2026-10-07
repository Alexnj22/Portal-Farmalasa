SET lock_timeout = '5s';

-- El cupón mensual se RASPA en la app y trae un premio que no se sabe hasta
-- rasparlo (2026-10-07). `cupon_premios`: opciones con su peso; el valor
-- esperado de las de Platino es ~475 puntos ($4.75), cerca del $5 fijo de
-- antes. Sin `cupon_premios`, se da `cupon_mensual` como siempre.
ALTER TABLE public.puntos_niveles ADD COLUMN cupon_premios jsonb;
UPDATE public.puntos_niveles
   SET cupon_premios = '[{"puntos":300,"peso":50},{"puntos":500,"peso":35},{"puntos":1000,"peso":15}]'::jsonb
 WHERE clave = 'platino';

-- Un premio al azar según los pesos.
CREATE FUNCTION public.puntos_premio_al_azar(p_premios jsonb, p_defecto integer)
RETURNS integer LANGUAGE plpgsql VOLATILE
SET search_path = public, extensions AS $$
DECLARE v_total numeric; v_tiro numeric; v_acum numeric := 0; e jsonb;
BEGIN
  IF p_premios IS NULL OR jsonb_array_length(p_premios) = 0 THEN RETURN p_defecto; END IF;
  SELECT sum((x->>'peso')::numeric) INTO v_total FROM jsonb_array_elements(p_premios) x;
  v_tiro := random() * v_total;
  FOR e IN SELECT x FROM jsonb_array_elements(p_premios) x LOOP
    v_acum := v_acum + (e->>'peso')::numeric;
    IF v_tiro <= v_acum THEN RETURN (e->>'puntos')::integer; END IF;
  END LOOP;
  RETURN p_defecto;
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_premio_al_azar(jsonb, integer) FROM PUBLIC, anon, authenticated;

-- El reparto, con el premio al azar. Partiendo de la definición viva.
CREATE OR REPLACE FUNCTION public.puntos_dar_cupones(p_dia date DEFAULT NULL, p_simular boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_fin date := (date_trunc('month', v_dia) + interval '1 month - 1 day')::date;
  v_tope integer;
  v_dado integer;
  v_pts integer;
  r record; v_n integer := 0; v_total integer := 0; v_sin_tope integer := 0;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT cupon_presupuesto_mensual INTO v_tope FROM public.puntos_config WHERE id;
  SELECT coalesce(sum(puntos), 0) INTO v_dado FROM public.puntos_lote
   WHERE origen = 'cupon' AND date_trunc('month', ganado_el) = date_trunc('month', v_dia);

  FOR r IN
    SELECT c.id, n.cupon_mensual, n.cupon_premios, n.nombre
      FROM (SELECT DISTINCT l.customer_id FROM public.puntos_lote l
             WHERE l.ganado_el > v_dia - 365 AND l.origen IN ('venta', 'migracion')) x
      JOIN public.customers c ON c.id = x.customer_id
      CROSS JOIN LATERAL public.puntos_nivel_de(public.puntos_compra_12m(c.id, v_dia)) n
     WHERE n.cupon_mensual > 0
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
     ORDER BY public.puntos_compra_12m(c.id, v_dia) DESC
  LOOP
    v_pts := public.puntos_premio_al_azar(r.cupon_premios, r.cupon_mensual);
    IF v_dado + v_total + v_pts > coalesce(v_tope, 0) THEN v_sin_tope := v_sin_tope + 1; CONTINUE; END IF;
    v_n := v_n + 1;
    v_total := v_total + v_pts;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cupon', v_pts, v_pts, v_dia, v_fin, 'Cupón ' || r.nombre || ' del mes');
    UPDATE public.puntos_cuenta SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total,
                           'vence', v_fin, 'fuera_del_presupuesto', v_sin_tope);
END $$;
