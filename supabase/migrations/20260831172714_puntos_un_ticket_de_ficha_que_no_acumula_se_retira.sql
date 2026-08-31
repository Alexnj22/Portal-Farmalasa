SET lock_timeout = '5s';

-- ── «No acumula» no es «anulada» ─────────────────────────────────────────────
-- Cuando una ficha deja de acumular —un convenio, una empresa— sus tickets ya
-- enviados siguen vivos del otro lado, canjeables. Hay que retirarlos, pero
-- marcarlos como BORRADA los haría indistinguibles de una venta anulada, y no
-- lo son: la venta ocurrió y está bien. Dentro de un año, quien mire esas 61
-- filas de MAPFRE leería «anuladas» y sería falso.
--
-- Por eso un estado propio. Un rótulo que miente no da error nunca: sólo hace
-- que alguien saque la conclusión equivocada, mucho después, sin poder saber
-- que la sacó mal.
ALTER TABLE public.puntos_enviados
  ALTER COLUMN estado_puntos SET EXPRESSION AS (
    CASE
      WHEN reversion = 'BORRADA'         THEN 'retirado'
      WHEN reversion = 'RESTADA'         THEN 'devuelto'
      WHEN reversion = 'PUNTOS_YA_DADOS' THEN 'por_revisar'
      WHEN reversion = 'NO_ACUMULA'      THEN 'no_acumula'
      WHEN aplicado = 1 THEN 'acumulado'
      WHEN aplicado = 0 THEN 'pendiente'
      ELSE 'sin_enviar'
    END
  );


-- ── Qué tickets hay que retirar ──────────────────────────────────────────────
-- Los de una ficha que hoy no acumula y que todavía están vivos allá. Se
-- devuelve `aplicado` para que quien barra distinga los dos casos:
--
--   aplicado = 0  el ticket nunca se cobró: se borra y ningún saldo cambia.
--   aplicado = 1  los puntos YA se entregaron. NO se tocan — quitarlos sería
--                 restarle a una cuenta por una decisión que se tomó después.
--                 Se informan y quedan a la vista.
--
-- Es la misma línea que se trazó con las 26 ventas anuladas de agosto: se
-- corrige de acá en adelante, no hacia atrás.
CREATE OR REPLACE FUNCTION public.puntos_tickets_de_ficha_que_no_acumula(p_tope integer DEFAULT 500)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode TO 'force_custom_plan'
AS $fn$
DECLARE v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    SELECT pe.invoice_id, pe.sucursal, pe.erp_invoice_id, pe.correlativo,
           pe.cliente, pe.total, pe.fecha, pe.aplicado
    FROM public.puntos_enviados pe
    JOIN public.sales_invoices si ON si.id = pe.invoice_id
    JOIN public.customers      cu ON cu.id = si.customer_id
    WHERE cu.acumula_puntos = false
      AND pe.reversion IS NULL
      AND pe.aplicado IS NOT NULL      -- se llegó a enviar; lo que nunca salió no hay que retirarlo
    ORDER BY pe.fecha, pe.invoice_id
    LIMIT p_tope
  ) t;
  RETURN v;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.puntos_tickets_de_ficha_que_no_acumula(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.puntos_tickets_de_ficha_que_no_acumula(integer) TO service_role;
