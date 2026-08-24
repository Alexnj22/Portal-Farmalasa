-- El retiro del mercado es su propio motivo, y sólo viaja hacia Bodega.
--
-- Pedido del usuario el 2026-08-24:
--
--   «agreguemos el motivo de, cuando bodega pide un producto por retiro del
--    proveedor por un error o por algo de la SRS. asi las salas lo mandan.»
--
-- ── Por qué no alcanzaba con los tres que había ───────────────────────────
--
-- Sin este motivo, una sala que devuelve un lote retirado tenía que rotularlo
-- «Baja rotación» —lo único que valía para sacárselo de encima— y eso es
-- exactamente lo contrario de lo que pasó: el producto no se movió porque
-- sobrara, se movió porque **no puede seguir vendiéndose**. El rótulo es el dato
-- con el que después se mira el circuito, y un retiro escondido adentro de
-- «Baja rotación» no se puede encontrar el día que alguien pregunte «¿en qué
-- salas quedó producto de ese lote?».
--
-- Es la misma razón por la que se abrió «Próximo a vencer» hacia una sala unas
-- horas antes: un motivo que obliga a mentir es peor que no tener el motivo.
--
-- ── Por qué SÓLO hacia Bodega ─────────────────────────────────────────────
--
-- Un retiro se consolida en un solo lugar: hay que juntarlo, contarlo y
-- devolverlo o darlo de baja, y eso lo hace Bodega. Mandarlo a otra sala sería
-- repartir el problema en vez de resolverlo, y de Bodega hacia una sala sería
-- devolver a la venta algo que se retiró. Las dos direcciones quedan cerradas,
-- y la única abierta es la que describió el usuario: **las salas lo mandan**.
--
-- La tabla completa queda así:
--
--   motivo             a Bodega   de Bodega a una sala   entre salas
--   ────────────────── ────────── ────────────────────── ───────────
--   Baja rotación         sí               sí                sí
--   Próximo a vencer      sí               sí                no
--   Producto nuevo        no               sí                no
--   Retiro del mercado    SÍ               no                no
--
-- ── El nombre ─────────────────────────────────────────────────────────────
--
-- El usuario lo describió por sus DOS causas —«retiro del proveedor por un
-- error» y «algo de la SRS»— y el rótulo tiene que cubrir las dos, porque quien
-- elige en la pantalla no siempre sabe cuál de las dos lo originó. «Retiro del
-- mercado» las nombra a las dos y es el término que ya se usa en el rubro. Cuál
-- de las dos fue va en el motivo escrito, que es obligatorio.
--
-- Verificado contra producción con los casos del motivo nuevo —hacia Bodega
-- pasa, entre salas y desde Bodega rebotan— insertados y revertidos en la misma
-- transacción.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.motivos_envio()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Próximo a vencer','Baja rotación','Producto nuevo','Retiro del mercado'];
$function$;

COMMENT ON FUNCTION public.motivos_envio() IS
  'Los motivos por los que se empuja producto. Lo demás es una solicitud. Cuáles valen en cada dirección lo dice motivos_envio_por_direccion(); ésta es sólo el universo. Ver la migración envios_el_retiro_del_mercado_es_su_propio_motivo.';

CREATE OR REPLACE FUNCTION public.motivos_envio_por_direccion(
  p_origen_es_bodega  boolean,
  p_destino_es_bodega boolean)
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    -- Hacia Bodega: lo que una sala se saca de encima, más lo que Bodega pide
    -- de vuelta. «Producto nuevo» no entra, y de eso —y sólo de eso— sale que
    -- un producto nuevo únicamente pueda salir de Bodega.
    WHEN coalesce(p_destino_es_bodega, false)
      THEN ARRAY['Próximo a vencer','Baja rotación','Retiro del mercado']
    -- De Bodega a una sala: es reparto. El retiro NO está: de Bodega hacia una
    -- sala sería devolver a la venta algo que se retiró.
    WHEN coalesce(p_origen_es_bodega, false)
      THEN ARRAY['Producto nuevo','Baja rotación','Próximo a vencer']
    -- Entre salas: sólo «me sobra». Ni el vencimiento ni el retiro, porque en
    -- los dos la pregunta es «¿quién se hace cargo?» y de eso se ocupa Bodega;
    -- repartir un retiro entre salas es repartir el problema. Y lo que NO se
    -- puede decir entre salas es «te lo mando porque lo necesitás» — eso es una
    -- solicitud, donde el otro lado decide antes de que el producto salga.
    ELSE ARRAY['Baja rotación']
  END;
$function$;

COMMENT ON FUNCTION public.motivos_envio_por_direccion(boolean, boolean) IS
  'Qué motivos de envío valen entre estos dos extremos. Es la ÚNICA regla del circuito: la dirección no se decide aparte, sale de acá. Entre salas sólo vale «Baja rotación»; el retiro del mercado sólo viaja HACIA Bodega, que es donde se consolida. La pantalla la usa para ofrecer sólo lo posible y validar_envio_producto para decidir.';
