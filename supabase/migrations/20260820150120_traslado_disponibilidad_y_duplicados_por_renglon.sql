SET lock_timeout = '5s';

-- Un traslado deja de ser DE UN SOLO PRODUCTO — la mitad de abajo.
--
-- Hoy pedirle producto a otra sala es un producto a una sala. Medido sobre las
-- 215 solicitudes que existen (11 al 20 de agosto): 66 tandas —mismo día, mismo
-- par de salas— y **33 de esas 66 fueron de más de un producto**, con 5.52
-- productos en promedio y un récord de 24 a una sola sala en un día. O sea que
-- la mitad de las veces que alguien le pide a una sala le pide más de una cosa,
-- y lo tiene que hacer de a uno.
--
-- El despachador (`aplicar-traslado-inventario`) YA recorre `lineas` y su propio
-- comentario habla de «un traslado de cinco productos». Los dos que faltaban son
-- los que esta migración toca: el cálculo de disponibilidad y el freno de
-- duplicados, que miraban `items->0` y nada más.
--
-- Plan completo: `docs/PLAN-SOLICITUD-A-VARIAS-SALAS-2026-08-20.md`.

-- ── 1 · La disponibilidad, renglón por renglón ─────────────────────────────
--
-- Agrega `lineas`: qué hay en el estante de origen para CADA producto pedido,
-- si alcanza, y qué otras salas lo tienen. Es lo que la tarjeta de quien
-- despacha necesita para poder decir «de estos tres, dos salen y uno no».
--
-- ⚠️ Las claves de arriba —`pedido`, `origen`, `alternativas`, `respaldo`— se
-- conservan CON EL MISMO SIGNIFICADO QUE HOY, sacadas del primer renglón, y por
-- un motivo concreto: la base se despliega antes que la pantalla, así que
-- durante ese rato la pantalla vieja sigue leyendo esas claves. Se verificó
-- enfrentando las dos implementaciones sobre el mismo instante —6 solicitudes
-- reales, el área de vencidos y una de dos renglones—: **idénticas**.
--
-- La única diferencia deliberada es `origen.puede`, que ahora es «TODOS los
-- renglones alcanzan» (`bool_and`) en vez de «el primero alcanza». Con un
-- renglón es la misma respuesta; con varios, la pantalla vieja diría «no
-- podés» en vez de dejar pasar un despacho a medias, que es el lado seguro para
-- fallar. Y una solicitud SIN renglones pasa a dar `false` en vez de `true`:
-- ninguna de las 217 está así, y «no hay nada que mandar» no es «se puede».
CREATE OR REPLACE FUNCTION public.get_traslado_disponibilidad(p_request_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH sol AS (
        SELECT nullif(a.metadata->>'origen_erp_sucursal_id','')::integer AS origen,
               nullif(a.metadata->>'erp_sucursal_id','')::integer        AS destino,
               nullif(a.metadata->>'origen_branch_id','')::integer       AS origen_bid,
               a.metadata->>'origen_branch_name'                         AS origen_nombre,
               coalesce((a.metadata->>'origen_vencidos')::boolean,false) AS origen_venc,
               coalesce(a.metadata->'items','[]'::jsonb)                 AS items
        FROM public.approval_requests a
        WHERE a.id = p_request_id AND a.type = 'INVENTORY_TRANSFER_REQUEST'
    ),
    -- `WITH ORDINALITY` conserva el ORDEN del array, e `idx` es la posición en
    -- `metadata.items`. Esa posición es el nombre del renglón en todo el
    -- circuito: es como `aplicar-movimiento-inventario` recibe qué líneas entran
    -- («el cliente manda ÍNDICES con su cantidad, nunca las líneas»), y por lo
    -- mismo — con índices, el navegador sólo puede señalar cuáles de las que YA
    -- se guardaron entran, no inventar una.
    lineas AS (
        SELECT (it.ord - 1)::integer AS idx,
               nullif(it.item->>'erp_product_id','')::integer AS prod,
               it.item->>'descripcion' AS descripcion,
               coalesce((it.item->>'cantidad')::numeric, 0)
                 * coalesce((it.item->>'factor')::numeric, 1) AS pedido
        FROM sol, jsonb_array_elements(sol.items) WITH ORDINALITY AS it(item, ord)
    ),
    stock AS (
        SELECT l.idx, d.erp_sucursal_id, d.unidades
        FROM lineas l
        JOIN public.v_inventario_disponible d ON d.erp_product_id = l.prod
    ),
    -- El estante del origen: el de vencidos cuando la solicitud lo nombra, el
    -- normal en todos los demás casos.
    stock_origen AS (
        SELECT l.idx, d.unidades, d.en_vuelo
        FROM lineas l CROSS JOIN sol
        JOIN public.v_inventario_disponible_vencidos d
          ON d.erp_product_id = l.prod AND d.erp_sucursal_id = sol.origen
        WHERE sol.origen_venc
        UNION ALL
        SELECT l.idx, d.unidades, d.en_vuelo
        FROM lineas l CROSS JOIN sol
        JOIN public.v_inventario_disponible d
          ON d.erp_product_id = l.prod AND d.erp_sucursal_id = sol.origen
        WHERE NOT sol.origen_venc
    ),
    minimos AS (
        SELECT l.idx, sp.erp_sucursal_id,
               coalesce(sp.manual_min, sp.calc_min, sp.min_units, 0) AS minimo
        FROM lineas l
        JOIN public.product_stock_params sp ON sp.erp_product_id = l.prod
    ),
    detalle AS (
        SELECT l.idx, l.prod, l.descripcion, l.pedido,
               coalesce(so.unidades, 0) AS unidades,
               coalesce(so.en_vuelo, 0) AS en_vuelo,
               -- El área de vencidos no defiende un mínimo: ahí no se repone nada.
               CASE WHEN sol.origen_venc THEN 0 ELSE coalesce(mo.minimo, 0) END AS minimo,
               (coalesce(so.unidades, 0) >= l.pedido) AS puede,
               -- A quién más pedirle ESTE renglón: las salas que lo cubren
               -- entero, sin contar el origen ni el destino. Es por renglón
               -- porque cada producto tiene su propio mapa de quién lo tiene.
               coalesce((
                   SELECT json_agg(json_build_object(
                              'erp_sucursal_id', s.erp_sucursal_id,
                              'sala',            coalesce(m.nombre, 'Sucursal ' || s.erp_sucursal_id),
                              'unidades',        s.unidades,
                              'minimo',          coalesce(mi.minimo, 0))
                            ORDER BY s.unidades DESC)
                   FROM stock s
                   LEFT JOIN minimos mi ON mi.idx = s.idx AND mi.erp_sucursal_id = s.erp_sucursal_id
                   LEFT JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = s.erp_sucursal_id
                   WHERE s.idx = l.idx
                     AND s.erp_sucursal_id <> sol.origen
                     AND s.erp_sucursal_id <> sol.destino
                     AND s.unidades >= l.pedido
               ), '[]'::json) AS alternativas
        FROM lineas l
        CROSS JOIN sol
        LEFT JOIN stock_origen so ON so.idx = l.idx
        LEFT JOIN minimos mo ON mo.idx = l.idx AND mo.erp_sucursal_id = sol.origen
    )
    SELECT json_build_object(
        'pedido', coalesce(l0.pedido, 0),
        'origen', json_build_object(
            'erp_sucursal_id', sol.origen,
            'vencidos', sol.origen_venc,
            'unidades', coalesce(l0.unidades, 0),
            'en_vuelo', coalesce(l0.en_vuelo, 0),
            'minimo',   coalesce(l0.minimo, 0),
            'puede',    coalesce((SELECT bool_and(d.puede) FROM detalle d), false)
        ),
        'respaldo', CASE
            WHEN sol.origen_bid IS NOT NULL
             AND sol.origen_bid = ANY (COALESCE(public.salas_que_cubro_ahora(), ARRAY[]::integer[]))
            THEN json_build_object('sala', coalesce(nullif(sol.origen_nombre, ''), 'La otra sala'))
            ELSE NULL
        END,
        'alternativas', coalesce(l0.alternativas, '[]'::json),
        'lineas', coalesce((
            SELECT json_agg(json_build_object(
                       'idx',            d.idx,
                       'erp_product_id', d.prod,
                       'descripcion',    d.descripcion,
                       'pedido',         d.pedido,
                       'unidades',       d.unidades,
                       'en_vuelo',       d.en_vuelo,
                       'minimo',         d.minimo,
                       'puede',          d.puede,
                       'alternativas',   d.alternativas)
                     ORDER BY d.idx)
            FROM detalle d), '[]'::json)
    )
    FROM sol LEFT JOIN detalle l0 ON l0.idx = 0;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_traslado_disponibilidad(uuid) TO authenticated, service_role;

-- ── 2 · El freno de duplicados, renglón por renglón ────────────────────────
--
-- El índice `approval_requests_un_traslado_pendiente` evita dos solicitudes
-- pendientes del mismo producto entre las mismas dos salas y el mismo estante,
-- para que la cantidad se le suba a la que ya existe en vez de abrir otra. Pero
-- mira `items->0`: con varios renglones vigilaría el primero y dejaría pasar
-- todos los demás. Y un índice único NO puede mirar los elementos de un array
-- —Postgres indexa el valor entero, no sus partes—, así que la vigilancia por
-- renglón tiene que ser un trigger.
--
-- **El índice NO se borra.** Sigue siendo cierto y sigue siendo atómico para el
-- primer renglón: queda de red abajo del trigger. Como el trigger es BEFORE,
-- para todo lo que los dos ven gana el mensaje del trigger, que es el legible.
--
-- El candado de aviso serializa a quienes piden al MISMO estante de la MISMA
-- sala: sin él, dos que aprieten a la vez leen los dos «no hay ninguna» y las
-- dos entran. Es lo que el índice daba gratis y un trigger no.
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
    SELECT string_agg(DISTINCT coalesce(nombre, 'el producto ' || prod), ', ')
      INTO v_repe
      FROM (
          SELECT it.item->>'erp_product_id' AS prod,
                 nullif(it.item->>'descripcion','') AS nombre,
                 count(*) OVER (PARTITION BY it.item->>'erp_product_id') AS veces
          FROM jsonb_array_elements(coalesce(NEW.metadata->'items','[]'::jsonb)) AS it(item)
      ) n
     WHERE n.veces > 1;

    IF v_repe IS NOT NULL THEN
        RAISE EXCEPTION '% está más de una vez en la misma solicitud. Ponelo una sola vez con la cantidad total.', v_repe
            USING ERRCODE = '23505';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(
        'traslado:' || coalesce(v_destino,'') || ':' || coalesce(v_origen,'') || ':' || v_venc));

    SELECT string_agg(DISTINCT coalesce(nuevo.nombre, 'el producto ' || nuevo.prod), ', ')
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

