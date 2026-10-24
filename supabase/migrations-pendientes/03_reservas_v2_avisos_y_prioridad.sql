-- Reservas v2 · 03 — registro de avisos, «Registrar llamada» y prioridad por nivel.
--
-- QUÉ CAMBIA:
--   · Tabla nueva `reserva_avisos_log`: cada aviso al cliente sobre una reserva
--     o un encargo —WhatsApp desde el botón del portal, o una llamada con su
--     respuesta— con quién y cuándo (procedimiento §9: «el registro es la
--     prueba de que se hizo a tiempo»). Hasta hoy `reserva_avisada_whatsapp`
--     sobrescribía un solo campo y las llamadas no quedaban en ningún lado.
--     El de la app no se duplica acá: ya vive en `app_cliente_avisos`
--     (`created_at` y `leido_at`) y el listado lo trae al lado.
--   · `reserva_registrar_aviso` (RPC del botón «Registrar llamada», y del
--     WhatsApp de un encargo).
--   · `reserva_prioridad(customer)`: Oro y Platino (Puntos Salud) y Rubí y
--     Diamante (Cliente Mayorista) se atienden primero (procedimiento 2.6).
--   · `reservas_de_sucursal` / `encargos_de_sucursal`: ordenan por esa
--     prioridad dentro de cada estado, traen el nivel para mostrarlo en la fila,
--     `prorrogable` (la regla de la base) y el registro de avisos; los encargos,
--     además, si se puede cambiar la fecha estimada o registrar que el
--     proveedor no entregó (migración 04).
--
-- DESDE CUÁNDO: el registro se escribe siempre (no se ve), pero el listado sólo
-- lo devuelve, igual que la prioridad, el nivel y los botones nuevos, cuando
-- `reservas_v2_rige()`. Antes de la fecha el listado es el de hoy más
-- `prorrogable`, que vale lo mismo que la regla que ya usaban las pantallas.
--
-- Tabla nueva: `app_reservas` y `app_encargos` reciben una FK entrante (lock
-- breve SHARE ROW EXCLUSIVE; no están entre las tablas calientes). ON DELETE
-- CASCADE a propósito: `apartado_deshacer` BORRA la reserva que nació de un
-- cobro anulado, y una FK sin cascada lo rompería.
--
-- Partida de las tres funciones reescritas: `pg_get_functiondef` de producción
-- del 2026-10-24 (md5 igual al del branch de pruebas).
-- CÓMO SE VERIFICÓ: branch de pruebas, `execute_sql`, transacción que se deshace.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.reserva_avisos_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  reserva_id bigint REFERENCES public.app_reservas(id) ON DELETE CASCADE,
  encargo_id bigint REFERENCES public.app_encargos(id) ON DELETE CASCADE,
  branch_id bigint NOT NULL REFERENCES public.branches(id),
  canal text NOT NULL CHECK (canal IN ('app', 'whatsapp', 'llamada')),
  employee_id uuid REFERENCES public.employees(id),
  contesto boolean,
  respuesta text CHECK (respuesta IS NULL OR length(respuesta) <= 300),
  CONSTRAINT reserva_avisos_log_uno CHECK (num_nonnulls(reserva_id, encargo_id) = 1),
  CONSTRAINT reserva_avisos_log_llamada CHECK (canal <> 'llamada' OR contesto IS NOT NULL)
);
COMMENT ON TABLE public.reserva_avisos_log IS
  'Cada aviso al cliente sobre una reserva o un encargo (WhatsApp desde el portal, llamada con su respuesta). Historial de negocio: no se purga. Se escribe sólo por reserva_registrar_aviso / reserva_avisada_whatsapp.';
