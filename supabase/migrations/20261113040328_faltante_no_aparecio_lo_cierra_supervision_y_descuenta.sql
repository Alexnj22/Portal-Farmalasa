-- Faltantes de traslado: «No apareció» lo cierra supervisión, dice a cargo de
-- quién queda, y el sistema descuenta el producto fantasma (2026-11-12).
--
-- Decisiones del usuario tras la auditoría de traslados del 2026-11-12:
--   2. Faltante de solicitud «no apareció» → supervisión decide caso por caso a
--      cargo de quién queda (origen / destino / la persona) y el sistema ajusta.
--      Hasta hoy cerrarlo era escribir una nota: la recepción entra COMPLETA, así
--      que el producto que no venía quedaba en el inventario de la sala que
--      recibió — existencia que nadie tiene.
--   3. «Apareció» lo cierra la misma sala, con aviso a la sala de origen (Bodega
--      cuando sale de ahí) y a supervisión. «No apareció», sólo supervisión.
--   4. Envío «no llegó» que no aparece → igual que 2: se recibe el movimiento
--      (para que no quede colgado en la caja) y se descuenta.
--
-- El ajuste habla con la caja, así que no vive acá: lo hacen
-- `aplicar-traslado-inventario` (solicitudes) y `enviar-producto-erp` (envíos)
-- con la acción `no_aparecio`. La base pone las reglas:
--   · `cerrar_faltante('no_aparecio')` ya NO cierra: a supervisión le contesta
--     AJUSTAR_EN_CAJA (la pantalla llama a la función) y a cualquier otro, FORBIDDEN.
--   · `tomar_ajuste_faltante` la llama la función CON LA SESIÓN de la persona:
--     decide quién puede, valida, y aparta el faltante (candado de 3 min).
--   · `avisar_faltante_resuelto` avisa el desenlace (aparecio / no_aparecio).
SET lock_timeout = '5s';

ALTER TABLE public.bolsa_faltante
  ADD COLUMN IF NOT EXISTS responsable text
    CHECK (responsable IS NULL OR responsable IN ('origen', 'destino', 'persona')),
  ADD COLUMN IF NOT EXISTS responsable_employee_id uuid REFERENCES public.employees(id),
  ADD COLUMN IF NOT EXISTS ajuste jsonb,
  ADD COLUMN IF NOT EXISTS ajuste_en_curso_at timestamptz,
  ADD COLUMN IF NOT EXISTS ajuste_en_curso_por uuid REFERENCES public.employees(id);

COMMENT ON COLUMN public.bolsa_faltante.responsable IS
  'A cargo de quién quedó un faltante «no apareció» (lo decide supervisión): origen, destino o persona.';
COMMENT ON COLUMN public.bolsa_faltante.ajuste IS
  'Lo que hizo el sistema al cerrarlo «no apareció»: recepción del movimiento (envíos) y descarte en la sala que recibió.';

CREATE INDEX IF NOT EXISTS bolsa_faltante_responsable_employee_idx
  ON public.bolsa_faltante (responsable_employee_id) WHERE responsable_employee_id IS NOT NULL;

-- ── Quién es supervisión para un faltante ─────────────────────────────────
-- La misma vara en los dos sitios que la preguntan (cerrar y tomar).
CREATE OR REPLACE FUNCTION public.auth_supervisa_faltantes()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT public.auth_es_supervision() OR public.auth_can_edit_scope_all(ARRAY['traslados']);
$function$;
REVOKE EXECUTE ON FUNCTION public.auth_supervisa_faltantes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_supervisa_faltantes() TO authenticated, service_role;

