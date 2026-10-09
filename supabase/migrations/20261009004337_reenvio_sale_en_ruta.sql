-- El reenvío de cajas faltantes sale EN UNA RUTA (2026-10-07).
--
-- Hasta acá «Reenviar caja» escribía el ciclo con `sent_at = now()` y
-- `reenvio_bodega_at`, y el disparador avisaba a la sala «Reenvío en camino»
-- en ese instante — aunque la caja siguiera en bodega. Nadie sabía quién la
-- llevó ni cuándo salió de verdad.
--
-- Decisión del usuario: el reenvío va en otra ruta, y al crearla sale como
-- prioridad. Ahora:
--   1. El portal escribe el ciclo PENDIENTE: `sent_at` nulo (+ `solicitado_at`,
--      `solicitado_por`) y sin tocar `reenvio_bodega_at` → no hay aviso todavía.
--   2. «Nueva ruta» lo ofrece arriba y la parada lleva `reenvio_ciclo`.
--   3. Cuando la RUTA SALE (`avisar_salida_de_ruta`), el ciclo toma
--      `sent_at = salida_at` y `reenvio_bodega_at`; eso dispara el aviso de
--      siempre (`avisar_camino_del_pedido`). Si la ruta no sale, la caja
--      tampoco «sale».
--   4. La parada de reenvío NO dispara además el aviso genérico «Tu pedido
--      salió de bodega»: la sala recibiría dos avisos por la misma caja.
--
-- Todo lo que pregunta «¿va en camino?» ya exige `sent_at` —portal, app
-- nativa—, así que un ciclo pendiente no se confunde con uno en camino.
-- Partida: definiciones VIVAS (md5 crear_ruta c8dc2c2e…, avisar_salida_de_ruta
-- e192a4ec…, iguales en producción y en el entorno de pruebas).
SET lock_timeout = '5s';

ALTER TABLE public.ruta_pedidos ADD COLUMN IF NOT EXISTS reenvio_ciclo smallint;
COMMENT ON COLUMN public.ruta_pedidos.reenvio_ciclo IS
  'Si la parada lleva un REENVÍO de cajas faltantes: el número de ciclo en pedido_sucursal_status.reenvios_historial. NULL = despacho normal del pedido.';

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

CREATE OR REPLACE FUNCTION public.avisar_salida_de_ruta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
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

  -- Despachos normales: «Tu pedido salió de bodega». Las paradas de reenvío
  -- quedan fuera: su aviso es «Reenvío en camino», abajo.
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
       AND rp.reenvio_ciclo IS NULL
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

  -- Reenvíos: el ciclo sale con la ruta. Marcar `sent_at` y
  -- `reenvio_bodega_at` dispara `avisar_camino_del_pedido`, que es el que
  -- avisa «Reenvío en camino» con las cajas del ciclo.
  FOR r IN
    SELECT rp.pedido_id, rp.erp_sucursal_id, rp.reenvio_ciclo
      FROM public.ruta_pedidos rp
     WHERE rp.ruta_id = NEW.id AND rp.reenvio_ciclo IS NOT NULL
  LOOP
    BEGIN
      UPDATE public.pedido_sucursal_status s
         SET reenvios_historial = (
               SELECT jsonb_agg(
                        CASE WHEN (c ->> 'ciclo')::int = r.reenvio_ciclo AND c ->> 'sent_at' IS NULL
                             THEN c || jsonb_build_object('sent_at', NEW.salida_at,
                                                          'sent_by', c -> 'solicitado_por',
                                                          'ruta_id', NEW.id)
                             ELSE c END
                        ORDER BY o)
                 FROM jsonb_array_elements(s.reenvios_historial) WITH ORDINALITY AS t(c, o)),
             reenvio_bodega_at = NEW.salida_at
       WHERE s.pedido_id = r.pedido_id AND s.erp_sucursal_id = r.erp_sucursal_id
         AND jsonb_typeof(s.reenvios_historial) = 'array'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.reenvios_historial) c
                      WHERE (c ->> 'ciclo')::int = r.reenvio_ciclo AND c ->> 'sent_at' IS NULL);
    EXCEPTION WHEN OTHERS THEN PERFORM public.aviso_de_pedido_fallo('reenvio_en_ruta', r.pedido_id, SQLERRM);
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;
