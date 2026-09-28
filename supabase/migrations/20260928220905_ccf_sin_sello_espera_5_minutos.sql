-- El aviso «CCF sin sello» esperaba CERO minutos (2026-09-28). El CCF 113 de
-- Salud 5 se emitió 15:58:50, el aviso salió 16:00:03 y el sello llegó
-- 16:00:06. Medido en 60 días: los 16 avisos salieron entre 0.1 y 5.5 min
-- después de emitido, y en al menos 7 el sello llegó 1-2 min después del
-- aviso. Llegar sin sello los primeros minutos es lo normal.
--
-- Ahora «sin sello» sólo avisa si el CCF lleva 5+ minutos emitido (decisión
-- del usuario). Anulado y observación NO esperan: ahí no llega nada solo.
-- La hora de emisión es fecha+hora de la factura (hora de El Salvador); si
-- falta la hora, created_at.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_ccf_alerts()
 RETURNS TABLE(branch_id bigint, branch_name text, correlativo text, tipo text, estado text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH today_date AS (
    SELECT (current_timestamp AT TIME ZONE 'America/El_Salvador')::date AS d
  ),
  problemas AS (
    SELECT p.invoice_id, p.branch_id, p.branch_name, p.correlativo, p.estado,
           CASE
             WHEN p.estado = 'NULA' THEN 'ccf_null'
             WHEN EXISTS (SELECT 1 FROM unnest(p.problemas) x WHERE x LIKE 'sin sello%')
               THEN 'ccf_pending'
             ELSE 'ccf_observacion'
           END AS tipo
    FROM today_date t, public.get_ccf_con_problema(t.d, t.d) p
  )
  SELECT p.branch_id, p.branch_name, p.correlativo, p.tipo, p.estado
  FROM problemas p
  LEFT JOIN public.sales_invoices si ON si.id = p.invoice_id
  WHERE (
      p.tipo <> 'ccf_pending'
      OR coalesce((si.fecha + si.hora) AT TIME ZONE 'America/El_Salvador', si.created_at)
           <= now() - interval '5 minutes'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.sales_alert_log l
      WHERE l.branch_id  = p.branch_id
        AND l.alert_type = p.tipo
        AND l.alert_key  = p.correlativo
    );
$function$;
