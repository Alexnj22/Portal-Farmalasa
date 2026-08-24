-- Bodega también manda corto vence a una sala.
--
-- Corrección del usuario el 2026-08-24, sobre la regla que se aplicó hoy mismo
-- unas horas antes:
--
--   «bodega si debe poder mandar corto vence, de hecho, hasta tiene la
--    posibilidad de una sucursal solicitar un producto del area de vencidos.»
--
-- La tabla de dirección se había derivado de las tres frases del usuario y una
-- de las casillas quedó vacía por omisión, no por decisión: «Próximo a vencer»
-- sólo valía HACIA Bodega. Con eso, Bodega —que tiene 57 productos venciendo
-- dentro de 90 días— para empujarle uno a la sala que lo vende rápido habría
-- tenido que rotularlo «Baja rotación», que es mentira. Un motivo que obliga a
-- mentir es peor que no tener el motivo: el rótulo es el dato con el que
-- después se mira el circuito entero.
--
-- Y el argumento del usuario cierra solo: una sala ya puede PEDIR del área de
-- vencidos de Bodega (v2.666.0). Si el producto próximo a vencer puede viajar
-- de Bodega a una sala cuando la sala lo pide, negar el mismo viaje cuando
-- Bodega lo ofrece no defiende nada.
--
-- La tabla queda así, y lo único que cambia es la última casilla:
--
--   origen        destino     motivos
--   ───────────── ─────────── ──────────────────────────────────────────────
--   una sala      Bodega      Próximo a vencer · Baja rotación
--   Bodega        una sala    Producto nuevo   · Baja rotación · Próximo a vencer
--   una sala      otra sala   NINGUNO — eso es una solicitud
--
-- **El freno que importa NO se toca**: sólo Bodega le manda a una sala. Eso es
-- lo que separa un envío de una solicitud, y sigue en `validar_envio_producto`
-- sin cambios. Lo que se abre es un motivo dentro de una dirección que ya
-- estaba permitida — no una dirección nueva.
--
-- «Producto nuevo» sigue saliendo SÓLO de Bodega, porque esa regla no cae de
-- esta casilla sino de la de arriba: hacia Bodega nunca valió.
--
-- ⚠️ LO QUE ESTO NO HACE: enviar DESDE el área de vencidos de Bodega. El
-- despacho sale del estante de operación (`ubicOrigen` en
-- `enviar-producto-erp`), y el área apartada hoy sólo se LEE, para descontarla
-- del tope. O sea que Bodega puede mandar corto vence de lo que tiene en el
-- estante, no de lo que ya apartó. Abrirlo es otra pieza: la ubicación de
-- vencidos como origen en la edge function, su rama en `validar_envio_producto`
-- y el filtro `is_vencidos` del buscador del modal.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.motivos_envio_por_destino(p_destino_es_bodega boolean)
 RETURNS text[] LANGUAGE sql IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN coalesce(p_destino_es_bodega, false)
              -- Hacia Bodega: lo que una sala se saca de encima. «Producto
              -- nuevo» no entra acá, y de eso —y sólo de eso— sale la regla de
              -- que un producto nuevo únicamente puede salir de Bodega.
              THEN ARRAY['Próximo a vencer','Baja rotación']
              -- Hacia una sala: sólo puede venir de Bodega, y es reparto. El
              -- corto vence entra desde el 2026-08-24: una sala ya puede PEDIR
              -- del área de vencidos, así que negarle a Bodega el mismo viaje
              -- cuando ella lo ofrece no defendía nada — sólo obligaba a
              -- rotularlo «Baja rotación», que es mentira.
              ELSE ARRAY['Producto nuevo','Baja rotación','Próximo a vencer']
         END;
$function$;

COMMENT ON FUNCTION public.motivos_envio_por_destino(boolean) IS
  'Qué motivos de envío valen según a dónde va. La pantalla la usa para ofrecer sólo lo posible; el trigger validar_envio_producto la usa para decidir. Lo que NO decide es la dirección: sólo Bodega le manda a una sala, y eso vive en validar_envio_producto.';
