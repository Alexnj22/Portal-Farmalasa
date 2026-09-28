-- Los avisos del camino de un pedido los escribe la BASE, no el navegador.
--
-- Decisión del usuario (2026-09-28, F4 del plan del núcleo portable): el
-- teléfono va a tener su propia app, y un aviso que depende de que cada cliente
-- se acuerde de mandarlo es un aviso que un cliente va a olvidar — sin error,
-- con la sala esperando. Hasta hoy los 15 avisos de Pedidos salían del
-- navegador por `notifyBranch` → `avisar_a_sucursal`, DESPUÉS de guardar, en un
-- paso aparte.
--
-- Acá cada aviso nace del dato que lo justifica:
--
--   pedido_sucursal_status
--     iniciado_at        vacío → puesto   sala    «Pedido #N en preparación»
--     llegada_tipo       vacío → puesto   bodega  problema en la llegada (cajas,
--                                                 Electrolit, especiales) y cajas de más
--     reenvio_bodega_at  cambia           sala    «Reenvío en camino»
--     segunda_llegada_at cambia           bodega  «Aún hay pendientes» — antes le
--                                                 llegaba a la PROPIA sala: el
--                                                 comentario decía «notificar bodega»
--                                                 y el código buscaba la sala
--     recibido_erp_at    vacío → puesto   bodega  «confirmado sin novedades»
--     diferencias_reportadas_at cambia    bodega  «Problemas en pedido #N»
--   rutas     salida_at vacío → puesto    cada sala, UNO por sala, «en camino»
--   ruta_pedidos entregado_at vacío → puesto  sala «el conductor llegó»
--   cerrar_no_reenviadas (RPC)            sala    «No se reenvía»
--
-- Los textos son los mismos que escribía el navegador. Dos cambios a propósito:
-- la salida de una ruta avisaba de tres formas distintas según el botón
-- (crear, «Iniciar ruta», «Iniciar» en la tarjeta) y ahora es una sola, la más
-- completa; y la llegada del conductor nombraba al conductor en una pestaña y
-- no en la otra.
--
-- ── El cambio de guardia, sin avisos dobles ────────────────────────────────
-- `avisar_a_sucursal` sólo aceptaba los cuatro tipos PEDIDO_*. Desde acá los
-- acepta y NO los emite (devuelve 0): un navegador con el portal viejo abierto
-- —la página no se recarga sola— sigue llamándola, y sin esto la sala recibiría
-- cada aviso dos veces hasta que alguien recargue. La firma no cambia.
--
-- ── Un aviso que falla no deshace el trabajo ───────────────────────────────
-- Cada aviso va en su propio bloque con EXCEPTION: si falla (el push, un dato
-- raro), la llegada o la salida se guardan igual y el fallo queda en
-- `audit_logs` con severidad CRITICAL. Es la misma regla que tenía el navegador
-- —primero el hecho, después el aviso— sin su defecto: allá el fallo moría en
-- la consola de una sola persona.
--
-- ── Quién firma ────────────────────────────────────────────────────────────
-- `notify_branch` tomaba el remitente del JWT. En una RPC que corre con la
-- llave de servicio (`cerrar_no_reenviadas`, llamada por una edge function) no
-- hay JWT, y el aviso saldría sin firma y sin excluir a quien decidió. Por eso
-- nace `notify_branch_como(p_actor, …)` con el MISMO cuerpo, y `notify_branch`
-- pasa a ser una línea que la llama con el del JWT: la regla de a quién le llega
-- sigue escrita una sola vez.
--
-- Y el remitente pasa siempre por `ficha_de_persona`: una persona tiene DOS
-- ids —la ficha y la cuenta de acceso— y estas columnas los mezclan
-- (`rutas.conductor_id` apunta a la CUENTA; `iniciado_por` a la ficha). Sin la
-- traducción, quien hizo la acción se recibiría su propio aviso y el conductor
-- saldría sin nombre.

SET lock_timeout = '5s';

