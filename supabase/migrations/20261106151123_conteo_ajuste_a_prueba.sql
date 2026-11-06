-- El conteo que ajusta el inventario, a prueba de los errores que lo romperían
-- en silencio (auditoría del 2026-11-06, antes de su primer uso).
--
-- Cuatro defectos movían la caja de más o de menos sin dar error:
--   1. Corregir con el lápiz el lote de un renglón del SISTEMA (p. ej. GENERICO
--      → L1) dejaba la comparación contra la existencia vieja: el ajuste salía
--      en 0 y, al reaparecer GENERICO como «llegó después», se podía descontar
--      sin cargar nada. En un conteo que ajusta, el lote del sistema no se
--      corrige: se agrega la línea del lote real y se cuenta 0 en el otro.
--   2. Un producto a medio contar (L1 agregado y contado, GENERICO sin tocar)
--      cargaba el sobrante y no descontaba el faltante. Hoy no se puede
--      finalizar así, y la cola lo omite si llegara.
--   3. Con un conteo finalizado sin aprobar se podía crear otro en la sala, que
--      mide contra la misma existencia: aprobados los dos, la diferencia se
--      aplicaba dos veces.
--   4. (pantalla) la unidad en que se cuenta cada renglón.
--
-- Y lo que pidió el usuario: «que pida lote cuando el producto lo requiera, y
-- vence cuando el producto lo requiera». `products.regulado` decide el lote y
-- `regulado OR perecedero` el vencimiento, en el alta y en la corrección.
--
-- El plan del ajuste se calcula en UN sitio (`conteo_caja_plan`): lo leen la
-- vista previa de la aprobación, el freno al finalizar y la cola. Si cada uno
-- tuviera su copia, lo que se aprueba y lo que se aplica podrían diferir.
SET lock_timeout = '5s';

-- ── La cola acepta «omitido» ───────────────────────────────────────────────
ALTER TABLE public.conteo_caja_movimiento DROP CONSTRAINT IF EXISTS conteo_caja_movimiento_estado_check;
ALTER TABLE public.conteo_caja_movimiento ADD CONSTRAINT conteo_caja_movimiento_estado_check
  CHECK (estado IN ('PENDIENTE','APLICANDO','HECHO','ERROR','INCIERTO','OMITIDO'));

-- ¿Este lote es «sin lote asignado»?
CREATE OR REPLACE FUNCTION public.conteo_lote_es_generico(p_lote text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $$
  SELECT COALESCE(btrim(p_lote), '') = '' OR upper(btrim(p_lote)) IN ('GENERICO','GENÉRICO');
$$;
REVOKE EXECUTE ON FUNCTION public.conteo_lote_es_generico(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_lote_es_generico(text) TO authenticated, service_role;

-- ── El plan: de diferencias por renglón a unidades por lote ────────────────
-- Una fila por producto y área. `a_medio_contar`: tiene renglones medidos y
-- renglones sin medir (nulos o cerrados como cero al finalizar); su ajuste
-- sería parcial y no se aplica.
CREATE OR REPLACE FUNCTION public.conteo_caja_plan(p_conteo_id uuid)
 RETURNS TABLE(erp_product_id integer, is_vencidos boolean, lineas jsonb, a_medio_contar boolean,
               contado_hasta timestamptz, contado_desde timestamptz)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH it AS MATERIALIZED (
    SELECT i.*,
           (i.fisico_cantidad IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_item_history h
                            WHERE h.item_id = i.id AND h.evento = 'CIERRE')) AS medido
    FROM public.conteo_inventario_items i
    WHERE i.conteo_id = p_conteo_id
  ),
  prod AS (
    SELECT it.erp_product_id AS pid, it.is_vencidos AS venc,
           bool_or(it.medido) AND bool_or(NOT it.medido) AS medio,
           max(GREATEST(it.contado_at, it.recontado_at)) FILTER (WHERE it.medido) AS hasta,
           min(it.contado_at) FILTER (WHERE it.medido) AS desde
    FROM it GROUP BY 1, 2
    HAVING bool_or(it.medido)
  ),
  x AS (
    SELECT it.erp_product_id AS pid, it.is_vencidos AS venc,
           COALESCE(NULLIF(btrim(it.lote), ''), '') AS lote,
           it.fecha_vencimiento AS vence,
           sum(it.diferencia * COALESCE(f.factor, 1))::int AS unidades,
           bool_or(f.factor IS NULL) AS sin_factor
    FROM it
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        substring(it.grupo_key FROM '^F(\d+)$')::int,
        substring(it.detalle FROM '^\s*1\s*[xX]\s*(\d+)\s*$')::int) AS factor
    ) f
    WHERE it.medido AND COALESCE(it.diferencia, 0) <> 0
    GROUP BY 1, 2, 3, 4
  ),
  l AS (
    SELECT x.pid, x.venc,
           jsonb_agg(jsonb_build_object('lote', x.lote, 'vence', x.vence, 'unidades', x.unidades,
                                        'factor_desconocido', x.sin_factor)
                     ORDER BY x.unidades DESC, x.lote) AS lineas
    FROM x WHERE x.unidades <> 0 OR x.sin_factor
    GROUP BY 1, 2
  )
  SELECT p.pid, p.venc, l.lineas, p.medio, p.hasta, p.desde
  FROM prod p JOIN l ON l.pid = p.pid AND l.venc = p.venc;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.conteo_caja_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_caja_plan(uuid) TO service_role;

