-- Conteo que corrige la caja (2026-11-05).
--
-- Pedido del usuario: «un "nuevo" tipo de inventario que modifique y cambie
-- eso [la existencia sin lote asignado]. Así iniciamos con Bodega y luego con
-- las sucursales». Decisiones: asignar Y ajustar (lo que falta se da de baja,
-- lo que sobra de alta), con todas las opciones de alcance del conteo actual.
--
-- Es el conteo de siempre —por lote, en vivo— con una marca: al APROBARLO, las
-- diferencias se aplican en la caja. Lo que se aplica es la DIFERENCIA de cada
-- renglón contra lo que el sistema decía en el momento en que se contó (el
-- conteo en vivo lo guarda en `sistema_cantidad`), nunca una foto: así una
-- venta posterior al conteo no se deshace.
--
-- La existencia del espejo va por presentación («CAJA 1x3: 3»), así que cada
-- diferencia se lleva a unidades con el factor de su grupo (`F3`) y por lote se
-- suman. De cada producto sale una carga (lo que sobra, con su lote) y un
-- descargo por lote (lo que falta). Lo hace `aplicar-conteo-caja`, de a un
-- producto, empujado por un cron que sólo dispara si hay cola.
--
-- Lo NO contado no se ajusta: un renglón cerrado como cero al finalizar
-- («pendientes como cero») no es una medición, y en un conteo total de Bodega
-- daría de baja todo lo que nadie alcanzó a contar.
SET lock_timeout = '5s';

ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS aplica_en_caja boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS caja_estado text,
  ADD COLUMN IF NOT EXISTS caja_terminado_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conteos_inventario_caja_estado_check') THEN
    ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_caja_estado_check
      CHECK (caja_estado IS NULL OR caja_estado IN ('EN_COLA','APLICADO','CON_PENDIENTES'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.conteo_caja_movimiento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conteo_id      uuid NOT NULL REFERENCES public.conteos_inventario(id) ON DELETE CASCADE,
  erp_product_id integer NOT NULL,
  is_vencidos    boolean NOT NULL DEFAULT false,
  -- [{lote, vence, unidades (+ entra, − sale), factor_desconocido, hecho, error}]
  lineas         jsonb NOT NULL,
  estado         text NOT NULL DEFAULT 'PENDIENTE'
                 CHECK (estado IN ('PENDIENTE','APLICANDO','HECHO','ERROR','INCIERTO')),
  resultado      jsonb,
  error          text,
  intentos       integer NOT NULL DEFAULT 0,
  tomado_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conteo_id, erp_product_id, is_vencidos)
);
CREATE INDEX IF NOT EXISTS conteo_caja_movimiento_cola_idx
  ON public.conteo_caja_movimiento (created_at) WHERE estado IN ('PENDIENTE','APLICANDO');

ALTER TABLE public.conteo_caja_movimiento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conteo_caja_movimiento_select ON public.conteo_caja_movimiento;
CREATE POLICY conteo_caja_movimiento_select ON public.conteo_caja_movimiento
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('conteo_inventario', 'can_view')));
REVOKE ALL ON public.conteo_caja_movimiento FROM anon;

-- ── Crear: la marca, y sólo por lote y en vivo ──────────────────────────────
DROP FUNCTION IF EXISTS public.crear_conteo_inventario(bigint, text, jsonb, integer[], text, text);
CREATE FUNCTION public.crear_conteo_inventario(
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
REVOKE EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(bigint, text, jsonb, integer[], text, text, boolean) TO authenticated, service_role;

-- ── Encolar: de diferencias por renglón a unidades por lote ────────────────
CREATE OR REPLACE FUNCTION public.conteo_caja_encolar(p_conteo_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  n int;
BEGIN
  INSERT INTO public.conteo_caja_movimiento (conteo_id, erp_product_id, is_vencidos, lineas)
  SELECT p_conteo_id, x.erp_product_id, x.is_vencidos,
         jsonb_agg(jsonb_build_object(
           'lote', x.lote, 'vence', x.vence, 'unidades', x.unidades,
           'factor_desconocido', x.sin_factor) ORDER BY x.unidades DESC, x.lote)
  FROM (
    SELECT i.erp_product_id, i.is_vencidos,
           COALESCE(NULLIF(btrim(i.lote), ''), '') AS lote,
           i.fecha_vencimiento AS vence,
           sum(i.diferencia * COALESCE(f.factor, 1))::int AS unidades,
           bool_or(f.factor IS NULL) AS sin_factor
    FROM public.conteo_inventario_items i
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        substring(i.grupo_key FROM '^F(\d+)$')::int,
        substring(i.detalle FROM '^\s*1\s*[xX]\s*(\d+)\s*$')::int) AS factor
    ) f
    WHERE i.conteo_id = p_conteo_id
      AND i.fisico_cantidad IS NOT NULL
      AND COALESCE(i.diferencia, 0) <> 0
      -- Lo no contado no se ajusta (ver el encabezado).
      AND NOT EXISTS (SELECT 1 FROM public.conteo_inventario_item_history h
                      WHERE h.item_id = i.id AND h.evento = 'CIERRE')
    GROUP BY 1, 2, 3, 4
  ) x
  WHERE x.unidades <> 0 OR x.sin_factor
  GROUP BY x.erp_product_id, x.is_vencidos
  ON CONFLICT (conteo_id, erp_product_id, is_vencidos) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE public.conteos_inventario
  SET caja_estado = CASE WHEN n > 0 THEN 'EN_COLA' ELSE 'APLICADO' END,
      caja_terminado_at = CASE WHEN n > 0 THEN NULL ELSE now() END
  WHERE id = p_conteo_id;
  RETURN n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.conteo_caja_encolar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_caja_encolar(uuid) TO service_role;