-- ── El aviso del desenlace ────────────────────────────────────────────────
-- A la sala de origen (Bodega cuando sale de ahí) y a supervisión
-- (`destinatarios_de_faltante`), más la jefatura de la sala que recibió cuando
-- el desenlace es un descuento en SU inventario. El aviso «faltó» que recibió
-- la sala de origen se apaga con el desenlace escrito.
--
-- En un envío que APARECIÓ la sala de origen ya recibe el suyo
-- (`resolver_envio_aparecido`), así que acá sólo va a supervisión.
CREATE OR REPLACE FUNCTION public.avisar_faltante_resuelto(p_id uuid, p_actor uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    bf       public.bolsa_faltante%ROWTYPE;
    m        jsonb;
    v_dest   uuid[];
    v_quien  text;
    v_resp   text;
    v_prod   text;
    v_sala   text;
    v_sala_quien text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
BEGIN
    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL OR bf.estado = 'abierto' THEN RETURN 0; END IF;
    SELECT coalesce(metadata, '{}'::jsonb) INTO m FROM public.approval_requests WHERE id = bf.request_id;

    IF bf.estado = 'aparecio' AND bf.familia = 'envio' THEN
        SELECT array_agg(e.id) INTO v_dest
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND public.rango_de_empleado(e.id) >= 3
           AND public.puede_confirmar_traslado(e.id)
           AND e.id <> p_actor;
    ELSE
        v_dest := public.destinatarios_de_faltante(bf.origen_branch_id, p_actor);
        IF bf.estado = 'no_aparecio' THEN
            SELECT array_agg(DISTINCT x) INTO v_dest
              FROM unnest(coalesce(v_dest, ARRAY[]::uuid[])
                          || coalesce((SELECT destinatarios FROM public.resolver_destinatarios_traslado(bf.destino_branch_id) LIMIT 1),
                                      ARRAY[]::uuid[])) x
             WHERE x IS NOT NULL AND x <> p_actor;
        END IF;
    END IF;

    -- El «faltó» que se avisó, apagado con su desenlace (la campana lo pinta).
    UPDATE public.notifications
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('resuelta', CASE bf.estado WHEN 'aparecio' THEN 'APARECIO' ELSE 'NO_APARECIO' END),
           read_at  = coalesce(read_at, now())
     WHERE type = 'REQUEST_PENDING'
       AND metadata->>'request_id' = bf.request_id::text
       AND metadata->'faltantes' ? bf.id::text;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;
    -- Una sola vez por faltante: un reintento de «apareció» vuelve a pasar por acá.
    IF EXISTS (SELECT 1 FROM public.notifications
                WHERE type = 'REQUEST_RESOLVED' AND metadata->>'faltante_id' = bf.id::text) THEN
        RETURN 0;
    END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = p_actor;
    v_quien := coalesce(v_quien, 'Alguien');
    v_prod  := coalesce(bf.descripcion, 'el producto #' || bf.erp_product_id);
    SELECT name INTO v_sala FROM public.branches WHERE id = bf.destino_branch_id;
    v_sala  := coalesce(v_sala, 'la sala que recibió');

    IF bf.estado = 'aparecio' THEN
        -- La sala de QUIEN lo encontró: puede ser la que envió.
        SELECT coalesce(b.name, v_sala) INTO v_sala_quien
          FROM public.employees e LEFT JOIN public.branches b ON b.id = e.branch_id WHERE e.id = p_actor;
        v_titulo := 'Apareció lo que faltaba de un traslado';
        v_cuerpo := v_quien || ' (' || coalesce(v_sala_quien, v_sala) || ') encontró ' || v_prod
                 || ', que se había declarado como faltante. Ya no hay que buscarlo.';
    ELSE
        v_resp := CASE bf.responsable
            WHEN 'origen'  THEN coalesce((SELECT name FROM public.branches WHERE id = bf.origen_branch_id), 'la sala que envió')
            WHEN 'destino' THEN v_sala
            WHEN 'persona' THEN coalesce((SELECT name FROM public.employees WHERE id = bf.responsable_employee_id), 'una persona')
            ELSE 'sin asignar' END;
        v_titulo := 'Faltante de traslado cerrado: no apareció';
        v_cuerpo := v_quien || ' cerró como no aparecido ' || trim(to_char(bf.cantidad, 'FM999999990.##')) || ' de ' || v_prod
                 || '. Queda a cargo de ' || v_resp || ', y se descontó del inventario de ' || v_sala || '.';
    END IF;
    v_link := '/traslados?tab=faltantes&bolsa=' || bf.request_id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', bf.request_id, 'faltante_id', bf.id,
                              'resuelta', CASE bf.estado WHEN 'aparecio' THEN 'APARECIO' ELSE 'NO_APARECIO' END),
           bf.destino_branch_id, p_actor
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN array_length(v_dest, 1);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.avisar_faltante_resuelto(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_faltante_resuelto(uuid, uuid) TO service_role;

-- ── cerrar_faltante: «no apareció» ya no se cierra con una nota ───────────
-- Partida de la definición viva del 2026-11-12. Cambia:
--   · `no_aparecio` → supervisión recibe AJUSTAR_EN_CAJA (con familia y
--     solicitud, para que la pantalla llame a la función correcta); el resto,
--     FORBIDDEN. Nadie lo cierra desde acá.
--   · `aparecio` cerrado → avisa a la sala de origen y a supervisión.
CREATE OR REPLACE FUNCTION public.cerrar_faltante(p_id uuid, p_estado text, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    bf      public.bolsa_faltante%ROWTYPE;
    v_yo    uuid;
    v_sala  integer;
    v_ok    boolean;
BEGIN
    IF p_estado NOT IN ('aparecio', 'no_aparecio') THEN
        RAISE EXCEPTION 'Un faltante se cierra en aparecio o no_aparecio, no en %.', p_estado;
    END IF;

    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'FORBIDDEN: no se pudo resolver quién eres.';
    END IF;
    IF NOT public.auth_can_edit_any(ARRAY['traslados']) THEN
        RAISE EXCEPTION 'FORBIDDEN: no tienes permiso para resolver faltantes de traslado.';
    END IF;

    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL THEN
        RAISE EXCEPTION 'No existe ese faltante.';
    END IF;
    -- Ya cerrado: no se vuelve a cerrar ni se cambia el desenlace.
    IF bf.estado <> 'abierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_CERRADO', 'estado', bf.estado);
    END IF;

    -- «No apareció» descuenta inventario y dice a cargo de quién queda: lo
    -- decide supervisión (decisión del usuario, 2026-11-12) y lo hace la función
    -- que habla con la caja. Acá sólo se dice adónde ir.
    -- Supervisión lo está cerrando «no apareció» en este momento.
    IF bf.ajuste_en_curso_at IS NOT NULL AND bf.ajuste_en_curso_at > now() - interval '3 minutes' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_EN_CURSO');
    END IF;

    IF p_estado = 'no_aparecio' THEN
        IF NOT public.auth_supervisa_faltantes() THEN
            RAISE EXCEPTION 'FORBIDDEN: «No apareció» lo cierra supervisión.';
        END IF;
        RETURN json_build_object('ok', false, 'codigo', 'AJUSTAR_EN_CAJA',
                                 'familia', bf.familia, 'request_id', bf.request_id);
    END IF;

    SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_sala FROM public.employees WHERE id = v_yo;
    IF NOT (
        public.auth_es_supervision()
        OR public.auth_can_edit_scope_all(ARRAY['traslados'])
        OR v_sala IS NOT DISTINCT FROM bf.origen_branch_id
        OR v_sala IS NOT DISTINCT FROM bf.destino_branch_id
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN: este faltante lo resuelven las salas que lo vivieron.';
    END IF;

    -- «Apareció» en un renglón de envío que sigue en tránsito NO se cierra
    -- acá: primero hay que recibir el movimiento, y eso lo hace la función que
    -- habla con el sistema.
    IF bf.familia = 'envio' AND EXISTS (
        SELECT 1 FROM public.envio_linea el
         WHERE el.request_id = bf.request_id
           AND el.posicion   = bf.posicion
           AND el.estado     = 'no_llego'
           AND el.id_traslado IS NOT NULL
    ) THEN
        RETURN json_build_object('ok', false, 'codigo', 'RECIBIR_EN_CAJA',
                                 'request_id', bf.request_id);
    END IF;

    UPDATE public.bolsa_faltante
       SET estado      = 'aparecio',
           resolucion  = nullif(btrim(coalesce(p_nota, '')), ''),
           resuelto_por = v_yo,
           resuelto_at = now()
     WHERE id = p_id AND estado = 'abierto'
       AND (ajuste_en_curso_at IS NULL OR ajuste_en_curso_at < now() - interval '3 minutes')
    RETURNING true INTO v_ok;

    IF coalesce(v_ok, false) THEN
        PERFORM public.avisar_faltante_resuelto(p_id, v_yo);
    END IF;

    RETURN json_build_object('ok', coalesce(v_ok, false), 'estado', p_estado);
END;
$function$;

-- ── Apartar un faltante para cerrarlo «no apareció» ───────────────────────
-- La llama la función de la caja CON LA SESIÓN de quien aprieta: así quién
-- puede lo decide la base, igual que en `cerrar_faltante`. Valida, anota a
-- cargo de quién queda, y toma el candado (3 min: más que lo que vive una
-- invocación). Devuelve lo que la función necesita para el ajuste.
CREATE OR REPLACE FUNCTION public.tomar_ajuste_faltante(
    p_id uuid, p_responsable text, p_responsable_emp uuid DEFAULT NULL, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo   uuid := public.auth_employee_id();
    bf     public.bolsa_faltante%ROWTYPE;
    v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
    IF v_yo IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'SESION', 'error', 'No se pudo resolver quién eres.');
    END IF;
    IF NOT public.auth_supervisa_faltantes() THEN
        RETURN json_build_object('ok', false, 'codigo', 'FORBIDDEN', 'error', '«No apareció» lo cierra supervisión.');
    END IF;
    IF p_responsable IS NULL OR p_responsable NOT IN ('origen', 'destino', 'persona') THEN
        RETURN json_build_object('ok', false, 'codigo', 'RESPONSABLE', 'error', 'Falta decir a cargo de quién queda.');
    END IF;
    IF p_responsable = 'persona' AND NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_responsable_emp) THEN
        RETURN json_build_object('ok', false, 'codigo', 'RESPONSABLE', 'error', 'Falta elegir la persona.');
    END IF;
    IF v_nota IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'NOTA', 'error', 'Escribe qué se averiguó: es lo que alguien va a leer después.');
    END IF;

    SELECT * INTO bf FROM public.bolsa_faltante WHERE id = p_id;
    IF bf.id IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'NO_EXISTE', 'error', 'No existe ese faltante.');
    END IF;
    IF bf.estado <> 'abierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_CERRADO', 'error', 'Alguien ya lo había cerrado.');
    END IF;
    -- Un descarte que la caja contestó de forma ilegible pudo haber entrado:
    -- reintentarlo descontaría dos veces. Lo destraba una persona mirando el kardex.
    IF bf.ajuste ? 'incierto' THEN
        RETURN json_build_object('ok', false, 'codigo', 'INCIERTO',
            'error', 'El descuento anterior quedó sin confirmar: hay que revisar el kardex de la sala antes de reintentar.');
    END IF;

    UPDATE public.bolsa_faltante
       SET responsable             = p_responsable,
           responsable_employee_id = CASE WHEN p_responsable = 'persona' THEN p_responsable_emp END,
           resolucion              = v_nota,
           ajuste_en_curso_at      = now(),
           ajuste_en_curso_por     = v_yo,
           updated_at              = now()
     WHERE id = p_id AND estado = 'abierto'
       AND (ajuste_en_curso_at IS NULL OR ajuste_en_curso_at < now() - interval '3 minutes')
    RETURNING * INTO bf;
    IF bf.id IS NULL THEN
        RETURN json_build_object('ok', false, 'codigo', 'YA_EN_CURSO',
            'error', 'Alguien más está cerrando este faltante en este momento.');
    END IF;

    RETURN json_build_object('ok', true, 'actor', v_yo, 'faltante', to_json(bf));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tomar_ajuste_faltante(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tomar_ajuste_faltante(uuid, text, uuid, text) TO authenticated, service_role;

-- ── La lista: a cargo de quién, y si quedó algo trabado ───────────────────
-- Partida de la definición viva del 2026-11-12; agrega `responsable*`,
-- `en_curso`, `incierto` y `ajuste_error`.
CREATE OR REPLACE FUNCTION public.get_faltantes_de_bolsa()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.declarado_at DESC), '[]'::json)
    FROM (
      SELECT bf.id, bf.request_id, bf.familia, bf.posicion,
             bf.erp_product_id, bf.descripcion, bf.presentacion_tipo,
             bf.cantidad, bf.nota, bf.estado, bf.resolucion,
             bf.declarado_at, bf.resuelto_at,
             bf.origen_branch_id, bf.destino_branch_id,
             bo.name AS origen_branch_name,
             bd.name AS destino_branch_name,
             ed.name AS declarado_por_nombre,
             er.name AS resuelto_por_nombre,
             bf.declarado_por, bf.resuelto_por,
             bf.responsable, bf.responsable_employee_id,
             CASE bf.responsable WHEN 'origen' THEN bo.name WHEN 'destino' THEN bd.name
                                 WHEN 'persona' THEN ep.name END        AS responsable_nombre,
             (bf.ajuste_en_curso_at > now() - interval '3 minutes')      AS en_curso,
             coalesce(bf.ajuste ? 'incierto', false)                     AS incierto,
             bf.ajuste->>'ultimo_error'                                  AS ajuste_error,
             (el.estado = 'no_llego')                                    AS en_transito,
             r.metadata->>'codigo_bolsa'                  AS codigo_bolsa,
             coalesce(el.id_traslado,
                      r.metadata->'erp_traslado'->>'id_traslado') AS id_traslado,
             coalesce(r.metadata->>'motivo_tipo', '')     AS motivo_tipo,
             (bf.familia = 'envio'
              AND el.estado = 'no_llego'
              AND el.id_traslado IS NOT NULL
              AND bf.estado <> 'no_aparecio')             AS falta_ingresar
        FROM public.bolsa_faltante bf
        LEFT JOIN public.approval_requests r ON r.id = bf.request_id
        LEFT JOIN public.envio_linea el
               ON bf.familia = 'envio'
              AND el.request_id = bf.request_id
              AND el.posicion   = bf.posicion
        LEFT JOIN public.branches  bo ON bo.id = bf.origen_branch_id
        LEFT JOIN public.branches  bd ON bd.id = bf.destino_branch_id
        LEFT JOIN public.employees ed ON ed.id = bf.declarado_por
        LEFT JOIN public.employees er ON er.id = bf.resuelto_por
        LEFT JOIN public.employees ep ON ep.id = bf.responsable_employee_id
       WHERE bf.estado = 'abierto'
          OR bf.resuelto_at > now() - interval '30 days'
          -- Lo que sigue en tránsito no se esconde a los 30 días.
          OR (bf.familia = 'envio' AND el.estado = 'no_llego'
              AND el.id_traslado IS NOT NULL AND bf.estado = 'aparecio')
    ) t;
$function$;
