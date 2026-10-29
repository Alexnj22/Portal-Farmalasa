-- Consultas de existencia (2026-10-29).
--
-- Alguien —la oficina o una sala— le pregunta a una o varias salas «¿cuánto
-- tenés de este producto?». La sala cuenta SIN ver lo que dice el sistema
-- (conteo ciego), por presentación, y por lote sólo si el producto es regulado.
-- El portal compara en unidades contra la existencia viva:
--
--   cuadra al primer conteo     → CUADRA
--   no cuadra                   → RECONTAR (sin decirle cuánto ni hacia dónde)
--   el reconteo cuadra          → CUADRA
--   el reconteo tampoco         → DESCUADRE: lo ajusta quien aprueba inventario
--
-- Nadie ajusta solo y la sala que contó nunca se ajusta a sí misma: el ajuste
-- es una solicitud de inventario de las de siempre, que crea y aplica quien
-- tiene `requests_inventario.can_approve`. Cuando todas las salas contestaron,
-- el resumen le llega a Talento Humano, a Supervisión de Ventas y a quien pidió.
--
-- Los traslados NO explican un descuadre: lo despachado sale de la existencia
-- en el momento (usuario, 2026-10-29). Los vencidos apartados no se cuentan.
SET lock_timeout = '5s';

CREATE TABLE public.consultas_existencia (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  pedido_por     uuid REFERENCES public.employees(id),
  pedido_desde   bigint REFERENCES public.branches(id),
  erp_product_id integer NOT NULL REFERENCES public.products(id),
  motivo         text,
  origen         text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'revision_factor')),
  cerrada_at     timestamptz
);
CREATE INDEX consultas_existencia_producto_idx ON public.consultas_existencia (erp_product_id);
CREATE INDEX consultas_existencia_pedido_por_idx ON public.consultas_existencia (pedido_por);
CREATE INDEX consultas_existencia_pedido_desde_idx ON public.consultas_existencia (pedido_desde);
CREATE INDEX consultas_existencia_created_idx ON public.consultas_existencia (created_at DESC);

CREATE TABLE public.consultas_existencia_salas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  consulta_id     uuid NOT NULL REFERENCES public.consultas_existencia(id) ON DELETE CASCADE,
  erp_sucursal_id smallint NOT NULL,
  branch_id       bigint NOT NULL REFERENCES public.branches(id),
  estado          text NOT NULL DEFAULT 'PENDIENTE'
                  CHECK (estado IN ('PENDIENTE', 'RECONTAR', 'CUADRA', 'DESCUADRE', 'AJUSTADA', 'SIN_AJUSTE')),
  conteo_1        jsonb,
  contado_1_por   uuid REFERENCES public.employees(id),
  contado_1_at    timestamptz,
  conteo_2        jsonb,
  contado_2_por   uuid REFERENCES public.employees(id),
  contado_2_at    timestamptz,
  -- La comparación de cada ronda tal como se hizo: lo contado, lo que decía el
  -- sistema en ese momento y la diferencia, por lote si el producto es regulado.
  sistema         jsonb NOT NULL DEFAULT '{}'::jsonb,
  diferencia      integer,
  solicitudes     uuid[] NOT NULL DEFAULT '{}',
  resuelto_por    uuid REFERENCES public.employees(id),
  resuelto_at     timestamptz,
  nota            text,
  UNIQUE (consulta_id, erp_sucursal_id)
);
CREATE INDEX consultas_existencia_salas_branch_idx ON public.consultas_existencia_salas (branch_id);
CREATE INDEX consultas_existencia_salas_abiertas_idx ON public.consultas_existencia_salas (estado)
  WHERE estado IN ('PENDIENTE', 'RECONTAR', 'DESCUADRE');