-- ── 1. El primitivo, con remitente explícito ───────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_branch_como(
    p_actor uuid, p_branch_id integer, p_type text, p_title text,
    p_body text DEFAULT '', p_link text DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor   uuid := p_actor;
  v_modulo  text := CASE WHEN p_type LIKE 'PEDIDO\_%' THEN 'pedidos' END;
  v_ids     uuid[];
  v_count   integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT e.id, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
    FROM public.employees e
    WHERE e.branch_id = p_branch_id
      AND e.status = 'ACTIVO'
      AND (v_actor IS NULL OR e.id <> v_actor)
      AND (v_modulo IS NULL OR EXISTS (
            SELECT 1 FROM public.role_permissions rp
             WHERE rp.role_id IN (e.role_id, e.secondary_role_id)
               AND rp.module_key = v_modulo AND rp.can_view))
    RETURNING recipient_id
  )
  SELECT count(*), array_agg(recipient_id) INTO v_count, v_ids FROM ins;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := public.push_function_headers(),
      body    := jsonb_build_object(
        'title', p_title,
        -- La línea corta del teléfono (24-sep); sin datos, el cuerpo de siempre.
        'message', public.texto_de_push(p_type, COALESCE(p_body, ''), p_metadata),
        'url', COALESCE(p_link, '/home')
      ) || CASE WHEN v_modulo IS NULL
                THEN jsonb_build_object('target_type', 'BRANCH',
                                        'target_value', jsonb_build_array(p_branch_id))
                ELSE jsonb_build_object('target_type', 'EMPLOYEE',
                                        'target_value', to_jsonb(v_ids))
           END
    );
  END IF;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_branch_como(uuid, integer, text, text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_branch_como(uuid, integer, text, text, text, text, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text,
    p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- El cuerpo vive en `notify_branch_como`; acá el remitente sale del JWT.
  RETURN public.notify_branch_como(public.auth_employee_id(), p_branch_id, p_type,
                                   p_title, p_body, p_link, p_metadata, p_push);
END;
$function$;

-- ── 2. Ayudantes ────────────────────────────────────────────────────────────
-- La forma que lee la tarjeta del aviso (`datosDePedido`, en
-- src/utils/avisosDeOperacion.js). Antes la armaba el navegador con
-- `metaDePedido`; si cambia de un lado, cambia del otro.
CREATE OR REPLACE FUNCTION public.meta_de_pedido(
    p_numeros integer[], p_sala text, p_etapa text, p_cajas integer DEFAULT NULL,
    p_conductor text DEFAULT NULL, p_conductor_id uuid DEFAULT NULL, p_detalle text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT jsonb_build_object('pedido', jsonb_build_object(
    'numeros', coalesce((SELECT jsonb_agg(n::text) FROM unnest(p_numeros) n WHERE n IS NOT NULL), '[]'::jsonb),
    'sala', p_sala, 'etapa', p_etapa, 'cajas', p_cajas,
    'conductor', p_conductor, 'conductor_id', p_conductor_id, 'detalle', p_detalle));
$function$;

REVOKE EXECUTE ON FUNCTION public.meta_de_pedido(integer[], text, text, integer, text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.meta_de_pedido(integer[], text, text, integer, text, uuid, text) TO authenticated, service_role;

-- «#1, #2» a partir de un arreglo jsonb de números.
CREATE OR REPLACE FUNCTION public.numeros_de_caja(p jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT string_agg('#' || x, ', ' ORDER BY o)
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(x, o);
$function$;

REVOKE EXECUTE ON FUNCTION public.numeros_de_caja(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.numeros_de_caja(jsonb) TO authenticated, service_role;

-- Un aviso que falla queda escrito, y no deshace lo que avisaba.
CREATE OR REPLACE FUNCTION public.aviso_de_pedido_fallo(p_que text, p_pedido uuid, p_err text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
  -- CRITICAL y no ERROR: el CHECK de `audit_logs.severity` sólo acepta
  -- INFO/WARNING/CRITICAL, y un ERROR hacía fallar justo este registro.
  VALUES ('AVISO_DE_PEDIDO_FALLO', p_pedido::text, 'Avisos de pedido', 'SYSTEM', 'CRITICAL',
          jsonb_build_object('aviso', p_que, 'error', p_err));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'aviso de pedido % falló (%), y tampoco se pudo anotar: %', p_que, p_err, SQLERRM;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aviso_de_pedido_fallo(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.aviso_de_pedido_fallo(text, uuid, text) TO service_role;

-- ── 3. Cajas de más: el dato no se guardaba ────────────────────────────────
-- La llegada preguntaba cuántas cajas de MÁS llegaron y sólo lo anotaba en la
-- bitácora. Sin la columna, el aviso no tendría de dónde leerlo.
ALTER TABLE public.pedido_sucursal_status
  ADD COLUMN IF NOT EXISTS cajas_extra integer,
  ADD COLUMN IF NOT EXISTS cajas_extra_notas jsonb;

-- ── 4. El camino del pedido en una sala ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_camino_del_pedido()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_num      integer;
  v_sala     text;
  v_sala_bid integer;
  v_bod_bid  integer;
  v_partes   text[];
  v_txt      text;
  v_n        integer;
  v_s        text;
  v_ciclo    jsonb;
  v_nota     text;
BEGIN
  SELECT numero INTO v_num FROM public.pedidos WHERE id = NEW.pedido_id;
  SELECT branch_id, nombre INTO v_sala_bid, v_sala
    FROM public.erp_sucursal_map WHERE erp_sucursal_id = NEW.erp_sucursal_id;
  SELECT branch_id INTO v_bod_bid FROM public.erp_sucursal_map WHERE es_bodega LIMIT 1;

  -- Bodega empezó a preparar → la sala.
  IF OLD.iniciado_at IS NULL AND NEW.iniciado_at IS NOT NULL AND v_sala_bid IS NOT NULL THEN
    BEGIN
      PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.iniciado_por), v_sala_bid, 'PEDIDO_TRACKING',
        'Pedido #' || v_num || ' en preparación',
        'Bodega ha iniciado la preparación de tu pedido #' || v_num || '. Te avisaremos cuando salga en camino.',
        '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'preparacion'), true);
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('preparacion', NEW.pedido_id, SQLERRM);
    END;
  END IF;

  -- La sala confirmó la llegada → bodega, uno por cada clase de problema.
  IF OLD.llegada_tipo IS NULL AND NEW.llegada_tipo IS NOT NULL AND v_bod_bid IS NOT NULL THEN
    v_nota := nullif(btrim(coalesce(NEW.llegada_nota, '')), '');

    -- Cajas numeradas dañadas o faltantes.
    v_partes := ARRAY[]::text[];
    v_n := coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(NEW.cajas_danadas) = 'array' THEN NEW.cajas_danadas END), 0);
    IF v_n > 0 THEN
      v_s := CASE WHEN v_n > 1 THEN 's' ELSE '' END;
      v_partes := v_partes || ('caja' || v_s || ' dañada' || v_s || ' ' || public.numeros_de_caja(NEW.cajas_danadas));
    END IF;
    v_n := coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(NEW.falta_cajas) = 'array' THEN NEW.falta_cajas END), 0);
    IF v_n > 0 THEN
      v_s := CASE WHEN v_n > 1 THEN 's' ELSE '' END;
      v_partes := v_partes || ('caja' || v_s || ' faltante' || v_s || ' ' || public.numeros_de_caja(NEW.falta_cajas));
    END IF;
    IF cardinality(v_partes) > 0 THEN
      v_txt := array_to_string(v_partes, ' y ') || '.' || coalesce(' ' || v_nota, '');
      BEGIN
        PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.llegada_fisica_por), v_bod_bid, 'PEDIDO_PROBLEMA',
          'Problema en llegada — ' || v_sala, v_sala || ' reporta: ' || v_txt,
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'problema', NULL, NULL, NULL, v_txt), true);
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('llegada_cajas', NEW.pedido_id, SQLERRM);
      END;
    END IF;

    -- Electrolit.
    v_n := coalesce(NEW.electrolit_faltantes, 0);
    IF v_n > 0 THEN
      v_s := CASE WHEN v_n > 1 THEN 's' ELSE '' END;
      BEGIN
        PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.llegada_fisica_por), v_bod_bid, 'PEDIDO_PROBLEMA',
          'Electrolit faltante — ' || v_sala,
          v_sala || ' reporta ' || v_n || ' caja' || v_s || ' de Electrolit que no llegaron.',
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'problema', NULL, NULL, NULL,
                                            v_n || ' caja' || v_s || ' de Electrolit no llegaron.'), true);
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('llegada_electrolit', NEW.pedido_id, SQLERRM);
      END;
    END IF;

    -- Cajas de más (informativo).
    v_n := coalesce(NEW.cajas_extra, 0);
    IF v_n > 0 THEN
      v_s := CASE WHEN v_n > 1 THEN 's' ELSE '' END;
      SELECT string_agg(v, ', ') INTO v_txt
        FROM jsonb_each_text(CASE WHEN jsonb_typeof(NEW.cajas_extra_notas) = 'object' THEN NEW.cajas_extra_notas ELSE '{}'::jsonb END) AS t(k, v)
       WHERE nullif(btrim(v), '') IS NOT NULL;
      BEGIN
        PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.llegada_fisica_por), v_bod_bid, 'PEDIDO_TRACKING',
          'Cajas de más — ' || v_sala,
          v_sala || ' reporta ' || v_n || ' caja' || v_s || ' extra no esperada' || v_s || '.' || coalesce(' ' || v_txt, ''),
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'recibido', NULL, NULL, NULL,
                                            v_n || ' caja' || v_s || ' de más.' || coalesce(' ' || v_txt, '')), true);
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('llegada_extra', NEW.pedido_id, SQLERRM);
      END;
    END IF;

    -- Cajas especiales: nombra el PRODUCTO, no sólo la etiqueta.
    SELECT count(*), string_agg(l.k || coalesce(' (' || nullif(e.producto, '') || ')', ''), ', ' ORDER BY l.k)
      INTO v_n, v_txt
      FROM jsonb_each_text(CASE WHEN jsonb_typeof(NEW.cajas_especiales_llegadas) = 'object' THEN NEW.cajas_especiales_llegadas ELSE '{}'::jsonb END) AS l(k, v)
      LEFT JOIN LATERAL (
        SELECT x ->> 'product_name' AS producto
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.cajas_especiales) = 'array' THEN NEW.cajas_especiales ELSE '[]'::jsonb END) x
         WHERE x ->> 'label' = l.k LIMIT 1) e ON true
     WHERE l.v = 'faltante';
    IF v_n > 0 THEN
      v_s := CASE WHEN v_n > 1 THEN 's' ELSE '' END;
      BEGIN
        PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.llegada_fisica_por), v_bod_bid, 'PEDIDO_PROBLEMA',
          'Caja especial faltante — ' || v_sala,
          v_sala || ' reporta caja' || v_s || ' especial' || CASE WHEN v_n > 1 THEN 'es' ELSE '' END
                 || ' no recibida' || v_s || ': ' || v_txt || '.',
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'problema', NULL, NULL, NULL,
                                            'No llegó: ' || v_txt || '.'), true);
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('llegada_especiales', NEW.pedido_id, SQLERRM);
      END;
    END IF;
  END IF;

  -- Bodega mandó lo que faltaba → la sala. Lee el ciclo que se acaba de agregar.
  IF NEW.reenvio_bodega_at IS NOT NULL AND NEW.reenvio_bodega_at IS DISTINCT FROM OLD.reenvio_bodega_at
     AND v_sala_bid IS NOT NULL THEN
    v_ciclo := CASE WHEN jsonb_typeof(NEW.reenvios_historial) = 'array' AND jsonb_array_length(NEW.reenvios_historial) > 0
                    THEN NEW.reenvios_historial -> (jsonb_array_length(NEW.reenvios_historial) - 1) END;
    v_partes := ARRAY[]::text[];
    v_n := coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(v_ciclo -> 'cajas') = 'array' THEN v_ciclo -> 'cajas' END), 0);
    IF v_n > 0 THEN
      v_partes := v_partes || ('Caja' || CASE WHEN v_n > 1 THEN 's' ELSE '' END || ' ' || public.numeros_de_caja(v_ciclo -> 'cajas'));
    END IF;
    v_n := coalesce((v_ciclo ->> 'electrolits')::integer, 0);
    IF v_n > 0 THEN v_partes := v_partes || (v_n || ' Electrolit'); END IF;
    SELECT v_partes || coalesce(array_agg(lbl || coalesce(' · ' || nullif(e.producto, ''), '') ORDER BY o), ARRAY[]::text[])
      INTO v_partes
      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_ciclo -> 'especiales') = 'array' THEN v_ciclo -> 'especiales' ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(lbl, o)
      LEFT JOIN LATERAL (
        SELECT x ->> 'product_name' AS producto
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.cajas_especiales) = 'array' THEN NEW.cajas_especiales ELSE '[]'::jsonb END) x
         WHERE x ->> 'label' = t.lbl LIMIT 1) e ON true;
    BEGIN
      PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.reenvio_por), v_sala_bid, 'PEDIDO_REENVIO',
        'Reenvío en camino — pedido #' || v_num,
        'Ya salió de bodega lo que faltaba del pedido #' || v_num || ': ' || array_to_string(v_partes, ' · ')
          || '. Confirma la llegada cuando lo recibas.',
        '/pedidos', '{}'::jsonb, true);
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('reenvio', NEW.pedido_id, SQLERRM);
    END;
  END IF;

  -- La sala recibió un reenvío y aún falta algo → BODEGA (antes: a la sala).
  IF NEW.segunda_llegada_at IS NOT NULL AND NEW.segunda_llegada_at IS DISTINCT FROM OLD.segunda_llegada_at
     AND v_bod_bid IS NOT NULL THEN
    SELECT c INTO v_ciclo
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.reenvios_historial) = 'array' THEN NEW.reenvios_historial ELSE '[]'::jsonb END) c
     WHERE c ->> 'arrived_at' IS NOT NULL
     ORDER BY c ->> 'arrived_at' DESC LIMIT 1;
    v_partes := ARRAY[]::text[];
    IF coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(v_ciclo -> 'cajas_aun_faltantes') = 'array' THEN v_ciclo -> 'cajas_aun_faltantes' END), 0) > 0 THEN
      v_partes := v_partes || ('Cajas: ' || public.numeros_de_caja(v_ciclo -> 'cajas_aun_faltantes'));
    END IF;
    -- `electrolit_ok` en el ciclo lo escribe el portal desde este cambio; un
    -- portal viejo no lo manda, y ahí se lee la columna, que sí escribe.
    IF coalesce((v_ciclo ->> 'electrolits')::integer, 0) > 0
       AND coalesce((v_ciclo ->> 'electrolit_ok')::boolean, NEW.electrolit_ok, true) = false THEN
      v_partes := v_partes || 'Electrolit aún pendiente'::text;
    END IF;
    IF coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(v_ciclo -> 'especiales_aun') = 'array' THEN v_ciclo -> 'especiales_aun' END), 0) > 0 THEN
      SELECT v_partes || ('Especiales: ' || string_agg(x, ', ' ORDER BY o)) INTO v_partes
        FROM jsonb_array_elements_text(v_ciclo -> 'especiales_aun') WITH ORDINALITY AS t(x, o);
    END IF;
    IF cardinality(v_partes) > 0 THEN
      BEGIN
        PERFORM public.notify_branch_como(public.ficha_de_persona((v_ciclo ->> 'arrived_por')::uuid), v_bod_bid, 'PEDIDO_PROBLEMA',
          'Aún hay pendientes — reenvío ' || coalesce(v_ciclo ->> 'ciclo', '?'),
          v_sala || ' reporta que aún no llegó: ' || array_to_string(v_partes, ' | ') || '. Se requiere otro envío.',
          '/pedidos', '{}'::jsonb, true);
      EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('reenvio_aun_falta', NEW.pedido_id, SQLERRM);
      END;
    END IF;
  END IF;

  -- La sala terminó de contar sin diferencias → bodega. Con diferencias avisa
  -- el bloque de abajo, que se dispara justo después.
  IF OLD.recibido_erp_at IS NULL AND NEW.recibido_erp_at IS NOT NULL AND v_bod_bid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pedido_items i
                      WHERE i.pedido_id = NEW.pedido_id AND i.erp_sucursal_id = NEW.erp_sucursal_id
                        AND i.status = 'con_diferencia') THEN
    BEGIN
      PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.recibido_erp_por), v_bod_bid, 'PEDIDO_TRACKING',
        'Pedido #' || v_num || ' confirmado — ' || v_sala,
        v_sala || ' confirmó la recepción del pedido #' || v_num || ' sin novedades.',
        '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'recibido'), true);
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('recibido', NEW.pedido_id, SQLERRM);
    END;
  END IF;

  -- Diferencias reportadas → bodega. Si llegan junto con el cierre del conteo
  -- (la primera vez, a minutos de recibir), es «reporta diferencias»; si no, es
  -- una corrección posterior de lo contado.
  IF NEW.diferencias_reportadas_at IS NOT NULL
     AND NEW.diferencias_reportadas_at IS DISTINCT FROM OLD.diferencias_reportadas_at
     AND v_bod_bid IS NOT NULL THEN
    BEGIN
      IF OLD.diferencias_reportadas_at IS NULL
         AND NEW.recibido_erp_at IS NOT NULL AND NEW.recibido_erp_at > now() - interval '10 minutes' THEN
        PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.diferencias_reportadas_por), v_bod_bid, 'PEDIDO_PROBLEMA',
          'Problemas en pedido #' || v_num || ' — ' || v_sala,
          v_sala || ' reporta diferencias en la recepción del pedido #' || v_num || '. Revisa y márcalo como corregido.',
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'problema', NULL, NULL, NULL,
                        'Reporta diferencias en la recepción. Revisa y márcalo como corregido.'), true);
      ELSE
        PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.diferencias_reportadas_por), v_bod_bid, 'PEDIDO_PROBLEMA',
          'Problemas en pedido #' || v_num || ' — ' || v_sala,
          v_sala || ' corrigió lo contado del pedido #' || v_num || '. Revisa la diferencia y contesta.',
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'problema', NULL, NULL, NULL,
                        'Corrigió lo contado. Revisa la diferencia y contesta.'), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('diferencias', NEW.pedido_id, SQLERRM);
    END;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_camino_del_pedido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_avisar_camino_del_pedido ON public.pedido_sucursal_status;
