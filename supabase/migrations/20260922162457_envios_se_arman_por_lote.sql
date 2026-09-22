-- F1 · Los envíos se arman por LOTE: una consulta para N envíos, no N consultas.
--
-- Medido el 2026-09-22 COMO USUARIO (`npm run medir:como-usuario`): el historial
-- de envíos tardaba 1,100 ms y leía 145 MB; como `postgres`, 13 ms y 11 MB. No
-- era la lectura —los envíos son 146 y sus renglones 233 en total— sino la
-- PLANIFICACIÓN: `envio_json(id)` lleva `SET search_path`, así que nunca se
-- inlinea y el historial la planificaba una vez por envío, 100 veces. Bajo la
-- policy de `approval_requests` (cinco ramas, más la de `envio_linea`, que
-- vuelve a consultarla) planificar es caro; como `postgres` no hay policy que
-- expandir y por eso ninguna medición lo había visto.
--
-- `envios_json(ids[])` arma el MISMO JSON para todos los envíos pedidos en una
-- sola consulta. Sigue siendo INVOKER: el RLS decide igual que antes qué ve cada
-- quien. `envio_json(id)` pasa a ser un caso de un solo elemento, así que la
-- forma del JSON vive en un lugar y `traslado_por_codigo` no cambia.
--
-- Comprobado en pg_temp con una cuenta de alcance total y una de Salud 1: los
-- mismos envíos con el mismo JSON (md5 por elemento). Lo único que cambia es el
-- orden ENTRE envíos con el mismo `updated_at` —tres del 29-ago se actualizaron
-- en el mismo instante—, que antes era arbitrario y ahora desempata por `id`.
--   historial  1,055 → 37 ms · 18,299 → 1,266 bloques (alcance total)
--   vivos        106 → 27 ms
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.envios_json(p_ids uuid[])
 RETURNS TABLE(id uuid, j json)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT t.id, to_json(t) FROM (
    SELECT r.id, r.status, r.created_at, r.updated_at,
           r.employee_id, r.approver_id, r.approver_note,
           r.metadata->>'codigo_bolsa'                             AS codigo_bolsa,
           r.metadata->>'motivo_tipo'                              AS motivo_tipo,
           coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
           CASE WHEN jsonb_typeof(r.metadata->'evidencia_urls') = 'array'
                THEN r.metadata->'evidencia_urls' ELSE '[]'::jsonb END AS evidencia_urls,
           nullif(r.metadata->>'origen_branch_id','')::integer     AS origen_branch_id,
           r.metadata->>'origen_branch_name'                       AS origen_branch_name,
           nullif(r.metadata->>'origen_erp_sucursal_id','')::integer AS origen_erp_sucursal_id,
           coalesce((r.metadata->>'origen_vencidos')::boolean, false) AS origen_vencidos,
           nullif(r.metadata->>'branch_id','')::integer            AS branch_id,
           r.metadata->>'branch_name'                              AS branch_name,
           nullif(r.metadata->>'erp_sucursal_id','')::integer      AS erp_sucursal_id,
           (SELECT coalesce(json_agg(json_build_object(
                      'id', l.id, 'posicion', l.posicion,
                      'erp_product_id', l.erp_product_id, 'descripcion', l.descripcion,
                      'presentacion_tipo', l.presentacion_tipo, 'factor', l.factor,
                      'cantidad', l.cantidad, 'unidades', l.unidades,
                      'estado', l.estado, 'id_traslado', l.id_traslado,
                      'id_traslado_devolucion', l.id_traslado_devolucion,
                      'aviso', l.aviso, 'error', l.error,
                      'motivo_rechazo', l.motivo_rechazo, 'nota_rechazo', l.nota_rechazo,
                      'decidido_por', l.decidido_por, 'decidido_at', l.decidido_at,
                      'enviado_at', l.enviado_at, 'recibido_at', l.recibido_at,
                      'devuelto_at', l.devuelto_at) ORDER BY l.posicion), '[]'::json)
              FROM public.envio_linea l WHERE l.request_id = r.id) AS lineas
      FROM public.approval_requests r
     WHERE r.id = ANY (p_ids) AND r.type = 'INVENTORY_TRANSFER_PUSH'
  ) t;
$function$;

REVOKE ALL ON FUNCTION public.envios_json(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.envios_json(uuid[]) TO authenticated, service_role;

-- El de un solo envío: la misma forma, dicha una vez.
CREATE OR REPLACE FUNCTION public.envio_json(p_request_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.j FROM public.envios_json(ARRAY[p_request_id]) e;
$function$;

CREATE OR REPLACE FUNCTION public.get_envios_historial(p_limite integer DEFAULT 100)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH z AS MATERIALIZED (
    SELECT r.id, r.updated_at
      FROM public.approval_requests r
     WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
       AND NOT EXISTS (SELECT 1 FROM public.envio_linea l
                        WHERE l.request_id = r.id
                          AND l.estado IN ('por_enviar','enviada','error','devuelta'))
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT greatest(1, least(coalesce(p_limite, 100), 500))
  )
  SELECT coalesce(json_agg(e.j ORDER BY z.updated_at DESC, z.id DESC), '[]'::json)
    FROM z
    JOIN public.envios_json(ARRAY(SELECT z2.id FROM z z2)) e ON e.id = z.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_envios_vivos()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH z AS MATERIALIZED (
    SELECT r.id, r.created_at
      FROM public.approval_requests r
     WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
       AND EXISTS (SELECT 1 FROM public.envio_linea l
                    WHERE l.request_id = r.id
                      AND l.estado IN ('por_enviar','enviada','error','devuelta'))
  )
  SELECT coalesce(json_agg(e.j ORDER BY z.created_at DESC, z.id DESC), '[]'::json)
    FROM z
    JOIN public.envios_json(ARRAY(SELECT z2.id FROM z z2)) e ON e.id = z.id;
$function$;
