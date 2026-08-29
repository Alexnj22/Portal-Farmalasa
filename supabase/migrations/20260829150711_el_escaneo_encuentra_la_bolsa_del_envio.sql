SET lock_timeout = '5s';

-- Del código del ticket a la bolsa, cuando la bolsa es un ENVÍO.
--
-- `traslado_por_codigo` sabía leer un número de traslado. La bolsa del envío no
-- tiene uno solo —tiene hasta ocho, uno por renglón— así que ahora lleva su
-- propio código (`metadata.codigo_bolsa`, `E00042`) y el escaneo tiene que
-- poder llegar a ella igual que llega a una solicitud.
--
-- ── Por qué el envío se devuelve ENTERO y el traslado no ───────────────────
-- Lo que sigue al escaneo es distinto en cada familia, y eso decide la forma de
-- la respuesta:
--
--   · Una SOLICITUD se recibe de una: la sala la pidió, así que confirmar la
--     llegada es un botón. Alcanza con decir qué trae.
--   · Un ENVÍO se decide producto por producto —nadie lo pidió, y quien recibe
--     puede quedárselo, devolverlo, o decir que no llegó—. Esa pantalla ya
--     existe (`FilaEnvioPorDecidir`) y necesita el envío completo con sus
--     renglones, así que se devuelve tal cual lo devuelve la lista: si la
--     respuesta trajera menos, habría que ir a buscarlo en un segundo viaje y
--     la pantalla tendría dos formas del mismo envío.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · La forma de un envío, escrita UNA vez
-- ══════════════════════════════════════════════════════════════════════════
--
-- Estaba escrita dos veces —`get_envios_vivos` y `get_envios_historial`— y con
-- claves distintas, que es el defecto justo antes de que se comporten distinto.
-- El escaneo habría sido la tercera. Acá queda una sola y las tres la usan.
CREATE OR REPLACE FUNCTION public.envio_json(p_request_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  SELECT to_json(t) FROM (
    SELECT r.id, r.status, r.created_at, r.updated_at,
           r.employee_id, r.approver_id, r.approver_note,
           r.metadata->>'codigo_bolsa'                             AS codigo_bolsa,
           r.metadata->>'motivo_tipo'                              AS motivo_tipo,
           coalesce(nullif(r.metadata->>'reason',''), r.note)      AS reason,
           CASE WHEN jsonb_typeof(r.metadata->'evidencia_urls') = 'array'
                THEN r.metadata->'evidencia_urls' ELSE '[]'::jsonb END AS evidencia_urls,
           nullif(r.metadata->>'origen_branch_id','')::integer     AS origen_branch_id,
           r.metadata->>'origen_branch_name'                       AS origen_branch_name,
           nullif(r.metadata->>'origen_erp_sucursal_id','')::integer AS origen_erp_sucursal_id,
           coalesce((r.metadata->>'origen_vencidos')::boolean, false) AS origen_vencidos,
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
     WHERE r.id = p_request_id AND r.type = 'INVENTORY_TRANSFER_PUSH'
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.envio_json(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.envio_json(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_envios_vivos()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(public.envio_json(r.id) ORDER BY r.created_at DESC), '[]'::json)
    FROM public.approval_requests r
   WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
     AND EXISTS (SELECT 1 FROM public.envio_linea l
                  WHERE l.request_id = r.id
                    AND l.estado IN ('por_enviar','enviada','error','devuelta'));
$function$;

CREATE OR REPLACE FUNCTION public.get_envios_historial(p_limite integer DEFAULT 100)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $function$
  SELECT coalesce(json_agg(z.j ORDER BY z.updated_at DESC), '[]'::json)
    FROM (
      SELECT r.updated_at, public.envio_json(r.id) AS j
        FROM public.approval_requests r
       WHERE r.type = 'INVENTORY_TRANSFER_PUSH'
         AND NOT EXISTS (SELECT 1 FROM public.envio_linea l
                          WHERE l.request_id = r.id
                            AND l.estado IN ('por_enviar','enviada','error','devuelta'))
       ORDER BY r.updated_at DESC
       LIMIT greatest(1, least(coalesce(p_limite, 100), 500))
    ) z;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · El escaneo reconoce las dos familias
-- ══════════════════════════════════════════════════════════════════════════
--
-- Los códigos NO se pueden confundir por construcción: un número de traslado es
-- siempre dígitos y el de una bolsa empieza con `E`. Por eso las dos búsquedas
-- pueden convivir sin desempate — y por eso el prefijo no es decorativo.
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
  -- La bolsa del envío, por su código propio. Va aparte de `hallado` y no como
  -- un `OR` porque lo que se devuelve es distinto: de una bolsa se devuelve el
  -- envío entero, con sus renglones, para que la pantalla pueda decidir
  -- producto por producto sin un segundo viaje.
  bolsa AS (
    SELECT ar.id
    FROM public.approval_requests ar, codigo c
    WHERE c.v IS NOT NULL
      AND ar.type = 'INVENTORY_TRANSFER_PUSH'
      AND ar.metadata->>'codigo_bolsa' = c.v
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
      (SELECT si FROM es_de_pedido)                       AS es_de_un_pedido,
      -- Y la bolsa del envío. `es_un_envio` es un booleano y no «hay algo en
      -- `envio`»: la pantalla tiene que poder decir «es una bolsa que no puedo
      -- ver» sin confundirlo con «no existe».
      coalesce((SELECT true FROM bolsa), false)           AS es_un_envio,
      (SELECT public.envio_json(b.id) FROM bolsa b)       AS envio_bolsa
    FROM hallado h
    RIGHT JOIN (SELECT 1) uno ON true
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.traslado_por_codigo(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.traslado_por_codigo(text) TO authenticated, service_role;
