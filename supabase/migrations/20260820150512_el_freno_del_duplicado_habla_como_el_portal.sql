SET lock_timeout = '5s';

-- Dos textos del freno de duplicados, corregidos antes de que los lea nadie.
--
-- 1. «Ponelo» es voseo, y el portal no vosea. Es la misma corrección que
--    `bolsas_avisos_sin_voseo` y `cortes_caja_mensajes_sin_voseo`; el resto de
--    la frase ya estaba en tuteo («súbele», «pídeselo»), así que la línea se
--    contradecía sola.
-- 2. El repuesto de cuando el renglón no trae nombre era «el producto 2», y la
--    frase lo mete detrás de un «de»: «una solicitud de el producto 2». Pasa a
--    ser «#2», que entra en las dos frases sin chocar con la preposición.
--    (En la práctica el renglón SIEMPRE trae `descripcion` — el repuesto es
--    para que un dato incompleto no produzca una frase rota.)
CREATE OR REPLACE FUNCTION public.frenar_traslado_duplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_destino text := NEW.metadata->>'erp_sucursal_id';
    v_origen  text := NEW.metadata->>'origen_erp_sucursal_id';
    v_venc    text := coalesce(NEW.metadata->>'origen_vencidos','false');
    v_sala    text := coalesce(nullif(NEW.metadata->>'origen_branch_name',''), 'esa sala');
    v_repe    text;
    v_abierta text;
BEGIN
    -- Dos veces el mismo producto en la MISMA solicitud. Se avisa aparte de lo
    -- de abajo porque no es lo mismo que hay que hacer: acá se suman, allá se
    -- le sube la cantidad a la que ya está esperando.
    SELECT string_agg(DISTINCT coalesce(nombre, '#' || prod), ', ')
      INTO v_repe
      FROM (
          SELECT it.item->>'erp_product_id' AS prod,
                 nullif(it.item->>'descripcion','') AS nombre,
                 count(*) OVER (PARTITION BY it.item->>'erp_product_id') AS veces
          FROM jsonb_array_elements(coalesce(NEW.metadata->'items','[]'::jsonb)) AS it(item)
      ) n
     WHERE n.veces > 1;

    IF v_repe IS NOT NULL THEN
        RAISE EXCEPTION '% está más de una vez en la misma solicitud. Ponlo una sola vez con la cantidad total.', v_repe
            USING ERRCODE = '23505';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(
        'traslado:' || coalesce(v_destino,'') || ':' || coalesce(v_origen,'') || ':' || v_venc));

    SELECT string_agg(DISTINCT coalesce(nuevo.nombre, '#' || nuevo.prod), ', ')
      INTO v_abierta
      FROM (
          SELECT it.item->>'erp_product_id' AS prod,
                 nullif(it.item->>'descripcion','') AS nombre
          FROM jsonb_array_elements(coalesce(NEW.metadata->'items','[]'::jsonb)) AS it(item)
      ) nuevo
     WHERE EXISTS (
          SELECT 1
          FROM public.approval_requests a,
               jsonb_array_elements(coalesce(a.metadata->'items','[]'::jsonb)) AS ot(item)
          WHERE a.type   = 'INVENTORY_TRANSFER_REQUEST'
            AND a.status = 'PENDING'
            AND a.id <> NEW.id
            AND a.metadata->>'erp_sucursal_id'        IS NOT DISTINCT FROM v_destino
            AND a.metadata->>'origen_erp_sucursal_id' IS NOT DISTINCT FROM v_origen
            AND coalesce(a.metadata->>'origen_vencidos','false') = v_venc
            AND ot.item->>'erp_product_id' = nuevo.prod
     );

    IF v_abierta IS NOT NULL THEN
        RAISE EXCEPTION 'Ya hay una solicitud de % a % esperando respuesta. Si necesitas más, súbele la cantidad a esa solicitud o pídeselo a otra sala.', v_abierta, v_sala
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.frenar_traslado_duplicado() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.frenar_traslado_duplicado() TO authenticated, service_role;
