SET lock_timeout = '5s';

-- ── El candado del despacho, en la base ────────────────────────────────────
--
-- Estaba en la Edge Function como un `update({ metadata: { ...meta, … } })`, o
-- sea LEER, modificar en memoria y ESCRIBIR el jsonb entero. Eso funciona
-- mientras nadie más escriba ahí, y el aviso al destino acaba de empezar a
-- hacerlo (`avisado_lineas`): un despacho que se retoma leía el metadata al
-- arrancar, lo reescribía al terminar y **borraba el contador de avisos** — con
-- lo que el aviso volvía a salir, que es justo lo que ese contador vino a
-- evitar. El clásico hueco entre leer y escribir.
--
-- Acá el `||` de jsonb funde contra la fila VIVA, así que ninguna de las dos
-- escrituras pisa lo que la otra puso. Y de paso el chequeo de caducidad deja
-- de depender de un `.or()` con una fecha interpolada en el cliente.

CREATE OR REPLACE FUNCTION public.tomar_despacho_envio(p_request_id uuid, p_actor uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ok boolean;
BEGIN
    -- Caduca a los 3 minutos: más que los 150 s que vive una invocación, así
    -- que una corrida que muera a mitad se destraba sola. Sin esto, un fallo
    -- deja el envío trabado para siempre y hay que ir a la base a soltarlo.
    UPDATE public.approval_requests
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('despachando_at', now(), 'despachando_by', p_actor)
     WHERE id = p_request_id
       AND type = 'INVENTORY_TRANSFER_PUSH'
       AND status = 'PENDING'
       AND (metadata->>'despachando_at' IS NULL
            OR (metadata->>'despachando_at')::timestamptz < now() - interval '3 minutes')
    RETURNING true INTO v_ok;
    RETURN coalesce(v_ok, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_despacho_envio(p_request_id uuid)
 RETURNS void LANGUAGE sql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    -- Se suelta en cuanto termina la corrida: lo que quedó se reintenta
    -- apretando de nuevo, y hacer esperar tres minutos por eso no protege de
    -- nada. Las claves del candado se BORRAN en vez de quedar en null — un
    -- `despachando_at` nulo y uno ausente significan lo mismo y la mitad del
    -- código pregunta por uno solo de los dos.
    UPDATE public.approval_requests
       SET metadata = (coalesce(metadata, '{}'::jsonb) - 'despachando_at' - 'despachando_by')
                      || jsonb_build_object('despachado_at', now())
     WHERE id = p_request_id
       AND type = 'INVENTORY_TRANSFER_PUSH'
       AND status = 'PENDING';
$function$;

REVOKE EXECUTE ON FUNCTION public.tomar_despacho_envio(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cerrar_despacho_envio(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tomar_despacho_envio(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cerrar_despacho_envio(uuid) TO service_role;
