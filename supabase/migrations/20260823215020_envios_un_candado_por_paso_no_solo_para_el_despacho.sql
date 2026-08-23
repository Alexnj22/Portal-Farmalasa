SET lock_timeout = '5s';

-- ── El candado deja de ser sólo del despacho ────────────────────────────────
--
-- `tomar_despacho_envio` protegía el paso que saca el producto, y los otros dos
-- quedaron sin nada. No es simétrico y no es menor:
--
--   · DECIDIR lo puede apretar cualquiera de la sala de destino, y el aviso les
--     llega a todos. Dos a la vez pasan los dos la lectura de «¿queda algo por
--     decidir?» y los dos mandan a recibir el MISMO movimiento: el producto
--     entra dos veces al inventario. La guarda que hay —preguntarle al listado
--     si el traslado sigue esperando— reusa la cola hasta 20 segundos, así que
--     no cierra esta ventana: la achica.
--   · RECIBIR LA DEVOLUCIÓN es igual, del lado de quien envió.
--
-- Un candado por PASO y no uno por envío: los tres ocurren en momentos
-- distintos y en salas distintas, y uno solo dejaría a la sala de destino sin
-- poder decidir porque la de origen está reintentando un despacho.
CREATE OR REPLACE FUNCTION public.tomar_paso_envio(
    p_request_id uuid, p_actor uuid, p_paso text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ok    boolean;
    v_clave text;
BEGIN
    IF p_paso NOT IN ('despachando','decidiendo','recibiendo') THEN
        RAISE EXCEPTION 'Paso desconocido: %', p_paso;
    END IF;
    v_clave := p_paso || '_at';

    -- Caduca a los 3 minutos: más que los 150 s que vive una invocación, así
    -- que una corrida que muera a mitad se destraba sola. Sin esto, un fallo
    -- deja el envío trabado para siempre y hay que ir a la base a soltarlo.
    --
    -- El `||` funde contra la fila VIVA: acá conviven el contador de avisos y
    -- los candados de los tres pasos, y escribir el metadata entero borraría lo
    -- que otro puso en el medio.
    EXECUTE format(
        'UPDATE public.approval_requests
            SET metadata = coalesce(metadata, ''{}''::jsonb)
                           || jsonb_build_object(%L, now(), %L, $2)
          WHERE id = $1
            AND type = ''INVENTORY_TRANSFER_PUSH''
            AND (metadata->>%L IS NULL
                 OR (metadata->>%L)::timestamptz < now() - interval ''3 minutes'')
          RETURNING true', v_clave, p_paso || '_by', v_clave, v_clave)
    INTO v_ok USING p_request_id, p_actor;

    RETURN coalesce(v_ok, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.soltar_paso_envio(p_request_id uuid, p_paso text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF p_paso NOT IN ('despachando','decidiendo','recibiendo') THEN
        RAISE EXCEPTION 'Paso desconocido: %', p_paso;
    END IF;
    -- Las claves se BORRAN en vez de quedar en null: un `decidiendo_at` nulo y
    -- uno ausente significan lo mismo, y media base pregunta por uno solo de los
    -- dos. Se suelta apenas termina la corrida — lo que quedó se reintenta
    -- apretando de nuevo, y hacer esperar tres minutos por eso no protege nada.
    EXECUTE format(
        'UPDATE public.approval_requests
            SET metadata = (coalesce(metadata, ''{}''::jsonb) - %L - %L)
                           || jsonb_build_object(%L, now())
          WHERE id = $1 AND type = ''INVENTORY_TRANSFER_PUSH''',
        p_paso || '_at', p_paso || '_by', replace(p_paso, 'ndo', 'do') || '_at')
    USING p_request_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tomar_paso_envio(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.soltar_paso_envio(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tomar_paso_envio(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.soltar_paso_envio(uuid, text) TO service_role;

COMMENT ON FUNCTION public.tomar_paso_envio(uuid, uuid, text) IS
  'Candado por paso de un envío (despachando|decidiendo|recibiendo). Caduca a los 3 minutos para que una corrida muerta no lo trabe.';
