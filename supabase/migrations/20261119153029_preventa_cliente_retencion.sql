-- Vender muestra el IVA y la retención del crédito fiscal antes de enviar
-- (usuario, 2026-11-19): `preventa_cliente` devuelve además el % de
-- retención del cliente. Se parcha la definición VIVA (no un borrador).
SET lock_timeout = '5s';
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.preventa_cliente'::regproc);
  v_ancla text := '''credito'', public.preventa_credito_del_cliente(c.id)';
BEGIN
  IF position('''retencion_pct''' in v_def) > 0 THEN
    RAISE NOTICE 'preventa_cliente ya devuelve retencion_pct';
    RETURN;
  END IF;
  IF position(v_ancla in v_def) = 0 THEN
    RAISE EXCEPTION 'preventa_cliente cambió: no encuentro el ancla del crédito';
  END IF;
  EXECUTE replace(v_def, v_ancla, '''retencion_pct'', c.retencion_pct, ' || v_ancla);
END $$;
