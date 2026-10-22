SET lock_timeout = '5s';
-- Con la reserva amarrada a varios traslados, el primero que llega dejaba a la
-- sala un «Pide el resto a otra sala o a Bodega» aunque el resto ya viniera en
-- camino (R-000114: uno de Bodega y otro de Salud 5). Si queda algo por llegar,
-- el aviso lo dice y no manda a pedir de nuevo.
CREATE OR REPLACE FUNCTION public.reserva_sumar_llegada(p_id bigint, p_unidades integer, p_de text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.app_reservas; v_cliente text;
BEGIN
  IF coalesce(p_unidades, 0) <= 0 THEN RETURN; END IF;
  UPDATE public.app_reservas
     SET traslado_llegaron = traslado_llegaron + p_unidades,
         traslado_por_llegar = greatest(traslado_por_llegar - p_unidades, 0), updated_at = now()
   WHERE id = p_id AND estado = 'pendiente'
  RETURNING * INTO r;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente FROM public.customers WHERE id = r.customer_id;
  IF r.traslado_llegaron >= r.cantidad THEN
    UPDATE public.app_reservas
       SET estado = 'lista', lista_at = now(), vence_at = now() + make_interval(hours => public.reserva_horas_al_preparar(r)),
           traslado_estado = 'recibido', traslado_nota = 'Llegó de ' || coalesce(p_de, 'otra sala') || '.', updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó y quedó apartada',
      format('%s × %s para %s llegó de %s. Ya está lista: avísale al cliente.', r.cantidad, r.producto_nombre,
             coalesce(v_cliente, 'el cliente'), coalesce(p_de, 'otra sala')), 'reserva_llego');
  ELSIF r.traslado_por_llegar > 0 THEN
    UPDATE public.app_reservas
       SET traslado_nota = format('Llegaron %s de %s; el resto viene en camino.', r.traslado_llegaron, r.cantidad), updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó una parte',
      format('De %s × %s para %s llegaron %s (de %s). El resto viene en camino: queda lista sola cuando llegue.',
             r.cantidad, r.producto_nombre, coalesce(v_cliente, 'el cliente'), r.traslado_llegaron, coalesce(p_de, 'otra sala')), 'reserva_parte');
  ELSE
    UPDATE public.app_reservas
       SET traslado_nota = format('Llegaron %s de %s.', r.traslado_llegaron, r.cantidad), updated_at = now()
     WHERE id = p_id;
    PERFORM public.reserva_avisar_sala(p_id, 'Llegó una parte',
      format('De %s × %s para %s llegaron %s. Pide el resto a otra sala o a Bodega, o habla con el cliente.',
             r.cantidad, r.producto_nombre, coalesce(v_cliente, 'el cliente'), r.traslado_llegaron), 'reserva_parte');
  END IF;
END $function$;
