-- El saldo a favor de una reserva funciona como un CRÉDITO (decisión del
-- usuario, 2026-10-21): se usa por partes hasta que se acaba o vence, y en caja
-- se descuenta COMO PUNTOS — el mismo camino del canje: la sala convierte el
-- monto en puntos del cliente (un lote de origen 'saldo_favor' que vence con el
-- saldo), la caja aplica el descuento de puntos, y `puntos_registrar_canje` lo
-- detecta en la factura y consume ESE lote primero. Así el corte lo ve igual
-- que cualquier canje: un descuento en la factura, no efectivo.
--
-- Y antes de usarlo se CONFIRMA al titular en el servidor (tarjeta de Puntos
-- Salud / QR de la app, DUI o teléfono de la ficha): el código R-…/P-… solo no
-- alcanza — es corto y se adivina —. `saldo_favor_buscar` con sólo el código
-- ya no dice de quién es ni cuánto tiene.
SET lock_timeout = '5s';

-- ── El saldo vivo y su libro ───────────────────────────────────────────────
-- `saldo_favor` pasa a ser lo que QUEDA; lo que nació queda en
-- `saldo_favor_inicial` (se llena la primera vez que se mueve).
ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS saldo_favor_inicial numeric(12,2);

CREATE TABLE IF NOT EXISTS public.saldo_favor_movimientos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reserva_id      bigint NOT NULL REFERENCES public.app_reservas(id) ON DELETE RESTRICT,
  tipo            text   NOT NULL CHECK (tipo IN ('uso', 'devolucion', 'vencimiento')),
  monto           numeric(12,2) NOT NULL CHECK (monto > 0),
  saldo_despues   numeric(12,2) NOT NULL CHECK (saldo_despues >= 0),
  branch_id       bigint REFERENCES public.branches(id),
  employee_id     uuid   REFERENCES public.employees(id),
  -- El lote de puntos en que se convirtió (sólo 'uso') y la factura donde la
  -- caja lo descontó: la pone `puntos_consumir_canje` al detectar el canje.
  puntos_lote_id  bigint REFERENCES public.puntos_lote(id) ON DELETE SET NULL,
  invoice_id      bigint,
  confirmado_con  text CHECK (confirmado_con IN ('tarjeta', 'dui', 'telefono')),
  nota            text
);
COMMENT ON TABLE public.saldo_favor_movimientos IS
  'Libro del saldo a favor de las reservas (2026-10-21): cada uso (convertido en puntos), devolución en dinero y vencimiento. Historial de negocio: no se purga.';
CREATE INDEX IF NOT EXISTS saldo_favor_movimientos_reserva_idx ON public.saldo_favor_movimientos (reserva_id, created_at);
CREATE INDEX IF NOT EXISTS saldo_favor_movimientos_branch_idx  ON public.saldo_favor_movimientos (branch_id);
CREATE INDEX IF NOT EXISTS saldo_favor_movimientos_employee_idx ON public.saldo_favor_movimientos (employee_id);
CREATE INDEX IF NOT EXISTS saldo_favor_movimientos_lote_idx    ON public.saldo_favor_movimientos (puntos_lote_id) WHERE puntos_lote_id IS NOT NULL;
ALTER TABLE public.saldo_favor_movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saldo_favor_movimientos_select ON public.saldo_favor_movimientos;
CREATE POLICY saldo_favor_movimientos_select ON public.saldo_favor_movimientos FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('dash_reservas', 'can_view')));
-- Sin policies de escritura: sólo lo escriben las funciones de abajo.
REVOKE ALL ON public.saldo_favor_movimientos FROM anon;

-- El lote de puntos de un saldo a favor.
ALTER TABLE public.puntos_lote DROP CONSTRAINT IF EXISTS puntos_lote_origen_check;
ALTER TABLE public.puntos_lote ADD CONSTRAINT puntos_lote_origen_check CHECK (origen = ANY (ARRAY[
  'venta', 'ajuste', 'migracion', 'cumpleanos', 'venta_pasada', 'referido', 'cupon', 'saldo_favor'])) NOT VALID;