-- ── Aprobar: si el conteo corrige la caja, se encola ────────────────────────
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
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id AND status = 'FINALIZADO';
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

  UPDATE public.conteos_inventario
  SET status = 'CERRADO', aprobado_por = v_actor, aprobado_at = now(), nota_aprobacion = p_nota
  WHERE id = p_conteo_id;

  IF v_conteo.aplica_en_caja THEN
    v_movs := public.conteo_caja_encolar(p_conteo_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'caja_productos', v_movs);
END;
$function$;

-- ── La cola: de a un producto ───────────────────────────────────────────────
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
REVOKE EXECUTE ON FUNCTION public.conteo_caja_tomar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_caja_tomar() TO service_role;

-- El estado del conteo sale de sus productos.
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
REVOKE EXECUTE ON FUNCTION public.conteo_caja_recalcular(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_caja_recalcular(uuid) TO service_role;

-- ── Lo que ve la pantalla ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_conteo_caja(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_view') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  RETURN json_build_object(
    'aplica_en_caja', v_conteo.aplica_en_caja,
    'estado', v_conteo.caja_estado,
    'terminado_at', v_conteo.caja_terminado_at,
    'movimientos', COALESCE((
      SELECT json_agg(json_build_object(
               'id', m.id, 'erp_product_id', m.erp_product_id, 'producto', p.nombre,
               'is_vencidos', m.is_vencidos, 'estado', m.estado, 'lineas', m.lineas,
               'error', m.error, 'intentos', m.intentos, 'updated_at', m.updated_at)
             ORDER BY CASE m.estado WHEN 'ERROR' THEN 0 WHEN 'INCIERTO' THEN 1 WHEN 'APLICANDO' THEN 2
                                    WHEN 'PENDIENTE' THEN 3 ELSE 4 END, p.nombre)
      FROM public.conteo_caja_movimiento m
      LEFT JOIN public.products p ON p.id = m.erp_product_id
      WHERE m.conteo_id = p_conteo_id), '[]'::json));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_conteo_caja(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_caja(uuid) TO authenticated, service_role;

-- Reintentar lo que falló, después de mirarlo. Un INCIERTO pide haber revisado
-- los movimientos del producto: puede haber entrado parte. Las líneas ya hechas
-- no se repiten (`hecho` en cada línea).
CREATE OR REPLACE FUNCTION public.conteo_caja_reintentar(p_movimiento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_branch bigint;
BEGIN
  SELECT m.conteo_id, c.branch_id INTO v_conteo_id, v_branch
  FROM public.conteo_caja_movimiento m JOIN public.conteos_inventario c ON c.id = m.conteo_id
  WHERE m.id = p_movimiento_id AND m.estado IN ('ERROR','INCIERTO');
  IF v_conteo_id IS NULL THEN RAISE EXCEPTION 'NO_SE_PUEDE_REINTENTAR'; END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_branch != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  UPDATE public.conteo_caja_movimiento
  SET estado = 'PENDIENTE', error = NULL, updated_at = now()
  WHERE id = p_movimiento_id;
  UPDATE public.conteos_inventario SET caja_estado = 'EN_COLA', caja_terminado_at = NULL WHERE id = v_conteo_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.conteo_caja_reintentar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conteo_caja_reintentar(uuid) TO authenticated, service_role;

-- ── El cron: sólo dispara si hay cola ───────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conteo-caja-cada-minuto') THEN
    PERFORM cron.unschedule('conteo-caja-cada-minuto');
  END IF;
END $$;
SELECT cron.schedule(
  'conteo-caja-cada-minuto',
  '* * * * *',
  $$
  SELECT net.http_post(
      url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/aplicar-conteo-caja',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                                   WHERE name = 'admin_invoke_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 10000)
  WHERE EXISTS (SELECT 1 FROM public.conteo_caja_movimiento WHERE estado = 'PENDIENTE');
  $$
);
