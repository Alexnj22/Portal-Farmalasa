-- Libro de compras completo y declarable en UNA sola llamada (Patrón C).
--
-- Auditoría 2026-10 (grupo 4, H5). El frente los pedía por páginas de 1000
-- con `.range()` sobre funciones SETOF ordenadas por (fecha, origen,
-- documento_completo) — un orden con empates. PostgREST aplica limit/offset
-- sobre el resultado de CADA ejecución, y cada página es una ejecución
-- distinta: dos documentos empatados en el corte podían salir uno dos veces y
-- el otro ninguna. En un libro fiscal eso es un CCF de menos y otro contado
-- doble, sin error. Además cada página re-ejecutaba la función entera
-- (~1.6 s cada una, ver scripts/planes-genericos.json).
--
-- Las envolturas devuelven `json` armado con json_agg(to_json(t)) — NUNCA
-- jsonb_agg — en una sola ejecución, así que el conjunto es exactamente el de
-- la función. El orden es el de la original (fecha, origen,
-- documento_completo) y desempata la FILA ENTERA (`f`, comparación de
-- registros): dos filas que siguen empatadas son idénticas en todas las
-- columnas, o sea que el orden queda total y determinista. `to_json(f)` sin
-- lista de columnas a propósito: salen las de la original, con sus nombres y
-- en su orden, y si la original cambia de forma la envoltura la sigue sola.
--
-- plpgsql y no `LANGUAGE sql`: con `SET search_path` y parámetros sería la
-- trampa 4 de CLAUDE.md. Acá el plan no depende de los argumentos (es un
-- Function Scan), pero así no queda nada que auditar.
--
-- SECURITY DEFINER como las originales: el permiso lo siguen cobrando ellas
-- (auth_has_module_permission / auth_module_scope) con el usuario de la
-- sesión, igual que antes.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_libro_compras_completo_json(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL::bigint)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(to_json(f) ORDER BY f.fecha, f.origen, f.documento_completo, f), '[]'::json)
      FROM public.get_libro_compras_completo(p_desde, p_hasta, p_branch_id) f
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_libro_compras_declarable_json(p_desde date, p_hasta date)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  RETURN (
    SELECT coalesce(json_agg(to_json(f) ORDER BY f.fecha, f.origen, f.documento_completo, f), '[]'::json)
      FROM public.get_libro_compras_declarable(p_desde, p_hasta) f
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_libro_compras_completo_json(date, date, bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_libro_compras_declarable_json(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_libro_compras_completo_json(date, date, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_libro_compras_declarable_json(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