-- ── Lo que impide aplicar un producto, dicho por producto ──────────────────
-- Lo usan el freno al finalizar y la vista previa. `bloquea`: no se puede
-- finalizar con eso; lo que no bloquea es un aviso para quien aprueba.
CREATE OR REPLACE FUNCTION public.conteo_caja_problemas_de(p_conteo_id uuid)
 RETURNS TABLE(erp_product_id integer, is_vencidos boolean, tipo text, detalle text, bloquea boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch bigint;
BEGIN
  SELECT branch_id INTO v_branch FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN QUERY
  WITH plan AS MATERIALIZED (SELECT * FROM public.conteo_caja_plan(p_conteo_id)),
  ln AS (
    SELECT pl.erp_product_id AS pid, pl.is_vencidos AS venc, e->>'lote' AS lote,
           NULLIF(e->>'vence', '') AS vence, (e->>'unidades')::int AS u,
           COALESCE((e->>'factor_desconocido')::boolean, false) AS sf,
           COALESCE(p.regulado, false) AS reg, COALESCE(p.perecedero, false) AS per
    FROM plan pl
    CROSS JOIN LATERAL jsonb_array_elements(pl.lineas) e
    LEFT JOIN public.products p ON p.id = pl.erp_product_id
  )
  -- A medio contar.
  SELECT pl.erp_product_id, pl.is_vencidos, 'A_MEDIO_CONTAR'::text,
         'Tiene renglones contados y otros sin contar: cuenta los que faltan (0 si no hay).'::text, true
  FROM plan pl WHERE pl.a_medio_contar
  UNION ALL
  -- Sobra sin lote en un producto que lo lleva.
  SELECT ln.pid, ln.venc, 'SOBRA_SIN_LOTE',
         'Se contó de más sin lote asignado: agrega la línea del lote impreso y cuenta ahí esas unidades.', true
  FROM ln WHERE ln.u > 0 AND NOT ln.sf AND ln.reg AND public.conteo_lote_es_generico(ln.lote)
  UNION ALL
  -- Sobra sin vencimiento en un producto que lo exige.
  SELECT ln.pid, ln.venc, 'FALTA_VENCE',
         format('Lo que sobra%s no tiene vencimiento: agrega la línea con su fecha.',
                CASE WHEN public.conteo_lote_es_generico(ln.lote) THEN '' ELSE ' del lote ' || ln.lote END), true
  FROM ln WHERE ln.u > 0 AND NOT ln.sf AND (ln.reg OR ln.per) AND ln.vence IS NULL
        AND NOT (ln.reg AND public.conteo_lote_es_generico(ln.lote))
  UNION ALL
  -- Una presentación sin contenido conocido no se puede llevar a unidades.
  SELECT ln.pid, ln.venc, 'SIN_FACTOR',
         'No se sabe cuántas unidades trae una de sus presentaciones: se ajusta a mano.', false
  FROM ln WHERE ln.sf
  UNION ALL
  -- Una venta pegada al momento en que se contó: la existencia que se leyó
  -- pudo no tenerla todavía (el espejo va 1-2 minutos atrás), y el ajuste la
  -- descontaría dos veces. Se avisa para recontar antes de aprobar.
  SELECT pl.erp_product_id, pl.is_vencidos, 'VENTA_CERCA',
         'Se vendió cerca del momento en que se contó: recuéntalo antes de aprobar.', false
  FROM plan pl
  WHERE NOT pl.is_vencidos AND pl.contado_hasta IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.conteo_inventario_items ci
      JOIN public.sales_invoice_items sii ON sii.erp_product_id = ci.erp_product_id
      JOIN public.sales_invoices si ON si.id = sii.invoice_id
      WHERE ci.conteo_id = p_conteo_id AND ci.erp_product_id = pl.erp_product_id
        AND NOT ci.is_vencidos AND ci.fisico_cantidad IS NOT NULL
        AND si.branch_id = v_branch
        AND si.fecha = (GREATEST(ci.contado_at, ci.recontado_at) AT TIME ZONE 'America/El_Salvador')::date
        AND public.venta_valida(si.estado)
        AND (si.fecha + si.hora) BETWEEN
              (GREATEST(ci.contado_at, ci.recontado_at) AT TIME ZONE 'America/El_Salvador') - interval '5 minutes'
          AND (GREATEST(ci.contado_at, ci.recontado_at) AT TIME ZONE 'America/El_Salvador') + interval '1 minute');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.conteo_caja_problemas_de(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_caja_problemas_de(uuid) TO service_role;

-- ── Lo que ve la pantalla antes de finalizar y de aprobar ──────────────────
-- Antes de finalizar sólo los problemas (y sin cantidades: un conteo a ciegas
-- no puede enterarse del sistema por acá). Ya finalizado, el plan completo.
CREATE OR REPLACE FUNCTION public.get_conteo_caja_plan(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_plan boolean;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_view') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF NOT v_conteo.aplica_en_caja THEN
    RETURN json_build_object('aplica_en_caja', false);
  END IF;
  v_plan := v_conteo.status IN ('FINALIZADO','CERRADO');

  RETURN json_build_object(
    'aplica_en_caja', true,
    'problemas', COALESCE((
      SELECT json_agg(json_build_object(
               'erp_product_id', q.erp_product_id, 'producto', p.nombre, 'is_vencidos', q.is_vencidos,
               'tipo', q.tipo, 'detalle', q.detalle, 'bloquea', q.bloquea)
             ORDER BY q.bloquea DESC, p.nombre)
      FROM public.conteo_caja_problemas_de(p_conteo_id) q
      LEFT JOIN public.products p ON p.id = q.erp_product_id
      WHERE v_plan OR q.tipo IN ('A_MEDIO_CONTAR','SOBRA_SIN_LOTE','FALTA_VENCE')), '[]'::json),
    'productos', CASE WHEN v_plan THEN COALESCE((
      SELECT json_agg(json_build_object(
               'erp_product_id', pl.erp_product_id, 'producto', p.nombre, 'is_vencidos', pl.is_vencidos,
               'regulado', COALESCE(p.regulado, false), 'a_medio_contar', pl.a_medio_contar,
               'lineas', pl.lineas)
             ORDER BY p.nombre)
      FROM public.conteo_caja_plan(p_conteo_id) pl
      LEFT JOIN public.products p ON p.id = pl.erp_product_id), '[]'::json) END);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_conteo_caja_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_caja_plan(uuid) TO authenticated, service_role;

-- ── Crear: no dos ajustes sobre la misma existencia ─────────────────────────
CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(
  p_branch_id bigint, p_scope_type text, p_scope_filter jsonb DEFAULT NULL::jsonb,
  p_erp_product_ids integer[] DEFAULT NULL::integer[], p_modo text DEFAULT 'LOTE'::text,
  p_fuente_sistema text DEFAULT 'HOJA'::text, p_aplica_en_caja boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_erp_sucursal_ids int[];
  v_ciclico_ids int[];
  v_composicion jsonb;
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND p_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_scope_type NOT IN ('TOTAL','LABORATORIO','BAJO_RECETA','MANUAL','CICLICO') THEN
    RAISE EXCEPTION 'ALCANCE_INVALIDO';
  END IF;
  IF p_modo NOT IN ('LOTE','SIMPLE') THEN
    RAISE EXCEPTION 'MODO_INVALIDO';
  END IF;
  IF p_fuente_sistema NOT IN ('VIVO','HOJA') THEN
    RAISE EXCEPTION 'FUENTE_SISTEMA_INVALIDA';
  END IF;
  -- Corregir la caja exige saber el lote de cada unidad y lo que el sistema
  -- decía al contarla: por lote y en vivo, sin excepción.
  IF p_aplica_en_caja AND (p_modo <> 'LOTE' OR p_fuente_sistema <> 'VIVO') THEN
    RAISE EXCEPTION 'CAJA_REQUIERE_LOTE_EN_VIVO';
  END IF;

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen.
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
  END IF;
  -- Y uno que ajusta, con otro que ajusta y todavía no terminó de aplicarse:
  -- los dos medirían contra la misma existencia y la diferencia entraría dos
  -- veces (2026-11-06).
  IF p_aplica_en_caja AND EXISTS (
       SELECT 1 FROM public.conteos_inventario
       WHERE branch_id = p_branch_id AND aplica_en_caja
         AND (status = 'FINALIZADO' OR caja_estado = 'EN_COLA')) THEN
    RAISE EXCEPTION 'CONTEO_POR_APLICAR_EN_SUCURSAL';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  -- La muestra se sortea EN EL SERVIDOR: si la eligiera el cliente, elegir qué
  -- se cuenta dejaría de ser un control y pasaría a ser una preferencia.
  IF p_scope_type = 'CICLICO' THEN
    SELECT array_agg(s.erp_product_id),
           jsonb_object_agg(s.segmento, s.n)
    INTO v_ciclico_ids, v_composicion
    FROM (
      SELECT erp_product_id, segmento, count(*) OVER (PARTITION BY segmento) n
      FROM public.seleccionar_muestra_ciclica(p_branch_id, COALESCE((p_scope_filter->>'tamano')::int, 200))
    ) s;

    IF v_ciclico_ids IS NULL THEN RAISE EXCEPTION 'MUESTRA_CICLICA_VACIA'; END IF;

    p_scope_filter := COALESCE(p_scope_filter, '{}'::jsonb)
      || jsonb_build_object('composicion', v_composicion, 'productos', array_length(v_ciclico_ids, 1));
  END IF;

  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status, modo, fuente_sistema, aplica_en_caja)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO', p_modo, p_fuente_sistema, p_aplica_en_caja)
  RETURNING id INTO v_conteo_id;

  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, source_inventory_id, source_sync_key,
    presentacion, detalle, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, grupo_key)
  SELECT
    v_conteo_id,
    s.erp_product_id,
    CASE WHEN count(*) = 1 THEN min(s.inv_id) END,
    CASE WHEN count(*) = 1 THEN min(s.sync_key) END,
    (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1],
    (array_agg(s.detalle      ORDER BY s.cantidad DESC, s.presentacion))[1],
    s.g_lote,
    s.g_fecha,
    s.is_vencidos,
    sum(s.cantidad)::int,
    sum(s.cantidad)::int,
    public.conteo_costo_unitario(
      s.erp_product_id,
      (array_agg(s.presentacion ORDER BY s.cantidad DESC, s.presentacion))[1]),
    s.gkey
  FROM (
    SELECT i.id AS inv_id, i.sync_key, i.erp_product_id, i.presentacion, i.detalle,
           i.cantidad, i.is_vencidos,
           CASE WHEN p_modo = 'SIMPLE' THEN NULL ELSE i.lote END AS g_lote,
           CASE WHEN p_modo = 'SIMPLE' THEN NULL ELSE i.fecha_vencimiento END AS g_fecha,
           COALESCE(g.grupo_key, 'P:' || upper(btrim(COALESCE(i.presentacion, '')))) AS gkey
    FROM public.inventory i
    LEFT JOIN public.products p ON p.id = i.erp_product_id
    LEFT JOIN public.conteo_presentacion_grupo g
           ON g.product_id = i.erp_product_id
          AND g.pres_key = upper(btrim(COALESCE(i.presentacion, '')))
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
      AND (
        p_scope_type = 'TOTAL'
        OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
        OR (p_scope_type = 'BAJO_RECETA' AND i.erp_product_id = ANY((SELECT public.antibioticos_del_cuadre())))
        OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
        OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
      )
  ) s
  GROUP BY s.erp_product_id, s.is_vencidos, s.gkey, s.g_lote, s.g_fecha;

  RETURN v_conteo_id;
END;
$function$;

-- ── Agregar: lote y vencimiento cuando el producto los pide ────────────────
CREATE OR REPLACE FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_pres text := NULLIF(TRIM(p_presentacion), '');
  v_lote text := NULLIF(upper(TRIM(p_lote)), '');
  v_fecha date := p_fecha_vencimiento;
  v_regulado boolean;
  v_perecedero boolean;
  v_gkey text;
  v_id uuid;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  SELECT COALESCE(regulado, false), COALESCE(perecedero, false) INTO v_regulado, v_perecedero
  FROM public.products WHERE id = p_erp_product_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  IF v_pres IS NULL THEN
    RAISE EXCEPTION 'PRESENTACION_REQUERIDA';
  END IF;

  -- En SIMPLE el renglón no tiene lote NI vencimiento por definición.
  IF v_conteo.modo = 'SIMPLE' THEN
    v_lote := NULL;
    v_fecha := NULL;
  ELSE
    -- El lote lo pide el producto (2026-11-06): uno que no lleva lote vive en
    -- la caja como GENERICO, y uno que lo lleva no acepta GENERICO —sería
    -- volver a crear existencia sin lote, que es lo que el conteo corrige—.
    IF v_regulado THEN
      IF v_lote IS NULL THEN RAISE EXCEPTION 'LOTE_REQUERIDO'; END IF;
      IF public.conteo_lote_es_generico(v_lote) THEN RAISE EXCEPTION 'LOTE_GENERICO_NO_VALE'; END IF;
    ELSE
      v_lote := 'GENERICO';
    END IF;
    IF (v_regulado OR v_perecedero) AND v_fecha IS NULL THEN
      RAISE EXCEPTION 'VENCE_REQUERIDO';
    END IF;
    IF v_fecha IS NOT NULL AND (v_fecha < DATE '2015-01-01' OR v_fecha > current_date + interval '15 years') THEN
      RAISE EXCEPTION 'VENCE_FUERA_DE_RANGO';
    END IF;
  END IF;

  v_gkey := public.conteo_grupo_key(p_erp_product_id, v_pres);

  -- El duplicado se chequea con la MISMA clave con la que agrupa el snapshot:
  -- producto, grupo de presentación, lote y vencimiento. Sin el vencimiento,
  -- el mismo lote con otra fecha —que existe— no se podía agregar.
  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
      AND erp_product_id = p_erp_product_id
      AND NOT is_vencidos
      AND COALESCE(grupo_key,'') = COALESCE(v_gkey,'')
      AND upper(COALESCE(lote,'')) = COALESCE(v_lote,'')
      AND (v_conteo.modo = 'SIMPLE' OR fecha_vencimiento IS NOT DISTINCT FROM v_fecha)
  ) THEN
    IF v_conteo.modo = 'SIMPLE' THEN
      RAISE EXCEPTION 'PRODUCTO_YA_EN_CONTEO';
    ELSE
      RAISE EXCEPTION 'LINEA_YA_EXISTE';
    END IF;
  END IF;

  -- sistema 0 e is_vencidos false son la definición de "apareció algo que el
  -- libro no tiene": todo lo que se cuente aquí es sobrante. El costo lo pone
  -- el servidor con el mismo criterio que el snapshot (C3).
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, presentacion, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, estado_item, es_agregado_manual, grupo_key)
  VALUES (
    p_conteo_id, p_erp_product_id, v_pres, v_lote, v_fecha, false,
    0, 0, public.conteo_costo_unitario(p_erp_product_id, v_pres), 'PENDIENTE', true, v_gkey)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── Corregir la etiqueta: con las mismas reglas, y nunca la del sistema en un
