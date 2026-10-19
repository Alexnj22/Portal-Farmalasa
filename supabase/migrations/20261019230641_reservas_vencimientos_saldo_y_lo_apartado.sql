SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Reservas de la app: receta, vencimientos, lo apartado y el saldo a favor
-- (2026-10-19, decisiones del dueño tras la auditoría). Cada función parte de
-- su definición VIVA en producción (pg_get_functiondef del mismo día).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 5. Lo apartado ────────────────────────────────────────────────────────
-- Disponible = existencia − unidades en reservas abiertas de esa sala y
-- producto (en revisión, pendientes y listas). `inventory` no se toca: se
-- resta al leer. La existencia se cuenta en UNIDADES, con la misma cuenta que
-- usaba `unidadesPorSala` de la app (una fila por presentación y lote, pasada a
-- unidades con `v_product_factor`; sin factor conocido, el «x N» del detalle,
-- y si no, 1; deduplicada con la clave de `inv_dedup`). Así la existencia y lo
-- apartado están en la misma unidad, y la app y la base dicen lo mismo.
-- `plpgsql` a propósito (CLAUDE.md, trampa 4): con `LANGUAGE sql` + SET nacería
-- con plan genérico.
CREATE OR REPLACE FUNCTION public.app_existencias_netas(p_ids integer[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN (
    WITH inv AS (
      SELECT DISTINCT ON (i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento,
                          lower(btrim(coalesce(i.presentacion, ''))), lower(coalesce(i.detalle, '')))
             m.branch_id, i.erp_product_id AS product_id, i.cantidad,
             upper(btrim(coalesce(i.presentacion, ''))) AS pres_key, i.detalle
        FROM public.inventory i
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND NOT m.es_bodega
       WHERE i.erp_product_id = ANY (p_ids) AND NOT coalesce(i.is_vencidos, false)
    ),
    existencia AS (
      SELECT inv.product_id, inv.branch_id,
             sum(inv.cantidad * coalesce(f.factor, nullif(substring(lower(coalesce(inv.detalle, '')) FROM 'x\s*(\d+)'), '')::int, 1)) AS unidades
        FROM inv
        LEFT JOIN public.v_product_factor f ON f.product_id = inv.product_id AND f.pres_key = inv.pres_key
       WHERE inv.cantidad > 0
       GROUP BY 1, 2
    ),
    apartado AS (
      SELECT r.producto_id::int AS product_id, r.branch_id, sum(r.cantidad * r.factor) AS unidades
        FROM public.app_reservas r
       WHERE r.estado IN ('en_revision', 'pendiente', 'lista') AND r.producto_id = ANY (p_ids::bigint[])
       GROUP BY 1, 2
    )
    SELECT coalesce(json_agg(json_build_object(
             'product_id', coalesce(e.product_id, a.product_id), 'branch_id', coalesce(e.branch_id, a.branch_id),
             'existencia', coalesce(e.unidades, 0), 'apartadas', coalesce(a.unidades, 0),
             'disponibles', greatest(0, coalesce(e.unidades, 0) - coalesce(a.unidades, 0)))), '[]'::json)
      FROM existencia e
      FULL JOIN apartado a ON a.product_id = e.product_id AND a.branch_id = e.branch_id
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_existencias_netas(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_existencias_netas(integer[]) TO service_role;

-- «¿Dónde lo hay?» de un producto: el nivel sale de lo DISPONIBLE, contado en
-- la presentación menor con precio (la que se reserva en una oferta).
CREATE OR REPLACE FUNCTION public.app_cliente_existencias(p_producto_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object(
           'branch_id', b.id, 'sala', b.name,
           'nivel', CASE WHEN coalesce(s.cant, 0) >= 5 THEN 'hay' WHEN coalesce(s.cant, 0) > 0 THEN 'pocas' ELSE 'sin' END)
         ORDER BY coalesce(s.cant, 0) > 0 DESC, b.name), '[]'::json)
    FROM public.branches b
    LEFT JOIN (SELECT (x ->> 'branch_id')::bigint AS branch_id,
                      floor((x ->> 'disponibles')::numeric / greatest(1, coalesce(
                        (SELECT min(pp.factor) FROM public.product_precios pp
                          WHERE pp.product_id = p_producto_id AND pp.activo AND pp.vineta > 0), 1))) AS cant
                 FROM json_array_elements(public.app_existencias_netas(ARRAY[p_producto_id::int])) x) s ON s.branch_id = b.id
   WHERE b.type = 'FARMACIA';
$function$;

-- El carrito: dónde hay de cada producto, en unidades DISPONIBLES.
CREATE OR REPLACE FUNCTION public.app_carrito_existencias(p_ids integer[])
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(json_build_object('product_id', (x ->> 'product_id')::int, 'branch_id', (x ->> 'branch_id')::bigint,
                                             'cantidad', (x ->> 'disponibles')::numeric)), '[]'::json)
    FROM json_array_elements(public.app_existencias_netas(p_ids)) x
    JOIN public.branches b ON b.id = (x ->> 'branch_id')::bigint AND b.type = 'FARMACIA'
   WHERE (x ->> 'disponibles')::numeric > 0;
$function$;

-- ── 3 y 7. Decidir la receta ──────────────────────────────────────────────
-- Exige `recetas_app` (su sala, o todas con alcance ALL). Al RECHAZAR, en un
-- pedido mixto se cancelan SÓLO los renglones bajo receta; lo demás sigue
-- (pasa a «pendiente») y el cliente puede pagarlo o retirarlo. Si el pedido
-- era todo bajo receta, se cancela entero, como antes.
CREATE OR REPLACE FUNCTION public.reserva_receta_decidir(p_id bigint, p_decision text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_codigo text;
  v_ids bigint[];
  v_productos text;
  v_con_receta text;
  v_siguen integer;
BEGIN
  IF p_decision NOT IN ('aprobada', 'otra_foto', 'rechazada') THEN RAISE EXCEPTION 'DECISION_INVALIDA'; END IF;
  IF p_decision <> 'aprobada' AND v_motivo IS NULL THEN RAISE EXCEPTION 'FALTA_MOTIVO'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.receta_app_puede_aprobar(r.branch_id) THEN
    RAISE EXCEPTION 'No tienes permiso para revisar recetas de esta sucursal.' USING ERRCODE = '42501';
  END IF;
  IF r.estado <> 'en_revision' OR r.receta_estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'YA_DECIDIDA';
  END IF;
  SELECT array_agg(id ORDER BY id), string_agg(producto_nombre, ', ' ORDER BY id),
         string_agg(producto_nombre, ', ' ORDER BY id) FILTER (WHERE bajo_receta),
         count(*) FILTER (WHERE NOT bajo_receta)
    INTO v_ids, v_productos, v_con_receta, v_siguen
    FROM public.app_reservas
   WHERE (CASE WHEN r.pedido IS NULL THEN id = r.id ELSE pedido = r.pedido END)
     AND customer_id = r.customer_id AND estado = 'en_revision';
  v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));

  IF p_decision = 'rechazada' THEN
    -- Los renglones bajo receta se cancelan con el motivo…
    UPDATE public.app_reservas
       SET receta_estado = 'rechazada', receta_motivo = v_motivo,
           receta_revisada_por = v_emp, receta_revisada_at = now(), updated_at = now(),
           estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp
     WHERE id = ANY (v_ids) AND (bajo_receta OR v_siguen = 0);
    -- …y lo demás del pedido sigue sin la receta.
    UPDATE public.app_reservas
       SET receta_estado = NULL, receta_motivo = NULL, estado = 'pendiente', updated_at = now()
     WHERE id = ANY (v_ids) AND NOT bajo_receta AND v_siguen > 0;
  ELSE
    UPDATE public.app_reservas
       SET receta_estado = p_decision, receta_motivo = v_motivo,
           receta_revisada_por = v_emp, receta_revisada_at = now(), updated_at = now(),
           estado = CASE p_decision WHEN 'aprobada' THEN 'pendiente' ELSE estado END
     WHERE id = ANY (v_ids);
  END IF;

  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (r.customer_id, 'receta', 'receta:' || v_codigo || ':' || p_decision || ':' || r.receta_fotos,
          CASE p_decision WHEN 'aprobada' THEN 'Tu receta fue aprobada'
                          WHEN 'otra_foto' THEN 'Necesitamos otra foto de tu receta'
                          WHEN 'rechazada' THEN CASE WHEN v_siguen > 0 THEN 'No pudimos aprobar tu receta' ELSE 'Tu reserva no se pudo confirmar' END END,
          CASE p_decision WHEN 'aprobada' THEN 'Tu reserva ' || v_codigo || ' (' || left(v_productos, 120) || ') ya está confirmada.'
                          WHEN 'otra_foto' THEN v_motivo || '. Sube otra foto o quita ese producto y sigue con lo demás, desde Mis reservas.'
                          ELSE CASE WHEN v_siguen > 0
                                    THEN v_motivo || '. Quitamos ' || left(v_con_receta, 120) || ' de tu pedido ' || v_codigo || '; lo demás sigue.'
                                    ELSE v_motivo || '.' END END,
          '/reservas')
  ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, 'RECETA_' || upper(p_decision), p_id::text,
          jsonb_build_object('motivo', v_motivo, 'pedido', r.pedido, 'renglones', v_ids, 'siguen_sin_receta', v_siguen), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id, 'decision', p_decision, 'renglones', v_ids, 'siguen', v_siguen);
