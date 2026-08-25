SET lock_timeout = '5s';

-- La firma de quien entrega deja de ser un CANDADO y pasa a ser un paso aparte.
--
-- Reporte del usuario, parado en La Popular: «si me voy a llevar un producto de
-- solicitud a otra sucursal, al escanearlo me dice que no pertenezco a la
-- sucursal, entonces?». Y la decisión: «sí tiene que confirmar, pero me debe
-- permitir cargar los productos y de último o de primero solicitar quien
-- entrega, pero son complementarias».
--
-- Lo que estaba mal no era la regla —la cadena de custodia sigue— sino el
-- MOMENTO: `retiro_cargar` rebotaba con `FALTA_ENTREGA` y no cargaba nada, así
-- que quien no es de la sala no podía ni empezar a escanear sin tener a alguien
-- de esa sala parado al lado, carné en mano, bolsa por bolsa. Cuatro bolsas
-- eran cuatro interrupciones a la misma persona.
--
-- Ahora la carga NUNCA se traba, y la firma se pide UNA vez por recorrido y por
-- persona, en cualquiera de los dos órdenes:
--
--   · DE ÚLTIMO  — se escanean las bolsas, quedan marcadas «falta firma», y
--                  antes de irse alguien de la sala pasa el carné: se estampan
--                  todas las suyas de una.
--   · DE PRIMERO — pasa el carné al llegar, queda vigente para ese recorrido, y
--                  cada bolsa que se escanee después nace ya firmada.
--
-- Por eso la firma vive en su propia tabla y no sólo en la columna del bulto:
-- una firma dada ANTES de cargar nada no tiene ningún bulto donde escribirse.

-- ─── Falta la firma, o nunca hizo falta ─────────────────────────────────────
--
-- `entrego_id IS NULL` significaba las DOS cosas —«el retirador es de la sala,
-- su firma sería la suya» y «no firmó nadie»— porque hasta hoy la segunda no
-- podía existir: sin firma no se cargaba. Ahora sí existe, y sin esta columna
-- las bolsas sin firmar serían indistinguibles de las que no la necesitan.
ALTER TABLE public.retiro_bultos
  ADD COLUMN IF NOT EXISTS firma_requerida boolean NOT NULL DEFAULT false;

-- ─── Quién me entregó en este recorrido ─────────────────────────────────────
--
-- Una fila por persona que firma, no por sala: `puede_entregar_de` ya sabe de
-- qué salas responde cada quien —la propia y las que cubre ahora mismo— y
-- guardar una sala acá sería una segunda vara que el día que cambie un horario
-- deja de coincidir con la primera.
CREATE TABLE IF NOT EXISTS public.retiro_firmas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retiro_id   uuid NOT NULL REFERENCES public.retiros(id) ON DELETE CASCADE,
  entrego_id  uuid NOT NULL REFERENCES public.employees(id),
  firmado_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS retiro_firmas_una_por_persona
  ON public.retiro_firmas (retiro_id, entrego_id);
CREATE INDEX IF NOT EXISTS retiro_firmas_retiro_idx  ON public.retiro_firmas (retiro_id);
CREATE INDEX IF NOT EXISTS retiro_firmas_entrego_idx ON public.retiro_firmas (entrego_id);

ALTER TABLE public.retiro_firmas ENABLE ROW LEVEL SECURITY;

-- Sólo lectura por policy, igual que las otras dos: todo lo que escribe pasa
-- por funciones DEFINER, que son las que verifican quién puede firmar por quién.
DROP POLICY IF EXISTS retiro_firmas_select ON public.retiro_firmas;
CREATE POLICY retiro_firmas_select ON public.retiro_firmas FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('traslados', 'can_view')));