--    conteo que ajusta ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_nuevo_lote text := NULLIF(upper(TRIM(p_lote)), '');
  v_regulado boolean;
  v_perecedero boolean;
  v_lote text;
  v_fecha date;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;
  IF v_conteo.modo = 'SIMPLE' THEN
    RAISE EXCEPTION 'CONTEO_SIMPLE_SIN_LOTE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  -- En un conteo que ajusta, el renglón del sistema ES una existencia de la
  -- caja: cambiarle la etiqueta lo dejaba comparado contra el lote viejo y el
  -- ajuste salía en cero (o descontaba sin cargar). Lo que se corrige es la
  -- línea que se agregó a mano; para el sistema, se agrega la del lote real.
  IF v_conteo.aplica_en_caja AND NOT v_item.es_agregado_manual THEN
    RAISE EXCEPTION 'AJUSTE_NO_CORRIGE_LOTE_DEL_SISTEMA';
  END IF;

  SELECT COALESCE(regulado, false), COALESCE(perecedero, false) INTO v_regulado, v_perecedero
  FROM public.products WHERE id = v_item.erp_product_id;

  IF v_regulado THEN
    IF v_nuevo_lote IS NULL THEN RAISE EXCEPTION 'LOTE_REQUERIDO'; END IF;
    -- Un renglón del sistema que YA dice GENERICO puede seguir diciéndolo
    -- (se corrige su fecha); lo que no se permite es crear uno nuevo así.
    IF public.conteo_lote_es_generico(v_nuevo_lote) AND NOT public.conteo_lote_es_generico(v_item.lote) THEN
      RAISE EXCEPTION 'LOTE_GENERICO_NO_VALE';
    END IF;
  ELSE
    v_nuevo_lote := COALESCE(NULLIF(upper(btrim(v_item.lote)), ''), 'GENERICO');
  END IF;
  -- Vencimiento: lo exige un lote real de un producto con lote, y cualquier
  -- renglón de un perecedero sin lote (su fecha es lo único que lo distingue).
  IF p_fecha_vencimiento IS NULL
     AND ((v_regulado AND NOT public.conteo_lote_es_generico(v_nuevo_lote)) OR (v_perecedero AND NOT v_regulado)) THEN
    RAISE EXCEPTION 'VENCE_REQUERIDO';
  END IF;
  IF p_fecha_vencimiento IS NOT NULL AND (p_fecha_vencimiento < DATE '2015-01-01' OR p_fecha_vencimiento > current_date + interval '15 years') THEN
    RAISE EXCEPTION 'VENCE_FUERA_DE_RANGO';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = v_item.conteo_id AND id <> p_item_id
      AND erp_product_id = v_item.erp_product_id
      AND is_vencidos = v_item.is_vencidos
      AND COALESCE(grupo_key,'') = COALESCE(v_item.grupo_key,'')
      AND upper(COALESCE(lote,'')) = COALESCE(v_nuevo_lote,'')
      AND fecha_vencimiento IS NOT DISTINCT FROM p_fecha_vencimiento
  ) THEN
    RAISE EXCEPTION 'LINEA_YA_EXISTE';
  END IF;

  UPDATE public.conteo_inventario_items
  SET lote = v_nuevo_lote,
      fecha_vencimiento = p_fecha_vencimiento
  WHERE id = p_item_id
  RETURNING lote, fecha_vencimiento INTO v_lote, v_fecha;

  IF (v_item.lote, v_item.fecha_vencimiento) IS DISTINCT FROM (v_lote, v_fecha) THEN
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    VALUES (p_item_id, v_item.fisico_cantidad, v_item.sistema_cantidad, v_item.diferencia, v_item.estado_item,
            format('Etiqueta corregida: lote %s → %s · vence %s → %s',
                   COALESCE(v_item.lote,'—'), COALESCE(v_lote,'—'),
                   COALESCE(v_item.fecha_vencimiento::text,'—'), COALESCE(v_fecha::text,'—')),
            public.auth_employee_id(), 'LOTE');
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'fecha_vencimiento', v_fecha);
END;
$function$;

