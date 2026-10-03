-- ════════════════════════════════════════════════════════════════════════════
-- Inyecciones compradas en OTRA sucursal: buscar por comprobante (2026-10-03)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Pedido del usuario: «¿qué pasa si la compró en otra sucursal y se la va a
-- aplicar en otra? Para eso pedimos el ticket: que exista la forma de buscar
-- por número de comprobante, y que sólo así permita la búsqueda; aparecería
-- sólo si en esa venta hay una ampolla, si no, que diga que esa venta no
-- corresponde».
--
-- La lista del cobro sigue mostrando sólo la sala de la caja. Una venta de otra
-- sala se alcanza ÚNICAMENTE escribiendo su comprobante — el correlativo del
-- ticket o el código de generación del DTE—: no hay forma de hojear las ventas
-- de las demás salas.
--
-- El número solo NO identifica una venta: medido el 2026-10-03, en 90 días hay
-- 15,036 correlativos que existen en más de una sala (cada sala lleva su serie,
-- y COF y CCF se numeran aparte). Por eso se devuelven todas las coincidencias
-- con su sala, y quien cobra elige la que dice el ticket. El código de
-- generación sí es único.
--
-- Cada coincidencia viene con su ESTADO, para que la pantalla diga por qué no
-- se puede cobrar en vez de no mostrar nada:
--   ok · sin_inyeccion · pagada · anulada
--
-- Pendientes y bitácora dicen además de qué sala es la VENTA (`venta_sala`)
-- cuando no es la sala donde se cobró, y traen los ids de quien cobró y quien
-- aplicó (para su foto). Las pendientes traen el HISTORIAL de su mismo pago:
-- pagó 5, se aplicó 2 en Salud 4 el martes y quedan 3. Pedidos del usuario el
-- mismo día.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.inyeccion_venta_por_comprobante(p_branch_id integer, p_comprobante text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  v_q    text := upper(trim(coalesce(p_comprobante, '')));
  v_num  text;
  v_ids  bigint[];
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
  ELSE
    -- El correlativo del ticket, con o sin ceros y con o sin el «_COF».
    v_num := ltrim(regexp_replace(split_part(v_q, '_', 1), '[^0-9]', '', 'g'), '0');
    IF v_num = '' THEN RAISE EXCEPTION 'Escribe el número de comprobante del ticket.'; END IF;
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
                 'opciones_ml', r.opciones_ml, 'dosis_ml', r.dosis_ml
               ) ORDER BY r.linea_num) AS renglones,
               sum(r.disponibles) AS disponibles
        FROM public.inyeccion_renglones_de_venta(ARRAY[si.id]) r
      ) rr ON true
      WHERE si.id = ANY (coalesce(v_ids, '{}'))
    ) x
  ), '[]'::json));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_venta_por_comprobante(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_venta_por_comprobante(integer, text) TO authenticated, service_role;

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

  RETURN json_build_object('precio', v_precio, 'aplicaciones', v_total,
    'monto', round(v_precio * v_total, 2),
    'detalle', 'Fac ' || regexp_replace(coalesce(v_venta.correlativo, ''), '^0+', '') || ' · ' || v_producto);
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
             -- La sala de la VENTA, sólo cuando no es donde se cobró (comprada en otra sucursal).
             CASE WHEN si.branch_id IS DISTINCT FROM a.branch_id THEN bv.name END AS venta_sala,
             coalesce(a.cliente, si.cliente) AS cliente, a.customer_id,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada, a.precio,
             c.registrado_at AS pagada_at, ec.name AS cobrada_por, c.registrado_por AS cobrada_por_id, a.cobro_id,
             -- Lo que YA se aplicó de este mismo pago: dónde, quién y cuándo
             -- (pedido del usuario: «¿la card muestra el historial de cada una?»).
             (SELECT json_agg(json_build_object('aplicada_at', h.aplicada_at, 'aplicada_por', eh.name,
                                                'aplicada_por_id', h.aplicada_por, 'aplicada_en', bh.name)
                              ORDER BY h.aplicada_at)
                FROM inyeccion_aplicaciones h
                LEFT JOIN employees eh ON eh.id = h.aplicada_por
                LEFT JOIN branches bh ON bh.id = h.aplicada_branch_id
               WHERE h.cobro_id = a.cobro_id AND h.mezcla_de IS NULL AND h.aplicada_at IS NOT NULL
                 AND h.producto = a.producto) AS historial
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN branches bv ON bv.id = si.branch_id
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
             -- La sala de la VENTA, sólo cuando no es donde se cobró (comprada en otra sucursal).
             CASE WHEN si.branch_id IS DISTINCT FROM a.branch_id THEN bv.name END AS venta_sala,
             coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.precio, a.cobro_id,
             c.registrado_at AS cobrada_at, ec.name AS cobrada_por, c.registrado_por AS cobrada_por_id,
             a.aplicada_at, ea.name AS aplicada_por, a.aplicada_por AS aplicada_por_id, a.aplicada_branch_id, ba.name AS aplicada_en,
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