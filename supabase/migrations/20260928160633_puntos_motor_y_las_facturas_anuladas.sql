SET lock_timeout = '5s';

-- ═══ Puntos: el motor y las facturas anuladas (auditoría del 2026-09-28) ════
-- Dos huecos que la auditoría previa al arranque encontró en el motor:
--
--  1. CANJE SOBRE UNA FACTURA ANULADA — cobro doble. `puntos_barrer_canjes` no
--     miraba si la factura del canje seguía siendo una venta, y un canje ya
--     registrado no se devolvía si la factura se anulaba después. Cuando la
--     caja anula y vuelve a facturar, la factura nueva trae el mismo canje: el
--     cliente perdía los puntos dos veces. Medido: 12 de 562 canjes del último
--     año quedaron sobre facturas anuladas (1 NULA, 11 DTE INVALIDADO EN MH).
--     Ahora: sólo se registra el canje de una venta válida, y el de una que se
--     anula después se DEVUELVE a los mismos lotes de donde salió.
--
--  2. VENTA ANULADA CON LOS PUNTOS YA GASTADOS — sin rastro. El barrido sólo
--     miraba lotes con `restantes > 0`, así que comprar, canjear los puntos y
--     anular la compra no dejaba nada. El circuito anterior lo avisaba
--     (`PUNTOS_YA_DADOS`), y el aviso de la vista leía esa bitácora vieja, que
--     deja de escribirse el 1-oct. Ahora queda en `puntos_anulacion_gastada` y
--     sale en la pestaña Avisos.
--
-- Todas reescritas desde su definición VIVA.

-- ── La marca de un canje devuelto ─────────────────────────────────────────
ALTER TABLE public.puntos_salida ADD COLUMN IF NOT EXISTS revertida_at timestamptz;

-- ── Las anulaciones cuyos puntos ya se habían gastado ─────────────────────
CREATE TABLE IF NOT EXISTS public.puntos_anulacion_gastada (
  -- Sin FK a sales_invoices a propósito: crearla toma un lock sobre la tabla
  -- más caliente de la base (CLAUDE.md, incidente 2026-07-08).
  invoice_id      bigint PRIMARY KEY,
  customer_id     bigint NOT NULL REFERENCES public.customers(id),
  sucursal        text,
  dio             integer NOT NULL,
  no_recuperados  integer NOT NULL CHECK (no_recuperados > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS puntos_anulacion_gastada_customer ON public.puntos_anulacion_gastada (customer_id);
ALTER TABLE public.puntos_anulacion_gastada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_anulacion_gastada_select ON public.puntos_anulacion_gastada;
CREATE POLICY puntos_anulacion_gastada_select ON public.puntos_anulacion_gastada FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')));
REVOKE ALL ON public.puntos_anulacion_gastada FROM anon;

-- ── Anular una venta: deja constancia de lo que ya no se pudo quitar ──────
CREATE OR REPLACE FUNCTION public.puntos_anular_venta(p_invoice_id bigint, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE l record; v_salida bigint; v_quita integer;
BEGIN
  SELECT * INTO l FROM public.puntos_lote WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'accion', 'ninguna', 'motivo', 'esa venta nunca dio puntos en el portal');
  END IF;

  v_quita := l.restantes;
  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'ok', true, 'dio', l.puntos,
                             'se_quitan', v_quita, 'ya_gastados', l.puntos - v_quita);
  END IF;

  IF v_quita > 0 THEN
    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, invoice_id, sucursal, motivo)
    VALUES (l.customer_id, 'anulacion', v_quita, p_invoice_id, l.sucursal, 'la venta se anuló')
    RETURNING id INTO v_salida;
    UPDATE public.puntos_lote SET restantes = 0 WHERE id = l.id;
    INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, l.id, v_quita);
    UPDATE public.puntos_cuenta
       SET saldo = saldo - v_quita, usados = usados + v_quita, updated_at = now()
     WHERE customer_id = l.customer_id;
  END IF;

  -- Agregado el 2026-09-28: lo que el cliente ya había gastado no se le puede
  -- quitar (la cuenta nunca queda debiendo), pero tiene que quedar a la vista.
  -- Es además la marca de «ya procesada» para el barrido.
  IF v_quita < l.puntos THEN
    INSERT INTO public.puntos_anulacion_gastada (invoice_id, customer_id, sucursal, dio, no_recuperados)
    VALUES (p_invoice_id, l.customer_id, l.sucursal, l.puntos, l.puntos - v_quita)
    ON CONFLICT (invoice_id) DO NOTHING;
  END IF;

  RETURN json_build_object('ok', true,
    'accion', CASE WHEN v_quita = l.puntos THEN 'retirados enteros'
                   WHEN v_quita = 0 THEN 'ya se habían gastado todos'
                   ELSE 'retirados en parte' END,
    'dio', l.puntos, 'se_quitaron', v_quita, 'no_recuperados', l.puntos - v_quita);
