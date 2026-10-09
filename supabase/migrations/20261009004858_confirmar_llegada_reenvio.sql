-- 06 · La llegada de un REENVÍO en una sola transacción (2026-10-08).
--
-- `handleReenvioLlegadaConfirm` (src/hooks/usePedidosData.js) hacía de cuatro
-- a siete escrituras desde el navegador, una detrás de otra:
--   1. pedido_sucursal_status: segunda_llegada_at, el ciclo del historial
--      reescrito ENTERO, falta_cajas y el Electrolit;
--   2. pedido_items: falta_caja=false en los renglones de las cajas que
--      llegaron (ok + dañadas);
--   3. pedido_items: falta_caja=true en los de las que siguen faltando;
--   4. pedido_items: falta_caja=false en el Electrolit, si llegó;
--   5. pedido_sucursal_status: cajas_especiales_llegadas (mezcla);
--   6. pedido_items: falta_caja=false en los renglones de las especiales que
--      llegaron, sin tocar los de una etiqueta que sigue faltando.
-- Un corte de red en el medio dejaba la llegada «confirmada» (el paso 1 ya
-- disparó el aviso a bodega) con renglones todavía bloqueados, o al revés. Y
-- el historial reescrito entero pisaba lo que otra pantalla hubiera agregado
-- entre la lectura y la escritura.
--
-- Esta función hace exactamente lo mismo, en el mismo orden lógico, sobre la
-- fila bloqueada. Dos diferencias, las dos a propósito:
--   · Las escrituras 1 y 5 sobre pedido_sucursal_status van en UN solo UPDATE.
--     El disparador `avisar_camino_del_pedido` se dispara una vez, igual que
--     antes (antes la 5 no cambiaba `segunda_llegada_at`, así que no volvía a
--     disparar), y ahora ve el estado completo.
--   · Un ciclo que ya tiene `arrived_at` se RECHAZA (YA_CONFIRMADO) en vez de
--     reescribirse: era el doble clic. Un ciclo que no existe en un historial
--     no vacío se rechaza (NOT_FOUND). Historial vacío = el caso viejo
--     `faltaCajasLegacy`: no se toca el historial, como antes.
--
-- Firma: la acordada, más `p_nota` al final (el ciclo guarda la nota de quien
-- recibe y la firma acordada no la traía).
--   · p_especiales: arreglo jsonb de ETIQUETAS que SIGUEN faltando
--     (`especialesAun` del modal). Las del ciclo que no estén ahí llegaron.
--   · p_electrolit_faltan: 0 = llegó todo el Electrolit del ciclo; >0 = no
--     llegó (el modal es todo-o-nada: hoy se manda `electrolitCount`). Se
--     guarda acotado al conteo del ciclo.
--
-- Alcance: el de la recepción — la sala propia, o alcance de red.
--
-- Depende de: nada nuevo de tablas. Define dos ayudantes que reusa el 08.
SET lock_timeout = '5s';

-- Los renglones que viajan en unas cajas numeradas: caja → hojas (`caja_map`)
-- → renglones (`pagina_items`). Si no hay mapa de renglones, ninguno — igual
-- que `getItemIds` del hook, que devolvía [] sin `pagina_items`.
CREATE OR REPLACE FUNCTION public.renglones_de_cajas(p_caja_map jsonb, p_pagina_items jsonb, p_cajas integer[])
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(array_agg(DISTINCT r.id::integer), '{}'::integer[])
    FROM unnest(coalesce(p_cajas, '{}'::integer[])) AS c(n)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_caja_map -> (c.n)::text) = 'array' THEN p_caja_map -> (c.n)::text ELSE '[]'::jsonb END) AS h(pagina)
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_pagina_items -> h.pagina) = 'array' THEN p_pagina_items -> h.pagina ELSE '[]'::jsonb END) AS r(id)
   WHERE jsonb_typeof(p_pagina_items) = 'object' AND p_pagina_items <> '{}'::jsonb;
$function$;