CREATE INDEX IF NOT EXISTS reserva_avisos_log_reserva_idx ON public.reserva_avisos_log (reserva_id) WHERE reserva_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reserva_avisos_log_encargo_idx ON public.reserva_avisos_log (encargo_id) WHERE encargo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reserva_avisos_log_branch_idx ON public.reserva_avisos_log (branch_id);
CREATE INDEX IF NOT EXISTS reserva_avisos_log_employee_idx ON public.reserva_avisos_log (employee_id);
ALTER TABLE public.reserva_avisos_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reserva_avisos_log FROM anon;
DROP POLICY IF EXISTS reserva_avisos_log_select ON public.reserva_avisos_log;
-- Lo ve quien maneja esa sala (la misma regla que las reservas y los
-- encargos). Sin policy de escritura: se escribe sólo por las funciones.
CREATE POLICY reserva_avisos_log_select ON public.reserva_avisos_log FOR SELECT TO authenticated
  USING (CASE WHEN reserva_id IS NOT NULL THEN public.reserva_puede_manejar(branch_id)
              ELSE public.encargo_puede_manejar(branch_id) END);

-- ── La prioridad (procedimiento 2.6) ─────────────────────────────────────────
-- Cliente Mayorista aprobado: su rango (Rubí y Diamante tienen prioridad; un
-- mayorista no tiene nivel de Puntos Salud). Los demás: su nivel por la compra
-- de los últimos 12 meses (Oro y Platino). Sólo cuando rige v2.
--
-- El nivel sale de `puntos_niveles` con la misma regla que `puntos_nivel_de`
-- (el mayor `desde` que alcanza la compra) pero SIN el interruptor
-- `niveles_activos`: los niveles rigen desde la misma fecha, y este cálculo
-- sólo corre cuando ya rige. Si la tanda de PUNTOS hace que `puntos_nivel_de`
-- dependa de la fecha, se puede volver a llamar a esa.
--
-- Medido en producción (2026-10-24): `puntos_compra_12m` cuesta ~320 bloques y
-- ~3 ms con los 30 clientes que más compran; `mayorista_rango` es la cara (lee
-- el resumen mensual), por eso sólo se llama si el cliente es mayorista aprobado.
CREATE OR REPLACE FUNCTION public.reserva_prioridad(p_customer bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_c bigint; v_rango text; n public.puntos_niveles;
BEGIN
  IF p_customer IS NULL OR NOT public.reservas_v2_rige() THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.clientes_mayoristas cm WHERE cm.customer_id = p_customer AND cm.estado = 'aprobado') THEN
    v_rango := public.mayorista_rango(p_customer);
    RETURN CASE WHEN v_rango IN ('rubi', 'diamante')
                THEN jsonb_build_object('clave', v_rango, 'nombre', CASE v_rango WHEN 'rubi' THEN 'Rubí' ELSE 'Diamante' END, 'prioridad', true) END;
  END IF;
  v_c := public.puntos_titular(p_customer);
  SELECT x.* INTO n FROM public.puntos_niveles x
   WHERE x.desde <= public.puntos_compra_12m(v_c, (now() AT TIME ZONE 'America/El_Salvador')::date)
   ORDER BY x.desde DESC LIMIT 1;
  RETURN CASE WHEN n.clave IN ('oro', 'platino')
              THEN jsonb_build_object('clave', n.clave, 'nombre', n.nombre, 'prioridad', true) END;