END;
$function$;

-- ── 7. El cliente quita lo bajo receta y sigue con lo demás ───────────────
-- Lo llama `app-clientes` (acción `quitar_receta`) con la ficha de la sesión.
-- Sólo mientras el pedido espera la receta. Si no queda nada sin receta, es
-- cancelarlo entero.
CREATE OR REPLACE FUNCTION public.app_reserva_quitar_receta(p_customer_id bigint, p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_quitados integer; v_siguen integer;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id AND customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR r.estado <> 'en_revision' THEN
    RETURN json_build_object('ok', false, 'mensaje', 'Este pedido ya no espera la receta.');
  END IF;
  WITH q AS (
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), updated_at = now(),
           receta_motivo = coalesce(receta_motivo, 'Lo quitaste del pedido')
     WHERE (CASE WHEN r.pedido IS NULL THEN id = r.id ELSE pedido = r.pedido END)
       AND customer_id = p_customer_id AND estado = 'en_revision' AND bajo_receta
    RETURNING 1)
  SELECT count(*) INTO v_quitados FROM q;
  WITH s AS (
    UPDATE public.app_reservas SET estado = 'pendiente', receta_estado = NULL, receta_motivo = NULL, updated_at = now()
     WHERE r.pedido IS NOT NULL AND pedido = r.pedido AND customer_id = p_customer_id
       AND estado = 'en_revision' AND NOT bajo_receta
    RETURNING 1)
  SELECT count(*) INTO v_siguen FROM s;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
  VALUES ('RESERVA_RECETA_QUITADA_POR_CLIENTE', p_id::text,
          jsonb_build_object('pedido', r.pedido, 'quitados', v_quitados, 'siguen', v_siguen), r.branch_id, 'SYSTEM');
  RETURN json_build_object('ok', true, 'quitados', v_quitados, 'siguen', v_siguen);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_reserva_quitar_receta(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_reserva_quitar_receta(bigint, bigint) TO service_role;

-- ── Mover una reserva desde la sala ───────────────────────────────────────
-- Igual que antes, más: sin receta aprobada no se aparta (lo frena también el
-- trigger, acá con un mensaje claro); cancelar algo pagado en línea lo deja a
-- favor (trigger) y se le avisa al cliente.
CREATE OR REPLACE FUNCTION public.reserva_cambiar_estado(p_id bigint, p_estado text, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_emp uuid := public.auth_employee_id();
  v_horas integer;
  v_saldo numeric;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado IN ('lista', 'retirada') AND r.origen = 'app' AND r.bajo_receta AND r.receta_estado IS DISTINCT FROM 'aprobada' THEN
    RAISE EXCEPTION 'La receta de esta reserva todavía no está aprobada.' USING ERRCODE = 'P0001';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    v_horas := CASE WHEN r.pago_estado = 'pagado' THEN 7 * 24
                    ELSE coalesce((public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id,
                           (now() AT TIME ZONE 'America/El_Salvador')::date))).horas_reserva, 24) END;
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => v_horas),
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('pendiente', 'lista') THEN
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now()
     WHERE id = p_id
    RETURNING saldo_favor INTO v_saldo;
    IF r.origen = 'app' THEN
      INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
      VALUES (r.customer_id, 'reserva', 'base:cancelada:' || r.id,
              'La sucursal canceló tu reserva',
              r.producto_nombre || coalesce(' · ' || nullif(btrim(p_motivo), ''), '')
                || CASE WHEN coalesce(v_saldo, 0) > 0 THEN '. Lo que pagaste quedó a tu favor para otra compra en cualquier sucursal.' ELSE '.' END,
              '/reservas')
      ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
    END IF;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo, 'saldo_favor', v_saldo), r.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado, 'saldo_favor', v_saldo);
