SET lock_timeout = '5s';

-- Control de promociones (usuario 2026-11-26). La caja no sabe de condiciones
-- por cantidad: el descuento de la Iren Forte le sale a cualquiera, el 2x1 y
-- los regalos se hacen a mano. Esto revisa cada factura contra las reglas de
-- la promoción y avisa a la sucursal y al supervisor cuando no las cumple.
-- Avisa DESPUÉS de facturar: frenar en el momento sólo puede la caja.
--
-- Tres tipos de regla:
--   · combo       — cada unidad de `product_id` exige `por_unidad` unidades
--                   PAGADAS de `requiere_product_id` en la misma factura.
--   · regalo      — las unidades GRATIS de `product_id` no pasan de
--                   `por_unidad` × las unidades de `requiere_product_id`.
--   · precio_2x1  — `product_id` se cobra a viñeta (el precio regular de su
--                   presentación) y lo gratis no pasa de lo pagado.
--
-- «Pagadas» de un renglón = cobrado ÷ precio de lista (topado a la cantidad).
-- Así un 100 % de descuento, un 50 % sobre dos unidades o un renglón a $0
-- cuentan igual. En el CCF el precio trae IVA y el total no (ver
-- `rebajas_en_ventas`): el total se lleva a bruto con × 1.13.
--
-- Sin FK a `products` ni a `sales_invoices` a propósito: son tablas calientes
-- (los syncs escriben cada minuto) y una FK nueva hacia ellas pide lock sobre
-- ellas. Los ids se validan al sembrar y la pantalla cruza por join.

