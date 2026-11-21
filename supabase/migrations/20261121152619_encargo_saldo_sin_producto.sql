-- Un encargo pagado cuyo producto lo sugirió Bodega (sin `product_id`) no
-- podía pasar a saldo a favor (2026-11-21): la fila del saldo exige producto y
-- la función fallaba entera. Hoy hay un encargo así («pedido», pagado). Se usa
-- el producto sugerido. Reemplazo sobre la definición VIVA.
SET lock_timeout = '5s';
DO $migra$
DECLARE v_def text; v_n integer; c text;
  v_ancla text := $a$VALUES (e.customer_id, e.branch_id, 'sucursal', e.product_id,$a$;
  v_nuevo text := $b$VALUES (e.customer_id, e.branch_id, 'sucursal', coalesce(e.product_id, e.sugerido_product_id),$b$;
BEGIN
  FOREACH c IN ARRAY ARRAY['public.encargo_responder(bigint,text,numeric,date,text)', 'public.encargo_pasar_a_saldo(bigint,text)'] LOOP
    v_def := pg_get_functiondef(c::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
    IF v_n < 1 THEN RAISE EXCEPTION 'En % no aparece el fragmento: no se toca nada.', c; END IF;
    EXECUTE replace(v_def, v_ancla, v_nuevo);
  END LOOP;
END $migra$;
