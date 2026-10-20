SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Apartar o encargar desde la sala, con el anticipo en la caja (2026-10-20).
--
-- Hasta hoy había tres caminos que no se hablaban:
--   · «Abono para apartar» (Mi caja → `abonos_de_cliente`): nombre escrito a
--     mano, sin ficha, sin producto del catálogo, siempre efectivo, y nunca se
--     cerraba;
--   · «Reservar con anticipo» (Inicio → `reserva_en_sucursal_crear`): con
--     ficha y producto, pero el anticipo NO entraba a ninguna caja;
--   · el encargo, que sólo nacía en la app.
--
-- Ahora es UNO, y el portal decide (decisiones del usuario, 2026-10-17/19/20):
--   · HAY en la sala y no es insumo → RESERVA: el precio queda fijo, anticipo
--     mínimo del 50 % cobrado YA en la caja, con su forma de pago.
--   · NO hay, o es INSUMO → ENCARGO: se registra sin cobrar; Compras o
--     administración confirma precio y fecha, y cuando el cliente acepta la
--     sala cobra el 100 %.
-- El anticipo es un ingreso de caja tipo APARTADO (`ANTICIPO` ya existe: es
-- el anticipo a un EMPLEADO, una salida) ligado a la reserva o al
-- encargo: el efectivo va a la caja, la tarjeta y la transferencia no.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── La marca «insumo» ──────────────────────────────────────────────────────
-- Tabla aparte y no columna de `products`: esa tabla la reescribe el sync de
-- catálogo todo el tiempo (y no se le agregan columnas sin necesidad).
CREATE TABLE IF NOT EXISTS public.producto_insumo (
  product_id  bigint PRIMARY KEY,
  motivo      text,
  marcado_por uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.producto_insumo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS producto_insumo_select ON public.producto_insumo;
CREATE POLICY producto_insumo_select ON public.producto_insumo FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.producto_insumo FROM anon;
GRANT SELECT ON public.producto_insumo TO authenticated;
GRANT ALL ON public.producto_insumo TO service_role;

-- Marcar o desmarcar: quien edita productos.
CREATE OR REPLACE FUNCTION public.producto_insumo_marcar(p_product_id bigint, p_insumo boolean, p_motivo text DEFAULT NULL)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT coalesce((SELECT public.auth_has_module_permission('productos', 'can_edit')), false) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_insumo THEN
    INSERT INTO public.producto_insumo (product_id, motivo, marcado_por)
    VALUES (p_product_id, nullif(btrim(p_motivo), ''), public.auth_employee_id())
    ON CONFLICT (product_id) DO UPDATE SET motivo = EXCLUDED.motivo, marcado_por = EXCLUDED.marcado_por;
  ELSE
    DELETE FROM public.producto_insumo WHERE product_id = p_product_id;
  END IF;
  RETURN p_insumo;
END $function$;
REVOKE ALL ON FUNCTION public.producto_insumo_marcar(bigint, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.producto_insumo_marcar(bigint, boolean, text) TO authenticated, service_role;

-- ── El ingreso sabe de qué reserva o encargo es ────────────────────────────
ALTER TABLE public.caja_movimientos_portal
  ADD COLUMN IF NOT EXISTS reserva_id bigint,
  ADD COLUMN IF NOT EXISTS encargo_id bigint;
CREATE INDEX IF NOT EXISTS caja_movimientos_portal_reserva ON public.caja_movimientos_portal (reserva_id) WHERE reserva_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS caja_movimientos_portal_encargo ON public.caja_movimientos_portal (encargo_id) WHERE encargo_id IS NOT NULL;

INSERT INTO public.caja_tipos_movimiento
  (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden, activo, identifica_receptor)
VALUES
  ('APARTADO', 'Apartar o encargar', 'ENTRADA', false, false, 'NO', true,
   'El anticipo de un producto apartado o encargado: se elige el cliente y el producto.', 24, true, false)
ON CONFLICT (codigo) DO NOTHING;

-- ── ¿Se aparta o se encarga? ───────────────────────────────────────────────
-- La pantalla la pregunta para decirlo ANTES de cobrar; el servidor la vuelve
-- a preguntar al cobrar (`apartado_cotizar`). `p_factor` es la presentación.
CREATE OR REPLACE FUNCTION public.apartado_opciones(p_branch_id bigint, p_producto_id bigint, p_factor integer, p_cantidad integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_disp numeric := 0;
  v_insumo boolean;
  v_necesita numeric := greatest(coalesce(p_cantidad, 1), 1) * greatest(coalesce(p_factor, 1), 1);
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(max((e->>'disponibles')::numeric), 0) INTO v_disp
    FROM json_array_elements(public.app_existencias_netas(ARRAY[p_producto_id::int])) e
   WHERE (e->>'branch_id')::bigint = p_branch_id;
  v_insumo := EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = p_producto_id);
  RETURN json_build_object(
    'disponibles', v_disp, 'necesita', v_necesita, 'insumo', v_insumo,
    'modo', CASE WHEN NOT v_insumo AND v_disp >= v_necesita THEN 'reserva' ELSE 'encargo' END,
    'precios', (SELECT coalesce(json_agg(DISTINCT round(pp.vineta, 2)), '[]'::json) FROM public.product_precios pp
                 WHERE pp.product_id = p_producto_id AND pp.activo AND pp.factor = greatest(coalesce(p_factor, 1), 1) AND pp.vineta > 0));
END $function$;
REVOKE ALL ON FUNCTION public.apartado_opciones(bigint, bigint, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apartado_opciones(bigint, bigint, integer, integer) TO authenticated, service_role;

-- ── El encargo hecho en la sala: sin cobrar ────────────────────────────────
CREATE OR REPLACE FUNCTION public.encargo_en_sucursal_crear(p_branch_id bigint, p_customer_id bigint, p_producto_id bigint,
    p_producto_nombre text, p_factor integer, p_cantidad integer, p_nota text DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN RAISE EXCEPTION 'Elige el cliente.'; END IF;
  IF coalesce(btrim(p_producto_nombre), '') = '' THEN RAISE EXCEPTION 'Elige el producto.'; END IF;
  IF p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'; END IF;
  INSERT INTO public.app_encargos (customer_id, branch_id, product_id, producto_nombre, factor, cantidad, nota_cliente, estado, pago_estado)
  VALUES (p_customer_id, p_branch_id, p_producto_id, left(btrim(p_producto_nombre), 200), greatest(coalesce(p_factor, 1), 1),
          p_cantidad, nullif(btrim(p_nota), ''), 'solicitado', 'pendiente')
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'ENCARGO_EN_SUCURSAL', v_id::text,
          jsonb_build_object('cliente', p_customer_id, 'producto', p_producto_id, 'cantidad', p_cantidad), p_branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'));
END $function$;
REVOKE ALL ON FUNCTION public.encargo_en_sucursal_crear(bigint, bigint, bigint, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.encargo_en_sucursal_crear(bigint, bigint, bigint, text, integer, integer, text) TO authenticated, service_role;

-- ── Cuánto se puede cobrar, y por qué ──────────────────────────────────────
-- La usa `operar-caja` antes de escribir nada: el monto lo valida el servidor,
-- nunca el navegador. `p_apartado`:
--   {modo:'nueva', customer_id, producto_id, producto_nombre, factor, cantidad, precio}
--   {modo:'reserva', reserva_id}   → completar una reserva hecha en la sala
--   {modo:'encargo', encargo_id}   → el 100 % de un encargo con precio confirmado
CREATE OR REPLACE FUNCTION public.apartado_cotizar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_modo text := p_apartado->>'modo';
  v_cant integer; v_factor integer; v_precio numeric; v_total numeric; v_disp numeric;
  r public.app_reservas; e public.app_encargos; v_cliente text;
BEGIN
  IF v_modo = 'nueva' THEN
    v_cant := (p_apartado->>'cantidad')::integer;
    v_factor := greatest(coalesce((p_apartado->>'factor')::integer, 1), 1);
    v_precio := round((p_apartado->>'precio')::numeric, 2);
    SELECT name INTO v_cliente FROM public.customers WHERE id = (p_apartado->>'customer_id')::bigint;
    IF v_cliente IS NULL THEN RAISE EXCEPTION 'Elige el cliente del listado.'; END IF;
    IF v_cant IS NULL OR v_cant < 1 OR v_cant > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'; END IF;
    -- El precio queda fijo sólo si es el del catálogo para esa presentación.
    IF v_precio IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_precios pp
        WHERE pp.product_id = (p_apartado->>'producto_id')::bigint AND pp.activo AND pp.factor = v_factor
          AND round(pp.vineta, 2) = v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es el del catálogo para esa presentación.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = (p_apartado->>'producto_id')::bigint) THEN
      RAISE EXCEPTION 'Es un insumo: se encarga, no se aparta.';
    END IF;
    SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
      FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
     WHERE (x->>'branch_id')::bigint = p_branch_id;
    IF v_disp < v_cant * v_factor THEN
      RAISE EXCEPTION 'En esta sala hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
    END IF;
    v_total := round(v_precio * v_cant, 2);
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', round(v_total * 0.5, 2), 'maximo', v_total,
      'cliente', v_cliente, 'detalle', (p_apartado->>'producto_nombre'));

  ELSIF v_modo = 'reserva' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    IF r.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa reserva es de otra sala.'; END IF;
    IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Esa reserva ya no está abierta.'; END IF;
    v_total := round(r.precio_unitario * r.cantidad, 2);
    IF v_total - coalesce(r.anticipo, 0) <= 0.004 THEN RAISE EXCEPTION 'Esa reserva ya está pagada.'; END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = r.customer_id;
    RETURN json_build_object('tipo', 'reserva', 'total', v_total, 'minimo', 0.01,
      'maximo', round(v_total - coalesce(r.anticipo, 0), 2), 'cliente', v_cliente, 'detalle', r.producto_nombre,
      'codigo', 'R-' || lpad(r.id::text, 6, '0'));

  ELSIF v_modo = 'encargo' THEN
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    IF e.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Ese encargo es de otra sala.'; END IF;
    IF e.estado <> 'confirmado' THEN RAISE EXCEPTION 'Ese encargo todavía no tiene el precio confirmado.'; END IF;
    IF e.pago_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    -- El encargo se paga completo: lo que no tenemos se pide para esa persona.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', round(e.anticipo, 2),
      'maximo', round(e.anticipo, 2), 'cliente', v_cliente, 'detalle', e.producto_nombre,
      'codigo', 'E-' || lpad(e.id::text, 6, '0'));
  END IF;
  RAISE EXCEPTION 'No se sabe qué se está apartando.';
END $function$;
REVOKE ALL ON FUNCTION public.apartado_cotizar(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_cotizar(bigint, jsonb) TO service_role;

-- ── El cobro aplicado a su reserva o encargo ───────────────────────────────
-- La llama `operar-caja` con el movimiento YA escrito y ANTES de tocar la caja:
-- si esto falla, el movimiento se anula y no se mueve dinero.
CREATE OR REPLACE FUNCTION public.apartado_aplicar(p_branch_id bigint, p_apartado jsonb, p_movimiento bigint,
    p_monto numeric, p_forma text, p_employee uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cot json := public.apartado_cotizar(p_branch_id, p_apartado);
  v_modo text := p_apartado->>'modo';
  v_metodo text := lower(coalesce(p_forma, 'EFECTIVO'));
  v_id bigint; v_total numeric := (v_cot->>'total')::numeric; v_anticipo numeric; v_vence timestamptz;
BEGIN
  IF p_monto < (v_cot->>'minimo')::numeric - 0.004 OR p_monto > (v_cot->>'maximo')::numeric + 0.004 THEN
    RAISE EXCEPTION 'El cobro va de % a %.', to_char((v_cot->>'minimo')::numeric, 'FM$999,990.00'),
      to_char((v_cot->>'maximo')::numeric, 'FM$999,990.00');
  END IF;

  IF v_modo = 'nueva' THEN
    INSERT INTO public.app_reservas (customer_id, branch_id, origen, producto_id, producto_nombre, cantidad, factor,
        precio_unitario, precio_normal, estado, terminos_version, anticipo, lista_at, vence_at, preparada_por,
        pago_estado, pago_metodo, pagado_at)
    VALUES ((p_apartado->>'customer_id')::bigint, p_branch_id, 'sucursal', (p_apartado->>'producto_id')::bigint,
        left(btrim(p_apartado->>'producto_nombre'), 200), (p_apartado->>'cantidad')::integer,
        greatest(coalesce((p_apartado->>'factor')::integer, 1), 1),
        round((p_apartado->>'precio')::numeric, 2), round((p_apartado->>'precio')::numeric, 2), 'lista', 'sucursal-v2',
        round(p_monto, 2), now(), now() + interval '7 days', p_employee,
        CASE WHEN round(p_monto, 2) >= v_total - 0.004 THEN 'pagado' ELSE 'anticipo' END, v_metodo, now())
    RETURNING id, anticipo, vence_at INTO v_id, v_anticipo, v_vence;
    UPDATE public.caja_movimientos_portal SET reserva_id = v_id WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'reserva', 'id', v_id, 'codigo', 'R-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', v_anticipo, 'saldo', round(v_total - v_anticipo, 2), 'vence_at', v_vence);

  ELSIF v_modo = 'reserva' THEN
    v_id := (p_apartado->>'reserva_id')::bigint;
    UPDATE public.app_reservas
       SET anticipo = round(coalesce(anticipo, 0) + p_monto, 2),
           pago_estado = CASE WHEN round(coalesce(anticipo, 0) + p_monto, 2) >= v_total - 0.004 THEN 'pagado' ELSE 'anticipo' END,
           pago_metodo = CASE WHEN pago_metodo IS NULL OR pago_metodo = v_metodo THEN v_metodo ELSE 'mixto' END,
           pagado_at = now(), updated_at = now()
     WHERE id = v_id
    RETURNING anticipo, vence_at INTO v_anticipo, v_vence;
    UPDATE public.caja_movimientos_portal SET reserva_id = v_id WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'reserva', 'id', v_id, 'codigo', 'R-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', v_anticipo, 'saldo', round(v_total - v_anticipo, 2), 'vence_at', v_vence);

  ELSE
    v_id := (p_apartado->>'encargo_id')::bigint;
    UPDATE public.app_encargos SET pago_estado = 'pagado', pagado_at = now(), estado = 'aceptado', updated_at = now()
     WHERE id = v_id;
    UPDATE public.caja_movimientos_portal SET encargo_id = v_id WHERE id = p_movimiento;
    RETURN json_build_object('tipo', 'encargo', 'id', v_id, 'codigo', 'E-' || lpad(v_id::text, 6, '0'),
      'total', v_total, 'anticipo', v_total, 'saldo', 0);
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.apartado_aplicar(bigint, jsonb, bigint, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_aplicar(bigint, jsonb, bigint, numeric, text, uuid) TO service_role;

-- ── El precio de un encargo lo confirma Compras o administración ───────────
-- (decisión del usuario, 2026-10-20). La sala lo registra y lo cobra; poner
-- precio y fecha, o rechazarlo, es de Bodega o de quien edita las ofertas.
DO $do$
DECLARE v text := pg_get_functiondef('public.encargo_responder(bigint, text, numeric, date, text)'::regprocedure); v2 text;
BEGIN
  v2 := replace(v, $a$  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;$a$,
                   $b$  IF NOT public.encargo_puede_manejar(e.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  -- Precio y fecha (o el rechazo) los decide Compras o administración, no la sala.
  IF p_accion IN ('confirmar', 'rechazar')
     AND NOT ((SELECT public.auth_employee_branch_id()) IN (SELECT id FROM public.branches WHERE type = 'BODEGA')
              OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'El precio de un encargo lo confirma Compras o administración.' USING ERRCODE = '42501';
  END IF;$b$);
  IF v2 = v THEN RAISE EXCEPTION 'encargo_responder: no se encontró la guarda'; END IF;
  EXECUTE v2;
END $do$;

-- ── Deshacer o corregir un anticipo ────────────────────────────────────────
-- `operar-caja` aplica el anticipo ANTES de mandar el efectivo a la caja (así
-- el concepto lleva el código de la reserva). Si la caja lo rechaza, el
-- dinero no entró: esto devuelve la reserva o el encargo a como estaban y anula
-- el movimiento. También lo usa la ANULACIÓN aprobada de un anticipo
-- (`p_anular = false`: el movimiento ya lo anula quien llama). Una reserva
-- NACIDA de ese cobro se borra.
CREATE OR REPLACE FUNCTION public.apartado_deshacer(p_movimiento bigint, p_anular boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE m public.caja_movimientos_portal%ROWTYPE; r public.app_reservas;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF m.reserva_id IS NOT NULL THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = m.reserva_id FOR UPDATE;
    IF FOUND THEN
      IF NOT EXISTS (SELECT 1 FROM public.caja_movimientos_portal x
                      WHERE x.reserva_id = r.id AND x.id <> m.id AND x.anulado_at IS NULL) THEN
        UPDATE public.caja_movimientos_portal SET reserva_id = NULL WHERE id = m.id;
        DELETE FROM public.app_reservas WHERE id = r.id;     -- nació de este cobro
      ELSE
        UPDATE public.app_reservas
           SET anticipo = greatest(round(coalesce(anticipo, 0) - m.monto, 2), 0), pago_estado = 'anticipo', updated_at = now()
         WHERE id = r.id;
      END IF;
    END IF;
  END IF;
  IF m.encargo_id IS NOT NULL THEN
    UPDATE public.app_encargos SET pago_estado = 'pendiente', pagado_at = NULL, estado = 'confirmado', updated_at = now()
     WHERE id = m.encargo_id AND estado = 'aceptado';
  END IF;
  IF p_anular THEN
    UPDATE public.caja_movimientos_portal
       SET anulado_at = now(), anulado_motivo = 'La caja no aceptó el cobro', reserva_id = NULL, encargo_id = NULL, updated_at = now()
     WHERE id = p_movimiento;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.apartado_deshacer(bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_deshacer(bigint, boolean) TO service_role;

-- Una corrección APROBADA del monto de un anticipo mueve el anticipo de su
-- reserva por la diferencia. Un encargo se paga completo: ahí no se corrige el
-- monto (se anula y se vuelve a cobrar).
CREATE OR REPLACE FUNCTION public.apartado_cambiar_monto(p_movimiento bigint, p_antes numeric, p_nuevo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE m public.caja_movimientos_portal%ROWTYPE;
BEGIN
  SELECT * INTO m FROM public.caja_movimientos_portal WHERE id = p_movimiento;
  IF NOT FOUND OR m.reserva_id IS NULL THEN RETURN; END IF;
  UPDATE public.app_reservas
     SET anticipo = greatest(round(coalesce(anticipo, 0) + (p_nuevo - p_antes), 2), 0),
         pago_estado = CASE WHEN round(coalesce(anticipo, 0) + (p_nuevo - p_antes), 2) >= round(precio_unitario * cantidad, 2) - 0.004
                            THEN 'pagado' ELSE 'anticipo' END,
         updated_at = now()
   WHERE id = m.reserva_id;
END $function$;
REVOKE ALL ON FUNCTION public.apartado_cambiar_monto(bigint, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_cambiar_monto(bigint, numeric, numeric) TO service_role;

-- El «Abono para apartar» viejo deja de ofrecerse: «Apartar o encargar» lo
-- reemplaza. Los abonos que ya existen siguen en `abonos_de_cliente`.
UPDATE public.caja_tipos_movimiento SET activo = false WHERE codigo = 'ABONO_CLIENTE' AND activo;
