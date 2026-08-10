SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- El paso de fusionar duplicados de la corrida nocturna NUNCA funcionó
-- ══════════════════════════════════════════════════════════════════════════
-- Medido el 2026-08-09 en la primera corrida completa del lazo: 5 fusiones
-- fallidas, todas con `FORBIDDEN`.
--
-- La guarda era `IF NOT auth_can_edit_any(ARRAY['clientes'])`, y esa función
-- resuelve al empleado desde el JWT. El cron invoca la edge function con el
-- secreto de admin y la función usa `service_role`: no hay `auth.uid()`, así
-- que la guarda dice que no. O sea que la mitad de deduplicación del proceso
-- estaba muerta desde que se automatizó — y por eso las fichas sueltas no
-- bajaban solas.
--
-- Es la misma familia de error que el resto de este hilo: una pieza portada a
-- otro contexto donde su premisa —«hay un usuario detrás»— ya no se cumple.
--
-- El patrón del bypass no se inventa acá: es el que ya usan
-- `calculate_stock_params` y compañía desde el baseline.
--
-- Tras aplicarla, la misma corrida: 5 fusionadas, 8 facturas movidas, 0 fallidas.
CREATE OR REPLACE FUNCTION public.fusionar_cliente_duplicado(p_huerfana bigint, p_erp_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_h        public.customers%ROWTYPE;
  v_buena    public.customers%ROWTYPE;
  v_movidas  integer := 0;
BEGIN
  -- `service_role` es el proceso automático: ya es de confianza y no tiene
  -- empleado que resolver. Para cualquier otro, el permiso de siempre.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
     AND NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
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
          CASE WHEN (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role'
               THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END, 'INFO',
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
$function$;

REVOKE EXECUTE ON FUNCTION public.fusionar_cliente_duplicado(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fusionar_cliente_duplicado(bigint, text) TO authenticated, service_role;


-- ── Dos motivos nuevos para «Por revisar» ─────────────────────────────────
-- Las dos familias de fallo que la corrida completa dejó sin destino: contaban
-- como «fallidas» cada noche sin que nadie pudiera hacer nada con ellas.
--   · erp_id_inexistente    — el número no existe en el ERP (ficha vacía)
--   · erp_rechaza_duplicado — el ERP no deja guardar por su control de duplicados
ALTER TABLE public.clientes_por_revisar
  DROP CONSTRAINT IF EXISTS clientes_por_revisar_motivo_check;
ALTER TABLE public.clientes_por_revisar
  ADD CONSTRAINT clientes_por_revisar_motivo_check
  CHECK (motivo = ANY (ARRAY[
    'fiscal_congelado'::text, 'nombre_repetido'::text, 'dui_repetido'::text,
    'nit_repetido'::text, 'fusion_dudosa'::text, 'rechazo_persistente'::text,
    'erp_id_inexistente'::text, 'erp_rechaza_duplicado'::text]));