-- ─── Cargar una bolsa: ya no rebota por falta de firma ─────────────────────
CREATE OR REPLACE FUNCTION public.retiro_cargar(p_request_id uuid, p_entrego_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_quien     uuid := public.auth_employee_id();
  v_meta      jsonb;
  v_tipo      text;
  v_origen    bigint;
  v_destino   bigint;
  v_propia    boolean;
  v_retiro    uuid;
  v_firma     uuid;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;

  SELECT ar.type, ar.metadata INTO v_tipo, v_meta
  FROM public.approval_requests ar WHERE ar.id = p_request_id;

  IF v_tipo IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese traslado no existe.');
  END IF;
  IF v_tipo NOT IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH') THEN
    RETURN json_build_object('ok', false, 'error', 'Ese documento no es un traslado entre salas.');
  END IF;

  -- La verdad de JavaScript, igual que `get_traslados_por_recibir`: ausente,
  -- null, false y 0 son todos «no».
  IF coalesce(v_meta->>'erp_traslado', '') IN ('', 'false', '0') THEN
    RETURN json_build_object('ok', false, 'error', 'Esa bolsa todavía no salió de la sala.');
  END IF;
  IF coalesce(v_meta->>'erp_recibido', '') NOT IN ('', 'false', '0') THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_RECIBIDO',
                             'error', 'Esa bolsa ya se recibió.');
  END IF;

  v_origen  := nullif(v_meta->>'origen_branch_id', '')::bigint;
  v_destino := nullif(v_meta->>'branch_id', '')::bigint;

  v_propia := v_origen IS NOT NULL AND public.puede_entregar_de(v_quien, v_origen);

  -- ── La firma, si hay alguna que sirva ────────────────────────────────────
  --
  -- Tres caminos, y ninguno traba la carga:
  --   · el retirador es de esa sala        → no hace falta firma
  --   · viene un carné en esta llamada     → se valida y se guarda
  --   · ya firmó alguien en este recorrido → se hereda
  -- y si no hay ninguno, la bolsa se carga igual y queda marcada «falta firma».
  IF NOT v_propia THEN
    IF p_entrego_id IS NOT NULL THEN
      IF p_entrego_id = v_quien THEN
        RETURN json_build_object('ok', false, 'codigo', 'FIRMA_PROPIA',
          'error', 'Quien entrega tiene que ser alguien de esa sala, no tú.');
      END IF;
      IF v_origen IS NOT NULL AND NOT public.puede_entregar_de(p_entrego_id, v_origen) THEN
        RETURN json_build_object('ok', false, 'codigo', 'ENTREGA_AJENA',
          'error', 'Esa persona no puede entregar producto de esa sala.');
      END IF;
      v_firma := p_entrego_id;
    ELSIF v_origen IS NOT NULL THEN
      SELECT f.entrego_id INTO v_firma
      FROM public.retiro_firmas f
      JOIN public.retiros r ON r.id = f.retiro_id
      WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL
        AND public.puede_entregar_de(f.entrego_id, v_origen)
      ORDER BY f.firmado_at DESC LIMIT 1;
    END IF;
  END IF;

  SELECT r.id INTO v_retiro FROM public.retiros r
  WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL LIMIT 1;

  IF v_retiro IS NULL THEN
    INSERT INTO public.retiros (retirador_id) VALUES (v_quien) RETURNING id INTO v_retiro;
  END IF;

  IF v_firma IS NOT NULL THEN
    INSERT INTO public.retiro_firmas (retiro_id, entrego_id) VALUES (v_retiro, v_firma)
    ON CONFLICT (retiro_id, entrego_id) DO NOTHING;
  END IF;

  BEGIN
    INSERT INTO public.retiro_bultos (retiro_id, request_id, origen_branch_id, entrego_id, firma_requerida)
    VALUES (v_retiro, p_request_id, v_origen, CASE WHEN v_propia THEN NULL ELSE v_firma END,
            NOT v_propia);
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA',
      'error', coalesce((
        SELECT 'Esa bolsa ya la lleva ' || e.name
        FROM public.retiro_bultos b
        JOIN public.retiros r2 ON r2.id = b.retiro_id
        JOIN public.employees e ON e.id = r2.retirador_id
        WHERE b.request_id = p_request_id AND b.entregado_at IS NULL LIMIT 1
      ), 'Esa bolsa ya va en otro retiro.'));
  END;

  RETURN json_build_object(
    'ok', true, 'retiro_id', v_retiro,
    'origen_branch_id', v_origen, 'destino_branch_id', v_destino,
    'firma_propia', v_propia,
    -- Lo que la pantalla necesita para saber si tiene que insistir con el carné.
    'falta_firma', (NOT v_propia) AND v_firma IS NULL,
    'entrego', (SELECT e.name FROM public.employees e WHERE e.id = v_firma));
END;
$function$;

