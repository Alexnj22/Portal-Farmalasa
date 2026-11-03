-- El raspable del Cliente Mayorista (Rubí y Diamante) exige compra en el mes
-- anterior, como el de Oro y Platino (Condiciones del Cliente Mayorista +
-- Reglamento v2 cl. 5.1). Auditoría 2026-11-03; decisión del usuario: «según
-- reglamento». Parte de la definición VIVA (pg_get_functiondef) y sólo agrega
-- el EXISTS en la rama de mayoristas. CREATE OR REPLACE FUNCTION: no toma lock
-- sobre ninguna tabla.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_dar_cupones(p_dia date DEFAULT NULL::date, p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_mes date := date_trunc('month', v_dia)::date;
  v_fin date := (date_trunc('month', v_dia) + interval '1 month - 1 day')::date;
  v_mes_ant date := (date_trunc('month', v_dia) - interval '1 month')::date;
  v_v2 date := public.reglas_v2_desde();
  v_tope numeric;
  v_usado numeric;
  v_usos jsonb := '{}';
  v_exist jsonb := '{}';
  r record; e jsonb; v_lista jsonb; v_disp jsonb; v_item jsonb;
  v_costo numeric; v_clave text;
  v_pts integer;
  v_n integer := 0; v_total bigint := 0; v_sin integer := 0; v_n_may integer := 0; v_n_reg integer := 0;
  v_gasto numeric := 0;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  IF v_dia < v_v2 THEN
    RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', 0, 'puntos', 0,
                             'vence', v_fin, 'omitido', 'el raspable rige desde el ' || to_char(v_v2, 'DD/MM/YYYY'));
  END IF;
  SELECT raspable_presupuesto_usd INTO v_tope FROM public.puntos_config WHERE id;
  v_usado := public.puntos_raspable_usado(v_mes);

  FOR r IN
    SELECT c.id, b.cupon_mensual, b.cupon_premios, b.nombre, true AS es_mayorista, b.orden AS prioridad, 0::numeric AS compra
      FROM public.clientes_mayoristas cm
      JOIN public.customers c ON c.id = cm.customer_id
      JOIN public.puntos_mayoreo_beneficios b ON b.clave = public.mayorista_rango(cm.customer_id)
     WHERE cm.estado = 'aprobado'
       AND (b.cupon_mensual > 0 OR b.cupon_premios IS NOT NULL)
       -- Condiciones del Cliente Mayorista: el raspable de Rubí y Diamante va
       -- «con las condiciones del Reglamento» (cl. 5.1): compra en el mes
       -- anterior, igual que Oro y Platino (auditoría 2026-11-03). Cuentan
       -- también las facturas de una ficha fusionada en ésta.
       AND EXISTS (SELECT 1 FROM public.sales_invoices si
                    WHERE (si.customer_id = c.id
                           OR si.customer_id IN (SELECT pf.customer_id FROM public.puntos_cuenta pf
                                                  WHERE pf.fusionada_en = c.id))
                      AND si.fecha >= v_mes_ant AND si.fecha < v_mes
                      AND public.venta_valida(si.estado))
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND c.tipo_persona IS DISTINCT FROM 'juridica'
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
       AND NOT EXISTS (SELECT 1 FROM public.puntos_premios pp WHERE pp.customer_id = c.id AND pp.mes = v_mes)
    UNION ALL
    SELECT c.id, n.cupon_mensual, n.cupon_premios, n.nombre, false, -1, x.compra
      FROM (SELECT coalesce(pc.fusionada_en, si.customer_id) AS customer_id, sum(si.total) AS compra,
                   bool_or(si.fecha >= v_mes_ant AND si.fecha < v_mes) AS compro_mes_anterior
              FROM public.sales_invoices si
              LEFT JOIN public.puntos_cuenta pc ON pc.customer_id = si.customer_id AND pc.fusionada_en IS NOT NULL
             WHERE si.fecha > v_dia - 365 AND si.fecha <= v_dia
               AND public.venta_valida(si.estado)
             GROUP BY 1) x
      JOIN public.customers c ON c.id = x.customer_id
      CROSS JOIN LATERAL public.puntos_nivel_de(x.compra, v_dia) n
     WHERE x.compro_mes_anterior
       AND (n.cupon_mensual > 0 OR n.cupon_premios IS NOT NULL)
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND c.tipo_persona IS DISTINCT FROM 'juridica'
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                        WHERE cm.customer_id = c.id AND cm.estado = 'aprobado')
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
       AND NOT EXISTS (SELECT 1 FROM public.puntos_premios pp WHERE pp.customer_id = c.id AND pp.mes = v_mes)
    ORDER BY 6 DESC, 7 DESC, 1
  LOOP
    v_lista := CASE WHEN r.cupon_premios IS NOT NULL AND jsonb_array_length(r.cupon_premios) > 0 THEN r.cupon_premios
                    WHEN coalesce(r.cupon_mensual, 0) > 0
                      THEN jsonb_build_array(jsonb_build_object('tipo', 'puntos', 'puntos', r.cupon_mensual, 'peso', 1)) END;
    CONTINUE WHEN v_lista IS NULL;
    v_disp := '[]'::jsonb;

    FOR e IN SELECT CASE WHEN x ? 'tipo' THEN x ELSE x || '{"tipo":"puntos"}'::jsonb END
               FROM jsonb_array_elements(v_lista) x LOOP
      v_costo := public.puntos_premio_costo(e);
      CONTINUE WHEN v_costo IS NULL;
      CONTINUE WHEN v_tope IS NOT NULL AND v_usado + v_costo > v_tope;
      v_clave := NULL;
      IF e->>'tipo' IN ('producto', 'promocional') THEN
        v_clave := concat_ws(':', e->>'tipo', e->>'product_id', e->>'presentacion_tipo', e->>'factor',
                             e->>'promocional_id');
        IF e ? 'cupo' AND coalesce(e->>'cupo_por', 'general') = 'general' THEN
          IF NOT v_usos ? v_clave THEN
            v_usos := v_usos || jsonb_build_object(v_clave, public.puntos_premio_usos(e, v_mes));
          END IF;
          CONTINUE WHEN (v_usos->>v_clave)::integer >= (e->>'cupo')::integer;
        END IF;
        IF NOT v_exist ? v_clave THEN
          v_exist := v_exist || jsonb_build_object(v_clave, public.puntos_premio_existencia(e, v_dia));
        END IF;
        CONTINUE WHEN (v_exist->>v_clave)::integer < coalesce((e->>'cantidad')::integer, 1);
      END IF;
      v_disp := v_disp || jsonb_build_array(e || jsonb_build_object(
        '_costo', v_costo, '_clave', v_clave,
        '_cupo_sala', CASE WHEN e ? 'cupo' AND e->>'cupo_por' = 'sucursal' THEN (e->>'cupo')::integer END));
    END LOOP;

    v_item := CASE WHEN jsonb_array_length(v_disp) > 0 THEN public.puntos_premio_sorteado(v_disp, NULL) END;
    IF v_item IS NULL THEN v_sin := v_sin + 1; CONTINUE; END IF;

    v_costo := (v_item->>'_costo')::numeric;
    v_usado := v_usado + v_costo;
    v_gasto := v_gasto + v_costo;
    v_clave := v_item->>'_clave';
    IF v_clave IS NOT NULL THEN
      IF v_usos ? v_clave THEN
        v_usos := jsonb_set(v_usos, ARRAY[v_clave], to_jsonb((v_usos->>v_clave)::integer + 1));
      END IF;
      v_exist := jsonb_set(v_exist, ARRAY[v_clave],
                           to_jsonb((v_exist->>v_clave)::integer - coalesce((v_item->>'cantidad')::integer, 1)));
    END IF;
    IF r.es_mayorista THEN v_n_may := v_n_may + 1; END IF;

    IF v_item->>'tipo' IN ('producto', 'promocional') THEN
      v_n_reg := v_n_reg + 1;
      CONTINUE WHEN p_simular;
      INSERT INTO public.puntos_premios (customer_id, tipo, nombre, product_id, presentacion_tipo, factor, cantidad,
                                         promocional_id, nivel, mes, ganado_el, vence_el, costo, cupo_sala)
      VALUES (r.id, v_item->>'tipo', v_item->>'nombre', (v_item->>'product_id')::bigint, v_item->>'presentacion_tipo',
              (v_item->>'factor')::integer, coalesce((v_item->>'cantidad')::integer, 1),
              (v_item->>'promocional_id')::bigint, r.nombre, v_mes, v_dia, v_fin,
              v_costo, (v_item->>'_cupo_sala')::integer)
      ON CONFLICT (customer_id, mes) DO NOTHING;
      CONTINUE;
    END IF;

    v_pts := (v_item->>'puntos')::integer;
    CONTINUE WHEN coalesce(v_pts, 0) <= 0;
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
                           'mayoristas', v_n_may, 'regalos', v_n_reg, 'vence', v_fin,
                           'gastado_usd', round(v_gasto, 2), 'usado_mes_usd', round(v_usado, 2), 'tope_usd', v_tope,
                           'sin_premio_disponible', v_sin,
                           'fuera_del_presupuesto', v_sin);
END $function$;
