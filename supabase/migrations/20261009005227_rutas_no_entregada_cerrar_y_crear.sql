-- 10 · Rutas: parada no entregada, cerrar una ruta, y una sala en una sola
--      ruta a la vez (2026-10-08).
--
-- ⚠ VA DESPUÉS de `reenvio_sale_en_ruta.sql` (borrador de otra sesión, todavía
-- no aplicado en producción): usa `ruta_pedidos.reenvio_ciclo`, que ése
-- agrega, y `crear_ruta` parte de SU versión (la que ya le pone
-- `reenvio_ciclo` a la parada), no de la de producción de hoy (md5 c8dc2c2e…).
--
-- Lo que pasaba:
--   · Una parada que no se pudo entregar no tenía salida. La única forma de
--     cerrar la ruta era «completar», que la dejaba como entregada en todo
--     menos en `entregado_at`, y la sala quedaba atada a esa ruta para
--     siempre: `fetchSalasListasParaRuta` excluye a toda sala que tenga una
--     fila en `ruta_pedidos`, así que no se la podía mandar en otra. Así
--     quedaron las rutas 7, 8, 9, 13 y 15 «en ruta» desde el 19-20 de agosto.
--   · `crear_ruta` aceptaba una sala que ya iba en otra ruta abierta. La
--     pantalla ya no la ofrecía; la base sí la aceptaba.
--
-- Ahora:
--   · `ruta_parada_no_entregada`: la parada SALE de la ruta (la fila se borra
--     de `ruta_pedidos`, así todo lo que mira «¿ya salió?» la vuelve a ver
--     disponible sin cambiar una línea del frontend) y queda anotada, con su
--     motivo y quién, en `ruta_paradas_no_entregadas`. Si era un reenvío, el
--     ciclo vuelve a PENDIENTE (`sent_at` nulo) para salir en otra ruta. Si
--     al pedido no le queda ninguna parada de despacho y estaba 'enviado',
--     vuelve a 'confirmado'. Si la ruta ya había salido, la sala recibe un
--     aviso: le habían dicho «en camino».
--   · `cerrar_ruta`: cierra (`completada` + `vuelta_base_at`, igual que
--     «completar») aunque queden paradas sin entregar. Cada parada pendiente
--     cuya sala YA confirmó la llegada se deja como está (se entregó y no se
--     marcó); las demás salen de la ruta como «no entregada» con el motivo
--     del cierre, que entonces es obligatorio. El motivo queda en
--     `rutas.notes`.
--   · `crear_ruta` rechaza una sala que ya va en otra ruta abierta, que ya se
--     entregó o que ya confirmó la llegada; un reenvío puede salir aunque la
--     sala tenga su despacho en otra ruta, pero el mismo ciclo no va en dos.
--
-- Alcance: `pedidos_tab_rutas` editar con alcance de RED
-- (`auth_can_edit_scope_all`). No `modulo-de-red` en el manifiesto: los
-- cargos de sala tienen `pedidos_tab_rutas` VER con alcance BRANCH, y el gate
-- lo marcaría (con razón). Hoy editan rutas: Administrador, Auxiliar de
-- Bodega, Jefe/a de Talento Humano, Supervisor/a de Ventas y QA — todos ALL.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.ruta_paradas_no_entregadas (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ruta_id          uuid     NOT NULL REFERENCES public.rutas(id) ON DELETE CASCADE,
  pedido_id        uuid     NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  erp_sucursal_id  integer  NOT NULL,
  reenvio_ciclo    smallint,
  orden_entrega    integer,
  origen           text     NOT NULL CHECK (origen IN ('parada', 'cierre_ruta')),
  motivo           text     NOT NULL,
  hecho_por        uuid     REFERENCES public.employees(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ruta_paradas_no_entregadas IS
  'Paradas que salieron de una ruta sin entregarse (ruta_parada_no_entregada / cerrar_ruta). Historial de negocio: no se purga.';
CREATE INDEX IF NOT EXISTS ruta_paradas_no_entregadas_ruta_idx   ON public.ruta_paradas_no_entregadas (ruta_id);
CREATE INDEX IF NOT EXISTS ruta_paradas_no_entregadas_pedido_idx ON public.ruta_paradas_no_entregadas (pedido_id, erp_sucursal_id);
CREATE INDEX IF NOT EXISTS ruta_paradas_no_entregadas_hecho_idx  ON public.ruta_paradas_no_entregadas (hecho_por);

ALTER TABLE public.ruta_paradas_no_entregadas ENABLE ROW LEVEL SECURITY;
-- Se lee con la misma regla que `ruta_pedidos`; se escribe sólo por las
-- funciones de abajo (DEFINER): no hay policy de escritura a propósito.
DROP POLICY IF EXISTS ruta_paradas_no_entregadas_select ON public.ruta_paradas_no_entregadas;
CREATE POLICY ruta_paradas_no_entregadas_select ON public.ruta_paradas_no_entregadas
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('pedidos_tab_rutas', 'can_view'))
         AND ((SELECT public.auth_module_scope('pedidos_tab_rutas')) = 'ALL'
              OR erp_sucursal_id = (SELECT public.auth_employee_erp_sucursal_id())));