END;
$function$;

-- ── 4. Los vencimientos ───────────────────────────────────────────────────
--   · en revisión SIN foto (o con «otra foto» pedida) → 24 h desde que se
--     reservó o desde que se pidió la otra foto;
--   · con foto sin revisar → 48 h desde que se subió (el aviso a supervisión
--     de las 4 h sigue en `recetas_escalar`);
--   · pendiente de la app (aprobada o sin receta) → 48 h para prepararla;
--   · pendiente sin pagar de una oferta que terminó → vence (como antes);
--   · lista → su plazo (`vence_at`). Una lista PAGADA ya no vuelve a
--     pendiente: vence y lo pagado queda a favor (trigger `app_reservas_guardas`).
-- El anticipo cobrado EN LA SALA (no en línea) queda a favor 30 días, como antes
-- — ahora también si se pagó completo. Al vencer, lo apartado se libera solo:
-- `app_existencias_netas` sólo cuenta las abiertas. A cada cliente, un aviso
-- por pedido o reserva.
CREATE OR REPLACE FUNCTION public.reservas_vencer()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids bigint[];
BEGIN
  WITH v AS (
    UPDATE public.app_reservas
       SET estado = 'vencida', cerrada_at = now(), updated_at = now(),
           vencida_motivo = CASE
             WHEN estado = 'en_revision' AND receta_estado = 'pendiente' THEN 'receta_sin_revisar'
             WHEN estado = 'en_revision' THEN 'sin_receta'
             WHEN estado = 'lista' THEN 'sin_retirar'
             WHEN origen = 'app' AND coalesce(pendiente_at, created_at) < now() - interval '48 hours' THEN 'sin_preparar'
             ELSE 'oferta_terminada' END,
           saldo_favor = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN anticipo ELSE saldo_favor END,
           saldo_favor_vence = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN v_hoy + 30 ELSE saldo_favor_vence END,
           saldo_favor_origen = CASE WHEN anticipo > 0 AND pago_metodo <> 'en_linea' AND saldo_favor IS NULL THEN 'anticipo' ELSE saldo_favor_origen END
     WHERE (estado = 'en_revision' AND coalesce(receta_estado, 'otra_foto') = 'otra_foto'
            AND greatest(created_at, coalesce(receta_revisada_at, created_at)) < now() - interval '24 hours')
        OR (estado = 'en_revision' AND receta_estado = 'pendiente' AND receta_subida_at < now() - interval '48 hours')
        OR (estado = 'pendiente' AND origen = 'app' AND coalesce(pendiente_at, created_at) < now() - interval '48 hours')
        OR (estado = 'pendiente' AND pago_estado <> 'pagado' AND oferta_fin IS NOT NULL AND oferta_fin < v_hoy)
        OR (estado = 'lista' AND vence_at < now())
    RETURNING id)
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

  RETURN array_length(v_ids, 1);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reservas_vencer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservas_vencer() TO service_role;

