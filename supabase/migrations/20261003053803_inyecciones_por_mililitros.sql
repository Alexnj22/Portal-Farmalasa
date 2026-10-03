-- ════════════════════════════════════════════════════════════════════════════
-- Inyecciones por MILILITROS: el vial y cuánto se pone (2026-10-03)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido del usuario: «RUBRAVIDA, se ponen 3, 4 o 5 con ese vial… el vial viene
-- x 10 ml, normalmente se ponen 2 ml por aplicación o 2.5; que se pueda asignar
-- y preguntar, así si alguien más se la aplica puede ver cuánto es que se pone».
--
-- Hasta acá un producto traía un número FIJO de aplicaciones por unidad. Un
-- vial no: depende de la dosis. Ahora supervisión puede declarar un producto
-- por mililitros —contenido del vial y las dosis que se usan— y al COBRAR se
-- elige la dosis:
--     aplicaciones = unidades vendidas × floor(contenido / dosis)
--     10 ml a 2 ml → 5 · a 2.5 ml → 4
--
-- La dosis elegida queda en CADA aplicación (`inyeccion_aplicaciones.dosis_ml`)
-- y se muestra en pendientes, en el canje y en la bitácora: quien la aplique
-- después ve cuánto se pone sin preguntarle a nadie.
--
-- La dosis se FIJA por renglón con el primer cobro: si la primera vez se cobró
-- a 2.5 ml, los cobros siguientes de esa misma venta son a 2.5. Si no, el saldo
-- dependería de quién cobra: dos cobros a dosis distintas sobre el mismo vial
-- podrían sumar más aplicaciones de las que el vial da.
--
-- Mientras la dosis no se eligió, la lista del cobro muestra el saldo con la
-- dosis MÁS CHICA (el máximo posible): con la grande, una venta a medio cobrar
-- podría desaparecer de la lista teniendo todavía aplicaciones por pagar.
--
-- No cambia `operar-caja`: los renglones le llegan a `inyeccion_cotizar` y a
-- `inyeccion_registrar` tal cual del navegador, y la dosis viaja en cada uno
-- (`dosis_ml`). Lo valida la base —que exista, que sea una de las declaradas y
-- que coincida con la ya fijada— igual que valida el saldo.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ── 1. El catálogo por mililitros ──────────────────────────────────────────
-- Una fila = este producto se cuenta por ml. Sin fila, rige el número fijo
-- (`inyeccion_dosis_producto` o la sugerencia).
CREATE TABLE public.inyeccion_dosis_ml (
  erp_product_id  integer PRIMARY KEY,
  contenido_ml    numeric(6,2) NOT NULL CHECK (contenido_ml > 0 AND contenido_ml <= 500),
  -- Las dosis que se usan, de menor a mayor. Entre 1 y 4: más que eso no es
  -- una pregunta, es un teclado.
  dosis_ml        numeric(5,2)[] NOT NULL CHECK (cardinality(dosis_ml) BETWEEN 1 AND 4),
  confirmado_por  uuid REFERENCES public.employees(id),
  confirmado_at   timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inyeccion_dosis_ml ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inyeccion_dosis_ml FROM anon, authenticated;
GRANT SELECT ON public.inyeccion_dosis_ml TO authenticated;
GRANT ALL ON public.inyeccion_dosis_ml TO service_role;
CREATE POLICY bloqueo_global ON public.inyeccion_dosis_ml AS RESTRICTIVE
  FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY inyeccion_dosis_ml_select ON public.inyeccion_dosis_ml
  FOR SELECT TO authenticated USING (true);

-- ── 2. La dosis de cada aplicación ─────────────────────────────────────────
-- Tabla de este mismo circuito (no es de las calientes del sync).
ALTER TABLE public.inyeccion_aplicaciones ADD COLUMN dosis_ml numeric(5,2) CHECK (dosis_ml > 0);

-- ── 3. Fijar o quitar el conteo por ml. Supervisión. ──────────────────────
-- p_contenido_ml NULL vuelve al número fijo de aplicaciones.
CREATE OR REPLACE FUNCTION public.inyeccion_fijar_ml(p_erp_product_id integer, p_contenido_ml numeric, p_dosis_ml numeric[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_dosis numeric[];
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_erp_product_id) THEN
    RAISE EXCEPTION 'Ese producto no existe.';
  END IF;
  IF p_contenido_ml IS NULL THEN
    DELETE FROM inyeccion_dosis_ml WHERE erp_product_id = p_erp_product_id;
    RETURN;
  END IF;
  -- Sin repetidas, de menor a mayor, con dos decimales.
  SELECT array_agg(DISTINCT round(x, 2) ORDER BY round(x, 2)) INTO v_dosis FROM unnest(p_dosis_ml) x WHERE x IS NOT NULL;
  IF p_contenido_ml <= 0 OR p_contenido_ml > 500 THEN RAISE EXCEPTION 'El contenido tiene que estar entre 0 y 500 ml.'; END IF;
  IF coalesce(cardinality(v_dosis), 0) NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'Entre una y cuatro dosis.'; END IF;
  IF v_dosis[1] <= 0 OR v_dosis[cardinality(v_dosis)] > p_contenido_ml THEN
    RAISE EXCEPTION 'Cada dosis tiene que ser mayor que 0 y no pasar de lo que trae (% ml).', trim_scale(p_contenido_ml);
  END IF;
  INSERT INTO inyeccion_dosis_ml (erp_product_id, contenido_ml, dosis_ml, confirmado_por, confirmado_at)
  VALUES (p_erp_product_id, round(p_contenido_ml, 2), v_dosis, (SELECT auth_employee_id()), now())
  ON CONFLICT (erp_product_id) DO UPDATE
    SET contenido_ml = EXCLUDED.contenido_ml, dosis_ml = EXCLUDED.dosis_ml,
        confirmado_por = EXCLUDED.confirmado_por, confirmado_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_fijar_ml(integer, numeric, numeric[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_fijar_ml(integer, numeric, numeric[]) TO authenticated, service_role;

-- ── 4. Los renglones, con el vial ──────────────────────────────────────────
-- Cambia la forma de lo que devuelve (cuatro columnas nuevas al final), así
-- que se borra y se vuelve a crear. Quienes la llaman leen por NOMBRE.
--   unidades     cantidad × factor (ampollas o viales vendidos)
--   contenido_ml / opciones_ml   el catálogo por ml, si el producto lo tiene
--   dosis_ml     la dosis YA fijada por un cobro anterior de este renglón
DROP FUNCTION public.inyeccion_renglones_de_venta(bigint[]);
CREATE FUNCTION public.inyeccion_renglones_de_venta(p_invoice_ids bigint[])
RETURNS TABLE (invoice_id bigint, linea_num smallint, erp_product_id integer,
               descripcion text, presentacion text, cantidad numeric, factor integer,
               por_unidad integer, confirmado boolean, total integer, usadas integer, disponibles integer,
               unidades numeric, contenido_ml numeric, opciones_ml numeric[], dosis_ml numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
BEGIN
  RETURN QUERY
  WITH r AS MATERIALIZED (
    -- Lo marcado a mano gana; si no, el nombre (= inyeccion_es_aplicable).
    SELECT ii.invoice_id, ii.linea_num, ii.erp_product_id, ii.descripcion, ii.presentacion, ii.cantidad,
           greatest(coalesce(ii.factor_unidades, 1), 1)::int AS factor
    FROM public.sales_invoice_items ii
    LEFT JOIN public.inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
    WHERE ii.invoice_id = ANY (p_invoice_ids)
      AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion))
  ), sueltos AS (
    -- Se vende suelto (alguna presentación con factor > 1) → base 1
    -- (= inyeccion_base_sugerida).
    SELECT DISTINCT pp.product_id FROM public.product_precios pp
    WHERE pp.factor > 1 AND pp.product_id IN (SELECT r.erp_product_id FROM r)
  ), u AS (
    SELECT a.invoice_id, a.linea_num, count(*)::int AS usadas, max(a.dosis_ml) AS dosis_fijada
    FROM public.inyeccion_aplicaciones a
    JOIN public.caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
    WHERE a.invoice_id = ANY (p_invoice_ids)
      AND (a.confirmada OR a.created_at > now() - interval '5 minutes')
    GROUP BY 1, 2
  ), b AS (
    SELECT r.*, coalesce(u.usadas, 0) AS usadas, u.dosis_fijada, m.contenido_ml, m.dosis_ml AS opciones,
           CASE
             -- Por ml: con la dosis fijada; si no hay, con la más chica (el máximo).
             WHEN m.erp_product_id IS NOT NULL
               THEN floor(m.contenido_ml / coalesce(u.dosis_fijada, m.dosis_ml[1]))::int
             WHEN d.aplicaciones IS NOT NULL THEN d.aplicaciones
             WHEN s.product_id IS NOT NULL THEN 1
             ELSE public.inyeccion_aplicaciones_por_nombre(r.descripcion)
           END AS base,
           (m.erp_product_id IS NOT NULL OR d.aplicaciones IS NOT NULL) AS conf
    FROM r
    LEFT JOIN public.inyeccion_dosis_producto d ON d.erp_product_id = r.erp_product_id
    LEFT JOIN public.inyeccion_dosis_ml m ON m.erp_product_id = r.erp_product_id
    LEFT JOIN sueltos s ON s.product_id = r.erp_product_id
    LEFT JOIN u ON u.invoice_id = r.invoice_id AND u.linea_num = r.linea_num
  )
  SELECT b.invoice_id, b.linea_num, b.erp_product_id, b.descripcion, b.presentacion, b.cantidad, b.factor,
         (b.factor * b.base)::int,
         b.conf,
         floor(b.cantidad * b.factor * b.base)::int,
         b.usadas,
         greatest(floor(b.cantidad * b.factor * b.base)::int - b.usadas, 0),
         b.cantidad * b.factor,
         b.contenido_ml, b.opciones, b.dosis_fijada
  FROM b;
END;
$$;
-- Sólo interna: no tiene guarda propia, la ponen quienes la llaman.
REVOKE EXECUTE ON FUNCTION public.inyeccion_renglones_de_venta(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inyeccion_renglones_de_venta(bigint[]) TO service_role;

CREATE OR REPLACE FUNCTION public.inyecciones_para_cobrar(p_branch_id integer, p_buscar text DEFAULT NULL::text, p_dias integer DEFAULT 7)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids    bigint[];
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Igual que `operar-caja`: sin alcance total, sólo la sala propia.
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(si.id) INTO v_ids
  FROM sales_invoices si
  WHERE si.branch_id = p_branch_id
    AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - greatest(least(coalesce(p_dias, 7), 31), 0)
    AND public.venta_valida(si.estado)
    AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                WHERE ii.invoice_id = si.id
                  AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion))
                  -- Se busca por cliente, por factura o por la INYECCIÓN.
                  AND (v_buscar IS NULL
                       OR upper(si.cliente) LIKE '%' || v_buscar || '%'
                       OR si.correlativo LIKE '%' || v_buscar || '%'
                       OR upper(ii.descripcion) LIKE '%' || v_buscar || '%'));

  RETURN coalesce((
    SELECT json_agg(v ORDER BY v.fecha DESC, v.hora DESC NULLS LAST, v.id DESC)
    FROM (
      SELECT si.id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.cliente,
             si.customer_id, si.cod_vendedor, ev.name AS vendedor_nombre, ev.id AS vendedor_id,
             json_agg(json_build_object(
               'linea_num', r.linea_num, 'descripcion', r.descripcion, 'presentacion', r.presentacion,
               'cantidad', r.cantidad, 'por_unidad', r.por_unidad, 'confirmado', r.confirmado,
               'total', r.total, 'usadas', r.usadas, 'disponibles', r.disponibles,
               -- Por ml: la pantalla calcula el saldo de cada dosis con esto.
               'unidades', r.unidades, 'contenido_ml', r.contenido_ml,
               'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml
             ) ORDER BY r.linea_num) AS renglones,
             sum(r.disponibles) AS disponibles
      FROM sales_invoices si
      JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      WHERE si.id = ANY (v_ids)
      GROUP BY si.id, ev.name, ev.id
      -- Sólo las que todavía tienen algo por pagar: una venta ya pagada entera
      -- no es una opción, es ruido en la lista (pedido del usuario).
      HAVING sum(r.disponibles) > 0
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST
      LIMIT 80
    ) v
  ), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_cotizar(p_branch_id integer, p_origen text, p_items jsonb, p_cantidad integer, p_producto text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_precio   numeric;
  v_total    integer := 0;
  v_ids      bigint[];
  v_producto text;
  v_falta    text;
  v_venta    record;
BEGIN
  IF p_origen NOT IN ('COMPRADA', 'TRAIDA') THEN RAISE EXCEPTION 'Falta si la inyección se compró aquí o la trajo el cliente.'; END IF;
  SELECT precio INTO v_precio FROM inyeccion_precios WHERE origen = p_origen;
  IF v_precio IS NULL THEN RAISE EXCEPTION 'No hay precio para %.', p_origen; END IF;

  IF p_origen = 'TRAIDA' THEN
    v_producto := nullif(trim(coalesce(p_producto, '')), '');
    IF v_producto IS NULL THEN RAISE EXCEPTION 'Falta qué inyección trajo el cliente.'; END IF;
    IF coalesce(p_cantidad, 0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'La cantidad de aplicaciones no es válida.'; END IF;
    RETURN json_build_object('precio', v_precio, 'aplicaciones', p_cantidad,
      'monto', round(v_precio * p_cantidad, 2),
      'detalle', 'Traida · ' || p_cantidad || 'x ' || upper(v_producto));
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Falta elegir qué inyecciones de la venta se pagan.';
  END IF;
  SELECT array_agg(DISTINCT (e->>'invoice_id')::bigint) INTO v_ids FROM jsonb_array_elements(p_items) e;
  IF array_length(v_ids, 1) > 1 THEN RAISE EXCEPTION 'Un cobro se asigna a una sola venta.'; END IF;

  SELECT id, branch_id, correlativo INTO v_venta FROM sales_invoices WHERE id = v_ids[1] AND public.venta_valida(estado);
  IF v_venta.id IS NULL THEN RAISE EXCEPTION 'Esa venta no existe o está anulada.'; END IF;
  IF v_venta.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa venta es de otra sala.'; END IF;

  -- La dosis, en los renglones que se cuentan por ml: que venga, que sea una
  -- de las declaradas y que coincida con la ya fijada por un cobro anterior.
  SELECT string_agg(
           CASE WHEN nullif(e->>'dosis_ml', '') IS NULL THEN 'falta elegir cuánto se pone de ' || r.descripcion
                WHEN r.dosis_ml IS NOT NULL AND (e->>'dosis_ml')::numeric <> r.dosis_ml
                  THEN r.descripcion || ' ya se cobró a ' || trim_scale(r.dosis_ml) || ' ml'
                ELSE 'la dosis de ' || r.descripcion || ' no está en el catálogo' END, '; ')
    INTO v_falta
  FROM jsonb_array_elements(p_items) e
  JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint
  WHERE r.contenido_ml IS NOT NULL
    AND (nullif(e->>'dosis_ml', '') IS NULL
         OR NOT ((e->>'dosis_ml')::numeric = ANY (r.opciones_ml))
         OR (r.dosis_ml IS NOT NULL AND (e->>'dosis_ml')::numeric <> r.dosis_ml));
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Revisa la dosis: %.', v_falta;
  END IF;

  -- Cada renglón pedido: que exista, sea inyectable y alcance el saldo (por
  -- ml, el saldo con la dosis elegida).
  SELECT string_agg(coalesce(r.descripcion, 'renglón ' || (e->>'linea_num')), ', ') INTO v_falta
  FROM jsonb_array_elements(p_items) e
  LEFT JOIN public.inyeccion_renglones_de_venta(v_ids) r
    ON r.linea_num = (e->>'linea_num')::smallint
  WHERE r.linea_num IS NULL
     OR coalesce((e->>'cantidad')::int, 0) < 1
     OR (e->>'cantidad')::int > CASE WHEN r.contenido_ml IS NULL THEN r.disponibles
                                     ELSE greatest(floor(r.unidades * floor(r.contenido_ml / (e->>'dosis_ml')::numeric))::int - r.usadas, 0) END;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Ya no quedan esas aplicaciones por pagar: %.', v_falta;
  END IF;

  SELECT sum((e->>'cantidad')::int),
         string_agg((e->>'cantidad') || 'x ' || r.descripcion
                    || CASE WHEN r.contenido_ml IS NOT NULL THEN ' ' || trim_scale((e->>'dosis_ml')::numeric) || 'ml' ELSE '' END,
                    ', ' ORDER BY r.linea_num)
    INTO v_total, v_producto
  FROM jsonb_array_elements(p_items) e
  JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint;

  RETURN json_build_object('precio', v_precio, 'aplicaciones', v_total,
    'monto', round(v_precio * v_total, 2),
    'detalle', 'Fac ' || regexp_replace(coalesce(v_venta.correlativo, ''), '^0+', '') || ' · ' || v_producto);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_registrar(p_cobro_id bigint, p_origen text, p_items jsonb, p_cantidad integer, p_producto text, p_aplicar_ahora integer, p_por uuid, p_cliente text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cobro  record;
  v_cot    json;
  v_precio numeric;
  v_venta  record;
  v_hechas integer := 0;
  v_ahora  integer := greatest(coalesce(p_aplicar_ahora, 0), 0);
  e        jsonb;
  r        record;
  v_dosis  numeric;
  i        integer;
BEGIN
  SELECT id, branch_id, tipo_codigo, anulado_at INTO v_cobro FROM caja_movimientos_portal WHERE id = p_cobro_id;
  IF v_cobro.id IS NULL OR v_cobro.tipo_codigo <> 'APLICACION' OR v_cobro.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El cobro no es una aplicación vigente.';
  END IF;
  IF EXISTS (SELECT 1 FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id) THEN
    RAISE EXCEPTION 'Ese cobro ya tiene sus aplicaciones.';
  END IF;

  IF p_origen = 'COMPRADA' THEN
    -- Candado por VENTA: dos cobros de la misma venta se ponen en fila; dos de
    -- ventas distintas no se esperan.
    PERFORM pg_advisory_xact_lock(hashtext('inyeccion_venta'), (p_items->0->>'invoice_id')::int);
  END IF;
  v_cot := public.inyeccion_cotizar(v_cobro.branch_id, p_origen, p_items, p_cantidad, p_producto);
  v_precio := (v_cot->>'precio')::numeric;

  IF p_origen = 'TRAIDA' THEN
    FOR i IN 1..p_cantidad LOOP
      INSERT INTO inyeccion_aplicaciones (branch_id, origen, cliente, producto, precio, cobro_id, creada_por,
                                          aplicada_at, aplicada_por, aplicada_branch_id)
      VALUES (v_cobro.branch_id, 'TRAIDA', nullif(upper(trim(coalesce(p_cliente, ''))), ''),
              upper(trim(p_producto)), v_precio, p_cobro_id, p_por,
              CASE WHEN v_hechas < v_ahora THEN now() END,
              CASE WHEN v_hechas < v_ahora THEN p_por END,
              CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END);
      v_hechas := v_hechas + 1;
    END LOOP;
  ELSE
    SELECT id, customer_id, cliente INTO v_venta FROM sales_invoices WHERE id = (p_items->0->>'invoice_id')::bigint;
    FOR e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      SELECT descripcion, erp_product_id INTO r FROM sales_invoice_items
       WHERE invoice_id = v_venta.id AND linea_num = (e->>'linea_num')::smallint;
      -- La dosis sólo en lo que se cuenta por ml (ya validada al cotizar).
      v_dosis := CASE WHEN EXISTS (SELECT 1 FROM inyeccion_dosis_ml m WHERE m.erp_product_id = r.erp_product_id)
                      THEN nullif(e->>'dosis_ml', '')::numeric END;
      FOR i IN 1..(e->>'cantidad')::int LOOP
        INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente,
                                            producto, precio, cobro_id, creada_por,
                                            aplicada_at, aplicada_por, aplicada_branch_id, dosis_ml)
        VALUES (v_cobro.branch_id, 'COMPRADA', v_venta.id, (e->>'linea_num')::smallint, v_venta.customer_id,
                coalesce(nullif(upper(trim(coalesce(p_cliente, ''))), ''), v_venta.cliente),
                r.descripcion, v_precio, p_cobro_id, p_por,
                CASE WHEN v_hechas < v_ahora THEN now() END,
                CASE WHEN v_hechas < v_ahora THEN p_por END,
                CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END, v_dosis);
        v_hechas := v_hechas + 1;
      END LOOP;
    END LOOP;
  END IF;

  RETURN json_build_object('aplicaciones', v_hechas, 'aplicadas_ahora', least(v_ahora, v_hechas),
                           'monto', v_cot->'monto', 'detalle', v_cot->'detalle');
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyecciones_pendientes(p_buscar text DEFAULT NULL::text, p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT ((SELECT auth_has_module_permission('caja_vales', 'can_edit'))
          OR (SELECT auth_has_module_permission('inyecciones_tab_pendientes', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit'))
     AND coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.pagada_at DESC)
    FROM (
      SELECT a.id, a.branch_id, b.name AS sala, a.origen, a.invoice_id, si.correlativo,
             coalesce(a.cliente, si.cliente) AS cliente, a.customer_id, a.producto, a.dosis_ml, a.precio,
             c.registrado_at AS pagada_at, ec.name AS cobrada_por, a.cobro_id
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      WHERE a.confirmada AND a.aplicada_at IS NULL
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
        AND (v_buscar IS NULL
             OR upper(coalesce(a.cliente, si.cliente, '')) LIKE '%' || v_buscar || '%'
             OR coalesce(si.correlativo, '') LIKE '%' || v_buscar || '%'
             OR upper(a.producto) LIKE '%' || v_buscar || '%')
      ORDER BY c.registrado_at DESC
      LIMIT 200
    ) x
  ), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyecciones_bitacora(p_branch_id integer, p_desde date, p_hasta date, p_buscar text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_tab_bitacora', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'Rango de fechas inválido (hasta tres meses).';
  END IF;

  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.cobrada_at DESC, x.id DESC)
    FROM (
      SELECT a.id, a.origen, a.branch_id, b.name AS sala, a.invoice_id, si.correlativo,
             coalesce(a.cliente, si.cliente) AS cliente, a.producto, a.dosis_ml, a.precio, a.cobro_id,
             c.registrado_at AS cobrada_at, ec.name AS cobrada_por,
             a.aplicada_at, ea.name AS aplicada_por, a.aplicada_branch_id, ba.name AS aplicada_en,
             (a.vinculada_por IS NOT NULL) AS asignada_a_mano,
             CASE WHEN a.aplicada_at IS NULL THEN 'PENDIENTE' ELSE 'APLICADA' END AS estado
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN branches ba ON ba.id = a.aplicada_branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      LEFT JOIN employees ea ON ea.id = a.aplicada_por
      WHERE a.confirmada
        AND c.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id OR a.aplicada_branch_id = p_branch_id)
        AND (v_buscar IS NULL
             OR upper(coalesce(a.cliente, si.cliente, '')) LIKE '%' || v_buscar || '%'
             OR coalesce(si.correlativo, '') LIKE '%' || v_buscar || '%'
             OR upper(a.producto) LIKE '%' || v_buscar || '%')
      ORDER BY c.registrado_at DESC
      LIMIT 3000
    ) x
  ), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_catalogo_dosis()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT ((SELECT auth_has_module_permission('inyecciones_dosis', 'can_view'))
          OR (SELECT auth_has_module_permission('inyecciones_precios', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH f AS MATERIALIZED (
      SELECT min(id) lo, max(id) hi FROM sales_invoices
      WHERE fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
    ), pares AS MATERIALIZED (
      -- Agrupar ANTES de mirar el nombre: el nombre se evalúa una vez por
      -- (producto, descripción) distinto y no por renglón (1,688 → 243 ms).
      SELECT ii.erp_product_id, ii.descripcion, count(*) AS n
      FROM f JOIN sales_invoice_items ii ON ii.invoice_id BETWEEN f.lo AND f.hi
      WHERE ii.erp_product_id IS NOT NULL
      GROUP BY 1, 2
    ), vendidos AS MATERIALIZED (
      -- Lo vendido en 90 días que el NOMBRE da por inyección, o que alguien
      -- marcó a mano (en cualquier sentido: los quitados también se listan,
      -- para poder volver a incluirlos).
      SELECT g.erp_product_id, max(g.descripcion) AS descripcion, sum(g.n)::bigint AS ventas
      FROM pares g
      WHERE public.es_inyectable(g.descripcion)
         OR EXISTS (SELECT 1 FROM inyeccion_producto_clasificacion c WHERE c.erp_product_id = g.erp_product_id)
      GROUP BY 1
    ), v AS (
      SELECT * FROM vendidos
      UNION ALL
      -- Marcados a mano como inyección que no se vendieron en 90 días.
      SELECT c.erp_product_id, p.nombre, 0
      FROM inyeccion_producto_clasificacion c JOIN products p ON p.id = c.erp_product_id
      WHERE c.es_inyeccion AND NOT EXISTS (SELECT 1 FROM vendidos x WHERE x.erp_product_id = c.erp_product_id)
    )
    SELECT json_agg(json_build_object(
             'erp_product_id', v.erp_product_id,
             'descripcion', coalesce(p.nombre, v.descripcion), 'ventas', v.ventas,
             -- auto: lo decide el nombre · incluido / quitado: marcado a mano.
             'clasificacion', CASE WHEN c.es_inyeccion IS NULL THEN 'auto'
                                   WHEN c.es_inyeccion THEN 'incluido' ELSE 'quitado' END,
             'clasificado_por', ec.name,
             -- Cómo se vende: «suelta y caja de 5». Le dice a quien confirma
             -- qué es la unidad base.
             'factores', (SELECT array_agg(DISTINCT pp.factor ORDER BY pp.factor)
                          FROM product_precios pp WHERE pp.product_id = v.erp_product_id AND pp.factor IS NOT NULL),
             'sugeridas', public.inyeccion_base_sugerida(v.erp_product_id, v.descripcion),
             'confirmadas', d.aplicaciones, 'confirmado_por', e.name, 'confirmado_at', d.confirmado_at,
             -- Por ml: el vial y las dosis que se usan.
             'contenido_ml', m.contenido_ml, 'opciones_ml', m.dosis_ml, 'ml_por', em.name
           ) ORDER BY (c.es_inyeccion IS FALSE), (d.aplicaciones IS NOT NULL OR m.erp_product_id IS NOT NULL), v.ventas DESC)
    FROM v
    LEFT JOIN products p ON p.id = v.erp_product_id
    LEFT JOIN inyeccion_dosis_producto d ON d.erp_product_id = v.erp_product_id
    LEFT JOIN employees e ON e.id = d.confirmado_por
    LEFT JOIN inyeccion_dosis_ml m ON m.erp_product_id = v.erp_product_id
    LEFT JOIN employees em ON em.id = m.confirmado_por
    LEFT JOIN inyeccion_producto_clasificacion c ON c.erp_product_id = v.erp_product_id
    LEFT JOIN employees ec ON ec.id = c.cambiado_por
  ), '[]'::json);
END;
$function$;