REVOKE ALL ON public.ruta_paradas_no_entregadas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ruta_paradas_no_entregadas FROM authenticated;
GRANT SELECT ON public.ruta_paradas_no_entregadas TO authenticated;

-- El trabajo de sacar UNA parada. Interna: la llaman las dos de abajo, que
-- ya chequearon permiso y alcance; no se expone.
CREATE OR REPLACE FUNCTION public.liberar_parada_de_ruta(p_parada_id uuid, p_motivo text, p_actor uuid, p_origen text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  rp      public.ruta_pedidos%ROWTYPE;
  r       public.rutas%ROWTYPE;
  v_num   integer;
  v_sala  text;
  v_bid   integer;
BEGIN
  SELECT * INTO rp FROM public.ruta_pedidos WHERE id = p_parada_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO r FROM public.rutas WHERE id = rp.ruta_id;

  INSERT INTO public.ruta_paradas_no_entregadas
    (ruta_id, pedido_id, erp_sucursal_id, reenvio_ciclo, orden_entrega, origen, motivo, hecho_por)
  VALUES (rp.ruta_id, rp.pedido_id, rp.erp_sucursal_id, rp.reenvio_ciclo, rp.orden_entrega, p_origen, p_motivo, p_actor);

  -- Un reenvío que no llegó vuelve a esperar ruta: sin `sent_at`, «Nueva
  -- ruta» lo vuelve a ofrecer arriba (`fetchReenviosPorDespachar`). Sólo el
  -- ciclo que salió con ESTA ruta.
  IF rp.reenvio_ciclo IS NOT NULL THEN
    UPDATE public.pedido_sucursal_status s
       SET reenvios_historial = (
             SELECT jsonb_agg(CASE WHEN (c ->> 'ciclo')::int = rp.reenvio_ciclo
                                    AND (c ->> 'ruta_id' IS NULL OR c ->> 'ruta_id' = rp.ruta_id::text)
                                    AND c ->> 'arrived_at' IS NULL
                                   THEN c || jsonb_build_object('sent_at', NULL, 'sent_by', NULL, 'ruta_id', NULL)
                                   ELSE c END ORDER BY o)
               FROM jsonb_array_elements(s.reenvios_historial) WITH ORDINALITY AS t(c, o))
     WHERE s.pedido_id = rp.pedido_id AND s.erp_sucursal_id = rp.erp_sucursal_id
       AND jsonb_typeof(s.reenvios_historial) = 'array';
  END IF;

  DELETE FROM public.ruta_pedidos WHERE id = rp.id;

  -- Si al pedido no le queda ninguna parada de despacho, no salió.
  IF rp.reenvio_ciclo IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.ruta_pedidos x WHERE x.pedido_id = rp.pedido_id AND x.reenvio_ciclo IS NULL) THEN
    UPDATE public.pedidos SET status = 'confirmado', enviado_at = NULL, enviado_por = NULL
     WHERE id = rp.pedido_id AND status = 'enviado';
  END IF;

  -- A la sala le habían dicho «en camino» si la ruta ya había salido.
  IF r.salida_at IS NOT NULL THEN
    BEGIN
      SELECT numero INTO v_num FROM public.pedidos WHERE id = rp.pedido_id;
      SELECT branch_id, nombre INTO v_bid, v_sala FROM public.erp_sucursal_map WHERE erp_sucursal_id = rp.erp_sucursal_id;
      IF v_bid IS NOT NULL THEN
        PERFORM public.notify_branch_como(p_actor, v_bid, 'PEDIDO_TRACKING',
          'Pedido #' || v_num || ' no se entregó',
          CASE WHEN rp.reenvio_ciclo IS NOT NULL THEN 'El reenvío del pedido #' ELSE 'El pedido #' END
            || v_num || ' no se pudo entregar en esta ruta: ' || p_motivo || '. Saldrá en otra ruta.',
          '/pedidos', public.meta_de_pedido(ARRAY[v_num], v_sala, 'no_entregado', NULL, NULL, NULL, p_motivo), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('no_entregado', rp.pedido_id, SQLERRM);
    END;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.liberar_parada_de_ruta(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.liberar_parada_de_ruta(uuid, text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ruta_parada_no_entregada(
  p_ruta_id     uuid,
  p_pedido_id   uuid,
  p_sucursal_id integer,
  p_motivo      text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor  uuid := auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  r        public.rutas%ROWTYPE;
  rp       public.ruta_pedidos%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos_tab_rutas']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Rutas';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos_tab_rutas'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: gestionar rutas es de Bodega';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: di por qué no se entregó';
  END IF;

  SELECT * INTO r FROM public.rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa ruta no existe';
  END IF;
  IF r.status NOT IN ('pendiente', 'en_ruta', 'con_alerta') THEN
    RAISE EXCEPTION 'RUTA_CERRADA: la ruta ya está %', r.status;
  END IF;

  SELECT * INTO rp FROM public.ruta_pedidos
   WHERE ruta_id = p_ruta_id AND pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa sala no va en esa ruta';
  END IF;
  IF rp.entregado_at IS NOT NULL THEN
    RAISE EXCEPTION 'YA_ENTREGADA: esa parada ya se marcó entregada';
  END IF;

  PERFORM public.liberar_parada_de_ruta(rp.id, v_motivo, v_actor, 'parada');

  RETURN jsonb_build_object('ruta_id', p_ruta_id, 'pedido_id', p_pedido_id,
                            'erp_sucursal_id', p_sucursal_id, 'reenvio_ciclo', rp.reenvio_ciclo,
                            'paradas_restantes', (SELECT count(*) FROM public.ruta_pedidos WHERE ruta_id = p_ruta_id));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ruta_parada_no_entregada(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ruta_parada_no_entregada(uuid, uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cerrar_ruta(p_ruta_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor     uuid := auth_employee_id();
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  r           public.rutas%ROWTYPE;
  p           record;
  v_liberadas integer := 0;
  v_llegaron  integer := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos_tab_rutas']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Rutas';
  END IF;
  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['pedidos_tab_rutas'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: gestionar rutas es de Bodega';
  END IF;

  SELECT * INTO r FROM public.rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: esa ruta no existe';
  END IF;
  IF r.status = 'completada' THEN
    RAISE EXCEPTION 'RUTA_CERRADA: la ruta ya está completada';
  END IF;

  FOR p IN
    SELECT rp.id, rp.reenvio_ciclo,
           CASE WHEN rp.reenvio_ciclo IS NULL
                THEN (s.llegada_fisica_at IS NOT NULL OR s.recibido_erp_at IS NOT NULL)
                ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(s.reenvios_historial) = 'array' THEN s.reenvios_historial ELSE '[]'::jsonb END) c
                              WHERE (c ->> 'ciclo')::int = rp.reenvio_ciclo AND c ->> 'arrived_at' IS NOT NULL)
           END AS ya_llego
      FROM public.ruta_pedidos rp
      LEFT JOIN public.pedido_sucursal_status s
             ON s.pedido_id = rp.pedido_id AND s.erp_sucursal_id = rp.erp_sucursal_id
     WHERE rp.ruta_id = p_ruta_id AND rp.entregado_at IS NULL
     ORDER BY rp.orden_entrega
  LOOP
    IF coalesce(p.ya_llego, false) THEN
      v_llegaron := v_llegaron + 1;   -- se entregó y nadie lo marcó: se deja
    ELSE
      IF v_motivo IS NULL THEN
        RAISE EXCEPTION 'MOTIVO_REQUERIDO: quedan paradas sin entregar; di por qué se cierra la ruta';
      END IF;
      PERFORM public.liberar_parada_de_ruta(p.id, v_motivo, v_actor, 'cierre_ruta');
      v_liberadas := v_liberadas + 1;
    END IF;
  END LOOP;

  UPDATE public.rutas
     SET status         = 'completada',
         vuelta_base_at = coalesce(vuelta_base_at, now()),
         notes          = CASE WHEN v_motivo IS NULL THEN notes
                               ELSE concat_ws(E'\n', nullif(notes, ''),
                                    '[Cierre ' || to_char(now() AT TIME ZONE 'America/El_Salvador', 'DD/MM/YYYY HH24:MI') || '] ' || v_motivo)
                          END
   WHERE id = p_ruta_id;

  RETURN jsonb_build_object('ruta_id', p_ruta_id, 'liberadas', v_liberadas,
                            'ya_habian_llegado', v_llegaron,
                            'entregadas', (SELECT count(*) FROM public.ruta_pedidos WHERE ruta_id = p_ruta_id AND entregado_at IS NOT NULL));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cerrar_ruta(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_ruta(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crear_ruta(p_conductor_id uuid, p_conductor_nombre text, p_paradas jsonb, p_distancia_total_m integer DEFAULT NULL::integer, p_duracion_min integer DEFAULT NULL::integer, p_creado_por uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ruta_id uuid;
  v_parada  jsonb;
  v_actor   uuid := auth_employee_id();
  v_pid     uuid;
  v_suc     integer;
  v_ciclo   smallint;
  v_rotulo  text;
BEGIN
  -- Auditoría 2026-07 (0B.7): la función no chequeaba ningún rol, y usaba
  -- p_creado_por (mandado por el cliente) tal cual para autoría y para
  -- enviado_por de los pedidos incluidos — cualquier authenticated podía
  -- crear rutas y marcar pedidos enviados atribuyéndolo a otro empleado.
  -- p_creado_por queda en la firma por compatibilidad con el caller actual
  -- (CrearRutaModal.jsx) pero ya no se usa para autoría.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NOT auth_can_edit_any(ARRAY['pedidos_tab_rutas']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Rutas';
  END IF;

  INSERT INTO rutas (
    conductor_id, conductor_nombre,
    distancia_total_m, duracion_estimada_min,
    created_by, status
  )
  VALUES (
    p_conductor_id, p_conductor_nombre,
    p_distancia_total_m, p_duracion_min,
    v_actor, 'pendiente'
  )
  RETURNING id INTO v_ruta_id;

  FOR v_parada IN SELECT * FROM jsonb_array_elements(p_paradas) LOOP
    -- Una sala no puede ir en dos rutas a la vez (2026-10-08). La pantalla ya
    -- no la ofrecía (`fetchSalasListasParaRuta`), pero la base la aceptaba: dos
    -- pantallas armando rutas al mismo tiempo, o una petición a mano, ponían la
    -- misma sala en dos rutas y la sala recibía dos «en camino». Un despacho
    -- normal se rechaza si esa sala ya va en una ruta abierta, si ya se la
    -- entregaron o si ya confirmó la llegada. Un REENVÍO (`reenvio_ciclo`) sí
    -- puede salir aunque la sala tenga su despacho en otra ruta — es otra caja
    -- —, pero el mismo ciclo no puede ir en dos rutas.
    v_pid   := (v_parada->>'pedido_id')::uuid;
    v_suc   := (v_parada->>'erp_sucursal_id')::integer;
    v_ciclo := nullif(v_parada->>'reenvio_ciclo', '')::smallint;
    SELECT '#' || p.numero || ' · ' || coalesce(m.nombre, 'sucursal ' || v_suc) INTO v_rotulo
      FROM public.pedidos p LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = v_suc
     WHERE p.id = v_pid;
    IF v_ciclo IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.ruta_pedidos rp JOIN public.rutas r ON r.id = rp.ruta_id
                  WHERE rp.pedido_id = v_pid AND rp.erp_sucursal_id = v_suc AND rp.reenvio_ciclo IS NULL
                    AND rp.ruta_id <> v_ruta_id
                    AND (rp.entregado_at IS NOT NULL OR r.status IN ('pendiente', 'en_ruta', 'con_alerta'))) THEN
        RAISE EXCEPTION 'SALA_YA_EN_RUTA: % ya va en otra ruta o ya se entregó', coalesce(v_rotulo, v_pid::text);
      END IF;
      IF EXISTS (SELECT 1 FROM public.pedido_sucursal_status s
                  WHERE s.pedido_id = v_pid AND s.erp_sucursal_id = v_suc
                    AND (s.llegada_fisica_at IS NOT NULL OR s.recibido_erp_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'SALA_YA_RECIBIO: % ya confirmó la llegada', coalesce(v_rotulo, v_pid::text);
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.ruta_pedidos rp
                   WHERE rp.pedido_id = v_pid AND rp.erp_sucursal_id = v_suc AND rp.reenvio_ciclo = v_ciclo
                     AND rp.ruta_id <> v_ruta_id) THEN
      RAISE EXCEPTION 'REENVIO_YA_EN_RUTA: el reenvío % de % ya va en otra ruta', v_ciclo, coalesce(v_rotulo, v_pid::text);
    END IF;

    INSERT INTO ruta_pedidos (
      ruta_id, pedido_id, erp_sucursal_id, orden_entrega,
      distancia_desde_anterior_m, duracion_desde_anterior_min, reenvio_ciclo
    ) VALUES (
      v_ruta_id,
      (v_parada->>'pedido_id')::uuid,
      (v_parada->>'erp_sucursal_id')::integer,
      (v_parada->>'orden_entrega')::integer,
      (v_parada->>'dist_m')::integer,
      (v_parada->>'dur_min')::integer,
      nullif(v_parada->>'reenvio_ciclo', '')::smallint
    )
    ON CONFLICT (ruta_id, pedido_id, erp_sucursal_id) DO NOTHING;
  END LOOP;

  -- Marcar todos los pedidos incluidos como "enviado". Un reenvío es de un
  -- pedido que ya salió, así que el `status = 'confirmado'` lo deja fuera solo.
  UPDATE pedidos
  SET status      = 'enviado',
      enviado_por = v_actor,
      enviado_at  = now()
  WHERE id IN (
    SELECT DISTINCT (value->>'pedido_id')::uuid
    FROM jsonb_array_elements(p_paradas)
  )
  AND status = 'confirmado';

  RETURN v_ruta_id;
END;
$function$;