-- ── ¿La prueba que da la sala es del titular? ─────────────────────────────
-- La tarjeta de Puntos Salud (o el QR de la app, que lleva el mismo código),
-- el DUI o el teléfono de la ficha. Devuelve CÓMO se confirmó, o NULL. Mismas
-- reglas de lectura que `cliente_por_tarjeta`. No se expone: contestaría «¿este
-- DUI es de este cliente?» a cualquiera.
CREATE OR REPLACE FUNCTION public.cliente_confirma(p_customer_id bigint, p_prueba text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_txt text := left(btrim(coalesce(p_prueba, '')), 300);
  v_cod text; v_num text; v_tit bigint;
BEGIN
  IF p_customer_id IS NULL OR v_txt = '' THEN RETURN NULL; END IF;
  IF v_txt ~* '[?&]codigo=' THEN
    v_txt := coalesce(substring(v_txt FROM '(?i)[?&]codigo=([^&#[:space:]]*)'), '');
  END IF;
  v_cod := upper(regexp_replace(v_txt, '[^A-Za-z0-9]', '', 'g'));
  v_num := regexp_replace(v_txt, '\D', '', 'g');
  v_tit := public.puntos_titular(p_customer_id);

  IF v_cod ~ '^[ACDEFGHJKMNPQRTUVWXY34679]{7}$' THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM public.puntos_codigo_acceso k
                              WHERE k.codigo = v_cod AND k.customer_id IN (p_customer_id, v_tit))
                THEN 'tarjeta' END;
  ELSIF v_cod ~ '^[0-9]+$' AND length(v_num) = 9 THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM public.customers c WHERE c.id IN (p_customer_id, v_tit)
                              AND regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') = v_num)
                THEN 'dui' END;
  ELSIF v_cod ~ '^[0-9]+$' AND length(v_num) BETWEEN 8 AND 11 THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM public.customers c WHERE c.id IN (p_customer_id, v_tit)
                              AND right(v_num, 8) IN (right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8),
                                                      right(regexp_replace(coalesce(c.telefono2, ''), '\D', '', 'g'), 8))
                              AND length(regexp_replace(coalesce(c.phone, '') || coalesce(c.telefono2, ''), '\D', '', 'g')) >= 8)
                THEN 'telefono' END;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.cliente_confirma(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_confirma(bigint, text) TO service_role;

-- ── Buscar un saldo por su código: lo mínimo hasta confirmar ──────────────
DROP FUNCTION IF EXISTS public.saldo_favor_buscar(text);
CREATE FUNCTION public.saldo_favor_buscar(p_codigo text, p_prueba text DEFAULT NULL)
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
    SELECT json_agg(CASE WHEN x.modo IS NULL
      -- Sin confirmar: que existe y dónde nació. Ni el nombre ni el monto.
      THEN json_build_object('id', x.id, 'pedido', x.pedido, 'branch_id', x.branch_id, 'sala', x.sala,
                             'saldo_favor_vence', x.saldo_favor_vence, 'confirmado', false)
      ELSE json_build_object('id', x.id, 'estado', x.estado, 'pedido', x.pedido, 'branch_id', x.branch_id, 'sala', x.sala,
             'cliente', x.cliente, 'producto', x.producto_nombre, 'cantidad', x.cantidad,
             'saldo_favor', x.saldo_favor, 'saldo_favor_inicial', coalesce(x.saldo_favor_inicial, x.saldo_favor),
             'saldo_favor_vence', x.saldo_favor_vence, 'saldo_favor_origen', x.saldo_favor_origen,
             'saldo_favor_usado_at', x.saldo_favor_usado_at, 'saldo_favor_devuelto_at', x.saldo_favor_devuelto_at,
             'confirmado', true, 'confirmado_con', x.modo) END ORDER BY x.id)
      FROM (SELECT r.*, b.name AS sala, c.name AS cliente, public.cliente_confirma(r.customer_id, p_prueba) AS modo
              FROM public.app_reservas r
              JOIN public.customers c ON c.id = r.customer_id
              JOIN public.branches b ON b.id = r.branch_id
             WHERE (r.id = v_id OR (v_id IS NULL AND r.pedido = v))
               AND coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL AND r.saldo_favor_devuelto_at IS NULL
               AND r.saldo_favor_vence >= (now() AT TIME ZONE 'America/El_Salvador')::date) x), '[]'::json);
