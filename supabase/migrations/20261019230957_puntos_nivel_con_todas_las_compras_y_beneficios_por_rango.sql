SET lock_timeout = '5s';

-- ═══ Puntos: el nivel sale de TODAS las compras; raspable y cumpleaños ══════
-- Decisiones del dueño (2026-10-19, auditoría de niveles):
--
-- 1. El nivel se calcula con TODAS las compras válidas de los últimos 12
--    meses (`sales_invoices` con `venta_valida(estado)`: anuladas e
--    invalidadas fuera), no sólo con las que dieron puntos. Antes sumaba
--    `puntos_lote.puntos_base`: quien compraba bebidas, telefonía o a precio de
--    mayoreo «compraba menos» para su nivel de lo que de verdad compró, y la
--    app decía un número que nadie reconocía en sus facturas. Se cuentan
--    también las facturas de una cuenta UNIDA a ésta (`puntos_cuenta
--    .fusionada_en`): sus puntos ya viven acá, su compra también.
--    `sales_invoices` empieza el 2025-05-01, o sea que la ventana de 12 meses
--    ya está completa desde mayo de 2026.
--
-- 2. Raspable (`puntos_dar_cupones`): los premios y el tope salen de lo que se
--    configura en el portal; tope NULL = sin tope (antes NULL era tope 0, o
--    sea «nada»). NO exige haber comprado el mes anterior: lo decidió el dueño
--    y no se agrega esa condición.
--
-- 3. Cliente Mayorista (Condiciones §5), detrás de
--    `puntos_config.mayoreo_beneficios_activos` (APAGADO): mientras sea
--    mayorista aprobado no tiene nivel de Puntos Salud, así que su cumpleaños
--    y su raspable salen de su RANGO (`mayorista_rango`) en
--    `puntos_mayoreo_beneficios`. Apagado, todo sigue como hoy.
--
-- `puntos_acumular` y `ventas_elegibles_puntos` NO se tocan (los cambia el
-- frente de MAYOREO): `puntos_acumular` llama a `puntos_compra_12m` y desde
-- hoy recibe la compra completa, que es justo la decisión 1.
--
-- Medido en prod (EXPLAIN ANALYZE, TIMING OFF) antes de aplicar: la compra de
-- 12 meses del cliente real con más facturas (2,672) entra por
-- `idx_sales_invoices_cliente_fecha` y lee 1,767 bloques en ~15 ms; un
-- cliente típico, decenas. La suma de todos en `puntos_dar_cupones` (una vez
-- al día, y sólo si algún nivel con raspable es alcanzable) es un
-- `Parallel Seq Scan` de 264K facturas: 17,568 bloques (~140 MB), ~300 ms.

