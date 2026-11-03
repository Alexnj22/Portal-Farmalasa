-- Resumen diario de cada sala (PENDIENTES 31 y 32, 2026-11-03).
--
-- La BASE calcula y decide qué se salió de lo normal; la IA sólo lo redacta.
-- Cuatro miradas elegidas por el usuario: ventas (contra su historia y la
-- meta), faltantes de alta rotación, cortes con diferencia y vencimientos.
--
-- Tres decisiones medidas el 3-nov que explican la forma:
--   · Cada número se compara con la historia de LA MISMA sala, no con un
--     umbral: Salud 5 vende un tercio que Salud 1 y las dos están bien.
--   · Un FERIADO no se compara ni entra al promedio: el 2-nov (Difuntos)
--     Salud 2 vendió $566 contra $1,281 de sus lunes. No es una novedad.
--   · El vencimiento de un lote «GENERICO» es de relleno: de 20-57 productos
--     «vencidos en estante» por sala, con lote real quedan 3-14. Sin el
--     filtro, el resumen gritaría lo mismo todos los días y nadie lo leería.
SET lock_timeout = '5s';

CREATE TABLE public.resumen_sala_diario (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id    bigint NOT NULL REFERENCES public.branches(id),
    fecha        date   NOT NULL,
    indicadores  jsonb  NOT NULL,
    novedades    jsonb  NOT NULL DEFAULT '[]'::jsonb,
    texto        text,
    redactado    text   CHECK (redactado IN ('ia', 'sin_novedades', 'respaldo')),
    redactado_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (branch_id, fecha)
);

ALTER TABLE public.resumen_sala_diario ENABLE ROW LEVEL SECURITY;
CREATE POLICY resumen_sala_select ON public.resumen_sala_diario
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('branches', 'can_view'))
           AND ((SELECT public.auth_module_scope('branches')) = 'ALL'
                OR branch_id = (SELECT public.auth_employee_branch_id())));
REVOKE ALL ON public.resumen_sala_diario FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.resumen_sala_diario FROM authenticated;

