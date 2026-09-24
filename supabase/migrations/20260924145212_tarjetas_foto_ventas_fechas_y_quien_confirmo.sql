SET lock_timeout = '5s';

-- Tercera vuelta de las tarjetas de la campana (usuario, 24-sep):
--  · La FOTO viaja en el aviso (`quien_foto`, la URL guardada): la lista de
--    empleados del navegador está acotada por permisos, y quien no estaba en
--    ella salía con la inicial. La tarjeta la firma al dibujar.
--  · MIN·MAX: ventas del producto en la sala mes a mes (6 meses cerrados), las
--    del mes en curso y la existencia.
--  · Bolsa que no cuadró: la fecha de cada bolsa y quién confirmó el conteo.
--  · Depósito: el monto sale del título, y de qué fecha a qué fecha son las
--    bolsas.
--  · Corte y traslados por respaldo: también llevan la foto.

CREATE OR REPLACE FUNCTION public.foto_de_empleado(p_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.photo_url FROM public.employees e WHERE e.id = p_id;
$function$;

REVOKE ALL ON FUNCTION public.foto_de_empleado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.foto_de_empleado(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.notificar_solicitud_minmax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dest    uuid[];
    v_suc     text;
    v_cuerpo  text;
    v_branch  bigint;
    v_hoy     date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_meses   jsonb;
    v_ctx     json;
BEGIN
    IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

    v_dest := ARRAY(SELECT x FROM unnest(public.get_minmax_approver_ids()) AS x WHERE x IS DISTINCT FROM NEW.requested_by_id);
    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('MINMAX_SIN_APROBADOR', NEW.id::text, 'Sistema', 'SYSTEM', 'WARNING',
                jsonb_build_object('producto', NEW.product_name,
                                   'motivo', 'get_minmax_approver_ids() no devolvió a nadie'));
        RETURN NEW;
    END IF;

    SELECT nombre INTO v_suc
      FROM public.erp_sucursal_map
     WHERE erp_sucursal_id = NEW.erp_sucursal_id;

    -- Las ventas del producto en la sala, para que quien decide no tenga que ir
    -- a buscarlas (usuario, 24-sep: «necesito ver las ventas de los últimos 6
    -- meses, y del último mes»). En UNIDADES —`cantidad × factor_unidades`, igual
    -- que `get_minmax_contexto_producto`— y no sumando presentaciones. Seis
    -- meses CERRADOS, mes por mes; el mes en curso aparte. Si algo falla, el
    -- aviso sale igual sin las ventas: la solicitud no puede caerse por esto.
    BEGIN
        SELECT branch_id INTO v_branch FROM public.erp_sucursal_map
         WHERE erp_sucursal_id = NEW.erp_sucursal_id AND NOT es_bodega;
        SELECT jsonb_agg(jsonb_build_object('ym', to_char(g.mes, 'YYYY-MM'),
                                            'unidades', round(coalesce(v.u, 0), 2)) ORDER BY g.mes)
          INTO v_meses
          FROM generate_series(date_trunc('month', v_hoy) - interval '6 months',
                               date_trunc('month', v_hoy) - interval '1 month',
                               interval '1 month') AS g(mes)
          LEFT JOIN (
            SELECT date_trunc('month', si.fecha) AS mes,
                   sum(sii.cantidad::numeric * sii.factor_unidades) AS u
              FROM public.sales_invoice_items sii
              JOIN public.sales_invoices si ON si.id = sii.invoice_id
             WHERE sii.erp_product_id = NEW.erp_product_id
               AND si.branch_id = v_branch
               AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
               AND si.fecha >= (date_trunc('month', v_hoy) - interval '6 months')::date
               AND si.fecha <  date_trunc('month', v_hoy)::date
             GROUP BY 1) v ON v.mes = g.mes;
        v_ctx := public.get_minmax_contexto_producto(NEW.erp_product_id, NEW.erp_sucursal_id);
    EXCEPTION WHEN OTHERS THEN
        v_meses := NULL;
        v_ctx   := NULL;
    END;

    v_cuerpo := coalesce(NEW.requested_by_name, 'Un empleado')
             || ' propone MIN ' || NEW.requested_min || ' · MAX ' || NEW.requested_max
             || ' para ' || coalesce(NEW.product_name, 'un producto')
             || coalesce(' (' || v_suc || ')', '')
             || '. Hoy está en MIN ' || coalesce(NEW.current_min::text, '—')
             || ' · MAX ' || coalesce(NEW.current_max::text, '—')
             || coalesce(' — ' || left(nullif(btrim(NEW.reason), ''), 140), '');

    PERFORM public.notify_employees(
        -- Título corto con la sala; lo demás lo dibuja la tarjeta (23-sep).
        v_dest, 'MINMAX_PENDING', 'Ajuste de MIN·MAX' || coalesce(' · ' || v_suc, ''), v_cuerpo,
        '/requests?solicitud=minmax:' || NEW.id,
        jsonb_build_object('request_id', NEW.id, 'request_type', 'MINMAX',
                           'producto', NEW.product_name,
                           -- Lo que dibuja la tarjeta de la campana.
                           'sala',      v_suc,
                           'quien',     NEW.requested_by_name,
                           'quien_id',  NEW.requested_by_id,
                           'quien_foto', public.foto_de_empleado(NEW.requested_by_id),
                           'ventas_meses',     v_meses,
                           'ventas_mes_curso', (v_ctx->>'unidades_mes')::numeric,
                           'existencia',       (v_ctx->>'existencia')::numeric,
                           'min_hoy',   NEW.current_min,
                           'max_hoy',   NEW.current_max,
                           'min_nuevo', NEW.requested_min,
                           'max_nuevo', NEW.requested_max,
                           'motivo',    left(nullif(btrim(NEW.reason), ''), 140)),
        true, NULL
    );

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_conteo(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo       uuid := (SELECT auth_employee_id());
    v_n        integer := 0;
    r          record;
    v_saldo    numeric;
    v_dif      numeric;
    b          record;
    v_hoy      date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_folio    text;
    v_conteo   public.bolsas_conteos;
    v_esperado numeric := 0;
    v_contado  numeric := 0;
    v_desc     integer := 0;
    v_quien    text;
    v_yo_nom   text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    -- La cabecera se abre ANTES del recorrido porque cada bolsa necesita su id.
    -- Si al final no se cerró ninguna, el RAISE de abajo tira la transacción
    -- entera y esta fila no queda: un folio sin bolsas sería una tanda que nunca
    -- pasó.
    SELECT 'CNT-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.bolsas_conteos WHERE fecha = v_hoy;

    INSERT INTO public.bolsas_conteos (folio, fecha, cerrado_por)
    VALUES (v_folio, v_hoy, v_yo)
    RETURNING * INTO v_conteo;

    FOR r IN SELECT * FROM public.bolsas
              WHERE id = ANY(p_ids) AND estado = 'RECIBIDA' AND conteo_marcado IS NOT NULL
              ORDER BY id FOR UPDATE
    LOOP
        IF (SELECT auth_module_scope('bolsas_conteo')) IS DISTINCT FROM 'ALL'
           AND r.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;

        v_saldo := public.bolsa_saldo(r.id);
        v_dif   := round(r.conteo_marcado - v_saldo, 2);

        v_esperado := v_esperado + v_saldo;
        v_contado  := v_contado  + r.conteo_marcado;
        IF abs(v_dif) >= 0.01 THEN v_desc := v_desc + 1; END IF;

        UPDATE public.bolsas
           SET estado      = 'CONTADA',
               contado     = r.conteo_marcado,
               contado_por = r.conteo_marcado_por,   -- quien CONTÓ, no quien confirma
               contado_at  = now(),
               conteo_id   = v_conteo.id,
               conteo_marcado = NULL, conteo_marcado_por = NULL, conteo_marcado_at = NULL,
               -- Una resolución sobre una bolsa que terminó cuadrando explica
               -- algo que no pasó: se borra, foto incluida.
               dif_via      = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_via      END,
               dif_causa    = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_causa    END,
               dif_por      = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_por      END,
               dif_at       = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_at       END,
               dif_foto_url = CASE WHEN abs(v_dif) < 0.01 THEN NULL ELSE dif_foto_url END,
               updated_at  = now()
         WHERE id = r.id;

        -- La bitácora nombra a quien CONTÓ esta bolsa, que puede no ser quien
        -- firma la tanda. Sin esto el único nombre del renglón era el del que
        -- apretó «Confirmar», y así es como el rastro termina diciendo que una
        -- sola persona hizo todo.
        SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = r.conteo_marcado_por;

        INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
        VALUES (r.id, 'CONTAR', 'RECIBIDA', 'CONTADA', v_dif, v_yo,
                CASE WHEN abs(v_dif) < 0.01 THEN 'Cuadró.' ELSE 'No cuadró.' END
                || CASE WHEN v_quien IS NOT NULL THEN ' La contó ' || v_quien || '.' ELSE '' END
                || ' Conteo confirmado en la tanda ' || v_conteo.folio || '.'
                || CASE WHEN abs(v_dif) >= 0.01 AND r.dif_at IS NOT NULL
                        THEN ' La causa ya estaba anotada.' ELSE '' END);

        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RAISE EXCEPTION 'No hay ninguna bolsa marcada para confirmar.';
    END IF;

    UPDATE public.bolsas_conteos
       SET cuantas        = v_n,
           total_esperado = round(v_esperado, 2),
           total_contado  = round(v_contado, 2),
           diferencia     = round(v_contado - v_esperado, 2),
           descuadradas   = v_desc
     WHERE id = v_conteo.id;

    SELECT e.name INTO v_yo_nom FROM public.employees e WHERE e.id = v_yo;

    FOR b IN
        SELECT s.branch_id,
               (SELECT name FROM public.branches WHERE id = s.branch_id) AS sala,
               count(*) AS cuantas,
               sum(s.dif) AS neto,
               string_agg(s.folio || ' ' ||
                          CASE WHEN s.dif < 0 THEN 'faltó ' ELSE 'sobró ' END ||
                          '$' || to_char(abs(s.dif), 'FM999,999,990.00'),
                          ', ' ORDER BY s.folio) AS detalle,
               -- Cada bolsa con su diferencia, para la tarjeta (23-sep).
               jsonb_agg(jsonb_build_object('folio', s.folio, 'dif', s.dif, 'fecha', s.fecha) ORDER BY s.folio) AS lista
          FROM (SELECT bo.branch_id, bo.folio, bo.fecha,
                       round(bo.contado - public.bolsa_saldo(bo.id), 2) AS dif
                  FROM public.bolsas bo
                 WHERE bo.id = ANY(p_ids) AND bo.estado = 'CONTADA') s
         WHERE abs(s.dif) >= 0.01
         GROUP BY s.branch_id
    LOOP
        PERFORM public.notify_employees(
            public.destinatarios_de_modulo(b.branch_id::integer, 'bolsas'),
            'bolsa_no_cuadra',
            coalesce(b.sala || ' · ', '')
              || CASE WHEN b.cuantas = 1 THEN 'Una bolsa no cuadró en el conteo'
                      ELSE b.cuantas || ' bolsas no cuadraron en el conteo' END,
            format('%s · %s. Entrá a explicar qué pasó.', coalesce(b.sala, 'Sala'), b.detalle),
            -- La pestaña donde la sala PUEDE contestar. Antes iba a
            -- «finalizadas», que es soloAdmin: el aviso llegaba y no había
            -- adónde. Ver el encabezado de esta migración.
            '/bolsas?tab=diferencias',
            jsonb_build_object('branch_id', b.branch_id, 'bolsas', b.cuantas, 'neto', b.neto,
                               'sala', b.sala, 'lista', b.lista,
                               -- Quién confirmó el conteo (24-sep).
                               'confirmo', v_yo_nom, 'confirmo_id', v_yo,
                               'confirmo_foto', public.foto_de_empleado(v_yo)),
            true,
            b.branch_id::integer
        );
    END LOOP;

    RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_deposito_bancario(p_bolsa_ids bigint[], p_monto numeric, p_aporte numeric DEFAULT 0, p_aporte_nota text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_llevado_por uuid DEFAULT NULL::uuid, p_banco_id smallint DEFAULT NULL::smallint, p_destino text DEFAULT NULL::text, p_entregado_a uuid DEFAULT NULL::uuid, p_monto_efectivo numeric DEFAULT 0)
 RETURNS depositos_bancarios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo        uuid := (SELECT auth_employee_id());
    v_hoy       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_contado   numeric;
    v_cuantas   integer;
    v_aporte    numeric := round(coalesce(p_aporte, 0), 2);
    v_banco_mto numeric := round(coalesce(p_monto, 0), 2);
    v_mano_mto  numeric := round(coalesce(p_monto_efectivo, 0), 2);
    v_remanente numeric;
    v_destino   text;
    v_folio     text;
    v_banco     text;
    v_a_quien   text;
    v_dep       public.depositos_bancarios;
    v_gerentes  uuid[];
    v_quien     text;
    v_quien_id  uuid;
    v_quien_nom text;
    v_desde     date;
    v_hasta     date;
    v_partes    text;
    v_cola      text;
    v_titulo    text;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas_conteo'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    PERFORM 1 FROM public.bolsas
      WHERE id = ANY(p_bolsa_ids) AND estado = 'CONTADA' AND deposito_id IS NULL
      FOR UPDATE;

    SELECT coalesce(sum(b.contado), 0), count(*)
      INTO v_contado, v_cuantas
      FROM public.bolsas b
     WHERE b.id = ANY(p_bolsa_ids)
       AND b.estado = 'CONTADA'
       AND b.deposito_id IS NULL;

    IF v_cuantas = 0 THEN
        RAISE EXCEPTION 'No hay bolsas contadas y sin cerrar en esa lista.';
    END IF;
    IF v_cuantas <> coalesce(array_length(p_bolsa_ids, 1), 0) THEN
        RAISE EXCEPTION 'Alguna de esas bolsas ya se cerró o dejó de estar contada. Vuelve a abrir la pantalla.';
    END IF;

    IF v_banco_mto < 0 OR v_mano_mto < 0 THEN
        RAISE EXCEPTION 'Ninguna parte del reparto puede ser negativa.';
    END IF;
    IF v_aporte > 0 AND nullif(btrim(coalesce(p_aporte_nota, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Si entra dinero de afuera hay que decir de dónde salió.';
    END IF;

    -- Cada parte exige lo suyo, y sólo si esa parte existe.
    IF v_banco_mto > 0 THEN
        SELECT b.nombre INTO v_banco FROM public.bancos b
         WHERE b.id = p_banco_id AND b.activo;
        IF v_banco IS NULL THEN
            RAISE EXCEPTION 'Hay que decir a qué banco va esa parte. Si no ves ese campo, recarga la pantalla.';
        END IF;
    END IF;

    IF p_entregado_a IS NOT NULL THEN
        SELECT e.name INTO v_a_quien
          FROM public.employees e
          JOIN public.roles r ON r.id = e.role_id
         WHERE e.id = p_entregado_a
           AND e.status = 'ACTIVO'
           AND r.name = ANY (public.cargos_de_administracion());
        IF v_a_quien IS NULL THEN
            RAISE EXCEPTION 'El efectivo en mano sólo se le entrega a administración.';
        END IF;
    ELSIF v_mano_mto > 0 THEN
        RAISE EXCEPTION 'Hay que decir a quién se le entrega el efectivo en mano.';
    END IF;

    v_remanente := round(v_contado + v_aporte - v_banco_mto - v_mano_mto, 2);
    IF v_remanente < 0 THEN
        RAISE EXCEPTION 'No alcanza: hay % y se están repartiendo %. Faltan %.',
            to_char(v_contado + v_aporte, 'FM999,999,990.00'),
            to_char(v_banco_mto + v_mano_mto, 'FM999,999,990.00'),
            to_char(abs(v_remanente), 'FM999,999,990.00');
    END IF;

    v_destino := CASE
        WHEN v_banco_mto > 0 AND v_mano_mto > 0 THEN 'MIXTO'
        WHEN v_banco_mto > 0                    THEN 'BANCO'
        ELSE 'EFECTIVO'
    END;

    -- Acá vivía el freno por «no hay Gerente General activo». Se fue: el
    -- remanente es efectivo del dueño y el portal no lo sigue, así que no puede
    -- ser el motivo por el que no se registra un depósito.

    SELECT 'DEP-' || to_char(v_hoy, 'YYMMDD') || '-' || (count(*) + 1)
      INTO v_folio
      FROM public.depositos_bancarios WHERE fecha = v_hoy;

    INSERT INTO public.depositos_bancarios (
        folio, fecha, total_contado, aporte, aporte_nota,
        monto_deposito, monto_efectivo, remanente,
        nota, cerrado_por, llevado_por, banco_id, destino, entregado_a)
    VALUES (v_folio, v_hoy, round(v_contado, 2), v_aporte,
            nullif(btrim(coalesce(p_aporte_nota, '')), ''),
            v_banco_mto, v_mano_mto, v_remanente,
            nullif(btrim(coalesce(p_nota, '')), ''), v_yo,
            CASE WHEN v_banco_mto > 0 THEN p_llevado_por END,
            CASE WHEN v_banco_mto > 0 THEN p_banco_id END,
            v_destino, p_entregado_a)
    RETURNING * INTO v_dep;

    UPDATE public.bolsas SET deposito_id = v_dep.id, updated_at = now()
     WHERE id = ANY(p_bolsa_ids);

    v_partes := concat_ws(' y ',
        CASE WHEN v_banco_mto > 0
             THEN '$' || to_char(v_banco_mto, 'FM999,999,990.00') || ' al banco · ' || v_banco END,
        CASE WHEN v_mano_mto > 0
             THEN '$' || to_char(v_mano_mto, 'FM999,999,990.00') || ' en efectivo a ' || v_a_quien END);
    IF v_partes IS NULL OR v_partes = '' THEN
        v_partes := CASE WHEN v_a_quien IS NOT NULL
                         THEN 'sin efectivo que mover · queda con ' || v_a_quien
                         ELSE 'sin efectivo que mover' END;
    END IF;

    INSERT INTO public.bolsas_eventos (bolsa_id, accion, estado_antes, estado_despues, monto, employee_id, nota)
    SELECT b.id, 'DEPOSITAR', 'CONTADA', 'CONTADA', b.contado, v_yo,
           'Efectivo cerrado · ' || v_dep.folio || ' · ' || v_partes
      FROM public.bolsas b WHERE b.id = ANY(p_bolsa_ids);

    -- ── El aviso ───────────────────────────────────────────────────────────
    -- El monto se va del título: lo dibuja la tarjeta, grande, en el cuerpo
    -- (usuario, 24-sep). El push lo sigue diciendo en el texto.
    v_titulo := CASE v_destino
        WHEN 'BANCO'    THEN 'Depósito al banco'
        WHEN 'EFECTIVO' THEN 'Efectivo entregado en mano'
        ELSE 'Efectivo cerrado'
    END || ' · ' || v_dep.folio;

    -- De qué fecha a qué fecha son las bolsas que se cierran (24-sep: «mejor
    -- que diga de qué fecha a qué fecha es el conteo»).
    SELECT min(b.fecha), max(b.fecha) INTO v_desde, v_hasta
      FROM public.bolsas b WHERE b.id = ANY(p_bolsa_ids);

    v_quien_id := coalesce(CASE WHEN v_banco_mto > 0 THEN p_llevado_por END, v_yo);
    SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = v_quien_id;
    v_quien_nom := v_quien;
    v_quien := CASE WHEN v_banco_mto > 0 AND p_llevado_por IS NOT NULL
                    THEN 'lo lleva ' || coalesce(v_quien, 'alguien sin nombre en el padrón')
                    ELSE 'lo cerró ' || coalesce(v_quien, 'alguien sin nombre en el padrón') END;

    -- El remanente se DICE, no se le asigna a nadie: es lo que no salió por el
    -- circuito, y de ahí en adelante es efectivo del dueño.
    v_cola := CASE WHEN v_remanente >= 0.01
                   THEN 'Quedan $' || to_char(v_remanente, 'FM999,999,990.00') || ' sin salir.'
                   ELSE 'Sin remanente.' END;

    SELECT array_agg(e.id ORDER BY e.name) INTO v_gerentes
      FROM public.employees e
      JOIN public.roles r ON r.id = e.role_id
     WHERE r.name = 'Gerente General' AND e.status = 'ACTIVO';

    IF v_gerentes IS NOT NULL THEN
        PERFORM public.notify_employees(
            v_gerentes,
            'DEPOSITO_BANCO',
            v_titulo,
            v_dep.folio || ' · ' || v_partes || ' · ' || v_quien || '. ' || v_cola,
            '/bolsas?tab=finalizadas',
            jsonb_build_object(
                'deposito_id',    v_dep.id,
                'folio',          v_dep.folio,
                'destino',        v_destino,
                'banco',          v_banco,
                'entregado_a',    v_a_quien,
                'monto_banco',    v_banco_mto,
                'monto_efectivo', v_mano_mto,
                'remanente',      v_dep.remanente,
                'bolsas',         v_cuantas,
                -- Lo que dibuja la tarjeta de la campana (23-sep).
                'quien_id',       v_quien_id,
                'quien',          v_quien_nom,
                'quien_lleva',    v_banco_mto > 0 AND p_llevado_por IS NOT NULL,
                'quien_foto',     public.foto_de_empleado(v_quien_id),
                'desde',          v_desde,
                'hasta',          v_hasta),
            true,
            NULL
        );
    END IF;

    RETURN v_dep;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_corte_de_caja()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala       text;
  v_dest       uuid[];
  v_titulo     text;
  v_cuerpo     text;
  v_sin_conteo boolean;
  v_tramo      numeric;
  v_monto      text;
  v_quien      text;
BEGIN
  -- El cierre del día (Z) no se confirma ni se descarta —lo rechaza
  -- `resolver_corte_caja`—, así que avisarlo sería pedir una acción que no
  -- existe.
  IF NEW.tipo <> 'C' THEN
    RETURN NULL;
  END IF;

  -- Sólo lo recién hecho. El repaso de las 23:40 no reinserta nada (el upsert
  -- ignora duplicados), pero una recarga manual de días pasados sí, y avisarle
  -- a la sala de un corte de la semana pasada es el ruido que enseña a ignorar
  -- la campana. Dos días de ventana y medio día de desfase cubren el corte de
  -- las 23:59, que se captura recién a las 6 del otro día.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1)
     OR coalesce(NEW.desfase_seg, 0) > 43200 THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_sala FROM public.branches WHERE id = NEW.branch_id;
  -- Quién hizo el corte, para la tarjeta (23-sep: «falta quien hizo el
  -- corte»). Sólo la ficha ligada: `empleado_texto` es el nombre de la CUENTA
  -- con la que opera la caja, no el de la persona.
  SELECT e.name INTO v_quien FROM public.employees e WHERE e.id = NEW.employee_id;

  v_dest := public.destinatarios_de_cortes(NEW.branch_id);
  IF v_dest IS NULL THEN
    RETURN NULL;
  END IF;

  v_sin_conteo := public.corte_no_conto_efectivo(NEW.tipo, NEW.total_declarado,
                                                 NEW.diferencia_erp, NEW.tk_total_caja);

  -- `cobros_portal_efectivo` ya está sellado: lo escribe
  -- `cortes_caja_sella_cobros_portal`, que es BEFORE INSERT. Sin él el tramo
  -- nacería con el efectivo de los cobros del portal contado como sobrante —
  -- que es exactamente el «+$78.40 sobre un faltante de $9.85» del 2-sep.
  IF NOT v_sin_conteo THEN
    v_tramo := public.corte_tramo(NEW.id);
    v_monto := '$' || to_char(abs(v_tramo), 'FM999,999,990.00');
  END IF;

  -- Título neutro (usuario, 23-sep: «siento too much, límpialo»): el monto lo
  -- dibuja la tarjeta a la derecha y lo dice el cuerpo, que es lo que se lee en
  -- el push. Con el monto también en el título, el faltante se decía cuatro
  -- veces. La hora en 12 horas, con `hora_12`.
  -- La sala va en el título (23-sep): en la tarjeta no entraba junto al nombre
  -- de quien hizo el corte.
  v_titulo := coalesce(v_sala || ' · ', '') || 'Corte de las ' || public.hora_12(NEW.hora);

  -- Un corte sin conteo no se confirma: pedirlo manda a la sala a buscar un
  -- botón que no está. Lo que corresponde es descartarlo y volver a cortar.
  v_cuerpo := coalesce(v_sala, 'Tu sala') || ' — '
           || CASE
                WHEN v_sin_conteo
                  THEN 'salió sin contar el efectivo. Hay que descartarlo y volver a hacer el corte.'
                WHEN v_tramo <= -0.01
                  THEN 'el efectivo contado quedó ' || v_monto
                       || ' abajo de lo esperado. Hay que revisarlo y confirmarlo.'
                WHEN v_tramo >= 0.01
                  THEN 'el efectivo contado quedó ' || v_monto
                       || ' arriba de lo esperado. Hay que revisarlo y confirmarlo.'
                ELSE 'cuadró al centavo. Hay que confirmarlo.'
              END;

  PERFORM public.notify_employees(
    v_dest,
    'CORTE_NUEVO',
    v_titulo,
    v_cuerpo,
    '/cortes',
    jsonb_build_object(
      'corte_id',  NEW.id,
      'branch_id', NEW.branch_id,
      'fecha',     NEW.fecha,
      'hora',      to_char(NEW.hora, 'HH24:MI'),
      -- El número que se anunció, para que un aviso viejo se pueda cotejar
      -- contra lo que la pantalla muestra hoy. `null` cuando no hubo conteo:
      -- no es cero.
      'tramo',     v_tramo,
      -- Lo que dibuja la tarjeta de la campana.
      'sala',      v_sala,
      'quien_id',  NEW.employee_id,
      'quien',     v_quien,
      'quien_foto', public.foto_de_empleado(NEW.employee_id),
      'contado',   CASE WHEN v_sin_conteo THEN NULL ELSE NEW.total_declarado END,
      'ventas',    NEW.tk_venta
    ),
    true,            -- push: hay que ir a confirmarlo, no es informativo
    NEW.branch_id
  );

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_traslados_por_respaldo()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sala   record;
  v_n      integer;
  v_total  integer := 0;
  v_titulo text;
  v_cuerpo text;
BEGIN
  FOR v_sala IN
    WITH sin_avisar AS (
      SELECT ar.id,
             (ar.metadata->>'origen_branch_id')::integer AS origen,
             coalesce(nullif(ar.metadata->>'branch_name', ''), 'otra sala') AS destino,
             coalesce(nullif(ar.metadata->'erp_traslado'->>'by_name', ''), 'La sala de al lado') AS quien,
             nullif(ar.metadata->'erp_traslado'->>'by', '') AS quien_id,
             -- El cast sólo si tiene forma de uuid: un valor raro no puede tumbar el aviso.
             CASE WHEN ar.metadata->'erp_traslado'->>'by' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  THEN public.foto_de_empleado((ar.metadata->'erp_traslado'->>'by')::uuid) END AS quien_foto,
             ar.metadata->'erp_traslado'->>'at' AS hora,
             coalesce((ar.metadata->>'total_unidades')::numeric,
                      (ar.metadata->'erp_traslado'->>'unidades')::numeric) AS unidades,
             (ar.metadata->'erp_traslado'->>'total')::numeric AS total,
             ar.metadata->'items'->0->>'descripcion' AS producto,
             greatest(jsonb_array_length(coalesce(ar.metadata->'items', '[]'::jsonb)) - 1, 0) AS mas,
             ar.updated_at
        FROM public.approval_requests ar
       WHERE ar.type = 'INVENTORY_TRANSFER_REQUEST'
         AND ar.status = 'APPROVED'
         AND (ar.metadata->'erp_traslado'->>'por_respaldo')::boolean IS TRUE
         AND ar.updated_at >= now() - interval '7 days'
         AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                          WHERE a.clave = 'TRASLADO_RESPALDO:' || ar.id::text)
    )
    SELECT origen,
           count(*)                                        AS cuantos,
           to_jsonb(array_agg(id)::text[])                 AS ids,
           count(DISTINCT quien)                           AS n_quienes,
           min(quien)                                      AS un_quien,
           coalesce(sum(unidades), 0)                      AS unidades,
           jsonb_agg(jsonb_build_object(
             'id',       id,
             'destino',  destino,
             'producto', producto,
             'mas',      mas,
             'unidades', unidades,
             'total',    total,
             'quien',    quien,
             'quien_id', quien_id,
             'quien_foto', quien_foto,
             'hora',     hora) ORDER BY updated_at)      AS traslados
      FROM sin_avisar
     WHERE origen IS NOT NULL
     GROUP BY origen
  LOOP
    v_titulo := CASE WHEN v_sala.cuantos = 1
                     THEN 'Salió un traslado mientras estaban cerrados'
                     ELSE v_sala.cuantos || ' traslados salieron mientras estaban cerrados' END;
    v_cuerpo := CASE WHEN v_sala.n_quienes = 1 THEN v_sala.un_quien
                     ELSE v_sala.un_quien || ' y ' || (v_sala.n_quienes - 1)
                          || CASE WHEN v_sala.n_quienes = 2 THEN ' persona más' ELSE ' personas más' END END
             || CASE WHEN v_sala.cuantos = 1 THEN ' lo despachó' ELSE ' los despacharon' END
             || ' por ustedes. Revisen que la existencia cuadre.';

    v_n := public.notify_branch(
             v_sala.origen, 'TRASLADO_RESPALDO', v_titulo, v_cuerpo, '/traslados',
             jsonb_build_object('request_ids', v_sala.ids,
                                'unidades',    v_sala.unidades,
                                'traslados',   v_sala.traslados), true);

    -- Sólo se marca lo que efectivamente salió: si la sala no tenía a quién
    -- avisarle, mañana se reintenta (como antes).
    IF coalesce(v_n, 0) > 0 THEN
      INSERT INTO public.avisos_emitidos (clave, recipient_id)
      SELECT 'TRASLADO_RESPALDO:' || t, NULL::uuid
        FROM jsonb_array_elements_text(v_sala.ids) t
      ON CONFLICT DO NOTHING;
    END IF;

    v_total := v_total + coalesce(v_n, 0);
  END LOOP;

  RETURN v_total;
END;
$function$;
