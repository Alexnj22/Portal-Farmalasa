SET lock_timeout = '5s';

-- Las solicitudes de traslado que el portal cree EN CAMINO.
--
-- Una tarjeta «Ya llegó, recibir» se apaga cuando el portal anota `erp_recibido`.
-- Si el traslado entra a la sala POR FUERA del portal —alguien lo recibe a mano
-- en el sistema, o el sistema lo recibe y contesta algo que el portal no puede
-- leer como éxito— nadie escribe esa marca y la tarjeta se queda pidiendo una
-- llegada que ya ocurrió. Medido el 2026-08-20: 1 de 18 tarjetas abiertas
-- (el VASOTRATE del 17-ago, traslado 29444, FINALIZADO en el sistema).
--
-- Esta función dice sólo QUÉ mirar. Si el traslado entró o no lo contesta el
-- sistema, que es el único que lo sabe.
--
-- `p_minutos` deja fuera lo recién despachado: una recepción en vuelo no es una
-- tarjeta vieja.
CREATE OR REPLACE FUNCTION public.traslados_por_barrer(p_minutos integer DEFAULT 15)
RETURNS TABLE (
    request_id      uuid,
    erp_sucursal_id integer,
    id_traslado     text,
    producto        text,
    enviado_at      text
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
    SELECT r.id,
           (r.metadata->>'erp_sucursal_id')::integer,
           r.metadata->'erp_traslado'->>'id_traslado',
           r.metadata->'items'->0->>'descripcion',
           r.metadata->'erp_traslado'->>'at'
    FROM public.approval_requests r
    WHERE r.type   = 'INVENTORY_TRANSFER_REQUEST'
      AND r.status = 'APPROVED'
      AND r.metadata ? 'erp_traslado'
      AND NOT (r.metadata ? 'erp_recibido')
      AND r.metadata->'erp_traslado'->>'id_traslado' IS NOT NULL
      -- El id de sala se compara como TEXTO adentro del jsonb; si viniera con
      -- otra forma, el cast reventaría la consulta entera en vez de saltear la
      -- fila. Se filtra antes.
      AND (r.metadata->>'erp_sucursal_id') ~ '^[0-9]+$'
      AND r.updated_at < now() - make_interval(mins => p_minutos)
    ORDER BY r.updated_at;
$$;

-- Cierra UNA tarjeta cuyo traslado el sistema ya tenía recibido.
--
-- Tres condiciones, y ninguna es decorativa:
--   · `NOT (metadata ? 'erp_recibido')` — si alguien la cerró en el medio, esto
--     no la pisa. La marca de quien apretó el botón vale más que la del barrido.
--   · el número tiene que seguir siendo el mismo que se verificó contra el
--     sistema; si cambió, lo que se comprobó ya no es lo que se cerraría.
--   · `by`/`by_name` van en NULL a propósito: el sistema no dice quién lo
--     recibió y acá no se inventa una firma. Lo que sí queda escrito es que la
--     carga NO la hizo el portal (`via: 'sistema'`, `por: 'barrido'`).
CREATE OR REPLACE FUNCTION public.cerrar_traslado_ya_recibido(
    p_request_id  uuid,
    p_id_traslado text,
    p_msg         text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_filas integer;
BEGIN
    UPDATE public.approval_requests r
       SET metadata = jsonb_set(r.metadata, '{erp_recibido}', jsonb_build_object(
               'at',          to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'by',          NULL,
               'by_name',     NULL,
               'id_traslado', p_id_traslado,
               'via',         'sistema',
               'por',         'barrido',
               'msg',         coalesce(p_msg, 'El sistema ya lo tenia recibido; el portal cerro la solicitud sola.')
           ), true)
     WHERE r.id     = p_request_id
       AND r.type   = 'INVENTORY_TRANSFER_REQUEST'
       AND r.status = 'APPROVED'
       AND NOT (r.metadata ? 'erp_recibido')
       AND r.metadata->'erp_traslado'->>'id_traslado' = p_id_traslado;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN v_filas > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.traslados_por_barrer(integer)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_traslado_ya_recibido(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.traslados_por_barrer(integer)                 TO service_role;
GRANT  EXECUTE ON FUNCTION public.cerrar_traslado_ya_recibido(uuid, text, text) TO service_role;
