SET lock_timeout = '5s';

-- ¿Esta persona puede entregar lo que está guardado en esa sala?
--
-- Es la MISMA vara que usa la policy de despacho: pertenece a la sala, o la
-- cubre ahora mismo porque está cerrada. Escribir una versión propia acá sería
-- garantizar que el día que cambie un horario una de las dos deje de coincidir,
-- y la que se equivoque hacia abajo traba un retiro sin que nadie entienda por
-- qué.
CREATE OR REPLACE FUNCTION public.puede_entregar_de(p_employee_id uuid, p_branch_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id
      AND ( e.branch_id = p_branch_id
            OR p_branch_id::int = ANY (public.salas_que_cubre_ahora(e.branch_id::int)) )
  );
$function$;

-- ─── Cargar una bolsa al retiro ─────────────────────────────────────────────
--
-- DEFINER porque es acá donde viven las reglas: que la bolsa exista, que esté
-- despachada y sin recibir, que no vaya ya en otro retiro, y que alguien haya
-- firmado la entrega. Con las reglas del lado del navegador, cualquiera podría
-- insertar un bulto sin firma.
--
-- Abre el retiro solo si no hay uno en curso: quien escanea no tiene que
-- acordarse de «empezar un recorrido», que es justo el paso que se olvida.
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
  v_propia    boolean;
  v_retiro    uuid;
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
  -- null, false y 0 son todos «no». Si divergieran, una bolsa podría estar en
  -- la lista de pendientes y a la vez rebotar acá.
  IF coalesce(v_meta->>'erp_traslado', '') IN ('', 'false', '0') THEN
    RETURN json_build_object('ok', false, 'error', 'Esa bolsa todavía no salió de la sala.');
  END IF;
  IF coalesce(v_meta->>'erp_recibido', '') NOT IN ('', 'false', '0') THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_RECIBIDO',
                             'error', 'Esa bolsa ya se recibió.');
  END IF;

  -- DÓNDE ESTABA la bolsa. Con `por_respaldo` la despachó otra sala, pero el
  -- producto se quedó donde estaba: `origen_branch_id` es siempre el lugar.
  v_origen := nullif(v_meta->>'origen_branch_id', '')::bigint;

  -- Si quien retira es de esa sala —o la cubre—, la firma sería la suya: no se
  -- pide. Es la excepción que pidió el usuario.
  v_propia := public.puede_entregar_de(v_quien, v_origen);

  IF NOT v_propia THEN
    IF p_entrego_id IS NULL THEN
      RETURN json_build_object('ok', false, 'codigo', 'FALTA_ENTREGA',
        'error', 'Falta el carné de quien entrega en esa sala.');
    END IF;
    IF p_entrego_id = v_quien THEN
      RETURN json_build_object('ok', false, 'codigo', 'FALTA_ENTREGA',
        'error', 'Quien entrega tiene que ser alguien de esa sala, no vos.');
    END IF;
    IF NOT public.puede_entregar_de(p_entrego_id, v_origen) THEN
      RETURN json_build_object('ok', false, 'codigo', 'ENTREGA_AJENA',
        'error', 'Esa persona no puede entregar producto de esa sala.');
    END IF;
  END IF;

  SELECT r.id INTO v_retiro FROM public.retiros r
  WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL LIMIT 1;

  IF v_retiro IS NULL THEN
    INSERT INTO public.retiros (retirador_id) VALUES (v_quien) RETURNING id INTO v_retiro;
  END IF;

  BEGIN
    INSERT INTO public.retiro_bultos (retiro_id, request_id, origen_branch_id, entrego_id)
    VALUES (v_retiro, p_request_id, v_origen, CASE WHEN v_propia THEN NULL ELSE p_entrego_id END);
  EXCEPTION WHEN unique_violation THEN
    -- El índice parcial la frenó: ya va encima de alguien. Se contesta quién,
    -- que es lo único que resuelve la situación de quien está parado ahí.
    RETURN json_build_object('ok', false, 'codigo', 'YA_CARGADA',
      'error', coalesce((
        SELECT 'Esa bolsa ya la lleva ' || e.name
        FROM public.retiro_bultos b
        JOIN public.retiros r2 ON r2.id = b.retiro_id
        JOIN public.employees e ON e.id = r2.retirador_id
        WHERE b.request_id = p_request_id AND b.entregado_at IS NULL LIMIT 1
      ), 'Esa bolsa ya va en otro retiro.'));
  END;

  RETURN json_build_object('ok', true, 'retiro_id', v_retiro, 'firma_propia', v_propia);
