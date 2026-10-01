SET lock_timeout = '5s';

-- Movimientos de puntos fuera de lo normal (pedido del usuario, 2026-10-01:
-- «si un cliente se le acumula de forma no habitual, o se le descuenta, me
-- avisaría? para detectar irregularidades»). Aviso inmediato a la persona de
-- `puntos_config.avisar_fallas_a` y la fila queda en Puntos → Avisos.
--
-- Los umbrales salen de MEDIR un año del sistema anterior (oct-2025 → sep-2026,
-- 11,148 días-cliente con compras, 427 canjes):
--   · puntos en un día: mediana 16, p99 281, p99.9 1,121  → 500 (≈41 al año)
--   · ventas a una ficha en un día: mediana 1, p90 2      → 6 (≈1 por día; son
--     justamente los días de 50–214 tickets en una ficha, cargados en un par de
--     horas al cierre y por 5–9 vendedores distintos)
--   · un vendedor a la misma ficha en un día              → 4
--   · salas en un día: 2 es normal (308 al año; las salas de la ciudad quedan a
--     minutos), 3 no (10 al año)                         → 3
--   · canje: mediana 336, p99 2,084                       → 2,000 (≈5 al año)
-- Los ajustes a mano y las ventas que un empleado se hace a sí mismo se avisan
-- SIEMPRE: son pocos y es justo lo que alguien querría esconder.

