SET lock_timeout = '5s';

-- ═══ Puntos: respetar la salida del programa, y vigilar que el motor ande ═══
-- Recomendaciones aceptadas por el usuario (2026-09-28), las dos para después
-- del arranque:
--
--  1. «Mis puntos» deja salir del programa (`customers.acepta_programa_puntos =
--     false`), pero la regla de acumulación no lo miraba: esa persona seguía
--     sumando, y el cumpleaños también le llegaba. Hoy nadie salió (0 fichas);
--     el hueco era latente. Reescritas desde su definición VIVA.
--
--  2. Si el motor se detiene, las ventas dejan de sumar puntos SIN ningún error
--     visible — el primero en notarlo es el cliente, días después. El único
--     aviso era un letrero en la vista, que sólo ve quien la abre.
--     `puntos_vigilar_motor` (cron cada 15 min) avisa a Gerencia y
--     Administración cuando, en horario de ventas, hubo ventas con cliente en
--     la última hora y ninguna acumuló. Una vez por día; el horario de avisos
--     del portal decide cuándo llega.

-- ── 1 · La salida del programa se respeta ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND public.venta_valida(si.estado)
        -- Cláusula 3.2: «vale US$1.00 o más». El circuito viejo usa `> 1`.
        AND si.total >= 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        -- Quien salió del programa desde «Mis puntos» no acumula (2026-09-28).
        AND cu.acepta_programa_puntos IS DISTINCT FROM false
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             -- La lista por producto manda sobre el laboratorio (2026-09-28):
             -- chips y bebidas cargados en un laboratorio de farmacia.
             coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)      AS todas,
             bool_or(acumula)  AS lleva_producto
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.customer_id, inv.cod_vendedor, inv.total, inv.fecha,
           -- «Por cada US$1.00 se otorga 1 punto. Las fracciones no acumulan.»
           floor(inv.total)::int AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$function$;

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
  r record; v_n integer := 0;
BEGIN
  -- Antes del arranque los regala el sistema anterior: dos a la vez daría dos.
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT puntos_cumpleanos INTO v_pts FROM public.puntos_config WHERE id;
  IF coalesce(v_pts, 0) <= 0 THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'puntos_cumpleanos en 0');
  END IF;
  v_bisiesto := (date_part('year', v_dia)::int % 4 = 0 AND date_part('year', v_dia)::int % 100 <> 0)
                OR date_part('year', v_dia)::int % 400 = 0;

  FOR r IN
    SELECT c.id
      FROM public.customers c
     WHERE c.fecha_nacimiento IS NOT NULL
       AND coalesce(c.acumula_puntos, true)
       -- Tampoco se le regala a quien salió del programa (2026-09-28).
       AND c.acepta_programa_puntos IS DISTINCT FROM false
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
    v_n := v_n + 1;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cumpleanos', v_pts, v_pts, v_dia, public.puntos_vence_el(v_dia), 'Cortesía Cumpleaños');
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_n * v_pts);
END;
$function$;

-- ── 2 · El vigía del motor ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_vigilar_motor()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ahora timestamp := now() AT TIME ZONE 'America/El_Salvador';
  v_hora int := extract(hour FROM v_ahora)::int;
  v_ventas int;
  v_ultima timestamptz;
  v_clave text := 'puntos_motor_detenido:' || v_ahora::date;
  v_dest uuid[];
BEGIN
  -- Sólo con el programa en el portal, y en horario de ventas (8:00–21:00):
  -- de noche el silencio es lo normal.
  IF public.puntos_fuente() <> 'portal'
     OR NOT coalesce((SELECT acumulacion_activa FROM public.puntos_config WHERE id), false) THEN
    RETURN json_build_object('omitido', 'el programa no funciona en el portal');
  END IF;
  IF v_hora < 8 OR v_hora >= 21 THEN
    RETURN json_build_object('omitido', 'fuera del horario de ventas');
  END IF;

  -- ¿Hubo ventas que debían acumular? Válidas, con cliente, de $1 o más, en la
  -- última hora. Con menos de 3 no se afirma nada: una hora floja no es un
  -- motor caído.
  SELECT count(*) INTO v_ventas
    FROM public.sales_invoices si
    JOIN public.branches b ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
   -- `fecha` primero: tiene índice y `created_at` no, y esto corre cada 15 min.
   WHERE si.fecha >= v_ahora::date - 1
     AND si.created_at >= now() - interval '60 minutes'
     AND public.venta_valida(si.estado) AND si.customer_id IS NOT NULL AND si.total >= 1;
  -- Por la llave primaria hacia atrás: el lote más nuevo, sin recorrer la tabla.
  SELECT created_at INTO v_ultima FROM public.puntos_lote
   WHERE origen = 'venta' ORDER BY id DESC LIMIT 1;

  IF v_ventas < 3 OR (v_ultima IS NOT NULL AND v_ultima >= now() - interval '60 minutes') THEN
    RETURN json_build_object('ok', true, 'ventas_ultima_hora', v_ventas, 'ultima_acumulacion', v_ultima);
  END IF;

  -- Una vez por día: el aviso es para que alguien mire, no una alarma que suena
  -- cada quince minutos hasta que la apaguen.
  IF EXISTS (SELECT 1 FROM public.notifications WHERE metadata->>'check_key' = v_clave)
     OR EXISTS (SELECT 1 FROM public.avisos_diferidos
                 WHERE entregado_at IS NULL AND notificacion->'metadata'->>'check_key' = v_clave) THEN
    RETURN json_build_object('ok', false, 'ya_avisado', true);
  END IF;

  SELECT array_agg(e.id) INTO v_dest FROM public.employees e
   WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  PERFORM public.notify_employees(v_dest, 'PUNTOS_MOTOR_DETENIDO',
    'Los puntos dejaron de acumularse',
    format('En la última hora hubo %s ventas con cliente y ninguna sumó puntos. La última acumulación fue %s. Hay que revisarlo.',
           v_ventas, coalesce(to_char(v_ultima AT TIME ZONE 'America/El_Salvador', 'DD/MM HH12:MI AM'), 'nunca')),
    '/puntos?tab=resumen', jsonb_build_object('check_key', v_clave), true, NULL);
  RETURN json_build_object('ok', false, 'avisado', true, 'ventas_ultima_hora', v_ventas);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_vigilar_motor() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_vigilar_motor() TO service_role;

-- Guarda «sólo si existe» (regla del branch de pruebas).
SELECT cron.unschedule('puntos-vigilar-motor')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'puntos-vigilar-motor');
SELECT cron.schedule('puntos-vigilar-motor', '*/15 * * * *', $c$SELECT public.puntos_vigilar_motor()$c$);