-- ── Finalizar: un conteo que ajusta no se cierra con un ajuste a medias ────
CREATE OR REPLACE FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_aplica boolean;
  v_total_pend int;
  v_bloqueos int;
  v_res public.conteos_inventario%ROWTYPE;
BEGIN
  SELECT branch_id, aplica_en_caja INTO v_branch_id, v_aplica
  FROM public.conteos_inventario WHERE id = p_conteo_id AND status IN ('BORRADOR','EN_PROGRESO');
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO_O_YA_FINALIZADO';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  -- Se mide ANTES de cerrar pendientes como cero: un producto a medio contar
  -- sigue a medio contar aunque lo que falta se rellene con ceros.
  IF v_aplica THEN
    SELECT count(DISTINCT (q.erp_product_id, q.is_vencidos)) INTO v_bloqueos
    FROM public.conteo_caja_problemas_de(p_conteo_id) q WHERE q.bloquea;
    IF v_bloqueos > 0 THEN
      RAISE EXCEPTION 'AJUSTE_CON_PRODUCTOS_POR_RESOLVER: %', v_bloqueos;
    END IF;
  END IF;

  SELECT count(*) INTO v_total_pend
  FROM public.conteo_inventario_items
  WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;

  IF p_pendientes_como_cero THEN
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    SELECT id, 0, sistema_cantidad, 0 - sistema_cantidad, 'SIN_UBICAR',
           'Cerrado como no ubicado al finalizar el conteo', public.auth_employee_id(), 'CIERRE'
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;

    UPDATE public.conteo_inventario_items
    SET fisico_cantidad = 0,
        diferencia = 0 - sistema_cantidad,
        estado_item = 'SIN_UBICAR',
        contado_por = COALESCE(contado_por, public.auth_employee_id()),
        contado_at = COALESCE(contado_at, now())
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;
  END IF;

  UPDATE public.conteo_inventario_items
  SET diferencia = fisico_cantidad - sistema_cantidad
  WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NOT NULL;

  UPDATE public.conteos_inventario
  SET status = 'FINALIZADO',
      finalizado_por = public.auth_employee_id(),
      finalizado_at = now(),
      total_pendientes = v_total_pend,
      pendientes_como_cero = p_pendientes_como_cero
  WHERE id = p_conteo_id;

  PERFORM public.recalcular_totales_conteo(p_conteo_id);

  SELECT * INTO v_res FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'total_items', v_res.total_items, 'total_contados', v_res.total_contados,
    'total_diferencias', v_res.total_diferencias, 'total_pendientes', v_res.total_pendientes,
    'pendientes_como_cero', v_res.pendientes_como_cero,
    'valor_faltante', CASE WHEN (SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')) THEN v_res.valor_faltante END, 'valor_sobrante', CASE WHEN (SELECT public.auth_has_module_permission('conteo_inventario_ver_montos', 'can_view')) THEN v_res.valor_sobrante END
  );
