SET lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.puntos_dar_cupones(p_dia date DEFAULT NULL::date, p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  -- Si ningún nivel con cupón es alcanzable (p. ej. niveles_activos = false:
  -- todos caen en el nivel base), no hay nada que repartir. Antes calculaba la
  -- compra de 12 meses de ~5,300 clientes cada mañana para dar 0 cupones.
  IF NOT EXISTS (SELECT 1 FROM public.puntos_niveles n
                  WHERE n.cupon_mensual > 0 AND (public.puntos_nivel_de(n.desde)).clave = n.clave) THEN
    RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', 0, 'puntos', 0,
                             'vence', v_fin, 'fuera_del_presupuesto', 0, 'omitido', 'ningún nivel da cupón');
  END IF;
  SELECT cupon_presupuesto_mensual INTO v_tope FROM public.puntos_config WHERE id;
  SELECT coalesce(sum(puntos), 0) INTO v_dado FROM public.puntos_lote
   WHERE origen = 'cupon' AND date_trunc('month', ganado_el) = date_trunc('month', v_dia);

  FOR r IN
    WITH x AS (
      -- Misma regla que puntos_compra_12m(c.id, v_dia), en una sola pasada
      -- (verificado 5,271/5,271 iguales el 2026-10-12). Si cambia una, cambia la otra.
      SELECT l.customer_id,
             coalesce(sum(coalesce(l.puntos_base, l.puntos)) FILTER (
               WHERE l.ganado_el <= v_dia
                 AND (l.origen = 'venta' OR (l.origen = 'migracion' AND l.motivo ILIKE 'compra%'))), 0) AS compra
        FROM public.puntos_lote l
       WHERE l.ganado_el > v_dia - 365 AND l.origen IN ('venta', 'migracion')
       GROUP BY 1)
    SELECT c.id, n.cupon_mensual, n.cupon_premios, n.nombre
      FROM x JOIN public.customers c ON c.id = x.customer_id
      CROSS JOIN LATERAL public.puntos_nivel_de(x.compra) n
     WHERE n.cupon_mensual > 0
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
     ORDER BY x.compra DESC
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
END $function$;
