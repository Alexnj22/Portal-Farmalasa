-- Reservas v2 · 02 — la oferta que termina (cláusula 3.5).
--
-- QUÉ CAMBIA (sólo desde `reglas_v2_desde()`; antes, `reservas_vencer` es la de hoy):
--   · Reserva LISTA y SIN NINGÚN PAGO cuya oferta terminó: ya no se queda con
--     el precio de oferta (antes no se tocaba) ni vence: pasa a precio normal
--     (`precio_unitario := precio_normal`) y el cliente recibe un aviso en la
--     app (`base:oferta_fin:<pedido|id>`, lo manda `avisos-clientes` en su modo
--     «pendientes»). Reglamento: «el precio de oferta vale si la reserva se
--     retira dentro de las fechas de la oferta».
--   · Reserva que todavía NO estaba lista cuando terminó la oferta: vence como
--     hoy, pero sólo si no tiene ningún pago. Con anticipo el precio quedó fijo
--     («Con un anticipo o el pago total, el precio queda fijo»); hoy vencía
--     cualquier una no pagada del todo, también con anticipo.
--
-- Partida: `pg_get_functiondef` de producción del 2026-10-24 (idéntica en el
-- branch de pruebas, md5 comparado). Sólo se agregan el bloque v2 y la rama
-- del WHERE; el resto, literal.
--
-- CÓMO SE VERIFICÓ: branch de pruebas, `execute_sql`, casos fabricados con la
-- fecha antes y después dentro de una transacción que se deshace sola.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
  t record;
  v_dest uuid[];
  v_v2 boolean := public.reservas_v2_rige();
  o record;
  v_ofertas json;
