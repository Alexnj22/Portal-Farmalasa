SET lock_timeout = '5s';

-- El aviso de que una sala contestó, al día con lo que ahora puede pasar.
--
-- Ya existía y ya manda UNO POR SALA —que es lo que se pidió—, porque cada
-- solicitud de la composición es una fila y este disparador corre por fila. Lo
-- que le faltaba son las tres cosas que cambiaron debajo:
--
--  1. **Nombraba sólo el primer producto** (`items->0`). Con una solicitud de
--     seis renglones, el aviso decía el nombre de uno y callaba los otros cinco.
--  2. **No decía nada cuando salió de menos.** Desde v2.673.0 una sala puede
--     mandar 2 de 3, y quien pidió se enteraba abriendo la caja. Eso es
--     exactamente lo que un aviso tiene que evitar.
--  3. **«Avisá cuando llegue»** — voseo, y el portal no vosea. Misma corrección
--     que `bolsas_avisos_sin_voseo` y `cortes_caja_mensajes_sin_voseo`.
--
-- Y lo que faltó se dice CON DÓNDE ESTÁ. Es el mismo criterio que ya tenía el
-- rechazo —«sin la sugerencia, quien pidió vuelve a empezar de cero: abrir la
-- consulta, buscar el producto, mirar qué sala lo tiene»— y ahora vale igual
-- para media caja que para ninguna. La diferencia con el rechazo es de dónde
-- sale el dato: allá lo calcula la pantalla que rechaza y lo guarda en el
-- `metadata`; acá se calcula ACÁ, porque el despacho ocurre en una Edge Function
-- que ya gastó su tiempo hablando con el sistema de origen y pedirle una vuelta
-- más contra la base sería pagar dos veces por un dato que Postgres tiene al
-- lado.
--
-- ⚠️ El factor de cada renglón NO se guarda en el registro de lo parcial: se
-- saca de `items` por la POSICIÓN (`i`), que es la misma que usa todo el
-- circuito para nombrar un renglón. Sin el factor no se puede comparar lo que
-- faltó —que va en paquetes— contra la existencia de las otras salas, que va en
-- unidades base.
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
BEGIN
    IF NEW.type <> 'INVENTORY_TRANSFER_REQUEST' THEN RETURN NEW; END IF;
    IF NEW.status = OLD.status OR NEW.status = 'PENDING' THEN RETURN NEW; END IF;
    IF v_branch IS NULL THEN RETURN NEW; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = NEW.approver_id;
    v_quien := coalesce(v_quien, 'La otra sala');

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
                AND (e.system_role IN ('JEFE','SUBJEFE')
                     OR e.id IN (SELECT t.employee_id FROM public.empleados_en_turno(v_branch) t))));
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN NEW; END IF;

    IF NEW.status = 'APPROVED' THEN
        v_parcial := m->'erp_traslado'->'parcial';

        IF v_parcial IS NULL THEN
            v_titulo := '📦 Te lo van a enviar';
            v_cuerpo := v_quien || ' confirmó el traslado de ' || v_que
                     || ' desde ' || coalesce(nullif(m->>'origen_branch_name',''), 'la otra sala')
                     || '. Avisa cuando llegue para recibirlo.';
        ELSE
            -- Renglón por renglón, qué salió de lo que se pidió. Los que
            -- quedaron fuera no traen `enviada`: salieron cero.
            SELECT string_agg(
                       coalesce(nullif(x->>'descripcion',''), 'el producto #' || (x->>'erp_product_id'))
                       || ' ' || coalesce(x->>'enviada','0') || ' de ' || coalesce(x->>'pedida','?'),
                       '; ' ORDER BY (x->>'i')::integer)
              INTO v_falto
              FROM (
                  SELECT jsonb_array_elements(coalesce(v_parcial->'ajustados','[]'::jsonb)) AS x
                  UNION ALL
                  SELECT jsonb_array_elements(coalesce(v_parcial->'fuera','[]'::jsonb))
              ) t;

            -- Dónde está lo que faltó. Sólo se ofrece una sala que lo cubra
            -- ENTERO: media sugerencia haría que quien pidió se mueva para nada.
            SELECT string_agg(f.nombre || ': ' || d.sala || ' (' || d.unidades || ')', ' · ')
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

            v_titulo := '📦 Te envían parte';
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
        v_titulo := '🚫 No te lo pueden enviar';
        v_cuerpo := coalesce(nullif(m->>'origen_branch_name',''), 'La otra sala')
                 || ' no puede enviar ' || v_que
                 || coalesce(': ' || lower(v_motivo), '')
                 || coalesce('. ' || left(nullif(btrim(NEW.approver_note),''), 120), '')
                 || coalesce(' — ' || v_alt, '');
    END IF;

    v_link := '/requests?solicitud=' || NEW.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_RESOLVED', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', NEW.id, 'request_type', NEW.type, 'resuelta', NEW.status),
           v_branch, NEW.approver_id
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url := public.push_function_url(), headers := public.push_function_headers(),
        body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));

    RETURN NEW;
END;
$function$;
