SET lock_timeout = '5s';

-- Los traslados DESPACHADOS y todavía SIN RECIBIR, filtrados en la base.
--
-- Antes el navegador se bajaba las 201 primeras solicitudes APROBADAS con su
-- `metadata` jsonb entero —397 kB medidos el 2026-08-20, el 41% de todo lo que
-- baja el Inicio— y recién ahí aplicaba el filtro en JavaScript.
--
-- Y ese `.range(0, 200)` no era sólo peso: hay 205 aprobadas, así que las 4
-- últimas nunca se miraban. Medido: 19 traslados cumplen la condición y el
-- portal mostraba 16. Tres cajas despachadas y sin recibir eran INVISIBLES.
--
-- El predicado reproduce la verdad de JavaScript, no la de SQL: `erp_traslado &&
-- !erp_recibido` en JS es falso para ausente, null, false, 0 y cadena vacía. Un
-- `IS NOT NULL` a secas daría por bueno un `false`, y `? 'clave'` daría por malo
-- un null explícito. Por eso va contra el texto y contra la lista de falsos.
--
-- INVOKER a propósito (no DEFINER): así el RLS de `approval_requests` sigue
-- decidiendo quién ve qué, exactamente como cuando la consulta salía del
-- navegador. Una función DEFINER acá cambiaría en silencio la visibilidad.
--
-- `RETURNS json` y no SETOF: un SETOF vuelve a caer bajo el techo de 1000 filas
-- de PostgREST, que trunca sin avisar (regla del CLAUDE.md). Con json no hay
-- techo, y son 19 filas.
CREATE OR REPLACE FUNCTION public.get_traslados_por_recibir(p_branch_id text DEFAULT NULL)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.updated_at ASC), '[]'::json)
  FROM (
    SELECT ar.id, ar.employee_id, ar.approver_id, ar.note,
           ar.metadata, ar.created_at, ar.updated_at
    FROM public.approval_requests ar
    WHERE ar.type   = 'INVENTORY_TRANSFER_REQUEST'
      AND ar.status = 'APPROVED'
      AND coalesce(ar.metadata->>'erp_traslado', '') NOT IN ('', 'false', '0')
      AND coalesce(ar.metadata->>'erp_recibido', '') IN  ('', 'false', '0')
      AND (p_branch_id IS NULL OR ar.metadata->>'branch_id' = p_branch_id)
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_traslados_por_recibir(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_traslados_por_recibir(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_traslados_por_recibir(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_traslados_por_recibir(text) IS
  'Traslados despachados y sin recibir. Reemplaza la descarga de 201 solicitudes + filtro en el navegador (2026-08-20). INVOKER: el RLS decide.';
