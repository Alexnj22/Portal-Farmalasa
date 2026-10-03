-- ════════════════════════════════════════════════════════════════════════════
-- Inyecciones MEZCLADAS: dos en la misma jeringa son UNA aplicación (2026-10-03)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido del usuario: «a veces pasa que se mezclan la cobalex con la tiamina
-- por ejemplo, así que no se cobran 2 aplicaciones sino 1». Decisiones (las
-- dos del usuario): se cobra COMO UNA SOLA y se marca AL COBRAR.
--
-- Cómo queda guardado. Una mezcla de N aplicaciones con K productos son N
-- grupos de K filas: la primera fila de cada grupo es la PRINCIPAL (lleva el
-- precio) y las demás apuntan a ella con `mezcla_de` y llevan precio 0.
--   · cada producto DESCUENTA de su saldo — se usó una ampolla de cada uno, y
--     sin eso el renglón quedaría «por pagar» con la ampolla ya puesta;
--   · se COBRA y se CUENTA una aplicación por grupo — la principal;
--   · pendientes, canje y bitácora muestran el grupo como UNA fila:
--     «COBALEX + TIAMINA», y canjear la principal marca el grupo entero.
--
-- La mezcla viaja en los mismos `items` que ya pasan por `operar-caja` sin
-- tocarlos (`"mezcla": true` en cada uno), igual que la dosis por ml: la
-- función de borde no cambia. Las reglas las valida la base: todos los
-- elegidos mezclados, al menos dos, y la misma cantidad en cada uno.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- Tabla de este mismo circuito (no es de las calientes del sync).
ALTER TABLE public.inyeccion_aplicaciones
  ADD COLUMN mezcla_de bigint REFERENCES public.inyeccion_aplicaciones(id) ON DELETE CASCADE;
