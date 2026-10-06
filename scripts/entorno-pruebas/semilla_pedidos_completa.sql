-- Pedidos de muestra en TODAS las etapas, para ver pintadas las cinco pestañas
-- de /pedidos en el entorno de pruebas (2026-10-06).
--
-- El branch nace sin un solo pedido, así que «Pedidos», «Rutas de entrega» y
-- «Métricas» sólo mostraban su vacío y nunca se podían revisar visualmente.
-- Esto siembra:
--
--   · hoy y ayer: salas sin iniciar, en preparación, pausadas, listas, en
--     tránsito, contando cajas y con diferencia — una de cada etapa de
--     `getBranchStage` (src/utils/tableroDePedidos.js);
--   · ~18 pedidos completados en los últimos 35 días con sus tiempos
--     (inicio, pausas, fin, salida, primera firma, ingreso), que es lo que
--     leen `get_pedido_kpis` y `get_pausa_razones_stats`;
--   · un pedido anulado;
--   · una ruta EN RUTA hoy y cuatro completadas.
--
-- Todo lleva `[demo]` en `notes` y se borra al volver a correr: es
-- idempotente. Se corre con `execute_sql` sobre el branch de pruebas, NUNCA
-- con `apply_migration` (CLAUDE.md, «En el branch se prueba con execute_sql»).
SET lock_timeout = '5s';

DO $semilla$
DECLARE
  emps      uuid[];
  spec      record;
  ped       uuid;
  n_ped     int;
  base      timestamptz;
  i         int;
  suc       int;
  etapa     text;
  t_ini     timestamptz;
  t_fin     timestamptz;
  t_env     timestamptz;
  t_firma   timestamptz;
  t_erp     timestamptz;
  pausa_min int;
  con_dif   boolean;
  ruta      uuid;
  razones   text[] := ARRAY['almuerzo','insumos','reunion','interrupcion','insumos','almuerzo'];
