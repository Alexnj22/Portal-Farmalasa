-- Saldo a favor (2026-10-21), parte 4: un titular que no coincide queda
-- anotado. `saldo_favor_buscar` es el paso donde la caja confirma al cliente
-- (tarjeta, DUI o teléfono) antes de usar el saldo, así que es acá donde se ve
-- el rechazo. Una fila por reserva y día; al tercer intento fallido pasa a
-- «posible intento indebido» y se avisa a quien maneja reservas. Deja de ser
-- STABLE porque ahora escribe.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.saldo_favor_buscar(p_codigo text, p_prueba text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v text := upper(btrim(coalesce(p_codigo, ''))); v_id bigint;
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_quien uuid := public.auth_employee_id();
  v_sala bigint;
  v_res json;
  v_tipo text; v_avisado timestamptz; v_intentos int; v_irr bigint; v_dest uuid[];
  f record;
BEGIN
  IF NOT (public.auth_has_module_permission('dash_reservas', 'can_view') OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v ~ '^R-[0-9]{1,12}$' THEN v_id := substring(v FROM 3)::bigint;
  ELSIF v !~ '^P-[A-Z0-9]{6}$' THEN RETURN '[]'::json; END IF;
  SELECT coalesce((
    SELECT json_agg(CASE WHEN x.modo IS NULL
      -- Sin confirmar: que existe y dónde nació. Ni el nombre ni el monto.
      THEN json_build_object('id', x.id, 'pedido', x.pedido, 'branch_id', x.branch_id, 'sala', x.sala,
                             'saldo_favor_vence', x.saldo_favor_vence, 'confirmado', false)
      ELSE json_build_object('id', x.id, 'estado', x.estado, 'pedido', x.pedido, 'branch_id', x.branch_id, 'sala', x.sala,
             'cliente', x.cliente, 'producto', x.producto_nombre, 'cantidad', x.cantidad,
             'saldo_favor', x.saldo_favor, 'saldo_favor_inicial', coalesce(x.saldo_favor_inicial, x.saldo_favor),
             'saldo_favor_vence', x.saldo_favor_vence, 'saldo_favor_origen', x.saldo_favor_origen,
             'saldo_favor_usado_at', x.saldo_favor_usado_at, 'saldo_favor_devuelto_at', x.saldo_favor_devuelto_at,
             'confirmado', true, 'confirmado_con', x.modo) END ORDER BY x.id)
      FROM (SELECT r.*, b.name AS sala, c.name AS cliente, public.cliente_confirma(r.customer_id, p_prueba) AS modo
              FROM public.app_reservas r
              JOIN public.customers c ON c.id = r.customer_id
              JOIN public.branches b ON b.id = r.branch_id
             WHERE (r.id = v_id OR (v_id IS NULL AND r.pedido = v))
               AND coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL AND r.saldo_favor_devuelto_at IS NULL
               AND r.saldo_favor_vence >= v_hoy) x), '[]'::json) INTO v_res;

  -- Rechazo del titular (2026-10-21): se escribió una prueba y no coincidió.
  IF btrim(coalesce(p_prueba, '')) <> '' THEN
    v_sala := coalesce(public.empleado_sala_de_hoy(NULL, v_hoy), public.auth_employee_branch_id());
    FOR f IN
      SELECT r.id, r.customer_id, r.branch_id, coalesce(r.pedido, 'R-' || lpad(r.id::text, 6, '0')) AS codigo
        FROM public.app_reservas r
       WHERE (r.id = v_id OR (v_id IS NULL AND r.pedido = v))
         AND coalesce(r.saldo_favor, 0) > 0 AND r.saldo_favor_usado_at IS NULL AND r.saldo_favor_devuelto_at IS NULL
         AND r.saldo_favor_vence >= v_hoy
         AND public.cliente_confirma(r.customer_id, p_prueba) IS NULL
    LOOP
      INSERT INTO public.puntos_irregularidad AS pi
        (clave, tipo, dia, customer_id, sucursal, employee_id, puntos, nota, detalle)
      VALUES ('saldo_rechazo:' || f.id || ':' || v_hoy, 'saldo_favor_titular_no_coincide', v_hoy, f.customer_id,
              (SELECT b.codigo_puntos FROM public.branches b WHERE b.id = v_sala), v_quien,
              round(coalesce((SELECT saldo_favor FROM public.app_reservas WHERE id = f.id), 0) * 100)::int,
              format('Se intentó usar el saldo a favor de %s y el cliente no coincidió con la ficha (1 intento hoy).', f.codigo),
              jsonb_build_object('reserva_id', f.id, 'codigo', f.codigo, 'intentos', 1, 'branch_id', v_sala,
                                 'empleados', jsonb_build_array(v_quien)))
      ON CONFLICT (clave) DO UPDATE
        SET detalle = pi.detalle
                      || jsonb_build_object('intentos', coalesce((pi.detalle->>'intentos')::int, 1) + 1,
                                            'empleados', CASE WHEN coalesce(pi.detalle->'empleados', '[]'::jsonb) @> to_jsonb(ARRAY[v_quien])
                                                              THEN pi.detalle->'empleados'
                                                              ELSE coalesce(pi.detalle->'empleados', '[]'::jsonb) || to_jsonb(ARRAY[v_quien]) END),
            tipo = CASE WHEN coalesce((pi.detalle->>'intentos')::int, 1) + 1 >= 3 THEN 'saldo_favor_intento_indebido' ELSE pi.tipo END,
            nota = format('%s el saldo a favor de %s y el cliente no coincidió con la ficha (%s intentos hoy).',
                          CASE WHEN coalesce((pi.detalle->>'intentos')::int, 1) + 1 >= 3
                               THEN 'Posible intento indebido: se intentó usar' ELSE 'Se intentó usar' END,
                          f.codigo, coalesce((pi.detalle->>'intentos')::int, 1) + 1),
            updated_at = now()
      RETURNING pi.id, pi.tipo, pi.avisado_at, (pi.detalle->>'intentos')::int INTO v_irr, v_tipo, v_avisado, v_intentos;

      IF v_tipo = 'saldo_favor_intento_indebido' AND v_avisado IS NULL THEN
        SELECT array_agg(DISTINCT d) INTO v_dest
          FROM unnest(coalesce(public.destinatarios_de_reservas(f.branch_id), '{}'::uuid[])
                      || coalesce(public.destinatarios_de_reservas(v_sala), '{}'::uuid[])) d;
        IF v_dest IS NOT NULL THEN
          PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
            'Saldo a favor: posible intento indebido',
            format('Hoy se intentó %s veces usar el saldo a favor de %s con datos que no son de la ficha del cliente.', v_intentos, f.codigo),
            '/puntos?tab=avisos', jsonb_build_object('check_key', 'saldo_rechazo:' || f.id || ':' || v_hoy, 'reserva_id', f.id),
            true, f.branch_id::integer);
        END IF;
        UPDATE public.puntos_irregularidad SET avisado_at = now() WHERE id = v_irr;
      END IF;
    END LOOP;
  END IF;

  RETURN v_res;
END $function$;
