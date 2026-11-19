-- «Agregar» de una compra pasada repite la cantidad Y la presentación
-- (usuario, 2026-11-19: agregó 50 unidades y la preventa puso 1). Cada
-- producto de las últimas compras trae su `factor`. Parche de la definición VIVA.
SET lock_timeout = '5s';
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.preventa_cliente'::regproc);
  v_ancla text := '''cantidad'', it.cantidad, ''presentacion'', it.presentacion,';
BEGIN
  IF position('''factor'', it.factor_unidades' in v_def) > 0 THEN
    RAISE NOTICE 'preventa_cliente ya devuelve el factor';
    RETURN;
  END IF;
  IF position(v_ancla in v_def) = 0 THEN
    RAISE EXCEPTION 'preventa_cliente cambió: no encuentro el ancla de la cantidad';
  END IF;
  EXECUTE replace(v_def, v_ancla, v_ancla || ' ''factor'', it.factor_unidades,');
END $$;
