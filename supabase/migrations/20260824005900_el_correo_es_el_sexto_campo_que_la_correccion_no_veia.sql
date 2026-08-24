-- El correo es el SEXTO campo, y repitio el defecto del telefono.
--
-- `clasificar_observacion_mh` clasifica «Campo #/receptor/correo no cumple el
-- formato requerido» como accionable, familia `receptor`, `campo_ficha =
-- email`. Todo bien hasta ahi. Pero la lista de esta funcion —«que campos sabe
-- corregir la corrida de fichas»— no lo tenia, asi que la ficha nunca llegaba a
-- ser candidata: bien clasificada, marcada accionable, e invisible para el
-- proceso hecho para arreglarla.
--
-- Es palabra por palabra lo que el comentario de adentro ya advertia sobre el
-- telefono el 2026-08-16. La advertencia estaba escrita y el defecto volvio a
-- pasar igual, en el campo siguiente.
--
-- Medido el 2026-08-24: DOS facturas de Salud 1 —0000082479_COF (20-ago, 4
-- intentos) y 0000082722_COF (22-ago)— rebotaban cada noche por el correo, y
-- `fichas_para_corregir_dte()` devolvia UN solo candidato por rechazo, que no
-- era ninguna de las dos. El barrido anotaba «la correccion de fichas no cambio
-- nada» y se iba a dormir.
--
-- La regla del correo (usuario, 2026-08-24) vive en la rama nueva de
-- `sincronizar-fichas-clientes`: primero se intenta arreglar el TIPEO —espacios,
-- «.con» por «.com»—, porque conservar el correo de la persona es mejor que
-- borrarlo. Si no hay tipeo que arreglar, se parte en dos:
--
--   · contribuyente -> su credito fiscal EXIGE correo, asi que no se borra: hay
--     que pedirselo a la sala que hizo la venta.
--   · consumidor u otra categoria -> en su documento el correo es opcional, asi
--     que se borra. Es la regla del DUI y no la del telefono: inventarle un
--     correo seria un dato de contacto falso, y aca no hace falta que exista.

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
               AND k.campo IN (rc.campo_ficha, 'ubicacion')
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
