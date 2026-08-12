SET lock_timeout = '5s';

-- El código con que cada sala se nombra en el concepto del traslado.
--
-- Hasta hoy la clave llevaba el `erp_sucursal_id` pelado, y la numeración del
-- sistema de origen NO coincide con el nombre de la sala en las tres últimas:
-- 5=La Popular, 6=Bodega, 7=Salud 5. Entonces Salud 5 salía «S7» —que se lee
-- «Salud 7», que no existe— y La Popular salía «S5», que se lee «Salud 5»,
-- que es otra sala real. Las dos salas que más aparecen eran las dos que
-- mentían.
--
-- El código vive en el REGISTRO y no en un CASE dentro de cada RPC: dos listas
-- a mano se desincronizan a la primera sala nueva. Acá, una sala sin código no
-- despacha — el RPC falla al planificar, antes de que se mueva nada.
ALTER TABLE public.erp_sucursal_map ADD COLUMN IF NOT EXISTS codigo text;

UPDATE public.erp_sucursal_map SET codigo = CASE erp_sucursal_id
    WHEN 1 THEN 'S1'
    WHEN 2 THEN 'S2'
    WHEN 3 THEN 'S3'
    WHEN 4 THEN 'S4'
    WHEN 5 THEN 'PO'   -- La Popular
    WHEN 6 THEN 'BO'   -- Bodega: nunca aparece en la clave (siempre es el origen
                       -- del pedido), pero sí como sala de quien despacha.
    WHEN 7 THEN 'S5'
END
WHERE codigo IS NULL;

ALTER TABLE public.erp_sucursal_map ALTER COLUMN codigo SET NOT NULL;

-- Corto, en mayúsculas y sin acentos: el sistema de origen sirve UTF-8 pero
-- relee los bytes como Latin-1, y un acento sale partido en dos. Único, o dos
-- salas comparten identidad en el kardex.
ALTER TABLE public.erp_sucursal_map
    ADD CONSTRAINT erp_sucursal_map_codigo_forma CHECK (codigo ~ '^[A-Z0-9]{2,4}$');
ALTER TABLE public.erp_sucursal_map
    ADD CONSTRAINT erp_sucursal_map_codigo_unico UNIQUE (codigo);


