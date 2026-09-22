-- E2 · Fusionar dos fichas del mismo cliente mueve TODO lo que cuelga de la
-- huérfana, no sólo sus facturas.
--
-- `fusionar_cliente_duplicado` movía `sales_invoices` y borraba la ficha. De las
-- 16 claves foráneas que apuntan a `customers`, eso deja tres comportamientos
-- distintos y ninguno estaba contemplado:
--   · créditos, pagos y puntos FRENAN el borrado (NO ACTION / RESTRICT) — por
--     eso la corrida nocturna falla desde el 17-sep con
--     `creditos_de_clientes_customer_id_fkey`, y NINGUNA fusión entra;
--   · `cotizaciones`, `bitacora_dispensaciones` y `clientes_por_revisar` quedan
--     en NULL — la dispensación pierde a quién se le entregó;
--   · `consentimientos_cliente`, `dte_datos_pedidos`, `customer_activity`,
--     `customers_changelog`, `espejo_conflictos`, `clientes_sin_producto` y
--     `puntos_codigo_acceso` se BORRAN en cascada. El consentimiento de
--     protección de datos es el peor: se firma una vez y no se recupera.
--
-- Medido el 2026-09-22 sobre las 28 fichas sueltas: 12 con facturas, 2 con
-- créditos, 1 con pagos, y ninguna con puntos, bitácora ni consentimientos. O
-- sea que hoy el freno son los créditos — pero lo demás cuelga igual y la
-- próxima vez puede ser una dispensación.
--
-- Qué hace ahora:
--   1. **Si la huérfana tiene PUNTOS, no fusiona**: lanza `TIENE_PUNTOS` y quien
--      la llama la manda a «Por revisar». Los puntos son saldo de una persona y
--      `puntos_cuenta` es una fila por cliente: moverla chocaría con la cuenta
--      de la ficha buena, y sumar dos saldos no lo decide un proceso de noche.
--   2. Mueve todo lo que tiene historia propia.
--   3. Lo que sólo admite UNA fila por cliente (actividad, código de puntos, la
--      marca de «sin producto») se mueve únicamente si la buena no tiene la
--      suya; si ya tiene, la de la huérfana se va con el borrado, que es lo
--      correcto: es dato derivado, no historia.
--   4. Devuelve y registra CUÁNTO movió de cada cosa. Un «ok» sin números no
--      permite notar que algo dejó de moverse.
--
-- Probado con rollback sobre el caso real que falla desde el 17-sep: movió
-- 1 crédito y 1 factura, y borró la ficha sin que la FK la frenara.
SET lock_timeout = '5s';

-- Motivo nuevo para la ficha que no se puede fusionar por tener puntos.
ALTER TABLE public.clientes_por_revisar DROP CONSTRAINT clientes_por_revisar_motivo_check;
ALTER TABLE public.clientes_por_revisar ADD CONSTRAINT clientes_por_revisar_motivo_check
  CHECK (motivo = ANY (ARRAY['fiscal_congelado','nombre_repetido','dui_repetido','nit_repetido',
                             'fusion_dudosa','rechazo_persistente','erp_id_inexistente',
                             'erp_rechaza_duplicado','sin_numero_erp','fusion_con_puntos']));

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
  v_mov      jsonb   := '{}'::jsonb;
  v_n        integer;
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

  -- Los puntos son saldo de una persona: no se mezclan de noche. Ver encabezado.
  IF EXISTS (SELECT 1 FROM public.puntos_cuenta  WHERE customer_id = p_huerfana)
     OR EXISTS (SELECT 1 FROM public.puntos_lote   WHERE customer_id = p_huerfana)
     OR EXISTS (SELECT 1 FROM public.puntos_salida WHERE customer_id = p_huerfana) THEN
    RAISE EXCEPTION 'TIENE_PUNTOS';
  END IF;

  -- ── Lo que tiene historia propia: se mueve entero ────────────────────────
  UPDATE public.sales_invoices SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_movidas = ROW_COUNT;
  v_mov := v_mov || jsonb_build_object('facturas', v_movidas);

  UPDATE public.creditos_de_clientes SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('creditos', v_n);

  UPDATE public.creditos_pagos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pagos', v_n);

  UPDATE public.bitacora_dispensaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('dispensaciones', v_n);

  UPDATE public.consentimientos_cliente SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('consentimientos', v_n);

  UPDATE public.cotizaciones SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('cotizaciones', v_n);

  UPDATE public.customers_changelog SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('cambios', v_n);

  UPDATE public.espejo_conflictos SET customer_id = v_buena.id WHERE customer_id = p_huerfana;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('conflictos', v_n);

  -- Pedido de dato para un DTE: la llave viva es (cliente, campo) mientras está
  -- PENDIENTE. Se mueve lo que no choca; lo que choca es el MISMO pedido hecho
  -- dos veces y se va con el borrado.
  UPDATE public.dte_datos_pedidos d SET customer_id = v_buena.id
   WHERE d.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.dte_datos_pedidos o
                      WHERE o.customer_id = v_buena.id AND o.campo = d.campo
                        AND o.estado = 'PENDIENTE' AND d.estado = 'PENDIENTE');
  GET DIAGNOSTICS v_n = ROW_COUNT; v_mov := v_mov || jsonb_build_object('pedidos_dte', v_n);

  -- ── Una fila por cliente: sólo si la buena no tiene la suya ──────────────
  UPDATE public.customer_activity a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.customer_activity b WHERE b.customer_id = v_buena.id);

  UPDATE public.clientes_sin_producto a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.clientes_sin_producto b WHERE b.customer_id = v_buena.id);

  UPDATE public.puntos_codigo_acceso a SET customer_id = v_buena.id
   WHERE a.customer_id = p_huerfana
     AND NOT EXISTS (SELECT 1 FROM public.puntos_codigo_acceso b WHERE b.customer_id = v_buena.id);

  -- La revisión que hablaba de ESTA ficha suelta queda resuelta al fusionarla.
  -- Las que traen número se mueven: siguen siendo sobre un cliente que existe.
  DELETE FROM public.clientes_por_revisar
   WHERE customer_id = p_huerfana AND erp_id IS NULL;
  UPDATE public.clientes_por_revisar SET customer_id = v_buena.id
   WHERE customer_id = p_huerfana;

  DELETE FROM public.customers WHERE id = p_huerfana;

  INSERT INTO public.audit_logs
    (action, target_id, user_id, user_name, source, severity, details)
  VALUES ('CLIENTE_DUPLICADO_FUSIONADO', p_huerfana::text,
          (SELECT public.auth_employee_id()),
          coalesce((SELECT e.name FROM public.employees e
                     WHERE e.id = (SELECT public.auth_employee_id())), 'Sistema'),
          CASE WHEN (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role'
               THEN 'SYSTEM' ELSE 'ADMIN_PANEL' END, 'INFO',
          jsonb_build_object(
            'huerfana_id', p_huerfana, 'huerfana_nombre', v_h.name,
            'destino_id', v_buena.id, 'destino_nombre', v_buena.name,
            'erp_id', p_erp_id, 'facturas_movidas', v_movidas,
            'movido', v_mov));

  RETURN json_build_object(
    'ok', true, 'facturas_movidas', v_movidas, 'movido', v_mov,
    'huerfana', json_build_object('id', p_huerfana, 'name', v_h.name),
    'destino',  json_build_object('id', v_buena.id, 'name', v_buena.name,
                                  'erp_id', v_buena.erp_id));
END;
$function$;
