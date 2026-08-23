SET lock_timeout = '5s';

-- La marca del paso terminado se armaba con `replace(p_paso,'ndo','do')`, que
-- acierta con «despachando → despachado» y falla con los otros dos:
-- «decidiendo» da «decidiedo» y «recibiendo» da «recibiedo». Una regla de
-- cadenas que funciona para el caso con el que se la probó y no para el resto —
-- el nombre de la clave se escribe, no se deduce.
CREATE OR REPLACE FUNCTION public.soltar_paso_envio(p_request_id uuid, p_paso text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_hecho text := CASE p_paso
        WHEN 'despachando' THEN 'despachado_at'
        WHEN 'decidiendo'  THEN 'decidido_at'
        WHEN 'recibiendo'  THEN 'recibido_at'
    END;
BEGIN
    IF v_hecho IS NULL THEN
        RAISE EXCEPTION 'Paso desconocido: %', p_paso;
    END IF;
    -- Las claves del candado se BORRAN en vez de quedar en null: un
    -- `decidiendo_at` nulo y uno ausente significan lo mismo, y media base
    -- pregunta por uno solo de los dos.
    EXECUTE format(
        'UPDATE public.approval_requests
            SET metadata = (coalesce(metadata, ''{}''::jsonb) - %L - %L)
                           || jsonb_build_object(%L, now())
          WHERE id = $1 AND type = ''INVENTORY_TRANSFER_PUSH''',
        p_paso || '_at', p_paso || '_by', v_hecho)
    USING p_request_id;
END;
$function$;
