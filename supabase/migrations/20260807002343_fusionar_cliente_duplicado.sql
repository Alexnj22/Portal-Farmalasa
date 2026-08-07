-- Une la ficha huérfana con la real y borra la huérfana.
--
-- El sync de ventas crea un cliente por cada NOMBRE que no reconoce
-- (`upsert_customers` hace `INSERT INTO customers (name)` y nada más), y el
-- nombre viene de cómo se escribió la factura. Resultado: el mismo cliente
-- queda partido en dos fichas.
--
--   id 3197766  JOSE RAFAEL PEÑA PINEDA    erp 11967  COMALAPA   0 facturas
--   id 1990     JOSE RAFAEL PEÃ±A PINEDA   —          —          7 facturas
--
-- La buena tiene los datos y ninguna factura; la rota tiene el historial y
-- ningún dato. (`PEÃ±A` es «PEÑA» leído como Latin-1.) Medido el 2026-08-06:
-- 1,162 facturas colgando de 75 huérfanas.
--
-- ── Por qué el segundo parámetro es el erp_id y no el id de la buena ──────
-- Para que el llamador NO pueda elegir con qué ficha fusionar. El `erp_id`
-- sale de leer la factura en el ERP (`reimprimir_factura.php` → id_cliente),
-- o sea que el vínculo lo afirma el ERP y no un parecido de nombres. Esta
-- función resuelve la ficha destino ella misma a partir de ese id.
--
-- El llamador (`resolver_observaciones.py --deduplicar`) agrega ADEMÁS un
-- freno propio: si los nombres no se parecen en nada, no llama. El vínculo del
-- ERP es fuerte pero no infalible —una factura pudo emitirse al cliente
-- equivocado— y mezclar dos historiales no se deshace. En la corrida del
-- 2026-08-06 ese freno apartó 4 de 72, incluida una cuya ficha destino se
-- llama literalmente «NO APARECE».
--
-- `customer_activity` NO se mueve: es un rollup derivado con PK por cliente y
-- lo recalcula `refresh_customer_activity()` en su cron de las 06:45 UTC. La
-- fila de la huérfana se va sola por CASCADE.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fusionar_cliente_duplicado(
  p_huerfana bigint,
  p_erp_id   text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_h        public.customers%ROWTYPE;
  v_buena    public.customers%ROWTYPE;
  v_movidas  integer := 0;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_h FROM public.customers WHERE id = p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HUERFANA_NO_EXISTE'; END IF;

  -- Solo se borra una ficha SIN emparejar. Una con erp_id es la buena de
  -- alguien y borrarla sería perder el vínculo, no limpiarlo.
  IF v_h.erp_id IS NOT NULL THEN RAISE EXCEPTION 'HUERFANA_YA_EMPAREJADA'; END IF;
  IF public.es_cliente_mostrador(v_h.name, v_h.erp_id) THEN
    RAISE EXCEPTION 'ES_MOSTRADOR';
  END IF;

  SELECT * INTO v_buena FROM public.customers
   WHERE erp_id = p_erp_id AND id <> p_huerfana FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DESTINO_NO_EXISTE'; END IF;

  -- Las facturas son lo único que hay que preservar. Se mueven ANTES del
  -- delete: la FK de `sales_invoices` es NO ACTION, así que si quedara una
  -- sola el borrado falla y la transacción entera se va atrás.
  UPDATE public.sales_invoices SET customer_id = v_buena.id
   WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_movidas = ROW_COUNT;

  DELETE FROM public.customers WHERE id = p_huerfana;

  INSERT INTO public.audit_logs
    (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('CLIENTE_DUPLICADO_FUSIONADO', p_huerfana::text,
          (SELECT public.auth_employee_id()),
          coalesce((SELECT e.name FROM public.employees e
                     WHERE e.id = (SELECT public.auth_employee_id())), 'Sistema'),
          'ADMIN_PANEL', 'INFO',
          json_build_object(
            'huerfana_id', p_huerfana, 'huerfana_nombre', v_h.name,
            'destino_id', v_buena.id, 'destino_nombre', v_buena.name,
            'erp_id', p_erp_id, 'facturas_movidas', v_movidas));

  RETURN json_build_object(
    'ok', true, 'facturas_movidas', v_movidas,
    'huerfana', json_build_object('id', p_huerfana, 'name', v_h.name),
    'destino',  json_build_object('id', v_buena.id, 'name', v_buena.name,
                                  'erp_id', v_buena.erp_id));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.fusionar_cliente_duplicado(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fusionar_cliente_duplicado(bigint, text) TO authenticated, service_role;
