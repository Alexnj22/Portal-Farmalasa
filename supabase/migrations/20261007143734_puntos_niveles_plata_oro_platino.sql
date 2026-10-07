SET lock_timeout = '5s';

-- Niveles del programa (aprobados por el usuario el 2026-10-07, plan de la app):
-- el nivel sale de lo COMPRADO en los 12 meses anteriores y multiplica los
-- puntos de cada compra. Se calcula en vivo por cliente (índice
-- idx_sales_invoices_cliente_fecha), sin tabla que mantener: así nunca queda
-- atrasado. La compra que cruza el umbral no se premia a sí misma; desde la
-- siguiente, sí.
CREATE TABLE public.puntos_niveles (
    clave              text PRIMARY KEY CHECK (clave IN ('vip', 'plata', 'oro', 'platino')),
    nombre             text NOT NULL,
    desde              numeric(12,2) NOT NULL CHECK (desde >= 0),
    factor             numeric(4,2) NOT NULL CHECK (factor >= 1 AND factor <= 5),
    puntos_cumpleanos  integer NOT NULL CHECK (puntos_cumpleanos >= 0),
    horas_reserva      integer NOT NULL DEFAULT 24 CHECK (horas_reserva BETWEEN 1 AND 168),
    orden              integer NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.puntos_niveles (clave, nombre, desde, factor, puntos_cumpleanos, horas_reserva, orden) VALUES
  ('vip',     'Cliente VIP',    0, 1.00,  50, 24, 0),
  ('plata',   'Plata',        500, 1.25,  75, 24, 1),
  ('oro',     'Oro',         1000, 1.50, 100, 48, 2),
  ('platino', 'Platino',     2000, 2.00, 100, 48, 3);

ALTER TABLE public.puntos_niveles ENABLE ROW LEVEL SECURITY;
CREATE POLICY puntos_niveles_select ON public.puntos_niveles FOR SELECT TO authenticated USING (true);
CREATE POLICY puntos_niveles_update ON public.puntos_niveles FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['puntos'])))
  WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['puntos'])));

