-- Batería de pruebas de las aplicaciones de inyección pagadas (2026-10-02).
-- SÓLO en el entorno de pruebas. Corre dentro de una transacción que se
-- DESHACE al final: no deja nada escrito. Devuelve una fila por prueba.
--
--   supabase db query --linked -f scripts/entorno-pruebas/probar_inyecciones_pagadas.sql
--
-- Cambia de identidad con `request.jwt.claims` + `SET LOCAL ROLE authenticated`
-- (las funciones `auth_*` resuelven al empleado por `auth.uid()` = su id). Los
-- cargos de las cuentas de prueba se acomodan DENTRO de la transacción.

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.employees) > 20 THEN
    RAISE EXCEPTION 'Esto parece producción: la batería de pruebas no se corre acá.';
  END IF;
END $$;

CREATE TEMP TABLE r (n serial, prueba text, ok boolean, detalle text) ON COMMIT DROP;

DO $$
DECLARE
  v_ger   uuid := (SELECT id FROM employees WHERE username = 'pruebas');
  v_sala_emp uuid; v_sin_emp uuid;
  v_rol_sala integer; v_rol_sin integer;
  v_inv bigint; v_lin smallint; v_total int; v_prod text;
  v_otra bigint; v_otra_lin smallint;
  v_inv2 bigint; v_lin2 smallint;
  c1 bigint; c2 bigint; c3 bigint; c4 bigint; c5 bigint;
  j json; t text; n int; m int; b boolean; ids bigint[];
  hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  -- ── Preparación ──────────────────────────────────────────────────────────
  -- Una venta de Salud 4 (28) con un renglón inyectable de 3+ unidades y sin
  -- ninguna aplicación todavía; otra de Salud 5 (29); otra más de Salud 4.
  SELECT ii.invoice_id, ii.linea_num, ii.descripcion INTO v_inv, v_lin, v_prod
  FROM sales_invoices si JOIN sales_invoice_items ii ON ii.invoice_id = si.id
  WHERE si.branch_id = 28 AND si.fecha >= hoy - 6 AND venta_valida(si.estado)
    AND es_inyectable(ii.descripcion) AND ii.cantidad >= 3
    AND NOT EXISTS (SELECT 1 FROM inyeccion_aplicaciones a WHERE a.invoice_id = si.id)
  ORDER BY si.id DESC LIMIT 1;
  SELECT ii.invoice_id, ii.linea_num INTO v_otra, v_otra_lin
  FROM sales_invoices si JOIN sales_invoice_items ii ON ii.invoice_id = si.id
  WHERE si.branch_id = 29 AND si.fecha >= hoy - 6 AND venta_valida(si.estado) AND es_inyectable(ii.descripcion)
  ORDER BY si.id DESC LIMIT 1;
  SELECT ii.invoice_id, ii.linea_num INTO v_inv2, v_lin2
  FROM sales_invoices si JOIN sales_invoice_items ii ON ii.invoice_id = si.id
  WHERE si.branch_id = 28 AND si.fecha >= hoy - 6 AND venta_valida(si.estado)
    AND es_inyectable(ii.descripcion) AND si.id <> v_inv
    AND NOT EXISTS (SELECT 1 FROM inyeccion_aplicaciones a WHERE a.invoice_id = si.id)
  ORDER BY si.id DESC LIMIT 1;
  SELECT total INTO v_total FROM inyeccion_renglones_de_venta(ARRAY[v_inv]) WHERE linea_num = v_lin;
  INSERT INTO r(prueba, ok, detalle) VALUES ('preparación: ventas de prueba encontradas',
    v_inv IS NOT NULL AND v_otra IS NOT NULL AND v_inv2 IS NOT NULL AND v_total >= 3,
    format('venta %s renglón %s (%s, %s dosis) · otra sala %s · segunda %s', v_inv, v_lin, v_prod, v_total, v_otra, v_inv2));

  -- Cuenta «sala»: un cargo con caja de su sala y la vista con alcance de sala.
  SELECT rp.role_id INTO v_rol_sala FROM role_permissions rp
  WHERE rp.module_key = 'inyecciones' AND rp.scope = 'BRANCH' AND rp.can_view
    AND EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.module_key = 'caja_vales' AND x.can_edit AND x.scope = 'BRANCH')
  LIMIT 1;
  -- Cuenta «sin permiso»: un cargo sin caja y sin la vista.
  SELECT ro.id INTO v_rol_sin FROM roles ro
  WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = ro.id
                    AND x.module_key IN ('caja_vales', 'inyecciones', 'inyecciones_tab_pendientes', 'inyecciones_tab_por_cobrar'))
  LIMIT 1;
  SELECT id INTO v_sala_emp FROM employees WHERE id <> v_ger ORDER BY id LIMIT 1;
  SELECT id INTO v_sin_emp FROM employees WHERE id NOT IN (v_ger, v_sala_emp) ORDER BY id LIMIT 1;
  UPDATE employees SET role_id = v_rol_sala, branch_id = 28 WHERE id = v_sala_emp;
  UPDATE employees SET role_id = v_rol_sin, branch_id = 28 WHERE id = v_sin_emp;
  INSERT INTO r(prueba, ok, detalle) VALUES ('preparación: cuentas de sala y sin permiso',
    v_rol_sala IS NOT NULL AND v_rol_sin IS NOT NULL, format('rol sala %s · rol sin permiso %s', v_rol_sala, v_rol_sin));

  -- ── Sugerencia de aplicaciones por unidad base ─────────────────────────
  b := inyeccion_aplicaciones_por_nombre('NEUROBION 25,000 AMP TRI PACK') = 3
   AND inyeccion_aplicaciones_por_nombre('NUCLEO CMP FORTE X 3 AMPOLLAS') = 3
   AND inyeccion_aplicaciones_por_nombre('TRAMAL 100MG X 5 AMPOLLAS') = 5
   AND inyeccion_aplicaciones_por_nombre('RUBRAVIDA VIAL X 10 ML') = 1
   AND inyeccion_aplicaciones_por_nombre('DEPO PROVERA AMPOLLA X 1ML') = 1
   AND inyeccion_aplicaciones_por_nombre('NEUROBION 25,000 AMP') = 1;
  INSERT INTO r VALUES (DEFAULT, 'sugerencia por nombre: TRI PACK=3, X 3 AMPOLLAS=3, X 5 AMPOLLAS=5, vial=1', b, NULL);
  -- Un producto que se vende SUELTO (alguna presentación con factor > 1) tiene
  -- base 1 aunque el nombre diga «X 5»: la caja multiplica por su factor.
  SELECT pp.product_id INTO n FROM product_precios pp WHERE pp.factor > 1 LIMIT 1;
  IF n IS NOT NULL THEN
    INSERT INTO r VALUES (DEFAULT, 'producto que se vende suelto → base 1 (la caja multiplica)',
      inyeccion_base_sugerida(n, 'ALGO X 5 AMPOLLAS') = 1, format('producto %s', n));
  ELSE
    INSERT INTO r VALUES (DEFAULT, 'producto que se vende suelto → base 1 (la caja multiplica)', true, 'sin productos con caja en pruebas: no se pudo medir');
  END IF;

  -- ── Cotizar ─────────────────────────────────────────────────────────────
  j := inyeccion_cotizar(28, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', 2))::jsonb, NULL, NULL);
  INSERT INTO r VALUES (DEFAULT, 'cotizar comprada ×2 = $2.00 con la factura en el detalle',
    (j->>'monto')::numeric = 2.00 AND j->>'detalle' LIKE 'Fac %', j::text);

  BEGIN
    PERFORM inyeccion_cotizar(28, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', v_total + 1))::jsonb, NULL, NULL);
    INSERT INTO r VALUES (DEFAULT, 'cotizar más dosis de las que trae la venta → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'cotizar más dosis de las que trae la venta → rechaza', SQLERRM LIKE 'Ya no quedan%', SQLERRM); END;

  BEGIN
    PERFORM inyeccion_cotizar(28, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_otra, 'linea_num', v_otra_lin, 'cantidad', 1))::jsonb, NULL, NULL);
    INSERT INTO r VALUES (DEFAULT, 'cotizar una venta de otra sala → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'cotizar una venta de otra sala → rechaza', SQLERRM LIKE '%otra sala%', SQLERRM); END;

  BEGIN
    PERFORM inyeccion_cotizar(28, 'COMPRADA', json_build_array(
      json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', 1),
      json_build_object('invoice_id', v_inv2, 'linea_num', v_lin2, 'cantidad', 1))::jsonb, NULL, NULL);
    INSERT INTO r VALUES (DEFAULT, 'cotizar dos ventas en un cobro → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'cotizar dos ventas en un cobro → rechaza', SQLERRM LIKE '%una sola venta%', SQLERRM); END;

  BEGIN
    PERFORM inyeccion_cotizar(28, 'COMPRADA_SUELTA', NULL, 1, 'X');
    INSERT INTO r VALUES (DEFAULT, 'cobro «sin venta» (origen viejo) → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'cobro «sin venta» (origen viejo) → rechaza', true, SQLERRM); END;

  BEGIN
    PERFORM inyeccion_cotizar(28, 'TRAIDA', NULL, 1, '  ');
    INSERT INTO r VALUES (DEFAULT, 'traída sin producto → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'traída sin producto → rechaza', true, SQLERRM); END;

  BEGIN
    PERFORM inyeccion_cotizar(28, 'TRAIDA', NULL, 21, 'NEUROBION');
    INSERT INTO r VALUES (DEFAULT, 'traída con 21 aplicaciones → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'traída con 21 aplicaciones → rechaza', true, SQLERRM); END;

  j := inyeccion_cotizar(28, 'TRAIDA', NULL, 2, 'neurobion');
  INSERT INTO r VALUES (DEFAULT, 'cotizar traída ×2 = $4.00', (j->>'monto')::numeric = 4.00, j::text);

  -- ── Registrar ───────────────────────────────────────────────────────────
  INSERT INTO caja_movimientos_portal (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, erp_apertura_id)
  VALUES (28, 'ENTRADA', 2, 'prueba', hoy, v_ger, 'APLICACION', 0) RETURNING id INTO c1;
  j := inyeccion_registrar(c1, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', 2))::jsonb,
                           NULL, NULL, 1, v_ger, 'ana prueba');
  SELECT count(*), count(*) FILTER (WHERE aplicada_at IS NOT NULL) INTO n, m FROM inyeccion_aplicaciones WHERE cobro_id = c1;
  SELECT bool_and(cliente = 'ANA PRUEBA' AND NOT confirmada) INTO b FROM inyeccion_aplicaciones WHERE cobro_id = c1;
  INSERT INTO r VALUES (DEFAULT, 'registrar 2, aplicar 1 ahora, a nombre de «ana prueba»: 2 filas, 1 aplicada, sin confirmar',
    n = 2 AND m = 1 AND b, format('filas %s · aplicadas %s', n, m));

  SELECT disponibles INTO n FROM inyeccion_renglones_de_venta(ARRAY[v_inv]) WHERE linea_num = v_lin;
  INSERT INTO r VALUES (DEFAULT, 'mientras no se confirman, ya cuentan como usadas (en vuelo)', n = v_total - 2, format('disponibles %s de %s', n, v_total));

  BEGIN
    PERFORM inyeccion_registrar(c1, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', 1))::jsonb, NULL, NULL, 0, v_ger, NULL);
    INSERT INTO r VALUES (DEFAULT, 'registrar dos veces el mismo cobro → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'registrar dos veces el mismo cobro → rechaza', SQLERRM LIKE '%ya tiene%', SQLERRM); END;

  -- Sin confirmar no aparece en pendientes; confirmada sí.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM json_array_elements(inyecciones_pendientes(NULL, 28)) x WHERE (x->>'cobro_id')::bigint = c1;
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'una aplicación sin confirmar NO aparece en pendientes', n = 0, format('%s', n));
  UPDATE inyeccion_aplicaciones SET confirmada = true WHERE cobro_id = c1;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM json_array_elements(inyecciones_pendientes(NULL, 28)) x WHERE (x->>'cobro_id')::bigint = c1;
  SELECT count(*) INTO m FROM json_array_elements(inyecciones_pendientes('ana prueba', NULL)) x WHERE (x->>'cobro_id')::bigint = c1;
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'confirmada: la que no se aplicó aparece en pendientes, y se encuentra por el nombre', n = 1 AND m = 1, format('%s / %s', n, m));

  -- Una sin confirmar de hace 10 minutos es un intento que la caja rechazó: no cuenta.
  INSERT INTO caja_movimientos_portal (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, erp_apertura_id)
  VALUES (28, 'ENTRADA', 1, 'prueba vieja', hoy, v_ger, 'APLICACION', 0) RETURNING id INTO c2;
  PERFORM inyeccion_registrar(c2, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', 1))::jsonb, NULL, NULL, 0, v_ger, 'x x x');
  UPDATE inyeccion_aplicaciones SET created_at = now() - interval '10 minutes' WHERE cobro_id = c2;
  SELECT disponibles INTO n FROM inyeccion_renglones_de_venta(ARRAY[v_inv]) WHERE linea_num = v_lin;
  INSERT INTO r VALUES (DEFAULT, 'un intento rechazado (sin confirmar, >5 min) devuelve el saldo', n = v_total - 2, format('disponibles %s', n));

  -- Un cobro anulado saca sus aplicaciones de todos lados.
  INSERT INTO caja_movimientos_portal (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, erp_apertura_id)
  VALUES (28, 'ENTRADA', 1, 'prueba anulada', hoy, v_ger, 'APLICACION', 0) RETURNING id INTO c3;
  PERFORM inyeccion_registrar(c3, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv, 'linea_num', v_lin, 'cantidad', 1))::jsonb, NULL, NULL, 0, v_ger, 'y y y');
  UPDATE inyeccion_aplicaciones SET confirmada = true WHERE cobro_id = c3;
  UPDATE caja_movimientos_portal SET anulado_at = now() WHERE id = c3;
  SELECT disponibles INTO n FROM inyeccion_renglones_de_venta(ARRAY[v_inv]) WHERE linea_num = v_lin;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO m FROM json_array_elements(inyecciones_pendientes(NULL, 28)) x WHERE (x->>'cobro_id')::bigint = c3;
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'cobro anulado: no ocupa saldo ni aparece en pendientes', n = v_total - 2 AND m = 0, format('disponibles %s · pendientes %s', n, m));

  -- ── Canjear ─────────────────────────────────────────────────────────────
  SELECT array_agg(id) INTO ids FROM inyeccion_aplicaciones WHERE cobro_id = c1 AND aplicada_at IS NULL;
  SET LOCAL ROLE authenticated;
  n := inyeccion_aplicar(ids, 29);
  RESET ROLE;
  SELECT aplicada_branch_id INTO m FROM inyeccion_aplicaciones WHERE id = ids[1];
  INSERT INTO r VALUES (DEFAULT, 'canjear (alcance total) en Salud 5: queda aplicada en Salud 5', n = 1 AND m = 29, format('%s · sala %s', n, m));
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM inyeccion_aplicar(ids, 28);
    RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'canjear dos veces la misma → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'canjear dos veces la misma → rechaza', SQLERRM LIKE '%ya no está pendiente%', SQLERRM); END;
  RESET ROLE;

  -- Canje con alcance total y SIN sala indicada (desde la vista con «todas»):
  -- queda en la sala donde se pagó, no en la de la ficha de quien marca.
  INSERT INTO caja_movimientos_portal (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, erp_apertura_id)
  VALUES (28, 'ENTRADA', 2, 'prueba sin sala', hoy, v_ger, 'APLICACION', 0) RETURNING id INTO c5;
  PERFORM inyeccion_registrar(c5, 'TRAIDA', NULL, 1, 'neurobion', 0, v_ger, 'w w w');
  UPDATE inyeccion_aplicaciones SET confirmada = true WHERE cobro_id = c5;
  SELECT array_agg(id) INTO ids FROM inyeccion_aplicaciones WHERE cobro_id = c5;
  SET LOCAL ROLE authenticated;
  PERFORM inyeccion_aplicar(ids, NULL);
  RESET ROLE;
  SELECT aplicada_branch_id INTO m FROM inyeccion_aplicaciones WHERE id = ids[1];
  INSERT INTO r VALUES (DEFAULT, 'canjear sin indicar sala (vista con «todas») → queda donde se pagó (28)', m = 28, format('sala %s', m));
  c5 := NULL;

  -- ── Permisos: cuenta de SALA (caja y vista de su sala) ─────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sala_emp, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM inyecciones_para_cobrar(29, NULL, 7);
    RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sala: pedir la lista de cobro de OTRA sala → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sala: pedir la lista de cobro de OTRA sala → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  SELECT json_array_length(inyecciones_para_cobrar(28, NULL, 7)) INTO n;
  SELECT count(*) INTO m FROM json_array_elements(inyecciones_para_cobrar(28, NULL, 7)) x WHERE (x->>'disponibles')::int <= 0;
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'sala: su lista de cobro carga y no trae ventas ya pagadas enteras', n > 0 AND m = 0, format('%s ventas · %s sin saldo', n, m));
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM get_inyecciones_aplicadas(28, hoy - 7, hoy);
    RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sala: «Por cobrar» (nombra al vendedor) → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sala: «Por cobrar» (nombra al vendedor) → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM json_array_elements(inyecciones_bitacora(29, hoy - 7, hoy, NULL)) x
   WHERE (x->>'branch_id')::int <> 28 AND coalesce((x->>'aplicada_branch_id')::int, 0) <> 28;
  SELECT count(*) INTO m FROM inyeccion_aplicaciones WHERE branch_id <> 28 AND coalesce(aplicada_branch_id, 0) <> 28;
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'sala: la bitácora y la tabla sólo le muestran su sala aunque pida otra', n = 0 AND m = 0, format('bitácora ajena %s · tabla ajena %s', n, m));
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM inyeccion_fijar_dosis(1, 3);
    RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sala: cambiar las dosis de un producto → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sala: cambiar las dosis de un producto → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM inyeccion_fijar_precio('COMPRADA', 0.01);
    RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sala: cambiar el precio → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sala: cambiar el precio → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO inyeccion_aplicaciones (branch_id, origen, producto, precio, cobro_id, confirmada)
    VALUES (28, 'TRAIDA', 'FALSA', 0, c1, true);
    RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sala: escribir directo en la tabla (fabricar una pendiente) → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sala: escribir directo en la tabla (fabricar una pendiente) → prohibido', true, SQLERRM); END;
  RESET ROLE;
  -- Canje de la sala: queda en SU sala aunque mande otra.
  INSERT INTO caja_movimientos_portal (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, erp_apertura_id)
  VALUES (28, 'ENTRADA', 1, 'prueba sala', hoy, v_ger, 'APLICACION', 0) RETURNING id INTO c4;
  PERFORM inyeccion_registrar(c4, 'TRAIDA', NULL, 1, 'neurobion', 0, v_ger, 'z z z');
  UPDATE inyeccion_aplicaciones SET confirmada = true WHERE cobro_id = c4;
  SELECT array_agg(id) INTO ids FROM inyeccion_aplicaciones WHERE cobro_id = c4;
  SET LOCAL ROLE authenticated;
  PERFORM inyeccion_aplicar(ids, 29);
  RESET ROLE;
  SELECT aplicada_branch_id INTO m FROM inyeccion_aplicaciones WHERE id = ids[1];
  INSERT INTO r VALUES (DEFAULT, 'sala: canjea mandando otra sala → queda en la suya (28)', m = 28, format('sala %s', m));

  -- ── Permisos: cuenta SIN caja ni vista ─────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sin_emp, 'role', 'authenticated')::text, true);
  BEGIN SET LOCAL ROLE authenticated; PERFORM inyecciones_para_cobrar(28, NULL, 7); RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sin permiso: lista de cobro → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sin permiso: lista de cobro → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE authenticated; PERFORM inyecciones_pendientes(NULL, NULL); RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sin permiso: pendientes → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sin permiso: pendientes → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE authenticated; PERFORM inyeccion_aplicar(ARRAY[1::bigint], 28); RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'sin permiso: canjear → prohibido', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sin permiso: canjear → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM inyeccion_aplicaciones;
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'sin permiso: la tabla no le muestra ninguna fila', n = 0, format('%s', n));

  -- ── Quién puede ejecutar qué ───────────────────────────────────────────
  SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')) INTO b
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'inyecc%' OR p.proname = 'get_inyecciones_aplicadas');
  INSERT INTO r VALUES (DEFAULT, 'anónimo no puede ejecutar ninguna función de inyecciones', b, NULL);
  b := NOT has_function_privilege('authenticated', 'public.inyeccion_cotizar(integer,text,jsonb,integer,text)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.inyeccion_registrar(bigint,text,jsonb,integer,text,integer,uuid,text)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.inyeccion_renglones_de_venta(bigint[])', 'EXECUTE');
  INSERT INTO r VALUES (DEFAULT, 'un usuario no puede cotizar ni registrar por su cuenta (sólo operar-caja)', b, NULL);

  -- ── Supervisión: dosis, precio, asignar ────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM inyeccion_fijar_precio('COMPRADA', 1.50);
  RESET ROLE;
  j := inyeccion_cotizar(28, 'COMPRADA', json_build_array(json_build_object('invoice_id', v_inv2, 'linea_num', v_lin2, 'cantidad', 1))::jsonb, NULL, NULL);
  INSERT INTO r VALUES (DEFAULT, 'gerencia cambia el precio a $1.50 → el próximo cobro sale a $1.50', (j->>'monto')::numeric = 1.50, j->>'monto');
  SET LOCAL ROLE authenticated;
  PERFORM inyeccion_fijar_precio('COMPRADA', 1.00);
  RESET ROLE;

  -- Asignar un cobro suelto (los de antes): $1 → 1 aplicación, aplicada.
  INSERT INTO caja_movimientos_portal (branch_id, tipo, monto, concepto, fecha, registrado_por, tipo_codigo, erp_apertura_id)
  VALUES (28, 'ENTRADA', 1, 'Aplicacion de inyeccion · texto libre', hoy, v_ger, 'APLICACION', 0) RETURNING id INTO c5;
  SET LOCAL ROLE authenticated;
  n := inyeccion_vincular_cobro(c5, v_inv2, v_lin2);
  RESET ROLE;
  SELECT count(*) INTO m FROM inyeccion_aplicaciones WHERE cobro_id = c5 AND confirmada AND aplicada_at IS NOT NULL AND vinculada_por IS NOT NULL;
  INSERT INTO r VALUES (DEFAULT, 'asignar un cobro suelto de $1 → 1 aplicación, aplicada, marcada como asignada a mano', n = 1 AND m = 1, format('%s / %s', n, m));
  BEGIN SET LOCAL ROLE authenticated; PERFORM inyeccion_vincular_cobro(c5, v_inv2, v_lin2); RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'asignar dos veces el mismo cobro → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'asignar dos veces el mismo cobro → rechaza', SQLERRM LIKE '%ya está%', SQLERRM); END;
  RESET ROLE;
  BEGIN SET LOCAL ROLE authenticated; PERFORM inyeccion_desvincular_cobro(c1); RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'deshacer un cobro registrado al cobrar (no a mano) → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'deshacer un cobro registrado al cobrar (no a mano) → rechaza', SQLERRM LIKE '%no se deshace%', SQLERRM); END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  n := inyeccion_desvincular_cobro(c5);
  RESET ROLE;
  INSERT INTO r VALUES (DEFAULT, 'deshacer la asignación a mano → borra sus filas', n = 1, format('%s', n));
  BEGIN SET LOCAL ROLE authenticated; PERFORM inyeccion_vincular_cobro(c5, v_otra, v_otra_lin); RESET ROLE;
    INSERT INTO r VALUES (DEFAULT, 'asignar a una venta de otra sala → rechaza', false, 'no rechazó');
  EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'asignar a una venta de otra sala → rechaza', SQLERRM LIKE '%otra sala%', SQLERRM); END;
  RESET ROLE;

  -- Dosis confirmadas cambian el total del renglón.
  SET LOCAL ROLE authenticated;
  PERFORM inyeccion_fijar_dosis((SELECT erp_product_id FROM sales_invoice_items WHERE invoice_id = v_inv2 AND linea_num = v_lin2), 5);
  RESET ROLE;
  SELECT por_unidad, confirmado, factor INTO n, b, m FROM inyeccion_renglones_de_venta(ARRAY[v_inv2]) WHERE linea_num = v_lin2;
  INSERT INTO r VALUES (DEFAULT, 'supervisión confirma 5 por unidad → el renglón vale 5 × su factor, confirmado', n = 5 * m AND b, format('%s por unidad · factor %s · %s', n, m, b));

  -- ── Pestaña «Por cobrar» ───────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  j := get_inyecciones_aplicadas(28, hoy - 7, hoy);
  RESET ROLE;
  SELECT x->>'vinculo', (x->>'pagadas')::int, (x->>'aplicadas')::int INTO t, n, m
  FROM json_array_elements(j->'ventas') x WHERE (x->>'id')::bigint = v_inv;
  INSERT INTO r VALUES (DEFAULT, 'Por cobrar: la venta muestra «registrado», 2 pagadas y 2 aplicadas', t = 'registrado' AND n = 2 AND m = 2, format('%s %s %s', t, n, m));
  SELECT count(*) INTO n FROM json_array_elements(j->'cobros_sin_venta') x WHERE (x->>'id')::bigint IN (c1, c4);
  SELECT count(*) INTO m FROM json_array_elements(j->'cobros_sin_venta') x WHERE (x->>'id')::bigint = c4 AND x->>'origen' = 'TRAIDA';
  INSERT INTO r VALUES (DEFAULT, 'Por cobrar: el cobro registrado no queda «sin venta»; la traída sí, marcada como traída', n = 1 AND m = 1, format('%s / %s', n, m));

  -- ── Agregar / quitar productos a mano ─────────────────────────────────
  DECLARE
    v_prod integer; v_otro integer; v_otro_inv bigint;
  BEGIN
    SELECT erp_product_id INTO v_prod FROM sales_invoice_items WHERE invoice_id = v_inv2 AND linea_num = v_lin2;
    -- Quitar: la venta deja de ofrecerse y su renglón desaparece.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ger, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM inyeccion_clasificar_producto(v_prod, false);
    SELECT count(*) INTO n FROM json_array_elements(inyecciones_para_cobrar(28, NULL, 7)) x WHERE (x->>'id')::bigint = v_inv2;
    RESET ROLE;
    SELECT count(*) INTO m FROM inyeccion_renglones_de_venta(ARRAY[v_inv2]) WHERE linea_num = v_lin2;
    INSERT INTO r VALUES (DEFAULT, 'quitar un producto: su venta ya no se ofrece para cobrar', n = 0 AND m = 0, format('lista %s · renglón %s', n, m));
    -- Volver a lo automático: aparece de nuevo.
    SET LOCAL ROLE authenticated;
    PERFORM inyeccion_clasificar_producto(v_prod, NULL);
    RESET ROLE;
    SELECT count(*) INTO m FROM inyeccion_renglones_de_venta(ARRAY[v_inv2]) WHERE linea_num = v_lin2;
    INSERT INTO r VALUES (DEFAULT, 'volver a lo automático: el renglón vuelve a contar', m = 1, format('%s', m));
    -- Agregar uno que el nombre NO da por inyección.
    SELECT ii.erp_product_id, ii.invoice_id INTO v_otro, v_otro_inv
    FROM sales_invoices si JOIN sales_invoice_items ii ON ii.invoice_id = si.id
    WHERE si.branch_id = 28 AND si.fecha >= hoy - 6 AND venta_valida(si.estado)
      AND NOT es_inyectable(ii.descripcion) AND ii.erp_product_id IS NOT NULL
    LIMIT 1;
    SET LOCAL ROLE authenticated;
    PERFORM inyeccion_clasificar_producto(v_otro, true);
    SELECT count(*) INTO n FROM json_array_elements(inyeccion_catalogo_dosis()) x
     WHERE (x->>'erp_product_id')::int = v_otro AND x->>'clasificacion' = 'incluido';
    RESET ROLE;
    SELECT count(*) INTO m FROM inyeccion_renglones_de_venta(ARRAY[v_otro_inv]) WHERE erp_product_id = v_otro;
    INSERT INTO r VALUES (DEFAULT, 'agregar un producto que el nombre no reconoce: cuenta y sale en el catálogo como «agregado»',
      n = 1 AND m >= 1, format('catálogo %s · renglones %s', n, m));
    -- La sala no puede clasificar.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_sala_emp, 'role', 'authenticated')::text, true);
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM inyeccion_clasificar_producto(v_prod, false);
      RESET ROLE;
      INSERT INTO r VALUES (DEFAULT, 'sala: agregar/quitar productos → prohibido', false, 'no rechazó');
    EXCEPTION WHEN OTHERS THEN INSERT INTO r VALUES (DEFAULT, 'sala: agregar/quitar productos → prohibido', SQLERRM = 'FORBIDDEN', SQLERRM); END;
    RESET ROLE;
  END;
END $$;

SELECT n, CASE WHEN ok THEN 'OK' ELSE 'FALLA' END AS resultado, prueba, detalle FROM r ORDER BY n;
ROLLBACK;