ALTER TABLE public.consultas_existencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultas_existencia_salas ENABLE ROW LEVEL SECURITY;
-- Sólo lectura por la tabla; todo se escribe por las funciones de abajo. La
-- pantalla lee por `consultas_existencia_lista`, que además esconde lo que dice
-- el sistema mientras la sala no terminó de contar.
CREATE POLICY consultas_existencia_select ON public.consultas_existencia
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('conteo_inventario', 'can_view')));
CREATE POLICY consultas_existencia_salas_select ON public.consultas_existencia_salas
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('conteo_inventario', 'can_view')));
REVOKE ALL ON public.consultas_existencia, public.consultas_existencia_salas FROM anon;

-- ── El factor de una fila de inventario ──────────────────────────────────────
-- `detalle` es «1x10», «1 X 1», «1», «UNIDAD»…: sin el patrón NxM, vale 1.
CREATE FUNCTION public.factor_de_detalle(p_detalle text)
RETURNS integer LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $$
  SELECT coalesce((regexp_match(coalesce(p_detalle, ''), '\d+\s*[xX]\s*(\d+)'))[1]::int, 1);
$$;

-- ── N unidades dichas en presentaciones: «1 caja y 2 blíster» ────────────────
CREATE FUNCTION public.unidades_en_presentaciones(p_producto integer, p_unidades integer)
RETURNS text LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE
  v_resto int := abs(coalesce(p_unidades, 0));
  v_partes text[] := '{}';
  r record;
BEGIN
  IF v_resto = 0 THEN RETURN '0'; END IF;
  FOR r IN
    SELECT DISTINCT lower(trim(pr.tipo)) tipo, pp.factor
      FROM public.product_precios pp JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
     WHERE pp.product_id = p_producto AND pp.activo AND pp.factor > 0
     ORDER BY pp.factor DESC
  LOOP
    IF v_resto >= r.factor THEN
      v_partes := v_partes || ((v_resto / r.factor)::text || ' ' || r.tipo);
      v_resto := v_resto % r.factor;
    END IF;
  END LOOP;
  IF v_resto > 0 THEN v_partes := v_partes || (v_resto::text || ' unidad' || CASE WHEN v_resto = 1 THEN '' ELSE 'es' END); END IF;
  RETURN array_to_string(v_partes, ' y ');
END $$;

-- ── Comparar un conteo contra la existencia viva ─────────────────────────────
-- `p_conteo`: [{tipo, factor, cantidad, lote?, vence?}]. Regulado: cuadra si
-- cuadra CADA lote; si no, sólo el total.
CREATE FUNCTION public.consulta_existencia_comparar(p_producto integer, p_sucursal integer, p_conteo jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_regulado boolean := coalesce((SELECT regulado FROM public.products WHERE id = p_producto), false);
  v_lotes jsonb;
  v_contado int;
  v_sistema int;
BEGIN
  WITH sis AS (
    SELECT CASE WHEN v_regulado THEN upper(trim(i.lote)) END lote,
           max(i.fecha_vencimiento) vence,
           sum(i.cantidad * public.factor_de_detalle(i.detalle))::int u
      FROM public.inventory i
     WHERE i.erp_product_id = p_producto AND i.erp_sucursal_id = p_sucursal AND NOT i.is_vencidos
     GROUP BY 1
  ), con AS (
    SELECT CASE WHEN v_regulado THEN upper(trim(c->>'lote')) END lote,
           max(nullif(c->>'vence', '')::date) vence,
           sum((c->>'cantidad')::int * (c->>'factor')::int)::int u
      FROM jsonb_array_elements(coalesce(p_conteo, '[]'::jsonb)) c
     GROUP BY 1
  ), juntos AS (
    SELECT coalesce(s.lote, c.lote) lote, coalesce(s.vence, c.vence) vence,
           coalesce(c.u, 0) contado, coalesce(s.u, 0) sistema
      FROM sis s FULL JOIN con c ON coalesce(s.lote, '') = coalesce(c.lote, '')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('lote', lote, 'vence', vence, 'contado', contado,
                                               'sistema', sistema, 'diferencia', contado - sistema)
                            ORDER BY lote) FILTER (WHERE contado <> 0 OR sistema <> 0), '[]'::jsonb),
         coalesce(sum(contado), 0)::int, coalesce(sum(sistema), 0)::int
    INTO v_lotes, v_contado, v_sistema
    FROM juntos;

  RETURN jsonb_build_object(
    'regulado', v_regulado,
    'contado', v_contado, 'sistema', v_sistema, 'diferencia', v_contado - v_sistema,
    'por_lote', v_lotes,
    'cuadra', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lotes) l WHERE (l->>'diferencia')::int <> 0),
    'medido_at', now());
