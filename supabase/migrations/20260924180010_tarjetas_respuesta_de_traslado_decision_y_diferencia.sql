SET lock_timeout = '5s';

-- Séptima tanda de tarjetas de la campana (usuario, 24-sep): la respuesta a un
-- traslado, la del envío, y las diferencias de pedido. Los tres avisos mandan
-- en el metadata lo que dibuja la tarjeta y el título lleva la sala, sin emoji.
-- Y `avisar_a_empleados` firma la tarjeta de una decisión con quien decidió.

CREATE OR REPLACE FUNCTION public.notificar_resolucion_traslado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_branch integer := nullif(m->>'branch_id', '')::integer;
    v_quien  text;
    v_que    text;
    v_n      integer;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    v_motivo text;
    v_alt    text;
    v_parcial jsonb;
    v_falto  text;
    -- La tarjeta de la campana (24-sep): la respuesta como datos.
    v_origen text := nullif(m->>'origen_branch_name', '');
    v_nombre text;
    v_estado text;
    v_prods  jsonb;
    v_resp   jsonb;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_nombre, 'La otra sala');

    -- Qué se pidió. Con un renglón, su nombre; con varios, cuántos son: la
    -- lista entera no entra en un aviso y el nombre del primero haría creer que
    -- es el único.
    v_n := jsonb_array_length(coalesce(m->'items', '[]'::jsonb));
    v_que := CASE
        WHEN v_n = 1 THEN coalesce(nullif(m->'items'->0->>'descripcion', ''), 'lo que pediste')
        WHEN v_n > 1 THEN v_n || ' productos'
        ELSE 'lo que pediste'
    END;

    -- Quien pidió, más la jefatura y el turno de su sala.
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_branch
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_branch) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF NEW.status = 'APPROVED' THEN
        v_parcial := m->'erp_traslado'->'parcial';

        IF v_parcial IS NULL THEN
            v_estado := 'ENVIA';
            v_titulo := coalesce(v_origen, 'La otra sala') || ' te lo envía';
            v_cuerpo := v_quien || ' confirmó el traslado de ' || v_que
                     || ' desde ' || coalesce(nullif(m->>'origen_branch_name',''), 'la otra sala')
                     || '. Avisa cuando llegue para recibirlo.';
        ELSE
            -- Renglón por renglón, qué salió de lo que se pidió. Los que
            -- quedaron fuera no traen `enviada`: salieron cero.
            SELECT string_agg(
                       coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id'))
                       || ': ' || coalesce(x->>'enviada','0') || ' de ' || coalesce(x->>'pedida','?'),
                       '; ' ORDER BY (x->>'i')::integer)
              INTO v_falto
              FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
              ) t;

            -- Dónde está lo que faltó. Sólo se ofrece una sala que lo cubra
            -- ENTERO: media sugerencia haría que quien pidió se mueva para nada.
            SELECT string_agg(f.nombre || ' lo tiene ' || d.sala || ' (' || d.unidades || ')', ' · ')
              INTO v_alt
              FROM (
                  SELECT (x->>'erp_product_id')::integer AS prod,
                         coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id')) AS nombre,
                         ((coalesce((x->>'pedida')::numeric, 0) - coalesce((x->>'enviada')::numeric, 0))
                           * coalesce((m->'items'->((x->>'i')::integer)->>'factor')::numeric, 1)) AS unidades
                  FROM (
                      SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                      UNION ALL
                      SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
                  ) t
              ) f
              JOIN LATERAL (
                  SELECT coalesce(sm.nombre, 'Sucursal ' || v.erp_sucursal_id) AS sala, v.unidades
                    FROM public.v_inventario_disponible v
                    LEFT JOIN public.erp_sucursal_map sm ON sm.erp_sucursal_id = v.erp_sucursal_id
                   WHERE v.erp_product_id = f.prod
                     AND v.erp_sucursal_id IS DISTINCT FROM nullif(m->>'origen_erp_sucursal_id','')::integer
                     AND v.erp_sucursal_id IS DISTINCT FROM nullif(m->>'erp_sucursal_id','')::integer
                     AND v.unidades >= f.unidades
                   ORDER BY v.unidades DESC
                   LIMIT 1
              ) d ON true;

            v_estado := 'PARTE';
            v_titulo := coalesce(v_origen, 'La otra sala') || ' te envía una parte';
            v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sala')
                     || ' no tenía todo: ' || coalesce(v_falto, 'salió menos de lo pedido')
                     || coalesce('. ' || nullif(btrim(coalesce(v_parcial->>'motivo','')), ''), '')
                     || coalesce('. Lo que faltó: ' || v_alt, '')
                     || '. Avisa cuando llegue para recibirlo.';
        END IF;
    ELSE
        v_motivo := nullif(btrim(coalesce(m->>'rejection_reason','')), '');
        -- La sugerencia es el motivo por el que este aviso existe: sin ella,
        -- quien pidió vuelve a empezar de cero — abrir la consulta, buscar el
        -- producto, mirar qué sala lo tiene. El dato ya lo teníamos.
        v_alt := nullif(btrim(coalesce(m->>'sugerencia','')), '');
        v_estado := 'NO';
        v_titulo := coalesce(v_origen, 'La otra sala') || ' no te lo puede enviar';
        v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sala')
                 || ' no puede enviar ' || v_que
                 || coalesce(': ' || lower(v_motivo), '')
                 || coalesce('. ' || left(nullif(btrim(NEW.approver_note),''), 120), '')
                 || coalesce(' — ' || v_alt, '');
    END IF;

    v_link := '/requests?solicitud=' || NEW.id;

    /* ── Lo que dibuja la tarjeta (usuario, 24-sep) ─────────────────────────
     * Quién respondió (con su cara), qué se pidió y cuánto sale de cada
     * producto, por qué no, y dónde más hay. El título lleva la sala que
     * responde y ya no lleva emoji: el color lo pone la tarjeta. Los
     * `enviada` salen del mismo `parcial` que arma el cuerpo: los de `fuera`
     * salieron cero, los que no aparecen salieron enteros. */
    BEGIN
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'nombre',  coalesce(nullif(it->>'descripcion', ''), 'Producto #' || (it->>'erp_product_id')),
                   'pedida',  CASE WHEN it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (it->>'cantidad')::numeric END,
                   'enviada', CASE
                                  WHEN v_estado = 'NO' THEN NULL
                                  WHEN aj.x IS NOT NULL AND aj.x->>'enviada' ~ '^[0-9]+(\.[0-9]+)?$' THEN (aj.x->>'enviada')::numeric
                                  WHEN aj.x IS NOT NULL THEN 0
                                  WHEN it->>'cantidad' ~ '^[0-9]+(\.[0-9]+)?$' THEN (it->>'cantidad')::numeric
                              END)) ORDER BY t.ord)
          INTO v_prods
          FROM jsonb_array_elements(coalesce(m->'items', '[]'::jsonb)) WITH ORDINALITY AS t(it, ord)
          LEFT JOIN LATERAL (
              SELECT x FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados', '[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera', '[]'::jsonb))
              ) p WHERE (p.x->>'i') = (t.ord - 1)::text LIMIT 1
          ) aj ON true
         WHERE t.ord <= 15;
    EXCEPTION WHEN OTHERS THEN
        v_prods := NULL;
    END;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',        'traslado',
        'estado',      v_estado,
        'quien',       v_nombre,
        'quien_id',    NEW.approver_id,
        'quien_foto',  public.foto_de_empleado(NEW.approver_id),
        'origen',      v_origen,
        'productos',   v_prods,
        'mas',         nullif(greatest(v_n - 15, 0), 0),
        'motivo',      CASE WHEN v_estado = 'NO' THEN v_motivo
                            ELSE nullif(btrim(coalesce(v_parcial->>'motivo', '')), '') END,
        'nota',        CASE WHEN v_estado = 'NO' THEN left(nullif(btrim(NEW.approver_note), ''), 200) END,
        'alternativa', v_alt));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status,
                              'respuesta', v_resp),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_envio()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    m        jsonb   := coalesce(NEW.metadata, '{}'::jsonb);
    v_org    integer := nullif(m->>'origen_branch_id', '')::integer;
    v_quien  text;
    v_ok     integer;
    v_no     integer;
    v_falta  integer;
    v_lista  text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
    -- La tarjeta de la campana (24-sep).
    v_nombre text;
    v_sala   text := nullif(m->>'branch_name', '');
    v_devs   jsonb;
    v_resp   jsonb;
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_PUSH' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_org IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_nombre FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_nombre, coalesce(nullif(m->>'branch_name',''), 'La otra sala'));

    SELECT count(*) FILTER (WHERE estado = 'aceptada'),
           count(*) FILTER (WHERE estado IN ('devuelta','devuelta_recibida')),
           count(*) FILTER (WHERE estado = 'no_llego')
      INTO v_ok, v_no, v_falta
      FROM public.envio_linea WHERE request_id = NEW.id;

    -- Sólo faltantes: ya lo dijo `avisar_faltantes`, con el producto y el
    -- enlace. No se repite.
    IF coalesce(v_ok, 0) = 0 AND coalesce(v_no, 0) = 0 AND coalesce(v_falta, 0) > 0 THEN
        RETURN NEW;
    END IF;

    SELECT string_agg(coalesce(descripcion, 'el producto #' || erp_product_id)
                      || ' (' || coalesce(motivo_rechazo, 'sin motivo') || ')', '; ' ORDER BY posicion)
      INTO v_lista
      FROM public.envio_linea
     WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida');

    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.id = NEW.employee_id
            OR (e.branch_id = v_org
                AND (public.rango_de_empleado(e.id) BETWEEN 1 AND 2
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_org) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF coalesce(v_no, 0) = 0 THEN
        v_titulo := coalesce(v_sala, 'La otra sala') || ' recibió tu envío';
        v_cuerpo := v_quien || ' aceptó ' || v_ok
                 || CASE WHEN v_ok = 1 THEN ' producto' ELSE ' productos' END || ' de tu envío.';
    ELSE
        v_titulo := coalesce(v_sala, 'La otra sala') || ' te devuelve producto';
        v_cuerpo := v_quien || ' devuelve ' || v_no
                 || CASE WHEN v_no = 1 THEN ' producto' ELSE ' productos' END
                 || CASE WHEN coalesce(v_ok,0) > 0 THEN ' y se queda con ' || v_ok ELSE '' END
                 || coalesce(': ' || v_lista, '')
                 || '. Confirma cuando la caja esté de vuelta en tu sala.';
    END IF;

    -- Lo que no llegó se agrega SIEMPRE al final, en las dos ramas: es el único
    -- dato del aviso que manda a alguien a mirar el mostrador hoy.
    IF coalesce(v_falta, 0) > 0 THEN
        v_cuerpo := v_cuerpo || ' Ojo: ' || v_falta
                 || CASE WHEN v_falta = 1 THEN ' producto no llegó en la caja.'
                         ELSE ' productos no llegaron en la caja.' END
                 || ' Revisa si quedó en tu sala.';
    END IF;

    v_link := '/traslados?tab=envios&envio=' || NEW.id;

    -- Lo que dibuja la tarjeta (24-sep): quién lo recibió, cuántos se quedó,
    -- cuáles devuelve y por qué, y cuántos no llegaron.
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'nombre', coalesce(descripcion, 'Producto #' || erp_product_id),
               'motivo', motivo_rechazo)) ORDER BY posicion)
      INTO v_devs
      FROM (SELECT * FROM public.envio_linea
             WHERE request_id = NEW.id AND estado IN ('devuelta','devuelta_recibida')
             ORDER BY posicion LIMIT 15) l;

    v_resp := jsonb_strip_nulls(jsonb_build_object(
        'tipo',        'envio',
        'estado',      CASE WHEN coalesce(v_no, 0) = 0 THEN 'RECIBIDO' ELSE 'DEVUELVE' END,
        'quien',       v_nombre,
        'quien_id',    NEW.approver_id,
        'quien_foto',  public.foto_de_empleado(NEW.approver_id),
        'sala',        v_sala,
        'aceptados',   coalesce(v_ok, 0),
        'devueltos',   v_devs,
        'no_llegaron', nullif(coalesce(v_falta, 0), 0)));

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status,
                              'respuesta', v_resp),
           v_org, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notificar_decision_diferencia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_prod    text;
    v_num     integer;
    v_sala    text;
    v_sala_b  integer;
    v_bodega  integer;
    v_rotulo  text;
    v_titulo  text;
    v_cuerpo  text;
    v_dest    uuid[];
    v_ids     uuid[];
    -- La tarjeta de la campana (24-sep).
    v_quien_id uuid;
    v_dif      jsonb;
