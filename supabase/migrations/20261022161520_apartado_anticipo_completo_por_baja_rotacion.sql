-- Reglamento v2, cláusula 4.2 (decisión del dueño, 2026-10-22): el anticipo
-- del 100 % no depende de ser insumo sino de la ROTACIÓN. Un producto de muy
-- baja rotación en la sala que lo aparta —2 unidades o menos vendidas en los
-- últimos 6 meses, o ninguna— se aparta pagándolo completo; los demás, insumos
-- incluidos, con el 50 %. Lo que no hay se encarga y se paga completo igual.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.producto_baja_rotacion(p_producto_id bigint, p_branch_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.product_stock_params psp
      JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = psp.erp_sucursal_id
     WHERE psp.erp_product_id = p_producto_id AND m.branch_id = p_branch_id
       AND coalesce(psp.units_sold_6m, 0) > 2);
$function$;
REVOKE EXECUTE ON FUNCTION public.producto_baja_rotacion(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.producto_baja_rotacion(bigint, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apartado_opciones(p_branch_id bigint, p_producto_id bigint, p_factor integer, p_cantidad integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_disp numeric := 0;
  v_insumo boolean;
  v_necesita numeric := greatest(coalesce(p_cantidad, 1), 1) * greatest(coalesce(p_factor, 1), 1);
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(max((e->>'disponibles')::numeric), 0) INTO v_disp
    FROM json_array_elements(public.app_existencias_netas(ARRAY[p_producto_id::int])) e
   WHERE (e->>'branch_id')::bigint = p_branch_id;
  v_insumo := EXISTS (SELECT 1 FROM public.producto_insumo WHERE product_id = p_producto_id);
  RETURN json_build_object(
    'disponibles', v_disp, 'necesita', v_necesita, 'insumo', v_insumo,
    -- Reglamento v2: lo que hay se aparta (insumo o no); sólo se encarga si no hay.
    'modo', CASE WHEN v_disp >= v_necesita THEN 'reserva' ELSE 'encargo' END,
    -- Muy baja rotación: el apartado pide el 100 % en vez del 50 %.
    'baja_rotacion', public.producto_baja_rotacion(p_producto_id, p_branch_id),
    'precios', (SELECT coalesce(json_agg(DISTINCT round(pp.vineta, 2)), '[]'::json) FROM public.product_precios pp
                 WHERE pp.product_id = p_producto_id AND pp.activo AND pp.factor = greatest(coalesce(p_factor, 1), 1) AND pp.vineta > 0));
END $function$;

CREATE OR REPLACE FUNCTION public.apartado_cotizar(p_branch_id bigint, p_apartado jsonb)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_modo text := p_apartado->>'modo';
  v_cant integer; v_factor integer; v_precio numeric; v_total numeric; v_disp numeric;
  v_desde bigint := nullif(p_apartado->>'traslado_desde', '')::bigint; v_desde_nombre text;
  r public.app_reservas; e public.app_encargos; v_cliente text; k record;
BEGIN
  IF v_modo = 'nueva' THEN
    v_cant := (p_apartado->>'cantidad')::integer;
    v_factor := greatest(coalesce((p_apartado->>'factor')::integer, 1), 1);
    v_precio := round((p_apartado->>'precio')::numeric, 2);
    SELECT name INTO v_cliente FROM public.customers WHERE id = (p_apartado->>'customer_id')::bigint;
    IF v_cliente IS NULL THEN RAISE EXCEPTION 'Elige el cliente del listado.'; END IF;
    IF v_cant IS NULL OR v_cant < 1 OR v_cant > 999 THEN RAISE EXCEPTION 'La cantidad va de 1 a 999.'; END IF;
    -- El precio queda fijo sólo si es el del catálogo para esa presentación.
    IF v_precio IS NULL OR NOT EXISTS (SELECT 1 FROM public.product_precios pp
        WHERE pp.product_id = (p_apartado->>'producto_id')::bigint AND pp.activo AND pp.factor = v_factor
          AND round(pp.vineta, 2) = v_precio) THEN
      RAISE EXCEPTION 'Ese precio no es el del catálogo para esa presentación.';
    END IF;
    IF v_desde IS NOT NULL THEN
      -- Viene de otra sala: la existencia que manda es la de ESA sala.
      IF v_desde = p_branch_id THEN RAISE EXCEPTION 'El traslado tiene que venir de otra sala.'; END IF;
      SELECT name INTO v_desde_nombre FROM public.branches WHERE id = v_desde;
      IF v_desde_nombre IS NULL THEN RAISE EXCEPTION 'Esa sala no existe.'; END IF;
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = v_desde;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En % hay % unidades y se piden %.', v_desde_nombre, v_disp, v_cant * v_factor;
      END IF;
    ELSE
      SELECT coalesce(max((x->>'disponibles')::numeric), 0) INTO v_disp
        FROM json_array_elements(public.app_existencias_netas(ARRAY[(p_apartado->>'producto_id')::int])) x
       WHERE (x->>'branch_id')::bigint = p_branch_id;
      IF v_disp < v_cant * v_factor THEN
        RAISE EXCEPTION 'En esta sala hay % unidades y se piden %: se encarga, no se aparta.', v_disp, v_cant * v_factor;
      END IF;
    END IF;
    v_total := round(v_precio * v_cant, 2);
    -- Muy baja rotación en la sala que lo aparta: se paga completo (reglamento v2, cláusula 4.2).
    RETURN json_build_object('tipo', 'reserva', 'total', v_total,
      'minimo', CASE WHEN public.producto_baja_rotacion((p_apartado->>'producto_id')::bigint, p_branch_id)
                     THEN v_total ELSE round(v_total * 0.5, 2) END, 'maximo', v_total,
      'baja_rotacion', public.producto_baja_rotacion((p_apartado->>'producto_id')::bigint, p_branch_id),
      'cliente', v_cliente, 'detalle', (p_apartado->>'producto_nombre'), 'traslado_desde', v_desde_nombre);

  ELSIF v_modo = 'reserva' THEN
    SELECT * INTO r FROM public.app_reservas WHERE id = (p_apartado->>'reserva_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa reserva no existe.'; END IF;
    IF r.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa reserva es de otra sala.'; END IF;
    -- Una reserva de la app se paga en la app o al retirarla, nunca con un
    -- anticipo de caja: mezclar las dos formas es lo que cobraba dos veces.
    IF r.origen IS DISTINCT FROM 'sucursal' THEN RAISE EXCEPTION 'Esa reserva es de la app: se paga en la app o al retirarla.'; END IF;
    IF r.estado NOT IN ('pendiente', 'lista') THEN RAISE EXCEPTION 'Esa reserva ya no está abierta.'; END IF;
    -- Cuánto falta: lo dice `reserva_cuenta` (descuenta anticipo y pago en línea).
    SELECT * INTO k FROM public.reserva_cuenta(r.id);
    IF k.falta_pagar <= 0.004 THEN RAISE EXCEPTION 'Esa reserva ya está pagada.'; END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = r.customer_id;
    RETURN json_build_object('tipo', 'reserva', 'total', k.total, 'minimo', 0.01,
      'maximo', k.falta_pagar, 'cliente', v_cliente, 'detalle', r.producto_nombre,
      'codigo', 'R-' || lpad(r.id::text, 6, '0'));

  ELSIF v_modo = 'encargo' THEN
    SELECT * INTO e FROM public.app_encargos WHERE id = (p_apartado->>'encargo_id')::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese encargo no existe.'; END IF;
    IF e.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Ese encargo es de otra sala.'; END IF;
    IF e.estado <> 'confirmado' THEN RAISE EXCEPTION 'Ese encargo todavía no tiene el precio confirmado.'; END IF;
    IF e.pago_estado <> 'pendiente' THEN RAISE EXCEPTION 'Ese encargo ya está pagado.'; END IF;
    -- El resto de una reserva (2026-10-22) se paga con la reserva: cobrarlo acá sería cobrar dos veces.
    IF e.reserva_id IS NOT NULL THEN
      RAISE EXCEPTION 'Ese encargo es el resto de la reserva R-%: se cobra con la reserva.', lpad(e.reserva_id::text, 6, '0');
    END IF;
    SELECT name INTO v_cliente FROM public.customers WHERE id = e.customer_id;
    -- El encargo se paga completo: lo que no tenemos se pide para esa persona.
    RETURN json_build_object('tipo', 'encargo', 'total', round(e.anticipo, 2), 'minimo', round(e.anticipo, 2),
      'maximo', round(e.anticipo, 2), 'cliente', v_cliente, 'detalle', e.producto_nombre,
      'codigo', 'E-' || lpad(e.id::text, 6, '0'));
  END IF;
  RAISE EXCEPTION 'No se sabe qué se está apartando.';
END $function$;