-- La cuenta y las que se unieron a ella. Entra por el índice parcial que ya
-- existe (`puntos_cuenta_fusionada_en`): no recorre las 12,762 cuentas.
CREATE OR REPLACE FUNCTION public.puntos_clientes_de(p_customer_id bigint)
RETURNS bigint[] LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT array(SELECT p_customer_id
               UNION
               SELECT pc.customer_id FROM public.puntos_cuenta pc
                WHERE pc.fusionada_en = p_customer_id AND pc.fusionada_en IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_clientes_de(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_clientes_de(bigint) TO authenticated, service_role;

-- ── La compra de 12 meses: todas las facturas válidas ──────────────────────
-- plpgsql + force_custom_plan: el plan bueno depende del cliente y del rango
-- (regla «una función con parámetros se mide seis veces»). Entra por
-- `idx_sales_invoices_cliente_fecha (customer_id, fecha DESC, hora DESC)`.
CREATE OR REPLACE FUNCTION public.puntos_compra_12m(p_customer_id bigint, p_hasta date, p_excluir bigint DEFAULT NULL::bigint)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v_ids bigint[] := public.puntos_clientes_de(p_customer_id);
BEGIN
  RETURN coalesce((
    SELECT sum(si.total) FROM public.sales_invoices si
     WHERE si.customer_id = ANY (v_ids)
       AND si.fecha > p_hasta - 365 AND si.fecha <= p_hasta
       AND public.venta_valida(si.estado)
       AND (p_excluir IS NULL OR si.id <> p_excluir)), 0);
END $function$;

-- ── ¿Subió de nivel con ESTA compra? ────────────────────────────────────────
-- Para el aviso «¡Subiste a X!» (`avisos-clientes`). Compara la compra de 12
-- meses ANTES de la factura (sin ella ni las posteriores del mismo día) con la
-- de DESPUÉS. Sólo aparece quien de verdad sube: al encender los niveles,
-- quien ya estaba en Oro compra y sigue en Oro (antes y después iguales), y
-- bajar no se avisa. Con los niveles apagados no devuelve nada.
CREATE OR REPLACE FUNCTION public.puntos_subieron_de_nivel(p_invoices bigint[])
RETURNS TABLE (customer_id bigint, invoice_id bigint, clave text, nombre text, antes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE v_may boolean;
BEGIN
  IF NOT coalesce((SELECT c.niveles_activos FROM public.puntos_config c WHERE c.id), false) THEN RETURN; END IF;
  SELECT c.mayoreo_beneficios_activos INTO v_may FROM public.puntos_config c WHERE c.id;
  RETURN QUERY
  WITH v AS (
    SELECT si.id, public.puntos_titular(si.customer_id) AS c, si.fecha, coalesce(si.hora, '00:00'::time) AS hora
      FROM public.sales_invoices si
     WHERE si.id = ANY (p_invoices) AND public.venta_valida(si.estado)
  ), m AS (
    SELECT v.id, v.c,
      (SELECT coalesce(sum(s.total), 0) FROM public.sales_invoices s
        WHERE s.customer_id = ANY (public.puntos_clientes_de(v.c))
          AND s.fecha > v.fecha - 365 AND s.fecha <= v.fecha AND public.venta_valida(s.estado)
          AND (s.fecha, coalesce(s.hora, '00:00'::time), s.id) < (v.fecha, v.hora, v.id)) AS compra_antes,
      (SELECT coalesce(sum(s.total), 0) FROM public.sales_invoices s
        WHERE s.customer_id = ANY (public.puntos_clientes_de(v.c))
          AND s.fecha > v.fecha - 365 AND s.fecha <= v.fecha AND public.venta_valida(s.estado)
          AND (s.fecha, coalesce(s.hora, '00:00'::time), s.id) <= (v.fecha, v.hora, v.id)) AS compra_despues
      FROM v
  )
  SELECT m.c, m.id, d.clave, d.nombre, a.clave
    FROM m
    CROSS JOIN LATERAL public.puntos_nivel_de(m.compra_antes) a
    CROSS JOIN LATERAL public.puntos_nivel_de(m.compra_despues) d
   WHERE d.orden > a.orden
     -- Un Cliente Mayorista aprobado no tiene nivel (Condiciones §5), cuando
     -- sus beneficios están encendidos.
     AND NOT (coalesce(v_may, false) AND EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                                                 WHERE cm.customer_id = m.c AND cm.estado = 'aprobado'));
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_subieron_de_nivel(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_subieron_de_nivel(bigint[]) TO service_role;

-- ── Horas para retirar una reserva lista, según el nivel ────────────────────
-- La lectura queda lista para el frente de RESERVAS: hoy
-- `reserva_cambiar_estado` calcula lo mismo en línea (nivel → horas_reserva,
-- 7 días si está pagada). No se toca aquí; cuando ese frente quiera, cambia su
-- cálculo por esta función y los dos números no se pueden separar.
CREATE OR REPLACE FUNCTION public.puntos_horas_reserva(p_customer bigint)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_c bigint := public.puntos_titular(p_customer); v_base integer;
BEGIN
  SELECT n.horas_reserva INTO v_base FROM public.puntos_niveles n ORDER BY n.orden LIMIT 1;
  -- Cliente Mayorista aprobado, con sus beneficios encendidos: sin nivel
  -- (Condiciones §3: ser mayorista no da una reserva más larga).
  IF coalesce((SELECT c.mayoreo_beneficios_activos FROM public.puntos_config c WHERE c.id), false)
     AND EXISTS (SELECT 1 FROM public.clientes_mayoristas cm WHERE cm.customer_id = v_c AND cm.estado = 'aprobado') THEN
    RETURN coalesce(v_base, 24);
  END IF;
  -- Apagados, `puntos_nivel_de` ya devuelve el nivel de entrada: no hace
  -- falta sumar la compra.
  IF NOT coalesce((SELECT c.niveles_activos FROM public.puntos_config c WHERE c.id), false) THEN
    RETURN coalesce(v_base, 24);
  END IF;
  RETURN coalesce((public.puntos_nivel_de(public.puntos_compra_12m(v_c, (now() AT TIME ZONE 'America/El_Salvador')::date))).horas_reserva,
                  v_base, 24);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_horas_reserva(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_horas_reserva(bigint) TO authenticated, service_role;

-- ── Cumpleaños: por nivel, o por rango si es mayorista ─────────────────────
CREATE OR REPLACE FUNCTION public.puntos_dar_cumpleanos(p_dia date DEFAULT NULL::date, p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_pts integer;
  v_bisiesto boolean;
  v_may boolean;
  v_niveles boolean;
  v_rango text;
  r record; v_n integer := 0; v_total bigint := 0; v_n_may integer := 0;
  v_mios integer;
BEGIN
  -- Antes del arranque los regala el sistema anterior: dos a la vez daría dos.
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT puntos_cumpleanos, coalesce(mayoreo_beneficios_activos, false), coalesce(niveles_activos, false)
    INTO v_pts, v_may, v_niveles FROM public.puntos_config WHERE id;
  -- El regalo del nivel de entrada. Desde el 2026-10-19 vive en el nivel y
  -- `puntos_nivel_guardar` mantiene `puntos_config.puntos_cumpleanos` igual.
  v_pts := coalesce((SELECT n.puntos_cumpleanos FROM public.puntos_niveles n ORDER BY n.orden LIMIT 1), v_pts, 0);
  v_bisiesto := (date_part('year', v_dia)::int % 4 = 0 AND date_part('year', v_dia)::int % 100 <> 0)
                OR date_part('year', v_dia)::int % 400 = 0;

  FOR r IN
    SELECT c.id,
           (v_may AND EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                               WHERE cm.customer_id = c.id AND cm.estado = 'aprobado')) AS es_mayorista
      FROM public.customers c
     WHERE c.fecha_nacimiento IS NOT NULL
       AND coalesce(c.acumula_puntos, true)
       -- Tampoco se le regala a quien salió del programa (2026-09-28).
       AND c.acepta_programa_puntos IS DISTINCT FROM false
       -- Ni a una cuenta unida a otra (2026-10-15).
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc
                        WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       AND (to_char(c.fecha_nacimiento, 'MM-DD') = to_char(v_dia, 'MM-DD')
            -- El 29 de febrero, en un año que no lo tiene, cumple el 28.
            OR (NOT v_bisiesto AND to_char(v_dia, 'MM-DD') = '02-28'
                AND to_char(c.fecha_nacimiento, 'MM-DD') = '02-29'))
       -- Ya regalado este año (por el portal).
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.origen = 'cumpleanos'
                          AND date_part('year', l.ganado_el) = date_part('year', v_dia))
       -- Ya regalado a mano en el sistema anterior en los últimos dos meses: la
       -- persona que los daba lo hacía en el mes del cumpleaños, a veces antes.
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.motivo ILIKE 'cortes%cumple%'
                          AND l.ganado_el >= v_dia - 60)
  LOOP
    IF r.es_mayorista THEN
      -- Condiciones §5: Jade 50, Zafiro 75, Rubí y Diamante 100 (configurable).
      -- Sólo persona natural con fecha de nacimiento: la fecha es el filtro.
      v_rango := public.mayorista_rango(r.id);
      v_mios := coalesce((SELECT b.puntos_cumpleanos FROM public.puntos_mayoreo_beneficios b WHERE b.clave = v_rango), v_pts);
    ELSIF v_niveles THEN
      -- Según el nivel (2026-10-07), con la compra completa de 12 meses.
      v_mios := coalesce((public.puntos_nivel_de(public.puntos_compra_12m(r.id, v_dia))).puntos_cumpleanos, v_pts);
    ELSE
      -- Apagados: todos en el nivel de entrada; no hace falta sumar la compra.
      v_mios := v_pts;
    END IF;
    CONTINUE WHEN coalesce(v_mios, 0) <= 0;
    v_n := v_n + 1;
    v_total := v_total + v_mios;
    IF r.es_mayorista THEN v_n_may := v_n_may + 1; END IF;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cumpleanos', v_mios, v_mios, v_dia, public.puntos_vence_el(v_dia), 'Cortesía Cumpleaños');
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_mios, ganados = ganados + v_mios, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total,
                           'mayoristas', v_n_may);
END;
$function$;

-- ── Raspable del mes ────────────────────────────────────────────────────────
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
  v_dado bigint;
  v_pts integer;
  v_may boolean;
  v_por_nivel boolean;
  v_por_rango boolean;
  r record; v_n integer := 0; v_total bigint := 0; v_sin_tope integer := 0; v_n_may integer := 0;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  -- El tope sale del portal; NULL = sin tope (2026-10-19). Antes un NULL
  -- se leía como 0 y no se repartía nada.
  SELECT cupon_presupuesto_mensual, coalesce(mayoreo_beneficios_activos, false)
    INTO v_tope, v_may FROM public.puntos_config WHERE id;
  -- ¿Algún nivel con raspable es alcanzable? (con niveles_activos = false
  -- todos caen en el de entrada). Si no, no se suma la compra de nadie.
  v_por_nivel := EXISTS (SELECT 1 FROM public.puntos_niveles n
                          WHERE (n.cupon_mensual > 0 OR n.cupon_premios IS NOT NULL)
                            AND (public.puntos_nivel_de(n.desde)).clave = n.clave);
  v_por_rango := v_may AND EXISTS (SELECT 1 FROM public.puntos_mayoreo_beneficios b
                                    WHERE b.cupon_mensual > 0 OR b.cupon_premios IS NOT NULL);
  IF NOT v_por_nivel AND NOT v_por_rango THEN
    RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', 0, 'puntos', 0,
                             'vence', v_fin, 'fuera_del_presupuesto', 0, 'omitido', 'ningún nivel da raspable');
  END IF;
  SELECT coalesce(sum(puntos), 0) INTO v_dado FROM public.puntos_lote
   WHERE origen = 'cupon' AND date_trunc('month', ganado_el) = date_trunc('month', v_dia);

  -- NO se pide haber comprado el mes anterior (decisión del dueño, 2026-10-19).
  FOR r IN
    -- 1. Clientes Mayoristas aprobados (Condiciones §5: Rubí y Diamante), si
    --    sus beneficios están encendidos. Son ~45: el rango se calcula uno por uno.
    SELECT c.id, b.cupon_mensual, b.cupon_premios, b.nombre, true AS es_mayorista, b.orden AS prioridad, 0::numeric AS compra
      FROM public.clientes_mayoristas cm
      JOIN public.customers c ON c.id = cm.customer_id
      JOIN public.puntos_mayoreo_beneficios b ON b.clave = public.mayorista_rango(cm.customer_id)
     WHERE v_por_rango AND cm.estado = 'aprobado'
       AND (b.cupon_mensual > 0 OR b.cupon_premios IS NOT NULL)
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
    UNION ALL
    -- 2. Por nivel: la compra completa de 12 meses, la MISMA regla que
    --    `puntos_compra_12m(c.id, v_dia)` en una sola pasada (las facturas de
    --    una cuenta unida suman en la que se queda). Si cambia una, cambia la otra.
    SELECT c.id, n.cupon_mensual, n.cupon_premios, n.nombre, false, -1, x.compra
      FROM (SELECT coalesce(pc.fusionada_en, si.customer_id) AS customer_id, sum(si.total) AS compra
              FROM public.sales_invoices si
              LEFT JOIN public.puntos_cuenta pc ON pc.customer_id = si.customer_id AND pc.fusionada_en IS NOT NULL
             WHERE v_por_nivel AND si.fecha > v_dia - 365 AND si.fecha <= v_dia
               AND public.venta_valida(si.estado)
             GROUP BY 1) x
      JOIN public.customers c ON c.id = x.customer_id
      CROSS JOIN LATERAL public.puntos_nivel_de(x.compra) n
     WHERE (n.cupon_mensual > 0 OR n.cupon_premios IS NOT NULL)
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       -- Mayorista aprobado con sus beneficios encendidos: no tiene nivel.
       AND NOT (v_may AND EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                                   WHERE cm.customer_id = c.id AND cm.estado = 'aprobado'))
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
    ORDER BY 6 DESC, 7 DESC, 1
  LOOP
    v_pts := public.puntos_premio_al_azar(r.cupon_premios, r.cupon_mensual);
    CONTINUE WHEN coalesce(v_pts, 0) <= 0;
    IF v_tope IS NOT NULL AND v_dado + v_total + v_pts > v_tope THEN v_sin_tope := v_sin_tope + 1; CONTINUE; END IF;
    v_n := v_n + 1;
    v_total := v_total + v_pts;
    IF r.es_mayorista THEN v_n_may := v_n_may + 1; END IF;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    -- «Cupón <nivel o rango> del mes»: la app lo reconoce por ese texto.
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cupon', v_pts, v_pts, v_dia, v_fin, 'Cupón ' || r.nombre || ' del mes');
    UPDATE public.puntos_cuenta SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total,
                           'mayoristas', v_n_may, 'vence', v_fin, 'fuera_del_presupuesto', v_sin_tope);
END $function$;