BEGIN
  -- Reglamento v2, cláusula 3.5 (desde `reglas_v2_desde()`): sin pago, el
  -- precio de oferta vale si se retira dentro de las fechas de la oferta. Una
  -- reserva YA LISTA y sin ningún pago cuya oferta terminó no vence: sigue, a
  -- precio normal, y se le avisa al cliente. (La que todavía no estaba lista
  -- vence abajo, como antes.) Con anticipo o pagada, el precio queda fijo.
  IF v_v2 THEN
    WITH c AS (
        UPDATE public.app_reservas r
           SET precio_unitario = r.precio_normal, updated_at = now()
         WHERE r.estado = 'lista' AND r.pago_estado = 'pendiente' AND coalesce(r.anticipo, 0) <= 0.004
           AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy
           AND r.precio_normal IS NOT NULL AND r.precio_unitario IS DISTINCT FROM r.precio_normal
           AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
        RETURNING r.id, r.customer_id, r.origen, r.pedido, r.branch_id, r.producto_nombre, r.cantidad, r.precio_normal),
    g AS (
      SELECT c.customer_id, c.origen, coalesce(c.pedido, c.id::text) AS grupo, min(c.branch_id) AS branch_id,
             coalesce(c.pedido, 'R-' || lpad(min(c.id)::text, 6, '0')) AS codigo, min(c.id) AS id,
             count(*) AS productos, min(c.producto_nombre) AS producto,
             round(sum(c.precio_normal * c.cantidad), 2) AS total
        FROM c GROUP BY c.customer_id, c.origen, coalesce(c.pedido, c.id::text), c.pedido)
    SELECT coalesce(json_agg(g), '[]'::json) INTO v_ofertas FROM g;
    FOR o IN SELECT * FROM json_to_recordset(v_ofertas)
               AS x(customer_id bigint, origen text, grupo text, branch_id bigint, codigo text, id bigint, productos integer, producto text, total numeric)
    LOOP
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (o.customer_id, 'reserva', 'base:oferta_fin:' || o.grupo, 'La oferta de tu reserva terminó',
              'Tu reserva ' || o.codigo || ' sigue apartada, ahora a precio normal: $' || to_char(o.total, 'FM999990.00')
                || '. Si ya no la quieres, puedes cancelarla desde la app.',
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
      INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
      VALUES ('RESERVA_OFERTA_TERMINADA_PRECIO_NORMAL', o.id::text,
              jsonb_build_object('codigo', o.codigo, 'total', o.total, 'productos', o.productos), o.branch_id, 'SYSTEM');
    END LOOP;
  END IF;

  WITH v AS (
    UPDATE public.app_reservas r
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN r.estado = 'en_revision' AND r.receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN r.estado = 'en_revision' THEN 'sin_receta'
             WHEN r.estado = 'lista' THEN 'sin_retirar'
             WHEN r.origen = 'app' AND public.reserva_plazo_hasta(r) < now() THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN r.anticipo ELSE r.saldo_favor END,
           saldo_favor_vence = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN v_hoy + public.saldo_favor_dias() ELSE r.saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN r.anticipo > 0 AND NOT (r.pago_metodo = 'en_linea' AND r.pago_estado = 'pagado') AND r.saldo_favor IS NULL AND NOT coalesce(r.pago_prueba, false) THEN 'anticipo' ELSE r.saldo_favor_origen END
     WHERE ((r.estado = 'en_revision' AND public.reserva_plazo_hasta(r) < now())
            OR (r.estado = 'pendiente' AND r.origen = 'app' AND public.reserva_plazo_hasta(r) < now())
            -- La oferta terminó antes de que estuviera lista. v2 (cl. 3.5): sólo
            -- la que no tiene NINGÚN pago; con anticipo el precio quedó fijo.
            OR (r.estado = 'pendiente' AND r.oferta_fin IS NOT NULL AND r.oferta_fin < v_hoy
                AND CASE WHEN v_v2 THEN r.pago_estado = 'pendiente' AND coalesce(r.anticipo, 0) <= 0.004
                         ELSE r.pago_estado <> 'pagado' END)
            -- Vence cuando TERMINA el día de `vence_at` en El Salvador, no a su hora.
            OR (r.estado = 'lista' AND (r.vence_at AT TIME ZONE 'America/El_Salvador')::date < v_hoy))
       AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.reserva_id = r.id)
    RETURNING r.id)
  SELECT array_agg(id) INTO v_ids FROM v;
  IF v_ids IS NULL THEN RETURN 0; END IF;

  -- Un aviso por pedido (o reserva suelta) de la app.
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  SELECT g.customer_id, 'reserva', 'base:vencida:' || g.grupo,
         CASE g.motivo WHEN 'sin_receta' THEN 'Tu reserva venció sin la foto de la receta'
                       WHEN 'receta_sin_revisar' THEN 'Tu reserva venció'
                       WHEN 'sin_preparar' THEN 'Tu reserva venció'
                       WHEN 'oferta_terminada' THEN 'Tu reserva venció'
                       ELSE 'Tu reserva venció sin retirar' END,
         CASE g.motivo WHEN 'sin_receta' THEN 'No recibimos la foto de tu receta a tiempo. Puedes volver a reservar cuando quieras.'
                       WHEN 'receta_sin_revisar' THEN 'La sucursal no alcanzó a revisar tu receta a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'sin_preparar' THEN 'La sucursal no alcanzó a preparar tu pedido a tiempo. Disculpa: puedes volver a reservar y no cuenta en tu contra.'
                       WHEN 'oferta_terminada' THEN 'La oferta terminó antes de que se preparara.'
                       ELSE 'Se cumplió el plazo para retirarla.' END
           || CASE WHEN g.saldo > 0 THEN ' Te quedaron $' || to_char(g.saldo, 'FM999990.00') || ' a favor para otra compra en cualquier sucursal.' ELSE '' END,
         '/reservas'
    FROM (SELECT customer_id, coalesce(pedido, id::text) AS grupo, min(vencida_motivo) AS motivo,
                 coalesce(sum(saldo_favor), 0) AS saldo
            FROM public.app_reservas
           WHERE id = ANY (v_ids) AND origen = 'app'
           GROUP BY 1, 2) g
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;

  -- La sala no alcanzó a preparar o a revisar la receta (reglamento v4,
  -- 3.8): se les avisa a supervisión de ventas y a la jefatura de esa sala.
  FOR t IN
    SELECT r.branch_id, r.vencida_motivo, coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')) AS codigo,
           string_agg(DISTINCT r.producto_nombre, ', ') AS productos, min(r.id) AS id
      FROM public.app_reservas r
     WHERE r.id = ANY (v_ids) AND r.vencida_motivo IN ('sin_preparar', 'receta_sin_revisar')
     GROUP BY 1, 2, 3
  LOOP
    SELECT array_agg(DISTINCT e.id) INTO v_dest
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (13 IN (e.role_id, e.secondary_role_id)
            OR (19 IN (e.role_id, e.secondary_role_id) AND e.branch_id = t.branch_id));
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        CASE t.vencida_motivo WHEN 'sin_preparar' THEN 'Reserva vencida sin preparar' ELSE 'Receta vencida sin revisar' END,
        format('%s (%s, %s) venció porque la sala no %s a tiempo. Al cliente no le cuenta en contra.',
               t.codigo, t.productos, (SELECT b.name FROM public.branches b WHERE b.id = t.branch_id),
               CASE t.vencida_motivo WHEN 'sin_preparar' THEN 'la preparó' ELSE 'revisó la receta' END),
        '/reservas', jsonb_build_object('check_key', 'reserva_sala_tarde:' || t.id, 'reserva_id', t.id),
        true, t.branch_id::integer);
    END IF;
  END LOOP;

  RETURN array_length(v_ids, 1);
END;
$function$
;
