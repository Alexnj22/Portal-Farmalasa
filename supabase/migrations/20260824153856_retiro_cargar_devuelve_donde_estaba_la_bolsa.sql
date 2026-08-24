SET lock_timeout = '5s';

-- `retiro_cargar` no devolvía DÓNDE estaba la bolsa, y la pantalla lo leía.
--
-- `r.origen_branch_id` venía `undefined` siempre, así que el recorrido nunca
-- sabía en qué sala estaba parado quien escanea. Consecuencia: la mitad de
-- «qué recoger acá» —la que existe justamente para que no se olvide una bolsa—
-- **no se ejecutaba nunca**, y el panel de «qué dejar» agrupaba por la sala
-- equivocada. No fallaba nada: simplemente no aparecía.
--
-- Se agrega también `destino_branch_id`, que la pantalla ya necesitaba para
-- separar «lo que va acá» de «lo que sigue viaje» sin volver a consultar.

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
  v_destino   bigint;
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
  v_origen  := nullif(v_meta->>'origen_branch_id', '')::bigint;
  v_destino := nullif(v_meta->>'branch_id', '')::bigint;

  -- Sin sala de origen NO se puede decidir quién firma, y hay que decirlo así.
  --
  -- Antes se seguía: `puede_entregar_de(quien, NULL)` da falso —`= NULL` es NULL
  -- y `NULL = ANY(...)` también— así que pedía un carné, y el carné también daba
  -- falso. O sea que TODOS los carnés del edificio recibían el mismo
  -- «esa persona no puede entregar producto de esa sala», culpando a la persona
  -- por un dato que falta en el traslado.
  IF v_origen IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'SIN_ORIGEN',
      'error', 'Ese traslado no dice de qué sala salió, así que no se puede saber quién lo entrega. Recíbelo desde la lista.');
  END IF;

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
        'error', 'Quien entrega tiene que ser alguien de esa sala, no tú.');
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

  RETURN json_build_object('ok', true, 'retiro_id', v_retiro, 'firma_propia', v_propia,
                           'origen_branch_id', v_origen, 'destino_branch_id', v_destino);
END;
$function$;
