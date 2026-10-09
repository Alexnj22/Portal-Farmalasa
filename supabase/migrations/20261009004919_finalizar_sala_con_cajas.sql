-- 07 · Finalizar una sala en UNA transacción (2026-10-08).
--
-- `handleFinalizarConCajas` (src/hooks/usePedidosData.js) hacía tres
-- escrituras seguidas desde el navegador:
--   1. `confirmar_envio_pedido` — qué sale de verdad (ajustes);
--   2. `update_pedido_sucursal_lifecycle(..., 'finalizar')` — finalizado_at;
--   3. UPDATE de pedido_sucursal_status: total_cajas, caja_map, pagina_items,
--      cajas_electrolit, cajas_especiales.
-- Si la 3 fallaba —red, sesión vencida, permiso— la sala quedaba FINALIZADA y
-- sin cajas ni hojas: la llegada no tiene qué preguntar, `falta_caja` no
-- encuentra renglones y el traslado sale sin número de hoja. Y no había forma
-- de reintentar desde la pantalla, porque «finalizar» ya no se ofrecía.
--
-- Esta función hace las tres en el mismo orden y en la misma transacción.
-- Llama a las dos funciones vivas en vez de copiarlas: la regla de la pausa
-- activa y el ajuste de lo que sale siguen escritos en un solo lugar.
--
-- Diferencias a propósito con el camino viejo:
--   · Rechaza (NO_INICIADO) si la sala no empezó a prepararse, y
--     (YA_FINALIZADO) si ya estaba finalizada. Antes, en el primer caso el
--     paso 2 no hacía nada y el 3 escribía cajas sobre una sala sin finalizar;
--     en el segundo, reescribía cajas y hojas de un despacho ya cerrado.
--   · Si después del paso 2 la sala sigue sin `finalizado_at` (una pausa sin
--     reanudar que el UPDATE condicionado no deja pasar), lanza en vez de
--     seguir escribiendo.
--
-- El traslado al sistema (`despacharTrasladoPedido`, edge function) sigue
-- DESPUÉS y fuera de esta función, como hasta hoy: necesita finalizado_at y
-- las hojas ya escritas, y su fallo no debe deshacer el finalizado.
--
-- Los conteos (`p_cajas_electrolit`, `p_cajas_especiales`) los sigue
-- calculando el navegador (`construirCajasEspeciales`, `cajasDeRenglon`): son
-- la mitad de un mapa cuya otra mitad (`renglonesDeCajasFaltantes`) vive en
-- el mismo archivo JS, y partirlo entre JS y SQL es justo lo que costó el
-- pedido #178.
--
-- Alcance: de Bodega (`auth_can_edit_scope_all`), igual que sus dos partes.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.finalizar_sala_con_cajas(
  p_pedido_id        uuid,
  p_sucursal_id      integer,
  p_total_cajas      integer,
  p_caja_map         jsonb,
  p_pagina_items     jsonb,
  p_cajas_electrolit integer,
  p_cajas_especiales jsonb,
  p_ajustes          jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := auth_employee_id();
  s       public.pedido_sucursal_status%ROWTYPE;
  v_envio jsonb;
  v_fin   timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: finalizar es de Bodega';
  END IF;
  IF p_total_cajas IS NULL OR p_total_cajas < 0 THEN
    RAISE EXCEPTION 'INVALID: total_cajas inválido';
  END IF;

  SELECT * INTO s FROM public.pedido_sucursal_status
   WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND OR s.iniciado_at IS NULL THEN
    RAISE EXCEPTION 'NO_INICIADO: esa sala no empezó a prepararse';
  END IF;
  IF s.finalizado_at IS NOT NULL THEN
    RAISE EXCEPTION 'YA_FINALIZADO: esa sala ya estaba finalizada';
  END IF;

  -- 1. Qué sale de verdad (antes de finalizar: sólo toca renglones pendientes).
  v_envio := public.confirmar_envio_pedido(p_pedido_id, p_sucursal_id, coalesce(p_ajustes, '[]'::jsonb));

  -- 2. Finalizar, con la regla viva de la pausa.
  PERFORM public.update_pedido_sucursal_lifecycle(p_pedido_id, p_sucursal_id, 'finalizar', v_actor);
  SELECT finalizado_at INTO v_fin FROM public.pedido_sucursal_status WHERE id = s.id;
  IF v_fin IS NULL THEN
    RAISE EXCEPTION 'No se puede finalizar: la sala está en pausa.';
  END IF;

  -- 3. Cajas y hojas.
  UPDATE public.pedido_sucursal_status
     SET total_cajas      = p_total_cajas,
         caja_map         = coalesce(p_caja_map, '{}'::jsonb),
         pagina_items     = coalesce(p_pagina_items, '{}'::jsonb),
         cajas_electrolit = coalesce(p_cajas_electrolit, 0),
         cajas_especiales = coalesce(p_cajas_especiales, '[]'::jsonb)
   WHERE id = s.id;

  RETURN jsonb_build_object('finalizado_at', v_fin, 'envio', v_envio);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.finalizar_sala_con_cajas(uuid, integer, integer, jsonb, jsonb, integer, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finalizar_sala_con_cajas(uuid, integer, integer, jsonb, jsonb, integer, jsonb, jsonb) TO authenticated, service_role;
