-- Las bolsas de traslado viajan con la ruta de reparto (2026-11-12).
--
-- Decisión del usuario (punto 6 de traslados): el motorista ya hace cada día la
-- ruta del pedido semanal y marca él mismo cada entrega (67 de 67 en 30 días),
-- pero las bolsas de traslado viajaban por fuera — si una se perdía, no había
-- dónde leer quién la tenía. Ahora:
--
--   · `ruta_bolsas`: la bolsa que el conductor RECOGE escaneando su ticket pasa
--     a la ruta (quién, cuándo, dónde) hasta que la ENTREGA (quién, cuándo,
--     dónde). Es opcional: recibir con el botón sigue valiendo.
--   · `ruta_bolsas(ruta)`: lo que lleva encima y lo que puede llevarse «de
--     paso» — bolsas despachadas cuyo destino es una parada pendiente de la
--     ruta. `en_ruta` si sale de Bodega antes de salir, o de la parada donde
--     está o una que viene, antes del destino; si no, `desvio` (la pantalla
--     calcula cuánto con la ubicación de las salas).
--   · Entregar la parada entrega también las bolsas para esa sala, con la
--     ubicación del teléfono (`ruta_pedidos.entregado_lat/lng`, nuevas).
--   · Una bolsa que una ruta ya entregó y la sala todavía no recibió está EN la
--     sala: no se sugiere ni se puede volver a recoger.
--   · Si la sala recibe la bolsa antes de que el conductor la marque, la
--     custodia se cierra sola (`retiro_cerrar_custodia`, mismo disparador que
--     ya cerraba el recorrido).
--
-- Los envíos «sobrante» (`metadata.sobrante_de`) no son una bolsa física: no
-- se sugieren ni se pueden recoger.
-- Probado en el entorno de pruebas con execute_sql (clasificación en_ruta /
-- desvio, recoger, repetir, entregar la parada con ubicación, soltar, cierre
-- por recepción).
SET lock_timeout = '5s';

ALTER TABLE public.ruta_pedidos
  ADD COLUMN IF NOT EXISTS entregado_lat double precision,
  ADD COLUMN IF NOT EXISTS entregado_lng double precision;

