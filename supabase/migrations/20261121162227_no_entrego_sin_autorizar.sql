-- «El proveedor no entregó» también se devuelve sin autorización (2026-11-21).
-- Decisión del usuario: cuando la EMPRESA queda mal (Bodega no lo consigue o el
-- proveedor no entrega) la devolución no pasa por administración; cuando el
-- cliente desiste, sí (cláusula 8.4).
--   · El saldo que nace aquí lleva `devolucion_sin_autorizar = 'no_entrego'`,
--     así que si el cliente eligió «otro producto» y después cambia de idea, la
--     sucursal se lo devuelve igual.
--   · Si eligió la devolución, queda devuelta en el acto (igual que
--     `reserva_saldo_devolver`) y pasa a «Devoluciones por entregar»; ya no se
--     avisa a administración para autorizarla.
SET lock_timeout = '5s';
DO $migra$
DECLARE v_def text; v_n integer; v_ancla text;
BEGIN
  v_def := pg_get_functiondef('public.encargo_proveedor_no_entrego(bigint,text,text)'::regprocedure);

  v_ancla := $a$      devolucion_pedida_at, devolucion_pedida_por, devolucion_pedida_motivo)$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_entrego (columnas): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$      devolucion_pedida_at, devolucion_pedida_por, devolucion_pedida_motivo, devolucion_sin_autorizar,
      saldo_favor_inicial, saldo_favor_devuelto_at, saldo_favor_devuelto_por, saldo_favor_devuelto_monto, saldo_favor_devuelto_motivo)$b$);

  v_ancla := $a$      CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END, CASE WHEN v_dev THEN left(v_motivo, 300) END)$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_entrego (valores): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$      CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END, CASE WHEN v_dev THEN left(v_motivo, 300) END,
      'no_entrego',
      CASE WHEN v_dev THEN e.anticipo END, CASE WHEN v_dev THEN now() END, CASE WHEN v_dev THEN v_emp END,
      CASE WHEN v_dev THEN e.anticipo END, CASE WHEN v_dev THEN left(v_motivo, 300) END)$b$);

  -- Ya no se pide autorización: el bloque que avisaba a administración (desde
  -- el nombre del cliente hasta el fin del aviso) pasa a ser el movimiento de la
  -- devolución. Se recorta por posición, entre dos anclas que aparecen una vez.
  v_ancla := $a$  IF v_dev THEN
    SELECT initcap(split_part(name, ' ', 1)) INTO v_cliente$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_entrego (inicio del aviso): aparece % veces.', v_n; END IF;
  v_n := (length(v_def) - length(replace(v_def, $a$    VALUES (v_emp, 'SALDO_DEVOLUCION_PEDIDA'$a$, ''))) / length($a$    VALUES (v_emp, 'SALDO_DEVOLUCION_PEDIDA'$a$);
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_entrego (fin del aviso): aparece % veces.', v_n; END IF;
  v_def := left(v_def, strpos(v_def, v_ancla) - 1)
    || $b$  IF v_dev THEN
    -- (2026-11-21) Sin autorización: queda devuelta y va a «Devoluciones por entregar».
    INSERT INTO public.saldo_favor_movimientos (reserva_id, tipo, monto, saldo_despues, branch_id, employee_id, nota)
    VALUES (v_id, 'devolucion', e.anticipo, 0, e.branch_id, v_emp, left(v_motivo, 300));
    INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
$b$
    || substr(v_def, strpos(v_def, $a$    VALUES (v_emp, 'SALDO_DEVOLUCION_PEDIDA'$a$));

  v_ancla := $a$'Pediste la devolución de lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || '). Te avisamos cuando esté lista para recogerla en la sucursal; mientras tanto queda a tu favor.'$a$;
  v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_entrego (aviso cliente): el fragmento aparece % veces.', v_n; END IF;
  v_def := replace(v_def, v_ancla, $b$'Te devolvemos lo que pagaste ($' || to_char(e.anticipo, 'FM999990.00') || '). Recógelo en la sucursal.'$b$);

  EXECUTE v_def;
END $migra$;