CREATE TRIGGER trg_avisar_camino_del_pedido
  AFTER UPDATE ON public.pedido_sucursal_status
  FOR EACH ROW
  WHEN (   (OLD.iniciado_at IS NULL AND NEW.iniciado_at IS NOT NULL)
        OR (OLD.llegada_tipo IS NULL AND NEW.llegada_tipo IS NOT NULL)
        OR (NEW.reenvio_bodega_at IS DISTINCT FROM OLD.reenvio_bodega_at)
        OR (NEW.segunda_llegada_at IS DISTINCT FROM OLD.segunda_llegada_at)
        OR (OLD.recibido_erp_at IS NULL AND NEW.recibido_erp_at IS NOT NULL)
        OR (NEW.diferencias_reportadas_at IS DISTINCT FROM OLD.diferencias_reportadas_at))
  EXECUTE FUNCTION public.avisar_camino_del_pedido();

-- ── 5. La ruta salió → cada sala, UNO por sala ─────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_salida_de_ruta()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cond text;
  r      record;
  v_nums text;
  v_caj  text;
BEGIN
  SELECT public.nombre_corto_de_empleado(e.first_names, e.last_names, NEW.conductor_nombre)
    INTO v_cond FROM public.employees e WHERE e.id = public.ficha_de_persona(NEW.conductor_id);
  v_cond := coalesce(v_cond, nullif(btrim(coalesce(NEW.conductor_nombre, '')), ''));

  FOR r IN
    SELECT m.branch_id,
           array_agg(p.numero ORDER BY rp.orden_entrega, p.numero) AS numeros,
           sum(coalesce(s.total_cajas, 0))::integer                AS cajas
      FROM public.ruta_pedidos rp
      JOIN public.pedidos p          ON p.id = rp.pedido_id
      JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = rp.erp_sucursal_id
      LEFT JOIN public.pedido_sucursal_status s
             ON s.pedido_id = rp.pedido_id AND s.erp_sucursal_id = rp.erp_sucursal_id
     WHERE rp.ruta_id = NEW.id AND m.branch_id IS NOT NULL
     GROUP BY m.branch_id
  LOOP
    BEGIN
      SELECT string_agg('#' || n, ', ') INTO v_nums FROM unnest(r.numeros) n;
      v_caj := CASE WHEN r.cajas > 0 THEN ' en ' || r.cajas || ' caja' || CASE WHEN r.cajas <> 1 THEN 's' ELSE '' END ELSE '' END;
      PERFORM public.notify_branch_como(public.auth_employee_id(), r.branch_id::integer, 'PEDIDO_TRACKING',
        'Pedido ' || v_nums || ' en camino',
        'Tu pedido ' || v_nums || ' salió de bodega' || v_caj || coalesce(' con ' || v_cond, '') || '.',
        '/pedidos', public.meta_de_pedido(r.numeros, NULL, 'en_camino', nullif(r.cajas, 0), v_cond, NEW.conductor_id), true);
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('en_camino', NEW.id, SQLERRM);
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_salida_de_ruta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_avisar_salida_de_ruta ON public.rutas;
CREATE TRIGGER trg_avisar_salida_de_ruta
  AFTER UPDATE ON public.rutas
  FOR EACH ROW
  WHEN (OLD.salida_at IS NULL AND NEW.salida_at IS NOT NULL AND NEW.status = 'en_ruta')
  EXECUTE FUNCTION public.avisar_salida_de_ruta();

