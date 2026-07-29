SET lock_timeout = '5s';

-- ─── M1 — Conteo cíclico mensual ────────────────────────────────────────────
-- En vez de un evento anual de ~4,800 líneas, una muestra chica todos los meses:
-- el ERP nunca se aleja mucho y las diferencias aparecen cuando todavía se
-- pueden investigar. 200 productos por sucursal al mes.
--
-- Reparto (decidido 2026-07-29, sobre el universo real de las farmacias:
-- ~450 A, ~490 B, ~1,400 entre C y sin clase, 23-48 bajo receta):
--
--   BAJO RECETA  100%      — control sanitario, no es muestra: van todos
--   del resto:   60% A     — cada A cae cada ~4-5 meses
--                25% B     — cada B cae ~1 vez al año
--                15% C     — sondeo, no cobertura
--
-- Con 200/mes la clase C no se cubre por ciclo, y está bien: eso lo cubre el
-- conteo TOTAL anual, que sigue existiendo. El ciclo le baja la sorpresa.
--
-- La selección NO es azar puro: prioriza lo que lleva más tiempo sin contarse
-- (nunca contado primero) y desempata al azar. Así nada queda sin contarse
-- jamás, y a la vez el personal no puede predecir qué cae este mes — que es una
-- propiedad de control que conviene conservar.
--
-- VOLATILE a propósito: usa random() para el desempate.
--
-- NOTA: la versión final de seleccionar_muestra_ciclica está en la migración
-- 20260729_conteo_m1b_abc_solo_publicado (usa solo el ABC publicado).

CREATE OR REPLACE FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer DEFAULT 200)
 RETURNS TABLE(erp_product_id integer, segmento text, ultimo_conteo timestamptz)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids int[];
