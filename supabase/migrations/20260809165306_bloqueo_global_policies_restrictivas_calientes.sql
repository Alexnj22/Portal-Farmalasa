SET lock_timeout = '5s';

-- Las cinco tablas calientes, aparte de las 130 frías a propósito: los crons les
-- escriben cada minuto y CREATE POLICY necesita ACCESS EXCLUSIVE — es la causa
-- exacta del outage del 2026-07-08. Con `lock_timeout` esto no congela nada: si
-- hay un sync en vuelo la migración falla y se reintenta, que es preferible a un
-- freeze. Y al ir separadas, un timeout acá no obliga a repetir las otras 130.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_invoices','sales_invoice_items','inventory','products','product_stock_params']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relname=t AND c.relkind='r' AND c.relrowsecurity) THEN
      EXECUTE format('DROP POLICY IF EXISTS bloqueo_global ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY bloqueo_global ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()))',
        t);
    END IF;
  END LOOP;
END
$do$;
