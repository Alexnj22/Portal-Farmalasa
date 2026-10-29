-- PENDIENTES 20 — Lote y vencimiento de cada inyección aplicada.
--
-- La factura ya dice el lote de lo comprado aquí: 586 de 934 compradas lo traen
-- con su vencimiento (medido el 2026-10-28). Lo que NO se sabe —y ahora se
-- pide al cobrar, obligatorio (usuario, 2026-10-28)— es:
--   · la inyección que TRAJO el cliente (82): ninguna fuente dice su lote;
--   · la comprada cuyo renglón dice «GENERICO» o viene vacío (348): la
--     factura no identifica la ampolla.
-- En esos casos la caja escribe el lote y el vencimiento mirando la ampolla.
-- Una ampolla vencida no se cobra: se frena antes de mover la caja.
--
-- Se guarda SÓLO lo que no se puede derivar (`lote`/`vence` de la fila); lo
-- que dice la factura se lee de la factura (`inyeccion_lote_aplicado`), así no
-- hay dos copias que puedan divergir.
--
-- El juez es `inyeccion_lote_valido`, y lo llama `inyeccion_cotizar`, que
-- corre ANTES de escribir el movimiento: un lote que falta frena el cobro sin
-- tocar la caja (si fallara en `inyeccion_registrar`, el movimiento ya escrito
-- se anularía).

SET lock_timeout = '5s';

ALTER TABLE public.inyeccion_aplicaciones
    ADD COLUMN lote  text CHECK (lote IS NULL OR (lote = upper(btrim(lote)) AND length(lote) BETWEEN 2 AND 30)),
    ADD COLUMN vence date;

