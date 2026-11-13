-- La bolsa que queda en la sala equivocada, y la que se entregó y nadie recibió
-- (2026-11-12, sobre la ruta de reparto de `20261113050615`).
--
-- Decisión del usuario: «me gustan las sugerencias, hazlo. pero el aviso va a
-- bodega y a quien entregó». Dos avisos, los dos a las personas activas de
-- BODEGA más QUIEN LA ENTREGÓ (el conductor que la llevaba):
--
--   · `bolsa_llego_por_error(codigo)`: la sala que encuentra una bolsa que no
--     es suya la reporta desde el mismo escáner de recibir. Queda anotado DÓNDE
--     está (`bolsa_en_sala_equivocada`), se cierra la custodia de quien la
--     llevaba y, desde ese momento, la bolsa SALE de esa sala para las rutas:
--     `_bolsas_por_llevar` la sugiere desde ahí hacia su destino. Se cierra
--     sola cuando el destino la recibe.
--   · `avisar_bolsas_entregadas_sin_recibir()` (cron cada hora en horario de
--     sala): una bolsa que la ruta dio por entregada hace más de 24 h y la sala
--     no recibió. Un aviso por bolsa (`ruta_bolsas.avisada_sin_recibir_at`).
--
-- `bolsa_ajena(codigo)` es la lectura que hace posible lo primero: la sala no
-- puede ver traslados ajenos (RLS de `approval_requests`), así que hoy su
-- escáner decía «no encontramos ese ticket». Devuelve sólo nombres de salas.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.bolsa_en_sala_equivocada (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  branch_id      bigint NOT NULL,
  reportado_por  uuid NOT NULL REFERENCES public.employees(id),
  reportado_at   timestamptz NOT NULL DEFAULT now(),
  resuelto_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.bolsa_en_sala_equivocada IS
  'Bolsa de traslado que quedó en una sala que no es su destino: dónde está y quién lo reportó. Se cierra cuando el destino la recibe.';
CREATE INDEX IF NOT EXISTS bolsa_en_sala_equivocada_request_idx ON public.bolsa_en_sala_equivocada (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS bolsa_en_sala_equivocada_una_abierta
  ON public.bolsa_en_sala_equivocada (request_id) WHERE resuelto_at IS NULL;

ALTER TABLE public.bolsa_en_sala_equivocada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bloqueo_global ON public.bolsa_en_sala_equivocada;
CREATE POLICY bloqueo_global ON public.bolsa_en_sala_equivocada AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));
DROP POLICY IF EXISTS bolsa_en_sala_equivocada_select ON public.bolsa_en_sala_equivocada;
CREATE POLICY bolsa_en_sala_equivocada_select ON public.bolsa_en_sala_equivocada FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('traslados', 'can_view')));

ALTER TABLE public.ruta_bolsas ADD COLUMN IF NOT EXISTS avisada_sin_recibir_at timestamptz;

