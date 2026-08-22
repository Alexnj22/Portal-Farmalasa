SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- ENVIAR PRODUCTO A OTRA SALA — las lecturas
--
-- Las dos son INVOKER y `RETURNS json`. INVOKER porque el RLS ya sabe quién ve
-- qué envío y escribirlo otra vez acá es cómo terminan diciendo cosas distintas;
-- `json` porque un envío trae sus renglones adentro y el techo de 1000 filas no
-- aplica a un objeto — la lección de `get_traslados_por_recibir`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_envios_vivos()
 RETURNS json LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json)
    FROM (
      SELECT r.id, r.status, r.created_at, r.updated_at,
             r.employee_id, r.approver_id, r.approver_note,
             r.metadata->>'motivo_tipo'                              AS motivo_tipo,
             coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
             nullif(r.metadata->>'origen_branch_id','')::integer     AS origen_branch_id,
             r.metadata->>'origen_branch_name'                       AS origen_branch_name,
             nullif(r.metadata->>'origen_erp_sucursal_id','')::integer AS origen_erp_sucursal_id,
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
       WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
         AND EXISTS (SELECT 1 FROM public.envio_linea l
                      WHERE l.request_id = r.id
                        AND l.estado IN ('por_enviar','enviada','error','devuelta'))
    ) t;
$function$;

-- Lo que ya se cerró. Sin esto un envío desaparece de la única pantalla que lo
-- mostraba en cuanto termina — el mismo hueco que tuvo el traslado hasta el
-- 2026-08-07, cuando sus 6 movimientos históricos estaban invisibles.
CREATE OR REPLACE FUNCTION public.get_envios_historial(p_limite integer DEFAULT 100)
 RETURNS json LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.updated_at DESC), '[]'::json)
    FROM (
      SELECT r.id, r.status, r.created_at, r.updated_at,
             r.employee_id, r.approver_id, r.approver_note,
             r.metadata->>'motivo_tipo'                              AS motivo_tipo,
             coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
             nullif(r.metadata->>'origen_branch_id','')::integer     AS origen_branch_id,
             r.metadata->>'origen_branch_name'                       AS origen_branch_name,
             nullif(r.metadata->>'branch_id','')::integer            AS branch_id,
             r.metadata->>'branch_name'                              AS branch_name,
             (SELECT coalesce(json_agg(json_build_object(
                        'posicion', l.posicion, 'descripcion', l.descripcion,
                        'erp_product_id', l.erp_product_id,
                        'presentacion_tipo', l.presentacion_tipo, 'factor', l.factor,
                        'cantidad', l.cantidad, 'unidades', l.unidades,
                        'estado', l.estado, 'motivo_rechazo', l.motivo_rechazo,
                        'nota_rechazo', l.nota_rechazo) ORDER BY l.posicion), '[]'::json)
                FROM public.envio_linea l WHERE l.request_id = r.id) AS lineas
        FROM public.approval_requests r
       WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
         AND NOT EXISTS (SELECT 1 FROM public.envio_linea l
                          WHERE l.request_id = r.id
                            AND l.estado IN ('por_enviar','enviada','error','devuelta'))
       ORDER BY r.updated_at DESC
       LIMIT greatest(1, least(coalesce(p_limite, 100), 500))
    ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_envios_vivos() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_envios_historial(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_envios_vivos() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_envios_historial(integer) TO authenticated, service_role;