-- Lo comprado en los 365 días que terminan en `p_hasta` (sin `p_excluir`: la
-- compra que se está premiando no cuenta para su propio nivel).
CREATE FUNCTION public.puntos_compra_12m(p_customer_id bigint, p_hasta date, p_excluir bigint DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
BEGIN
  RETURN coalesce((
    SELECT sum(si.total) FROM public.sales_invoices si
     WHERE si.customer_id = p_customer_id
       AND si.fecha > p_hasta - 365 AND si.fecha <= p_hasta
       AND (p_excluir IS NULL OR si.id <> p_excluir)
       AND public.venta_valida(si.estado)), 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_compra_12m(bigint, date, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_compra_12m(bigint, date, bigint) TO service_role;

-- El nivel que corresponde a una compra de 12 meses.
CREATE FUNCTION public.puntos_nivel_de(p_compra numeric)
RETURNS public.puntos_niveles LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT n.* FROM public.puntos_niveles n WHERE n.desde <= coalesce(p_compra, 0) ORDER BY n.desde DESC LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_nivel_de(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_nivel_de(numeric) TO service_role;

-- El lote guarda los puntos BASE (1 por dólar) y el nivel que los multiplicó:
-- la auditoría puede reconstruir cualquier lote.
ALTER TABLE public.puntos_lote
    ADD COLUMN puntos_base integer,
    ADD COLUMN nivel text REFERENCES public.puntos_niveles(clave);

-- El motor: igual que antes, con el multiplicador del nivel. Partiendo de la
-- definición viva.
CREATE OR REPLACE FUNCTION public.puntos_acumular(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 20000, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_leidas integer := 0; v_nuevas integer := 0; v_puntos bigint := 0;
  v_ya integer := 0; v_sin_ficha integer := 0;
  r record; v_lote bigint;
  v_nivel public.puntos_niveles; v_pts integer;
BEGIN
  -- El piso del arranque: lo anterior ya está en el historial migrado.
  p_desde := public.puntos_desde_efectivo(p_desde);
  IF p_desde > p_hasta THEN
    RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
      'leidas', 0, 'nuevas', 0, 'puntos', 0, 'ya_tenian_lote', 0, 'sin_ficha', 0,
      'tope_alcanzado', false, 'antes_del_inicio', true);
  END IF;

  FOR r IN
    SELECT * FROM json_to_recordset(
      public.ventas_elegibles_puntos(p_desde, p_hasta, p_margen, p_tope)
    ) AS x(invoice_id bigint, sucursal text, erp_invoice_id text, correlativo text,
           customer_id bigint, cod_vendedor int, total numeric, fecha date, puntos int)
  LOOP
    v_leidas := v_leidas + 1;

    -- Sin ficha no hay a quién acreditarle. Medido: 0 de 4,009 en la semana de
    -- prueba, pero una venta sin cliente no puede tumbar la corrida.
    IF r.customer_id IS NULL THEN v_sin_ficha := v_sin_ficha + 1; CONTINUE; END IF;

    -- La exclusión propia del circuito nuevo: la bitácora vieja no se mira. El
    -- índice único sobre invoice_id lo garantiza igual; esto sólo evita el
    -- trabajo y deja el conteo limpio.
    IF EXISTS (SELECT 1 FROM public.puntos_lote WHERE invoice_id = r.invoice_id) THEN
      v_ya := v_ya + 1; CONTINUE;
    END IF;

    -- El nivel (2026-10-07): lo comprado en los 12 meses hasta ese día, sin
    -- contar esta venta. «Las fracciones no acumulan»: hacia abajo.
    v_nivel := public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id, r.fecha, r.invoice_id));
    v_pts := greatest(floor(r.puntos * coalesce(v_nivel.factor, 1))::int, r.puntos);

    v_nuevas := v_nuevas + 1;
    v_puntos := v_puntos + v_pts;
    CONTINUE WHEN p_simular;

    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.customer_id)
      ON CONFLICT (customer_id) DO NOTHING;

    INSERT INTO public.puntos_lote
      (customer_id, origen, invoice_id, sucursal, puntos, restantes, ganado_el, vence_el, puntos_base, nivel)
    VALUES (r.customer_id, 'venta', r.invoice_id, r.sucursal, v_pts, v_pts,
            r.fecha, public.puntos_vence_el(r.fecha), r.puntos, coalesce(v_nivel.clave, 'vip'))
    RETURNING id INTO v_lote;

    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;

  RETURN json_build_object(
    'simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'leidas', v_leidas, 'nuevas', v_nuevas, 'puntos', v_puntos,
    'ya_tenian_lote', v_ya, 'sin_ficha', v_sin_ficha,
    'tope_alcanzado', v_leidas >= p_tope
  );
END;
$function$;

-- El cumpleaños según el nivel (50 / 75 / 100 / 100). Partiendo de la viva:
-- `puntos_config.puntos_cumpleanos` sigue siendo el interruptor (en 0, nada).
CREATE OR REPLACE FUNCTION public.puntos_dar_cumpleanos(p_dia date DEFAULT NULL::date, p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_pts integer;
  v_bisiesto boolean;
  r record; v_n integer := 0; v_total bigint := 0;
  v_mios integer;
BEGIN
  -- Antes del arranque los regala el sistema anterior: dos a la vez daría dos.
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  SELECT puntos_cumpleanos INTO v_pts FROM public.puntos_config WHERE id;
  IF coalesce(v_pts, 0) <= 0 THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'puntos_cumpleanos en 0');
  END IF;
  v_bisiesto := (date_part('year', v_dia)::int % 4 = 0 AND date_part('year', v_dia)::int % 100 <> 0)
                OR date_part('year', v_dia)::int % 400 = 0;

  FOR r IN
    SELECT c.id
      FROM public.customers c
     WHERE c.fecha_nacimiento IS NOT NULL
       AND coalesce(c.acumula_puntos, true)
       -- Tampoco se le regala a quien salió del programa (2026-09-28).
       AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND (to_char(c.fecha_nacimiento, 'MM-DD') = to_char(v_dia, 'MM-DD')
            -- El 29 de febrero, en un año que no lo tiene, cumple el 28.
            OR (NOT v_bisiesto AND to_char(v_dia, 'MM-DD') = '02-28'
                AND to_char(c.fecha_nacimiento, 'MM-DD') = '02-29'))
       -- Ya regalado este año (por el portal).
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.origen = 'cumpleanos'
                          AND date_part('year', l.ganado_el) = date_part('year', v_dia))
       -- Ya regalado a mano en el sistema anterior en los últimos dos meses: la
       -- persona que los daba lo hacía en el mes del cumpleaños, a veces antes.
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l
                        WHERE l.customer_id = c.id AND l.motivo ILIKE 'cortes%cumple%'
                          AND l.ganado_el >= v_dia - 60)
  LOOP
    -- Según el nivel (2026-10-07); el de Cliente VIP es el de la config.
    v_mios := coalesce(nullif((public.puntos_nivel_de(public.puntos_compra_12m(r.id, v_dia))).puntos_cumpleanos, 0), v_pts);
    IF (public.puntos_nivel_de(public.puntos_compra_12m(r.id, v_dia))).clave = 'vip' THEN v_mios := v_pts; END IF;
    v_n := v_n + 1;
    v_total := v_total + v_mios;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cumpleanos', v_mios, v_mios, v_dia, public.puntos_vence_el(v_dia), 'Cortesía Cumpleaños');
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_mios, ganados = ganados + v_mios, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total);
END;
$function$;