-- ¿Es feriado para esta sala? Nacional, o local de su municipio.
CREATE OR REPLACE FUNCTION public.resumen_sala_feriado(p_fecha date, p_municipio text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
    SELECT h.name FROM public.holidays h
     WHERE (h.holiday_date = p_fecha
            OR (h.is_recurring AND extract(month FROM h.holiday_date) = extract(month FROM p_fecha)
                               AND extract(day FROM h.holiday_date) = extract(day FROM p_fecha)))
       AND (h.type = 'NATIONAL' OR (p_municipio IS NOT NULL AND lower(h.municipality) = lower(p_municipio)))
     ORDER BY (h.type = 'NATIONAL') DESC
     LIMIT 1;
$$;

-- ── Los números de un día de una sala. Sólo calcula, no opina.
CREATE OR REPLACE FUNCTION public.resumen_sala_indicadores(p_branch_id bigint, p_fecha date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
    v_suc integer;
    v_muni text;
    v_feriado text;
    v_dia numeric; v_prom numeric; v_sem integer;
    v_meta jsonb; v_falt jsonb; v_cortes jsonb; v_venc jsonb;
BEGIN
    SELECT m.erp_sucursal_id, b.settings->'location'->>'municipality'
      INTO v_suc, v_muni
      FROM public.erp_sucursal_map m JOIN public.branches b ON b.id = m.branch_id
     WHERE m.branch_id = p_branch_id AND NOT m.es_bodega;
    IF v_suc IS NULL THEN RETURN NULL; END IF;

    v_feriado := public.resumen_sala_feriado(p_fecha, v_muni);

    -- Ventas netas de lo que no es producto (mismo criterio que las metas).
    SELECT d.sum_total - d.sum_no_producto INTO v_dia
      FROM public.sales_daily_stats d WHERE d.branch_id = p_branch_id AND d.date = p_fecha;
    -- El mismo día de la semana, las 8 semanas anteriores, sin feriados.
    SELECT avg(d.sum_total - d.sum_no_producto), count(*) INTO v_prom, v_sem
      FROM public.sales_daily_stats d
     WHERE d.branch_id = p_branch_id
       AND d.date IN (SELECT p_fecha - 7 * k FROM generate_series(1, 8) k)
       AND public.resumen_sala_feriado(d.date, v_muni) IS NULL;

    SELECT jsonb_build_object('meta', g.monto_meta, 'acumulada', g.venta_acumulada,
                              'proyeccion', g.proyeccion, 'pct_proyectado', g.pct_proyectado,
                              'dias', g.dias_transcurridos, 'dias_mes', g.dias_mes)
      INTO v_meta
      FROM public.get_metas_dashboard(to_char(p_fecha, 'YYYY-MM')) g
     WHERE g.branch_id = p_branch_id;

    -- Faltantes de clase A: con mínimo y sin una unidad disponible.
    WITH a AS MATERIALIZED (
        SELECT sp.erp_product_id, coalesce(sp.manual_min, sp.calc_min, sp.min_units) AS minimo, sp.daily_velocity
          FROM public.product_stock_params sp
         WHERE sp.erp_sucursal_id = v_suc AND sp.abc_class = 'A'
           AND coalesce(sp.manual_min, sp.calc_min, sp.min_units) > 0
    ), tengo AS MATERIALIZED (
        SELECT d.erp_product_id FROM public.v_inventario_disponible d
         WHERE d.erp_sucursal_id = v_suc AND d.unidades > 0
           AND d.erp_product_id = ANY (ARRAY(SELECT a.erp_product_id FROM a))
    ), f AS (
        SELECT a.*, p.nombre FROM a LEFT JOIN public.products p ON p.id = a.erp_product_id
         WHERE NOT EXISTS (SELECT 1 FROM tengo t WHERE t.erp_product_id = a.erp_product_id)
    )
    SELECT jsonb_build_object('total', count(*),
             'lista', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.erp_product_id, 'producto', x.nombre,
                                                                    'minimo', x.minimo) ORDER BY x.daily_velocity DESC NULLS LAST)
                                  FROM (SELECT * FROM f ORDER BY daily_velocity DESC NULLS LAST LIMIT 8) x), '[]'::jsonb))
      INTO v_falt FROM f;

    -- Cortes C confirmados que contaron efectivo: el tramo es el canónico.
    WITH c AS (
        SELECT c.id, c.hora, round(public.corte_tramo(c.id), 2) AS tramo
          FROM public.cortes_caja c
         WHERE c.branch_id = p_branch_id AND c.fecha = p_fecha AND c.tipo = 'C' AND c.estado = 'CONFIRMADO'
           AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado, c.diferencia_erp, c.tk_total_caja)
    )
    SELECT jsonb_build_object('confirmados', count(*),
             'faltante', coalesce(sum(tramo) FILTER (WHERE tramo <= -0.01), 0),
             'sobrante', coalesce(sum(tramo) FILTER (WHERE tramo >= 0.01), 0),
             'lista', coalesce(jsonb_agg(jsonb_build_object('hora', hora, 'tramo', tramo) ORDER BY hora)
                               FILTER (WHERE abs(tramo) >= 0.01), '[]'::jsonb))
      INTO v_cortes FROM c;

    -- Vencimientos con lote REAL: el «GENERICO» trae fecha de relleno.
    WITH l AS (
        SELECT i.erp_product_id, i.descripcion, i.lote, i.fecha_vencimiento AS vence, sum(i.cantidad) AS unidades
          FROM public.inventory i
         WHERE i.erp_sucursal_id = v_suc AND NOT i.is_vencidos AND i.cantidad > 0
           AND i.fecha_vencimiento IS NOT NULL AND i.fecha_vencimiento <= p_fecha + 60
           AND coalesce(btrim(i.lote), '') <> '' AND upper(btrim(i.lote)) <> 'GENERICO'
         GROUP BY 1, 2, 3, 4
    )
    SELECT jsonb_build_object(
             'vencidos', coalesce(jsonb_agg(jsonb_build_object('id', erp_product_id, 'producto', descripcion,
                                  'lote', lote, 'vence', vence, 'unidades', unidades) ORDER BY vence)
                                  FILTER (WHERE vence <= p_fecha), '[]'::jsonb),
             'por_vencer', coalesce(jsonb_agg(jsonb_build_object('id', erp_product_id, 'producto', descripcion,
                                  'lote', lote, 'vence', vence, 'unidades', unidades) ORDER BY vence)
                                  FILTER (WHERE vence > p_fecha), '[]'::jsonb))
      INTO v_venc FROM l;

    RETURN jsonb_build_object(
        'fecha', p_fecha, 'feriado', v_feriado,
        'ventas', jsonb_build_object('dia', v_dia, 'promedio', round(v_prom, 2), 'semanas', v_sem,
                                     'cambio_pct', CASE WHEN v_prom > 0 AND v_dia IS NOT NULL
                                                        THEN round((v_dia - v_prom) / v_prom * 100, 1) END),
        'meta', v_meta, 'faltantes_a', v_falt, 'cortes', v_cortes, 'vencimiento', v_venc);