-- ── 6. El conductor entregó en la parada → esa sala ────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_llegada_del_conductor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_bid  integer;
  v_num  integer;
  v_cond text;
  v_cid  uuid;
BEGIN
  SELECT branch_id INTO v_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = NEW.erp_sucursal_id;
  IF v_bid IS NULL THEN RETURN NULL; END IF;
  SELECT numero INTO v_num FROM public.pedidos WHERE id = NEW.pedido_id;
  SELECT coalesce(public.nombre_corto_de_empleado(e.first_names, e.last_names, r.conductor_nombre),
                  nullif(btrim(coalesce(r.conductor_nombre, '')), '')),
         r.conductor_id
    INTO v_cond, v_cid
    FROM public.rutas r LEFT JOIN public.employees e ON e.id = public.ficha_de_persona(r.conductor_id)
   WHERE r.id = NEW.ruta_id;
  BEGIN
    PERFORM public.notify_branch_como(public.ficha_de_persona(NEW.entregado_por), v_bid, 'PEDIDO_LLEGADA',
      'Conductor llegó a tu sucursal',
      coalesce(v_cond || ' acaba de llegar. ', '') || 'Confirma la recepción de tu pedido.',
      '/pedidos', public.meta_de_pedido(ARRAY[v_num], NULL, 'llego', NULL, v_cond, v_cid), true);
  EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('llego', NEW.pedido_id, SQLERRM);
  END;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_llegada_del_conductor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_avisar_llegada_del_conductor ON public.ruta_pedidos;
