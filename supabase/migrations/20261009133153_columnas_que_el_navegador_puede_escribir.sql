-- 03 · Qué columnas puede escribir el navegador en pedidos y rutas
--      (2026-10-08; aplicada 2026-10-09). FASE 1 (transición).
--
-- Las policies de UPDATE deciden QUÉ FILAS, no qué columnas: con la sesión de
-- un cargo de sala alcanzaba un PATCH a mano para reescribir en su sala
-- `pedido_items.cantidad_recibida`, `status`, `resolucion_status`,
-- `pedido_sucursal_status.recibido_erp_at`, `confirmado_correccion_*`,
-- `finalizado_*`… y en rutas `created_by`, `conductor_id`, `entregado_por`.
--
-- Corrección por PRIVILEGIO de columna: REVOKE del UPDATE/INSERT de tabla y
-- GRANT sólo de lo que el navegador escribe DIRECTO. Lo demás pasa por
-- funciones SECURITY DEFINER (las 27 que escriben estas tablas lo son, con
-- dueño postgres; los disparadores también — medido en producción).
--
-- FASE 1 y no la lista corta: la app del teléfono no se actualiza sola (no hay
-- expo-updates) y el portal no se recarga solo, así que builds y pestañas de
-- antes de la publicación del 2026-10-09 siguen escribiendo directo la
-- llegada, el reenvío, programar y las hojas. Un PATCH con UNA columna sin
-- privilegio falla entero, así que la lista es la UNIÓN de todo lo que el
-- código escribió directo desde el 2026-09-01 (barrido de 420 commits de main
-- sobre src/ y apps/mobile). Verificado en pruebas con rol authenticated:
-- todas esas escrituras siguen funcionando; recibido_erp_at, finalizado_at,
-- confirmado_correccion_at, cantidad_recibida, status, resolucion_status,
-- created_by, conductor_id e INSERT directos dan permission denied.
-- FASE 2 (lista corta) cuando no quede ningún build viejo de la app:
--   REVOKE UPDATE ON pedido_sucursal_status FROM authenticated;
--   GRANT UPDATE (paginas) ON pedido_sucursal_status TO authenticated;
--   REVOKE UPDATE ON pedido_items FROM authenticated;
--
-- ruta_locations no se toca (su upsert escribe todas sus columnas).
-- GRANT/REVOKE y CREATE TRIGGER toman lock: lock_timeout y ventana de la mañana.
SET lock_timeout = '5s';

-- pedido_sucursal_status
REVOKE INSERT, UPDATE ON public.pedido_sucursal_status FROM anon, authenticated;
GRANT  UPDATE (paginas, hojas_recibidas, pagina_items, caja_map, total_cajas,
               cajas_electrolit, cajas_especiales, cajas_especiales_llegadas,
               llegada_tipo, llegada_nota, falta_cajas, cajas_danadas, falta_caja_at,
               electrolit_ok, electrolit_faltantes, cajas_extra, cajas_extra_notas,
               entrega_programada_at, entrega_programada_historial,
               reenvio_por, reenvio_bodega_at, reenvios_historial, segunda_llegada_at)
  ON public.pedido_sucursal_status TO authenticated;

-- pedido_items
REVOKE INSERT, UPDATE ON public.pedido_items FROM anon, authenticated;
GRANT  UPDATE (falta_caja) ON public.pedido_items TO authenticated;

-- rutas
REVOKE INSERT, UPDATE ON public.rutas FROM anon, authenticated;
GRANT  UPDATE (status, salida_at, vuelta_base_at, visitas) ON public.rutas TO authenticated;

-- ruta_pedidos
REVOKE INSERT, UPDATE ON public.ruta_pedidos FROM anon, authenticated;
GRANT  UPDATE (entregado_at, entregado_por) ON public.ruta_pedidos TO authenticated;

-- Quien entrega lo dice la sesión, no el navegador. `entregado_por` guarda
-- `employees.id` (medido en prod: 126 de 126), que es lo que da
-- `auth_employee_id()`, así que la firma no cambia de forma.
CREATE OR REPLACE FUNCTION public.ruta_pedidos_firma_entrega()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
BEGIN
  IF NEW.entregado_at IS DISTINCT FROM OLD.entregado_at
     OR NEW.entregado_por IS DISTINCT FROM OLD.entregado_por THEN
    IF v_actor IS NOT NULL THEN
      -- Con sesión: firma quien está conectado; desmarcar borra la firma.
      NEW.entregado_por := CASE WHEN NEW.entregado_at IS NULL THEN NULL ELSE v_actor END;
    END IF;
    -- Sin sesión (llave de servicio, cron): se respeta lo que venga.
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.ruta_pedidos_firma_entrega() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ruta_pedidos_firma_entrega ON public.ruta_pedidos;
CREATE TRIGGER trg_ruta_pedidos_firma_entrega
  BEFORE UPDATE ON public.ruta_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.ruta_pedidos_firma_entrega();