END;
$function$;

-- ── El barrido de anulaciones: también los lotes ya gastados ──────────────
CREATE OR REPLACE FUNCTION public.puntos_barrer_anulaciones(p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; res json;
  v_vistas int := 0; v_revertidas int := 0; v_puntos bigint := 0; v_no_rec bigint := 0;
BEGIN
  -- Mismo piso que acumular: sólo hay lotes con venta desde el arranque.
  p_desde := public.puntos_desde_efectivo(p_desde);

  -- «Ya procesada» ya no es `restantes > 0`: un lote gastado entero también
  -- tiene que pasar una vez para quedar anotado. La marca es la salida de
  -- anulación o la fila de `puntos_anulacion_gastada`.
  FOR r IN
    SELECT l.invoice_id
      FROM public.puntos_lote l
      JOIN public.sales_invoices si ON si.id = l.invoice_id
     WHERE l.invoice_id IS NOT NULL
       AND si.fecha BETWEEN p_desde AND p_hasta
       AND NOT public.venta_valida(si.estado)
       AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s
                        WHERE s.invoice_id = l.invoice_id AND s.tipo = 'anulacion')
       AND NOT EXISTS (SELECT 1 FROM public.puntos_anulacion_gastada g
                        WHERE g.invoice_id = l.invoice_id)
     ORDER BY l.invoice_id
     LIMIT p_tope
  LOOP
    v_vistas := v_vistas + 1;
    res := public.puntos_anular_venta(r.invoice_id, p_simular);
    IF coalesce((res->>'se_quitan')::int, (res->>'se_quitaron')::int, 0) > 0 THEN
      v_revertidas := v_revertidas + 1;
      v_puntos := v_puntos + coalesce((res->>'se_quitan')::int, (res->>'se_quitaron')::int, 0);
    END IF;
    v_no_rec := v_no_rec + coalesce((res->>'ya_gastados')::int, (res->>'no_recuperados')::int, 0);
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'vistas', v_vistas, 'revertidas', v_revertidas, 'puntos_quitados', v_puntos,
    'no_recuperados', v_no_rec, 'tope_alcanzado', v_vistas >= p_tope);
END;
$function$;