BEGIN
  -- ── Freno: esto NO corre en producción ─────────────────────────────────────
  IF (SELECT count(*) FROM public.employees) > 30
     OR (SELECT count(*) FROM public.sales_invoices) > 50000 THEN
    RAISE EXCEPTION 'semilla_pedidos_completa: esta base parece PRODUCCIÓN. Abortado.';
  END IF;

  -- Ojo: `reanudado_por`, `rutas.conductor_id/created_by` y
  -- `ruta_pedidos.entregado_por/confirmado_suc_por` apuntan a `auth.users`, no
  -- a `employees`, y de las fichas del branch sólo la cuenta de pruebas tiene
  -- usuario. Por eso esas columnas van en NULL o con `emps[1]`, que es ella.
  SELECT array_agg(id ORDER BY code) INTO emps FROM public.employees;

  -- ── Limpieza de la corrida anterior ───────────────────────────────────────
  DELETE FROM public.ruta_locations   WHERE ruta_id IN (SELECT id FROM public.rutas WHERE notes LIKE '[demo]%');
  DELETE FROM public.ruta_pedidos     WHERE ruta_id IN (SELECT id FROM public.rutas WHERE notes LIKE '[demo]%');
  DELETE FROM public.rutas            WHERE notes LIKE '[demo]%';
  DELETE FROM public.pedido_recepcion_firmas WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo]%');
  DELETE FROM public.pedido_pausa_historial  WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo]%');
  DELETE FROM public.pedido_items            WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo]%');
  DELETE FROM public.pedido_sucursal_status  WHERE pedido_id IN (SELECT id FROM public.pedidos WHERE notes LIKE '[demo]%');
  DELETE FROM public.pedidos                 WHERE notes LIKE '[demo]%';

  PERFORM setseed(0.42);  -- mismos tiempos en cada corrida

  -- ── Los pedidos: días atrás, estado del pedido, y etapa por sala ──────────
  FOR spec IN
    SELECT * FROM (VALUES
      ( 0, 'confirmado', ARRAY[5,1,7],  ARRAY['sin_iniciar','preparando','pausado']),
      ( 0, 'confirmado', ARRAY[2,3],    ARRAY['preparado','preparando']),
      ( 0, 'enviado',    ARRAY[4,5],    ARRAY['transito','transito']),
      ( 1, 'enviado',    ARRAY[1,2],    ARRAY['contando','transito']),
      ( 2, 'parcial',    ARRAY[3,7],    ARRAY['erp_dif','contando']),
      ( 4, 'completado', ARRAY[1,4,5],  ARRAY['erp','erp','erp']),
      ( 6, 'completado', ARRAY[2,3],    ARRAY['erp','erp_dif']),
      ( 8, 'completado', ARRAY[5,7],    ARRAY['erp','erp']),
      (10, 'anulado',    ARRAY[4],      ARRAY['sin_iniciar']),
      (11, 'completado', ARRAY[1,2,3],  ARRAY['erp','erp','erp']),
      (13, 'completado', ARRAY[4,7],    ARRAY['erp','erp']),
      (15, 'completado', ARRAY[5,1],    ARRAY['erp_dif','erp']),
      (17, 'completado', ARRAY[2,4],    ARRAY['erp','erp']),
      (19, 'completado', ARRAY[3,5,7],  ARRAY['erp','erp','erp']),
      (21, 'completado', ARRAY[1,4],    ARRAY['erp','erp']),
      (23, 'completado', ARRAY[2,7],    ARRAY['erp','erp']),
      (25, 'completado', ARRAY[3,5],    ARRAY['erp','erp_dif']),
      (27, 'completado', ARRAY[1,2,4],  ARRAY['erp','erp','erp']),
      (29, 'completado', ARRAY[5,7],    ARRAY['erp','erp']),
      (31, 'completado', ARRAY[3,4],    ARRAY['erp','erp']),
      (33, 'completado', ARRAY[1,5],    ARRAY['erp','erp']),
      (35, 'completado', ARRAY[2,3,7],  ARRAY['erp','erp','erp'])
    ) AS v(dias, status, sucs, etapas)
  LOOP
    ped  := gen_random_uuid();
    -- 8:00 de El Salvador (UTC-6) del día, + algo de ruido para no alinear todo
    base := date_trunc('day', now() AT TIME ZONE 'America/El_Salvador')
              AT TIME ZONE 'America/El_Salvador'
            - make_interval(days => spec.dias) + interval '8 hours'
            + make_interval(mins => (random() * 50)::int);
    -- Lo de hoy no puede nacer en el futuro
    IF base > now() - interval '4 hours' THEN base := now() - interval '4 hours'; END IF;

    INSERT INTO public.pedidos (id, created_at, created_by, status, sucursal_ids,
                                responsable_id, revisado_por, notes,
                                anulado_por, anulado_at, motivo_anulacion)
    VALUES (ped, base, emps[1], spec.status, spec.sucs,
            emps[2 + (spec.dias % 5)], emps[1],
            '[demo] Pedido de muestra',
            CASE WHEN spec.status = 'anulado' THEN emps[1] END,
            CASE WHEN spec.status = 'anulado' THEN base + interval '40 minutes' END,
            CASE WHEN spec.status = 'anulado' THEN 'Se generó dos veces por error.' END)
    RETURNING numero INTO n_ped;

    t_env := NULL;

    FOR i IN 1 .. array_length(spec.sucs, 1) LOOP
      suc   := spec.sucs[i];
      etapa := spec.etapas[i];
      con_dif := etapa = 'erp_dif';

      t_ini   := base + make_interval(mins => 10 + (random() * 50)::int);
      pausa_min := 0;
      t_fin   := t_ini + make_interval(mins => 45 + (random() * 140)::int);

      -- ── Pausas (historial): ~la mitad de las salas tiene una o dos ─────────
      IF etapa = 'pausado' THEN
        INSERT INTO public.pedido_pausa_historial (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES (ped, suc, now() - interval '25 minutes', 'almuerzo', emps[3]);
      ELSIF etapa NOT IN ('sin_iniciar') AND random() < 0.55 THEN
        pausa_min := 5 + (random() * 40)::int;
        INSERT INTO public.pedido_pausa_historial (pedido_id, erp_sucursal_id, pausado_at, reanudado_at, razon, pausado_por, reanudado_por)
        VALUES (ped, suc, t_ini + interval '20 minutes',
                t_ini + interval '20 minutes' + make_interval(mins => pausa_min),
                razones[1 + (random() * 5)::int], emps[3], NULL);
        t_fin := t_fin + make_interval(mins => pausa_min);
        IF random() < 0.3 THEN
          INSERT INTO public.pedido_pausa_historial (pedido_id, erp_sucursal_id, pausado_at, reanudado_at, razon, pausado_por, reanudado_por)
          VALUES (ped, suc, t_fin - interval '30 minutes', t_fin - interval '18 minutes', 'interrupcion', emps[4], NULL);
        END IF;
      END IF;

      -- Lo de hoy en preparación no puede haber terminado
      -- Lo de hoy que ya terminó, terminó antes de salir (la ruta sale hace 50 min)
      IF t_fin > now() - interval '75 minutes' THEN
        t_fin := now() - interval '75 minutes';
        IF t_ini > t_fin - interval '40 minutes' THEN t_ini := t_fin - interval '90 minutes'; END IF;
      END IF;
      IF etapa IN ('preparando','pausado') THEN t_fin := NULL; END IF;
      IF etapa = 'sin_iniciar' THEN t_ini := NULL; t_fin := NULL; END IF;

      IF etapa IN ('transito','contando','erp','erp_dif') THEN
        t_env := coalesce(t_env, t_fin + make_interval(mins => 20 + (random() * 60)::int));
        IF t_env < t_fin THEN t_env := t_fin + interval '15 minutes'; END IF;
        IF t_env > now() - interval '50 minutes' THEN t_env := now() - interval '50 minutes'; END IF;
      END IF;
      t_firma := CASE WHEN etapa IN ('contando','erp','erp_dif')
                      THEN t_env + make_interval(mins => 30 + (random() * 120)::int) END;
      t_erp   := CASE WHEN etapa IN ('erp','erp_dif')
                      THEN t_firma + make_interval(mins => 20 + (random() * 90)::int) END;
      -- Nada en el futuro
      IF t_firma > now() THEN t_firma := now() - interval '20 minutes'; END IF;
      IF t_erp   > now() THEN t_erp   := now() - interval '5 minutes';  END IF;

      INSERT INTO public.pedido_sucursal_status (
        pedido_id, erp_sucursal_id, codigo, total_cajas, caja_map,
        cajas_especiales, cajas_electrolit,
        iniciado_at, iniciado_por, finalizado_at, finalizado_por,
        pausado_at, pausa_razon,
        llegada_fisica_at, llegada_fisica_por, llegada_tipo,
        recibido_erp_at, recibido_erp_por,
        diferencias_reportadas_at, diferencias_reportadas_por)
      SELECT ped, suc,
             lpad(n_ped::text, 2, '0') || '-' || to_char(base, 'DDMMYY') || '-' || i || '-' || m.codigo,
             CASE WHEN t_fin IS NOT NULL THEN 2 + (random() * 6)::int END,
             CASE WHEN t_fin IS NOT NULL THEN '{"1":[1],"2":[2]}'::jsonb END,
             '[]'::jsonb, 0,
             t_ini, CASE WHEN t_ini IS NOT NULL THEN emps[3 + (i % 4)] END,
             t_fin, CASE WHEN t_fin IS NOT NULL THEN emps[3 + (i % 4)] END,
             CASE WHEN etapa = 'pausado' THEN now() - interval '25 minutes' END,
             CASE WHEN etapa = 'pausado' THEN 'almuerzo' END,
             t_firma, CASE WHEN t_firma IS NOT NULL THEN emps[8 + (i % 4)] END,
             CASE WHEN t_firma IS NOT NULL THEN 'completa' END,
             t_erp, CASE WHEN t_erp IS NOT NULL THEN emps[8 + (i % 4)] END,
             CASE WHEN con_dif THEN t_erp - interval '10 minutes' END,
             CASE WHEN con_dif THEN emps[8 + (i % 4)] END
        FROM public.erp_sucursal_map m WHERE m.erp_sucursal_id = suc;

      IF t_firma IS NOT NULL THEN
        INSERT INTO public.pedido_recepcion_firmas (pedido_id, erp_sucursal_id, employee_id, added_by, created_at)
        VALUES (ped, suc, emps[8 + (i % 4)], emps[8 + (i % 4)], t_firma);
      END IF;

      -- ── Renglones: 8–16 productos con MIN·MAX en esa sala ──────────────────
      INSERT INTO public.pedido_items (
        pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
        cantidad_asignada, cantidad_enviada, cantidad_recibida, status,
        factor, dispatch_tipo, dispatch_factor, dispatch_multiplo,
        stock_packs_snapshot, min_qty_snapshot, max_qty_snapshot, urgencia_pct_snapshot,
        enviado_at, enviado_por, received_at, received_by, nota_diferencia)
      SELECT ped, suc, p.erp_product_id, 9,
             p.asig,
             CASE WHEN t_env IS NOT NULL THEN p.asig END,
             CASE WHEN t_erp IS NOT NULL OR (etapa = 'contando' AND p.rn <= 4)
                  THEN p.asig - CASE WHEN con_dif AND p.rn IN (2, 5) THEN 1 ELSE 0 END END,
             CASE WHEN spec.status = 'anulado' THEN 'anulado'
                  WHEN con_dif AND p.rn IN (2, 5) THEN 'con_diferencia'
                  WHEN t_erp IS NOT NULL OR (etapa = 'contando' AND p.rn <= 4) THEN 'recibido'
                  ELSE 'pendiente' END,
             1, 'CAJA', 1, 1,
             p.stock, p.min_u, p.max_u,
             least(100, round(100.0 * p.asig / greatest(p.max_u, 1)))::int,
             CASE WHEN t_env IS NOT NULL THEN t_env END,
             CASE WHEN t_env IS NOT NULL THEN emps[2] END,
             CASE WHEN t_erp IS NOT NULL OR (etapa = 'contando' AND p.rn <= 4) THEN coalesce(t_erp, t_firma) END,
             CASE WHEN t_erp IS NOT NULL OR (etapa = 'contando' AND p.rn <= 4) THEN emps[8 + (i % 4)] END,
             CASE WHEN con_dif AND p.rn IN (2, 5) THEN 'Llegó una unidad menos.' END
        FROM (SELECT psp.erp_product_id,
                     greatest(coalesce(psp.min_units, 1), 1)              AS min_u,
                     greatest(coalesce(psp.max_units, 4), 2)              AS max_u,
                     (random() * coalesce(psp.min_units, 1))::numeric     AS stock,
                     1 + (random() * greatest(coalesce(psp.max_units, 4) - 1, 1))::int AS asig,
                     row_number() OVER (ORDER BY random())                AS rn
                FROM public.product_stock_params psp
               WHERE psp.erp_sucursal_id = suc AND coalesce(psp.max_units, 0) > 0) p
       WHERE p.rn <= 8 + (random() * 8)::int;
    END LOOP;

    UPDATE public.pedidos
       SET enviado_at = t_env, enviado_por = CASE WHEN t_env IS NOT NULL THEN emps[2] END
     WHERE id = ped;

    -- ── Rutas: la de ayer sigue EN RUTA; algunas viejas completadas ─────────
    IF spec.dias = 0 AND spec.sucs = ARRAY[4,5] THEN
      ruta := gen_random_uuid();
      INSERT INTO public.rutas (id, conductor_id, conductor_nombre, salida_at, status,
                                distancia_total_m, duracion_estimada_min, notes, created_by, created_at)
      VALUES (ruta, NULL, (SELECT name FROM public.employees WHERE id = emps[12]),
              now() - interval '50 minutes', 'en_ruta', 41200, 95,
              '[demo] Ruta de muestra', emps[1], now() - interval '70 minutes');
      INSERT INTO public.ruta_pedidos (ruta_id, pedido_id, erp_sucursal_id, orden_entrega,
                                       distancia_desde_anterior_m, duracion_desde_anterior_min, entregado_at, entregado_por)
      VALUES (ruta, ped, 5, 1, 18300, 34, now() - interval '12 minutes', emps[1]),
             (ruta, ped, 4, 2, 22900, 41, NULL, NULL);
      INSERT INTO public.ruta_locations (ruta_id, lat, lng, updated_at)
      VALUES (ruta, 14.0389, -88.9372, now() - interval '1 minute');
      -- Que el pedido quede «salido» a la misma hora que la ruta
      UPDATE public.pedidos SET enviado_at = now() - interval '50 minutes' WHERE id = ped;
    ELSIF spec.status = 'completado' AND spec.dias IN (4, 11, 19, 27) THEN
      ruta := gen_random_uuid();
      INSERT INTO public.rutas (id, conductor_id, conductor_nombre, salida_at, vuelta_base_at, status,
                                distancia_total_m, duracion_estimada_min, notes, created_by, created_at)
      VALUES (ruta, NULL, (SELECT name FROM public.employees WHERE id = emps[12]),
              t_env, t_env + interval '3 hours', 'completada',
              30000 + (random() * 40000)::int, 80 + (random() * 60)::int,
              '[demo] Ruta de muestra', emps[1], t_env - interval '20 minutes');
      INSERT INTO public.ruta_pedidos (ruta_id, pedido_id, erp_sucursal_id, orden_entrega,
                                       distancia_desde_anterior_m, duracion_desde_anterior_min,
                                       entregado_at, entregado_por, confirmado_suc_at, confirmado_suc_por)
      SELECT ruta, ped, s.suc, s.ord, 9000 + (random() * 20000)::int, 20 + (random() * 30)::int,
             t_env + make_interval(mins => (30 * s.ord)::int), emps[1],
             t_env + make_interval(mins => (30 * s.ord + 10)::int), emps[1]
        FROM unnest(spec.sucs) WITH ORDINALITY AS s(suc, ord);
    END IF;
  END LOOP;
END
$semilla$;

-- Lo que quedó, por etapa
SELECT p.numero, p.status, p.created_at::date AS dia, s.erp_sucursal_id AS sala,
       (SELECT count(*) FROM public.pedido_items pi WHERE pi.pedido_id = p.id AND pi.erp_sucursal_id = s.erp_sucursal_id) AS renglones,
       s.iniciado_at IS NOT NULL AS ini, s.finalizado_at IS NOT NULL AS fin,
       s.llegada_fisica_at IS NOT NULL AS llego, s.recibido_erp_at IS NOT NULL AS ingresado
  FROM public.pedidos p
  JOIN public.pedido_sucursal_status s ON s.pedido_id = p.id
 WHERE p.notes LIKE '[demo]%'
 ORDER BY p.created_at DESC, s.erp_sucursal_id
 LIMIT 15;
