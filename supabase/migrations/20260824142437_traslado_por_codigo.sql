SET lock_timeout = '5s';

-- Del número de las barras a la bolsa que tengo en la mano.
--
-- El ticket que viaja pegado a la bolsa lleva `id_traslado` en su código; lo
-- que la pantalla necesita para confirmar es el `id` de la solicitud, que vive
-- en otra columna. Sin esta función no hay camino del papel a la fila.
--
-- INVOKER a propósito: el RLS de `approval_requests` sigue decidiendo quién ve
-- qué, igual que `get_traslados_por_recibir`. Consecuencia aceptada: un traslado
-- de otra sala se ve igual que uno inexistente, y el mensaje lo dice así en vez
-- de afirmar que no existe.
--
-- `RETURNS json` y no SETOF: es una fila sola, y así no cae bajo el techo de las
-- 1000 de PostgREST ni obliga a desenvolver un arreglo del lado del navegador.
CREATE OR REPLACE FUNCTION public.traslado_por_codigo(p_codigo text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  WITH codigo AS (
    -- Las barras llevan sólo dígitos y mayúsculas (`limpiarValorDeBarras`), y
    -- un lector de teclado puede dejar espacios o un salto pegado.
    SELECT nullif(regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g'), '') AS v
  ),
  hallado AS (
    SELECT ar.id, ar.status, ar.metadata, ar.created_at, ar.updated_at
    FROM public.approval_requests ar, codigo c
    WHERE c.v IS NOT NULL
      AND ar.type IN ('INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH')
      AND ar.metadata->'erp_traslado'->>'id_traslado' = c.v
    ORDER BY ar.updated_at DESC
    LIMIT 1
  ),
  -- El número de traslado es UNA sola secuencia compartida con los pedidos de
  -- Bodega (medido 2026-08-24: pedidos 28480–32205, traslados 29441–32278). Así
  -- que un código que no es de un traslado puede ser perfectamente de un pedido,
  -- y decirlo evita el callejón sin salida de «ese código no existe» sobre un
  -- papel que sí está en la mano.
  --
  -- ⚠️ Al ser INVOKER, este EXISTS pasa por el RLS de `pedido_traslado_linea`,
  -- que pide permiso de ver `pedidos`. Quien no lo tenga verá «no encontramos
  -- ese traslado» en vez de «es de un pedido»: se degrada el MENSAJE, nunca la
  -- decisión. Subirlo a DEFINER para mejorar un texto abriría la tabla entera.
  es_de_pedido AS (
    SELECT EXISTS (
      SELECT 1 FROM public.pedido_traslado_linea l, codigo c
      WHERE c.v IS NOT NULL AND l.id_traslado = c.v
    ) AS si
  )
  SELECT to_json(t) FROM (
    SELECT
      (SELECT v FROM codigo)                              AS codigo,
      h.id,
      h.status,
      h.metadata->>'origen_branch_name'                   AS origen,
      h.metadata->>'branch_name'                          AS destino,
      h.metadata->>'branch_id'                            AS branch_id_destino,
      h.metadata->'items'                                 AS items,
      h.metadata->'erp_traslado'->>'by_name'              AS envio,
      h.metadata->'erp_traslado'->>'at'                   AS despachado_at,
      (h.metadata->'erp_traslado' ? 'por_respaldo')       AS por_respaldo,
      -- «Ya recibido» se pregunta con la verdad de JavaScript, no con IS NULL:
      -- la clave puede venir ausente, en `null`, en `false` o en `0`, y las
      -- cuatro significan lo mismo. Es la misma lectura que
      -- `get_traslados_por_recibir`, y tiene que serlo: si divergieran, un
      -- traslado podría aparecer en la lista de pendientes y a la vez rebotar
      -- acá como ya recibido.
      (coalesce(h.metadata->>'erp_recibido', '') NOT IN ('', 'false', '0')) AS ya_recibido,
      h.metadata->'erp_recibido'->>'by_name'              AS recibio,
      h.metadata->'erp_recibido'->>'at'                   AS recibido_at,
      (SELECT si FROM es_de_pedido)                       AS es_de_un_pedido
    FROM hallado h
    RIGHT JOIN (SELECT 1) uno ON true
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.traslado_por_codigo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.traslado_por_codigo(text) TO authenticated, service_role;
