-- 08 · Confirmar la LLEGADA de un pedido en una sola transacción (2026-10-08).
--
-- `confirmarLlegadaDePedido` (src/data/llegadaDePedido.js — la usan el portal y
-- la app del teléfono) escribía en cuatro a seis pasos:
--   1. pedido_items.falta_caja=true en los renglones de las cajas numeradas que
--      no llegaron (por hoja si hay `pagina_items`; si no, recalculaba el mapa
--      con la paginación del PDF y lo GUARDABA; si tampoco había `caja_map`,
--      todos los pendientes de la sala);
--   2. el Electrolit que faltó: los N primeros renglones de Electrolit (por id)
--      que no estuvieran ya en falta ni recibidos;
--   3. los renglones de las cajas especiales que no llegaron, por su etiqueta
--      (y si una etiqueta no tenía dueño, se plantaba con un error);
--   4. `update_pedido_sucursal_lifecycle(..., 'confirmar_llegada')`;
--   5. UPDATE de pedido_sucursal_status con llegada_tipo, la nota, las cajas,
--      el Electrolit, las especiales y las cajas de más.
-- Un corte entre el 4 y el 5 dejaba la sala «llegó» SIN `llegada_tipo`: el
-- aviso a bodega (que mira llegada_tipo) no salía nunca y la tarjeta decía
-- otra cosa que la base. Entre el 1 y el 4, renglones bloqueados de un pedido
-- que figuraba sin llegar.
--
-- Esta función hace lo mismo, en la misma transacción y sobre la fila
-- bloqueada. Detalles que se replicaron a propósito:
--   · Los candidatos de Electrolit se eligen ANTES de marcar las cajas
--     numeradas, porque el navegador los elegía sobre las filas que había
--     leído antes de escribir nada.
--   · `llegada_tipo` se calcula acá con la misma regla que `tipoDeLlegada`
--     (cuenta Electrolit y especiales faltantes, no sólo cajas numeradas) y se
--     devuelve, para que la pantalla no tenga que repetirla.
--   · Los pasos 4 y 5 van en UN solo UPDATE: el disparador
--     `avisar_camino_del_pedido` ve `llegada_tipo` junto con todo lo demás.
--
-- Diferencias a propósito:
--   · El recálculo del mapa de hojas para pedidos VIEJOS sin `pagina_items`
--     necesita la paginación del PDF, que vive en JS. Si la sala reporta
--     cajas faltantes y el pedido tiene `caja_map` sin `pagina_items`, la
--     función pide el mapa en `p_pagina_items` (PAGINA_ITEMS_REQUERIDO) y lo
--     guarda en la misma transacción. Con `p_pagina_items` presente y la
--     columna ya llena, se ignora (manda lo guardado).
--   · Una sala con `llegada_tipo` ya puesto se RECHAZA (YA_CONFIRMADA): era
--     el doble clic, que volvía a bloquear renglones.
--
-- Alcance: el de la recepción — la sala propia, o alcance de red.
-- Depende de: 06 (`renglones_de_cajas`, `renglones_de_especiales`).
SET lock_timeout = '5s';