END $$;

-- ── Quién cuenta en una sala ─────────────────────────────────────────────────
CREATE FUNCTION public.consulta_existencia_contadores(p_branch bigint)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce(array_agg(DISTINCT e.id), '{}')
    FROM public.employees e
    JOIN public.role_permissions rp
      ON rp.role_id IN (e.role_id, e.secondary_role_id)
     AND rp.module_key = 'conteo_inventario' AND rp.can_edit
   WHERE e.status = 'ACTIVO' AND e.branch_id = p_branch;
$$;

-- ── Pedir ────────────────────────────────────────────────────────────────────
-- Cualquiera que cuenta inventario puede preguntar a cualquier sala, la suya
-- incluida: preguntar no mueve existencia. Una sala que ya tiene la misma
-- pregunta sin contestar no recibe otra.
CREATE FUNCTION public.consulta_existencia_crear(
  p_producto integer, p_salas integer[], p_motivo text DEFAULT NULL, p_origen text DEFAULT 'manual')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_id uuid;
  v_nombre text;
  r record;
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF p_salas IS NULL OR cardinality(p_salas) = 0 THEN RAISE EXCEPTION 'SIN_SALAS'; END IF;
  SELECT nombre INTO v_nombre FROM public.products WHERE id = p_producto;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO'; END IF;

  INSERT INTO public.consultas_existencia (pedido_por, pedido_desde, erp_product_id, motivo, origen)
  VALUES (public.auth_employee_id(), public.auth_employee_branch_id(), p_producto,
          nullif(trim(p_motivo), ''), coalesce(p_origen, 'manual'))
  RETURNING id INTO v_id;

  INSERT INTO public.consultas_existencia_salas (consulta_id, erp_sucursal_id, branch_id)
  SELECT v_id, m.erp_sucursal_id, m.branch_id
    FROM public.erp_sucursal_map m
   WHERE m.erp_sucursal_id = ANY (p_salas)
     AND NOT EXISTS (
       SELECT 1 FROM public.consultas_existencia_salas s
         JOIN public.consultas_existencia c ON c.id = s.consulta_id
        WHERE c.erp_product_id = p_producto AND s.erp_sucursal_id = m.erp_sucursal_id
          AND s.estado IN ('PENDIENTE', 'RECONTAR'));
  IF NOT FOUND THEN RAISE EXCEPTION 'YA_PEDIDA'; END IF;

  FOR r IN SELECT s.branch_id FROM public.consultas_existencia_salas s WHERE s.consulta_id = v_id LOOP
    PERFORM public.notify_employees(
      public.consulta_existencia_contadores(r.branch_id), 'SYSTEM',
      'Contar existencia · ' || v_nombre,
      'Cuenta lo que hay en el estante, por presentación, y escríbelo en el portal.',
      '/conteo-inventario?tab=consultas',
      jsonb_build_object('consulta_existencia', v_id, 'erp_product_id', p_producto),
      true, r.branch_id::int);
  END LOOP;
  RETURN v_id;
END $$;

