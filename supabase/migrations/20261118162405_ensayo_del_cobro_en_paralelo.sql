SET lock_timeout = '5s';
-- jsonb-agg: listas de los productos de UNA factura (un puñado de filas), y en jsonb porque json no tiene igualdad para `IS DISTINCT FROM`. Esta línea se agregó al archivo después de aplicarla: es un comentario, lo ejecutado es idéntico.

-- ═══════════════════════════════════════════════════════════════════════════
-- Ensayo del cobro en paralelo (2026-11-18): etapa 1 del cobro desde el kiosco.
--
-- `ensayo-cobro-caja` (edge, cada minuto en horario de sucursal) arma, para
-- cada preventa viva de la caja de Salud 4 y Salud 1, el cobro que haría el
-- kiosco, SIN mandarlo. Cuando la cajera la cobra a mano, la factura llega por
-- el sync con el MISMO número que la preventa, y `cobro_caja_ensayo_comparar`
-- enfrenta lo ensayado con lo guardado: total, documento, vendedor y cada
-- producto (suma de sus líneas, así un producto repartido en lotes cuenta una
-- vez). Una diferencia puede ser un error del ensayo o una corrección que hizo
-- la cajera después de la última lectura: `veces` y `captado_at` ayudan a
-- distinguirlo.
--
-- Retención: 60 días (lo purga la misma comparación). Es un registro de
-- prueba, no historial de negocio.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cobro_caja_ensayos (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  branch_id     bigint NOT NULL REFERENCES public.branches(id),
  externo_id    text NOT NULL,
  referencia    text,
  total_caja    numeric(12,2),
  plan          jsonb NOT NULL,
  captado_at    timestamptz NOT NULL DEFAULT now(),
  veces         integer NOT NULL DEFAULT 1,
  comparado_at  timestamptz,
  cuadra        boolean,
  diferencias   jsonb,
  -- Cubre también la FK de branch_id (es la primera columna).
  CONSTRAINT cobro_caja_ensayos_branch_externo_key UNIQUE (branch_id, externo_id)
);

CREATE INDEX IF NOT EXISTS idx_cobro_caja_ensayos_pendientes
  ON public.cobro_caja_ensayos (captado_at) WHERE comparado_at IS NULL;

ALTER TABLE public.cobro_caja_ensayos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobro_caja_ensayos_select ON public.cobro_caja_ensayos;
CREATE POLICY cobro_caja_ensayos_select ON public.cobro_caja_ensayos
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('caja_vales', 'can_view')));
REVOKE ALL ON public.cobro_caja_ensayos FROM anon;

CREATE OR REPLACE FUNCTION public.cobro_caja_ensayo_comparar()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_comparadas int := 0;
  v_fallidas   int := 0;
  v_sin        int := 0;
  v_purgadas   int := 0;
