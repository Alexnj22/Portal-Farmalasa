-- Bodega reparte por impulso, producto nuevo o encargo — y ya no por «baja rotación».
--
-- Pedido del usuario el 2026-08-26:
--
--   «en los traslados entre sala, que bodega tenga la opcion de envio de
--    Producto por encargo. ademas las opciones deben ser segun si son de las
--    salas a bodega, o de las salas a las salas o de bodega a las salas:
--    por ejemplo, de salas a salas es por baja rotacion nada mas, asi que debe
--    ser fijo. de salas a bodega, es por baja rotacion o por proximos a vencer.
--    de bodega a las salas es, para impulso, producto nuevo o encargo.»
--
-- ── Qué cambia y qué NO ───────────────────────────────────────────────────
--
-- La regla por dirección ya existía desde el 2026-08-24 y es la única del
-- circuito. Lo que cambia es la fila de «de Bodega a una sala»:
--
--   motivo             a Bodega   de Bodega a una sala   entre salas
--   ────────────────── ────────── ────────────────────── ───────────
--   Baja rotación         sí            **YA NO**            sí
--   Próximo a vencer      sí               sí                no
--   Producto nuevo        no               sí                no
--   Impulso               no             **SÍ**              no
--   Encargo               no             **SÍ**              no
--   Retiro del mercado    sí               no                no
--   Avería                sí               no                no
--
-- Las otras dos filas quedan como estaban, y eso lo decidió el usuario cuando
-- se le señalaron las dos consecuencias de tomar sus tres listas al pie de la
-- letra:
--
--   · «Próximo a vencer» de Bodega a una sala se QUEDA. De él depende el área
--     de vencidos de Bodega como ORIGEN (v2.745.0): 77 productos y 512 unidades
--     que sólo pueden salir con ese rótulo. Quitarlo no habría dado ningún
--     error — habría dejado esa área sin forma de despachar.
--   · «Retiro del mercado» y «Avería» hacia Bodega se QUEDAN. Sin ellos, un
--     lote retirado por la SRS y un frasco quebrado tienen que salir rotulados
--     «Baja rotación», que es exactamente el motivo que obliga a mentir por el
--     que se abrieron el 24-ago. Y con «Avería» se iría la foto obligatoria.
--
-- ── Por qué «Impulso» y «Encargo» son dos motivos y no uno ────────────────
--
-- Los dos salen de Bodega hacia una sala y ninguno de los dos es «producto
-- nuevo», pero se parecen sólo por fuera:
--
--   · **Impulso** es decisión de Bodega: el producto ya existe, no se está
--     vendiendo donde está, y se manda a la sala donde puede salir. Nadie lo
--     pidió. Es lo que hasta hoy tenía que rotularse «Baja rotación» desde
--     Bodega — que dice por qué SALE y no por qué se manda a ESA sala.
--   · **Encargo** es al revés: alguien lo pidió. Un cliente encargó un producto
--     en una sala, Bodega lo tiene o lo trajo, y va para esa sala y ninguna
--     otra. Sin este rótulo el encargo viajaba disfrazado de reparto, y el día
--     que alguien pregunte cuántos encargos se atendieron no hay dónde mirarlo.
--
-- Y por eso «Baja rotación» SALE de esta dirección: entre salas significa *me
-- sobra y allá se vende*, hacia Bodega significa *me sobra, hazte cargo*, pero
-- desde Bodega hacia una sala no significa ninguna de las dos — Bodega no
-- vende. Lo que hacía era nombrar el impulso con la etiqueta equivocada.
--
-- ── La consecuencia que hay que conocer ───────────────────────────────────
--
-- Hasta hoy «Baja rotación» estaba en las TRES listas, y de eso dependía algo
-- que no se ve: una composición que saca de Bodega y de una sala a la vez sale
-- como dos envíos con el MISMO motivo, así que la pantalla ofrece la
-- intersección — y nunca quedaba vacía. Ahora sí puede quedar vacía, en un caso
-- exacto: destino una sala, y orígenes Bodega + alguna sala. Ahí no hay ningún
-- motivo que valga para las dos, y es correcto que no lo haya: lo que sale de
-- Bodega es reparto y lo que sale de una sala es sobrante. Son dos envíos
-- distintos y ahora hay que armarlos por separado.
--
-- La pantalla lo dice al AGREGAR el renglón que rompería la intersección, no al
-- apretar «Transferir» con la caja armada. `validar_envio_producto` no cambia:
-- nunca tuvo la tabla escrita adentro — se la pregunta a esta función.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.motivos_envio()
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT ARRAY['Próximo a vencer','Baja rotación','Producto nuevo','Impulso','Encargo','Retiro del mercado','Avería'];
$function$;

COMMENT ON FUNCTION public.motivos_envio() IS
  'Los motivos por los que se empuja producto. Lo demás es una solicitud. Cuáles valen en cada dirección lo dice motivos_envio_por_direccion() y cuáles piden foto motivos_envio_con_foto(); ésta es sólo el universo. Ver la migración envios_bodega_reparte_por_impulso_nuevo_o_encargo.';

CREATE OR REPLACE FUNCTION public.motivos_envio_por_direccion(
  p_origen_es_bodega  boolean,
  p_destino_es_bodega boolean)
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    -- Hacia Bodega: lo que una sala se saca de encima, más lo que Bodega pide
    -- de vuelta y lo que no se puede vender. Ni «Producto nuevo», ni «Impulso»,
    -- ni «Encargo»: los tres son reparto, y el reparto sale de Bodega. De eso
    -- —y sólo de eso— sale que un producto nuevo únicamente pueda salir de ahí.
    WHEN coalesce(p_destino_es_bodega, false)
      THEN ARRAY['Próximo a vencer','Baja rotación','Retiro del mercado','Avería']
    -- De Bodega a una sala: es reparto, y el reparto tiene tres formas —lo que
    -- llegó nuevo, lo que se empuja para que se venda, y lo que alguien pidió—
    -- más el corto vence, que existe para que el área de vencidos pueda
    -- despachar. «Baja rotación» NO: Bodega no vende, así que «no rota acá» no
    -- dice por qué va a ESA sala; eso es «Impulso». Ni el retiro ni la avería,
    -- que serían mandar a la venta algo que no puede venderse.
    WHEN coalesce(p_origen_es_bodega, false)
      THEN ARRAY['Impulso','Producto nuevo','Encargo','Próximo a vencer']
    -- Entre salas: sólo «me sobra». Ni el vencimiento, ni el retiro, ni la
    -- avería, porque en los tres la pregunta es «¿quién se hace cargo?» y de
    -- eso se ocupa Bodega. Y lo que NO se puede decir entre salas es «te lo
    -- mando porque lo necesitás» — eso es una solicitud, donde el otro lado
    -- decide antes de que el producto salga.
    ELSE ARRAY['Baja rotación']
  END;
$function$;

COMMENT ON FUNCTION public.motivos_envio_por_direccion(boolean, boolean) IS
  'Qué motivos de envío valen entre estos dos extremos. Es la ÚNICA regla del circuito: la dirección no se decide aparte, sale de acá. Entre salas sólo vale «Baja rotación»; hacia Bodega van el sobrante, el corto vence, el retiro y la avería; de Bodega a una sala va el reparto —impulso, producto nuevo, encargo— más el corto vence del área de vencidos. La pantalla la usa para ofrecer sólo lo posible y validar_envio_producto para decidir.';
