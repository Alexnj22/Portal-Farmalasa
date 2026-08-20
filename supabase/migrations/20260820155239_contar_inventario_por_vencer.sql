SET lock_timeout = '5s';

-- Los tres tramos de vencimiento de una sala, en UNA pasada.
--
-- El widget del Inicio los pedía con tres `HEAD` a `inventory` (2026-08-20).
-- Salían en paralelo —el comentario del código lo decía y era cierto— así que
-- costaban un round-trip de reloj, pero eran tres conexiones y TRES recorridos
-- del índice sobre la tabla más caliente de la base, y caían dentro de una
-- avalancha de 51 llamadas donde cada una se encarece por la cola: medidos en
-- 188, 198 y 206 ms.
--
-- Acá es un solo recorrido con `count(*) FILTER`. El techo `< p_en30` no cambia
-- ningún resultado —los tres tramos ya viven por debajo— y deja que el índice
-- recorte de entrada.
--
-- Las tres fechas ENTRAN por parámetro y no se calculan acá a propósito: el
-- navegador corre el día a UTC-6 antes de recortarlo (si no, entre las 18:00 y
-- la medianoche local los lotes que vencen hoy se cuentan como vencidos).
-- Mover ese cálculo al servidor cambiaría los números; se conserva el de allá.
--
-- INVOKER: el RLS de `inventory` sigue decidiendo, igual que con los tres HEAD.
CREATE OR REPLACE FUNCTION public.contar_inventario_por_vencer(
  p_erp_sucursal_id smallint,
  p_hoy  date,
  p_en7  date,
  p_en30 date
)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT json_build_object(
    'vencidas', count(*) FILTER (WHERE i.fecha_vencimiento <  p_hoy),
    'en7',      count(*) FILTER (WHERE i.fecha_vencimiento >= p_hoy AND i.fecha_vencimiento < p_en7),
    'en30',     count(*) FILTER (WHERE i.fecha_vencimiento >= p_en7 AND i.fecha_vencimiento < p_en30)
  )
  FROM public.inventory i
  WHERE i.erp_sucursal_id   = p_erp_sucursal_id
    AND i.is_vencidos       = false
    AND i.cantidad          > 0
    AND i.fecha_vencimiento IS NOT NULL
    AND i.fecha_vencimiento < p_en30;
$$;

REVOKE EXECUTE ON FUNCTION public.contar_inventario_por_vencer(smallint, date, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.contar_inventario_por_vencer(smallint, date, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.contar_inventario_por_vencer(smallint, date, date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.contar_inventario_por_vencer(smallint, date, date, date) IS
  'Vencidas / vence en 7 / vence en 30 de una sala, en un solo recorrido. Reemplaza tres HEAD del widget del Inicio (2026-08-20).';
