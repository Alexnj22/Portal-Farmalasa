SET lock_timeout = '5s';

-- El control de promociones se monta en la pasada de ventas (usuario
-- 2026-11-27). Antes un cron cada 5 minutos releía 3 días enteros sin saber qué
-- había entrado (~214 ms y ~6,400 bloques, 288 veces al día). Ahora
-- `sync-dte-sales`, al terminar de guardar las facturas nuevas de una sucursal
-- con sus renglones, llama al revisor sólo con esas facturas: el aviso sale en
-- menos de un minuto y cada revisión mira un puñado de facturas. El cron queda
-- cada hora como red (y cubre las horas en que el sync no corre).
--
-- Partido de las definiciones VIVAS (pg_get_functiondef, 2026-11-27).

-- ── El juez: acepta las facturas a mirar. Con `p_invoices` no espera los 3
-- minutos de asiento: el sync lo llama DESPUÉS de escribir todos los renglones
-- de esas facturas, en la misma pasada. Pasa a plpgsql con force_custom_plan:
-- el plan bueno depende de si llegan facturas (índice por id) o no (rango de
-- fechas), y una `LANGUAGE sql` con SET nace genérica.
DROP FUNCTION IF EXISTS public.promocion_control_hallazgos(date, date);

CREATE OR REPLACE FUNCTION public.promocion_control_hallazgos(
  p_desde date, p_hasta date, p_invoices bigint[] DEFAULT NULL)
RETURNS TABLE (regla_id bigint, invoice_id bigint, branch_id bigint, fecha date, motivo text, detalle jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH regla AS (
    SELECT r.* FROM public.promocion_reglas r
     WHERE r.activa AND r.inicio <= p_hasta AND r.fin >= p_desde
  ), pids AS (
    SELECT regla.product_id AS pid FROM regla
    UNION SELECT regla.requiere_product_id FROM regla WHERE regla.requiere_product_id IS NOT NULL
  ), lin AS (
    SELECT si.id AS invoice_id, si.branch_id, si.fecha, ii.erp_product_id AS pid, ii.cantidad,
           coalesce(nullif(ii.factor_unidades, 0), 1) AS f, ii.precio_unitario AS pu,
           ii.total_linea * CASE WHEN si.tipo_documento = 'CCF' THEN 1.13 ELSE 1 END AS bruto
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
     WHERE si.fecha BETWEEN p_desde AND p_hasta
       AND public.venta_valida(si.estado)
       AND (p_invoices IS NULL OR si.id = ANY (p_invoices))
       -- Una factura recién llegada puede traer el encabezado antes que todos
       -- sus renglones: el barrido sin facturas espera a que se asiente para no
       -- marcar un combo incompleto que en realidad estaba completo.
       AND (p_invoices IS NOT NULL OR si.created_at < now() - interval '3 minutes')
       AND ii.erp_product_id IN (SELECT pids.pid FROM pids)
  ), l AS (
    SELECT lin.*, CASE WHEN lin.pu > 0 THEN least(lin.cantidad, lin.bruto / lin.pu) ELSE 0 END AS pagadas FROM lin
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
END;
$function$;

ALTER FUNCTION public.promocion_control_hallazgos(date, date, bigint[]) SET plan_cache_mode = 'force_custom_plan';
REVOKE EXECUTE ON FUNCTION public.promocion_control_hallazgos(date, date, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_control_hallazgos(date, date, bigint[]) TO service_role;

-- ── El revisor: con facturas (desde el sync) o sin ellas (el cron de red).
-- Ahora lo pueden correr varias sucursales a la vez: los avisos pendientes se
-- TOMAN con SKIP LOCKED antes de mandarlos, para que dos pasadas no avisen dos
-- veces la misma factura.
DROP FUNCTION IF EXISTS public.promocion_control_revisar();

CREATE OR REPLACE FUNCTION public.promocion_control_revisar(p_invoices bigint[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_hoy   date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_sup   uuid[];
  v_suc   uuid[];
  v_ids   bigint[];
  v_n     integer := 0;
  f       record;
BEGIN
  IF p_invoices IS NOT NULL AND cardinality(p_invoices) = 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.promocion_reglas
                  WHERE activa AND inicio <= v_hoy AND fin >= v_hoy - 2) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.promocion_ventas_observadas (regla_id, invoice_id, branch_id, fecha, motivo, detalle)
  SELECT h.regla_id, h.invoice_id, h.branch_id, h.fecha, h.motivo, h.detalle
    FROM public.promocion_control_hallazgos(v_hoy - 2, v_hoy, p_invoices) h
  ON CONFLICT (regla_id, invoice_id) DO NOTHING;

  -- Tomar los pendientes: lo que otra pasada ya tiene tomado se salta.
  WITH tomadas AS (
    SELECT o.id FROM public.promocion_ventas_observadas o
     WHERE o.avisado_at IS NULL
     FOR UPDATE SKIP LOCKED
  ), marcadas AS (
    UPDATE public.promocion_ventas_observadas o SET avisado_at = now()
      FROM tomadas WHERE o.id = tomadas.id
    RETURNING o.id
  )
  SELECT array_agg(marcadas.id) INTO v_ids FROM marcadas;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

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
     WHERE o.id = ANY (v_ids)
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

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.promocion_control_revisar(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocion_control_revisar(bigint[]) TO service_role;

-- ── El cron pasa a ser la red: cada hora. Guardas «sólo si existe».
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promocion-control-5min') THEN
    PERFORM cron.unschedule('promocion-control-5min');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'promocion-control-hora') THEN
    PERFORM cron.schedule('promocion-control-hora', '7 * * * *',
                          'SELECT public.promocion_control_revisar()');
  END IF;
END $$;