-- ── 6 y 9. El pago que llega ──────────────────────────────────────────────
-- Antes, un pago que llegaba a una reserva cancelada o vencida la REVIVÍA
-- (volvía a «pendiente»). Ahora nunca: el renglón cerrado se marca pagado y el
-- trigger lo deja a favor. Los renglones que ya estaban cerrados ANTES de crear
-- el cobro no entraron en su monto y no se tocan (desde hoy el cobro guarda
-- cuáles cubre: `reservas_ids`). Lo que sobre del monto (un segundo cobro sobre
-- algo ya pagado) queda a favor o, si no hay dónde, se avisa a supervisión. Un
-- cobro de PRUEBA (`es_real = false`) se anota como tal: la sala lo cobra en caja.
CREATE OR REPLACE FUNCTION public.app_reserva_pago_confirmar(p_identificador text, p_id_transaccion text, p_monto numeric, p_es_real boolean, p_codigo text, p_forma text, p_detalle jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p public.app_reservas_pagos;
  r public.app_reservas;
  v_ids bigint[];
  v_cubiertos bigint[] := '{}';
  v_aplicado numeric := 0;
  v_saldo numeric := 0;
  v_envio numeric := 0;
  v_resto numeric;
  v_destino bigint;
  v_dest uuid[];
BEGIN
  SELECT * INTO p FROM public.app_reservas_pagos WHERE identificador = p_identificador FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'motivo', 'sin_pago'); END IF;
  IF p.estado = 'aprobado' THEN
    RETURN json_build_object('ok', true, 'ya', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido, 'encargo_id', p.encargo_id);
  END IF;
  IF EXISTS (SELECT 1 FROM public.app_reservas_pagos WHERE id_transaccion = p_id_transaccion AND id <> p.id) THEN
    RETURN json_build_object('ok', false, 'motivo', 'tx_usada');
  END IF;
  IF round(p_monto, 2) <> p.monto THEN
    RETURN json_build_object('ok', false, 'motivo', 'monto', 'esperado', p.monto, 'recibido', p_monto);
  END IF;

  UPDATE public.app_reservas_pagos
     SET estado = 'aprobado', id_transaccion = p_id_transaccion, es_real = p_es_real,
         codigo_autorizacion = p_codigo, forma_pago = p_forma, detalle = p_detalle, pagado_at = now()
   WHERE id = p.id;

  -- Un encargo: pagado el anticipo, queda ACEPTADO para que se pida.
  IF p.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), updated_at = now(),
           estado = CASE WHEN estado = 'confirmado' THEN 'aceptado' ELSE estado END
     WHERE id = p.encargo_id;
    INSERT INTO public.audit_logs (action, target_id, details, source)
    VALUES ('ENCARGO_PAGADO_EN_LINEA', p.encargo_id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real), 'SYSTEM');
    RETURN json_build_object('ok', true, 'encargo_id', p.encargo_id, 'prueba', NOT p_es_real);
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids FROM public.app_reservas
   WHERE (p.pedido IS NOT NULL AND pedido = p.pedido) OR (p.pedido IS NULL AND id = p.reserva_id);

  FOR r IN SELECT * FROM public.app_reservas WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE LOOP
    -- Lo que no entró en el monto: los renglones que el cobro no cubre (o, en
    -- un cobro sin esa lista, los que ya estaban cerrados al crearlo).
    IF (p.reservas_ids IS NOT NULL AND NOT (r.id = ANY (p.reservas_ids)))
       OR (p.reservas_ids IS NULL AND r.estado IN ('vencida', 'cancelada') AND r.cerrada_at IS NOT NULL AND r.cerrada_at < p.created_at) THEN
      CONTINUE;
    END IF;
    v_cubiertos := v_cubiertos || r.id;
    v_envio := greatest(v_envio, coalesce(r.costo_envio, 0));
    -- Ya pagada por otro cobro: este monto sobra (queda a favor, abajo).
    IF r.pago_estado = 'pagado' THEN CONTINUE; END IF;
    UPDATE public.app_reservas
       SET pago_estado = 'pagado', pago_metodo = 'en_linea', pagado_at = now(), updated_at = now(),
           pago_prueba = NOT p_es_real,
           vence_at = CASE WHEN estado = 'lista' THEN lista_at + interval '7 days' ELSE vence_at END
     WHERE id = r.id;
    IF r.estado IN ('vencida', 'cancelada') THEN
      v_saldo := v_saldo + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);
    ELSE
      v_aplicado := v_aplicado + round(coalesce(r.precio_unitario, 0) * r.cantidad, 2);
    END IF;
    INSERT INTO public.audit_logs (action, target_id, details, branch_id, source)
    VALUES (CASE WHEN r.estado IN ('vencida', 'cancelada') THEN 'RESERVA_PAGO_TARDIO_A_FAVOR' ELSE 'RESERVA_PAGADA_EN_LINEA' END, r.id::text,
            jsonb_build_object('monto', p.monto, 'transaccion', p_id_transaccion, 'es_real', p_es_real,
                               'estado_antes', r.estado, 'forma', p_forma, 'pedido', p.pedido),
            r.branch_id, 'SYSTEM');
  END LOOP;

  -- Lo que sobra del monto: el envío se usó si algo del pedido sigue en pie; lo
  -- de renglones cerrados ya quedó a favor (trigger, con el envío si todo el
  -- pedido se cerró). Si aun así sobra, es un cobro duplicado sobre algo ya
  -- pagado. Va a favor en un renglón CERRADO y sin saldo; nunca en uno abierto,
  -- porque ese lugar lo necesita su propio saldo si después se cancela (medido
  -- en pruebas: puesto en el abierto, al cancelarlo se perdía lo suyo). Si no
  -- hay dónde, queda en la bitácora y se avisa a supervisión para devolverlo a
  -- mano. Sólo con dinero real.
  IF p_es_real THEN
    v_resto := p.monto - v_aplicado - v_saldo - CASE WHEN v_aplicado > 0 THEN v_envio ELSE 0 END
               - coalesce((SELECT sum(costo_envio) FROM public.app_reservas
                            WHERE id = ANY (v_cubiertos) AND saldo_incluye_envio
                              AND saldo_favor_origen = 'pago_tardio'), 0);
    IF v_resto > 0.005 THEN
      SELECT id INTO v_destino FROM public.app_reservas
       WHERE id = ANY (v_ids) AND estado IN ('vencida', 'cancelada') AND saldo_favor IS NULL ORDER BY id LIMIT 1;
      IF v_destino IS NOT NULL THEN
        UPDATE public.app_reservas
           SET saldo_favor = round(v_resto, 2), saldo_favor_origen = 'pago_duplicado',
               saldo_favor_vence = (now() AT TIME ZONE 'America/El_Salvador')::date + 90, updated_at = now()
         WHERE id = v_destino;
      ELSE
        SELECT array_agg(e.id) INTO v_dest FROM public.employees e
         WHERE e.status = 'ACTIVO' AND public.rango_de_empleado(e.id) >= 3;
        IF v_dest IS NOT NULL THEN
          PERFORM public.notify_employees(v_dest, 'PAGO_EN_LINEA_DE_MAS', 'Pago en línea de más',
            'El ' || coalesce('pedido ' || p.pedido, 'R-' || lpad(p.reserva_id::text, 6, '0')) || ' recibió $'
              || to_char(round(v_resto, 2), 'FM999990.00') || ' de más (transacción ' || p_id_transaccion || '). Hay que devolverlo al cliente.',
            '/', jsonb_build_object('check_key', 'pago-de-mas:' || p_id_transaccion), true, NULL);
        END IF;
      END IF;
      INSERT INTO public.audit_logs (action, target_id, details, source)
      VALUES ('RESERVA_PAGO_SOBRANTE', coalesce(p.pedido, p.reserva_id::text),
              jsonb_build_object('monto', p.monto, 'sobrante', round(v_resto, 2), 'a_favor_en', v_destino,
                                 'transaccion', p_id_transaccion), 'SYSTEM');
    END IF;
  END IF;

  RETURN json_build_object('ok', true, 'reserva_id', p.reserva_id, 'pedido', p.pedido,
                           'reservas', coalesce(array_length(v_cubiertos, 1), 0), 'prueba', NOT p_es_real);