BEGIN
  -- Las que tienen factura (con sus productos ya sincronizados) y un plan armado.
  WITH pend AS (
    SELECT e.id, e.plan, s.id AS sid, s.total AS s_total, s.tipo_documento AS s_tipo, s.cod_vendedor AS s_vend
      FROM public.cobro_caja_ensayos e
      JOIN public.sales_invoices s ON s.erp_invoice_id = e.externo_id AND s.branch_id = e.branch_id
     WHERE e.comparado_at IS NULL
       AND e.plan ? 'guardado'
       AND s.created_at < now() - interval '2 minutes'
       AND EXISTS (SELECT 1 FROM public.sales_invoice_items i WHERE i.invoice_id = s.id)
  ), cmp AS (
    SELECT p.id,
           jsonb_strip_nulls(jsonb_build_object(
             'total', CASE WHEN abs(coalesce((p.plan->'totales'->>'total')::numeric, -1) - p.s_total) >= 0.005
                           THEN jsonb_build_object('ensayo', (p.plan->'totales'->>'total')::numeric, 'caja', p.s_total) END,
             'documento', CASE WHEN p.plan->'cabecera'->>'tipo_documento' IS DISTINCT FROM p.s_tipo
                               THEN jsonb_build_object('ensayo', p.plan->'cabecera'->>'tipo_documento', 'caja', p.s_tipo) END,
             'vendedor', CASE WHEN nullif(p.plan->'cabecera'->>'codvende', '') IS DISTINCT FROM nullif(p.s_vend, '')
                              THEN jsonb_build_object('ensayo', p.plan->'cabecera'->>'codvende', 'caja', p.s_vend) END,
             'productos', CASE WHEN a.lineas IS DISTINCT FROM b.lineas
                               THEN jsonb_build_object('ensayo', a.lineas, 'caja', b.lineas) END
           )) AS dif
      FROM pend p
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_array(pid, round(sub, 2)) ORDER BY pid) AS lineas
          FROM (SELECT btrim(r->>'id')::bigint AS pid, sum(replace(r->>'subtotal', ',', '')::numeric) AS sub
                  FROM jsonb_array_elements((p.plan->'guardado'->>'json_arr')::jsonb) r
                 WHERE btrim(r->>'id') ~ '^[0-9]+$'
                 GROUP BY 1) x) a
      CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_array(erp_product_id, round(t, 2)) ORDER BY erp_product_id) AS lineas
          FROM (SELECT i.erp_product_id, sum(i.total_linea) AS t
                  FROM public.sales_invoice_items i WHERE i.invoice_id = p.sid GROUP BY 1) y) b
  )
  UPDATE public.cobro_caja_ensayos e
     SET comparado_at = now(), cuadra = (c.dif = '{}'::jsonb), diferencias = nullif(c.dif, '{}'::jsonb)
    FROM cmp c WHERE c.id = e.id;
  GET DIAGNOSTICS v_comparadas = ROW_COUNT;

  -- El ensayo no se pudo armar y la venta igual se cobró: cuenta como falla del ensayo.
  UPDATE public.cobro_caja_ensayos e
     SET comparado_at = now(), cuadra = false,
         diferencias = jsonb_build_object('ensayo_fallo', e.plan->>'error')
   WHERE e.comparado_at IS NULL AND NOT (e.plan ? 'guardado')
     AND EXISTS (SELECT 1 FROM public.sales_invoices s WHERE s.erp_invoice_id = e.externo_id AND s.branch_id = e.branch_id);
  GET DIAGNOSTICS v_fallidas = ROW_COUNT;

  -- Dos días sin factura: la preventa se borró o nunca se cobró. No se juzga.
  UPDATE public.cobro_caja_ensayos e
     SET comparado_at = now(), cuadra = NULL, diferencias = jsonb_build_object('sin_factura', true)
   WHERE e.comparado_at IS NULL AND e.captado_at < now() - interval '2 days';
  GET DIAGNOSTICS v_sin = ROW_COUNT;

  DELETE FROM public.cobro_caja_ensayos WHERE created_at < now() - interval '60 days';
  GET DIAGNOSTICS v_purgadas = ROW_COUNT;

  RETURN json_build_object('comparadas', v_comparadas, 'fallidas', v_fallidas, 'sin_factura', v_sin, 'purgadas', v_purgadas);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cobro_caja_ensayo_comparar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cobro_caja_ensayo_comparar() TO service_role;

-- Cada minuto de 6:00 a 21:59 SV (12–23 y 0–3 UTC), como los syncs de venta.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ensayo-cobro-caja') THEN
    PERFORM cron.unschedule('ensayo-cobro-caja');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'sync_invoke_secret') THEN
    RAISE NOTICE 'Sin sync_invoke_secret: no se programa el ensayo (entorno de pruebas).';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'ensayo-cobro-caja',
    '* 12-23,0-3 * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/ensayo-cobro-caja',
      body    := '{}'::jsonb,
      headers := jsonb_build_object(
                   'Content-Type','application/json',
                   'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='sync_invoke_secret')),
      timeout_milliseconds := 120000);
    $cron$);
END
$do$;