-- ── A quién se avisa: Bodega + quien la entregó ──────────────────────────
CREATE OR REPLACE FUNCTION public._destinatarios_bodega_y(p_extra uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT coalesce(array_agg(DISTINCT x), '{}')
  FROM (
    SELECT e.id AS x FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.branch_id IN (SELECT m.branch_id FROM public.erp_sucursal_map m WHERE m.es_bodega)
    UNION
    SELECT p_extra WHERE p_extra IS NOT NULL
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public._destinatarios_bodega_y(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._destinatarios_bodega_y(uuid) TO service_role;

-- Por `notify_employees`, la canónica: respeta el horario de cada quien (el
-- aviso y su push se difieren juntos) y no le avisa a quien hizo la acción.
CREATE OR REPLACE FUNCTION public._avisar_bolsa(p_dest uuid[], p_titulo text, p_cuerpo text,
                                                p_request uuid, p_que text, p_branch bigint)
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT public.notify_employees(p_dest, 'REQUEST_RESOLVED', p_titulo, p_cuerpo, '/traslados',
                                 jsonb_build_object('request_id', p_request, 'resuelta', p_que),
                                 true, p_branch::integer);
$$;
REVOKE EXECUTE ON FUNCTION public._avisar_bolsa(uuid[], text, text, uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._avisar_bolsa(uuid[], text, text, uuid, text, bigint) TO service_role;

-- ── Una bolsa por su código, sin RLS, y si está «en camino» ──────────────
-- En camino = despachada y sin recibir (la verdad de JavaScript, como
-- `_bolsas_por_llevar`). Los «sobrante» no son una bolsa física.
CREATE OR REPLACE FUNCTION public._bolsa_por_codigo(p_codigo text)
RETURNS TABLE (request_id uuid, codigo text, origen_branch_id bigint, destino_branch_id bigint,
               origen text, destino text, en_camino boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  WITH c AS (SELECT nullif(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), '') AS v),
  ar AS (
    SELECT a.* FROM public.approval_requests a, c
    WHERE c.v IS NOT NULL
      AND NOT (a.metadata ? 'sobrante_de')
      AND ((a.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
            AND a.metadata->'erp_traslado'->>'id_traslado' = c.v)
        OR (a.type = 'INVENTORY_TRANSFER_PUSH' AND a.metadata->>'codigo_bolsa' = c.v))
    ORDER BY a.updated_at DESC LIMIT 1
  )
  SELECT ar.id,
         coalesce(ar.metadata->'erp_traslado'->>'id_traslado', ar.metadata->>'codigo_bolsa'),
         nullif(ar.metadata->>'origen_branch_id', '')::bigint,
         nullif(ar.metadata->>'branch_id', '')::bigint,
         bo.name, bd.name,
         CASE WHEN ar.type = 'INVENTORY_TRANSFER_PUSH'
              THEN EXISTS (SELECT 1 FROM public.envio_linea l WHERE l.request_id = ar.id AND l.estado = 'enviada')
              ELSE ar.status = 'APPROVED'
                   AND coalesce(ar.metadata->>'erp_traslado', '') NOT IN ('', 'false', '0')
                   AND coalesce(ar.metadata->>'erp_recibido', '') IN ('', 'false', '0')
         END
  FROM ar
  LEFT JOIN public.branches bo ON bo.id = nullif(ar.metadata->>'origen_branch_id', '')::bigint
  LEFT JOIN public.branches bd ON bd.id = nullif(ar.metadata->>'branch_id', '')::bigint;
$$;
REVOKE EXECUTE ON FUNCTION public._bolsa_por_codigo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bolsa_por_codigo(text) TO service_role;

-- La sala desde donde se reporta: la que se pide si la persona puede obrar por
-- ella (sala de respaldo), si no la suya.
CREATE OR REPLACE FUNCTION public._sala_que_reporta(p_branch_id bigint)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  SELECT CASE WHEN p_branch_id IS NOT NULL AND public.puede_entregar_de(public.auth_employee_id(), p_branch_id)
              THEN p_branch_id ELSE public.auth_employee_branch_id()::bigint END;
$$;
REVOKE EXECUTE ON FUNCTION public._sala_que_reporta(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sala_que_reporta(bigint) TO service_role;

-- ── Lectura para el escáner de la sala: ¿de quién es esta bolsa? ─────────
CREATE OR REPLACE FUNCTION public.bolsa_ajena(p_codigo text, p_branch_id bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_sala bigint := public._sala_que_reporta(p_branch_id);
  v_b    record;
BEGIN
  IF public.auth_employee_id() IS NULL THEN
    RETURN json_build_object('encontrada', false);
  END IF;
  SELECT * INTO v_b FROM public._bolsa_por_codigo(p_codigo);
  IF v_b.request_id IS NULL OR NOT v_b.en_camino THEN
    RETURN json_build_object('encontrada', false);
  END IF;
  RETURN json_build_object(
    'encontrada', true, 'codigo', v_b.codigo,
    'origen', v_b.origen, 'destino', v_b.destino,
    'es_para_esta_sala', v_b.destino_branch_id = v_sala,
    'ya_reportada_aqui', EXISTS (SELECT 1 FROM public.bolsa_en_sala_equivocada x
                                 WHERE x.request_id = v_b.request_id AND x.resuelto_at IS NULL AND x.branch_id = v_sala));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bolsa_ajena(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolsa_ajena(text, bigint) TO authenticated, service_role;

-- ── «Llegó aquí por error» ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bolsa_llego_por_error(p_codigo text, p_branch_id bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_quien   uuid := public.auth_employee_id();
  v_sala    bigint := public._sala_que_reporta(p_branch_id);
  v_nsala   text;
  v_b       record;
  v_abierta record;
  v_entrego uuid;
  v_nentr   text;
  v_cuerpo  text;
BEGIN
  IF v_quien IS NULL OR v_sala IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No sabemos desde qué sala lo reportas.');
  END IF;
  SELECT * INTO v_b FROM public._bolsa_por_codigo(p_codigo);
  IF v_b.request_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No encontramos esa bolsa. Puede que el código no se haya leído bien.');
  END IF;
  IF NOT v_b.en_camino THEN
    RETURN json_build_object('ok', false, 'error', 'Esa bolsa ya se recibió o todavía no salió.');
  END IF;
  IF v_b.destino_branch_id = v_sala THEN
    RETURN json_build_object('ok', false, 'codigo', 'ES_DE_AQUI', 'error', 'Esa bolsa es para esta sala: recíbanla.');
  END IF;

  SELECT * INTO v_abierta FROM public.bolsa_en_sala_equivocada
   WHERE request_id = v_b.request_id AND resuelto_at IS NULL FOR UPDATE;
  IF v_abierta.id IS NOT NULL AND v_abierta.branch_id = v_sala THEN
    RETURN json_build_object('ok', true, 'ya', true, 'destino', v_b.destino);
  END IF;

  -- Quién la entregó: la última ruta que la llevó, o el recorrido.
  SELECT coalesce(rb.entregada_por, rb.recogida_por) INTO v_entrego
    FROM public.ruta_bolsas rb
   WHERE rb.request_id = v_b.request_id AND rb.soltada_at IS NULL
   ORDER BY rb.recogida_at DESC LIMIT 1;
  IF v_entrego IS NULL THEN
    SELECT r.retirador_id INTO v_entrego
      FROM public.retiro_bultos x JOIN public.retiros r ON r.id = x.retiro_id
     WHERE x.request_id = v_b.request_id ORDER BY x.cargado_at DESC LIMIT 1;
  END IF;

  -- Está acá: la custodia de quien la llevaba termina.
  UPDATE public.ruta_bolsas SET entregada_at = now()
   WHERE request_id = v_b.request_id AND entregada_at IS NULL AND soltada_at IS NULL;
  UPDATE public.retiro_bultos SET entregado_at = now()
   WHERE request_id = v_b.request_id AND entregado_at IS NULL;

  IF v_abierta.id IS NOT NULL THEN
    UPDATE public.bolsa_en_sala_equivocada
       SET branch_id = v_sala, reportado_por = v_quien, reportado_at = now()
     WHERE id = v_abierta.id;
  ELSE
    INSERT INTO public.bolsa_en_sala_equivocada (request_id, branch_id, reportado_por)
    VALUES (v_b.request_id, v_sala, v_quien);
  END IF;

  SELECT name INTO v_nsala FROM public.branches WHERE id = v_sala;
  SELECT name INTO v_nentr FROM public.employees WHERE id = v_entrego;
  v_cuerpo := coalesce(v_nsala, 'Una sala') || ' recibió por error la bolsa '
           || coalesce(v_b.codigo, '') || ' de ' || coalesce(v_b.origen, '¿?') || ' para '
           || coalesce(v_b.destino, '¿?') || '.'
           || coalesce(' La entregó ' || v_nentr || '.', '')
           || ' Queda ahí: las rutas que pasen la verán para llevarla a ' || coalesce(v_b.destino, 'su sala') || '.';
  PERFORM public._avisar_bolsa(public._destinatarios_bodega_y(v_entrego),
    'Una bolsa quedó en la sala equivocada', v_cuerpo, v_b.request_id, 'SALA_EQUIVOCADA', v_sala);

  RETURN json_build_object('ok', true, 'destino', v_b.destino, 'entrego', v_nentr);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bolsa_llego_por_error(text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bolsa_llego_por_error(text, bigint) TO authenticated, service_role;

-- ── Entregada por la ruta hace más de 24 h y la sala no la recibió ───────
CREATE OR REPLACE FUNCTION public.avisar_bolsas_entregadas_sin_recibir()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  r   record;
  v_n integer := 0;
BEGIN
  -- Un envío se recibe aceptando sus renglones (no con `erp_recibido`): el
  -- reporte de sala equivocada de una bolsa que ya no está en camino se cierra acá.
  UPDATE public.bolsa_en_sala_equivocada x SET resuelto_at = now()
   WHERE x.resuelto_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.approval_requests a, public._bolsa_por_codigo(
                       coalesce(a.metadata->'erp_traslado'->>'id_traslado', a.metadata->>'codigo_bolsa')) b
                      WHERE a.id = x.request_id AND b.request_id = x.request_id AND b.en_camino);

  FOR r IN
    SELECT rb.id, rb.request_id, rb.codigo, rb.entregada_at, rb.destino_branch_id,
           coalesce(rb.entregada_por, rb.recogida_por) AS entrego,
           bo.name AS origen, bd.name AS destino, e.name AS nentr
      FROM public.ruta_bolsas rb
      LEFT JOIN public.branches bo ON bo.id = rb.origen_branch_id
      LEFT JOIN public.branches bd ON bd.id = rb.destino_branch_id
      LEFT JOIN public.employees e ON e.id = coalesce(rb.entregada_por, rb.recogida_por)
     WHERE rb.entregada_at < now() - interval '24 hours'
       AND rb.entregada_at > now() - interval '30 days'
       AND rb.avisada_sin_recibir_at IS NULL
       AND rb.soltada_at IS NULL
       AND EXISTS (SELECT 1 FROM public._bolsa_por_codigo(rb.codigo) b
                    WHERE b.request_id = rb.request_id AND b.en_camino)
       AND NOT EXISTS (SELECT 1 FROM public.bolsa_en_sala_equivocada x
                        WHERE x.request_id = rb.request_id AND x.resuelto_at IS NULL)
     FOR UPDATE OF rb SKIP LOCKED
  LOOP
    PERFORM public._avisar_bolsa(public._destinatarios_bodega_y(r.entrego),
      'Bolsa entregada y sin recibir',
      'La bolsa ' || coalesce(r.codigo, '') || ' de ' || coalesce(r.origen, '¿?') || ' para '
        || coalesce(r.destino, '¿?') || ' se entregó'
        || coalesce(' (' || r.nentr || ')', '') || ' el '
        || to_char(r.entregada_at AT TIME ZONE 'America/El_Salvador', 'DD/MM "a las" FMHH12:MI AM')
        || ' y ' || coalesce(r.destino, 'la sala') || ' todavía no la recibe.',
      r.request_id, 'ENTREGADA_SIN_RECIBIR', r.destino_branch_id);
    UPDATE public.ruta_bolsas SET avisada_sin_recibir_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.avisar_bolsas_entregadas_sin_recibir() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_bolsas_entregadas_sin_recibir() TO service_role;

-- Cada hora en horario de sala (12-03 UTC = 6 am - 9 pm SV). Sólo SQL: no
-- llama al sistema de origen.
SELECT cron.unschedule('avisar-bolsas-entregadas-sin-recibir')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-bolsas-entregadas-sin-recibir');
SELECT cron.schedule('avisar-bolsas-entregadas-sin-recibir', '23 12-23,0-3 * * *',
                     $$SELECT public.avisar_bolsas_entregadas_sin_recibir()$$);

-- ── Las rutas sugieren la bolsa DESDE donde quedó ────────────────────────
-- Cuerpo de `20261113050615` con dos cambios: el origen es la sala donde quedó
-- (si hay un reporte abierto), y «ya la entregó una ruta» sólo cuenta si fue
-- DESPUÉS del reporte.
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
  WITH b0 AS (
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
  ),
  b AS (
    SELECT b0.*, coalesce(x.branch_id, b0.o) AS o_real, x.reportado_at
    FROM b0
    LEFT JOIN public.bolsa_en_sala_equivocada x ON x.request_id = b0.id AND x.resuelto_at IS NULL
  )
  -- Una bolsa que una ruta ya ENTREGÓ (después de cualquier reporte de sala
  -- equivocada) está en la sala, no por llevar.
  SELECT b.id, b.familia, b.codigo, b.o_real, b.d,
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
  LEFT JOIN public.erp_sucursal_map mo ON mo.branch_id = b.o_real
  LEFT JOIN public.erp_sucursal_map md ON md.branch_id = b.d
  LEFT JOIN public.branches bo ON bo.id = b.o_real
  LEFT JOIN public.branches bd ON bd.id = b.d
  WHERE NOT EXISTS (SELECT 1 FROM public.ruta_bolsas rb
                    WHERE rb.request_id = b.id AND rb.entregada_at IS NOT NULL
                      AND rb.entregada_at > coalesce(b.reportado_at, '-infinity'::timestamptz));
$$;

-- ── Al recibir: se cierra la custodia y el reporte de sala equivocada ────
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
    UPDATE public.bolsa_en_sala_equivocada
       SET resuelto_at = now()
     WHERE request_id = NEW.id AND resuelto_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
