-- Preventas de reservas (2026-10-21), 4 de 5: los avisos a la sala.
--
-- (a) Cancelada, vencida, pagada en línea: un aviso por pedido (o reserva
-- suelta). Lo escribe un trigger de SENTENCIA sobre `app_reservas` (decenas de
-- filas, no es tabla caliente) para cubrir las cuatro rutas que cambian el
-- estado —la sala, la app, el vencimiento y el pago en línea— sin reescribir
-- ninguna de esas funciones. Quien hizo el cambio no se avisa a sí mismo
-- (`notify_employees`). El cierre por factura avisa desde su propia función.
-- (b) Reserva nueva: antes le llegaba a TODO empleado activo de la sala, tuviera
-- o no el módulo; ahora a la sala con reservas y a quienes lo tienen en toda la red.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_reservas_avisar_cambios()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE g record; v_dest uuid[];
BEGIN
  FOR g IN
    WITH c AS (
      SELECT n.*, CASE
               WHEN n.estado = 'cancelada' AND o.estado <> 'cancelada' THEN 'cancelada'
               WHEN n.estado = 'vencida' AND o.estado <> 'vencida' THEN 'vencida'
               WHEN n.pago_estado = 'pagado' AND o.pago_estado <> 'pagado' AND n.pago_metodo = 'en_linea'
                    AND NOT coalesce(n.pago_prueba, false) AND n.estado IN ('en_revision', 'pendiente', 'lista') THEN 'pagada'
             END AS evento
        FROM despues n JOIN antes o ON o.id = n.id)
    SELECT c.branch_id, c.evento, coalesce(c.pedido, 'R-' || lpad(min(c.id)::text, 6, '0')) AS codigo,
           count(*) AS productos, min(c.producto_nombre) AS producto, min(cu.name) AS cliente,
           round(sum(coalesce(c.precio_unitario, 0) * c.cantidad), 2) AS total,
           string_agg(DISTINCT pv.externo_ref, ', ') FILTER (WHERE pv.estado IN ('viva', 'sin_enlace')) AS preventa
      FROM c JOIN public.customers cu ON cu.id = c.customer_id
      LEFT JOIN public.preventas pv ON pv.id = c.preventa_id
     WHERE c.evento IS NOT NULL
     GROUP BY c.branch_id, c.evento, c.pedido, CASE WHEN c.pedido IS NULL THEN c.id END
  LOOP
    v_dest := public.destinatarios_de_reservas(g.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
      CASE g.evento WHEN 'cancelada' THEN 'Reserva cancelada · ' WHEN 'vencida' THEN 'Reserva vencida · '
                    ELSE 'Reserva pagada en línea · ' END || g.codigo,
      initcap(split_part(coalesce(g.cliente, 'Un cliente'), ' ', 1)) || ': '
        || CASE WHEN g.productos = 1 THEN g.producto ELSE g.productos || ' productos' END
        || CASE g.evento WHEN 'pagada' THEN ' por $' || g.total || '. Ya está pagada: en caja no se cobra.' ELSE '.' END
        || CASE WHEN g.preventa IS NOT NULL AND g.evento <> 'pagada'
                THEN ' Tenía la preventa #' || g.preventa || ' en la caja: bórrala.' ELSE '' END,
      '/reservas', jsonb_build_object('codigo', g.codigo, 'check_key', 'reserva_' || g.evento || ':' || g.codigo), true, g.branch_id::integer);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.app_reservas_avisar_cambios() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER app_reservas_avisar_cambios AFTER UPDATE ON public.app_reservas
  REFERENCING OLD TABLE AS antes NEW TABLE AS despues
  FOR EACH STATEMENT EXECUTE FUNCTION public.app_reservas_avisar_cambios();

CREATE OR REPLACE FUNCTION public.app_reservas_avisar_sucursal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  g record;
  v_dest uuid[];
BEGIN
  FOR g IN
    SELECT n.branch_id, coalesce(n.pedido, 'R-' || lpad(min(n.id)::text, 6, '0')) AS codigo,
           count(*) AS productos, sum(n.cantidad) AS unidades,
           round(sum(coalesce(n.precio_unitario, 0) * n.cantidad), 2) AS total,
           min(c.name) AS cliente
      FROM nuevas n JOIN public.customers c ON c.id = n.customer_id
     WHERE n.origen = 'app'
     GROUP BY n.branch_id, n.pedido, CASE WHEN n.pedido IS NULL THEN n.id END
  LOOP
    v_dest := public.destinatarios_de_reservas(g.branch_id);
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(
      v_dest, 'RESERVA_APP',
      'Nueva reserva de la app · ' || g.codigo,
      format('%s: %s %s (%s u.) por $%s. Prepárala para cuando venga a retirar.',
             initcap(split_part(coalesce(g.cliente, 'Un cliente'), ' ', 1)), g.productos,
             CASE WHEN g.productos = 1 THEN 'producto' ELSE 'productos' END, g.unidades, g.total),
      '/reservas', jsonb_build_object('codigo', g.codigo, 'check_key', 'reserva_app:' || g.codigo), true, g.branch_id::integer);
  END LOOP;
  RETURN NULL;
END $function$;