END;
$$;

-- ── Qué se salió de lo normal. Escrito en palabras de la sala: la IA lo pule,
-- pero si la IA falla, esto ES el resumen.
CREATE OR REPLACE FUNCTION public.resumen_sala_novedades(p_branch_id bigint, p_ind jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_out jsonb := '[]'::jsonb;
    v_f date := (p_ind->>'fecha')::date;
    v_dias text[] := ARRAY['domingos','lunes','martes','miércoles','jueves','viernes','sábados'];
    v_cambio numeric := (p_ind->'ventas'->>'cambio_pct')::numeric;
    v_prev jsonb;
    v_hist_avg numeric; v_hist_n integer;
    v_falt integer := (p_ind->'faltantes_a'->>'total')::integer;
    v_nuevos jsonb;
    v_pct numeric := (p_ind->'meta'->>'pct_proyectado')::numeric;
    v_dinero numeric;
BEGIN
    SELECT r.indicadores INTO v_prev FROM public.resumen_sala_diario r
     WHERE r.branch_id = p_branch_id AND r.fecha < v_f ORDER BY r.fecha DESC LIMIT 1;

    -- 1 · Ventas contra sus mismos días de la semana.
    IF p_ind->>'feriado' IS NULL AND coalesce((p_ind->'ventas'->>'semanas')::int, 0) >= 4
       AND v_cambio IS NOT NULL AND abs(v_cambio) >= 20 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'ventas', 'nivel', CASE WHEN v_cambio <= -35 THEN 'alta' ELSE 'media' END,
            'texto', format('Vendió $%s, %s%% %s que su promedio de los %s ($%s).',
                            to_char((p_ind->'ventas'->>'dia')::numeric, 'FM999,990'),
                            abs(round(v_cambio))::text, CASE WHEN v_cambio < 0 THEN 'menos' ELSE 'más' END,
                            v_dias[extract(dow FROM v_f)::int + 1],
                            to_char((p_ind->'ventas'->>'promedio')::numeric, 'FM999,990'))));
    END IF;

    -- 1b · La meta, sólo con una semana de mes andada (antes la proyección es ruido).
    IF v_pct IS NOT NULL AND coalesce((p_ind->'meta'->>'dias')::int, 0) >= 7 AND v_pct < 85 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'meta', 'nivel', 'media',
            'texto', format('Al ritmo de este mes cerraría en el %s%% de su meta.', round(v_pct)::text)));
    END IF;

    -- 2 · Faltantes de alta rotación contra sus últimos 14 días.
    SELECT avg((r.indicadores->'faltantes_a'->>'total')::numeric), count(*) INTO v_hist_avg, v_hist_n
      FROM public.resumen_sala_diario r
     WHERE r.branch_id = p_branch_id AND r.fecha BETWEEN v_f - 14 AND v_f - 1;
    IF v_hist_n >= 5 AND v_falt >= v_hist_avg * 1.5 AND v_falt - v_hist_avg >= 5 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'faltantes', 'nivel', 'media',
            'texto', format('Le faltan %s productos de los que más se venden; lo normal en ella son %s.',
                            v_falt, round(v_hist_avg)::text),
            'productos', (SELECT jsonb_agg(x->>'producto') FROM jsonb_array_elements(p_ind->'faltantes_a'->'lista') x)));
    END IF;

    -- 3 · Cortes con faltante. Un sobrante no se cobra a nadie: sólo se nombra si es grande.
    v_dinero := (p_ind->'cortes'->>'faltante')::numeric;
    IF v_dinero <= -1 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'cortes', 'nivel', 'alta',
            'texto', format('Sus cortes del día cerraron con $%s de faltante.', to_char(abs(v_dinero), 'FM999,990.00'))));
    ELSIF (p_ind->'cortes'->>'sobrante')::numeric >= 10 THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'cortes', 'nivel', 'media',
            'texto', format('Sus cortes del día cerraron con $%s de sobrante.',
                            to_char((p_ind->'cortes'->>'sobrante')::numeric, 'FM999,990.00'))));
    END IF;

    -- 4 · Vencidos a la venta: sólo los NUEVOS respecto del día anterior.
    --     El que ya se dijo ayer sigue en el detalle, no en el titular.
    SELECT jsonb_agg(x) INTO v_nuevos
      FROM jsonb_array_elements(p_ind->'vencimiento'->'vencidos') x
     WHERE v_prev IS NULL OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_prev->'vencimiento'->'vencidos') y
            WHERE y->>'id' = x->>'id' AND y->>'lote' = x->>'lote');
    IF v_nuevos IS NOT NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'vencidos', 'nivel', 'alta',
            'texto', format('%s %s vencido%s y sigue%s a la venta.', jsonb_array_length(v_nuevos),
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN 'producto' ELSE 'productos' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN '' ELSE 's' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN '' ELSE 'n' END),
            'productos', (SELECT jsonb_agg(x->>'producto') FROM jsonb_array_elements(v_nuevos) x)));
    END IF;

    -- 5 · Lo que ENTRA a los 30 días de vencer (no lo que ya estaba adentro).
    SELECT jsonb_agg(x) INTO v_nuevos
      FROM jsonb_array_elements(p_ind->'vencimiento'->'por_vencer') x
     WHERE (x->>'vence')::date <= v_f + 30
       AND (v_prev IS NULL OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_prev->'vencimiento'->'por_vencer') y
            WHERE y->>'id' = x->>'id' AND y->>'lote' = x->>'lote'
              AND (y->>'vence')::date <= (v_prev->>'fecha')::date + 30));
    IF v_nuevos IS NOT NULL THEN
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'clave', 'por_vencer', 'nivel', 'media',
            'texto', format('%s %s vence%s en menos de 30 días.', jsonb_array_length(v_nuevos),
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN 'producto' ELSE 'productos' END,
                            CASE WHEN jsonb_array_length(v_nuevos) = 1 THEN '' ELSE 'n' END),
            'productos', (SELECT jsonb_agg((x->>'producto') || ' (' || to_char((x->>'vence')::date, 'DD/MM') || ')')
                            FROM jsonb_array_elements(v_nuevos) x)));
    END IF;

    RETURN v_out;