-- ¿El renglón de la venta NO identifica la ampolla?
CREATE FUNCTION public.inyeccion_lote_pide(p_lote text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(nullif(upper(btrim(p_lote)), ''), 'GENERICO') IN ('GENERICO', 'GENÉRICO', 'SIN LOTE', 'N/A', 'NA');
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_lote_pide(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_lote_pide(text) TO authenticated, service_role;

-- El juez: normaliza o lanza con un motivo que la caja pueda leer. El
-- vencimiento llega como fecha o como mes ('2027-05', lo que viene impreso en
-- la ampolla): un mes vale hasta su último día.
CREATE FUNCTION public.inyeccion_lote_valido(p_lote text, p_vence text)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $fn$
DECLARE
    v_lote  text := nullif(upper(btrim(coalesce(p_lote, ''))), '');
    v_txt   text := nullif(btrim(coalesce(p_vence, '')), '');
    v_vence date;
BEGIN
    IF v_lote IS NULL OR public.inyeccion_lote_pide(v_lote) THEN
        RAISE EXCEPTION 'Falta el lote de la ampolla: el que viene impreso en ella.';
    END IF;
    IF length(v_lote) NOT BETWEEN 2 AND 30 THEN
        RAISE EXCEPTION 'El lote «%» no parece un lote: revisa lo impreso en la ampolla.', v_lote;
    END IF;
    IF v_txt IS NULL THEN
        RAISE EXCEPTION 'Falta el vencimiento de la ampolla.';
    END IF;
    BEGIN
        v_vence := CASE WHEN v_txt ~ '^\d{4}-\d{2}$'
                        THEN (to_date(v_txt || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date
                        ELSE v_txt::date END;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'El vencimiento «%» no es una fecha.', v_txt;
    END;
    IF v_vence < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
        RAISE EXCEPTION 'La ampolla del lote % está vencida (%): no se puede aplicar.', v_lote, to_char(v_vence, 'MM/YYYY');
    END IF;
    RETURN jsonb_build_object('lote', v_lote, 'vence', v_vence);
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_lote_valido(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_lote_valido(text, text) TO authenticated, service_role;

-- El lote y vencimiento de lo aplicado, de donde salga: lo escrito al cobrar,
-- o la factura. El vencimiento que la factura no trae se busca en la compra de
-- ese lote (medido: 347 de 347 se encuentran así).
CREATE FUNCTION public.inyeccion_lote_aplicado(p_lote text, p_vence date, p_invoice_id bigint, p_linea smallint)
RETURNS TABLE (lote text, vence date) LANGUAGE sql STABLE
SET search_path = public, extensions AS $fn$
  SELECT p_lote, p_vence WHERE p_lote IS NOT NULL
  UNION ALL
  SELECT upper(btrim(ii.lote)),
         coalesce(ii.fecha_vencimiento,
                  (SELECT max(pi.fecha_vencimiento) FROM public.purchase_receipt_items pi
                    WHERE pi.erp_product_id = ii.erp_product_id
                      AND upper(btrim(pi.lote)) = upper(btrim(ii.lote))))
    FROM public.sales_invoice_items ii
   WHERE p_lote IS NULL AND ii.invoice_id = p_invoice_id AND ii.linea_num = p_linea
     AND NOT public.inyeccion_lote_pide(ii.lote);
$fn$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_lote_aplicado(text, date, bigint, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_lote_aplicado(text, date, bigint, smallint) TO authenticated, service_role;

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
    -- La que trajo el cliente: su lote viene en `p_items[0]` (lote, vence).
    PERFORM public.inyeccion_lote_valido(p_items->0->>'lote', p_items->0->>'vence');
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
  -- Una venta de OTRA sala sí se puede cobrar (2026-10-03): el cliente compra
  -- en una sucursal y se la aplica en otra, con el ticket en la mano. A esa
  -- venta la pantalla sólo llega buscando su número exacto de comprobante
  -- (`inyeccion_venta_por_comprobante`); el cobro y las aplicaciones quedan en
  -- la sala de la CAJA, que es donde entra el dinero y donde se aplica.

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

  -- Los renglones cuya factura no identifica la ampolla traen su lote escrito.
  PERFORM public.inyeccion_lote_valido(e->>'lote', e->>'vence')
     FROM jsonb_array_elements(p_items) e
     JOIN sales_invoice_items ii ON ii.invoice_id = (e->>'invoice_id')::bigint
                                AND ii.linea_num = (e->>'linea_num')::smallint
    WHERE public.inyeccion_lote_pide(ii.lote);

  RETURN json_build_object('precio', v_precio, 'aplicaciones', v_total,
    'monto', round(v_precio * v_total, 2),
    'detalle', 'Fac ' || regexp_replace(coalesce(v_venta.correlativo, ''), '^0+', '') || ' · ' || v_producto);
END;
$function$

;

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
  v_lv     jsonb;
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
    v_lv := public.inyeccion_lote_valido(p_items->0->>'lote', p_items->0->>'vence');
    FOR i IN 1..p_cantidad LOOP
      INSERT INTO inyeccion_aplicaciones (branch_id, origen, cliente, producto, precio, cobro_id, creada_por,
                                          aplicada_at, aplicada_por, aplicada_branch_id, lote, vence)
      VALUES (v_cobro.branch_id, 'TRAIDA', nullif(upper(trim(coalesce(p_cliente, ''))), ''),
              upper(trim(p_producto)), v_precio, p_cobro_id, p_por,
              CASE WHEN v_hechas < v_ahora THEN now() END,
              CASE WHEN v_hechas < v_ahora THEN p_por END,
              CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END,
              v_lv->>'lote', (v_lv->>'vence')::date);
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
        SELECT descripcion, erp_product_id, lote INTO r FROM sales_invoice_items
         WHERE invoice_id = v_venta.id AND linea_num = (e->>'linea_num')::smallint;
        v_dosis := CASE WHEN EXISTS (SELECT 1 FROM inyeccion_dosis_ml m WHERE m.erp_product_id = r.erp_product_id)
                        THEN nullif(e->>'dosis_ml', '')::numeric END;
        v_lv := CASE WHEN public.inyeccion_lote_pide(r.lote)
                     THEN public.inyeccion_lote_valido(e->>'lote', e->>'vence') END;
        INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente,
                                            producto, precio, cobro_id, creada_por,
                                            aplicada_at, aplicada_por, aplicada_branch_id, dosis_ml, mezcla_de,
                                            lote, vence)
        VALUES (v_cobro.branch_id, 'COMPRADA', v_venta.id, (e->>'linea_num')::smallint, v_venta.customer_id,
                coalesce(nullif(upper(trim(coalesce(p_cliente, ''))), ''), v_venta.cliente),
                r.descripcion, CASE WHEN v_principal IS NULL THEN v_precio ELSE 0 END, p_cobro_id, p_por,
                CASE WHEN v_hechas < v_ahora THEN now() END,
                CASE WHEN v_hechas < v_ahora THEN p_por END,
                CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END, v_dosis, v_principal,
                v_lv->>'lote', (v_lv->>'vence')::date)
        RETURNING id INTO v_id;
        IF v_principal IS NULL THEN v_principal := v_id; END IF;
      END LOOP;
      v_hechas := v_hechas + 1;
    END LOOP;
  ELSE
    SELECT id, customer_id, cliente INTO v_venta FROM sales_invoices WHERE id = (p_items->0->>'invoice_id')::bigint;
    FOR e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      SELECT descripcion, erp_product_id, lote INTO r FROM sales_invoice_items
       WHERE invoice_id = v_venta.id AND linea_num = (e->>'linea_num')::smallint;
      -- La dosis sólo en lo que se cuenta por ml (ya validada al cotizar).
      v_dosis := CASE WHEN EXISTS (SELECT 1 FROM inyeccion_dosis_ml m WHERE m.erp_product_id = r.erp_product_id)
                      THEN nullif(e->>'dosis_ml', '')::numeric END;
      v_lv := CASE WHEN public.inyeccion_lote_pide(r.lote)
                   THEN public.inyeccion_lote_valido(e->>'lote', e->>'vence') END;
      FOR i IN 1..(e->>'cantidad')::int LOOP
        INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente,
                                            producto, precio, cobro_id, creada_por,
                                            aplicada_at, aplicada_por, aplicada_branch_id, dosis_ml, lote, vence)
        VALUES (v_cobro.branch_id, 'COMPRADA', v_venta.id, (e->>'linea_num')::smallint, v_venta.customer_id,
                coalesce(nullif(upper(trim(coalesce(p_cliente, ''))), ''), v_venta.cliente),
                r.descripcion, v_precio, p_cobro_id, p_por,
                CASE WHEN v_hechas < v_ahora THEN now() END,
                CASE WHEN v_hechas < v_ahora THEN p_por END,
                CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END, v_dosis,
                v_lv->>'lote', (v_lv->>'vence')::date);
        v_hechas := v_hechas + 1;
      END LOOP;
    END LOOP;
  END IF;

  RETURN json_build_object('aplicaciones', v_hechas, 'aplicadas_ahora', least(v_ahora, v_hechas),
                           'monto', v_cot->'monto', 'detalle', v_cot->'detalle');
END;
$function$

;

CREATE OR REPLACE FUNCTION public.inyecciones_para_cobrar(p_branch_id integer, p_buscar text DEFAULT NULL::text, p_dias integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids    bigint[];
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
  v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_desde  date := v_hoy - greatest(least(coalesce(p_dias, 30), 31), 0);
  v_desde_buscar date := v_hoy - 90;
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
    AND si.fecha >= CASE WHEN v_buscar IS NULL THEN v_desde ELSE least(v_desde, v_desde_buscar) END
    AND public.venta_valida(si.estado)
    -- Se busca por cliente o factura (90 días) o por la INYECCIÓN (ventana normal).
    AND (v_buscar IS NULL
         OR upper(si.cliente) LIKE '%' || v_buscar || '%'
         OR si.correlativo LIKE '%' || v_buscar || '%'
         OR (si.fecha >= v_desde
             AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                         WHERE ii.invoice_id = si.id
                           AND upper(ii.descripcion) LIKE '%' || v_buscar || '%')))
    AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                WHERE ii.invoice_id = si.id
                  AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion)));

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
               'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml,
               -- El lote de la factura; si no identifica la ampolla, la caja lo escribe.
               'lote', nullif(upper(btrim(il.lote)), ''), 'vence', il.fecha_vencimiento,
               'pide_lote', public.inyeccion_lote_pide(il.lote)
             ) ORDER BY r.linea_num) AS renglones,
             sum(r.disponibles) AS disponibles,
             -- Quién y cuándo la cobró la última vez: una venta ya cobrada entera
             -- SIGUE en la lista, deshabilitada, diciendo por qué (2026-10-05).
             (SELECT json_build_object('por', ec.name, 'por_id', c.registrado_por, 'at', c.registrado_at)
                FROM inyeccion_aplicaciones a
                JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
                LEFT JOIN employees ec ON ec.id = c.registrado_por
               WHERE a.invoice_id = si.id AND a.confirmada
               ORDER BY c.registrado_at DESC LIMIT 1) AS ultimo_cobro
      FROM sales_invoices si
      JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.invoice_id = si.id
      LEFT JOIN sales_invoice_items il ON il.invoice_id = r.invoice_id AND il.linea_num = r.linea_num
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      WHERE si.id = ANY (v_ids)
      GROUP BY si.id, ev.name, ev.id
      -- Las ya cobradas enteras TAMBIÉN van (2026-10-05): la pantalla las
      -- muestra deshabilitadas con quién y cuándo las cobró.
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST
      LIMIT 150
    ) v
  ), '[]'::json);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.inyeccion_venta_por_comprobante(p_branch_id integer, p_comprobante text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_q        text := upper(trim(coalesce(p_comprobante, '')));
  v_num      text;
  v_ids      bigint[];
  v_palabras text[];
  v_larga    text;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Quien cobra lo hace en la caja de SU sala (igual que `operar-caja`).
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_q ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' THEN
    -- Código de generación del DTE: único.
    SELECT array_agg(si.id) INTO v_ids
    FROM sales_invoices si WHERE si.codigo_generacion = v_q::uuid;  -- la columna es uuid: usa su índice único
  ELSIF v_q ~ '[A-ZÁÉÍÓÚÑÜ]' AND split_part(v_q, '_', 2) <> 'COF' THEN
    -- El NOMBRE del cliente: cada palabra tiene que aparecer, en cualquier orden.
    SELECT array_agg(w ORDER BY length(w) DESC) INTO v_palabras
    FROM unnest(regexp_split_to_array(public.norm_search(v_q), '\s+')) w
    WHERE length(w) >= 2;
    IF coalesce(array_length(v_palabras, 1), 0) = 0 OR length(v_palabras[1]) < 3 THEN
      RAISE EXCEPTION 'Escribe al menos tres letras del nombre del cliente.';
    END IF;
    v_larga := v_palabras[1];
    SELECT array_agg(si.id) INTO v_ids
    FROM (
      SELECT si.id FROM sales_invoices si
      WHERE si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
        -- La palabra más larga entra por el índice trigram del cliente (un GIN
        -- no acepta `LIKE ALL`); las demás filtran encima.
        AND public.norm_search(si.cliente) LIKE '%' || v_larga || '%'
        AND public.norm_search(si.cliente) LIKE ALL (SELECT '%' || w || '%' FROM unnest(v_palabras) w)
        AND public.venta_valida(si.estado)
        AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                    LEFT JOIN inyeccion_producto_clasificacion cl ON cl.erp_product_id = ii.erp_product_id
                    WHERE ii.invoice_id = si.id
                      AND coalesce(cl.es_inyeccion, public.es_inyectable(ii.descripcion)))
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST LIMIT 20
    ) si;
  ELSE
    -- El correlativo del ticket, con o sin ceros y con o sin el «_COF».
    v_num := ltrim(regexp_replace(split_part(v_q, '_', 1), '[^0-9]', '', 'g'), '0');
    IF v_num = '' THEN RAISE EXCEPTION 'Escribe el número de comprobante del ticket o el nombre del cliente.'; END IF;
    SELECT array_agg(si.id) INTO v_ids
    FROM (
      SELECT si.id FROM sales_invoices si
      WHERE si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
        -- El LIKE entra por el índice trigram del correlativo: sin él la
        -- búsqueda recorría las ~61,000 ventas de 90 días (30,415 bloques por
        -- llamada); con él, 66. La igualdad de abajo es la que decide.
        AND public.norm_search(si.correlativo) LIKE '%' || v_num || '%'
        AND ltrim(split_part(si.correlativo, '_', 1), '0') = v_num
      ORDER BY si.fecha DESC LIMIT 10
    ) si;
  END IF;

  RETURN json_build_object('ventas', coalesce((
    SELECT json_agg(x ORDER BY x.propia DESC, x.fecha DESC, x.id DESC)
    FROM (
      SELECT si.id, si.branch_id, b.name AS sala, (si.branch_id = p_branch_id) AS propia,
             si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.cliente,
             si.customer_id, si.cod_vendedor, ev.name AS vendedor_nombre, ev.id AS vendedor_id,
             coalesce(rr.renglones, '[]'::json) AS renglones, coalesce(rr.disponibles, 0) AS disponibles,
             CASE WHEN NOT public.venta_valida(si.estado) THEN 'anulada'
                  WHEN rr.renglones IS NULL THEN 'sin_inyeccion'
                  WHEN rr.disponibles <= 0 THEN 'pagada'
                  ELSE 'ok' END AS estado
      FROM sales_invoices si
      JOIN branches b ON b.id = si.branch_id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                 'linea_num', r.linea_num, 'descripcion', r.descripcion, 'presentacion', r.presentacion,
                 'cantidad', r.cantidad, 'por_unidad', r.por_unidad, 'confirmado', r.confirmado,
                 'total', r.total, 'usadas', r.usadas, 'disponibles', r.disponibles,
                 'unidades', r.unidades, 'contenido_ml', r.contenido_ml,
                 'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml,
               -- El lote de la factura; si no identifica la ampolla, la caja lo escribe.
               'lote', nullif(upper(btrim(il.lote)), ''), 'vence', il.fecha_vencimiento,
               'pide_lote', public.inyeccion_lote_pide(il.lote)
               ) ORDER BY r.linea_num) AS renglones,
               sum(r.disponibles) AS disponibles
        FROM public.inyeccion_renglones_de_venta(ARRAY[si.id]) r
      LEFT JOIN sales_invoice_items il ON il.invoice_id = r.invoice_id AND il.linea_num = r.linea_num
      ) rr ON true
      WHERE si.id = ANY (coalesce(v_ids, '{}'))
    ) x
  ), '[]'::json));