-- ─── La firma: una vez por persona, vale para todo el recorrido ────────────
--
-- Sirve en los dos órdenes por construcción: estampa lo que YA está cargado y
-- queda registrada para lo que se cargue DESPUÉS. Por eso abre el recorrido si
-- no hay ninguno —firmar de primero es la mitad del pedido— y por eso devolver
-- `firmadas: 0` no es un fallo.
CREATE OR REPLACE FUNCTION public.retiro_firmar(p_entrego_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_quien  uuid := public.auth_employee_id();
  v_retiro uuid;
  v_nombre text;
  v_sala   bigint;
  v_n      int;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  IF p_entrego_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Falta el carné de quien entrega.');
  END IF;
  IF p_entrego_id = v_quien THEN
    RETURN json_build_object('ok', false, 'codigo', 'FIRMA_PROPIA',
      'error', 'Quien entrega tiene que ser alguien de esa sala, no tú.');
  END IF;

  SELECT e.name, e.branch_id INTO v_nombre, v_sala
  FROM public.employees e WHERE e.id = p_entrego_id;

  IF v_nombre IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Ese carné no es de nadie.');
  END IF;
  -- Sin sala no responde por el producto de ninguna: firmar sería anotar una
  -- custodia que no dice de dónde salió nada.
  IF v_sala IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'SIN_SALA',
      'error', v_nombre || ' no está asignado a ninguna sala, así que no puede entregar producto.');
  END IF;

  SELECT r.id INTO v_retiro FROM public.retiros r
  WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL LIMIT 1;

  IF v_retiro IS NULL THEN
    INSERT INTO public.retiros (retirador_id) VALUES (v_quien) RETURNING id INTO v_retiro;
  END IF;

  INSERT INTO public.retiro_firmas (retiro_id, entrego_id) VALUES (v_retiro, p_entrego_id)
  ON CONFLICT (retiro_id, entrego_id) DO NOTHING;

  -- Lo que ya va encima y le corresponde a esta persona. `puede_entregar_de`
  -- decide de qué salas responde: la suya y las que cubre ahora mismo.
  UPDATE public.retiro_bultos b
     SET entrego_id = p_entrego_id
   WHERE b.retiro_id = v_retiro
     AND b.entregado_at IS NULL
     AND b.firma_requerida
     AND b.entrego_id IS NULL
     AND b.origen_branch_id IS NOT NULL
     AND public.puede_entregar_de(p_entrego_id, b.origen_branch_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN json_build_object('ok', true, 'retiro_id', v_retiro,
                           'firmadas', v_n, 'quien', v_nombre);
END;
$function$;

-- ─── Lo que llevo encima, y lo que le falta firma ──────────────────────────
CREATE OR REPLACE FUNCTION public.retiro_abierto()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH mio AS (
    SELECT r.id, r.abierto_at FROM public.retiros r
    WHERE r.retirador_id = public.auth_employee_id() AND r.cerrado_at IS NULL
    LIMIT 1
  )
  SELECT to_json(t) FROM (
    SELECT
      (SELECT id FROM mio)         AS retiro_id,
      (SELECT abierto_at FROM mio) AS abierto_at,
      coalesce((
        SELECT json_agg(to_json(b) ORDER BY b.cargado_at)
        FROM (
          SELECT
            bu.request_id,
            bu.cargado_at,
            bu.origen_branch_id,
            ar.metadata->>'origen_branch_name'      AS origen,
            ar.metadata->>'branch_name'             AS destino,
            nullif(ar.metadata->>'branch_id','')::bigint AS branch_id_destino,
            ar.metadata->'items'                    AS items,
            ar.metadata->'erp_traslado'->>'id_traslado' AS codigo,
            e.name                                  AS entrego,
            -- «Le falta firma», que NO es lo mismo que no tener `entrego`: una
            -- bolsa retirada de la sala propia nunca la va a tener y está bien.
            (bu.firma_requerida AND bu.entrego_id IS NULL) AS falta_firma,
            floor(extract(epoch FROM (now() - bu.cargado_at)) / 86400)::int AS dias
          FROM public.retiro_bultos bu
          JOIN public.approval_requests ar ON ar.id = bu.request_id
          LEFT JOIN public.employees e ON e.id = bu.entrego_id
          WHERE bu.retiro_id = (SELECT id FROM mio) AND bu.entregado_at IS NULL
        ) b
      ), '[]'::json) AS bultos,
      -- Agrupado POR SALA, que es como se resuelve: se le pide el carné a
      -- alguien de esa sala, una vez, y se firman todas las suyas de una.
      coalesce((
        SELECT json_agg(to_json(s) ORDER BY s.sala)
        FROM (
          SELECT bu.origen_branch_id AS branch_id,
                 br.name             AS sala,
                 count(*)::int       AS bolsas
          FROM public.retiro_bultos bu
          LEFT JOIN public.branches br ON br.id = bu.origen_branch_id
          WHERE bu.retiro_id = (SELECT id FROM mio)
            AND bu.entregado_at IS NULL
            AND bu.firma_requerida AND bu.entrego_id IS NULL
          GROUP BY bu.origen_branch_id, br.name
        ) s
      ), '[]'::json) AS sin_firma,
      -- Quién ya firmó en este recorrido: sirve para no volver a pedirle el
      -- carné a la misma persona, y para que se vea que el paso se dio.
      coalesce((
        SELECT json_agg(to_json(f) ORDER BY f.firmado_at)
        FROM (
          SELECT fi.entrego_id, e2.name AS quien, fi.firmado_at
          FROM public.retiro_firmas fi
          JOIN public.employees e2 ON e2.id = fi.entrego_id
          WHERE fi.retiro_id = (SELECT id FROM mio)
        ) f
      ), '[]'::json) AS firmas
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.retiro_firmar(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.retiro_firmar(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.retiro_cargar(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.retiro_cargar(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.retiro_abierto() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.retiro_abierto() TO authenticated, service_role;

COMMENT ON TABLE public.retiro_firmas IS
  'Quién entregó producto en cada recorrido. Una fila por persona: vale para todas las bolsas de las salas de las que esa persona responde, firmadas antes o después de cargarlas.';