CREATE TABLE IF NOT EXISTS public.puntos_irregularidad (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Una por hecho: la vuelta siguiente actualiza las cifras, no repite el aviso.
  clave       text NOT NULL UNIQUE,
  tipo        text NOT NULL,
  dia         date NOT NULL,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  sucursal    text,
  invoice_id  bigint,
  -- Quién lo hizo: el vendedor, o quien autorizó el ajuste.
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  puntos      integer,
  nota        text NOT NULL,
  detalle     jsonb,
  avisado_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS puntos_irregularidad_created_at ON public.puntos_irregularidad (created_at);
CREATE INDEX IF NOT EXISTS puntos_irregularidad_customer ON public.puntos_irregularidad (customer_id);
CREATE INDEX IF NOT EXISTS puntos_irregularidad_employee ON public.puntos_irregularidad (employee_id);
ALTER TABLE public.puntos_irregularidad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_irregularidad_select ON public.puntos_irregularidad;
CREATE POLICY puntos_irregularidad_select ON public.puntos_irregularidad
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')));
REVOKE ALL ON public.puntos_irregularidad FROM anon;
-- Sin purga a propósito: es historial de control, no un log técnico, y son
-- pocas filas por semana.

-- El vigía mira las ventas de hoy y ayer cada 5 minutos. Sin esto barre las
-- 120,198 filas migradas cada vez.
CREATE INDEX IF NOT EXISTS puntos_lote_recientes ON public.puntos_lote (ganado_el)
  WHERE origen IN ('venta', 'ajuste');
CREATE INDEX IF NOT EXISTS puntos_salida_recientes ON public.puntos_salida (created_at)
  WHERE tipo IN ('canje', 'ajuste');

CREATE OR REPLACE FUNCTION public.puntos_vigilar_irregularidades(p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_desde date;
  v_hallazgos jsonb;
  v_dest uuid[];
  v_nuevos int := 0;
  r record;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('omitido', 'el programa no funciona en el portal');
  END IF;
  -- Ayer también: lo que entró al filo de la medianoche se juzga completo.
  v_desde := greatest(v_hoy - 1, (SELECT inicio FROM public.puntos_config WHERE id));

  WITH v AS (
    SELECT l.customer_id, l.ganado_el AS dia, l.puntos, l.sucursal, l.invoice_id,
           coalesce(b.name, l.sucursal) AS sala, si.cod_vendedor, si.correlativo, si.created_at
      FROM public.puntos_lote l
      JOIN public.sales_invoices si ON si.id = l.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = l.sucursal
     WHERE l.origen = 'venta' AND l.ganado_el >= v_desde
  ),
  dia AS (
    SELECT customer_id, dia, count(*) AS n, sum(puntos) AS p,
           count(DISTINCT sucursal) AS salas, count(DISTINCT cod_vendedor) AS vendedores,
           string_agg(DISTINCT sala, ', ') AS lista_salas,
           min(created_at) AS primera, max(created_at) AS ultima
      FROM v GROUP BY 1, 2
  ),
  h AS (
    -- 1 · Muchas ventas a la misma ficha en un día.
    SELECT 'muchas_ventas' AS tipo, 'muchas:' || customer_id || ':' || dia AS clave, dia, customer_id,
           NULL::text AS sucursal, NULL::bigint AS invoice_id, NULL::uuid AS employee_id, p::int AS puntos,
           format('%s ventas en un día, de %s vendedores, entre %s y %s', n, vendedores,
                  to_char(primera AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM'),
                  to_char(ultima AT TIME ZONE 'America/El_Salvador', 'HH12:MI AM')) AS nota,
           jsonb_build_object('ventas', n, 'vendedores', vendedores, 'salas', lista_salas) AS detalle
      FROM dia WHERE n >= 6
    UNION ALL
    -- 2 · Muchos puntos en un día (si no es ya por muchas ventas).
    SELECT 'acumulacion_alta', 'alta:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('%s puntos en un día, en %s %s', p, n, CASE WHEN n = 1 THEN 'venta' ELSE 'ventas' END),
           jsonb_build_object('ventas', n)
      FROM dia WHERE p >= 500 AND n < 6
    UNION ALL
    -- 3 · Compras en 3 o más salas el mismo día.
    SELECT 'varias_salas', 'salas:' || customer_id || ':' || dia, dia, customer_id,
           lista_salas, NULL, NULL, p::int,
           format('Compró en %s salas el mismo día (%s)', salas, lista_salas),
           jsonb_build_object('ventas', n, 'salas', lista_salas)
      FROM dia WHERE salas >= 3
    UNION ALL
    -- 4 · Un vendedor carga varias ventas a la misma ficha.
    SELECT 'mismo_vendedor', 'vendedor:' || x.customer_id || ':' || x.cod_vendedor || ':' || x.dia, x.dia,
           x.customer_id, x.salas, NULL, e.id, x.p::int,
           format('%s le cargó %s ventas en un día', coalesce(e.name, 'El vendedor ' || x.cod_vendedor), x.n),
           jsonb_build_object('ventas', x.n, 'cod_vendedor', x.cod_vendedor)
      FROM (SELECT customer_id, dia, cod_vendedor, count(*) n, sum(puntos) p, string_agg(DISTINCT sala, ', ') salas
              FROM v WHERE cod_vendedor IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) >= 4) x
      LEFT JOIN public.employees e ON e.code = x.cod_vendedor
    UNION ALL
    -- 5 · Un empleado se vende a sí mismo (su DUI es el de la ficha).
    SELECT 'venta_a_si_mismo', 'propia:' || v.invoice_id, v.dia, v.customer_id,
           v.sucursal, v.invoice_id, e.id, v.puntos,
           'La vendió un empleado a su propia ficha',
           jsonb_build_object('documento', v.correlativo)
      FROM v
      JOIN public.employees e ON e.code = v.cod_vendedor AND coalesce(e.dui, '') <> ''
      JOIN public.customers c ON c.id = v.customer_id
     WHERE regexp_replace(e.dui, '\D', '', 'g') = regexp_replace(coalesce(c.dui, ''), '\D', '', 'g')
       AND length(regexp_replace(e.dui, '\D', '', 'g')) = 9
    UNION ALL
    -- 6 · Puntos dados a mano. Los del cuadre del arranque no llevan autor.
    SELECT 'ajuste_suma', 'ajuste_lote:' || l.id, l.ganado_el, l.customer_id,
           NULL, NULL, l.creado_por, l.puntos,
           'Puntos dados a mano: ' || coalesce(l.motivo, 'sin motivo'), NULL
      FROM public.puntos_lote l
     WHERE l.origen = 'ajuste' AND l.ganado_el >= v_desde AND l.creado_por IS NOT NULL
    UNION ALL
    -- 7 · Puntos quitados a mano.
    SELECT 'ajuste_resta', 'ajuste_salida:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, NULL, NULL, s.autorizado_por, -s.puntos,
           'Puntos quitados a mano: ' || coalesce(s.motivo, 'sin motivo'), NULL
      FROM public.puntos_salida s
     WHERE s.tipo = 'ajuste' AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND s.autorizado_por IS NOT NULL
    UNION ALL
    -- 8 · Canje grande, o canje hecho con puntos recién ganados.
    SELECT CASE WHEN s.puntos >= 2000 THEN 'canje_grande' ELSE 'canje_recien_ganado' END,
           'canje:' || s.id, (s.created_at AT TIME ZONE 'America/El_Salvador')::date,
           s.customer_id, s.sucursal, s.invoice_id, NULL, s.puntos,
           CASE WHEN s.puntos >= 2000 THEN format('Canje de %s puntos', s.puntos)
                ELSE format('Canjeó %s puntos y %s los ganó en los 3 días anteriores', s.puntos, rec.p) END,
           jsonb_build_object('ganados_3_dias', rec.p)
      FROM public.puntos_salida s
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(l.puntos), 0) AS p FROM public.puntos_lote l
         WHERE l.customer_id = s.customer_id AND l.origen IN ('venta', 'ajuste')
           AND l.ganado_el BETWEEN (s.created_at AT TIME ZONE 'America/El_Salvador')::date - 3
                               AND (s.created_at AT TIME ZONE 'America/El_Salvador')::date) rec
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL
       AND s.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
       AND (s.puntos >= 2000 OR (rec.p >= 300 AND rec.p * 2 >= s.puntos))
    UNION ALL
    -- 9 · Factura anulada cuando sus puntos ya se habían canjeado. Ya figura en
    -- Avisos por su cuenta; acá sólo se agrega para que llegue el aviso.
    SELECT 'anulada_gastada', 'anulada:' || g.invoice_id, (g.created_at AT TIME ZONE 'America/El_Salvador')::date,
           g.customer_id, g.sucursal, g.invoice_id, NULL, g.no_recuperados,
           format('Se anuló una factura cuyos puntos ya se habían canjeado: %s puntos no se recuperaron', g.no_recuperados),
           NULL
      FROM public.puntos_anulacion_gastada g
     WHERE g.created_at >= v_desde::timestamp AT TIME ZONE 'America/El_Salvador'
  )
  SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb) INTO v_hallazgos FROM h;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'desde', v_desde, 'hallazgos', v_hallazgos);
  END IF;

  SELECT ARRAY[e.id] INTO v_dest
    FROM public.puntos_config pc JOIN public.employees e ON e.id = pc.avisar_fallas_a
   WHERE pc.id AND e.status = 'ACTIVO';
  IF v_dest IS NULL THEN
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.status = 'ACTIVO' AND e.role_id IN (2, 3);
  END IF;

  FOR r IN
    WITH ins AS (
      INSERT INTO public.puntos_irregularidad
        (clave, tipo, dia, customer_id, sucursal, invoice_id, employee_id, puntos, nota, detalle)
      SELECT x.clave, x.tipo, x.dia, x.customer_id, x.sucursal, x.invoice_id, x.employee_id, x.puntos, x.nota, x.detalle
        FROM jsonb_to_recordset(v_hallazgos) AS x(clave text, tipo text, dia date, customer_id bigint, sucursal text,
             invoice_id bigint, employee_id uuid, puntos int, nota text, detalle jsonb)
      ON CONFLICT (clave) DO UPDATE
        SET puntos = EXCLUDED.puntos, nota = EXCLUDED.nota, detalle = EXCLUDED.detalle,
            sucursal = EXCLUDED.sucursal, updated_at = now()
        WHERE (puntos_irregularidad.puntos, puntos_irregularidad.nota)
              IS DISTINCT FROM (EXCLUDED.puntos, EXCLUDED.nota)
      RETURNING id, nota, customer_id, avisado_at
    )
    -- Desde la salida del INSERT y no releyendo la tabla: dentro del mismo
    -- comando la consulta de afuera no ve las filas recién insertadas.
    SELECT ins.id, ins.nota, ins.customer_id, c.name AS cliente
      FROM ins LEFT JOIN public.customers c ON c.id = ins.customer_id
     WHERE ins.avisado_at IS NULL
  LOOP
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'PUNTOS_IRREGULAR',
        'Puntos: movimiento fuera de lo normal',
        coalesce(r.cliente, 'Cliente ' || r.customer_id) || ' — ' || r.nota,
        '/puntos?tab=avisos', jsonb_build_object('check_key', 'puntos_irregular:' || r.id), true, NULL);
    END IF;
    UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE id = r.id;
    v_nuevos := v_nuevos + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'hallazgos', jsonb_array_length(v_hallazgos), 'avisados', v_nuevos);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.puntos_vigilar_irregularidades(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_vigilar_irregularidades(boolean) TO service_role;

-- Avisos de Puntos: los de siempre más estos. `anulada_gastada` no se suma:
-- ya figura por su propia fila.
CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(x ORDER BY x.cuando DESC), '[]'::json) INTO v FROM (
    SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
           coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
           s.puntos AS puntos,
           nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron,
           NULL::text AS nota, NULL::uuid AS quien_id, NULL::text AS quien
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', g.created_at, g.customer_id, c.name,
           coalesce(b.name, g.sucursal), si.correlativo, si.id,
           g.no_recuperados, g.no_recuperados, NULL, NULL, NULL
      FROM public.puntos_anulacion_gastada g
      JOIN public.sales_invoices si ON si.id = g.invoice_id
      LEFT JOIN public.customers c ON c.id = g.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = g.sucursal
     WHERE g.created_at >= now() - interval '60 days'
    UNION ALL
    -- Regla del usuario (2026-09-28): un canje no puede dejar la venta en $0.00.
    SELECT 'canje_venta_en_cero', s.created_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.sales_invoices si ON si.id = s.invoice_id
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL AND si.total <= 0
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'canje_devuelto', s.revertida_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int, NULL, NULL, NULL
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at >= now() - interval '60 days'
    UNION ALL
    -- Movimientos fuera de lo normal (2026-10-01).
    SELECT i.tipo, i.created_at, i.customer_id, c.name,
           coalesce(b.name, i.sucursal), si.correlativo, i.invoice_id,
           i.puntos, NULL::int, i.nota, i.employee_id, e.name
      FROM public.puntos_irregularidad i
      LEFT JOIN public.customers c ON c.id = i.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = i.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = i.sucursal
      LEFT JOIN public.employees e ON e.id = i.employee_id
     WHERE i.tipo <> 'anulada_gastada' AND i.created_at >= now() - interval '60 days'
  ) x;
  RETURN v;
END;
$function$;
