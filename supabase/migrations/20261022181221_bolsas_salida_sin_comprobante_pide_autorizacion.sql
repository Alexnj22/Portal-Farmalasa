-- Una salida de BOLSA sin foto del comprobante también sale y queda pendiente
-- de autorización, igual que la del cajón (usuario, 2026-10-22: «sigue
-- opcional con aprobación de solicitud»). Hasta hoy `caja_movimiento_regla`
-- con `p_de_bolsa` la rechazaba, mientras la pantalla rotulaba la foto
-- «(opcional)»: la sala no tenía cómo sacar el dinero.
--
-- La solicitud es la MISMA (`CAJA_INGRESO_AUTORIZACION`): lleva
-- `operacion_bolsa` en vez de `movimiento_portal`, y `caja_ingreso_resolver`
-- decide cuál de las dos filas marcar. Rechazarla anula la salida de la bolsa
-- (el dinero vuelve a contar como de la bolsa) salvo que también haya sacado
-- del cajón: ésa se anula entera pidiendo la corrección.
SET lock_timeout = '5s';

-- ── 1. La operación de bolsa guarda su autorización ────────────────────────
ALTER TABLE public.bolsas_operaciones
  ADD COLUMN IF NOT EXISTS autorizacion text
    CHECK (autorizacion IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  ADD COLUMN IF NOT EXISTS autorizacion_solicitud uuid,
  ADD COLUMN IF NOT EXISTS autorizacion_por uuid,
  ADD COLUMN IF NOT EXISTS autorizacion_at timestamptz,
  ADD COLUMN IF NOT EXISTS autorizacion_nota text;
COMMENT ON COLUMN public.bolsas_operaciones.autorizacion IS
  'Salida sin foto del comprobante en un tipo que la pide: PENDIENTE hasta que quien tenga requests_caja la autorice. NULL = no necesitaba.';

-- ── 2. El juez: desde una bolsa también autoriza ───────────────────────────
-- `p_de_bolsa` se queda en la firma (lo pasan quienes ya existen) pero ya no
-- cambia la respuesta.
CREATE OR REPLACE FUNCTION public.caja_movimiento_regla(p_sentido text, p_tipo text, p_concepto text, p_tiene_foto boolean, p_forma_pago text DEFAULT 'EFECTIVO'::text, p_tiene_receptor boolean DEFAULT false, p_de_bolsa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t        public.caja_tipos_movimiento%ROWTYPE;
  v_texto  text;
  v_va_en  text;
  -- Apagados en el menú pero escritos por un flujo propio: el retiro de lo
  -- apartado y el abono de un faltante desde el corte.
  v_de_un_flujo text[] := ARRAY['APLICA_ANTICIPO', 'ABONO_FALTANTE'];
BEGIN
  IF nullif(btrim(coalesce(p_tipo, '')), '') IS NULL THEN
    RETURN json_build_object('error', 'Falta elegir qué tipo de movimiento es.');
  END IF;
  SELECT * INTO t FROM public.caja_tipos_movimiento WHERE codigo = p_tipo;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Ese tipo de movimiento no existe.');
  END IF;
  IF NOT t.activo AND NOT (t.codigo = ANY (v_de_un_flujo)) THEN
    RETURN json_build_object('error', 'Ese tipo de movimiento ya no se usa: elige otro de la lista.');
  END IF;
  IF t.sentido <> p_sentido THEN
    RETURN json_build_object('error', CASE t.sentido WHEN 'ENTRADA'
      THEN '«' || t.etiqueta || '» es una entrada, no una salida.'
      ELSE '«' || t.etiqueta || '» es una salida, no una entrada.' END);
  END IF;
  IF t.foto = 'OBLIGATORIA' AND NOT coalesce(p_tiene_foto, false)
     AND coalesce(p_forma_pago, 'EFECTIVO') = 'EFECTIVO' THEN
    RETURN json_build_object('error', 'Falta la foto del comprobante.');
  END IF;
  IF p_sentido = 'SALIDA' AND t.identifica_receptor AND NOT coalesce(p_tiene_receptor, false) THEN
    RETURN json_build_object('error', 'Falta quién se lleva el efectivo.');
  END IF;

  IF t.codigo IN ('OTRO_ENTRADA', 'OTRO_SALIDA') THEN
    -- El concepto llega con el rótulo adelante («Otro · …»): se quita para
    -- medir lo que la persona escribió de verdad.
    v_texto := btrim(regexp_replace(lower(translate(coalesce(p_concepto, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
                                    '^\s*otro\s*([·:\-]\s*)?', ''));
    IF length(regexp_replace(v_texto, '[^a-z0-9]', '', 'g')) < 10 THEN
      RETURN json_build_object('error', 'En «Otro» escribe de qué fue, con detalle.');
    END IF;
    SELECT c.va_en INTO v_va_en
      FROM public.caja_conceptos_de_otro_lado c
     WHERE c.activo AND c.sentido = p_sentido AND v_texto ~ c.patron
     ORDER BY c.orden, c.id
     LIMIT 1;
    IF v_va_en IS NOT NULL THEN
      RETURN json_build_object('error', 'Esto no va en «Otro»: ' || v_va_en || '.', 'va_en', v_va_en);
    END IF;
  END IF;

  -- Sin comprobante en un tipo que lo pide: se hace y queda pendiente de
  -- autorización, sea del cajón o de una bolsa (2026-10-22).
  IF t.sin_comprobante_autoriza AND NOT coalesce(p_tiene_foto, false) THEN
    RETURN json_build_object('error', NULL, 'autoriza', true);
  END IF;
  RETURN json_build_object('error', NULL, 'autoriza', false);
END $function$;

COMMENT ON COLUMN public.caja_tipos_movimiento.sin_comprobante_autoriza IS
  'Sin foto del comprobante el movimiento igual se hace —del cajón o de una bolsa— pero queda pendiente de autorización (requests_caja).';

-- ── 3. Registrar la salida: con motivo y su solicitud ──────────────────────
-- Firma nueva (un parámetro al final, con default): la vieja se borra para que
-- no quede una sobrecarga con sus permisos.
DROP FUNCTION IF EXISTS public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.registrar_salida_de_bolsa(p_tipo text, p_monto numeric, p_repartos jsonb, p_entidad text DEFAULT NULL::text, p_numero_boleta text DEFAULT NULL::text, p_foto_url text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_recibido_por uuid DEFAULT NULL::uuid, p_metodo text DEFAULT NULL::text, p_vale uuid DEFAULT NULL::uuid, p_motivo_sin_comprobante text DEFAULT NULL::text)
 RETURNS bolsas_operaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    t public.bolsas_tipos_salida; v_oper public.bolsas_operaciones;
    v_yo uuid := (SELECT auth_employee_id());
    v_scope text := (SELECT auth_module_scope('bolsas'));
    v_mia bigint := (SELECT auth_employee_branch_id());
    v_branch bigint; v_suma numeric := 0; v_codigo text; r record; b public.bolsas;
    v_vale public.identidad_vales;
    v_entidad text := nullif(btrim(coalesce(p_entidad, '')), '');
    v_del_catalogo text;
    v_paso numeric;
    v_regla json;
    v_autoriza boolean := false;
    v_motivo text := nullif(btrim(coalesce(p_motivo_sin_comprobante, '')), '');
    v_sol uuid;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT * INTO t FROM public.bolsas_tipos_salida WHERE codigo = p_tipo AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese motivo no existe.'; END IF;
    IF p_monto IS NULL OR p_monto < 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;
    IF t.signo <> 0 AND p_monto = 0 THEN RAISE EXCEPTION 'Hay que decir cuánto.'; END IF;

    -- La entidad se exige sólo cuando la contesta una PERSONA. Con
    -- `entidad_la_dice_el_papel` sale de la boleta y puede no haber ninguna —un
    -- retiro por token no tiene remesadora—, así que pedirla acá dejaba sin
    -- forma de registrar la salida. Es la MISMA condición que aplica
    -- `SalidaDeBolsa`; escrita en dos sitios porque no hay uno solo que valga
    -- para los dos runtimes, y por eso se mueven juntas.
    IF t.etiqueta_entidad IS NOT NULL
       AND NOT coalesce(t.entidad_la_dice_el_papel, false)
       AND v_entidad IS NULL THEN
        RAISE EXCEPTION 'Falta el dato: %.', t.etiqueta_entidad; END IF;

    -- ── ¿En cuánto se reparte? Lo decide el MONTO, para todos los vales ─────
    -- $500 sale en billetes de $10, $55 en billetes de $5, $125.75 exacto. Ya
    -- no depende del motivo: ver `paso_de_monto`.
    v_paso := CASE WHEN t.signo = -1 THEN public.paso_de_monto(p_monto) END;

    -- El catálogo manda cuando existe. Se compara normalizado —sin espacios de
    -- sobra y sin distinguir mayúsculas— porque el valor viene de un
    -- desplegable, pero el nombre que se GUARDA es el de la fila: así el dato
    -- coincide con el catálogo por construcción y no por suerte.
    --
    -- Sólo sobre una entidad que LLEGÓ: sin `v_entidad IS NOT NULL`, una salida
    -- que legítimamente no trae entidad no emparejaba con ninguna fila y caía
    -- en «no está en la lista», que es el mismo bloqueo con otro texto.
    IF v_entidad IS NOT NULL
       AND t.etiqueta_entidad IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bolsas_entidades e WHERE e.tipo = t.codigo AND e.activo) THEN
        SELECT e.nombre INTO v_del_catalogo
          FROM public.bolsas_entidades e
         WHERE e.tipo = t.codigo AND e.activo
           AND upper(btrim(e.nombre)) = upper(v_entidad);
        IF v_del_catalogo IS NULL THEN
            RAISE EXCEPTION 'Ese/a % no está en la lista.', lower(t.etiqueta_entidad); END IF;
        v_entidad := v_del_catalogo;
    END IF;

    IF t.pide_boleta AND btrim(coalesce(p_numero_boleta,'')) = '' THEN
        RAISE EXCEPTION 'Falta el número de boleta.'; END IF;
    IF t.foto = 'OBLIGATORIA' AND btrim(coalesce(p_foto_url,'')) = '' THEN
        RAISE EXCEPTION 'Falta la foto del comprobante.'; END IF;

    -- ── El juez de los movimientos de caja (auditoría 2026-10-21) ──────────
    -- El MISMO que usa `operar-caja`: «Otro» no acepta lo que va en otro lado,
    -- y lo que pide comprobante, sin foto, sale igual y queda pendiente de
    -- autorización (2026-10-22: desde una bolsa también). La identidad de
    -- quien retira ya la cuida `pide_receptor` abajo, por eso
    -- `p_tiene_receptor` va en true.
    IF t.caja_tipo IS NOT NULL THEN
        v_regla := public.caja_movimiento_regla(
            'SALIDA', t.caja_tipo,
            concat_ws(' · ', t.etiqueta, v_entidad, nullif(btrim(coalesce(p_nota, '')), '')),
            nullif(btrim(coalesce(p_foto_url, '')), '') IS NOT NULL,
            'EFECTIVO', true, true);
        IF v_regla ->> 'error' IS NOT NULL THEN RAISE EXCEPTION '%', v_regla ->> 'error'; END IF;
        v_autoriza := coalesce((v_regla ->> 'autoriza')::boolean, false);
        IF v_autoriza AND length(coalesce(v_motivo, '')) < 5 THEN
            RAISE EXCEPTION 'Sin foto del comprobante, explica por qué: queda pendiente de autorización.';
        END IF;
    END IF;

    IF t.pide_receptor THEN
        IF p_recibido_por IS NULL THEN RAISE EXCEPTION 'Falta quién se lleva el efectivo.'; END IF;
        IF p_vale IS NULL THEN
            RAISE EXCEPTION 'Falta comprobar la identidad de quien retira el efectivo.'; END IF;

        -- El vale lo emitió la comprobación de identidad y vale para UNA sola
        -- operación: se toma con FOR UPDATE y se marca usado en la misma
        -- transacción, así dos pestañas abiertas no pueden gastarlo dos veces.
        SELECT * INTO v_vale FROM public.identidad_vales
         WHERE token = p_vale FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Hay que comprobar la identidad de nuevo.'; END IF;
        IF v_vale.usado_at IS NOT NULL THEN
            RAISE EXCEPTION 'Esa comprobación ya se usó. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.created_at < now() - interval '5 minutes' THEN
            RAISE EXCEPTION 'La comprobación de identidad vencio. Hay que hacerla de nuevo.'; END IF;
        IF v_vale.employee_id IS DISTINCT FROM p_recibido_por THEN
            RAISE EXCEPTION 'La identidad comprobada no es la de quien figura retirando el efectivo.'; END IF;

        UPDATE public.identidad_vales SET usado_at = now() WHERE token = p_vale;
    END IF;

    IF p_repartos IS NULL OR jsonb_array_length(p_repartos) = 0 THEN
        RAISE EXCEPTION 'Falta decir de qué bolsa sale.'; END IF;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        SELECT * INTO b FROM public.bolsas WHERE id = r.bolsa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Esa bolsa no existe.'; END IF;
        IF v_scope IS DISTINCT FROM 'ALL' AND b.branch_id IS DISTINCT FROM v_mia THEN
            RAISE EXCEPTION 'FORBIDDEN'; END IF;
        IF b.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'La bolsa % ya salió de la sala.', b.folio; END IF;
        IF v_branch IS NULL THEN v_branch := b.branch_id;
        ELSIF v_branch <> b.branch_id THEN
            RAISE EXCEPTION 'Las bolsas de una misma salida tienen que ser de la misma sala.'; END IF;

        -- Ninguna bolsa rompe sus monedas cuando el monto no lo exige.
        IF v_paso IS NOT NULL AND mod(r.monto, v_paso) <> 0 THEN
            RAISE EXCEPTION 'De la bolsa % tienen que salir billetes de %: % no lo es.',
                b.folio, to_char(v_paso, 'FM999,999,990.00'),
                to_char(r.monto, 'FM999,999,990.00'); END IF;

        IF t.signo = -1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_saldo(b.id) THEN
                RAISE EXCEPTION 'La bolsa % sólo tiene %.', b.folio,
                    to_char(public.bolsa_saldo(b.id), 'FM999,999,990.00'); END IF;
        ELSIF t.signo = 1 THEN
            IF r.monto <= 0 THEN RAISE EXCEPTION 'Cada monto tiene que ser mayor que cero.'; END IF;
            IF r.monto > public.bolsa_reintegro_maximo(b.id) THEN
                RAISE EXCEPTION 'A la bolsa % sólo le faltan %: una bolsa no puede tener más de lo que se guardó.',
                    b.folio, to_char(public.bolsa_reintegro_maximo(b.id), 'FM999,999,990.00'); END IF;
        END IF;
        v_suma := v_suma + r.monto;
    END LOOP;

    IF t.signo <> 0 AND round(v_suma, 2) <> round(p_monto, 2) THEN
        RAISE EXCEPTION 'Lo que sale de las bolsas (%) no cuadra con el monto (%).',
            to_char(v_suma, 'FM999,999,990.00'), to_char(p_monto, 'FM999,999,990.00'); END IF;

    SELECT upper(btrim(coalesce(br.codigo, 'B'))) INTO v_codigo FROM public.branches br WHERE br.id = v_branch;

    INSERT INTO public.bolsas_operaciones
        (folio, branch_id, tipo, monto, entidad, numero_boleta, foto_url, nota,
         recibido_por, recibido_metodo, registrado_por)
    VALUES (t.prefijo || '-' || nextval('public.bolsas_operacion_folio_seq'),
         v_branch, t.codigo, round(p_monto, 2),
         v_entidad, nullif(btrim(coalesce(p_numero_boleta,'')), ''),
         nullif(btrim(coalesce(p_foto_url,'')), ''), nullif(btrim(coalesce(p_nota,'')), ''),
         CASE WHEN t.pide_receptor THEN p_recibido_por END,
         CASE WHEN t.pide_receptor THEN coalesce(v_vale.metodo, p_metodo) END, v_yo)
    RETURNING * INTO v_oper;

    FOR r IN SELECT (x->>'bolsa_id')::bigint AS bolsa_id, round((x->>'monto')::numeric, 2) AS monto
               FROM jsonb_array_elements(p_repartos) x LOOP
        INSERT INTO public.bolsas_movimientos (bolsa_id, operacion_id, vale_folio, monto, registrado_por)
        VALUES (r.bolsa_id, v_oper.id,
                'V-' || v_codigo || '-' || nextval('public.bolsas_vale_folio_seq'),
                t.signo * r.monto, v_yo);
        UPDATE public.bolsas SET updated_at = now() WHERE id = r.bolsa_id;
        INSERT INTO public.bolsas_eventos (bolsa_id, accion, monto, employee_id, nota)
        VALUES (r.bolsa_id,
                CASE WHEN t.signo = 0 THEN 'ABRIR' WHEN t.signo = 1 THEN 'REINTEGRO' ELSE 'SALIDA' END,
                t.signo * r.monto, v_yo, t.etiqueta || ' · ' || v_oper.folio);
    END LOOP;

    -- ── Sin comprobante: la salida ya ocurrió y queda esperando autorización ─
    -- La misma solicitud que el cajón, con `operacion_bolsa` en vez de
    -- `movimiento_portal`: así la ve y la resuelve la misma pantalla.
    IF v_autoriza THEN
        INSERT INTO public.approval_requests (type, employee_id, status, note, metadata)
        VALUES ('CAJA_INGRESO_AUTORIZACION', v_yo, 'PENDING', v_motivo,
                jsonb_build_object(
                  'operacion_bolsa', v_oper.id, 'folio', v_oper.folio, 'branch_id', v_branch,
                  'fecha', (v_oper.registrado_at AT TIME ZONE 'America/El_Salvador')::date,
                  'monto', v_oper.monto, 'forma_pago', 'EFECTIVO', 'sentido', 'SALIDA',
                  'concepto', concat_ws(' · ', t.etiqueta, v_oper.folio),
                  'detalle', concat_ws(' · ', t.etiqueta, v_entidad, v_oper.nota),
                  'tipo_codigo', t.caja_tipo, 'foto_url', NULL,
                  'numero_boleta', v_oper.numero_boleta,
                  'reenvio', false, 'rechazo_anterior', NULL))
        RETURNING id INTO v_sol;

        UPDATE public.bolsas_operaciones
           SET autorizacion = 'PENDIENTE', autorizacion_solicitud = v_sol, updated_at = now()
         WHERE id = v_oper.id
        RETURNING * INTO v_oper;
    END IF;

    RETURN v_oper;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_salida_de_bolsa(text, numeric, jsonb, text, text, text, text, uuid, text, uuid, text) TO authenticated, service_role;

-- ── 4. Resolver: el movimiento del cajón o la salida de la bolsa ───────────
CREATE OR REPLACE FUNCTION public.caja_ingreso_resolver(p_solicitud uuid, p_aprobar boolean, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v_sol    public.approval_requests%ROWTYPE;
  v_mov    public.caja_movimientos_portal%ROWTYPE;
  v_op     public.bolsas_operaciones%ROWTYPE;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_titulo text;
  v_cuerpo text;
  v_forma  text;
  v_que    text;
  v_con_caja boolean;
  v_anulo   boolean := false;
  v_por_que text;
BEGIN
  IF v_yo IS NULL OR NOT public.puede_aprobar_modulo(v_yo, 'requests_caja') THEN
    RAISE EXCEPTION 'No tienes permiso para autorizar movimientos de caja.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sol FROM public.approval_requests WHERE id = p_solicitud FOR UPDATE;
  IF NOT FOUND OR v_sol.type <> 'CAJA_INGRESO_AUTORIZACION' THEN
    RAISE EXCEPTION 'No existe esa solicitud de autorización.';
  END IF;
  IF v_sol.status <> 'PENDING' THEN RAISE EXCEPTION 'Esa solicitud ya está resuelta.'; END IF;
  IF v_sol.employee_id = v_yo THEN
    RAISE EXCEPTION 'No puedes autorizar un movimiento que anotaste tú.';
  END IF;
  IF NOT p_aprobar AND v_nota IS NULL THEN
    RAISE EXCEPTION 'Para rechazarlo escribe por qué.';
  END IF;

  -- ── Una salida de bolsa sin comprobante (2026-10-22) ──────────────────────
  -- Rechazarla la anula: el dinero vuelve a contar como de la bolsa, que es
  -- donde se lo va a buscar. Si además sacó del cajón, no se parte en dos: se
  -- anula entera pidiendo la corrección (como `anular_salida_de_bolsa`).
  IF v_sol.metadata ? 'operacion_bolsa' THEN
    SELECT * INTO v_op FROM public.bolsas_operaciones
     WHERE id = (v_sol.metadata ->> 'operacion_bolsa')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La salida de esa solicitud ya no existe.'; END IF;
    IF v_op.anulada_at IS NOT NULL THEN RAISE EXCEPTION 'Esa salida ya se anuló: no hay nada que autorizar.'; END IF;

    UPDATE public.approval_requests
       SET status = CASE WHEN p_aprobar THEN 'APPROVED' ELSE 'REJECTED' END,
           approver_id = v_yo, approver_note = v_nota, updated_at = now()
     WHERE id = p_solicitud;
    UPDATE public.bolsas_operaciones
       SET autorizacion = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
           autorizacion_por = v_yo, autorizacion_at = now(), autorizacion_nota = v_nota,
           updated_at = now()
     WHERE id = v_op.id;

    v_con_caja := EXISTS (SELECT 1 FROM public.caja_movimientos_portal c
                           WHERE c.bolsa_operacion_id = v_op.id AND c.anulado_at IS NULL
                             AND c.erp_movimiento_id IS NOT NULL);
    IF NOT p_aprobar AND v_con_caja THEN
      v_por_que := 'Hay que anularla entera pidiendo la corrección: también sacó de la caja.';
    ELSIF NOT p_aprobar THEN
      -- La bolsa pudo haber salido ya de la sala: el rechazo queda escrito
      -- igual y la diferencia se resuelve con la bolsa.
      BEGIN
        PERFORM public.bolsa_anular_operacion_nucleo(v_op.id,
          left('No se autorizó: ' || v_nota, 500), v_yo);
        v_anulo := true;
      EXCEPTION WHEN OTHERS THEN
        v_por_que := SQLERRM;
      END;
    END IF;

    v_titulo := CASE WHEN p_aprobar THEN 'Salida autorizada'
                     WHEN v_anulo THEN 'Salida anulada' ELSE 'Salida sin autorizar' END;
    v_cuerpo := 'La salida ' || v_op.folio || ' de ' || to_char(v_op.monto, 'FM$999,990.00')
             || CASE WHEN p_aprobar THEN ' quedó autorizada.'
                     WHEN v_anulo THEN ' no se autorizó y se anuló: ' || v_nota || '. Si hacía falta, anótala de nuevo con su comprobante.'
                     ELSE ' no se autorizó: ' || v_nota || '. ' || coalesce(v_por_que, '') END;
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
    VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/bolsas',
            jsonb_build_object('request_id', p_solicitud, 'request_type', 'CAJA_INGRESO_AUTORIZACION',
                               'operacion_bolsa', v_op.id), v_yo);
    BEGIN
      PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/bolsas',
                                   'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'caja_ingreso_resolver: push no enviado: %', SQLERRM;
    END;
    RETURN json_build_object('operacion_bolsa', v_op.id, 'aprobado', p_aprobar,
                             'anulado', v_anulo, 'aviso', v_por_que);
  END IF;

  SELECT * INTO v_mov FROM public.caja_movimientos_portal
   WHERE id = (v_sol.metadata ->> 'movimiento_portal')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El movimiento de esa solicitud ya no existe.'; END IF;
  -- Anulado (o pasado a efectivo con una corrección) ya no hay nada que autorizar.
  IF v_mov.anulado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese movimiento ya se anuló: no hay nada que autorizar.'; END IF;

  UPDATE public.approval_requests
     SET status = CASE WHEN p_aprobar THEN 'APPROVED' ELSE 'REJECTED' END,
         approver_id = v_yo, approver_note = v_nota, updated_at = now()
   WHERE id = p_solicitud;

  UPDATE public.caja_movimientos_portal
     SET autorizacion = CASE WHEN p_aprobar THEN 'APROBADA' ELSE 'RECHAZADA' END,
         autorizacion_por = v_yo, autorizacion_at = now(), autorizacion_nota = v_nota,
         updated_at = now()
   WHERE id = v_mov.id;

  v_forma := CASE v_mov.forma_pago WHEN 'TARJETA' THEN 'con tarjeta'
                                   WHEN 'TRANSFERENCIA' THEN 'por transferencia'
                                   ELSE 'en efectivo' END;
  v_que := CASE WHEN v_mov.tipo = 'SALIDA' THEN 'La salida' ELSE 'El ingreso' END;
  v_titulo := CASE WHEN v_mov.tipo = 'SALIDA'
                   THEN CASE WHEN p_aprobar THEN 'Salida autorizada' ELSE 'Salida anulada' END
                   ELSE CASE WHEN p_aprobar THEN 'Ingreso autorizado' ELSE 'Ingreso anulado' END END;
  v_cuerpo := v_que || ' de ' || to_char(v_mov.monto, 'FM$999,990.00') || ' ' || v_forma
           || ' (' || coalesce(v_mov.concepto, 'sin concepto') || ')'
           || CASE WHEN p_aprobar THEN ' quedó autorizad' || CASE WHEN v_mov.tipo = 'SALIDA' THEN 'a.' ELSE 'o.' END
                   ELSE ' no se autorizó y se anuló: ' || v_nota || '. Si hacía falta, anótal'
                        || CASE WHEN v_mov.tipo = 'SALIDA' THEN 'a' ELSE 'o' END || ' de nuevo con su comprobante.' END;
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, created_by)
  VALUES (v_sol.employee_id, 'REQUEST_DECIDED', v_titulo, v_cuerpo, '/mi-caja',
          jsonb_build_object('request_id', p_solicitud, 'request_type', 'CAJA_INGRESO_AUTORIZACION',
                             'movimiento_portal', v_mov.id), v_yo);
  -- El push es un aviso: si falla, la decisión ya quedó escrita.
  BEGIN
    PERFORM net.http_post(
      url := public.push_function_url(), headers := public.push_function_headers(),
      body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', '/mi-caja',
                                 'target_type', 'EMPLOYEE', 'target_value', to_jsonb(ARRAY[v_sol.employee_id])));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'caja_ingreso_resolver: push no enviado: %', SQLERRM;
  END;

  RETURN json_build_object('movimiento', v_mov.id, 'aprobado', p_aprobar);
END $function$;