-- Sólo al INSERT, y sólo para este tipo. La condición va en el `WHEN` para que
-- los otros cuatro tipos de solicitud ni llamen a la función.
--
-- No corre en el UPDATE a propósito: una solicitud se escribe una vez y después
-- sólo cambia de estado o le anotan el despacho. Vigilar el UPDATE haría que un
-- despacho —que escribe `metadata` con la solicitud todavía en PENDING— tuviera
-- que pasar de nuevo por acá, y un par duplicado que hubiera quedado de antes
-- volvería imposible despachar NINGUNO de los dos.
DROP TRIGGER IF EXISTS frenar_traslado_duplicado ON public.approval_requests;
CREATE TRIGGER frenar_traslado_duplicado
    BEFORE INSERT ON public.approval_requests
    FOR EACH ROW
    WHEN (NEW.type = 'INVENTORY_TRANSFER_REQUEST' AND NEW.status = 'PENDING')
    EXECUTE FUNCTION public.frenar_traslado_duplicado();

COMMENT ON INDEX public.approval_requests_un_traslado_pendiente IS
    'Red de abajo: vigila el PRIMER renglón de forma atómica. La vigilancia renglón por renglón la hace el trigger frenar_traslado_duplicado, que es BEFORE y por eso gana el mensaje.';
