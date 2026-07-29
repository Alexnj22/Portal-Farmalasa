-- Realtime: tres suscripciones estaban muertas en silencio (plan F1, 2026-07-29)
--
-- La auditoría (P6) proponía SACAR tablas de la publicación —"role_permissions y
-- stock_config casi nunca cambian pero obligan a decodificar el WAL"—. Medido,
-- eso es incorrecto en dos puntos:
--
-- 1. `role_permissions` SÍ se usa: AuthContext se suscribe para refrescar
--    permisos en vivo. Sacarla habría roto eso.
--
-- 2. El costo no es decodificar. Los 5,808 s / 18.4% de CPU son 651,041 llamadas
--    de la función de sondeo de Realtime, a 8.9 ms cada una: un poll de fondo
--    constante, corra o no un cambio. Las 10 tablas publicadas suman 241
--    escrituras en total. Recortar la lista no mueve la aguja.
--
-- Lo que sí estaba mal es lo contrario de lo que decía el informe: el frontend
-- se suscribe a TRES tablas que no están en la publicación, así que esos eventos
-- nunca llegan. No es que sea lento — es que no funciona:
--
--   inventory_sync_log  useSyncMonitor (AppLayout, todos los usuarios):
--                       toast + notificación del navegador ante sync fallido.
--                       Filtra success=eq.false, o sea bajo volumen.
--   pedido_items        usePedidosData: refresca los ítems del pedido activo.
--                       Sus tres hermanas (pedidos, pedido_sucursal_status,
--                       pedido_item_eventos) sí están publicadas — fue un olvido.
--   ventas_perdidas     AppLayout: badge de pendientes. Hoy solo se actualiza
--                       al recargar la página.
--
-- Las tres tienen RLS activo con policy de SELECT, así que Realtime filtra por
-- suscriptor. No se toca REPLICA IDENTITY: dejarla en DEFAULT evita inflar el
-- WAL, que es justamente lo que estamos tratando de no hacer.
--
-- stock_config sale: nadie se suscribe a ella.

-- Idempotente a propósito: staging tiene el esquema reconstruido y su
-- publicación no coincide con la de prod, así que un ADD/DROP a secas falla
-- en uno de los dos.

SET lock_timeout = '5s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_sync_log','pedido_items','ventas_perdidas'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                        WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'agregada a la publicacion: %', t;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='stock_config') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.stock_config;
    RAISE NOTICE 'quitada de la publicacion: stock_config';
  END IF;
END $$;
