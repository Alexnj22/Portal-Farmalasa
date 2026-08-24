-- `ubicacion` era un comodin, y con seis campos en la lista empezo a tapar.
--
-- El freno `ya_corregido` significa «este campo ya se corrigio ANTES de este
-- rechazo, asi que la correccion no alcanzo»: la ficha va a «Por revisar» en vez
-- de reintentar lo mismo cada noche. Correcto — pero la condicion era:
--
--     k.campo IN (rc.campo_ficha, 'ubicacion')
--
-- Ese `'ubicacion'` suelto es un comodin. Esta ahi porque una correccion de
-- ubicacion se anota con campo `ubicacion` y cubre a los TRES campos de
-- domicilio a la vez (distrito, municipio, departamento), que es cierto y hace
-- falta. Lo que no es cierto es que cubra al DUI, al telefono o al correo.
--
-- Medido el 2026-08-24 sobre TOBIAS GALDAMEZ RAUDA (erp 28026): su unica
-- correccion fue `ubicacion` el 23-ago a las 03:30 —le faltaba el municipio— y
-- una hora despues Hacienda rechazo su factura 0000082722_COF por el CORREO. El
-- freno leia «ya se corrigio» y lo mandaba a «Por revisar» con el motivo
-- `rechazo_persistente`, que dice «ya se corrigio el correo y Hacienda lo volvio
-- a rechazar». **Al correo no lo habia tocado nadie.**
--
-- Un freno que se dispara sobre un campo que nunca se intento no protege de un
-- bucle: esconde el caso, y encima lo describe mal. Con la lista de cinco campos
-- el dano era chico —el DUI y el telefono casi nunca coinciden con un rechazo de
-- ubicacion—; con el correo adentro aparecio al primer caso real.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fichas_para_corregir_dte()
 RETURNS TABLE(customer_id bigint, name text, erp_id text, categoria text, origen text, campo text, motivo_mh text, alcance_escritura text, ya_corregido boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH rechazados AS (
    SELECT DISTINCT ON (r.customer_id, r.campo_ficha)
           r.customer_id, r.cliente, r.erp_id, r.categoria,
           r.campo_ficha, r.motivo, r.ultimo_intento
    FROM public.dte_rechazos_vigentes r
    WHERE r.accionable
      -- `phone` se sumo el 2026-08-16, `email` el 2026-08-24. La lista es «que
      -- campos sabe corregir la corrida de fichas», y tiene que coincidir con
      -- las ramas de su tabla de decision: un campo de mas deja una ficha dando
      -- vueltas sin que nadie la escriba, uno de menos la vuelve invisible para
      -- el proceso hecho para arreglarla — que fue exactamente lo que paso con
      -- el telefono, y otra vez con el correo ocho dias despues.
      AND r.campo_ficha IN ('distrito','municipio','departamento','dui','phone','email')
      AND r.customer_id IS NOT NULL
    ORDER BY r.customer_id, r.campo_ficha, r.ultimo_intento DESC
  ),
  todo AS (
    -- (1) Lo que Hacienda rechazo. La senal que no depende del espejo.
    SELECT rc.customer_id, rc.cliente AS name, rc.erp_id, rc.categoria,
           'rechazo'::text AS origen, rc.campo_ficha AS campo, rc.motivo AS motivo_mh,
           public.alcance_escritura_ficha(rc.categoria) AS alcance_escritura,
           EXISTS (
             SELECT 1 FROM public.dte_correcciones_ficha k
             WHERE k.customer_id = rc.customer_id
               -- El mismo campo, o una correccion de ubicacion cuando el
               -- rechazo ES de ubicacion. `ubicacion` cubre a los tres campos
               -- de domicilio porque se escriben juntos — y a ningun otro.
               AND (k.campo = rc.campo_ficha
                    OR (k.campo = 'ubicacion'
                        AND rc.campo_ficha IN ('distrito','municipio','departamento')))
               AND k.created_at < rc.ultimo_intento
           ) AS ya_corregido
    FROM rechazados rc

    UNION ALL

    -- (2) Preventivo, alcance completo: consumidores y huerfanas sin distrito.
    SELECT c.id, c.name, c.erp_id, c.categoria,
           'sin_distrito'::text, 'distrito'::text, NULL::text,
           public.alcance_escritura_ficha(c.categoria), false
    FROM public.clientes_sin_distrito_corregibles() c
    WHERE NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id)

    UNION ALL

    -- (3) Preventivo, SOLO distrito: contribuyentes que todavia no rebotaron.
    SELECT c.id, c.name, c.erp_id, c.categoria,
           'sin_distrito'::text, 'distrito'::text, NULL::text,
           public.alcance_escritura_ficha(c.categoria), false
    FROM public.customers c
    WHERE c.distrito IS NULL
      AND public.alcance_escritura_ficha(c.categoria) = 'solo_distrito'
      AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
      AND NOT EXISTS (SELECT 1 FROM rechazados rc WHERE rc.customer_id = c.id)
  )
  -- El orden importa: la corrida corta en 120 fichas por presupuesto de tiempo,
  -- y lo que Hacienda ya rechazo tiene una factura esperando detras.
  SELECT t.customer_id, t.name, t.erp_id, t.categoria, t.origen, t.campo,
         t.motivo_mh, t.alcance_escritura, t.ya_corregido
  FROM todo t
  ORDER BY (t.origen <> 'rechazo'), t.customer_id;
$function$;