-- 2026-10-08: el Electrolit ya no se elige acá. Elegir «los N primeros por id»
-- es el `slice(0, n)` que se corrigió en el portal: con dos sabores bloqueaba el
-- que sí llegó, y contaba renglones donde la sala cuenta cajas. Quien sabe cuál
-- faltó es la pantalla (`renglonesDeElectrolitFaltante`: sólo marca cuando se
-- puede saber), así que manda los ids en `p_electrolit_ids`. Sin ids, el
-- faltante queda anotado en la sala (`electrolit_faltantes`) y no se bloquea
-- ningún renglón a ciegas. La firma cambia: se quita la anterior.
DROP FUNCTION IF EXISTS public.confirmar_llegada_pedido(uuid, integer, integer[], integer[], text, integer, jsonb, integer, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.confirmar_llegada_pedido(
  p_pedido_id           uuid,
  p_sucursal_id         integer,
  p_cajas_danadas       integer[] DEFAULT '{}'::integer[],
  p_cajas_faltan        integer[] DEFAULT '{}'::integer[],
  p_nota                text      DEFAULT NULL,
  p_electrolit_faltan   integer   DEFAULT NULL,
  p_especiales_llegadas jsonb     DEFAULT NULL,
  p_cajas_extra         integer   DEFAULT 0,
  p_cajas_extra_notas   jsonb     DEFAULT NULL,
  p_pagina_items        jsonb     DEFAULT NULL,
  p_electrolit_ids      integer[] DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor     uuid := auth_employee_id();
  s           public.pedido_sucursal_status%ROWTYPE;
  v_dan       integer[] := coalesce(p_cajas_danadas, '{}');
  v_falt      integer[] := coalesce(p_cajas_faltan, '{}');
  v_elec      integer   := coalesce(p_electrolit_faltan, 0);
  v_esp_falt  text[];
  v_huerf     text[];
  v_has_falta boolean;
  v_has_dan   boolean;
  v_tipo      text;
  v_pag       jsonb;
  v_elec_ids  integer[] := '{}';
  v_ids       integer[] := '{}';
  v_marcados  integer := 0;
  v_n         integer;
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
  IF s.llegada_tipo IS NOT NULL THEN
    RAISE EXCEPTION 'YA_CONFIRMADA: la llegada de esa sala ya se confirmó';
  END IF;

  v_esp_falt := ARRAY(SELECT k FROM jsonb_each_text(
                  CASE WHEN jsonb_typeof(p_especiales_llegadas) = 'object' THEN p_especiales_llegadas ELSE '{}'::jsonb END) AS e(k, v)
                 WHERE v = 'faltante');
  v_has_dan   := cardinality(v_dan) > 0;
  v_has_falta := cardinality(v_falt) > 0 OR v_elec > 0 OR cardinality(v_esp_falt) > 0;
  v_tipo := CASE WHEN v_has_falta AND v_has_dan THEN 'mixto'
                 WHEN v_has_falta THEN 'falta_caja'
                 WHEN v_has_dan   THEN 'caja_danada'
                 ELSE 'completa' END;

  -- Electrolit: los renglones que eligió la pantalla, y sólo de esta sala.
  -- Se toman ANTES de marcar las cajas numeradas (ver arriba).
  IF v_elec > 0 AND cardinality(coalesce(p_electrolit_ids, '{}')) > 0 THEN
    v_elec_ids := ARRAY(
      SELECT pi.id FROM public.pedido_items pi
       WHERE pi.id = ANY(p_electrolit_ids)
         AND pi.pedido_id = p_pedido_id AND pi.erp_sucursal_id = p_sucursal_id
         AND NOT coalesce(pi.falta_caja, false)
         AND pi.status IS DISTINCT FROM 'recibido');
  END IF;

  -- Especiales: el dueño de cada etiqueta, o se planta.
  IF cardinality(v_esp_falt) > 0 THEN
    v_huerf := ARRAY(SELECT l FROM unnest(v_esp_falt) l
                      WHERE NOT EXISTS (
                        SELECT 1 FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(s.cajas_especiales) = 'array' THEN s.cajas_especiales ELSE '[]'::jsonb END) c
                         WHERE c ->> 'label' = l AND c ->> 'pedido_item_id' IS NOT NULL));
    IF cardinality(v_huerf) > 0 THEN
      RAISE EXCEPTION 'No se pudo identificar qué producto es la caja %. Avisa a bodega antes de confirmar la llegada.',
        array_to_string(v_huerf, ', ');
    END IF;
  END IF;

  -- 1. Cajas numeradas que no llegaron.
  IF cardinality(v_falt) > 0 THEN
    v_pag := CASE WHEN jsonb_typeof(s.pagina_items) = 'object' THEN s.pagina_items ELSE '{}'::jsonb END;
    IF v_pag <> '{}'::jsonb THEN
      v_ids := public.renglones_de_cajas(s.caja_map, v_pag, v_falt);
    ELSIF jsonb_typeof(s.caja_map) = 'object' AND s.caja_map <> '{}'::jsonb THEN
      IF coalesce(jsonb_typeof(p_pagina_items), '') <> 'object' OR p_pagina_items = '{}'::jsonb THEN
        RAISE EXCEPTION 'PAGINA_ITEMS_REQUERIDO: el pedido no tiene el mapa de renglones por hoja; recalcúlalo y mándalo en p_pagina_items';
      END IF;
      UPDATE public.pedido_sucursal_status SET pagina_items = p_pagina_items WHERE id = s.id;
      v_ids := public.renglones_de_cajas(s.caja_map, p_pagina_items, v_falt);
    ELSE
      v_ids := ARRAY(SELECT id FROM public.pedido_items
                      WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
                        AND status = 'pendiente');
    END IF;
    IF cardinality(v_ids) > 0 THEN
      UPDATE public.pedido_items SET falta_caja = true
       WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_marcados := v_marcados + v_n;
    END IF;
  END IF;

  -- 2. Electrolit que faltó.
  IF cardinality(v_elec_ids) > 0 THEN
    UPDATE public.pedido_items SET falta_caja = true WHERE id = ANY(v_elec_ids);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_marcados := v_marcados + v_n;
  END IF;

  -- 3. Cajas especiales que no llegaron.
  IF cardinality(v_esp_falt) > 0 THEN
    v_ids := public.renglones_de_especiales(s.cajas_especiales, v_esp_falt);
    IF cardinality(v_ids) > 0 THEN
      UPDATE public.pedido_items SET falta_caja = true
       WHERE id = ANY(v_ids) AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;
      GET DIAGNOSTICS v_n = ROW_COUNT; v_marcados := v_marcados + v_n;
    END IF;
  END IF;

  -- 4 + 5. La llegada y su detalle, en una sola escritura.
  UPDATE public.pedido_sucursal_status
     SET llegada_fisica_at         = coalesce(llegada_fisica_at, now()),
         llegada_fisica_por        = CASE WHEN llegada_fisica_at IS NULL THEN v_actor ELSE llegada_fisica_por END,
         llegada_tipo              = v_tipo,
         llegada_nota              = nullif(p_nota, ''),
         falta_cajas               = to_jsonb(v_falt),
         cajas_danadas             = to_jsonb(v_dan),
         falta_caja_at             = CASE WHEN v_has_falta OR v_has_dan THEN now() ELSE falta_caja_at END,
         electrolit_ok             = CASE WHEN p_electrolit_faltan IS NOT NULL THEN p_electrolit_faltan = 0 ELSE electrolit_ok END,
         electrolit_faltantes      = CASE WHEN p_electrolit_faltan IS NOT NULL THEN p_electrolit_faltan ELSE electrolit_faltantes END,
         cajas_especiales_llegadas = CASE WHEN p_especiales_llegadas IS NOT NULL THEN p_especiales_llegadas ELSE cajas_especiales_llegadas END,
         cajas_extra               = CASE WHEN coalesce(p_cajas_extra, 0) > 0 THEN p_cajas_extra END,
         cajas_extra_notas         = CASE WHEN coalesce(p_cajas_extra, 0) > 0 THEN p_cajas_extra_notas END
   WHERE id = s.id;

  RETURN jsonb_build_object('tipo', v_tipo, 'renglones_en_falta', v_marcados);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_llegada_pedido(uuid, integer, integer[], integer[], text, integer, jsonb, integer, jsonb, jsonb, integer[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.confirmar_llegada_pedido(uuid, integer, integer[], integer[], text, integer, jsonb, integer, jsonb, jsonb, integer[]) TO authenticated, service_role;