CREATE TABLE IF NOT EXISTS public.ruta_bolsas (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id                  uuid NOT NULL REFERENCES public.rutas(id) ON DELETE CASCADE,
  request_id               uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  familia                  text NOT NULL CHECK (familia IN ('solicitud', 'envio')),
  codigo                   text,
  origen_branch_id         bigint,
  destino_branch_id        bigint,
  destino_erp_sucursal_id  integer,
  recogida_at              timestamptz NOT NULL DEFAULT now(),
  recogida_por             uuid NOT NULL REFERENCES public.employees(id),
  recogida_lat             double precision,
  recogida_lng             double precision,
  entregada_at             timestamptz,
  entregada_por            uuid REFERENCES public.employees(id),
  entregada_lat            double precision,
  entregada_lng            double precision,
  soltada_at               timestamptz,
  soltada_por              uuid REFERENCES public.employees(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ruta_bolsas IS
  'Bolsas de traslado que viajan con una ruta de reparto: quién la recogió y entregó, cuándo y dónde. Se escribe sólo por las funciones ruta_*.';

CREATE INDEX IF NOT EXISTS ruta_bolsas_ruta_idx ON public.ruta_bolsas (ruta_id);
CREATE INDEX IF NOT EXISTS ruta_bolsas_request_idx ON public.ruta_bolsas (request_id);
-- Una bolsa va con una sola persona a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS ruta_bolsas_una_a_la_vez
  ON public.ruta_bolsas (request_id) WHERE entregada_at IS NULL AND soltada_at IS NULL;

ALTER TABLE public.ruta_bolsas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.ruta_bolsas;
CREATE POLICY bloqueo_global ON public.ruta_bolsas AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS ruta_bolsas_select ON public.ruta_bolsas;
CREATE POLICY ruta_bolsas_select ON public.ruta_bolsas FOR SELECT TO authenticated
  USING (
    (SELECT public.auth_has_module_permission('pedidos_tab_rutas', 'can_view'))
    AND (
      (SELECT public.auth_module_scope('pedidos_tab_rutas')) = 'ALL'
      OR destino_erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())
      OR recogida_por = (SELECT public.auth_employee_id())
    )
  );
-- Sin policies de escritura: sólo las funciones DEFINER de abajo escriben.

-- ── ¿Puede operar esta ruta? El conductor, o quien gestiona rutas de todas ──
CREATE OR REPLACE FUNCTION public._ruta_puede_operar(p_ruta_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rutas r
    WHERE r.id = p_ruta_id
      AND (r.conductor_id = public.auth_employee_id()
           OR (public.auth_has_module_permission('pedidos_tab_rutas', 'can_edit')
               AND public.auth_module_scope('pedidos_tab_rutas') = 'ALL'))
  );
$$;
REVOKE EXECUTE ON FUNCTION public._ruta_puede_operar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ruta_puede_operar(uuid) TO service_role;

-- ── Las bolsas despachadas que nadie recibió todavía ──────────────────────
-- «Despachada y sin recibir» con la verdad de JavaScript, igual que
-- `retiro_cargar` y `traslado_por_codigo`. `llevada_por` dice quién la tiene
-- encima ahora (una ruta o el recorrido), o null si está libre.
CREATE OR REPLACE FUNCTION public._bolsas_por_llevar()
RETURNS TABLE (
  request_id uuid, familia text, codigo text,
  origen_branch_id bigint, destino_branch_id bigint,
  origen_erp integer, destino_erp integer,
  origen_nombre text, destino_nombre text,
  productos integer, unidades numeric, despachado_at text,
  llevada_por text, llevada_en_ruta uuid
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  WITH b AS (
    SELECT ar.id, 'solicitud'::text AS familia,
           ar.metadata->'erp_traslado'->>'id_traslado' AS codigo,
           nullif(ar.metadata->>'origen_branch_id', '')::bigint AS o,
           nullif(ar.metadata->>'branch_id', '')::bigint AS d,
           ar.metadata AS m,
           ar.metadata->'erp_traslado'->>'at' AS desp
    FROM public.approval_requests ar
    WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
      AND ar.status = 'APPROVED'
      AND ar.created_at > now() - interval '90 days'
      AND coalesce(ar.metadata->>'erp_traslado', '') NOT IN ('', 'false', '0')
      AND coalesce(ar.metadata->>'erp_recibido', '') IN ('', 'false', '0')
    UNION ALL
    SELECT ar.id, 'envio',
           ar.metadata->>'codigo_bolsa',
           nullif(ar.metadata->>'origen_branch_id', '')::bigint,
           nullif(ar.metadata->>'branch_id', '')::bigint,
           ar.metadata,
           ar.metadata->>'despachado_at'
    FROM public.approval_requests ar
    WHERE ar.type = 'INVENTORY_TRANSFER_PUSH'
      AND ar.created_at > now() - interval '90 days'
      AND NOT (ar.metadata ? 'sobrante_de')
      AND EXISTS (SELECT 1 FROM public.envio_linea l WHERE l.request_id = ar.id AND l.estado = 'enviada')
  )
  -- Una bolsa que una ruta ya ENTREGÓ y la sala todavía no recibió está en la
  -- sala, no por llevar: no se sugiere ni se puede volver a recoger.
  SELECT b.id, b.familia, b.codigo, b.o, b.d,
         mo.erp_sucursal_id, md.erp_sucursal_id,
         bo.name, bd.name,
         CASE WHEN jsonb_typeof(b.m->'items') = 'array' THEN jsonb_array_length(b.m->'items') ELSE 0 END,
         CASE WHEN b.m->>'total_unidades' ~ '^[0-9.]+$' THEN (b.m->>'total_unidades')::numeric END,
         b.desp,
         coalesce(
           (SELECT e.name FROM public.ruta_bolsas rb JOIN public.employees e ON e.id = rb.recogida_por
             WHERE rb.request_id = b.id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL LIMIT 1),
           (SELECT e.name FROM public.retiro_bultos x JOIN public.retiros r ON r.id = x.retiro_id
              JOIN public.employees e ON e.id = r.retirador_id
             WHERE x.request_id = b.id AND x.entregado_at IS NULL LIMIT 1)),
         (SELECT rb.ruta_id FROM public.ruta_bolsas rb
           WHERE rb.request_id = b.id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL LIMIT 1)
  FROM b
  LEFT JOIN public.erp_sucursal_map mo ON mo.branch_id = b.o
  LEFT JOIN public.erp_sucursal_map md ON md.branch_id = b.d
  LEFT JOIN public.branches bo ON bo.id = b.o
  LEFT JOIN public.branches bd ON bd.id = b.d
  WHERE NOT EXISTS (SELECT 1 FROM public.ruta_bolsas rb
                    WHERE rb.request_id = b.id AND rb.entregada_at IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION public._bolsas_por_llevar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bolsas_por_llevar() TO service_role;

-- ── Lo que lleva encima y lo que puede llevarse de paso ──────────────────
CREATE OR REPLACE FUNCTION public.ruta_bolsas(p_ruta_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_status  text;
  v_bodega  integer;
  v_actual  integer;   -- la última parada entregada: donde está ahora
BEGIN
  SELECT r.status INTO v_status FROM public.rutas r WHERE r.id = p_ruta_id;
  IF v_status IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa ruta no existe.');
  END IF;
  IF NOT public._ruta_puede_operar(p_ruta_id)
     AND NOT (public.auth_has_module_permission('pedidos_tab_rutas', 'can_view')
              AND public.auth_module_scope('pedidos_tab_rutas') = 'ALL') THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'No puedes ver las bolsas de esta ruta.');
  END IF;
  SELECT m.erp_sucursal_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega LIMIT 1;
  SELECT coalesce(max(rp.orden_entrega), 0) INTO v_actual
  FROM public.ruta_pedidos rp WHERE rp.ruta_id = p_ruta_id AND rp.entregado_at IS NOT NULL;

  RETURN json_build_object(
    'ok', true,
    'llevas', coalesce((
      SELECT json_agg(json_build_object(
        'id', rb.id, 'request_id', rb.request_id, 'familia', rb.familia, 'codigo', rb.codigo,
        'origen', bo.name, 'destino', bd.name, 'destino_erp', rb.destino_erp_sucursal_id,
        'recogida_at', rb.recogida_at, 'entregada_at', rb.entregada_at, 'soltada_at', rb.soltada_at,
        'en_ruta', EXISTS (SELECT 1 FROM public.ruta_pedidos rp
                            WHERE rp.ruta_id = p_ruta_id AND rp.erp_sucursal_id = rb.destino_erp_sucursal_id)
      ) ORDER BY rb.recogida_at)
      FROM public.ruta_bolsas rb
      LEFT JOIN public.branches bo ON bo.id = rb.origen_branch_id
      LEFT JOIN public.branches bd ON bd.id = rb.destino_branch_id
      WHERE rb.ruta_id = p_ruta_id AND rb.soltada_at IS NULL), '[]'::json),
    'sugeridas', CASE WHEN v_status NOT IN ('pendiente', 'en_ruta') THEN '[]'::json ELSE coalesce((
      SELECT json_agg(json_build_object(
        'request_id', s.request_id, 'familia', s.familia, 'codigo', s.codigo,
        'origen', s.origen_nombre, 'destino', s.destino_nombre,
        'origen_erp', s.origen_erp, 'destino_erp', s.destino_erp,
        'productos', s.productos, 'unidades', s.unidades, 'despachado_at', s.despachado_at,
        'de_bodega', s.origen_erp = v_bodega,
        'categoria', CASE
          WHEN s.origen_erp = v_bodega AND v_status = 'pendiente' THEN 'en_ruta'
          -- Sale de la parada donde está ahora o de una que viene, y antes del destino.
          WHEN po.orden_entrega IS NOT NULL AND po.orden_entrega >= v_actual
               AND po.orden_entrega < pd.orden_entrega THEN 'en_ruta'
          ELSE 'desvio' END
      ) ORDER BY (s.origen_erp = v_bodega) DESC, pd.orden_entrega, s.despachado_at)
      FROM public._bolsas_por_llevar() s
      JOIN public.ruta_pedidos pd
        ON pd.ruta_id = p_ruta_id AND pd.erp_sucursal_id = s.destino_erp AND pd.entregado_at IS NULL
      LEFT JOIN LATERAL (
        SELECT rp.orden_entrega FROM public.ruta_pedidos rp
        WHERE rp.ruta_id = p_ruta_id AND rp.erp_sucursal_id = s.origen_erp
        ORDER BY rp.orden_entrega DESC LIMIT 1
      ) po ON true
      WHERE s.llevada_por IS NULL), '[]'::json) END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_bolsas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_bolsas(uuid) TO authenticated, service_role;

-- ── Recoger: escanear el ticket de la bolsa ──────────────────────────────
CREATE OR REPLACE FUNCTION public.ruta_recoger_bolsa(
  p_ruta_id uuid, p_codigo text, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_quien  uuid := public.auth_employee_id();
  v_status text;
  v_cod    text := nullif(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), '');
  v_id     uuid;
  v_tipo   text;
  v_meta   jsonb;
  v_b      record;
  v_nuevo  uuid;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  SELECT r.status INTO v_status FROM public.rutas r WHERE r.id = p_ruta_id;
  IF v_status IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa ruta no existe.');
  END IF;
  IF NOT public._ruta_puede_operar(p_ruta_id) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede recoger bolsas en ella.');
  END IF;
  IF v_status NOT IN ('pendiente', 'en_ruta') THEN
    RETURN json_build_object('ok', false, 'error', 'Esta ruta ya terminó.');
  END IF;
  IF v_cod IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No se leyó ningún código.');
  END IF;

  SELECT ar.id, ar.type, ar.metadata INTO v_id, v_tipo, v_meta
  FROM public.approval_requests ar
  WHERE (ar.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
         AND ar.metadata->'erp_traslado'->>'id_traslado' = v_cod)
     OR (ar.type = 'INVENTORY_TRANSFER_PUSH' AND ar.metadata->>'codigo_bolsa' = v_cod)
  ORDER BY ar.updated_at DESC LIMIT 1;

  IF v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.pedido_traslado_linea l WHERE l.id_traslado = v_cod) THEN
      RETURN json_build_object('ok', false, 'codigo', 'ES_PEDIDO',
        'error', 'Ese ticket es del pedido de Bodega: ya va con las cajas de la ruta.');
    END IF;
    RETURN json_build_object('ok', false, 'codigo', 'NO_EXISTE',
      'error', 'No encontramos esa bolsa. Puede que el código no se haya leído bien.');
  END IF;
  IF v_meta ? 'sobrante_de' THEN
    RETURN json_build_object('ok', false, 'error', 'Eso no es una bolsa: es lo que llegó de más a una sala.');
  END IF;

  SELECT * INTO v_b FROM public._bolsas_por_llevar() s WHERE s.request_id = v_id;
  IF v_b.request_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.ruta_bolsas rb WHERE rb.request_id = v_id AND rb.entregada_at IS NOT NULL) THEN
      RETURN json_build_object('ok', false, 'codigo', 'YA_ENTREGADA',
        'error', 'Esa bolsa ya se entregó en ' || coalesce((
          SELECT bd.name || ' a las ' || to_char(rb.entregada_at AT TIME ZONE 'America/El_Salvador', 'FMHH12:MI AM')
          FROM public.ruta_bolsas rb LEFT JOIN public.branches bd ON bd.id = rb.destino_branch_id
          WHERE rb.request_id = v_id AND rb.entregada_at IS NOT NULL ORDER BY rb.entregada_at DESC LIMIT 1), 'su sala')
        || '; falta que la sala la reciba.');
    END IF;
    IF coalesce(v_meta->>'erp_recibido', '') NOT IN ('', 'false', '0') THEN
      RETURN json_build_object('ok', false, 'codigo', 'YA_RECIBIDA', 'error', 'Esa bolsa ya se recibió.');
    END IF;
    RETURN json_build_object('ok', false, 'codigo', 'NO_DESPACHADA',
      'error', 'Esa bolsa todavía no salió de la sala (o ya se recibió).');
  END IF;
  IF v_b.llevada_por IS NOT NULL THEN
    IF v_b.llevada_en_ruta = p_ruta_id THEN
      RETURN json_build_object('ok', false, 'codigo', 'YA_LA_LLEVAS', 'error', 'Esa bolsa ya la llevas.');
    END IF;
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA', 'error', 'Esa bolsa ya la lleva ' || v_b.llevada_por || '.');
  END IF;

  BEGIN
    INSERT INTO public.ruta_bolsas (ruta_id, request_id, familia, codigo, origen_branch_id, destino_branch_id,
                                    destino_erp_sucursal_id, recogida_por, recogida_lat, recogida_lng)
    VALUES (p_ruta_id, v_id, v_b.familia, v_b.codigo, v_b.origen_branch_id, v_b.destino_branch_id,
            v_b.destino_erp, v_quien, p_lat, p_lng)
    RETURNING id INTO v_nuevo;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA', 'error', 'Esa bolsa ya la lleva otra persona.');
  END;

  RETURN json_build_object(
    'ok', true, 'id', v_nuevo, 'request_id', v_id, 'codigo', v_b.codigo,
    'origen', v_b.origen_nombre, 'destino', v_b.destino_nombre,
    'en_ruta', EXISTS (SELECT 1 FROM public.ruta_pedidos rp
                        WHERE rp.ruta_id = p_ruta_id AND rp.erp_sucursal_id = v_b.destino_erp));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_recoger_bolsa(uuid, text, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_recoger_bolsa(uuid, text, double precision, double precision) TO authenticated, service_role;

-- ── Entregar una bolsa suelta (la que va a una sala que no es parada) ────
CREATE OR REPLACE FUNCTION public.ruta_entregar_bolsa(
  p_id uuid, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_ruta uuid;
BEGIN
  SELECT rb.ruta_id INTO v_ruta FROM public.ruta_bolsas rb
  WHERE rb.id = p_id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL;
  IF v_ruta IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa bolsa ya no la llevas.');
  END IF;
  IF NOT public._ruta_puede_operar(v_ruta) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede entregarla.');
  END IF;
  UPDATE public.ruta_bolsas
     SET entregada_at = now(), entregada_por = public.auth_employee_id(),
         entregada_lat = p_lat, entregada_lng = p_lng
   WHERE id = p_id AND entregada_at IS NULL AND soltada_at IS NULL;
  RETURN json_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_entregar_bolsa(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_entregar_bolsa(uuid, double precision, double precision) TO authenticated, service_role;

-- ── Soltar: la recogió por error, o la dejó donde estaba ────────────────
-- No se borra: queda que la tuvo y cuándo la soltó.
CREATE OR REPLACE FUNCTION public.ruta_soltar_bolsa(p_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_ruta uuid;
BEGIN
  SELECT rb.ruta_id INTO v_ruta FROM public.ruta_bolsas rb
  WHERE rb.id = p_id AND rb.entregada_at IS NULL AND rb.soltada_at IS NULL;
  IF v_ruta IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Esa bolsa ya no la llevas.');
  END IF;
  IF NOT public._ruta_puede_operar(v_ruta) THEN
    RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', 'Sólo el conductor de la ruta puede soltarla.');
  END IF;
  UPDATE public.ruta_bolsas SET soltada_at = now(), soltada_por = public.auth_employee_id()
   WHERE id = p_id AND entregada_at IS NULL AND soltada_at IS NULL;
  RETURN json_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_soltar_bolsa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_soltar_bolsa(uuid) TO authenticated, service_role;

-- ── Entregar la parada entrega las bolsas para esa sala ──────────────────
CREATE OR REPLACE FUNCTION public.ruta_entregar_bolsas_de_parada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NEW.entregado_at IS NOT NULL AND OLD.entregado_at IS NULL THEN
    UPDATE public.ruta_bolsas
       SET entregada_at = NEW.entregado_at, entregada_por = NEW.entregado_por,
           entregada_lat = NEW.entregado_lat, entregada_lng = NEW.entregado_lng
     WHERE ruta_id = NEW.ruta_id AND destino_erp_sucursal_id = NEW.erp_sucursal_id
       AND entregada_at IS NULL AND soltada_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruta_entregar_bolsas_de_parada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ruta_entregar_bolsas_de_parada ON public.ruta_pedidos;
CREATE TRIGGER trg_ruta_entregar_bolsas_de_parada
  AFTER UPDATE OF entregado_at ON public.ruta_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.ruta_entregar_bolsas_de_parada();

-- ── La sala recibió antes de que el conductor marcara: se cierra sola ────
-- Cuerpo VIVO de `retiro_cerrar_custodia` (pg_get_functiondef, 2026-11-12)
-- más el segundo UPDATE.
CREATE OR REPLACE FUNCTION public.retiro_cerrar_custodia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF coalesce(NEW.metadata->>'erp_recibido', '') NOT IN ('', 'false', '0')
     AND coalesce(OLD.metadata->>'erp_recibido', '') IN ('', 'false', '0') THEN
    UPDATE public.retiro_bultos
       SET entregado_at = now()
     WHERE request_id = NEW.id AND entregado_at IS NULL;
    UPDATE public.ruta_bolsas
       SET entregada_at = now()
     WHERE request_id = NEW.id AND entregada_at IS NULL AND soltada_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