-- ── Lo que la sala necesita para contar (sin la existencia) ──────────────────
CREATE FUNCTION public.consulta_existencia_para_contar(p_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  s public.consultas_existencia_salas%ROWTYPE;
  c public.consultas_existencia%ROWTYPE;
  v_regulado boolean;
BEGIN
  SELECT * INTO s FROM public.consultas_existencia_salas WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;
  IF public.auth_module_scope('conteo_inventario') <> 'ALL' AND s.branch_id <> public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  SELECT * INTO c FROM public.consultas_existencia WHERE id = s.consulta_id;
  SELECT coalesce(regulado, false) INTO v_regulado FROM public.products WHERE id = c.erp_product_id;

  RETURN json_build_object(
    'id', s.id, 'estado', s.estado, 'ronda', CASE WHEN s.estado = 'RECONTAR' THEN 2 ELSE 1 END,
    'erp_product_id', c.erp_product_id,
    'nombre', (SELECT nombre FROM public.products WHERE id = c.erp_product_id),
    'sala', (SELECT name FROM public.branches WHERE id = s.branch_id),
    'regulado', v_regulado,
    'presentaciones', (
      SELECT coalesce(json_agg(json_build_object('tipo', tipo, 'factor', factor) ORDER BY factor DESC), '[]'::json)
        FROM (SELECT DISTINCT upper(trim(pr.tipo)) tipo, pp.factor
                FROM public.product_precios pp JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
               WHERE pp.product_id = c.erp_product_id AND pp.activo AND pp.factor > 0) x),
    -- Los lotes que la sala tiene, por nombre y fecha: sin cantidades.
    'lotes', CASE WHEN v_regulado THEN (
      SELECT coalesce(json_agg(json_build_object('lote', lote, 'vence', vence) ORDER BY vence NULLS LAST, lote), '[]'::json)
        FROM (SELECT upper(trim(i.lote)) lote, max(i.fecha_vencimiento) vence
                FROM public.inventory i
               WHERE i.erp_product_id = c.erp_product_id AND i.erp_sucursal_id = s.erp_sucursal_id
                 AND NOT i.is_vencidos AND i.cantidad > 0
               GROUP BY 1) x) ELSE '[]'::json END);
END $$;

-- ── El resumen para Talento Humano, Supervisión y quien pidió ────────────────
CREATE FUNCTION public.consulta_existencia_avisar_resumen(p_consulta uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  c public.consultas_existencia%ROWTYPE;
  v_nombre text;
  v_cuerpo text;
  v_dest uuid[];
  v_faltan int;
BEGIN
  SELECT * INTO c FROM public.consultas_existencia WHERE id = p_consulta;
  SELECT nombre INTO v_nombre FROM public.products WHERE id = c.erp_product_id;
  SELECT string_agg(b.name || ': ' || CASE
           WHEN s.diferencia IS NULL OR s.diferencia = 0 THEN 'cuadra'
           WHEN s.diferencia < 0 THEN 'faltan ' || public.unidades_en_presentaciones(c.erp_product_id, s.diferencia)
           ELSE 'sobran ' || public.unidades_en_presentaciones(c.erp_product_id, s.diferencia) END,
           ' · ' ORDER BY b.name),
         count(*) FILTER (WHERE s.diferencia < 0)
    INTO v_cuerpo, v_faltan
    FROM public.consultas_existencia_salas s JOIN public.branches b ON b.id = s.branch_id
   WHERE s.consulta_id = p_consulta;

  SELECT coalesce(array_agg(DISTINCT e.id), '{}') INTO v_dest
    FROM public.employees e
   WHERE e.status = 'ACTIVO' AND (e.role_id IN (11, 13) OR e.secondary_role_id IN (11, 13));
  IF c.pedido_por IS NOT NULL THEN v_dest := v_dest || c.pedido_por; END IF;

  PERFORM public.notify_employees(
    v_dest, 'SYSTEM',
    CASE WHEN v_faltan > 0 THEN 'Faltante en conteo · ' ELSE 'Conteo de existencia · ' END || v_nombre,
    v_cuerpo, '/conteo-inventario?tab=consultas',
    jsonb_build_object('consulta_existencia', p_consulta, 'erp_product_id', c.erp_product_id),
    v_faltan > 0, NULL);
END $$;

-- ── Contar ───────────────────────────────────────────────────────────────────
CREATE FUNCTION public.consulta_existencia_contar(p_id uuid, p_conteo jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  s public.consultas_existencia_salas%ROWTYPE;
  v_producto int;
  v_regulado boolean;
  v_cmp jsonb;
  v_estado text;
  v_yo uuid := public.auth_employee_id();
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  SELECT * INTO s FROM public.consultas_existencia_salas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;
  IF public.auth_module_scope('conteo_inventario') <> 'ALL' AND s.branch_id <> public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF s.estado NOT IN ('PENDIENTE', 'RECONTAR') THEN RAISE EXCEPTION 'YA_CONTADA'; END IF;

  SELECT c.erp_product_id, coalesce(p.regulado, false) INTO v_producto, v_regulado
    FROM public.consultas_existencia c JOIN public.products p ON p.id = c.erp_product_id
   WHERE c.id = s.consulta_id;

  IF jsonb_typeof(p_conteo) <> 'array' THEN RAISE EXCEPTION 'CONTEO_INVALIDO'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_conteo) x
     WHERE (x->>'cantidad') !~ '^\d+$' OR (x->>'factor') !~ '^[1-9]\d*$'
        OR coalesce(trim(x->>'tipo'), '') = ''
        OR (v_regulado AND (x->>'cantidad')::int > 0 AND coalesce(trim(x->>'lote'), '') = '')) THEN
    RAISE EXCEPTION 'CONTEO_INVALIDO';
  END IF;

  v_cmp := public.consulta_existencia_comparar(v_producto, s.erp_sucursal_id, p_conteo);

  IF s.estado = 'PENDIENTE' THEN
    v_estado := CASE WHEN (v_cmp->>'cuadra')::boolean THEN 'CUADRA' ELSE 'RECONTAR' END;
    UPDATE public.consultas_existencia_salas
       SET conteo_1 = p_conteo, contado_1_por = v_yo, contado_1_at = now(),
           sistema = jsonb_build_object('ronda_1', v_cmp),
           estado = v_estado,
           diferencia = CASE WHEN v_estado = 'CUADRA' THEN 0 END
     WHERE id = p_id;
  ELSE
    v_estado := CASE WHEN (v_cmp->>'cuadra')::boolean THEN 'CUADRA' ELSE 'DESCUADRE' END;
    UPDATE public.consultas_existencia_salas
       SET conteo_2 = p_conteo, contado_2_por = v_yo, contado_2_at = now(),
           sistema = sistema || jsonb_build_object('ronda_2', v_cmp),
           estado = v_estado,
           diferencia = (v_cmp->>'diferencia')::int
     WHERE id = p_id;
  END IF;

  -- Todas contestaron: se cierra y se avisa el resumen, una sola vez.
  IF v_estado <> 'RECONTAR' AND NOT EXISTS (
       SELECT 1 FROM public.consultas_existencia_salas
        WHERE consulta_id = s.consulta_id AND estado IN ('PENDIENTE', 'RECONTAR')) THEN
    UPDATE public.consultas_existencia SET cerrada_at = now()
     WHERE id = s.consulta_id AND cerrada_at IS NULL;
    IF FOUND THEN PERFORM public.consulta_existencia_avisar_resumen(s.consulta_id); END IF;
  END IF;

  -- En RECONTAR no se dice cuánto ni hacia dónde: sería dictarle el número.
  RETURN CASE WHEN v_estado = 'RECONTAR' THEN json_build_object('estado', v_estado)
         ELSE json_build_object('estado', v_estado, 'contado', v_cmp->'contado', 'sistema', v_cmp->'sistema',
                                'diferencia', v_cmp->'diferencia',
                                'texto', public.unidades_en_presentaciones(v_producto, (v_cmp->>'diferencia')::int)) END;
END $$;

-- ── La lista ─────────────────────────────────────────────────────────────────
-- Ve todo quien tiene el conteo con alcance ALL; una sala ve lo que pidió y lo
-- que le pidieron. Lo que dice el sistema sólo sale cuando la sala terminó.
CREATE FUNCTION public.consultas_existencia_lista()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_todo boolean := public.auth_module_scope('conteo_inventario') = 'ALL';
  v_mia bigint := public.auth_employee_branch_id();
  v_cuenta boolean := public.auth_has_module_permission('conteo_inventario', 'can_edit');
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  RETURN (
    SELECT coalesce(json_agg(json_build_object(
      'id', c.id, 'created_at', c.created_at, 'cerrada_at', c.cerrada_at,
      'erp_product_id', c.erp_product_id, 'nombre', p.nombre, 'motivo', c.motivo, 'origen', c.origen,
      'pedido_por', c.pedido_por, 'pedido_desde', bp.name,
      'salas', (
        SELECT json_agg(json_build_object(
          'id', s.id, 'sala', b.name, 'branch_id', s.branch_id, 'erp_sucursal_id', s.erp_sucursal_id,
          'estado', s.estado,
          'puedo_contar', v_cuenta AND s.estado IN ('PENDIENTE', 'RECONTAR') AND (v_todo OR s.branch_id = v_mia),
          'contado_por', coalesce(s.contado_2_por, s.contado_1_por),
          'contado_at', coalesce(s.contado_2_at, s.contado_1_at),
          'recontada', s.conteo_2 IS NOT NULL,
          'final', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR')
                        THEN coalesce(s.sistema->'ronda_2', s.sistema->'ronda_1') END,
          'diferencia', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR') THEN s.diferencia END,
          'texto', CASE WHEN s.estado NOT IN ('PENDIENTE', 'RECONTAR') AND s.diferencia <> 0
                        THEN public.unidades_en_presentaciones(c.erp_product_id, s.diferencia) END,
          'solicitudes', s.solicitudes, 'resuelto_por', s.resuelto_por, 'resuelto_at', s.resuelto_at, 'nota', s.nota)
          ORDER BY b.name)
          FROM public.consultas_existencia_salas s JOIN public.branches b ON b.id = s.branch_id
         WHERE s.consulta_id = c.id))
      ORDER BY c.created_at DESC), '[]'::json)
      FROM public.consultas_existencia c
      JOIN public.products p ON p.id = c.erp_product_id
      LEFT JOIN public.branches bp ON bp.id = c.pedido_desde
     WHERE (c.cerrada_at IS NULL OR c.created_at > now() - interval '60 days'
            OR EXISTS (SELECT 1 FROM public.consultas_existencia_salas s
                        WHERE s.consulta_id = c.id AND s.estado = 'DESCUADRE'))
       AND (v_todo OR c.pedido_desde = v_mia
            OR EXISTS (SELECT 1 FROM public.consultas_existencia_salas s
                        WHERE s.consulta_id = c.id AND s.branch_id = v_mia)));
END $$;

-- ── El ajuste de un descuadre ────────────────────────────────────────────────
-- Recalcula contra la existencia de AHORA. Si cambió desde el conteo (se vendió
-- o entró algo), no se ofrece: ajustar con un número viejo descuadraría lo que
-- ya estaba bien. Las líneas salen en presentaciones, de la más grande a la de
-- 1; si el producto no tiene presentación de 1 y la diferencia no se puede
-- decir exacta, `exacto` es false y no se ajusta desde acá.
CREATE FUNCTION public.consulta_existencia_ajuste(p_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  s public.consultas_existencia_salas%ROWTYPE;
  v_producto int;
  v_cmp jsonb;
  v_lineas jsonb := '[]'::jsonb;
  v_exacto boolean := true;
  l jsonb;
  v_resto int;
  r record;
BEGIN
  IF NOT public.auth_has_module_permission('requests_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  SELECT * INTO s FROM public.consultas_existencia_salas WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_ENCONTRADA'; END IF;
  IF s.estado <> 'DESCUADRE' THEN RAISE EXCEPTION 'SIN_DESCUADRE'; END IF;
  SELECT erp_product_id INTO v_producto FROM public.consultas_existencia WHERE id = s.consulta_id;

  v_cmp := public.consulta_existencia_comparar(v_producto, s.erp_sucursal_id, s.conteo_2);
  IF (v_cmp->>'diferencia')::int IS DISTINCT FROM s.diferencia
     OR (v_cmp->'por_lote') IS DISTINCT FROM (s.sistema->'ronda_2'->'por_lote') THEN
    RETURN json_build_object('cambio', true, 'ahora', v_cmp);
  END IF;

  FOR l IN SELECT value FROM jsonb_array_elements(v_cmp->'por_lote') WHERE (value->>'diferencia')::int <> 0 LOOP
    v_resto := abs((l->>'diferencia')::int);
    FOR r IN
      SELECT DISTINCT upper(trim(pr.tipo)) tipo, pp.factor
        FROM public.product_precios pp JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
       WHERE pp.product_id = v_producto AND pp.activo AND pp.factor > 0
       ORDER BY pp.factor DESC
    LOOP
      IF v_resto >= r.factor THEN
        v_lineas := v_lineas || jsonb_build_object(
          'sentido', CASE WHEN (l->>'diferencia')::int > 0 THEN 'carga' ELSE 'descarte' END,
          'tipo', r.tipo, 'factor', r.factor, 'cantidad', v_resto / r.factor,
          'lote', l->>'lote', 'vence', l->>'vence',
          'existencia', ((l->>'sistema')::int / r.factor));
        v_resto := v_resto % r.factor;
      END IF;
    END LOOP;
    IF v_resto > 0 THEN v_exacto := false; END IF;
  END LOOP;

  RETURN json_build_object('cambio', false, 'exacto', v_exacto, 'lineas', v_lineas,
                           'contado', v_cmp->'contado', 'sistema', v_cmp->'sistema',
                           'diferencia', v_cmp->'diferencia');
END $$;

-- ── Cerrar un descuadre: ajustado, o sin ajuste con su motivo ────────────────
CREATE FUNCTION public.consulta_existencia_resolver(
  p_id uuid, p_estado text, p_solicitudes uuid[] DEFAULT '{}', p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.auth_has_module_permission('requests_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF p_estado NOT IN ('AJUSTADA', 'SIN_AJUSTE') THEN RAISE EXCEPTION 'ESTADO_INVALIDO'; END IF;
  IF p_estado = 'SIN_AJUSTE' AND coalesce(trim(p_nota), '') = '' THEN RAISE EXCEPTION 'NOTA_REQUERIDA'; END IF;
  IF p_estado = 'AJUSTADA' AND coalesce(cardinality(p_solicitudes), 0) = 0 THEN RAISE EXCEPTION 'SIN_SOLICITUD'; END IF;
  UPDATE public.consultas_existencia_salas
     SET estado = p_estado, solicitudes = coalesce(p_solicitudes, '{}'),
         resuelto_por = public.auth_employee_id(), resuelto_at = now(), nota = nullif(trim(p_nota), '')
   WHERE id = p_id AND estado = 'DESCUADRE';
  IF NOT FOUND THEN RAISE EXCEPTION 'SIN_DESCUADRE'; END IF;
END $$;

-- Permisos: nada para anon; las de uso interno, sólo el servidor.
REVOKE EXECUTE ON FUNCTION
  public.factor_de_detalle(text),
  public.unidades_en_presentaciones(integer, integer),
  public.consulta_existencia_comparar(integer, integer, jsonb),
  public.consulta_existencia_contadores(bigint),
  public.consulta_existencia_avisar_resumen(uuid),
  public.consulta_existencia_crear(integer, integer[], text, text),
  public.consulta_existencia_para_contar(uuid),
  public.consulta_existencia_contar(uuid, jsonb),
  public.consultas_existencia_lista(),
  public.consulta_existencia_ajuste(uuid),
  public.consulta_existencia_resolver(uuid, text, uuid[], text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.factor_de_detalle(text),
  public.unidades_en_presentaciones(integer, integer),
  public.consulta_existencia_comparar(integer, integer, jsonb),
  public.consulta_existencia_contadores(bigint),
  public.consulta_existencia_avisar_resumen(uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION
  public.consulta_existencia_crear(integer, integer[], text, text),
  public.consulta_existencia_para_contar(uuid),
  public.consulta_existencia_contar(uuid, jsonb),
  public.consultas_existencia_lista(),
  public.consulta_existencia_ajuste(uuid),
  public.consulta_existencia_resolver(uuid, text, uuid[], text)
TO authenticated, service_role;