END;
$function$;

-- ── Lo que ve la sala ─────────────────────────────────────────────────────
-- Igual que antes, más: `pago_prueba` (9: la sala ve «PAGO DE PRUEBA — cobrar
-- en caja»), `bajo_receta`, `puede_revisar_receta` (3), el origen y la
-- devolución del saldo a favor (6), y los saldos a favor de cualquier renglón
-- cerrado —ya no sólo de vencidas—.
CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.auth_can_edit_any(ARRAY['ofertas_clientes']) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (p_branch_id = public.auth_employee_branch_id() OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'estado', r.estado, 'origen', r.origen, 'pedido', r.pedido,
      'documento', r.documento, 'datos_fiscales', r.datos_fiscales,
      'branch_id', r.branch_id, 'sala', b.name,
      'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = r.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'producto_id', r.producto_id, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'precio', r.precio_unitario, 'precio_normal', r.precio_normal,
      'oferta', r.oferta_titulo, 'oferta_fin', r.oferta_fin,
      'creada', r.created_at, 'lista_at', r.lista_at, 'vence_at', r.vence_at,
      'avisado_via', r.avisado_via, 'avisado_at', r.avisado_at, 'cerrada_at', r.cerrada_at,
      'pago_estado', r.pago_estado, 'pago_metodo', r.pago_metodo, 'pago_prueba', r.pago_prueba, 'entrega', r.entrega,
      'direccion_entrega', r.direccion_entrega, 'costo_envio', r.costo_envio, 'anticipo', r.anticipo,
      'saldo_favor', r.saldo_favor, 'saldo_favor_vence', r.saldo_favor_vence, 'saldo_favor_origen', r.saldo_favor_origen,
      'saldo_favor_usado_at', r.saldo_favor_usado_at, 'saldo_favor_devuelto_at', r.saldo_favor_devuelto_at,
      'vencida_motivo', r.vencida_motivo, 'pendiente_at', r.pendiente_at,
      'bajo_receta', r.bajo_receta, 'puede_revisar_receta', public.receta_app_puede_aprobar(r.branch_id),
      'receta_ruta', r.receta_ruta, 'receta_estado', r.receta_estado, 'receta_motivo', r.receta_motivo,
      'receta_subida_at', r.receta_subida_at, 'receta_fotos', r.receta_fotos,
      'receta_revisada_at', r.receta_revisada_at)
      ORDER BY (r.estado = 'en_revision') DESC, (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('en_revision', 'pendiente', 'lista')
                   OR (coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL
                       AND r.saldo_favor_devuelto_at IS NULL AND r.saldo_favor_vence >= v_hoy)
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$;

-- ── 6. El saldo a favor se usa en CUALQUIER sala ──────────────────────────
-- Antes sólo la sala de la reserva. Ahora cualquiera que maneje reservas
-- (`dash_reservas` con edición); queda anotada la sala que lo aplicó.
CREATE OR REPLACE FUNCTION public.reserva_usar_saldo_favor(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  IF NOT (public.reserva_puede_manejar(r.branch_id) OR public.auth_can_edit_any(ARRAY['dash_reservas'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó'; END IF;
  IF r.saldo_favor_devuelto_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se devolvió en dinero'; END IF;
  IF r.saldo_favor_vence < (now() AT TIME ZONE 'America/El_Salvador')::date THEN RAISE EXCEPTION 'Ese saldo a favor ya venció'; END IF;
  UPDATE public.app_reservas SET saldo_favor_usado_at = now(), saldo_favor_usado_por = public.auth_employee_id(),
         saldo_favor_usado_branch = public.auth_employee_branch_id(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id)
  VALUES ('RESERVA_SALDO_FAVOR_USADO', p_id::text,
          jsonb_build_object('monto', r.saldo_favor, 'sala_de_la_reserva', r.branch_id),
          public.auth_employee_branch_id(), public.auth_employee_id());
  RETURN json_build_object('ok', true, 'monto', r.saldo_favor);
END $function$;

-- ── 6. Devolverlo en dinero: sólo admin, con motivo ───────────────────────
-- La devolución se hace afuera (el panel del cobro en línea, o caja); acá
-- queda QUIÉN la autorizó, cuándo, cuánto y por qué, y el saldo deja de estar
-- disponible.
CREATE OR REPLACE FUNCTION public.reserva_saldo_devolver(p_id bigint, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  IF NOT public.auth_has_module_permission('dash_reservas_devolver_saldo', 'can_view') THEN
    RAISE EXCEPTION 'Sólo administración puede autorizar una devolución en dinero.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la devolución.'; END IF;
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó en una compra'; END IF;
  IF r.saldo_favor_devuelto_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se devolvió'; END IF;
  UPDATE public.app_reservas
     SET saldo_favor_devuelto_at = now(), saldo_favor_devuelto_por = public.auth_employee_id(),
         saldo_favor_devuelto_monto = r.saldo_favor, saldo_favor_devuelto_motivo = left(v_motivo, 300), updated_at = now()
   WHERE id = p_id;
  RETURN json_build_object('ok', true, 'monto', r.saldo_favor);
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_saldo_devolver(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_saldo_devolver(bigint, text) TO authenticated, service_role;

-- ── 6. Buscar un saldo a favor por su código, desde cualquier sala ─────────
-- El cliente muestra en la app el código de la reserva o del pedido (R-… o
-- P-…). Cualquier sala que maneje reservas lo encuentra para aplicarlo.
CREATE OR REPLACE FUNCTION public.saldo_favor_buscar(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v text := upper(btrim(coalesce(p_codigo, ''))); v_id bigint;
BEGIN
  IF NOT (public.auth_has_module_permission('dash_reservas', 'can_view') OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v ~ '^R-[0-9]{1,12}$' THEN v_id := substring(v FROM 3)::bigint;
  ELSIF v !~ '^P-[A-Z0-9]{6}$' THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', r.id, 'estado', r.estado, 'pedido', r.pedido, 'branch_id', r.branch_id, 'sala', b.name,
      'cliente', c.name, 'producto', r.producto_nombre, 'cantidad', r.cantidad,
      'saldo_favor', r.saldo_favor, 'saldo_favor_vence', r.saldo_favor_vence, 'saldo_favor_origen', r.saldo_favor_origen,
      'saldo_favor_usado_at', r.saldo_favor_usado_at, 'saldo_favor_devuelto_at', r.saldo_favor_devuelto_at) ORDER BY r.id)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
     WHERE (r.id = v_id OR (v_id IS NULL AND r.pedido = v))
       AND coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL AND r.saldo_favor_devuelto_at IS NULL
       AND r.saldo_favor_vence >= (now() AT TIME ZONE 'America/El_Salvador')::date), '[]'::json);
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_buscar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_buscar(text) TO authenticated, service_role;

-- ── 8. La receta aprobada en la app, desde el libro ───────────────────────
-- Un renglón de la bitácora bajo receta puede venir de una reserva de la app
-- con la receta ya revisada: misma ficha, mismo producto, aprobada en los 60
-- días previos. Devuelve la foto (ruta en `app-clientes-archivos`), quién la
-- aprobó y cuándo. La foto aprobada no se borra nunca (ni al borrar la cuenta).
CREATE OR REPLACE FUNCTION public.receta_app_de_dispensacion(p_dispensacion_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE d public.bitacora_dispensaciones;
BEGIN
  SELECT * INTO d FROM public.bitacora_dispensaciones WHERE id = p_dispensacion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese renglon no existe.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.bitacora_exigir_acceso(d.branch_id, 'can_view');
  IF d.customer_id IS NULL THEN RETURN '[]'::json; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'reserva_id', r.id, 'pedido', r.pedido, 'branch_id', r.branch_id, 'sala', b.name,
      'receta_ruta', r.receta_ruta, 'receta_revisada_at', r.receta_revisada_at,
      'revisada_por', e.name, 'revisada_por_id', r.receta_revisada_por, 'estado', r.estado)
      ORDER BY r.receta_revisada_at DESC)
      FROM public.app_reservas r
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.employees e ON e.id = r.receta_revisada_por
     WHERE r.customer_id = d.customer_id AND r.producto_id = d.erp_product_id
       AND r.receta_estado = 'aprobada' AND r.receta_ruta IS NOT NULL
       AND r.receta_revisada_at >= (d.fecha - 60)::timestamptz
       AND r.receta_revisada_at < (d.fecha + 1)::timestamptz), '[]'::json);
END $function$;
REVOKE EXECUTE ON FUNCTION public.receta_app_de_dispensacion(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receta_app_de_dispensacion(bigint) TO authenticated, service_role;