END;
$function$;

-- ── Encolar: del plan; lo que quedó a medio contar se omite a la vista ─────
CREATE OR REPLACE FUNCTION public.conteo_caja_encolar(p_conteo_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  n int;
BEGIN
  INSERT INTO public.conteo_caja_movimiento (conteo_id, erp_product_id, is_vencidos, lineas, estado, error)
  SELECT p_conteo_id, pl.erp_product_id, pl.is_vencidos, pl.lineas,
         CASE WHEN pl.a_medio_contar THEN 'OMITIDO' ELSE 'PENDIENTE' END,
         CASE WHEN pl.a_medio_contar
              THEN 'Quedó a medio contar: se ajustaría sólo una parte. Se ajusta a mano o en otro conteo.' END
  FROM public.conteo_caja_plan(p_conteo_id) pl
  ON CONFLICT (conteo_id, erp_product_id, is_vencidos) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  PERFORM public.conteo_caja_recalcular(p_conteo_id);
  RETURN n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.conteo_caja_encolar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_caja_encolar(uuid) TO service_role;

-- ── Aprobar: con la misma guarda que crear ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
  v_movs int;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id AND status = 'FINALIZADO' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO_O_NO_FINALIZADO';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_conteo.finalizado_por THEN
    RAISE EXCEPTION 'APROBADOR_ES_QUIEN_FINALIZO';
  END IF;
  IF v_conteo.aplica_en_caja AND EXISTS (
       SELECT 1 FROM public.conteos_inventario
       WHERE branch_id = v_conteo.branch_id AND aplica_en_caja AND id <> p_conteo_id
         AND caja_estado = 'EN_COLA') THEN
    RAISE EXCEPTION 'CONTEO_POR_APLICAR_EN_SUCURSAL';
  END IF;

  UPDATE public.conteos_inventario
  SET status = 'CERRADO', aprobado_por = v_actor, aprobado_at = now(), nota_aprobacion = p_nota
  WHERE id = p_conteo_id;

  IF v_conteo.aplica_en_caja THEN
    v_movs := public.conteo_caja_encolar(p_conteo_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'caja_productos', v_movs);
END;
$function$;

-- ── Tomar: además, si el producto exige vencimiento ────────────────────────
CREATE OR REPLACE FUNCTION public.conteo_caja_tomar()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id uuid;
  v_res json;
BEGIN
  -- Uno que quedó «aplicando» más de 15 minutos se cortó a la mitad: no se
  -- reintenta solo —pudo haber entrado parte—, se deja para revisar.
  UPDATE public.conteo_caja_movimiento
  SET estado = 'INCIERTO', updated_at = now(),
      error = 'Se cortó mientras se aplicaba. Revisa los movimientos del producto antes de reintentar.'
  WHERE estado = 'APLICANDO' AND tomado_at < now() - interval '15 minutes';

  SELECT id INTO v_id FROM public.conteo_caja_movimiento
  WHERE estado = 'PENDIENTE'
  ORDER BY created_at, erp_product_id
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.conteo_caja_movimiento
  SET estado = 'APLICANDO', tomado_at = now(), intentos = intentos + 1, updated_at = now()
  WHERE id = v_id;

  SELECT json_build_object(
    'id', m.id, 'conteo_id', m.conteo_id, 'erp_product_id', m.erp_product_id,
    'is_vencidos', m.is_vencidos, 'lineas', m.lineas,
    'producto', p.nombre, 'sala', b.name,
    'perecedero', COALESCE(p.perecedero, false) OR COALESCE(p.regulado, false),
    'erp_sucursal_id', em.erp_sucursal_id, 'ubicaciones', em.inv_ubicaciones)
  INTO v_res
  FROM public.conteo_caja_movimiento m
  JOIN public.conteos_inventario c ON c.id = m.conteo_id
  JOIN public.branches b ON b.id = c.branch_id
  LEFT JOIN public.erp_sucursal_map em ON em.branch_id = c.branch_id
  LEFT JOIN public.products p ON p.id = m.erp_product_id
  WHERE m.id = v_id
  LIMIT 1;
  RETURN v_res;
END;
$function$;

-- El estado del conteo sale de sus productos. Un omitido no es «aplicado».
CREATE OR REPLACE FUNCTION public.conteo_caja_recalcular(p_conteo_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v text;
BEGIN
  SELECT CASE
           WHEN bool_or(estado IN ('PENDIENTE','APLICANDO')) THEN 'EN_COLA'
           WHEN bool_and(estado = 'HECHO') THEN 'APLICADO'
           ELSE 'CON_PENDIENTES' END
  INTO v FROM public.conteo_caja_movimiento WHERE conteo_id = p_conteo_id;
  UPDATE public.conteos_inventario
  SET caja_estado = COALESCE(v, 'APLICADO'),
      caja_terminado_at = CASE WHEN COALESCE(v, 'APLICADO') = 'EN_COLA' THEN NULL ELSE now() END
  WHERE id = p_conteo_id AND aplica_en_caja;
  RETURN v;
END;
$function$;