CREATE TABLE IF NOT EXISTS public.promocion_reglas (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promocion_id         bigint REFERENCES public.promociones(id) ON DELETE SET NULL,
    tipo                 text NOT NULL CHECK (tipo IN ('combo', 'regalo', 'precio_2x1')),
    product_id           integer NOT NULL,
    producto_texto       text NOT NULL,
    requiere_product_id  integer,
    requiere_texto       text,
    por_unidad           numeric NOT NULL DEFAULT 1 CHECK (por_unidad > 0),
    inicio               date NOT NULL,
    fin                  date NOT NULL,
    activa               boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (fin >= inicio),
    CHECK (tipo = 'precio_2x1' OR requiere_product_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS promocion_reglas_promocion_id_idx ON public.promocion_reglas (promocion_id);

CREATE TABLE IF NOT EXISTS public.promocion_ventas_observadas (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    regla_id      bigint NOT NULL REFERENCES public.promocion_reglas(id) ON DELETE CASCADE,
    invoice_id    bigint NOT NULL,
    branch_id     bigint NOT NULL,
    fecha         date NOT NULL,
    motivo        text NOT NULL,
    detalle       jsonb NOT NULL DEFAULT '{}'::jsonb,
    avisado_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (regla_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS promocion_ventas_observadas_fecha_idx ON public.promocion_ventas_observadas (fecha);
CREATE INDEX IF NOT EXISTS promocion_ventas_observadas_invoice_idx ON public.promocion_ventas_observadas (invoice_id);

ALTER TABLE public.promocion_reglas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocion_ventas_observadas ENABLE ROW LEVEL SECURITY;

-- Sólo lectura desde la API: las escribe el revisor (DEFINER) y la siembra.
DROP POLICY IF EXISTS promocion_reglas_select ON public.promocion_reglas;
CREATE POLICY promocion_reglas_select ON public.promocion_reglas
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones', 'can_view')));

DROP POLICY IF EXISTS promocion_ventas_observadas_select ON public.promocion_ventas_observadas;
CREATE POLICY promocion_ventas_observadas_select ON public.promocion_ventas_observadas
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('promociones', 'can_view')));

REVOKE ALL ON public.promocion_reglas, public.promocion_ventas_observadas FROM anon;

-- ── Qué facturas no cumplen. Un solo juez: lo usa el revisor y nada más.
CREATE OR REPLACE FUNCTION public.promocion_control_hallazgos(p_desde date, p_hasta date)
RETURNS TABLE (regla_id bigint, invoice_id bigint, branch_id bigint, fecha date, motivo text, detalle jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH regla AS (
    SELECT r.* FROM public.promocion_reglas r
     WHERE r.activa AND r.inicio <= p_hasta AND r.fin >= p_desde
  ), pids AS (
    SELECT product_id AS pid FROM regla
    UNION SELECT requiere_product_id FROM regla WHERE requiere_product_id IS NOT NULL
  ), lin AS (
    SELECT si.id AS invoice_id, si.branch_id, si.fecha, ii.erp_product_id AS pid, ii.cantidad,
           coalesce(nullif(ii.factor_unidades, 0), 1) AS f, ii.precio_unitario AS pu,
           ii.total_linea * CASE WHEN si.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END AS bruto
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND public.venta_valida(si.estado)
       -- Una factura recién llegada puede traer el encabezado antes que todos
       -- sus renglones: se espera a que se asiente para no marcar un combo
       -- incompleto que en realidad estaba completo.
       AND si.created_at < now() - interval '3 minutes'
       AND ii.erp_product_id IN (SELECT pid FROM pids)
  ), l AS (
    SELECT lin.*, CASE WHEN pu > 0 THEN least(cantidad, bruto / pu) ELSE 0 END AS pagadas FROM lin
  )
  -- combo
  SELECT r.id, i.invoice_id, i.branch_id, i.fecha,
         format('%s con precio de promoción lleva %s %s pagada%s de %s.',
                r.producto_texto, trim_scale(round(coalesce(p.pag, 0), 2)), r.requiere_texto,
                CASE WHEN round(coalesce(p.pag, 0), 2) = 1 THEN '' ELSE 's' END,
                trim_scale(i.u * r.por_unidad)),
         jsonb_build_object('unidades', i.u, 'pagadas_requeridas', coalesce(p.pag, 0),
                            'necesita', i.u * r.por_unidad)
    FROM regla r
    JOIN LATERAL (SELECT l.invoice_id, min(l.branch_id) AS branch_id, min(l.fecha) AS fecha, sum(l.cantidad * l.f) AS u
                    FROM l WHERE l.pid = r.product_id AND l.fecha BETWEEN r.inicio AND r.fin
                   GROUP BY l.invoice_id) i ON true
    LEFT JOIN LATERAL (SELECT sum(l.pagadas * l.f) AS pag FROM l
                        WHERE l.invoice_id = i.invoice_id AND l.pid = r.requiere_product_id) p ON true
   WHERE r.tipo = 'combo' AND coalesce(p.pag, 0) < i.u * r.por_unidad - 0.01
  UNION ALL
  -- regalo
  SELECT r.id, g.invoice_id, g.branch_id, g.fecha,
         format('Se regaló %s %s y la promoción alcanza para %s.',
                trim_scale(round(g.gratis, 2)), r.producto_texto,
                trim_scale(coalesce(q.u, 0) * r.por_unidad)),
         jsonb_build_object('gratis', g.gratis, 'alcanza', coalesce(q.u, 0) * r.por_unidad)
    FROM regla r
    JOIN LATERAL (SELECT l.invoice_id, min(l.branch_id) AS branch_id, min(l.fecha) AS fecha,
                         sum((l.cantidad - l.pagadas) * l.f) AS gratis
                    FROM l WHERE l.pid = r.product_id AND l.fecha BETWEEN r.inicio AND r.fin
                   GROUP BY l.invoice_id) g ON true
    LEFT JOIN LATERAL (SELECT sum(l.cantidad * l.f) AS u FROM l
                        WHERE l.invoice_id = g.invoice_id AND l.pid = r.requiere_product_id) q ON true
   WHERE r.tipo = 'regalo' AND g.gratis > coalesce(q.u, 0) * r.por_unidad + 0.01
  UNION ALL
  -- precio_2x1: por presentación (factor), contra la viñeta de esa presentación.
  -- Hay productos con dos presentaciones del mismo factor y viñetas distintas:
  -- manda la MÁS BAJA, para no marcar una venta bien hecha.
  SELECT r.id, t.invoice_id, t.branch_id, t.fecha,
         CASE WHEN t.pu_min < v.vin - 0.02
              THEN format('%s se cobró a $%s; el precio normal es $%s.',
                          r.producto_texto, to_char(t.pu_min, 'FM999990.00'), to_char(v.vin, 'FM999990.00'))
              ELSE format('%s: se cobraron $%s por %s; con el 2x1 son $%s.',
                          r.producto_texto, to_char(t.cobrado, 'FM999990.00'), trim_scale(t.u),
                          to_char(ceil(t.u / 2) * v.vin, 'FM999990.00'))
         END,
         jsonb_build_object('factor', t.f, 'unidades', t.u, 'cobrado', round(t.cobrado, 2),
                            'precio_cobrado', t.pu_min, 'vineta', v.vin)
    FROM regla r
    JOIN LATERAL (SELECT l.invoice_id, min(l.branch_id) AS branch_id, min(l.fecha) AS fecha, l.f,
                         sum(l.cantidad) AS u, sum(l.bruto) AS cobrado,
                         min(l.pu) FILTER (WHERE l.bruto > 0) AS pu_min
                    FROM l WHERE l.pid = r.product_id AND l.fecha BETWEEN r.inicio AND r.fin
                   GROUP BY l.invoice_id, l.f) t ON true
    JOIN LATERAL (SELECT min(pp.vineta) AS vin FROM public.product_precios pp
                   WHERE pp.product_id = r.product_id AND pp.activo AND pp.factor = t.f AND pp.vineta > 0) v
      ON v.vin IS NOT NULL
   WHERE r.tipo = 'precio_2x1'
     AND (t.pu_min < v.vin - 0.02 OR t.cobrado < ceil(t.u / 2) * v.vin - 0.02);
$$;

REVOKE EXECUTE ON FUNCTION public.promocion_control_hallazgos(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_control_hallazgos(date, date) TO service_role;

-- ── El revisor: lo corre el cron cada 5 minutos. Guarda lo nuevo y avisa una
-- vez por factura, a la sucursal y al supervisor.
CREATE OR REPLACE FUNCTION public.promocion_control_revisar()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_sup   uuid[];
  v_suc   uuid[];
  v_n     integer := 0;
  f       record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.promocion_reglas
                  WHERE activa AND inicio <= v_hoy AND fin >= v_hoy - 2) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.promocion_ventas_observadas (regla_id, invoice_id, branch_id, fecha, motivo, detalle)
  SELECT h.regla_id, h.invoice_id, h.branch_id, h.fecha, h.motivo, h.detalle
    FROM public.promocion_control_hallazgos(v_hoy - 2, v_hoy) h
  ON CONFLICT (regla_id, invoice_id) DO NOTHING;

  -- Supervisor/a de Ventas (cargo 13), con su cargo de apoyo si lo tiene.
  SELECT array_agg(DISTINCT e.id) INTO v_sup
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id) = 13;

  FOR f IN
    SELECT o.invoice_id, o.branch_id, si.correlativo, b.name AS sala,
           string_agg(o.motivo, ' ' ORDER BY o.id) AS motivos,
           array_agg(o.id) AS ids
      FROM public.promocion_ventas_observadas o
      JOIN public.sales_invoices si ON si.id = o.invoice_id
      LEFT JOIN public.branches b ON b.id = o.branch_id
     WHERE o.avisado_at IS NULL
     GROUP BY o.invoice_id, o.branch_id, si.correlativo, b.name
  LOOP
    -- Sin repetir a quien ya recibe el del supervisor.
    SELECT array_agg(x) INTO v_suc
      FROM unnest(public.destinatarios_de_modulo(f.branch_id::integer, 'ventas')) x
     WHERE v_sup IS NULL OR NOT x = ANY (v_sup);

    -- A la sucursal: el error escrito entero, y abre Ventas, que sí puede ver.
    IF v_suc IS NOT NULL THEN
      PERFORM public.notify_employees(
        v_suc,
        'PROMO_VENTA_ERROR',
        coalesce(f.sala || ' · ', '') || 'Venta fuera de la promoción',
        'Factura ' || coalesce(f.correlativo, '') || ': ' || f.motivos,
        '/ventas',
        jsonb_build_object('invoice_id', f.invoice_id, 'branch_id', f.branch_id, 'observadas', to_jsonb(f.ids)),
        true, f.branch_id::integer);
    END IF;

    -- Al supervisor: la lista completa en Promociones.
    IF v_sup IS NOT NULL THEN
      PERFORM public.notify_employees(
        v_sup,
        'PROMO_VENTA_ERROR',
        coalesce(f.sala || ' · ', '') || 'Venta fuera de la promoción',
        'Factura ' || coalesce(f.correlativo, '') || ': ' || f.motivos,
        '/promociones?tab=control',
        jsonb_build_object('invoice_id', f.invoice_id, 'branch_id', f.branch_id, 'observadas', to_jsonb(f.ids)),
        true, NULL);
    END IF;

    UPDATE public.promocion_ventas_observadas SET avisado_at = now() WHERE id = ANY (f.ids);
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.promocion_control_revisar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_control_revisar() TO service_role;

-- ── Lo que lee la pantalla. INVOKER: el RLS decide. `RETURNS json`: sin techo.
CREATE OR REPLACE FUNCTION public.get_promocion_observadas(p_desde date, p_hasta date)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(t ORDER BY t.fecha DESC, t.id DESC), '[]'::json) FROM (
    SELECT o.id, o.fecha, o.branch_id, b.name AS sala, si.correlativo, si.tipo_documento,
           si.estado, NOT public.venta_valida(si.estado) AS anulada, si.cliente, si.total,
           si.cod_vendedor, e.id AS vendedor_id, e.name AS vendedor,
           r.id AS regla_id, r.tipo, r.producto_texto, r.requiere_texto,
           o.motivo, o.detalle, o.created_at
      FROM public.promocion_ventas_observadas o
      JOIN public.promocion_reglas r ON r.id = o.regla_id
      LEFT JOIN public.sales_invoices si ON si.id = o.invoice_id
      LEFT JOIN public.branches b ON b.id = o.branch_id
      LEFT JOIN LATERAL (SELECT e.id, e.name FROM public.employees e
                          WHERE e.code = si.cod_vendedor ORDER BY e.id LIMIT 1) e ON true
     WHERE o.fecha BETWEEN p_desde AND p_hasta
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_promocion_observadas(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promocion_observadas(date, date) TO authenticated, service_role;

-- ── Las reglas de la semana del 27-nov al 3-dic. La siembra sólo corre donde
-- existen los productos (en el entorno de pruebas no están).
INSERT INTO public.promocion_reglas
    (promocion_id, tipo, product_id, producto_texto, requiere_product_id, requiere_texto, por_unidad, inicio, fin)
SELECT (SELECT id FROM public.promociones WHERE id = s.promo), s.tipo, s.pid, s.ptxt, s.rid, s.rtxt, s.por, s.ini, s.fin
  FROM (VALUES
    (44::bigint, 'combo',      5315, 'Iren Forte x 15',      2165, 'Neurobion 25,000', 2::numeric, '2026-11-27'::date, '2026-12-03'::date),
    (44,         'regalo',     2165, 'Neurobion 25,000',     5315, 'Iren Forte x 15',  1,          '2026-11-27',       '2026-12-03'),
    (NULL,       'precio_2x1', 4948, 'Tramafen tab',         NULL, NULL,               1,          '2026-11-27',       '2026-12-03'),
    (NULL,       'precio_2x1', 4817, 'Dolaco 20',            NULL, NULL,               1,          '2026-11-27',       '2026-12-03'),
    (NULL,       'regalo',     4825, 'Gludethon AR',         2173, 'Neurobion tripack',1,          '2026-11-27',       '2026-12-03')
  ) AS s(promo, tipo, pid, ptxt, rid, rtxt, por, ini, fin)
 WHERE EXISTS (SELECT 1 FROM public.products p WHERE p.id = s.pid)
   AND NOT EXISTS (SELECT 1 FROM public.promocion_reglas x
                    WHERE x.product_id = s.pid AND x.tipo = s.tipo AND x.inicio = s.ini);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promocion-control-5min') THEN
    PERFORM cron.schedule('promocion-control-5min', '*/5 * * * *',
                          'SELECT public.promocion_control_revisar()');
  END IF;
END $$;