-- ── Devolver el canje de una factura que se anuló ─────────────────────────
-- Los puntos vuelven a los MISMOS lotes de donde salieron (`puntos_salida_lote`),
-- con su fecha de vencimiento original: devolver un canje no alarga la vida de
-- ningún punto. Un lote que ya venció mientras tanto lo vence el cron del día.
CREATE OR REPLACE FUNCTION public.puntos_devolver_canjes_anulados(
  p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 200
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r record; k record; v_n integer := 0; v_pts bigint := 0; v_vuelve integer;
BEGIN
  p_desde := public.puntos_desde_efectivo(p_desde);
  FOR r IN
    SELECT s.id, s.customer_id, s.puntos
      FROM public.puntos_salida s
      JOIN public.sales_invoices si ON si.id = s.invoice_id
     WHERE s.tipo = 'canje' AND s.revertida_at IS NULL
       AND si.fecha BETWEEN p_desde AND p_hasta
       AND NOT public.venta_valida(si.estado)
     ORDER BY s.id
     LIMIT p_tope
     FOR UPDATE OF s
  LOOP
    v_n := v_n + 1;
    v_pts := v_pts + r.puntos;
    CONTINUE WHEN p_simular;
    v_vuelve := 0;
    FOR k IN SELECT sl.lote_id, sl.puntos FROM public.puntos_salida_lote sl WHERE sl.salida_id = r.id LOOP
      UPDATE public.puntos_lote SET restantes = restantes + k.puntos WHERE id = k.lote_id;
      v_vuelve := v_vuelve + k.puntos;
    END LOOP;
    UPDATE public.puntos_salida SET revertida_at = now(),
           motivo = motivo || ' · devuelto: la factura se anuló'
     WHERE id = r.id;
    UPDATE public.puntos_cuenta
       SET saldo = saldo + v_vuelve, usados = usados - v_vuelve, updated_at = now()
     WHERE customer_id = r.customer_id;
  END LOOP;
  RETURN json_build_object('simulado', p_simular, 'devueltos', v_n, 'puntos', v_pts);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_devolver_canjes_anulados(date, date, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_devolver_canjes_anulados(date, date, boolean, integer) TO service_role;

-- ── El barrido de canjes: sólo ventas válidas, y devuelve los anulados ────
CREATE OR REPLACE FUNCTION public.puntos_barrer_canjes(p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 500)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; res json;
  v_vistas int := 0; v_registrados int := 0; v_puntos bigint := 0;
  v_sin_saldo int := 0; v_convenio int := 0; v_nada int := 0;
  v_avisos json[] := '{}';
  v_devueltos json;
BEGIN
  -- El piso del arranque: un canje anterior ya se descontó en el sistema
  -- anterior y viene en el historial migrado. Registrarlo acá lo cobraría dos
  -- veces.
  p_desde := public.puntos_desde_efectivo(p_desde);

  -- Primero se devuelve lo que se anuló después de registrado (2026-09-28): así
  -- el saldo ya está completo cuando llega la factura que lo reemplaza.
  v_devueltos := public.puntos_devolver_canjes_anulados(p_desde, p_hasta, p_simular);

  FOR r IN
    SELECT si.id FROM public.sales_invoices si
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND si.has_puntos
       AND si.customer_id IS NOT NULL
       -- Sólo una venta válida canjea (2026-09-28): la anulada se rehace en
       -- otra factura, que trae el mismo canje.
       AND public.venta_valida(si.estado)
       AND NOT EXISTS (SELECT 1 FROM public.puntos_salida s
                        WHERE s.invoice_id = si.id AND s.tipo = 'canje')
     ORDER BY si.fecha, si.id
     LIMIT p_tope
  LOOP
    v_vistas := v_vistas + 1;
    res := public.puntos_registrar_canje(r.id, p_simular);
    IF (res->>'accion') = 'ninguna' THEN v_convenio := v_convenio + 1; CONTINUE; END IF;
    IF NOT coalesce((res->>'ok')::boolean, false) THEN v_nada := v_nada + 1; CONTINUE; END IF;
    v_registrados := v_registrados + 1;
    v_puntos := v_puntos + coalesce((res->>'puntos')::int, 0);
    IF coalesce((res->>'avisar')::boolean, false)
       OR (p_simular AND NOT coalesce((res->>'alcanza')::boolean, true)) THEN
      v_sin_saldo := v_sin_saldo + 1;
      IF v_sin_saldo <= 100 THEN v_avisos := v_avisos || coalesce(res->'aviso', res); END IF;
    END IF;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'vistas', v_vistas, 'registrados', v_registrados, 'puntos', v_puntos,
    'sin_saldo_suficiente', v_sin_saldo, 'de_convenio', v_convenio, 'sin_efecto', v_nada,
    'devueltos', v_devueltos,
    'avisos', to_json(v_avisos), 'tope_alcanzado', v_vistas >= p_tope);
END;
$function$;

-- ── La pestaña Avisos lee el libro nuevo ──────────────────────────────────
-- La segunda parte leía `puntos_enviados.reversion = 'PUNTOS_YA_DADOS'`, que es
-- la bitácora del puente viejo y deja de escribirse el 1-oct. Ahora lee
-- `puntos_anulacion_gastada`. Y se suma el canje devuelto por anulación.
CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_avisos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los avisos de puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(x ORDER BY x.cuando DESC), '[]'::json) INTO v FROM (
    SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
           coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
           s.puntos AS puntos,
           nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.invoice_id IS NOT NULL AND s.motivo LIKE '%faltaron%'
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', g.created_at, g.customer_id, c.name,
           coalesce(b.name, g.sucursal), si.correlativo, si.id,
           g.no_recuperados, g.no_recuperados
      FROM public.puntos_anulacion_gastada g
      JOIN public.sales_invoices si ON si.id = g.invoice_id
      LEFT JOIN public.customers c ON c.id = g.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = g.sucursal
     WHERE g.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'canje_devuelto', s.revertida_at, s.customer_id, c.name,
           coalesce(b.name, s.sucursal), si.correlativo, si.id,
           s.puntos, NULL::int
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.revertida_at >= now() - interval '60 days'
  ) x;
  RETURN v;
END;
$function$;