END;
$function$

;

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
             -- La sala de la VENTA, sólo cuando no es donde se cobró (comprada en otra sucursal).
             CASE WHEN si.branch_id IS DISTINCT FROM a.branch_id THEN bv.name END AS venta_sala,
             coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.precio, a.cobro_id, lt.lote, lt.vence,
             c.registrado_at AS cobrada_at, ec.name AS cobrada_por, c.registrado_por AS cobrada_por_id,
             a.aplicada_at, coalesce(en.name, ea.name) AS aplicada_por, coalesce(a.enfermeria_por, a.aplicada_por) AS aplicada_por_id, ea.name AS marcada_por, public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) AS enfermeria, a.aplicada_branch_id, ba.name AS aplicada_en,
             (a.vinculada_por IS NOT NULL) AS asignada_a_mano,
             CASE WHEN a.aplicada_at IS NULL THEN 'PENDIENTE' ELSE 'APLICADA' END AS estado
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN branches ba ON ba.id = a.aplicada_branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN branches bv ON bv.id = si.branch_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      LEFT JOIN employees ea ON ea.id = a.aplicada_por
      LEFT JOIN employees en ON en.id = a.enfermeria_por
      LEFT JOIN LATERAL (
        -- Lo que va mezclado con esta (si es la principal de una mezcla).
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      LEFT JOIN LATERAL public.inyeccion_lote_aplicado(a.lote, a.vence, a.invoice_id, a.linea_num) lt ON true
      WHERE a.confirmada
        AND a.mezcla_de IS NULL
        AND (a.aplicada_at IS NULL
             OR (SELECT public.auth_has_module_permission('inyecciones_ver_todas', 'can_view'))
             OR a.enfermeria_at IS NOT NULL)
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
$function$

;

CREATE OR REPLACE FUNCTION public.inyecciones_bitacora_buscar(p_branch_id integer, p_desde date, p_hasta date, p_filtros jsonb DEFAULT '[]'::jsonb, p_estado text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_filtros jsonb;
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_estado text := nullif(upper(trim(coalesce(p_estado, ''))), '');
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_tab_bitacora', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;

  -- Sólo los filtros con texto, ya normalizados (mayúsculas y sin tildes).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'campo', lower(coalesce(f->>'campo', 'todo')),
           'texto', translate(upper(trim(f->>'texto')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'))), '[]'::jsonb)
    INTO v_filtros
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_filtros) = 'array' THEN p_filtros ELSE '[]'::jsonb END) f
   WHERE nullif(trim(f->>'texto'), '') IS NOT NULL;

  IF jsonb_array_length(v_filtros) = 0 THEN
    IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 92 THEN
      RAISE EXCEPTION 'Rango de fechas inválido (hasta tres meses).';
    END IF;
  ELSIF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido.';
  END IF;

  RETURN (
    WITH base AS (
      SELECT a.id, a.origen, a.branch_id, b.name AS sala, a.invoice_id, si.correlativo,
             CASE WHEN si.branch_id IS DISTINCT FROM a.branch_id THEN bv.name END AS venta_sala,
             coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.precio, a.cobro_id, lt.lote, lt.vence,
             c.registrado_at AS cobrada_at, ec.name AS cobrada_por, c.registrado_por AS cobrada_por_id,
             ev.name AS vendedor, ev.id AS vendedor_id,
             a.aplicada_at, coalesce(en.name, ea.name) AS aplicada_por, coalesce(a.enfermeria_por, a.aplicada_por) AS aplicada_por_id, ea.name AS marcada_por, public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) AS enfermeria, a.aplicada_branch_id, ba.name AS aplicada_en,
             (a.vinculada_por IS NOT NULL) AS asignada_a_mano, (a.customer_id IS NULL) AS sin_ficha,
             CASE WHEN a.aplicada_at IS NULL THEN 'PENDIENTE' ELSE 'APLICADA' END AS estado
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN branches ba ON ba.id = a.aplicada_branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN branches bv ON bv.id = si.branch_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      LEFT JOIN employees ea ON ea.id = a.aplicada_por
      LEFT JOIN employees en ON en.id = a.enfermeria_por
      LEFT JOIN LATERAL (
        SELECT e.id, e.name FROM employees e
         WHERE si.cod_vendedor IS NOT NULL AND e.code = si.cod_vendedor
         ORDER BY e.id LIMIT 1
      ) ev ON true
      LEFT JOIN LATERAL (
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      LEFT JOIN LATERAL public.inyeccion_lote_aplicado(a.lote, a.vence, a.invoice_id, a.linea_num) lt ON true
      WHERE a.confirmada
        AND a.mezcla_de IS NULL
        AND (a.aplicada_at IS NULL
             OR (SELECT public.auth_has_module_permission('inyecciones_ver_todas', 'can_view'))
             OR a.enfermeria_at IS NOT NULL
             OR ((SELECT public.auth_has_module_permission('inyecciones_confirmar', 'can_edit'))
                 AND public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) = 'POR_CONFIRMAR'))
        AND (p_desde IS NULL OR c.fecha >= p_desde)
        AND (p_hasta IS NULL OR c.fecha <= p_hasta)
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id OR a.aplicada_branch_id = p_branch_id)
        -- Cada filtro se tiene que cumplir: no existe ninguno que falle.
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_filtros) f,
            LATERAL (SELECT '%' || (f->>'texto') || '%' AS pat,
                            translate(upper(coalesce(a.cliente, si.cliente, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS t_cliente,
                            translate(upper(a.producto || ' ' || coalesce(mz.otros, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS t_med,
                            translate(upper(coalesce(ec.name, '') || ' ' || coalesce(ev.name, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS t_vend,
                            coalesce(si.correlativo, '') AS t_fact) t
           WHERE NOT CASE f->>'campo'
             WHEN 'cliente'     THEN t.t_cliente LIKE t.pat
             WHEN 'medicamento' THEN t.t_med LIKE t.pat
             WHEN 'vendedor'    THEN t.t_vend LIKE t.pat
             WHEN 'factura'     THEN t.t_fact LIKE t.pat
             ELSE t.t_cliente LIKE t.pat OR t.t_med LIKE t.pat OR t.t_vend LIKE t.pat OR t.t_fact LIKE t.pat
           END
        )
    ), sel AS (
      SELECT * FROM base WHERE v_estado IS NULL OR estado = v_estado OR (v_estado = 'POR_CONFIRMAR' AND enfermeria = 'POR_CONFIRMAR')
    )
    SELECT json_build_object(
      'total', (SELECT count(*) FROM base),
      'aplicadas', (SELECT count(*) FROM base WHERE estado = 'APLICADA'),
      'monto', (SELECT coalesce(sum(precio), 0) FROM base),
      'total_filtrado', (SELECT count(*) FROM sel),
      'desde', (SELECT min(cobrada_at)::date FROM base),
      'filas', coalesce((
        SELECT json_agg(to_json(x) ORDER BY x.cobrada_at DESC, x.id DESC)
        FROM (SELECT * FROM sel ORDER BY cobrada_at DESC, id DESC LIMIT v_limite OFFSET v_offset) x
      ), '[]'::json)
    )
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.inyecciones_por_confirmar(p_branch_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_confirmar', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.aplicada_at DESC, x.id DESC)
    FROM (
      SELECT a.id, coalesce(a.aplicada_branch_id, a.branch_id) AS sala_id, ba.name AS aplicada_en, lt.lote, lt.vence,
             a.origen, si.correlativo, coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.aplicada_at, ea.name AS aplicada_por, a.aplicada_por AS aplicada_por_id,
             (a.aplicada_at AT TIME ZONE 'America/El_Salvador')::date + 1 AS confirmar_hasta
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      LEFT JOIN branches ba ON ba.id = coalesce(a.aplicada_branch_id, a.branch_id)
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN employees ea ON ea.id = a.aplicada_por
      LEFT JOIN LATERAL (
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      LEFT JOIN LATERAL public.inyeccion_lote_aplicado(a.lote, a.vence, a.invoice_id, a.linea_num) lt ON true
      WHERE a.confirmada AND a.mezcla_de IS NULL
        AND a.aplicada_at > now() - interval '3 days'
        AND public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) = 'POR_CONFIRMAR'
        AND (p_branch_id IS NULL OR coalesce(a.aplicada_branch_id, a.branch_id) = p_branch_id)
      LIMIT 500
    ) x
  ), '[]'::json);
END;
$function$
;
