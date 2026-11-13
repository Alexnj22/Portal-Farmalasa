-- Un envío CANCELADO ya no es «vivo» (2026-11-13).
-- `cancelar_envio` deja sus renglones en `error` (con el motivo), y estas dos
-- funciones decidían vivo/cerrado SÓLO por el estado de los renglones: el
-- cancelado quedaba para siempre en «por despachar», ofreciendo «Volver a
-- enviar» un producto que se canceló por duplicado (NUTRIGEL, Salud 5 → Bodega,
-- cancelado el 28-oct y todavía en pantalla). Las dos se mueven juntas: son
-- complemento, y un envío tiene que estar en una y sólo una.
SET lock_timeout = '5s';

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
       AND r.status IS DISTINCT FROM 'CANCELLED'
       AND EXISTS (SELECT 1 FROM public.envio_linea l
                    WHERE l.request_id = r.id
                      AND l.estado IN ('por_enviar','enviada','error','devuelta'))
  )
  SELECT coalesce(json_agg(e.j ORDER BY z.created_at DESC, z.id DESC), '[]'::json)
    FROM z
    JOIN public.envios_json(ARRAY(SELECT z2.id FROM z z2)) e ON e.id = z.id;
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
       AND (r.status = 'CANCELLED'
            OR NOT EXISTS (SELECT 1 FROM public.envio_linea l
                            WHERE l.request_id = r.id
                              AND l.estado IN ('por_enviar','enviada','error','devuelta')))
     ORDER BY r.updated_at DESC, r.id DESC
     LIMIT greatest(1, least(coalesce(p_limite, 100), 500))
  )
  SELECT coalesce(json_agg(e.j ORDER BY z.updated_at DESC, z.id DESC), '[]'::json)
    FROM z
    JOIN public.envios_json(ARRAY(SELECT z2.id FROM z z2)) e ON e.id = z.id;
$function$;