CREATE TRIGGER trg_avisar_llegada_del_conductor
  AFTER UPDATE ON public.ruta_pedidos
  FOR EACH ROW
  WHEN (OLD.entregado_at IS NULL AND NEW.entregado_at IS NOT NULL)
  EXECUTE FUNCTION public.avisar_llegada_del_conductor();

-- ── 7. «No se reenvía»: dentro de la RPC que lo decide ─────────────────────
-- Partiendo de la definición VIVA; lo único nuevo es el aviso antes del RETURN.
DO $no_reenvio$
DECLARE
  d   text := pg_get_functiondef('public.cerrar_no_reenviadas(uuid,integer,text[],uuid)'::regprocedure);
  ant text := $a$    PERFORM public.cerrar_pedido_si_todo_resuelto(p_pedido_id, p_suc_id, p_actor);
$a$;
  nue text := $b$    PERFORM public.cerrar_pedido_si_todo_resuelto(p_pedido_id, p_suc_id, p_actor);

    -- El aviso a la sala: por producto, con sus cajas. «Regresó a bodega» sólo
    -- si el producto había salido en un traslado (que ahora está anulado).
    DECLARE
        v_bid  integer;
        v_num  integer;
        v_que  text;
        v_reg  boolean;
    BEGIN
        SELECT branch_id INTO v_bid FROM public.erp_sucursal_map WHERE erp_sucursal_id = p_suc_id;
        SELECT numero INTO v_num FROM public.pedidos WHERE id = p_pedido_id;
        SELECT string_agg(t.cajas || coalesce(' · ' || nullif(t.producto, ''), ''), ' · ' ORDER BY t.primera)
          INTO v_que
          FROM (SELECT string_agg(x ->> 'label', '–' ORDER BY o) AS cajas,
                       max(x ->> 'product_name')                  AS producto,
                       min(o)                                     AS primera
                  FROM jsonb_array_elements(v_especiales) WITH ORDINALITY AS e(x, o)
                 WHERE x ->> 'label' = ANY (p_labels)
                 GROUP BY x ->> 'pedido_item_id') t;
        v_reg := EXISTS (SELECT 1 FROM public.pedido_traslado_linea l
                          WHERE l.pedido_item_id = ANY (v_items) AND l.estado = 'anulada');
        IF v_bid IS NOT NULL THEN
            PERFORM public.notify_branch_como(public.ficha_de_persona(p_actor), v_bid, 'PEDIDO_PROBLEMA',
                'No se reenvía — pedido #' || v_num,
                'Bodega decidió no reenviar lo que no llegó del pedido #' || v_num || ': ' || v_que || '.'
                  || CASE WHEN v_reg THEN ' Ese producto regresó a bodega.' ELSE '' END
                  || ' Ya no queda pendiente.',
                '/pedidos', '{}'::jsonb, true);
        END IF;
    EXCEPTION WHEN OTHERS THEN
        PERFORM public.aviso_de_pedido_fallo('no_reenvio', p_pedido_id, SQLERRM);
    END;