END $$;
REVOKE EXECUTE ON FUNCTION public.reserva_prioridad(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_prioridad(bigint) TO authenticated, service_role;

-- ── Registrar un aviso (llamada o WhatsApp) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.reserva_registrar_aviso(p_reserva bigint, p_encargo bigint, p_canal text,
                                                          p_contesto boolean DEFAULT NULL, p_respuesta text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_branch bigint; v_emp uuid := public.auth_employee_id(); v_resp text := nullif(btrim(coalesce(p_respuesta, '')), ''); v_id bigint;
BEGIN
  IF num_nonnulls(p_reserva, p_encargo) <> 1 THEN RAISE EXCEPTION 'Indica la reserva o el encargo.'; END IF;
  IF p_canal NOT IN ('whatsapp', 'llamada') THEN RAISE EXCEPTION 'Ese medio de aviso no se registra a mano.'; END IF;
  IF p_reserva IS NOT NULL THEN
    SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_reserva;
    IF v_branch IS NULL OR NOT public.reserva_puede_manejar(v_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  ELSE
    SELECT branch_id INTO v_branch FROM public.app_encargos WHERE id = p_encargo;
    IF v_branch IS NULL OR NOT public.encargo_puede_manejar(v_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_canal = 'llamada' THEN
    IF p_contesto IS NULL THEN RAISE EXCEPTION 'Indica si el cliente contestó.'; END IF;
    IF p_contesto AND (v_resp IS NULL OR length(v_resp) < 3) THEN RAISE EXCEPTION 'Escribe qué respondió el cliente.'; END IF;
  END IF;
  INSERT INTO public.reserva_avisos_log (reserva_id, encargo_id, branch_id, canal, employee_id, contesto, respuesta)
  VALUES (p_reserva, p_encargo, v_branch, p_canal, v_emp, CASE WHEN p_canal = 'llamada' THEN p_contesto END, left(v_resp, 300))
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (v_emp, CASE WHEN p_encargo IS NOT NULL THEN 'ENCARGO_' ELSE 'RESERVA_' END || 'AVISO_' || upper(p_canal),
          coalesce(p_reserva, p_encargo)::text,
          jsonb_build_object('contesto', p_contesto, 'respuesta', left(v_resp, 300), 'registro', v_id), v_branch, 'ADMIN_PANEL');
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.reserva_registrar_aviso(bigint, bigint, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_registrar_aviso(bigint, bigint, text, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reservas_de_sucursal(p_branch_id bigint, p_abiertas boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_v2 boolean := public.reservas_v2_rige();
BEGIN
  IF p_branch_id IS NULL THEN
    IF NOT public.auth_can_edit_any(ARRAY['ofertas_clientes']) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.reserva_puede_manejar(p_branch_id) THEN
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
      -- Mayoreo (2026-10-19): la lista con que se cobró al reservar, para facturar igual.
      'lista_precio', r.lista_precio,
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
      'receta_revisada_at', r.receta_revisada_at)::jsonb
      -- La preventa (2026-10-21): en qué quedó, su número en la caja y la factura.
      || jsonb_build_object(
      'preventa_id', pv.id, 'preventa_estado', pv.estado, 'preventa_ref', pv.externo_ref,
      'preventa_at', pv.enviada_at, 'preventa_por', pv.enviada_por, 'factura', si.correlativo,
      -- Los plazos los dice el servidor (2026-10-21): hasta cuándo vale el
      -- estado actual y, si está por prepararse, cuántas horas quedará lista.
      'plazo_hasta', public.reserva_plazo_hasta(r),
      'horas_al_preparar', CASE WHEN r.estado = 'pendiente' THEN public.reserva_horas_al_preparar(r) END)
      -- En camino (2026-10-22): de dónde viene, en qué va, y lo que pide decidir.
      || jsonb_build_object(
      'factor', r.factor, 'traslado_desde', r.traslado_desde, 'traslado_sala', bt.name,
      'traslado_estado', r.traslado_estado, 'traslado_nota', r.traslado_nota,
      'traslado_llegaron', r.traslado_llegaron, 'traslado_por_llegar', r.traslado_por_llegar,
      'ajuste_de', r.ajuste_de, 'prorrogada_at', r.prorrogada_at, 'saldo_favor_devuelto_monto', r.saldo_favor_devuelto_monto,
      'devolucion_pedida_at', r.devolucion_pedida_at, 'devolucion_pedida_motivo', r.devolucion_pedida_motivo,
      'devolucion_entregada_at', r.devolucion_entregada_at,
      'encargo', (SELECT jsonb_build_object('id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado,
                                            'precio', e.precio_unitario, 'fecha', e.fecha_estimada, 'cantidad', e.cantidad)
                    FROM public.app_encargos e WHERE e.reserva_id = r.id ORDER BY e.id DESC LIMIT 1))
      -- Reglamento v2 (2026-11-15): la prórroga la decide la base; la prioridad
      -- de Oro, Platino, Rubí y Diamante (procedimiento 2.6); y el registro de
      -- cada aviso al cliente (procedimiento §9), con el de la app (cuándo se
      -- envió y cuándo lo leyó). Antes de la fecha: sin prioridad ni registro.
      || jsonb_build_object(
      'prorrogable', public.reserva_prorrogable(r),
      'nivel', pr.j, 'prioridad', coalesce((pr.j->>'prioridad')::boolean, false),
      'registrar_llamada', v_v2 AND r.estado IN ('pendiente', 'lista'),
      'avisos', CASE WHEN v_v2 THEN (SELECT jsonb_agg(jsonb_build_object('canal', l.canal, 'at', l.created_at, 'por_id', l.employee_id,
                                                        'por', em.name, 'por_nombres', em.first_names, 'por_apellidos', em.last_names, 'contesto', l.contesto, 'respuesta', l.respuesta) ORDER BY l.created_at DESC)
                                       FROM public.reserva_avisos_log l LEFT JOIN public.employees em ON em.id = l.employee_id
                                      WHERE l.reserva_id = r.id) END,
      'aviso_app', CASE WHEN v_v2 THEN (SELECT jsonb_build_object('at', a.created_at, 'leido_at', a.leido_at)
                                          FROM public.app_cliente_avisos a
                                         WHERE a.customer_id = r.customer_id AND a.tipo = 'reserva' AND a.ref = 'reserva-lista:' || r.id) END)
      ORDER BY (r.estado = 'en_revision') DESC, (r.estado = 'pendiente') DESC, (r.estado = 'lista') DESC,
               coalesce((pr.j->>'prioridad')::boolean, false) DESC, r.created_at DESC)
      FROM public.app_reservas r
      JOIN public.customers c ON c.id = r.customer_id
      JOIN public.branches b ON b.id = r.branch_id
      LEFT JOIN public.branches bt ON bt.id = r.traslado_desde
      LEFT JOIN public.preventas pv ON pv.id = r.preventa_id
      LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
      -- La prioridad sólo de lo abierto, y sólo cuando rige v2 (si no, NULL sin leer nada).
      LEFT JOIN LATERAL (SELECT CASE WHEN v_v2 AND r.estado IN ('en_revision', 'pendiente', 'lista')
                                     THEN public.reserva_prioridad(r.customer_id) END AS j) pr ON true
     WHERE (p_branch_id IS NULL OR r.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertas THEN r.estado IN ('en_revision', 'pendiente', 'lista')
                   OR (coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL
                       AND r.saldo_favor_devuelto_at IS NULL AND r.saldo_favor_vence >= v_hoy)
                   -- Autorizada en efectivo y todavía sin entregar: la sala tiene que verla.
                   OR (r.devolucion_pedida_at IS NOT NULL AND r.saldo_favor_devuelto_at IS NOT NULL AND r.devolucion_movimiento IS NULL)
                 ELSE r.created_at > now() - interval '30 days' END)), '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.encargos_de_sucursal(p_branch_id bigint, p_abiertos boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_v2 boolean := public.reservas_v2_rige();
  v_compras boolean := (SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
                       OR public.auth_can_edit_any(ARRAY['ofertas_clientes']);
BEGIN
  IF p_branch_id IS NOT NULL AND NOT (p_branch_id = public.auth_employee_branch_id()
       OR public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL AND NOT (public.auth_employee_branch_id() IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
       OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object(
      'id', e.id, 'codigo', 'E-' || lpad(e.id::text, 6, '0'), 'estado', e.estado, 'pago_estado', e.pago_estado,
      'branch_id', e.branch_id, 'sala', b.name, 'cliente', c.name, 'telefono', c.phone,
      'tiene_app', EXISTS (SELECT 1 FROM public.app_cliente_sesiones s
                            WHERE s.customer_id = e.customer_id AND s.revocada_at IS NULL
                              AND s.push_token IS NOT NULL AND s.acepta_avisos),
      'product_id', e.product_id, 'producto', e.producto_nombre, 'cantidad', e.cantidad, 'nota_cliente', e.nota_cliente,
      'precio_unitario', e.precio_unitario, 'anticipo', e.anticipo, 'fecha_estimada', e.fecha_estimada, 'nota_sucursal', e.nota_sucursal,
      'devolutivo', p.devolutivo,
      'vendido_antes', e.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales_invoice_items ii WHERE ii.erp_product_id = e.product_id LIMIT 1),
      'producto_nuevo', e.producto_nuevo, 'srs', e.srs, 'foto_url', e.foto_url,
      'producto_catalogo', p.nombre, 'vinculado_at', e.vinculado_at,
      -- El resto de una reserva (2026-10-22) se cobra con la reserva, nunca en «Por cobrar».
      'reserva_id', e.reserva_id, 'reserva', CASE WHEN e.reserva_id IS NOT NULL THEN 'R-' || lpad(e.reserva_id::text, 6, '0') END,
      'sugerido_product_id', e.sugerido_product_id, 'sugerido', ps.nombre,
      -- Reglamento v2: 7 días desde que llegó (+7 con la única prórroga), el último entero.
      'listo_at', e.listo_at, 'prorrogado_at', e.prorrogado_at, 'aviso_sin_retirar_at', e.aviso_sin_retirar_at,
      'retirar_hasta', public.encargo_retirar_hasta(e),
      'creado', e.created_at)::jsonb
      -- Reglamento v2 (2026-11-15): sin prórroga, la prioridad (procedimiento
      -- 2.6), cambiar la fecha estimada con aviso (4.4), el proveedor que no
      -- entrega (4.6) y el registro de avisos (procedimiento §9).
      || jsonb_build_object(
      'prorrogable', public.encargo_prorrogable(e),
      'nivel', pr.j, 'prioridad', coalesce((pr.j->>'prioridad')::boolean, false),
      'puede_cambiar_fecha', v_v2 AND v_compras AND e.estado IN ('confirmado', 'aceptado', 'pedido'),
      'puede_no_entrego', v_v2 AND e.estado IN ('aceptado', 'pedido') AND e.pago_estado = 'pagado' AND e.reserva_id IS NULL
                          AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones a WHERE a.encargo_id = e.id),
      'registrar_llamada', v_v2 AND e.estado IN ('confirmado', 'listo'),
      'avisos', CASE WHEN v_v2 THEN (SELECT jsonb_agg(jsonb_build_object('canal', l.canal, 'at', l.created_at, 'por_id', l.employee_id,
                                                        'por', em.name, 'por_nombres', em.first_names, 'por_apellidos', em.last_names, 'contesto', l.contesto, 'respuesta', l.respuesta) ORDER BY l.created_at DESC)
                                       FROM public.reserva_avisos_log l LEFT JOIN public.employees em ON em.id = l.employee_id
                                      WHERE l.encargo_id = e.id) END,
      'aviso_app', CASE WHEN v_v2 THEN (SELECT jsonb_build_object('at', a.created_at, 'leido_at', a.leido_at)
                                          FROM public.app_cliente_avisos a
                                         WHERE a.customer_id = e.customer_id AND a.tipo = 'encargo' AND a.ref = 'encargo:' || e.id || ':listo') END)
      ORDER BY (e.estado = 'solicitado') DESC, (e.estado = 'aceptado') DESC,
               coalesce((pr.j->>'prioridad')::boolean, false) DESC, e.created_at DESC)
      FROM public.app_encargos e
      JOIN public.branches b ON b.id = e.branch_id
      JOIN public.customers c ON c.id = e.customer_id
      LEFT JOIN public.products p ON p.id = e.product_id
      LEFT JOIN public.products ps ON ps.id = e.sugerido_product_id AND e.product_id IS NULL
      LEFT JOIN LATERAL (SELECT CASE WHEN v_v2 AND e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                                     THEN public.reserva_prioridad(e.customer_id) END AS j) pr ON true
     WHERE (p_branch_id IS NULL OR e.branch_id = p_branch_id)
       AND (CASE WHEN p_abiertos THEN e.estado IN ('solicitado', 'confirmado', 'aceptado', 'pedido', 'listo')
                 ELSE e.created_at > now() - interval '30 days' END)), '[]'::json);
END $function$
;

CREATE OR REPLACE FUNCTION public.reserva_avisada_whatsapp(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint;
BEGIN
  SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_id;
  IF v_branch IS NULL OR NOT public.reserva_puede_manejar(v_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_reservas SET avisado_via = 'whatsapp', avisado_por = public.auth_employee_id(),
         avisado_at = now(), updated_at = now() WHERE id = p_id;
  -- El registro (procedimiento §9): cada aviso queda, no sólo el último.
  INSERT INTO public.reserva_avisos_log (reserva_id, branch_id, canal, employee_id)
  VALUES (p_id, v_branch, 'whatsapp', public.auth_employee_id());
END;
$function$
;