END $function$;
REVOKE EXECUTE ON FUNCTION public.saldo_favor_buscar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saldo_favor_buscar(text, text) TO authenticated, service_role;

-- ── Usar una parte del saldo: se convierte en puntos ──────────────────────
DROP FUNCTION IF EXISTS public.reserva_usar_saldo_favor(bigint);
CREATE FUNCTION public.reserva_usar_saldo_favor(p_id bigint, p_monto numeric, p_prueba text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.app_reservas;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_quien uuid := public.auth_employee_id();
  v_sala bigint;
  v_cli public.customers;
  v_tit bigint;
  v_modo text;
  v_monto numeric(12,2) := round(coalesce(p_monto, 0), 2);
  v_puntos integer;
  v_queda numeric(12,2);
  v_lote bigint;
  v_codigo text;
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe esa reserva'; END IF;
  -- El saldo vale en cualquier sala: basta poder manejar reservas en la propia.
  IF NOT (public.reserva_puede_manejar(r.branch_id) OR public.auth_can_edit_any(ARRAY['dash_reservas'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(r.saldo_favor, 0) <= 0 THEN RAISE EXCEPTION 'Esa reserva no tiene saldo a favor'; END IF;
  IF r.saldo_favor_usado_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se usó'; END IF;
  IF r.saldo_favor_devuelto_at IS NOT NULL THEN RAISE EXCEPTION 'Ese saldo a favor ya se devolvió en dinero'; END IF;
  IF r.saldo_favor_vence < v_hoy THEN RAISE EXCEPTION 'Ese saldo a favor ya venció'; END IF;

  v_modo := public.cliente_confirma(r.customer_id, p_prueba);
  IF v_modo IS NULL THEN
    RAISE EXCEPTION 'No se pudo confirmar que sea el titular: escanea su tarjeta de Puntos Salud o escribe el DUI o el teléfono de su ficha.';
  END IF;
  IF v_monto <= 0 THEN RAISE EXCEPTION 'Escribe cuánto se usa.'; END IF;
  IF v_monto > r.saldo_favor THEN
    RAISE EXCEPTION 'Tiene % a favor: no se pueden usar %.', to_char(r.saldo_favor, 'FM$999,990.00'), to_char(v_monto, 'FM$999,990.00');
  END IF;

  SELECT * INTO v_cli FROM public.customers WHERE id = r.customer_id;
  -- Se descuenta como un canje de puntos: una ficha que no canjea (convenio)
  -- nunca lo vería registrado.
  IF NOT coalesce(v_cli.acumula_puntos, true) THEN
    RAISE EXCEPTION 'Esta ficha no usa puntos: el saldo a favor no se puede descontar en caja.';
  END IF;
  IF public.puntos_fuente() <> 'portal' THEN
    RAISE EXCEPTION 'El programa de puntos no está en el portal: el saldo a favor no se puede descontar.';
  END IF;

  v_sala := coalesce(public.empleado_sala_de_hoy(NULL, v_hoy), public.auth_employee_branch_id());
  v_codigo := coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0'));
  v_puntos := round(v_monto * 100)::integer;
  v_tit := public.puntos_titular(r.customer_id);

  INSERT INTO public.puntos_cuenta (customer_id) VALUES (v_tit) ON CONFLICT (customer_id) DO NOTHING;
  PERFORM 1 FROM public.puntos_cuenta WHERE customer_id = v_tit FOR UPDATE;
  INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, sucursal, motivo, creado_por)
  VALUES (v_tit, 'saldo_favor', v_puntos, v_puntos, v_hoy, greatest(r.saldo_favor_vence, v_hoy),
          (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = v_sala),
          'Saldo a favor de la reserva ' || v_codigo, v_quien)
  RETURNING id INTO v_lote;
  UPDATE public.puntos_cuenta SET saldo = saldo + v_puntos, ganados = ganados + v_puntos, updated_at = now()
   WHERE customer_id = v_tit;

  v_queda := r.saldo_favor - v_monto;
  UPDATE public.app_reservas
     SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
         saldo_favor = v_queda,
         saldo_favor_usado_at     = CASE WHEN v_queda <= 0 THEN now() ELSE saldo_favor_usado_at END,
         saldo_favor_usado_por    = CASE WHEN v_queda <= 0 THEN v_quien ELSE saldo_favor_usado_por END,
         saldo_favor_usado_branch = CASE WHEN v_queda <= 0 THEN v_sala ELSE saldo_favor_usado_branch END,
         updated_at = now()
   WHERE id = p_id;

  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, puntos_lote_id, confirmado_con)
  VALUES (p_id, 'uso', v_monto, v_queda, v_sala, v_quien, v_lote, v_modo);

  INSERT INTO public.audit_logs (action, target_id, details, branch_id, user_id)
  VALUES ('RESERVA_SALDO_FAVOR_USADO', p_id::text,
          jsonb_build_object('monto', v_monto, 'queda', v_queda, 'puntos', v_puntos, 'lote', v_lote,
                             'confirmado_con', v_modo, 'sala_de_la_reserva', r.branch_id),
          v_sala, v_quien);

  RETURN json_build_object('ok', true, 'monto', v_monto, 'puntos', v_puntos, 'queda', v_queda,
                           'cliente', v_cli.name, 'codigo', v_codigo, 'confirmado_con', v_modo);
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_usar_saldo_favor(bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserva_usar_saldo_favor(bigint, numeric, text) TO authenticated, service_role;

-- ── Devolver en dinero: lo que QUEDA, y al libro ─────────────────────────
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
  -- Se devuelve lo que queda (2026-10-21): lo ya usado se convirtió en puntos.
  UPDATE public.app_reservas
     SET saldo_favor_inicial = coalesce(saldo_favor_inicial, saldo_favor),
         saldo_favor_devuelto_at = now(), saldo_favor_devuelto_por = public.auth_employee_id(),
         saldo_favor_devuelto_monto = r.saldo_favor, saldo_favor_devuelto_motivo = left(v_motivo, 300), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
  VALUES (p_id, 'devolucion', r.saldo_favor, 0,
          coalesce(public.empleado_sala_de_hoy(NULL, (now() AT TIME ZONE 'America/El_Salvador')::date), public.auth_employee_branch_id()),
          public.auth_employee_id(), left(v_motivo, 300));
  RETURN json_build_object('ok', true, 'monto', r.saldo_favor);
END $function$;

-- ── El canje consume primero el saldo a favor, y anota la factura ─────────
CREATE OR REPLACE FUNCTION public.puntos_consumir_canje(p_customer_id bigint, p_puntos integer, p_salida_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET enable_seqscan TO 'off'
AS $function$
DECLARE
  v_falta integer := p_puntos;
  v_toma  integer;
  r       record;
BEGIN
  IF p_puntos <= 0 THEN RETURN 0; END IF;
  -- Una cuenta unida a otra consume de la que se queda (2026-10-15).
  p_customer_id := public.puntos_titular(p_customer_id);
  -- Orden (2026-10-21): el saldo a favor de una reserva primero —la sala lo
  -- convirtió para descontarlo en ESTA compra—, después el cupón, y lo demás
  -- del más viejo al más nuevo.
  FOR r IN
    SELECT id, restantes, origen FROM public.puntos_lote
    WHERE customer_id = p_customer_id AND restantes > 0
    ORDER BY (origen = 'saldo_favor') DESC, (origen = 'cupon') DESC, ganado_el, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_falta <= 0;
    v_toma := least(v_falta, r.restantes);
    UPDATE public.puntos_lote SET restantes = restantes - v_toma WHERE id = r.id;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos)
      VALUES (p_salida_id, r.id, v_toma)
      ON CONFLICT (salida_id, lote_id) DO UPDATE SET puntos = puntos_salida_lote.puntos + EXCLUDED.puntos;
    IF r.origen = 'saldo_favor' THEN
      UPDATE public.saldo_favor_movimientos m SET invoice_id = s.invoice_id
        FROM public.puntos_salida s
       WHERE s.id = p_salida_id AND m.puntos_lote_id = r.id AND m.invoice_id IS NULL;
    END IF;
    v_falta := v_falta - v_toma;
  END LOOP;
  RETURN p_puntos - v_falta;
END;
$function$;

-- ── En el estado de cuenta y en el panel, el lote se llama por su nombre ──
CREATE OR REPLACE FUNCTION public.puntos_estado_cuenta(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  SELECT json_build_object(
    'customer_id', p_customer_id,
    'saldo',   coalesce((SELECT saldo   FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'ganados', coalesce((SELECT ganados FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'usados',  coalesce((SELECT usados  FROM public.puntos_cuenta WHERE customer_id = p_customer_id), 0),
    'vencimientos', coalesce((
      SELECT json_agg(to_json(x) ORDER BY x.vence_el)
      FROM (SELECT vence_el, sum(restantes)::int AS puntos
              FROM public.puntos_lote
             WHERE customer_id = p_customer_id AND restantes > 0
             GROUP BY vence_el) x), '[]'::json),
    'movimientos', coalesce((
      SELECT json_agg(to_json(m) ORDER BY m.fecha DESC, m.id DESC)
      FROM (
        SELECT id, CASE WHEN origen = 'ajuste' THEN 'ajuste'
                        WHEN origen = 'saldo_favor' THEN 'saldo_favor'
                        WHEN origen = 'referido' THEN 'referido'
                        WHEN origen = 'cumpleanos' OR motivo ILIKE 'cortes%cumple%' THEN 'cumpleanos'
                        ELSE 'compra' END::text AS tipo,
               ganado_el AS fecha, sucursal, puntos,
               CASE WHEN origen = 'venta' THEN NULL ELSE motivo END AS motivo
          FROM public.puntos_lote   WHERE customer_id = p_customer_id
        UNION ALL
        SELECT s.id, s.tipo,
               CASE WHEN s.tipo = 'canje' AND si.fecha IS NOT NULL THEN si.fecha
                    ELSE (s.created_at AT TIME ZONE 'America/El_Salvador')::date END,
               s.sucursal, -s.puntos, s.motivo
          FROM public.puntos_salida s
          LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
         WHERE s.customer_id = p_customer_id
        UNION ALL
        SELECT id, 'canje_devuelto', (revertida_at AT TIME ZONE 'America/El_Salvador')::date, sucursal, puntos,
               'la factura del canje se anuló'
          FROM public.puntos_salida
         WHERE customer_id = p_customer_id AND tipo = 'canje' AND revertida_at IS NOT NULL
      ) m), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puntos_panel_cliente(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_consulta', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para consultar puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT json_build_object(
    'cliente', (SELECT json_build_object('id', c.id, 'nombre', c.name, 'dui', c.dui, 'telefono', c.phone,
                                         'correo', c.email, 'acumula', coalesce(c.acumula_puntos, true))
                  FROM public.customers c WHERE c.id = p_customer_id),
    'cuenta', public.puntos_estado_cuenta(p_customer_id),
    'salas', (SELECT coalesce(json_object_agg(b.codigo_puntos, b.name), '{}'::json)
                FROM public.branches b WHERE b.codigo_puntos IS NOT NULL),
    'cuentas_anteriores', (
      SELECT coalesce(json_agg(json_build_object('id', a.id_cliente, 'como', a.asignada_como,
                                                 'cuando', a.asignada_at, 'nota', a.asignada_nota,
                                                 'saldo_alla', a.puntos) ORDER BY a.id_cliente), '[]'::json)
        FROM public.puntos_archivo_cliente a
        JOIN public.puntos_archivo_carga k ON k.id = a.carga_id AND k.completa
       WHERE a.asignada_a = p_customer_id),
    -- La clave es la misma que arma el detalle: `<tipo>-<id>`. Un canje
    -- devuelto usa la de su canje.
    'detalle', (SELECT coalesce(json_object_agg(d.clave, json_build_object(
                   'documento', d.documento, 'invoice_id', d.invoice_id, 'total', d.total,
                   'quien', d.quien, 'quien_id', d.quien_id, 'rol', d.rol)), '{}'::json)
      FROM (
        SELECT (CASE WHEN l.origen = 'ajuste' THEN 'ajuste'
                     WHEN l.origen = 'saldo_favor' THEN 'saldo_favor'
                     WHEN l.origen = 'cumpleanos' OR l.motivo ILIKE 'cortes%cumple%' THEN 'cumpleanos'
                     ELSE 'compra' END) || '-' || l.id AS clave,
               coalesce(si.correlativo, substring(l.motivo FROM 'ticket ([0-9A-Za-z-]+)'),
                        substring(l.motivo FROM '^(DTE-[0-9]+)')) AS documento,
               si.id AS invoice_id,
               si.total AS total,
               CASE WHEN l.origen IN ('ajuste', 'saldo_favor') THEN ea.name
                    WHEN l.origen = 'cumpleanos' OR l.motivo ILIKE 'cortes%cumple%' THEN 'Automático'
                    ELSE ev.name END AS quien,
               CASE WHEN l.origen IN ('ajuste', 'saldo_favor') THEN ea.id ELSE ev.id END AS quien_id,
               CASE WHEN l.origen = 'ajuste' THEN 'ajustó'
                    WHEN l.origen = 'saldo_favor' THEN 'lo aplicó'
                    WHEN l.origen = 'cumpleanos' OR l.motivo ILIKE 'cortes%cumple%' THEN NULL
                    ELSE 'vendió' END AS rol
          FROM public.puntos_lote l
          -- Dos búsquedas por índice (id, o el erp_invoice_id único) y no un
          -- OR en el join, que obligaría a recorrer las facturas.
          LEFT JOIN LATERAL (
            SELECT x.* FROM (
              SELECT si2.* FROM public.sales_invoices si2 WHERE si2.id = l.invoice_id
              UNION ALL
              SELECT si3.* FROM public.sales_invoices si3
               WHERE l.invoice_id IS NULL AND l.origen = 'migracion'
                 AND si3.erp_invoice_id = substring(l.motivo FROM 'ticket 0*([0-9]+)')
                 -- Los números de ticket viejos se repiten con los nuevos: se
                 -- exige la misma sala y que la factura sea del mismo día o de
                 -- hasta 90 antes (el cliente presentaba el ticket después).
                 -- Medido: 89% de las compras migradas desde may-2025.
                 AND si3.fecha BETWEEN l.ganado_el - 90 AND l.ganado_el + 1
                 AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = si3.branch_id
                              AND l.sucursal IN (b.codigo_puntos, b.codigo_puntos_previo))
            ) x LIMIT 1) si ON true
          LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                              WHERE e.code = si.cod_vendedor LIMIT 1) ev ON true
          LEFT JOIN public.employees ea ON ea.id = l.creado_por
         WHERE l.customer_id = p_customer_id
        UNION ALL
        SELECT s.tipo || '-' || s.id,
               coalesce(si.correlativo, substring(s.motivo FROM 'ticket ([0-9A-Za-z-]+)')),
               si.id,
               si.total,
               CASE WHEN s.tipo = 'ajuste' THEN ea.name
                    WHEN s.tipo IN ('canje', 'anulacion') THEN ev.name END,
               CASE WHEN s.tipo = 'ajuste' THEN ea.id
                    WHEN s.tipo IN ('canje', 'anulacion') THEN ev.id END,
               CASE WHEN s.tipo = 'ajuste' THEN 'ajustó'
                    WHEN s.tipo IN ('canje', 'anulacion') THEN 'vendió' END
          FROM public.puntos_salida s
          LEFT JOIN LATERAL (
            SELECT x.* FROM (
              SELECT si2.* FROM public.sales_invoices si2 WHERE si2.id = s.invoice_id
              UNION ALL
              SELECT si3.* FROM public.sales_invoices si3
               WHERE s.invoice_id IS NULL AND s.tipo = 'canje' AND si3.has_puntos
                 AND si3.erp_invoice_id = substring(s.motivo FROM 'ticket DTE-0*([0-9]+)')
                 AND si3.fecha BETWEEN (s.created_at AT TIME ZONE 'America/El_Salvador')::date - 1
                                   AND (s.created_at AT TIME ZONE 'America/El_Salvador')::date + 1
                 AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = si3.branch_id
                              AND s.sucursal IN (b.codigo_puntos, b.codigo_puntos_previo))
            ) x LIMIT 1) si ON true
          LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                              WHERE e.code = si.cod_vendedor LIMIT 1) ev ON true
          LEFT JOIN public.employees ea ON ea.id = s.autorizado_por
         WHERE s.customer_id = p_customer_id
      ) d)
  ) INTO v;
  RETURN v;
END;
$function$;