$b$;
BEGIN
  IF strpos(d, ant) = 0 OR strpos(d, 'aviso a la sala: por producto') > 0 THEN
    RAISE EXCEPTION 'cerrar_no_reenviadas no tiene la forma esperada (o ya tiene el aviso)';
  END IF;
  EXECUTE replace(d, ant, nue);
END
$no_reenvio$;

-- ── 8. El navegador deja de emitir los PEDIDO_* ────────────────────────────
CREATE OR REPLACE FUNCTION public.avisar_a_sucursal(p_branch_id integer, p_type text, p_title text,
    p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  TIPOS constant text[] := ARRAY['PEDIDO_TRACKING','PEDIDO_PROBLEMA','PEDIDO_REENVIO','PEDIDO_LLEGADA'];
  v_actor uuid := public.auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un empleado puede emitir un aviso desde el portal';
  END IF;

  IF p_type IS NULL OR NOT (p_type = ANY (TIPOS)) THEN
    RAISE EXCEPTION 'FORBIDDEN: el portal no emite avisos de sucursal de tipo %', coalesce(p_type, '(vacio)');
  END IF;

  -- Desde el 2026-09-28 los avisos del camino de un pedido los escribe la base
  -- (`avisar_camino_del_pedido`, `avisar_salida_de_ruta`,
  -- `avisar_llegada_del_conductor`, `cerrar_no_reenviadas`). Un portal viejo
  -- abierto sigue llamando acá: se acepta y no se emite, o la sala lo
  -- recibiría dos veces.
  RETURN 0;
END;
$function$;