END;
$$;

-- ── Prepara las filas del día de TODAS las salas. Lo llama la función que
-- redacta; devuelve lo que hay que redactar. Idempotente: rehacer el día
-- recalcula los números y borra el texto viejo.
CREATE OR REPLACE FUNCTION public.resumen_sala_preparar(p_fecha date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_f date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date - 1);
    v_b record; v_ind jsonb; v_nov jsonb;
BEGIN
    FOR v_b IN SELECT m.branch_id, b.name FROM public.erp_sucursal_map m
                 JOIN public.branches b ON b.id = m.branch_id WHERE NOT m.es_bodega ORDER BY b.name LOOP
        v_ind := public.resumen_sala_indicadores(v_b.branch_id, v_f);
        CONTINUE WHEN v_ind IS NULL;
        v_nov := public.resumen_sala_novedades(v_b.branch_id, v_ind);
        INSERT INTO public.resumen_sala_diario (branch_id, fecha, indicadores, novedades, texto, redactado, redactado_at)
        VALUES (v_b.branch_id, v_f, v_ind, v_nov,
                CASE WHEN jsonb_array_length(v_nov) = 0 THEN 'Sin novedades.' END,
                CASE WHEN jsonb_array_length(v_nov) = 0 THEN 'sin_novedades' END,
                CASE WHEN jsonb_array_length(v_nov) = 0 THEN now() END)
        ON CONFLICT (branch_id, fecha) DO UPDATE
           SET indicadores = EXCLUDED.indicadores, novedades = EXCLUDED.novedades,
               texto = EXCLUDED.texto, redactado = EXCLUDED.redactado, redactado_at = EXCLUDED.redactado_at;
    END LOOP;

    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'sala', b.name, 'fecha', r.fecha,
                                                         'feriado', r.indicadores->>'feriado', 'novedades', r.novedades))
                       FROM public.resumen_sala_diario r JOIN public.branches b ON b.id = r.branch_id
                      WHERE r.fecha = v_f AND r.redactado IS NULL), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.resumen_sala_guardar_texto(p_id bigint, p_texto text, p_redactado text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    UPDATE public.resumen_sala_diario
       SET texto = left(btrim(p_texto), 600), redactado = p_redactado, redactado_at = now()
     WHERE id = p_id;
$$;

-- ── Lectura para la pantalla: la última de cada sala (tarjeta) o la historia
-- de una (ficha). El RLS de la tabla decide qué sala ve cada quien.
CREATE OR REPLACE FUNCTION public.get_resumen_de_salas(p_branch_id bigint DEFAULT NULL, p_dias integer DEFAULT 1)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT coalesce(json_agg(to_json(t) ORDER BY t.branch_id, t.fecha DESC), '[]'::json)
      FROM (
        SELECT r.id, r.branch_id, r.fecha, r.texto, r.redactado, r.novedades,
               CASE WHEN p_branch_id IS NOT NULL THEN r.indicadores END AS indicadores,
               row_number() OVER (PARTITION BY r.branch_id ORDER BY r.fecha DESC) AS n
          FROM public.resumen_sala_diario r
         WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
           AND r.texto IS NOT NULL
      ) t
     WHERE t.n <= greatest(1, least(coalesce(p_dias, 1), 30));
$$;

REVOKE EXECUTE ON FUNCTION public.resumen_sala_feriado(date, text), public.resumen_sala_indicadores(bigint, date),
    public.resumen_sala_novedades(bigint, jsonb), public.resumen_sala_preparar(date),
    public.resumen_sala_guardar_texto(bigint, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resumen_sala_preparar(date), public.resumen_sala_guardar_texto(bigint, text, text),
    public.resumen_sala_indicadores(bigint, date)
    TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_resumen_de_salas(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_resumen_de_salas(bigint, integer) TO authenticated, service_role;

-- 5:30 SV = 11:30 UTC: después del refresco completo de ventas (00:20 SV) y
-- dentro de la ventana sin crons de sincronización.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resumen-diario-salas-0530-sv') THEN
        PERFORM cron.schedule('resumen-diario-salas-0530-sv', '30 11 * * *', $cmd$
  SELECT net.http_post(
    url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/resumen-diario-salas',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'admin_invoke_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$);
    END IF;
END $$;
