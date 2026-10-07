SET lock_timeout = '5s';

-- Al llegar una reserva de la app, la SUCURSAL se entera al instante
-- (2026-10-07, pedido del usuario: «así lo tienen listo y reservado»): aviso
-- en el portal y en el teléfono a quien trabaja en esa sala. Por SENTENCIA,
-- no por fila: un pedido del carrito son varias filas y debe ser UN aviso.
CREATE FUNCTION public.app_reservas_avisar_sucursal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
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
    SELECT array_agg(e.id) INTO v_dest FROM public.employees e
     WHERE e.branch_id = g.branch_id AND e.status = 'ACTIVO';
    CONTINUE WHEN v_dest IS NULL;
    PERFORM public.notify_employees(
      v_dest, 'RESERVA_APP',
      'Nueva reserva de la app · ' || g.codigo,
      format('%s: %s %s (%s u.) por $%s. Prepárala para cuando venga a retirar.',
             initcap(split_part(coalesce(g.cliente, 'Un cliente'), ' ', 1)), g.productos,
             CASE WHEN g.productos = 1 THEN 'producto' ELSE 'productos' END, g.unidades, g.total),
      '/', jsonb_build_object('codigo', g.codigo, 'check_key', 'reserva_app:' || g.codigo), true, g.branch_id::integer);
  END LOOP;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_reservas_avisar_sucursal() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER app_reservas_avisar_sucursal
  AFTER INSERT ON public.app_reservas
  REFERENCING NEW TABLE AS nuevas
  FOR EACH STATEMENT EXECUTE FUNCTION public.app_reservas_avisar_sucursal();
