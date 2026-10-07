-- Un pedido por cada SITUACIÓN que puede vivir una sala (2026-10-07), para
-- revisar en el entorno de pruebas cómo se ve cada una. Complementa
-- `semilla_pedidos_completa.sql` (que cubre las etapas normales).
--
-- Cada pedido dice en su nota qué escenario es. Todos llevan `[demo]` y se
-- borran al volver a correr. Se corre con `execute_sql` sobre el branch de
-- pruebas, NUNCA con `apply_migration`. Freno contra producción incluido.
--
--   reenvío por despachar · reenvío en camino · reenvío recibido
--   caja dañada (con apoyo en recepción) · Electrolit faltante
--   caja especial faltante · caja especial no reenviada · cajas de más
--   diferencia corregida · entrega programada · preparación con apoyo
SET lock_timeout = '5s';

DO $esc$
DECLARE
  emps uuid[]; e record; ped uuid; n_ped int; ruta uuid; ruta2 uuid;
  t0 timestamptz; t_ini timestamptz; t_fin timestamptz; t_env timestamptz; t_lle timestamptz; t_erp timestamptz;
  esp jsonb;
BEGIN
  IF (SELECT count(*) FROM public.employees) > 30 OR (SELECT count(*) FROM public.sales_invoices) > 50000 THEN
    RAISE EXCEPTION 'semilla_pedidos_escenarios: esta base parece PRODUCCIÓN. Abortado.';
  END IF;
  SELECT array_agg(id ORDER BY code) INTO emps FROM public.employees;

  -- Limpieza de la corrida anterior (sólo los escenarios)
  DELETE FROM public.ruta_locations WHERE ruta_id IN (SELECT id FROM public.rutas WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.ruta_pedidos   WHERE ruta_id IN (SELECT id FROM public.rutas WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.rutas          WHERE notes LIKE '[demo] Escenario%';
  DELETE FROM public.pedido_apoyo            WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.pedido_recepcion_firmas WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.pedido_pausa_historial  WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.pedido_items            WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.pedido_sucursal_status  WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo] Escenario%');
  DELETE FROM public.pedidos                 WHERE notes LIKE '[demo] Escenario%';

  PERFORM setseed(0.7);

  FOR e IN SELECT * FROM (VALUES
      ('reenvio_pendiente',     1, 'enviado',    'contando',   'Reenvío por despachar: faltó la caja 2 y bodega ya pidió el reenvío'),
      ('reenvio_en_camino',     2, 'enviado',    'contando',   'Reenvío en camino: la caja 3 va en otra ruta'),
      ('reenvio_recibido',      3, 'completado', 'erp',        'Reenvío recibido: faltó la caja 1 y llegó en el reenvío'),
      ('caja_danada',           4, 'enviado',    'contando',   'Caja dañada al llegar (con apoyo en recepción)'),
      ('electrolit',            7, 'enviado',    'contando',   'Faltaron 2 cajas de Electrolit'),
      ('especial_faltante',     5, 'enviado',    'contando',   'Caja especial E1 no llegó'),
      ('especial_no_reenviada', 7, 'completado', 'erp',        'Caja especial que bodega decidió no reenviar'),
      ('cajas_extra',           1, 'completado', 'erp',        'Llegó una caja de más'),
      ('dif_corregida',         2, 'completado', 'erp',        'Diferencia reportada, bodega corrigió y la sala confirmó'),
      ('programado',            3, 'confirmado', 'preparado',  'Listo con entrega programada para mañana'),
      ('con_apoyo',             4, 'confirmado', 'preparando', 'En preparación con dos personas de apoyo')
    ) AS v(clave, suc, estado, etapa, nota)
  LOOP
    ped := gen_random_uuid();
    t0    := now() - interval '6 hours';
    t_ini := t0 + interval '20 minutes';
    t_fin := CASE WHEN e.etapa IN ('preparado','contando','erp') THEN t0 + interval '2 hours' END;
    t_env := CASE WHEN e.etapa IN ('contando','erp') THEN t0 + interval '2 hours 30 minutes' END;
    t_lle := CASE WHEN e.etapa IN ('contando','erp') THEN t0 + interval '4 hours' END;
    t_erp := CASE WHEN e.etapa = 'erp' THEN t0 + interval '5 hours' END;

    INSERT INTO public.pedidos (id, created_at, created_by, status, sucursal_ids, responsable_id, revisado_por, notes, enviado_at, enviado_por)
    VALUES (ped, t0, emps[1], e.estado, ARRAY[e.suc], emps[2], emps[1], '[demo] Escenario: ' || e.nota, t_env, CASE WHEN t_env IS NOT NULL THEN emps[2] END)
    RETURNING numero INTO n_ped;

    INSERT INTO public.pedido_sucursal_status (pedido_id, erp_sucursal_id, codigo, total_cajas, caja_map, cajas_especiales, cajas_electrolit,
      iniciado_at, iniciado_por, finalizado_at, finalizado_por, llegada_fisica_at, llegada_fisica_por, llegada_tipo, recibido_erp_at, recibido_erp_por)
    SELECT ped, e.suc, lpad(n_ped::text, 2, '0') || '-' || to_char(t0, 'DDMMYY') || '-1-' || m.codigo,
           CASE WHEN t_fin IS NOT NULL THEN 4 END, CASE WHEN t_fin IS NOT NULL THEN '{"1":[1],"2":[1],"3":[2],"4":[2]}'::jsonb END,
           '[]'::jsonb, 0, t_ini, emps[3], t_fin, CASE WHEN t_fin IS NOT NULL THEN emps[3] END,
           t_lle, CASE WHEN t_lle IS NOT NULL THEN emps[8] END, CASE WHEN t_lle IS NOT NULL THEN 'completa' END,
           t_erp, CASE WHEN t_erp IS NOT NULL THEN emps[8] END
      FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = e.suc;

    IF t_lle IS NOT NULL THEN
      INSERT INTO public.pedido_recepcion_firmas (pedido_id, erp_sucursal_id, employee_id, added_by, created_at)
      VALUES (ped, e.suc, emps[8], emps[8], t_lle);
    END IF;

    INSERT INTO public.pedido_items (pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id, cantidad_asignada, cantidad_enviada,
      cantidad_recibida, status, factor, dispatch_tipo, dispatch_factor, dispatch_multiplo, stock_packs_snapshot, min_qty_snapshot, max_qty_snapshot,
      enviado_at, enviado_por, received_at, received_by)
    SELECT ped, e.suc, p.erp_product_id, 9, 2, CASE WHEN t_env IS NOT NULL THEN 2 END,
           CASE WHEN t_erp IS NOT NULL THEN 2 END,
           CASE WHEN t_erp IS NOT NULL THEN 'recibido' ELSE 'pendiente' END,
           1, 'CAJA', 1, 1, 1, 1, 4, t_env, CASE WHEN t_env IS NOT NULL THEN emps[2] END,
           t_erp, CASE WHEN t_erp IS NOT NULL THEN emps[8] END
      FROM (SELECT erp_product_id FROM public.product_stock_params
             WHERE erp_sucursal_id = e.suc AND coalesce(max_units, 0) > 0 ORDER BY random() LIMIT 8) p;

    -- La ruta en la que salió (todo lo despachado sale en una)
    IF t_env IS NOT NULL THEN
      ruta := gen_random_uuid();
      INSERT INTO public.rutas (id, conductor_nombre, salida_at, vuelta_base_at, status, distancia_total_m, duracion_estimada_min, notes, created_by, created_at)
      VALUES (ruta, (SELECT name FROM public.employees WHERE id = emps[12]), t_env, t_env + interval '2 hours', 'completada', 32000, 75,
              '[demo] Escenario ruta', emps[1], t_env);
      INSERT INTO public.ruta_pedidos (ruta_id, pedido_id, erp_sucursal_id, orden_entrega, entregado_at, entregado_por, confirmado_suc_at, confirmado_suc_por)
      VALUES (ruta, ped, e.suc, 1, t_env + interval '50 minutes', emps[1], t_env + interval '1 hour', emps[1]);
    END IF;

    -- ── Lo particular de cada escenario ───────────────────────────────────
    IF e.clave = 'reenvio_pendiente' THEN
      UPDATE public.pedido_sucursal_status SET falta_cajas = '[2]', llegada_tipo = 'falta_caja', falta_caja_at = t_lle, reenvio_por = emps[2],
        reenvios_historial = jsonb_build_array(jsonb_build_object('ciclo',1,'cajas','[2]'::jsonb,'electrolits',0,'especiales','[]'::jsonb,
          'sent_at',NULL,'sent_by',NULL,'solicitado_at',now() - interval '20 minutes','solicitado_por',NULL,'arrived_at',NULL,
          'arrived_tipo',NULL,'cajas_ok','[]'::jsonb,'cajas_danadas','[]'::jsonb,'cajas_aun_faltantes','[]'::jsonb))
       WHERE pedido_id = ped;

    ELSIF e.clave = 'reenvio_en_camino' THEN
      ruta2 := gen_random_uuid();
      INSERT INTO public.rutas (id, conductor_nombre, salida_at, status, distancia_total_m, duracion_estimada_min, notes, created_by, created_at)
      VALUES (ruta2, (SELECT name FROM public.employees WHERE id = emps[12]), now() - interval '40 minutes', 'en_ruta', 18000, 35,
              '[demo] Escenario ruta de reenvío', emps[1], now() - interval '45 minutes');
      INSERT INTO public.ruta_pedidos (ruta_id, pedido_id, erp_sucursal_id, orden_entrega, reenvio_ciclo) VALUES (ruta2, ped, e.suc, 1, 1);
      UPDATE public.pedido_sucursal_status SET falta_cajas = '[3]', llegada_tipo = 'falta_caja', falta_caja_at = t_lle,
        reenvio_por = emps[2], reenvio_bodega_at = now() - interval '40 minutes',
        reenvios_historial = jsonb_build_array(jsonb_build_object('ciclo',1,'cajas','[3]'::jsonb,'electrolits',0,'especiales','[]'::jsonb,
          'sent_at',now() - interval '40 minutes','sent_by',emps[2],'ruta_id',ruta2,'solicitado_at',now() - interval '1 hour','solicitado_por',emps[2],
          'arrived_at',NULL,'arrived_tipo',NULL,'cajas_ok','[]'::jsonb,'cajas_danadas','[]'::jsonb,'cajas_aun_faltantes','[]'::jsonb))
       WHERE pedido_id = ped;

    ELSIF e.clave = 'reenvio_recibido' THEN
      UPDATE public.pedido_sucursal_status SET falta_cajas = '[]', llegada_tipo = 'falta_caja', falta_caja_at = t_lle,
        reenvio_por = emps[2], reenvio_bodega_at = t_lle + interval '20 minutes', segunda_llegada_at = t_lle + interval '50 minutes',
        reenvios_historial = jsonb_build_array(jsonb_build_object('ciclo',1,'cajas','[1]'::jsonb,'electrolits',0,'especiales','[]'::jsonb,
          'sent_at',t_lle + interval '20 minutes','sent_by',emps[2],'solicitado_at',t_lle + interval '10 minutes','solicitado_por',emps[2],
          'arrived_at',t_lle + interval '50 minutes','arrived_por',emps[8],'arrived_tipo','completa','cajas_ok','[1]'::jsonb,
          'cajas_danadas','[]'::jsonb,'cajas_aun_faltantes','[]'::jsonb))
       WHERE pedido_id = ped;

    ELSIF e.clave = 'caja_danada' THEN
      UPDATE public.pedido_sucursal_status SET cajas_danadas = '[2]', llegada_tipo = 'caja_danada', falta_caja_at = t_lle,
        llegada_nota = 'La caja 2 llegó aplastada y mojada.' WHERE pedido_id = ped;
      INSERT INTO public.pedido_apoyo (pedido_id, erp_sucursal_id, employee_id, registered_by, tipo)
      VALUES (ped, e.suc, emps[9], emps[8], 'recepcion'), (ped, e.suc, emps[10], emps[8], 'recepcion');

    ELSIF e.clave = 'electrolit' THEN
      UPDATE public.pedido_sucursal_status SET cajas_electrolit = 2, electrolit_ok = false, electrolit_faltantes = 2,
        llegada_tipo = 'falta_caja', falta_caja_at = t_lle WHERE pedido_id = ped;

    ELSIF e.clave IN ('especial_faltante', 'especial_no_reenviada') THEN
      UPDATE public.pedido_items SET caja_especial = true
       WHERE id IN (SELECT id FROM public.pedido_items WHERE pedido_id = ped ORDER BY id LIMIT 2);
      SELECT jsonb_agg(jsonb_build_object('label', 'E' || t.n, 'pedido_item_id', t.id, 'erp_product_id', t.erp_product_id, 'product_name', t.nombre) ORDER BY t.n)
        INTO esp
        FROM (SELECT pi.id, pi.erp_product_id, pr.nombre, row_number() OVER (ORDER BY pi.id) n
                FROM public.pedido_items pi JOIN public.products pr ON pr.id = pi.erp_product_id
               WHERE pi.pedido_id = ped AND pi.caja_especial) t;
      UPDATE public.pedido_sucursal_status SET cajas_especiales = esp,
        cajas_especiales_llegadas = CASE WHEN e.clave = 'especial_faltante' THEN '{"E1":"faltante","E2":"ok"}'::jsonb
                                         ELSE '{"E1":"no_reenviada","E2":"ok"}'::jsonb END,
        llegada_tipo = 'falta_caja', falta_caja_at = t_lle
       WHERE pedido_id = ped;

    ELSIF e.clave = 'cajas_extra' THEN
      UPDATE public.pedido_sucursal_status SET cajas_extra = 1, cajas_extra_notas = '{"1":"Caja sin rotular con sueros"}'::jsonb
       WHERE pedido_id = ped;

    ELSIF e.clave = 'dif_corregida' THEN
      UPDATE public.pedido_sucursal_status SET diferencias_reportadas_at = t_erp - interval '5 minutes', diferencias_reportadas_por = emps[8],
        corregido_bodega_at = t_erp + interval '30 minutes', corregido_bodega_por = emps[2], corregido_bodega_nota = 'Se envió el faltante en el siguiente pedido.',
        confirmado_correccion_at = t_erp + interval '45 minutes', confirmado_correccion_por = emps[8]
       WHERE pedido_id = ped;

    ELSIF e.clave = 'programado' THEN
      UPDATE public.pedido_sucursal_status
         SET entrega_programada_at = date_trunc('day', now() AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'America/El_Salvador' + interval '1 day 9 hours'
       WHERE pedido_id = ped;

    ELSIF e.clave = 'con_apoyo' THEN
      INSERT INTO public.pedido_apoyo (pedido_id, erp_sucursal_id, employee_id, registered_by, tipo)
      VALUES (ped, e.suc, emps[4], emps[3], 'preparacion'), (ped, e.suc, emps[5], emps[3], 'preparacion');
    END IF;
  END LOOP;
END
$esc$;

SELECT p.numero, s.erp_sucursal_id AS sala, p.status, p.notes
  FROM public.pedidos p JOIN public.pedido_sucursal_status s ON s.pedido_id = p.id
 WHERE p.notes LIKE '[demo] Escenario%' ORDER BY p.numero;
