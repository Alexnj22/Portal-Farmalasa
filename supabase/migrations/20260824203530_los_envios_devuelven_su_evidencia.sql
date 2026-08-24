-- Un envío por avería sin forma de ver la foto es una foto que no existe.
--
-- `get_envios_vivos` y `get_envios_historial` devuelven el motivo y el texto
-- escrito, pero no la evidencia. Es exactamente lo que pasó con «Descargar por
-- daño»: el widget OBLIGABA a tomar la foto desde el 2026-08-07 y ninguna
-- pantalla la mostró nunca — quien aprobaba el descarte no podía ver el daño.
--
-- Acá el destinatario es Bodega, que abre la caja y decide si se le reclama al
-- proveedor, se repara o se da de baja. Si la foto no llega con el envío, lo
-- único que llega es una palabra.
--
-- Va en las DOS: en la viva para decidir, y en el historial porque el reclamo
-- al proveedor se arma después, cuando el envío ya se cerró.
--
-- Se devuelve la URL en formato público —la que se guardó como identificador,
-- regla 10 de CLAUDE.md— y NO una firmada: la firma expira, así que firmar acá
-- entregaría enlaces muertos a cualquiera que mire la lista un rato después.
-- La pantalla firma en el momento de pintar, con `getSignedFileUrl`.
--
-- `coalesce(..., '[]')` y no `NULL`: los cinco motivos restantes no llevan
-- foto, y una lista vacía se recorre igual sin que cada pantalla tenga que
-- acordarse de mirar si existe.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_envios_vivos()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.created_at DESC), '[]'::json)
    FROM (
      SELECT r.id, r.status, r.created_at, r.updated_at,
             r.employee_id, r.approver_id, r.approver_note,
             r.metadata->>'motivo_tipo'                              AS motivo_tipo,
             coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
             CASE WHEN jsonb_typeof(r.metadata->'evidencia_urls') = 'array'
                  THEN r.metadata->'evidencia_urls' ELSE '[]'::jsonb END AS evidencia_urls,
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

CREATE OR REPLACE FUNCTION public.get_envios_historial(p_limite integer DEFAULT 100)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.updated_at DESC), '[]'::json)
    FROM (
      SELECT r.id, r.status, r.created_at, r.updated_at,
             r.employee_id, r.approver_id, r.approver_note,
             r.metadata->>'motivo_tipo'                              AS motivo_tipo,
             coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
             CASE WHEN jsonb_typeof(r.metadata->'evidencia_urls') = 'array'
                  THEN r.metadata->'evidencia_urls' ELSE '[]'::jsonb END AS evidencia_urls,
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
