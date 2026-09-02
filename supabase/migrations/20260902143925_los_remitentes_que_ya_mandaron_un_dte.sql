SET lock_timeout = '5s';

-- Quién ya nos mandó un DTE alguna vez.
--
-- El sync no abre los PDF de un correo que «no parece factura» — una guarda que
-- existe para no llenar Revisión de cotizaciones, estados de cuenta y reportes
-- POS, y que acierta: de 15 remitentes con PDF descartado, 13 no mandan DTE.
-- Pero decide leyendo el ASUNTO, y un aviso de anulación puede no nombrar el
-- documento que anula: Promerica manda «Invalidación de documento» y así perdió
-- dos CCF el 28-ago sin dejar rastro en ninguna pantalla.
--
-- Con esta lista la guarda deja de depender sólo del asunto: si el correo viene
-- de alguien que YA nos facturó, su PDF se abre igual. El costo es acotado
-- justamente porque la lista es corta y sale de los hechos, no de una
-- configuración que alguien tenga que mantener.
--
-- `RETURNS json` y no SETOF: son un puñado de filas, pero el techo de 1000 de
-- PostgREST se aplica al resultado de la función y `purchase_dte_documents` ya
-- pasa las 2,100 — un `select distinct from_email` desde el cliente se truncaría
-- en silencio y la lista quedaría incompleta sin que nada avisara.
CREATE OR REPLACE FUNCTION public.get_remitentes_dte_conocidos(p_account_id bigint DEFAULT NULL)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(correo), '[]'::json)
  FROM (
    SELECT DISTINCT lower(substring(from_email FROM '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) AS correo
    FROM public.purchase_dte_documents
    WHERE from_email IS NOT NULL
      AND (p_account_id IS NULL OR account_id = p_account_id)
  ) t
  WHERE correo IS NOT NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_remitentes_dte_conocidos(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_remitentes_dte_conocidos(bigint) TO authenticated, service_role;
