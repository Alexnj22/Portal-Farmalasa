SET lock_timeout = '5s';

-- ─── Qué llevo encima ───────────────────────────────────────────────────────
--
-- **DEFINER, y no por comodidad.** El RLS de `approval_requests` deja ver un
-- traslado sólo si su origen o su destino es TU sala. Quien hace el recorrido
-- carga bolsas entre salas ajenas —Salud 1 a Salud 2 sin ser de ninguna—, así
-- que con INVOKER el manifiesto le saldría vacío justo para lo que lleva
-- encima.
--
-- Lo que lo hace seguro no es el permiso sino el filtro: `retirador_id =
-- auth_employee_id()`. No hay parámetro que cambie de quién es el retiro, así
-- que sólo puede devolver lo que uno mismo escaneó.
CREATE OR REPLACE FUNCTION public.retiro_abierto()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  WITH mio AS (
    SELECT r.id, r.abierto_at FROM public.retiros r
    WHERE r.retirador_id = public.auth_employee_id() AND r.cerrado_at IS NULL
    LIMIT 1
  )
  SELECT to_json(t) FROM (
    SELECT
      (SELECT id FROM mio)         AS retiro_id,
      (SELECT abierto_at FROM mio) AS abierto_at,
      coalesce((
        SELECT json_agg(to_json(b) ORDER BY b.cargado_at)
        FROM (
          SELECT
            bu.request_id,
            bu.cargado_at,
            bu.origen_branch_id,
            ar.metadata->>'origen_branch_name'      AS origen,
            ar.metadata->>'branch_name'             AS destino,
            nullif(ar.metadata->>'branch_id','')::bigint AS branch_id_destino,
            ar.metadata->'items'                    AS items,
            ar.metadata->'erp_traslado'->>'id_traslado' AS codigo,
            e.name                                  AS entrego,
            -- Cuántos días lleva encima. El aviso es a los 3 (decisión del
            -- usuario) y se calcula acá para que la pantalla no tenga que
            -- inventar su propia cuenta de días.
            floor(extract(epoch FROM (now() - bu.cargado_at)) / 86400)::int AS dias
          FROM public.retiro_bultos bu
          JOIN public.approval_requests ar ON ar.id = bu.request_id
          LEFT JOIN public.employees e ON e.id = bu.entrego_id
          WHERE bu.retiro_id = (SELECT id FROM mio) AND bu.entregado_at IS NULL
        ) b
      ), '[]'::json) AS bultos
  ) t;
$function$;

-- ─── Qué está esperando salir de esta sala ─────────────────────────────────
--
-- Lo que ve quien llega: bolsas despachadas de acá, sin recibir, y que no vaya
-- cargando ya alguien. También DEFINER y por lo mismo — quien hace el recorrido
-- no es de la sala en la que está parado— pero con guarda de permiso: sin
-- `traslados`, nada.
CREATE OR REPLACE FUNCTION public.retiro_pendientes_en_sala(p_branch_id bigint)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT CASE WHEN NOT public.auth_has_module_permission('traslados', 'can_view')
    THEN '[]'::json
    ELSE coalesce((
      SELECT json_agg(to_json(t) ORDER BY t.despachado_at)
      FROM (
        SELECT ar.id AS request_id,
               ar.metadata->>'origen_branch_name' AS origen,
               ar.metadata->>'branch_name'        AS destino,
               ar.metadata->'items'               AS items,
               ar.metadata->'erp_traslado'->>'id_traslado' AS codigo,
               ar.metadata->'erp_traslado'->>'at'          AS despachado_at
        FROM public.approval_requests ar
        WHERE ar.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
          AND nullif(ar.metadata->>'origen_branch_id','')::bigint = p_branch_id
          AND coalesce(ar.metadata->>'erp_traslado', '') NOT IN ('', 'false', '0')
          AND coalesce(ar.metadata->>'erp_recibido', '') IN  ('', 'false', '0')
          AND NOT EXISTS (
            SELECT 1 FROM public.retiro_bultos b
            WHERE b.request_id = ar.id AND b.entregado_at IS NULL
          )
      ) t
    ), '[]'::json)
  END;
$function$;

-- ─── Lo que lleva más de N días sin entregarse ─────────────────────────────
-- Para el aviso de los tres días. Sin esto, un retiro que nadie cierra se queda
-- abierto para siempre y nadie se entera: el retiro no se puede cerrar con
-- bultos encima, así que ESTA es la única salida.
CREATE OR REPLACE FUNCTION public.retiro_bultos_viejos(p_dias int DEFAULT 3)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.cargado_at)
    FROM (
      SELECT bu.request_id, bu.cargado_at, r.retirador_id, e.name AS retirador,
             ar.metadata->>'origen_branch_name' AS origen,
             ar.metadata->>'branch_name'        AS destino,
             nullif(ar.metadata->>'branch_id','')::bigint AS branch_id_destino,
             floor(extract(epoch FROM (now() - bu.cargado_at)) / 86400)::int AS dias
      FROM public.retiro_bultos bu
      JOIN public.retiros r ON r.id = bu.retiro_id
      JOIN public.employees e ON e.id = r.retirador_id
      JOIN public.approval_requests ar ON ar.id = bu.request_id
      WHERE bu.entregado_at IS NULL
        AND bu.cargado_at < now() - make_interval(days => greatest(1, p_dias))
    ) t
  ), '[]'::json);
$function$;

REVOKE EXECUTE ON FUNCTION public.retiro_abierto()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retiro_pendientes_en_sala(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retiro_bultos_viejos(int)         FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retiro_abierto()                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retiro_pendientes_en_sala(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retiro_bultos_viejos(int)         TO service_role;