END;
$function$;

-- ─── Soltar una bolsa que se cargó por error ───────────────────────────────
-- Sólo la puede soltar quien la lleva, y sólo mientras no se haya entregado.
CREATE OR REPLACE FUNCTION public.retiro_soltar(p_request_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_quien uuid := public.auth_employee_id(); v_n int;
BEGIN
  IF v_quien IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Sesión inválida.'); END IF;
  DELETE FROM public.retiro_bultos b
   USING public.retiros r
   WHERE b.retiro_id = r.id AND r.retirador_id = v_quien AND r.cerrado_at IS NULL
     AND b.request_id = p_request_id AND b.entregado_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'Esa bolsa no la llevas vos.');
  END IF;
  RETURN json_build_object('ok', true);
END;
$function$;

-- ─── Cerrar el recorrido ────────────────────────────────────────────────────
-- No se puede cerrar con bultos encima: «si lo sobró se debe entregar»
-- (decisión del usuario). Por eso el aviso de los tres días no es opcional.
CREATE OR REPLACE FUNCTION public.retiro_cerrar()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v_quien uuid := public.auth_employee_id(); v_retiro uuid; v_pend int;
BEGIN
  IF v_quien IS NULL THEN RETURN json_build_object('ok', false, 'error', 'Sesión inválida.'); END IF;
  SELECT r.id INTO v_retiro FROM public.retiros r
   WHERE r.retirador_id = v_quien AND r.cerrado_at IS NULL LIMIT 1;
  IF v_retiro IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'No tienes un recorrido abierto.');
  END IF;
  SELECT count(*) INTO v_pend FROM public.retiro_bultos b
   WHERE b.retiro_id = v_retiro AND b.entregado_at IS NULL;
  IF v_pend > 0 THEN
    RETURN json_build_object('ok', false, 'codigo', 'QUEDAN_BULTOS', 'pendientes', v_pend,
      'error', 'Todavía llevas ' || v_pend || ' sin entregar.');
  END IF;
  UPDATE public.retiros SET cerrado_at = now() WHERE id = v_retiro;
  RETURN json_build_object('ok', true);
END;
$function$;

-- ─── La custodia se cierra sola al recibir ─────────────────────────────────
--
-- Trigger y no una llamada desde la pantalla: la recepción entra por más de un
-- camino —el botón «Ya llegó, recibir», el escaneo, y mañana lo que sea— y el
-- que se olvide de cerrar la custodia dejaría una bolsa entregada figurando
-- encima de alguien. El hecho es «la sala la recibió»; que la custodia termine
-- es una consecuencia, no otro paso que alguien tenga que acordarse de dar.
CREATE OR REPLACE FUNCTION public.retiro_cerrar_custodia()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  IF coalesce(NEW.metadata->>'erp_recibido', '') NOT IN ('', 'false', '0')
     AND coalesce(OLD.metadata->>'erp_recibido', '') IN ('', 'false', '0') THEN
    UPDATE public.retiro_bultos
       SET entregado_at = now()
     WHERE request_id = NEW.id AND entregado_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS retiro_cerrar_custodia_trg ON public.approval_requests;
CREATE TRIGGER retiro_cerrar_custodia_trg
AFTER UPDATE OF metadata ON public.approval_requests
FOR EACH ROW
WHEN (OLD.metadata IS DISTINCT FROM NEW.metadata)
EXECUTE FUNCTION public.retiro_cerrar_custodia();

REVOKE EXECUTE ON FUNCTION public.puede_entregar_de(uuid, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retiro_cargar(uuid, uuid)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retiro_soltar(uuid)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retiro_cerrar()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retiro_cerrar_custodia()         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puede_entregar_de(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retiro_cargar(uuid, uuid)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retiro_soltar(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retiro_cerrar()                  TO authenticated, service_role;