CREATE INDEX inyeccion_aplicaciones_mezcla_idx ON public.inyeccion_aplicaciones (mezcla_de) WHERE mezcla_de IS NOT NULL;

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
  v_mez      boolean;
  v_mez_todas boolean;
  v_n_items  integer;
  v_n_cant   integer;
  v_n_mezcla integer;
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

  -- La MEZCLA: todos los elegidos mezclados, al menos dos, la misma cantidad.
  SELECT bool_or(coalesce((e->>'mezcla')::boolean, false)), bool_and(coalesce((e->>'mezcla')::boolean, false)),
         count(*), count(DISTINCT (e->>'cantidad')::int), min((e->>'cantidad')::int)
    INTO v_mez, v_mez_todas, v_n_items, v_n_cant, v_n_mezcla
  FROM jsonb_array_elements(p_items) e;
  IF v_mez AND NOT v_mez_todas THEN RAISE EXCEPTION 'En una mezcla todas las inyecciones elegidas van mezcladas.'; END IF;
  IF v_mez AND v_n_items < 2 THEN RAISE EXCEPTION 'Una mezcla necesita al menos dos inyecciones.'; END IF;
  IF v_mez AND v_n_cant > 1 THEN RAISE EXCEPTION 'En una mezcla todas llevan la misma cantidad.'; END IF;

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

  -- Mezcladas: se cobra UNA aplicación por grupo (decisión del usuario).
  IF v_mez THEN
    SELECT string_agg(r.descripcion
                      || CASE WHEN r.contenido_ml IS NOT NULL THEN ' ' || trim_scale((e->>'dosis_ml')::numeric) || 'ml' ELSE '' END,
                      ' + ' ORDER BY r.linea_num)
      INTO v_producto
    FROM jsonb_array_elements(p_items) e
    JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint;
    v_total := v_n_mezcla;
    v_producto := v_total || 'x ' || v_producto || ' (mezcla)';
  END IF;

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
  v_principal bigint;
  v_id     bigint;
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
  ELSIF coalesce((p_items->0->>'mezcla')::boolean, false) THEN
    -- MEZCLA: N grupos; en cada uno una fila por producto, la primera lleva el
    -- precio y las demás apuntan a ella. Cotizar ya validó que todos van
    -- mezclados con la misma cantidad.
    SELECT id, customer_id, cliente INTO v_venta FROM sales_invoices WHERE id = (p_items->0->>'invoice_id')::bigint;
    FOR i IN 1..(p_items->0->>'cantidad')::int LOOP
      v_principal := NULL;
      FOR e IN SELECT x FROM jsonb_array_elements(p_items) x ORDER BY (x->>'linea_num')::int LOOP
        SELECT descripcion, erp_product_id INTO r FROM sales_invoice_items
         WHERE invoice_id = v_venta.id AND linea_num = (e->>'linea_num')::smallint;
        v_dosis := CASE WHEN EXISTS (SELECT 1 FROM inyeccion_dosis_ml m WHERE m.erp_product_id = r.erp_product_id)
                        THEN nullif(e->>'dosis_ml', '')::numeric END;
        INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente,
                                            producto, precio, cobro_id, creada_por,
                                            aplicada_at, aplicada_por, aplicada_branch_id, dosis_ml, mezcla_de)
        VALUES (v_cobro.branch_id, 'COMPRADA', v_venta.id, (e->>'linea_num')::smallint, v_venta.customer_id,
                coalesce(nullif(upper(trim(coalesce(p_cliente, ''))), ''), v_venta.cliente),
                r.descripcion, CASE WHEN v_principal IS NULL THEN v_precio ELSE 0 END, p_cobro_id, p_por,
                CASE WHEN v_hechas < v_ahora THEN now() END,
                CASE WHEN v_hechas < v_ahora THEN p_por END,
                CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END, v_dosis, v_principal)
        RETURNING id INTO v_id;
        IF v_principal IS NULL THEN v_principal := v_id; END IF;
      END LOOP;
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
             coalesce(a.cliente, si.cliente) AS cliente, a.customer_id,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada, a.precio,
             c.registrado_at AS pagada_at, ec.name AS cobrada_por, a.cobro_id
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      LEFT JOIN LATERAL (
        -- Lo que va mezclado con esta (si es la principal de una mezcla).
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      WHERE a.confirmada AND a.aplicada_at IS NULL
        AND a.mezcla_de IS NULL
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
        AND (v_buscar IS NULL
             OR upper(coalesce(a.cliente, si.cliente, '')) LIKE '%' || v_buscar || '%'
             OR coalesce(si.correlativo, '') LIKE '%' || v_buscar || '%'
             OR upper(a.producto) LIKE '%' || v_buscar || '%'
             OR upper(coalesce(mz.otros, '')) LIKE '%' || v_buscar || '%')
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
             coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.precio, a.cobro_id,
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
      LEFT JOIN LATERAL (
        -- Lo que va mezclado con esta (si es la principal de una mezcla).
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      WHERE a.confirmada
        AND a.mezcla_de IS NULL
        AND c.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id OR a.aplicada_branch_id = p_branch_id)
        AND (v_buscar IS NULL
             OR upper(coalesce(a.cliente, si.cliente, '')) LIKE '%' || v_buscar || '%'
             OR coalesce(si.correlativo, '') LIKE '%' || v_buscar || '%'
             OR upper(a.producto) LIKE '%' || v_buscar || '%'
             OR upper(coalesce(mz.otros, '')) LIKE '%' || v_buscar || '%')
      ORDER BY c.registrado_at DESC
      LIMIT 3000
    ) x
  ), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_aplicar(p_ids bigint[], p_branch_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp  uuid := (SELECT auth_employee_id());
  v_sala integer;
  v_n    integer;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Sin alcance total, sólo en la sala propia (igual que `operar-caja`).
  -- Con alcance total: la sala que se indique, y si no se indica ninguna, la
  -- de cada aplicación (donde se pagó) — NUNCA la de la ficha de quien marca:
  -- medido en pruebas, canjear desde la vista con «todas las salas» dejaba la
  -- aplicación «en Administración».
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL' THEN
    v_sala := (SELECT auth_employee_branch_id());
  ELSE
    v_sala := p_branch_id;
  END IF;
  -- Una mezcla se canjea por su principal y arrastra al grupo entero. Se
  -- cuentan sólo las principales: es lo que la pantalla ofreció.
  WITH u AS (
    UPDATE inyeccion_aplicaciones a
       SET aplicada_at = now(), aplicada_por = v_emp, aplicada_branch_id = coalesce(v_sala, a.branch_id)
     WHERE ((a.id = ANY (p_ids) AND a.mezcla_de IS NULL) OR a.mezcla_de = ANY (p_ids))
       AND a.confirmada AND a.aplicada_at IS NULL
       AND EXISTS (SELECT 1 FROM caja_movimientos_portal c WHERE c.id = a.cobro_id AND c.anulado_at IS NULL)
    RETURNING a.id
  )
  SELECT count(*) FILTER (WHERE u.id = ANY (p_ids)) INTO v_n FROM u;
  IF v_n <> coalesce(array_length(p_ids, 1), 0) THEN
    RAISE EXCEPTION 'Alguna de esas aplicaciones ya no está pendiente. Vuelve a buscar.';
  END IF;
  RETURN v_n;
END;
$function$;