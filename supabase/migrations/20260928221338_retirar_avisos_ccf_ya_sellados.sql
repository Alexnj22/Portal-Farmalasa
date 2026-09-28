-- Si el sello llega DESPUÉS del aviso «CCF sin sello», el aviso se retira
-- solo de la campana (pedido del usuario, 2026-09-28). La espera de 5 min
-- (20260928220905) evita la mayoría; esto cubre al que llega tarde igual.
--
-- Retirar = `deleted_at`, que en este portal significa «salió de la campana»:
-- el listado de notificaciones lo sigue mostrando (decisión del 2026-09-04),
-- y la metadata dice por qué se fue. El push que ya llegó al teléfono no se
-- puede retirar.
--
-- «Tiene sello» = sello VÁLIDO, 40 caracteres (regla del sello: `recibido_mh`
-- es text y `IS NOT NULL` da por buena cualquier basura). La factura se busca
-- por sala + correlativo + fecha de la metadata, que es como la identifica el
-- aviso; el correlativo solo se repite entre salas y tipos de documento.
--
-- La llama check-sales-alerts en cada corrida (cada 5 min).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.retirar_avisos_ccf_ya_sellados()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH retirados AS (
    UPDATE public.notifications n
       SET deleted_at = now(),
           metadata   = n.metadata || jsonb_build_object(
                          'retirado', 'sello_llego',
                          'retirado_at', now())
     WHERE n.type = 'SALES_ALERT'
       AND n.deleted_at IS NULL
       AND n.created_at > now() - interval '3 days'
       AND n.metadata->>'alert_type' = 'ccf_pending'
       AND EXISTS (
         SELECT 1 FROM public.sales_invoices si
          WHERE si.branch_id      = n.branch_id
            AND si.correlativo    = n.metadata->>'alert_key'
            AND si.tipo_documento = 'CCF'
            AND si.fecha          = coalesce((n.metadata->>'fecha')::date, si.fecha)
            AND length(si.recibido_mh) = 40
       )
    RETURNING 1
  )
  SELECT count(*)::int FROM retirados;
$function$;

REVOKE EXECUTE ON FUNCTION public.retirar_avisos_ccf_ya_sellados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retirar_avisos_ccf_ya_sellados() TO service_role;

COMMENT ON FUNCTION public.retirar_avisos_ccf_ya_sellados() IS
  'Saca de la campana (deleted_at) los avisos «CCF sin sello» cuyo CCF ya tiene sello válido de 40. El listado los sigue mostrando, con metadata.retirado = sello_llego. La llama check-sales-alerts cada 5 min.';
