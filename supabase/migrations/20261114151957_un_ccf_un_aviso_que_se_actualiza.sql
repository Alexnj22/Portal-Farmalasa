SET lock_timeout = '5s';

-- Un CCF con problema = UN aviso en la campana, que se actualiza (2026-11-14).
--
-- El usuario lo pidió al revisar su campana: el CCF N.º 72 de Salud 2 dejó
-- tres avisos (14:42 «CCF sin sello», 22:00 «Cierre del día: CCF sin
-- corregir», 08:00 el resumen del envío a Hacienda). Los dos primeros son de
-- `check-sales-alerts` y hablan de la MISMA factura con otra clave.
--
-- `avisar_ccf` reemplaza al aviso anterior de esa factura (misma sala, mismo
-- correlativo): retira el viejo y crea el nuevo arriba, sin leer y con push,
-- llevando en `metadata.avisos_previos` cuántas veces ya sonó y desde cuándo.
-- Se reutiliza `notify_employees` para no tener dos caminos de push.
--
-- `retirar_avisos_ccf_ya_sellados` ahora retira también el repaso y la
-- observación cuando la factura ya tiene sello válido, y el aviso de anulada
-- cuando quedó invalidada ante Hacienda: un aviso de algo ya resuelto no
-- queda pidiendo nada.
--
-- El resumen de las 08:00 (`alertar_barrido_dte`) NO se toca: es la salud del
-- envío nocturno de TODAS las facturas (también consumidor final, y avisa si
-- el envío ni corrió), va al rol de alertas técnicas y se está integrando al
-- resumen de la mañana.

CREATE OR REPLACE FUNCTION public.avisar_ccf(
    p_recipients  uuid[],
    p_branch_id   integer,
    p_correlativo text,
    p_title       text,
    p_body        text,
    p_link        text,
    p_metadata    jsonb,
    p_push        boolean DEFAULT true
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_previos int;
    v_desde   timestamptz;
BEGIN
    WITH viejos AS (
        UPDATE public.notifications n
           SET deleted_at = now(),
               metadata   = n.metadata || jsonb_build_object('retirado', 'reemplazado', 'retirado_at', now())
         WHERE n.type = 'SALES_ALERT'
           AND n.deleted_at IS NULL
           AND n.branch_id = p_branch_id
           AND n.recipient_id = ANY (p_recipients)
           AND n.created_at > now() - interval '40 days'
           AND n.metadata->>'alert_type' IN ('ccf_pending', 'ccf_observacion', 'ccf_null', 'ccf_repaso')
           AND coalesce(n.metadata->>'correlativo',
                        regexp_replace(n.metadata->>'alert_key', '^.*\|', '')) = p_correlativo
        RETURNING coalesce((n.metadata->>'avisos_previos')::int, 0) AS previos,
                  coalesce((n.metadata->>'primer_aviso')::timestamptz, n.created_at) AS desde
    )
    SELECT max(previos) + 1, min(desde) INTO v_previos, v_desde FROM viejos;

    RETURN public.notify_employees(
        p_recipients, 'SALES_ALERT', p_title, p_body, p_link,
        coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object('correlativo', p_correlativo,
                                'avisos_previos', coalesce(v_previos, 0),
                                'primer_aviso', coalesce(v_desde, now())),
        p_push, p_branch_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_ccf(uuid[], integer, text, text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_ccf(uuid[], integer, text, text, text, text, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.retirar_avisos_ccf_ya_sellados()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH retirados AS (
    UPDATE public.notifications n
       SET deleted_at = now(),
           metadata   = n.metadata || jsonb_build_object(
                          'retirado', 'resuelto',
                          'retirado_at', now())
     WHERE n.type = 'SALES_ALERT'
       AND n.deleted_at IS NULL
       AND n.created_at > now() - interval '40 days'
       AND n.metadata->>'alert_type' IN ('ccf_pending', 'ccf_observacion', 'ccf_null', 'ccf_repaso')
       AND EXISTS (
         SELECT 1 FROM public.sales_invoices si
          WHERE si.branch_id      = n.branch_id
            AND si.correlativo    = coalesce(n.metadata->>'correlativo',
                                             regexp_replace(n.metadata->>'alert_key', '^.*\|', ''))
            AND si.tipo_documento = 'CCF'
            AND si.fecha          = coalesce((n.metadata->>'fecha')::date, si.fecha)
            AND CASE WHEN si.estado = 'NULA'
                     -- Anulada: se resuelve cuando quedó invalidada ante Hacienda.
                     THEN false
                     WHEN si.estado = 'DTE INVALIDADO EN MH' THEN true
                     ELSE length(si.recibido_mh) = 40 END
       )
    RETURNING 1
  )
  SELECT count(*)::int FROM retirados;
$function$;