CREATE OR REPLACE FUNCTION public.planificar_traslado_pedido(p_pedido_id uuid, p_sucursal_id integer, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_numero    integer;
    v_suc       text;
    v_nuevas    integer;
    v_chequeo   jsonb;
BEGIN
    SELECT numero INTO v_numero FROM pedidos WHERE id = p_pedido_id;
    IF v_numero IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    -- El código de la sala, del registro. Si falta, se para acá: es preferible
    -- no despachar a escribir en el kardex una clave que nadie puede leer.
    SELECT codigo INTO v_suc FROM erp_sucursal_map WHERE erp_sucursal_id = p_sucursal_id;
    IF v_suc IS NULL THEN
        RAISE EXCEPTION 'SALA_SIN_CODIGO: la sala % no tiene código en el registro de salas', p_sucursal_id;
    END IF;

    v_chequeo := verificar_hojas_pedido(p_pedido_id, p_sucursal_id);
    IF NOT (v_chequeo->>'confiables')::boolean THEN
        RAISE EXCEPTION 'HOJAS_NO_CONFIABLES: %', v_chequeo->>'motivo';
    END IF;

    WITH desde_items AS (
        SELECT (jsonb_array_elements_text(v.value))::integer AS pedido_item_id,
               (v.key)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_each(coalesce(pss.pagina_items, '{}'::jsonb)) AS v(key, value)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    ),
    desde_paginas AS (
        SELECT (jsonb_array_elements_text(pg.val -> 'ids'))::integer AS pedido_item_id,
               (pg.ord)::integer AS hoja
        FROM pedido_sucursal_status pss
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(pss.paginas, '[]'::jsonb))
             WITH ORDINALITY AS pg(val, ord)
        WHERE pss.pedido_id = p_pedido_id AND pss.erp_sucursal_id = p_sucursal_id
    ),
    mapa AS (
        SELECT pedido_item_id, hoja FROM desde_items
        UNION
        SELECT pedido_item_id, hoja FROM desde_paginas
        WHERE NOT EXISTS (SELECT 1 FROM desde_items)
    ),
    candidatos AS (
        SELECT pi.id, pi.erp_product_id, m.hoja,
               COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) AS cantidad,
               es_despacho_adicional(pi.caja_especial, pi.dispatch_tipo,
                                     dr.dispatch_label IS NOT NULL) AS adicional
        FROM pedido_items pi
        LEFT JOIN mapa m ON m.pedido_item_id = pi.id
        LEFT JOIN dispatch_rules dr ON dr.erp_product_id = pi.erp_product_id
        WHERE pi.pedido_id       = p_pedido_id
          AND pi.erp_sucursal_id = p_sucursal_id
          AND NOT pi.sin_stock
          AND pi.status <> 'no_enviado'
          AND COALESCE(pi.cantidad_enviada, pi.cantidad_asignada) > 0
    )
    INSERT INTO pedido_traslado_linea
        (run_id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, hoja, cantidad,
         clave, estado, error_msg, aviso)
    SELECT p_run_id, p_pedido_id, p_sucursal_id, c.id, c.erp_product_id, c.hoja, c.cantidad,
           'P' || v_numero || '-' || v_suc
             || '-H' || COALESCE(c.hoja::text, CASE WHEN c.adicional THEN 'A' ELSE '0' END)
             || '-I' || c.id,
           -- El adicional NO tiene hoja y SÍ se despacha: viaja en el bloque de
           -- cajas adicionales del PDF.
           CASE WHEN c.hoja IS NULL AND NOT c.adicional THEN 'omitida' ELSE 'planificada' END,
           CASE WHEN c.hoja IS NULL AND NOT c.adicional
                THEN 'No salió en ninguna hoja del despacho, así que no se levantó de bodega.'
                ELSE NULL END,
           CASE WHEN c.adicional
                THEN 'Viaja en las cajas adicionales (E1, E2…), no en una hoja numerada.'
                ELSE NULL END
    FROM candidatos c
    ON CONFLICT (pedido_id, erp_sucursal_id, pedido_item_id) DO NOTHING;

    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    -- Sólo se cierra lo que de verdad no se levantó — nunca un adicional.
    UPDATE pedido_items pi
    SET status           = 'no_enviado',
        cantidad_enviada = 0,
        cantidad_recibida = 0,
        motivo_no_envio  = 'No salió en ninguna hoja del despacho: lo asignado es menos de una '
                        || 'unidad de despacho, así que no se imprimió y nadie lo levantó.'
    FROM pedido_traslado_linea l
    WHERE l.pedido_item_id  = pi.id
      AND l.pedido_id       = p_pedido_id
      AND l.erp_sucursal_id = p_sucursal_id
      AND l.estado          = 'omitida'
      AND pi.status         = 'pendiente';

    RETURN (
        SELECT jsonb_build_object(
            'nuevas',        v_nuevas,
            'total',         count(*),
            'por_despachar', count(*) FILTER (WHERE estado IN ('planificada', 'enviando')),
            'enviadas',      count(*) FILTER (WHERE estado = 'enviada'),
            'omitidas',      count(*) FILTER (WHERE estado = 'omitida'),
            'adicionales',   count(*) FILTER (WHERE aviso IS NOT NULL AND hoja IS NULL),
            'con_error',     count(*) FILTER (WHERE estado = 'error'),
            'hojas',         count(DISTINCT hoja),
            'chequeo_hojas', v_chequeo
        )
        FROM pedido_traslado_linea
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.solicitar_devolucion_pedido(p_pedido_item_id integer, p_motivo text, p_cantidad integer, p_nota text DEFAULT NULL::text, p_evidencia jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor  uuid := auth_employee_id();
    v_it     record;
    v_numero integer;
    v_suc    text;
    v_max    integer;
    v_id     uuid;
    v_clave  text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;
    IF p_motivo IS NULL OR p_motivo NOT IN ('faltante', 'danado', 'vencido') THEN
        RAISE EXCEPTION 'MOTIVO_INVALIDO: %', coalesce(p_motivo, '(vacío)');
    END IF;

    SELECT pi.id, pi.pedido_id, pi.erp_sucursal_id, pi.erp_product_id, pi.status,
           pi.cantidad_asignada, pi.cantidad_enviada, pi.cantidad_recibida
      INTO v_it
      FROM public.pedido_items pi
     WHERE pi.id = p_pedido_item_id
       FOR UPDATE;
    IF v_it.id IS NULL THEN
        RAISE EXCEPTION 'ITEM_NO_EXISTE';
    END IF;

    -- La devolución la pide la sala que recibió. Es la que contó la caja y la
    -- única que sabe qué no llegó; y sobre todo, es de donde va a salir el
    -- producto. Alcance ALL (supervisión) puede hacerlo por ella.
    IF NOT auth_can_edit_scope_all(ARRAY['pedidos'])
       AND auth_employee_erp_sucursal_id() IS DISTINCT FROM v_it.erp_sucursal_id THEN
        RAISE EXCEPTION 'SALA_AJENA: la devolución la pide la sala que recibió el pedido';
    END IF;

    IF v_it.status <> 'con_diferencia' THEN
        RAISE EXCEPTION 'SIN_DIFERENCIA: este renglón no quedó con diferencia al recibirlo';
    END IF;

    -- El daño se muestra. Sin foto, Bodega tendría que decidir a ciegas si
    -- amerita la devolución o si el producto todavía se puede vender.
    IF p_motivo = 'danado' AND coalesce(jsonb_array_length(p_evidencia), 0) = 0 THEN
        RAISE EXCEPTION 'FOTO_REQUERIDA: el daño se muestra con una foto, para que Bodega decida '
                        'si amerita la devolución o si el producto todavía se puede vender';
    END IF;

    -- El tope depende del motivo, y son dos cosas distintas:
    --   faltante → lo que NO llegó (se envió 30, se contaron 28 → 2)
    --   dañado/vencido → sale de lo que SÍ llegó, así que el tope es lo contado
    v_max := CASE
        WHEN p_motivo = 'faltante'
        THEN coalesce(v_it.cantidad_enviada, v_it.cantidad_asignada) - coalesce(v_it.cantidad_recibida, 0)
        ELSE coalesce(v_it.cantidad_recibida, 0)
    END;
    IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad > v_max THEN
        RAISE EXCEPTION 'CANTIDAD_FUERA_DE_RANGO: por % se puede devolver hasta % (se pidió %)',
                        p_motivo, v_max, coalesce(p_cantidad, 0);
    END IF;

    SELECT numero INTO v_numero FROM public.pedidos WHERE id = v_it.pedido_id;

    SELECT codigo INTO v_suc FROM public.erp_sucursal_map WHERE erp_sucursal_id = v_it.erp_sucursal_id;
    IF v_suc IS NULL THEN
        RAISE EXCEPTION 'SALA_SIN_CODIGO: la sala % no tiene código en el registro de salas', v_it.erp_sucursal_id;
    END IF;

    -- Misma forma que la clave del despacho (`planificar_traslado_pedido`), con
    -- DEV adelante: quien la busque en el sistema reconoce las dos de una mirada.
    v_clave := 'DEV-P' || coalesce(v_numero::text, '0')
            || '-' || v_suc
            || '-I' || v_it.id;

    INSERT INTO public.pedido_devolucion (
        pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id,
        motivo, viaja, cantidad, nota, evidencia_urls,
        estado, solicitada_por, clave
    ) VALUES (
        v_it.pedido_id, v_it.erp_sucursal_id, v_it.id, v_it.erp_product_id,
        p_motivo, p_motivo <> 'faltante', p_cantidad,
        nullif(btrim(coalesce(p_nota, '')), ''), coalesce(p_evidencia, '[]'::jsonb),
        'solicitada', v_actor, v_clave
    )
    RETURNING id INTO v_id;

    INSERT INTO public.pedido_item_eventos
        (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
    VALUES
        (v_it.id, v_it.pedido_id, v_it.erp_sucursal_id, 'devolucion_solicitada',
         'devolver_bodega', nullif(btrim(coalesce(p_nota, '')), ''), v_actor);

    RETURN jsonb_build_object('id', v_id, 'clave', v_clave, 'viaja', p_motivo <> 'faltante');
END;
$function$;
