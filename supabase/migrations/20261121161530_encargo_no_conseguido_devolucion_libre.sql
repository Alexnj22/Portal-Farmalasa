-- Encargo que no se consiguió: el cliente elige devolución o saldo (2026-11-21).
-- Reglamento de Reservas, cláusula 4.6: «Si el proveedor no entrega el
-- producto, el Cliente elige entre la devolución completa de lo pagado o
-- aplicarlo a otro producto». Hasta hoy lo pagado quedaba como saldo a favor y
-- el efectivo había que pedirlo y que administración lo autorizara, como si el
-- cliente hubiera desistido (cláusula 7). Ahora:
--   · el saldo que nace de un rechazo lleva `devolucion_sin_autorizar`;
--   · con esa marca, la sucursal devuelve el dinero sin pedir autorización
--     (`reserva_saldo_devolver`), y pasa a «Devoluciones por entregar» para
--     sacarlo de la caja con el vale de siempre;
--   · si el cliente prefiere, lo usa como cualquier saldo a favor.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas ADD COLUMN IF NOT EXISTS devolucion_sin_autorizar text;
COMMENT ON COLUMN public.app_reservas.devolucion_sin_autorizar IS
  'Por qué este saldo a favor se devuelve en dinero sin autorización (''no_conseguido'': cláusula 4.6 del reglamento de reservas).';

DO $migra$
DECLARE v_def text; v_n integer; v_ancla text;
BEGIN
  -- 1. encargo_responder: el saldo del rechazo nace con la marca, y el aviso lo dice.
  v_def := pg_get_functiondef('public.encargo_responder'::regproc);
  v_ancla := $a$          cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen)
      VALUES (e.customer_id, e.branch_id, 'sucursal', coalesce(e.product_id, e.sugerido_product_id),
          left('Encargo ' || v_cod || ' · ' || e.producto_nombre, 200),
          1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', round(e.abonado, 2), 'anticipo', v_metodo,
          coalesce(e.pagado_at, now()), now(), v_emp, round(e.abonado, 2), v_hoy + public.saldo_favor_dias(), 'anticipo')$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'encargo_responder (insert): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$          cerrada_at, cerrada_por, saldo_favor, saldo_favor_vence, saldo_favor_origen, devolucion_sin_autorizar)
      VALUES (e.customer_id, e.branch_id, 'sucursal', coalesce(e.product_id, e.sugerido_product_id),
          left('Encargo ' || v_cod || ' · ' || e.producto_nombre, 200),
          1, greatest(coalesce(e.factor, 1), 1), 0, 0, 'cancelada', 'encargo', round(e.abonado, 2), 'anticipo', v_metodo,
          coalesce(e.pagado_at, now()), now(), v_emp, round(e.abonado, 2), v_hoy + public.saldo_favor_dias(), 'anticipo',
          'no_conseguido')$b$);
  v_ancla := $a$'No conseguimos ' || coalesce(e.producto_nombre, 'tu encargo') || '. Lo que dejaste ($'
                || to_char(e.abonado, 'FM999990.00') || ') queda a tu favor por ' || public.saldo_favor_dias()
                || ' días, para otra compra en cualquier sucursal.',$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'encargo_responder (aviso): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$'No conseguimos ' || coalesce(e.producto_nombre, 'tu encargo') || '. Lo que dejaste ($'
                || to_char(e.abonado, 'FM999990.00') || ') te lo devolvemos en la sucursal si lo pides, o queda a tu favor por '
                || public.saldo_favor_dias() || ' días para otra compra en cualquier sucursal.',$b$);
  EXECUTE v_def;

  -- 2. reserva_saldo_devolver: con la marca, decide la sucursal y va a «por entregar».
  v_def := pg_get_functiondef('public.reserva_saldo_devolver(bigint,text)'::regprocedure);
  v_ancla := $a$  IF NOT public.auth_has_module_permission('dash_reservas_devolver_saldo', 'can_view') THEN$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'reserva_saldo_devolver (permiso): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$  -- (2026-11-21) Un encargo que no se consiguió se devuelve sin autorización
  -- (cláusula 4.6): lo decide el cliente, y la sucursal lo entrega.
  IF NOT public.auth_has_module_permission('dash_reservas_devolver_saldo', 'can_view')
     AND NOT EXISTS (SELECT 1 FROM public.app_reservas x
                      WHERE x.id = p_id AND x.devolucion_sin_autorizar IS NOT NULL
                        AND public.reserva_puede_manejar(x.branch_id)) THEN$b$);
  v_ancla := $a$  -- Se devuelve lo que queda (2026-10-21): lo ya usado se convirtió en puntos.$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'reserva_saldo_devolver (pedido): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$  -- Sin autorización, la devolución queda pedida en el acto: así sale de la caja
  -- con el vale de «Devoluciones por entregar».
  IF r.devolucion_sin_autorizar IS NOT NULL AND r.devolucion_pedida_at IS NULL THEN
    UPDATE public.app_reservas SET devolucion_pedida_at = now(), devolucion_pedida_por = public.auth_employee_id(),
           devolucion_pedida_motivo = left(v_motivo, 300) WHERE id = p_id;
    r.devolucion_pedida_at := now();
  END IF;
$b$ || v_ancla);
  v_ancla := $a$  IF r.devolucion_pedida_at IS NOT NULL THEN
    PERFORM public.reserva_avisar_saldo($a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'reserva_saldo_devolver (aviso): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$  IF r.devolucion_pedida_at IS NOT NULL AND r.devolucion_sin_autorizar IS NULL THEN
    PERFORM public.reserva_avisar_saldo($b$);
  EXECUTE v_def;

  -- 3. reservas_de_sucursal: la pantalla necesita saberlo.
  v_def := pg_get_functiondef('public.reservas_de_sucursal(bigint,boolean)'::regprocedure);
  v_ancla := $a$'saldo_favor_usado_at', r.saldo_favor_usado_at,$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'reservas_de_sucursal: el fragmento aparece % veces.', v_n; END IF;
  EXECUTE replace(v_def, v_ancla, $b$'saldo_favor_usado_at', r.saldo_favor_usado_at, 'devolucion_libre', r.devolucion_sin_autorizar IS NOT NULL,$b$);
END $migra$;

-- Los rechazos que ya pasaron (desde el 2026-11-21) también tienen derecho.
UPDATE public.app_reservas r SET devolucion_sin_autorizar = 'no_conseguido'
  FROM public.app_encargos e
 WHERE e.saldo_reserva_id = r.id AND e.estado = 'rechazado'
   AND r.devolucion_sin_autorizar IS NULL AND r.saldo_favor_devuelto_at IS NULL;