BEGIN
    SELECT p.numero INTO v_num FROM public.pedidos p WHERE p.id = NEW.pedido_id;
    SELECT pr.nombre INTO v_prod FROM public.products pr WHERE pr.id = NEW.erp_product_id;
    SELECT m.nombre, m.branch_id INTO v_sala, v_sala_b
      FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = NEW.erp_sucursal_id;
    SELECT m.branch_id INTO v_bodega FROM public.erp_sucursal_map m WHERE m.es_bodega;

    SELECT o.rotulo INTO v_rotulo FROM public.diferencia_opcion o
     WHERE o.error_tipo = NEW.error_tipo AND o.valor = NEW.resolucion_tipo;

    v_prod := coalesce(v_prod, 'un producto');

    IF NEW.resolucion_status = 'propuesta' THEN
        v_titulo := coalesce(v_sala, 'Una sala') || ' propone cómo cerrar una diferencia';
        v_quien_id := NEW.resuelto_por;
        v_cuerpo := coalesce(v_sala, 'Una sala') || ' propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_bodega AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'contrapropuesta' THEN
        v_titulo := 'Bodega propone otra salida';
        v_quien_id := coalesce(NEW.rechazado_por, NEW.resuelto_por);
        v_cuerpo := 'Bodega propone: ' || coalesce(v_rotulo, '—')
                 || ' · ' || v_prod || ' del pedido #' || coalesce(v_num::text, '?');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id = v_sala_b AND e.id <> coalesce(NEW.resuelto_por, e.id);

    ELSIF NEW.resolucion_status = 'escalada' THEN
        v_titulo := coalesce(v_sala, 'Una sala') || ' y bodega no se ponen de acuerdo';
        v_quien_id := coalesce(NEW.rechazado_por, NEW.resuelto_por);
        v_cuerpo := coalesce(v_sala, 'Una sala') || ' y bodega no coinciden sobre ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?')
                 || coalesce(' — ' || NEW.nota_rechazo, '');
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;

    ELSIF NEW.resolucion_status IN ('acordada', 'confirmada') THEN
        v_titulo := coalesce(v_sala || ' · ', '')
                 || CASE WHEN NEW.resolucion_status = 'confirmada'
                         THEN 'Diferencia cerrada' ELSE 'Quedaron de acuerdo' END;
        v_quien_id := CASE WHEN NEW.resolucion_status = 'confirmada'
                           THEN coalesce(NEW.supervisado_por, NEW.confirmado_suc_por)
                           ELSE coalesce(NEW.confirmado_suc_por, NEW.resuelto_por) END;
        v_cuerpo := coalesce(v_rotulo, '—') || ' · ' || v_prod
                 || ' del pedido #' || coalesce(v_num::text, '?');
        -- A las dos partes: el acuerdo le cambia el trabajo a los dos lados.
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND e.branch_id IN (v_sala_b, v_bodega)
           AND e.id <> coalesce(NEW.confirmado_suc_por, NEW.supervisado_por, e.id);
    ELSE
        RETURN NEW;
    END IF;

    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN
        RETURN NEW;
    END IF;

    /* Lo que dibuja la tarjeta (usuario, 24-sep): el producto, qué pasó y en
     * cuánto, la salida que se propone y quién la movió. El número de pedido
     * no va: «no sé qué aporta» (23-sep). */
    v_dif := jsonb_strip_nulls(jsonb_build_object(
        'producto',  v_prod,
        'sala',      v_sala,
        'estado',    NEW.resolucion_status,
        'que',       CASE NEW.error_tipo WHEN 'faltante' THEN 'Faltó'
                                         WHEN 'sobrante' THEN 'Sobró'
                                         WHEN 'otro'     THEN 'Otro problema' END,
        'enviada',   coalesce(NEW.cantidad_enviada, NEW.cantidad_asignada),
        'recibida',  NEW.cantidad_recibida,
        'problema',  NEW.cantidad_problema,
        'salida',    v_rotulo,
        'nota',      left(nullif(btrim(CASE WHEN NEW.resolucion_status = 'escalada' THEN NEW.nota_rechazo
                                            ELSE NEW.resolucion_nota END), ''), 200),
        'quien',     (SELECT e.name FROM public.employees e WHERE e.id = v_quien_id),
        'quien_id',  v_quien_id,
        'quien_foto', public.foto_de_empleado(v_quien_id)));

    WITH ins AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'PEDIDO_DIFERENCIA', v_titulo, v_cuerpo, '/pedidos',
           jsonb_build_object('pedido_id', NEW.pedido_id, 'pedido_item_id', NEW.id,
                              'erp_sucursal_id', NEW.erp_sucursal_id, 'estado', NEW.resolucion_status,
                              'diferencia', v_dif),
           v_sala_b, coalesce(NEW.resuelto_por, NEW.confirmado_suc_por)
      FROM unnest(v_dest) d
    RETURNING id)
    SELECT array_agg(id) INTO v_ids FROM ins;

    -- También al teléfono (2026-09-23).
    PERFORM public.push_de_notificaciones(v_ids);

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_a_empleados(p_recipients uuid[], p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false, p_branch_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Los tipos que `src/utils/notify.js` emite hoy vía `notifyEmployees`. Si
  -- aparece uno nuevo en el navegador, va acá — y que haya que agregarlo es el
  -- punto: un tipo nuevo pasa por una decisión y no por descuido.
  TIPOS constant text[] := ARRAY['REQUEST_DECIDED','REQUEST_PENDING','MINMAX_DECIDED','SYSTEM'];
  v_actor uuid := public.auth_employee_id();
  v_n     integer := coalesce(array_length(p_recipients, 1), 0);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: solo un empleado puede emitir un aviso desde el portal';
  END IF;

  IF p_type IS NULL OR NOT (p_type = ANY (TIPOS)) THEN
    RAISE EXCEPTION 'FORBIDDEN: el portal no emite avisos de tipo %', coalesce(p_type, '(vacio)');
  END IF;

  IF v_n > 10 THEN
    RAISE EXCEPTION 'FORBIDDEN: un aviso del portal va a lo sumo a 10 personas (llegaron %)', v_n;
  END IF;

  -- La tarjeta de una decisión lleva la cara de quien decidió (24-sep). Se
  -- pone ACÁ y no en el navegador: quien decide es el que llama, así que la
  -- firma no se puede escribir a mano, y quien recibe el aviso —una sala— a
  -- veces no tiene a esa persona en su lista y la vería sin nombre.
  IF p_metadata ? 'decision' AND jsonb_typeof(p_metadata->'decision') = 'object' THEN
    p_metadata := jsonb_set(p_metadata, '{decision}',
      (p_metadata->'decision') || jsonb_strip_nulls(jsonb_build_object(
        'quien',      (SELECT e.name FROM public.employees e WHERE e.id = v_actor),
        'quien_id',   v_actor,
        'quien_foto', public.foto_de_empleado(v_actor))));
  END IF;

  RETURN public.notify_employees(
    p_recipients, p_type, p_title, p_body, p_link, p_metadata, p_push, p_branch_id);
END;
$function$;