-- El dueño de cada etiqueta especial (E1…En), leído de lo que se guardó al
-- finalizar (`cajas_especiales`). Es `renglonesDeCajasFaltantes` de
-- src/utils/cajasEspeciales.js: la etiqueta es una CLAVE, no se re-deriva.
CREATE OR REPLACE FUNCTION public.renglones_de_especiales(p_cajas_especiales jsonb, p_labels text[])
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(array_agg(DISTINCT (e ->> 'pedido_item_id')::integer), '{}'::integer[])
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cajas_especiales) = 'array' THEN p_cajas_especiales ELSE '[]'::jsonb END) e
   WHERE e ->> 'label' = ANY(coalesce(p_labels, '{}'::text[]))
     AND e ->> 'pedido_item_id' IS NOT NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.renglones_de_cajas(jsonb, jsonb, integer[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.renglones_de_cajas(jsonb, jsonb, integer[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.renglones_de_especiales(jsonb, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.renglones_de_especiales(jsonb, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirmar_llegada_reenvio(
  p_pedido_id         uuid,
  p_sucursal_id       integer,
  p_ciclo             integer,
  p_cajas_ok          integer[],
  p_cajas_danadas     integer[],
  p_cajas_faltan      integer[],
  p_especiales        jsonb,
  p_electrolit_faltan integer,
  p_nota              text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor      uuid := auth_employee_id();
  s            public.pedido_sucursal_status%ROWTYPE;
  v_now        timestamptz := now();
  v_hist       jsonb;
  v_ciclo      jsonb;
  v_ok         integer[] := coalesce(p_cajas_ok, '{}');
  v_dan        integer[] := coalesce(p_cajas_danadas, '{}');
  v_falt       integer[] := coalesce(p_cajas_faltan, '{}');
  v_elec_count integer;
  v_elec_ok    boolean := coalesce(p_electrolit_faltan, 0) = 0;
  v_esp_list   text[];
  v_esp_aun    text[];
  v_esp_lleg   text[];
  v_merged     jsonb;
  v_tipo       text;
  v_ids        integer[];
  v_pend_esp   integer[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos']))
     AND p_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: sólo puedes recibir el pedido de tu sucursal';
  END IF;

  SELECT * INTO s FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sucursal no tiene ese pedido';
  END IF;

  v_hist := CASE WHEN jsonb_typeof(s.reenvios_historial) = 'array' THEN s.reenvios_historial ELSE '[]'::jsonb END;
  SELECT c INTO v_ciclo FROM jsonb_array_elements(v_hist) c WHERE (c ->> 'ciclo')::integer = p_ciclo LIMIT 1;
  IF v_ciclo IS NULL AND jsonb_array_length(v_hist) > 0 THEN
    RAISE EXCEPTION 'NOT_FOUND: el reenvío % no existe en esa sala', p_ciclo;
  END IF;
  IF v_ciclo ->> 'arrived_at' IS NOT NULL THEN
    RAISE EXCEPTION 'YA_CONFIRMADO: la llegada del reenvío % ya se confirmó', p_ciclo;
  END IF;

  v_elec_count := coalesce((v_ciclo ->> 'electrolits')::integer, 0);
  v_esp_list := ARRAY(SELECT jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(v_ciclo -> 'especiales') = 'array' THEN v_ciclo -> 'especiales' ELSE '[]'::jsonb END));
  v_esp_aun  := ARRAY(SELECT jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(p_especiales) = 'array' THEN p_especiales ELSE '[]'::jsonb END));
  v_esp_lleg := ARRAY(SELECT x FROM unnest(v_esp_list) x WHERE x <> ALL(v_esp_aun));

  v_tipo := CASE WHEN cardinality(v_falt) > 0 AND cardinality(v_dan) > 0 THEN 'mixto'
                 WHEN cardinality(v_falt) > 0 THEN 'falta_caja'
                 WHEN cardinality(v_dan) > 0  THEN 'caja_danada'
                 ELSE 'ok' END;

  -- 1. El ciclo, con lo que llegó y lo que sigue faltando.
  IF v_ciclo IS NOT NULL THEN
    SELECT jsonb_agg(
             CASE WHEN (c ->> 'ciclo')::integer = p_ciclo
                  THEN c || jsonb_build_object(
                         'arrived_at', v_now, 'arrived_tipo', v_tipo, 'arrived_por', v_actor,
                         'cajas_ok', to_jsonb(v_ok), 'cajas_danadas', to_jsonb(v_dan),
                         'cajas_aun_faltantes', to_jsonb(v_falt),
                         'nota', nullif(p_nota, ''),
                         'electrolit_ok', CASE WHEN v_elec_count > 0 THEN v_elec_ok END,
                         'especiales_aun', to_jsonb(v_esp_aun))
                  ELSE c END
             ORDER BY o)
      INTO v_hist
      FROM jsonb_array_elements(v_hist) WITH ORDINALITY AS t(c, o);
  END IF;

  -- 5 (va junto con 1). Especiales: las que llegaron 'ok', las que no 'faltante'.
  IF cardinality(v_esp_lleg) > 0 OR cardinality(v_esp_aun) > 0 THEN
    v_merged := CASE WHEN jsonb_typeof(s.cajas_especiales_llegadas) = 'object' THEN s.cajas_especiales_llegadas ELSE '{}'::jsonb END
             || coalesce((SELECT jsonb_object_agg(l, 'ok')       FROM unnest(v_esp_lleg) l), '{}'::jsonb)
             || coalesce((SELECT jsonb_object_agg(l, 'faltante') FROM unnest(v_esp_aun)  l), '{}'::jsonb);
  END IF;

  UPDATE public.pedido_sucursal_status
     SET segunda_llegada_at        = v_now,
         reenvios_historial        = v_hist,
         falta_cajas               = CASE WHEN cardinality(v_falt) > 0 THEN to_jsonb(v_falt) ELSE '[]'::jsonb END,
         electrolit_ok             = CASE WHEN v_elec_count > 0 THEN v_elec_ok ELSE electrolit_ok END,
         electrolit_faltantes      = CASE WHEN v_elec_count > 0
                                          THEN CASE WHEN v_elec_ok THEN 0 ELSE least(greatest(p_electrolit_faltan, 0), v_elec_count) END
                                          ELSE electrolit_faltantes END,
         cajas_especiales_llegadas = coalesce(v_merged, cajas_especiales_llegadas)
   WHERE id = s.id;

  -- 2. Las cajas que SÍ llegaron (ok o dañadas) dejan de bloquear sus renglones.
  v_ids := public.renglones_de_cajas(s.caja_map, s.pagina_items, v_ok || v_dan);
  IF cardinality(v_ids) > 0 THEN
    UPDATE public.pedido_items SET falta_caja = false
     WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
  END IF;

  -- 3. Las que siguen faltando, los mantienen bloqueados.
  IF cardinality(v_falt) > 0 THEN
    v_ids := public.renglones_de_cajas(s.caja_map, s.pagina_items, v_falt);
    IF cardinality(v_ids) > 0 THEN
      UPDATE public.pedido_items SET falta_caja = true
       WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
    END IF;
  END IF;

  -- 4. El Electrolit del ciclo, si llegó.
  IF v_elec_count > 0 AND v_elec_ok THEN
    UPDATE public.pedido_items pi SET falta_caja = false
      FROM public.products p
     WHERE p.id = pi.erp_product_id
       AND pi.pedido_id = p_pedido_id AND pi.erp_sucursal_id = p_sucursal_id
       AND pi.falta_caja AND pi.status = 'pendiente'
       AND lower(coalesce(p.nombre, '')) LIKE '%electrolit%';
  END IF;

  -- 6. Especiales que llegaron: si llegaron todas, se liberan todos los
  --    renglones especiales bloqueados; si alguna sigue faltando, sólo los de
  --    las ETIQUETAS que llegaron y nunca el de una que sigue faltando.
  IF cardinality(v_esp_lleg) > 0 THEN
    v_pend_esp := ARRAY(SELECT id FROM public.pedido_items
                         WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
                           AND falta_caja AND status = 'pendiente' AND caja_especial);
    IF cardinality(v_pend_esp) > 0 THEN
      IF cardinality(v_esp_aun) = 0 THEN
        v_ids := v_pend_esp;
      ELSE
        v_ids := ARRAY(SELECT x FROM unnest(public.renglones_de_especiales(s.cajas_especiales, v_esp_lleg)) x
                        WHERE x = ANY(v_pend_esp)
                          AND x <> ALL(public.renglones_de_especiales(s.cajas_especiales, v_esp_aun)));
      END IF;
      IF cardinality(v_ids) > 0 THEN
        UPDATE public.pedido_items SET falta_caja = false
         WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ciclo', p_ciclo, 'arrived_tipo', v_tipo, 'arrived_at', v_now);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_llegada_reenvio(uuid, integer, integer, integer[], integer[], integer[], jsonb, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_llegada_reenvio(uuid, integer, integer, integer[], integer[], integer[], jsonb, integer, text) TO authenticated, service_role;