-- Reservas: Oro y Platino tienen 48 horas para retirar. Partiendo de la viva.
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
BEGIN
  SELECT * INTO r FROM public.app_reservas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.reserva_puede_manejar(r.branch_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_estado = 'lista' AND r.estado = 'pendiente' THEN
    v_horas := coalesce((public.puntos_nivel_de(public.puntos_compra_12m(r.customer_id,
                 (now() AT TIME ZONE 'America/El_Salvador')::date))).horas_reserva, 24);
    UPDATE public.app_reservas SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => v_horas),
           preparada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSIF p_estado = 'retirada' AND r.estado = 'lista' THEN
    UPDATE public.app_reservas SET estado = 'retirada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now(),
           pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
           pagado_at = coalesce(pagado_at, now())
     WHERE id = p_id;
  ELSIF p_estado = 'cancelada' AND r.estado IN ('pendiente', 'lista') THEN
    UPDATE public.app_reservas SET estado = 'cancelada', cerrada_at = now(), cerrada_por = v_emp, updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', r.estado, p_estado;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (public.auth_employee_id(), 'RESERVA_' || upper(p_estado), p_id::text,
          jsonb_build_object('antes', r.estado, 'motivo', p_motivo), r.branch_id, 'portal');
  RETURN json_build_object('ok', true, 'id', p_id, 'estado', p_estado);
END;
$function$;

-- Mis compras en la app: las últimas 10 (eran 5). Partiendo de la viva.
CREATE OR REPLACE FUNCTION public.app_cliente_compras(p_customer_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
    RETURN coalesce((
      SELECT json_agg(x ORDER BY x.fecha DESC, x.hora DESC) FROM (
        SELECT si.id, si.fecha, si.hora, si.tipo_documento, si.correlativo, si.total,
               b.name AS sala,
               (SELECT pl.puntos FROM puntos_lote pl WHERE pl.invoice_id = si.id) AS puntos,
               (SELECT pl.nivel FROM puntos_lote pl WHERE pl.invoice_id = si.id) AS nivel,
               (SELECT sum(ps.puntos) FROM puntos_salida ps
                 WHERE ps.invoice_id = si.id AND ps.tipo = 'canje' AND ps.revertida_at IS NULL) AS canjeados,
               (SELECT json_agg(json_build_object(
                         'descripcion', it.descripcion,
                         'cantidad', it.cantidad,
                         'total', it.total_linea,
                         'inyectable', public.es_inyectable(it.descripcion))
                       ORDER BY it.linea_num)
                  FROM sales_invoice_items it WHERE it.invoice_id = si.id) AS productos
          FROM sales_invoices si
          JOIN branches b ON b.id = si.branch_id
         WHERE si.customer_id = p_customer_id
           AND public.venta_valida(si.estado)
         ORDER BY si.fecha DESC, si.hora DESC
         LIMIT 10
      ) x), '[]'::json);
END;
$function$;