BEGIN
  SELECT array_agg(m.erp_sucursal_id) INTO v_ids FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP'; END IF;

  RETURN QUERY
  WITH universo AS (
    SELECT DISTINCT i.erp_product_id AS pid
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_ids)
  ),
  clasificado AS (
    SELECT u.pid,
           CASE
             WHEN p.es_antibiotico THEN 'BAJO_RECETA'
             WHEN COALESCE(sp.abc, '') = 'A' THEN 'A'
             WHEN COALESCE(sp.abc, '') = 'B' THEN 'B'
             ELSE 'C'
           END AS seg
    FROM universo u
    JOIN public.products p ON p.id = u.pid AND p.activo = true
    LEFT JOIN LATERAL (
      SELECT COALESCE(s.abc_class, s.draft_abc_class) AS abc
      FROM public.product_stock_params s
      WHERE s.erp_product_id = u.pid AND s.erp_sucursal_id = ANY(v_ids)
      ORDER BY s.abc_class NULLS LAST
      LIMIT 1
    ) sp ON true
  ),
  ultimo AS (
    SELECT ci.erp_product_id AS pid, max(ci.contado_at) AS last_at
    FROM public.conteo_inventario_items ci
    JOIN public.conteos_inventario c ON c.id = ci.conteo_id
    WHERE c.branch_id = p_branch_id AND ci.contado_at IS NOT NULL
    GROUP BY 1
  ),
  pool AS (
    SELECT c.pid, c.seg, u.last_at,
           row_number() OVER (PARTITION BY c.seg ORDER BY u.last_at NULLS FIRST, random()) AS rn
    FROM clasificado c
    LEFT JOIN ultimo u ON u.pid = c.pid
  ),
  cuotas AS (
    SELECT
      LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano) AS q_abx,
      GREATEST(p_tamano - LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano), 0) AS resto
    FROM pool
  ),
  q AS (
    SELECT q_abx,
           floor(resto * 0.60)::int AS q_a,
           floor(resto * 0.25)::int AS q_b,
           resto - floor(resto * 0.60)::int - floor(resto * 0.25)::int AS q_c
    FROM cuotas
  ),
  base AS (
    SELECT p.pid, p.seg, p.last_at
    FROM pool p CROSS JOIN q
    WHERE (p.seg = 'BAJO_RECETA' AND p.rn <= q.q_abx)
       OR (p.seg = 'A'           AND p.rn <= q.q_a)
       OR (p.seg = 'B'           AND p.rn <= q.q_b)
       OR (p.seg = 'C'           AND p.rn <= q.q_c)
  ),
  relleno AS (
    SELECT p.pid, p.seg, p.last_at
    FROM pool p
    WHERE NOT EXISTS (SELECT 1 FROM base b WHERE b.pid = p.pid)
    ORDER BY CASE p.seg WHEN 'BAJO_RECETA' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
             p.last_at NULLS FIRST, random()
    LIMIT GREATEST(p_tamano - (SELECT count(*) FROM base), 0)
  )
  SELECT b.pid, b.seg, b.last_at FROM base b
  UNION ALL
  SELECT r.pid, r.seg, r.last_at FROM relleno r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seleccionar_muestra_ciclica(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seleccionar_muestra_ciclica(bigint, integer) TO authenticated, service_role;


-- Vista previa para el modal: qué va a caer y cómo está la cobertura. Sin esto
-- el usuario arma un conteo a ciegas sobre una muestra que no eligió a mano.
CREATE OR REPLACE FUNCTION public.preview_muestra_ciclica(p_branch_id bigint, p_tamano integer DEFAULT 200)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids int[];
  v_muestra json;
  v_cobertura json;
BEGIN
  SELECT array_agg(m.erp_sucursal_id) INTO v_ids FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
  IF v_ids IS NULL THEN RETURN json_build_object('error', 'SUCURSAL_SIN_MAPEO_ERP'); END IF;

  SELECT json_object_agg(segmento, n) INTO v_muestra
  FROM (SELECT segmento, count(*) n FROM public.seleccionar_muestra_ciclica(p_branch_id, p_tamano) GROUP BY 1) t;

  SELECT json_build_object(
    'universo', count(*),
    'nunca_contados', count(*) FILTER (WHERE u.last_at IS NULL),
    'mas_de_6_meses', count(*) FILTER (WHERE u.last_at IS NOT NULL AND u.last_at < now() - interval '6 months')
  ) INTO v_cobertura
  FROM (SELECT DISTINCT i.erp_product_id AS pid FROM public.inventory i WHERE i.erp_sucursal_id = ANY(v_ids)) x
  JOIN public.products p ON p.id = x.pid AND p.activo = true
  LEFT JOIN LATERAL (
    SELECT max(ci.contado_at) AS last_at
    FROM public.conteo_inventario_items ci
    JOIN public.conteos_inventario c ON c.id = ci.conteo_id
    WHERE c.branch_id = p_branch_id AND ci.erp_product_id = x.pid AND ci.contado_at IS NOT NULL
  ) u ON true;

  RETURN json_build_object('muestra', COALESCE(v_muestra, '{}'::json), 'cobertura', v_cobertura);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.preview_muestra_ciclica(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_muestra_ciclica(bigint, integer) TO authenticated, service_role;


-- ─── Alcance CICLICO ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb DEFAULT NULL::jsonb, p_erp_product_ids integer[] DEFAULT NULL::integer[])
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

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen.
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
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

    -- Queda registrado con qué composición se sorteó: un conteo cíclico que no
    -- dice cómo se armó no se puede auditar después.
    p_scope_filter := COALESCE(p_scope_filter, '{}'::jsonb)
      || jsonb_build_object('composicion', v_composicion, 'productos', array_length(v_ciclico_ids, 1));
  END IF;

  -- Siempre incluye TODO el inventario (vencido o no) — el conteo físico debe
  -- reflejar la realidad completa del anaquel/bodega; lo vencido/próximo a
  -- vencer se señala como aviso en la UI, no se excluye del snapshot.
  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO')
  RETURNING id INTO v_conteo_id;

  INSERT INTO public.conteo_inventario_items (conteo_id, erp_product_id, source_inventory_id, source_sync_key, presentacion, detalle, lote, fecha_vencimiento, is_vencidos, sistema_cantidad, sistema_inicial, costo_unitario)
  SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad, i.cantidad,
         public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
  FROM public.inventory i
  LEFT JOIN public.products p ON p.id = i.erp_product_id
  WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
    AND (
      p_scope_type = 'TOTAL'
      OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
      OR (p_scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
      OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
      OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
    );

  RETURN v_conteo_id;
END;
$function$;
