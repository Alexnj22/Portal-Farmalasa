-- COF emitido de las 6 pm en adelante: NO se envía a Hacienda (2026-10-19).
--
-- Decisión del usuario, para todas las sucursales: «después de las 6 pm todo
-- COF no se enviará a MH», el portal no lo manda nunca, no cuenta como
-- pendiente en Facturación ni dispara avisos, y se lleva evidencia (cuántos y
-- cuánto). Los CCF NO entran: ésos se siguen mandando, y se reintentan solos.
--
-- La regla vive en UNA función y la usan todos los que preguntan «¿falta
-- mandarla?»: el envío (`regularizar-dte`, que la escribe en PostgREST con el
-- MISMO corte), la cola Pendiente MH, el aviso de ventas seguidas sin sello y
-- el vigilante de la mañana. Escrita en cada sitio, alcanza con que uno se
-- olvide para que la cola diga una cosa y el envío haga otra.
--
-- Rige desde el 2026-10-19: lo de antes se queda como estaba.
--
-- ⚠️ Consecuencia fiscal que hay que tener presente: un COF sin sello NO entra
-- al libro de ventas (`venta_fiscal` exige el sello). Estos documentos quedan
-- fuera del libro y aparecen en «ventas fuera del libro».
--
-- Sin `SET search_path` a propósito, como `venta_valida`: así se inlinea y el
-- planificador sigue viendo las columnas.

-- venta-a-mano: la cola Pendiente MH y el vigilante del envío se copian de su
-- definición viva y preguntan «¿está anulada?» (circuito de Hacienda), no
-- «¿cuenta como venta?»; su `estado NOT IN (...)` se conserva tal cual.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cof_no_se_envia_mh(p_tipo text, p_fecha date, p_hora time)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT coalesce(p_tipo = 'COF' AND p_fecha >= DATE '2026-10-19' AND p_hora >= TIME '18:00', false) $$;

COMMENT ON FUNCTION public.cof_no_se_envia_mh(text, date, time) IS
  'COF emitido desde las 18:00 (a partir del 2026-10-19): no se envia a Hacienda, no es pendiente ni dispara avisos. Gemela en regularizar-dte (COF_SIN_ENVIO).';

REVOKE EXECUTE ON FUNCTION public.cof_no_se_envia_mh(text, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cof_no_se_envia_mh(text, date, time) TO authenticated, service_role;

-- ── Cola Pendiente MH ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_pending_mh_invoices(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('facturacion','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para ver Facturación';
  END IF;

  -- `RETURNS json` + `json_agg` (Patrón C de CLAUDE.md): el tope de 1000 filas
  -- de PostgREST no aplica a un único valor JSON, así que la cola entera viaja
  -- en un viaje y sin bucle de `.range()`. `json_agg`, NUNCA `jsonb_agg` —
  -- jsonb arma el binario completo en memoria y spillea a disco.
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    SELECT si.id, si.branch_id, si.tipo_documento, si.correlativo,
           si.erp_invoice_id, si.cliente, si.fecha, si.hora, si.total,
           si.estado, si.recibido_mh, si.tipo_pago,
           c.categoria AS cliente_categoria
    FROM public.sales_invoices si
    LEFT JOIN public.customers c ON c.id = si.customer_id
    -- Un sello son 40 caracteres. `IS NOT NULL` daba por buena la cadena
    -- 'undefined' y por eso una factura del 16-may-2025 figuró un año como
    -- confirmada; ésta es la misma definición que usa el barrido nocturno.
    WHERE length(si.recibido_mh) IS DISTINCT FROM 40
    -- `<>`/`NOT IN` y no `IS DISTINCT FROM`: con `estado` en NULL la comparación
    -- da NULL y la fila queda afuera, que es lo que hacía el filtro del
    -- navegador. Esas facturas no se pierden — son de la pestaña de
    -- anuladas/estado nulo. Una DESAPARECIDA ya no existe en el origen: no hay
    -- nada que transmitir, y vive en Saltos.
      AND si.estado NOT IN ('NULA', 'DESAPARECIDA EN ORIGEN')
    -- COF de las 6 pm en adelante: no se manda, así que no está pendiente
    -- (2026-10-19). Su evidencia es `get_cof_sin_envio_mh`.
      AND NOT public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.branch_id, si.fecha, si.hora
  ) t;

  RETURN v;
END;
$function$;

-- ── Aviso «N ventas seguidas sin sello» ─────────────────────────────────────
-- Los COF de la noche salen de la secuencia y no cuentan ni para un lado ni
-- para el otro: tres CCF sin sello seguidos siguen avisando aunque haya COF
-- de la noche en el medio.
CREATE OR REPLACE FUNCTION public.get_consecutive_mh_alerts()
 RETURNS TABLE(branch_id bigint, branch_name text, first_correlativo text, run_len bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH today_date AS (
    SELECT (current_timestamp AT TIME ZONE 'America/El_Salvador')::date AS d
  ),
  sales AS (
    SELECT
      si.branch_id,
      si.correlativo,
      CASE
        WHEN (si.recibido_mh IS NULL OR si.recibido_mh = 'undefined')
             AND si.estado != 'NULA'
        THEN 1 ELSE 0
      END AS is_pending,
      ROW_NUMBER() OVER (PARTITION BY si.branch_id ORDER BY si.fecha, si.hora, si.id) AS rn
    FROM sales_invoices si
    CROSS JOIN today_date t
    WHERE si.fecha = t.d
      AND NOT public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)
  ),
  with_island AS (
    SELECT *,
      rn - ROW_NUMBER() OVER (PARTITION BY branch_id, is_pending ORDER BY rn) AS island
    FROM sales
  ),
  runs AS (
    SELECT branch_id, is_pending, island,
      COUNT(*)        AS run_len,
      MIN(correlativo) AS first_corr
    FROM with_island
    GROUP BY branch_id, is_pending, island
  ),
  -- Tomar la primera corrida ≥3 por sucursal (cronológicamente)
  alerting AS (
    SELECT DISTINCT ON (r.branch_id)
      r.branch_id, r.first_corr, r.run_len
    FROM runs r
    WHERE r.is_pending = 1 AND r.run_len >= 3
    ORDER BY r.branch_id, r.island
  )
  SELECT a.branch_id, b.name AS branch_name, a.first_corr AS first_correlativo, a.run_len
  FROM alerting a
  JOIN branches b ON b.id = a.branch_id
  WHERE NOT EXISTS (
    SELECT 1 FROM sales_alert_log l
    WHERE l.branch_id  = a.branch_id
      AND l.alert_type = 'consecutive_mh'
      AND l.alert_key  = a.first_corr
  );
$function$;

-- ── Vigilante de la mañana ──────────────────────────────────────────────────
-- Dos cambios: (1) mira SÓLO la corrida nocturna (`target_id = 'todas'`): el
-- reintento de CCF cada 10 minutos también escribe `DTE_REGULARIZADO` y no
-- puede pasar por la de las 22:30; (2) «esperando» no cuenta los COF de la
-- noche, que no esperan nada.
CREATE OR REPLACE FUNCTION public.alertar_barrido_dte()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corrida    public.audit_logs%ROWTYPE;
    v_hubo       boolean;
    v_fallidas   int;
    v_resueltas  int;
    v_restantes  int;
    v_esperando  int;
    v_dest       uuid[];
    v_titulo     text;
    v_cuerpo     text;
    v_facturas   jsonb;
BEGIN
    SELECT * INTO v_corrida
      FROM public.audit_logs
     WHERE action = 'DTE_REGULARIZADO'
       AND source = 'SYSTEM'
       AND target_id = 'todas'
       AND created_at >= now() - interval '12 hours'
     ORDER BY created_at DESC
     LIMIT 1;

    v_hubo := FOUND;

    IF v_hubo THEN
        v_fallidas  := coalesce((v_corrida.details->>'fallidas')::int, 0);
        v_resueltas := coalesce((v_corrida.details->>'resueltas')::int, 0);
        v_restantes := coalesce((v_corrida.details->>'restantes')::int, 0);
        IF v_fallidas = 0 THEN RETURN; END IF;
    END IF;

    SELECT array_agg(e.id) INTO v_dest
      FROM public.employees e
      JOIN public.roles r ON r.name = 'Sistema — Alertas Técnicas'
     WHERE e.status = 'ACTIVO'
       AND (e.role_id = r.id OR e.secondary_role_id = r.id);

    IF v_dest IS NULL OR array_length(v_dest, 1) IS NULL THEN
        INSERT INTO public.audit_logs (action, target_id, user_name, source, severity, details)
        VALUES ('ALERTA_BARRIDO_DTE_SIN_DESTINATARIOS', 'regularizar-dte',
                'Vigilante', 'SYSTEM', 'CRITICAL',
                jsonb_build_object('motivo', 'nadie tiene el rol Sistema — Alertas Técnicas'));
        RETURN;
    END IF;

    IF NOT v_hubo THEN
        -- Las dos bolsas del barrido, contadas con su mismo criterio: anulada
        -- CON sello (hay algo que invalidar ante Hacienda) y no anulada SIN
        -- sello válido. El sello es texto de 40 caracteres, así que se compara
        -- por forma y no por «tiene algo» — ver la regla del tipo en CLAUDE.md.
        SELECT count(*) INTO v_esperando
          FROM public.sales_invoices
         WHERE (estado = 'NULA' AND recibido_mh LIKE repeat('_', 40))
            OR (estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
                AND (recibido_mh IS NULL OR recibido_mh NOT LIKE repeat('_', 40))
                AND NOT public.cof_no_se_envia_mh(tipo_documento, fecha, hora));

        v_titulo := 'El envío a Hacienda no corrió anoche';
        v_cuerpo := 'No quedó registro del envío de las ' || public.hora_12('22:30'::time) || '. '
                 || CASE
                      WHEN v_esperando = 0
                        THEN 'Ahora mismo no hay ninguna factura esperando, '
                             || 'pero tiene que volver a correr antes de que entre la próxima. '
                      WHEN v_esperando = 1
                        THEN 'Hay 1 factura esperando y no se va a mandar hasta que vuelva a correr. '
                      ELSE 'Hay ' || v_esperando
                             || ' facturas esperando y no se van a mandar hasta que vuelva a correr. '
                    END
                 || 'Hay que revisar el envío automático de las ' || public.hora_12('22:30'::time) || '.';
    ELSE
        v_titulo := CASE WHEN v_fallidas = 1 THEN 'Una factura no entró a Hacienda anoche'
                         ELSE v_fallidas || ' facturas no entraron a Hacienda anoche' END;

        -- Cuáles son, para la tarjeta (24-sep): la venta —sala, documento,
        -- fecha, cliente, monto— y lo que dijo Hacienda. Hasta 5.
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'sala',    b.name,
                   'doc',     CASE WHEN x->>'correlativo' LIKE '%\_CCF' THEN 'Crédito fiscal' ELSE 'Consumidor final' END,
                   'fecha',   si.fecha,
                   'cliente', nullif(btrim(si.cliente), ''),
                   'monto',   si.total,
                   'motivo',  coalesce(x->'observaciones'->>0,
                                       regexp_replace(coalesce(x->>'error', ''), '^.*— ', ''))))
                 ORDER BY b.name)
          INTO v_facturas
          FROM (SELECT x FROM jsonb_array_elements(coalesce(v_corrida.details->'detalle', '[]'::jsonb)) x
                 WHERE (x->>'ok')::boolean IS NOT TRUE LIMIT 5) f
          LEFT JOIN public.sales_invoices si ON si.id = nullif(x->>'invoice_id', '')::bigint
          LEFT JOIN public.branches b ON b.id = nullif(x->>'branch_id', '')::integer;
        v_cuerpo := v_fallidas || ' factura' || CASE WHEN v_fallidas = 1 THEN '' ELSE 's' END
                 || ' no se pudo completar ante Hacienda'
                 || CASE WHEN v_resueltas > 0 THEN ', ' || v_resueltas || ' sí' ELSE '' END
                 || '. ' || CASE WHEN v_restantes > 0
                                 THEN 'Quedan ' || v_restantes || ' en cola. ' ELSE '' END
                 || 'Las que ya no se arreglan solas están en Facturación, en Observaciones.';
    END IF;

    PERFORM public.notify_employees(
        v_dest, 'SYSTEM', v_titulo, v_cuerpo, '/facturacion?tab=observaciones',
        jsonb_strip_nulls(jsonb_build_object('origen', 'regularizar-dte',
                           'corrida', v_corrida.id,
                           'fallidas', v_fallidas,
                           'esperando', v_esperando,
                           -- La tarjeta de la campana (24-sep).
                           'hacienda', jsonb_strip_nulls(jsonb_build_object(
                               'corrio',    v_hubo,
                               'fallidas',  v_fallidas,
                               'resueltas', v_resueltas,
                               'restantes', v_restantes,
                               'esperando', v_esperando,
                               'facturas',  v_facturas)))),
        true, NULL
    );
END;
$function$;

-- ── La evidencia: cuántos COF de la noche quedaron sin enviar y cuánto suman ─
-- Por día y sucursal, con el detalle documento por documento si se pide.
-- `RETURNS json` (Patrón C): un mes son miles de documentos y el tope de 1000
-- filas no puede recortar la evidencia sin avisar. Se cuentan sólo las ventas
-- válidas (`venta_valida`): un COF anulado no es una venta sin enviar.
CREATE OR REPLACE FUNCTION public.get_cof_sin_envio_mh(
  p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL, p_detalle boolean DEFAULT false)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('facturacion','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: sin permiso para ver Facturación';
  END IF;

  WITH docs AS (
    SELECT si.id, si.branch_id, b.name AS sucursal, si.fecha, si.hora, si.correlativo,
           si.cliente, si.subtotal, si.iva, si.total,
           length(si.recibido_mh) = 40 AS con_sello
      FROM public.sales_invoices si
      JOIN public.branches b ON b.id = si.branch_id
     WHERE si.tipo_documento = 'COF'
       AND si.fecha BETWEEN greatest(p_desde, DATE '2026-10-19') AND p_hasta
       AND si.hora >= TIME '18:00'
       AND public.cof_no_se_envia_mh(si.tipo_documento, si.fecha, si.hora)
       AND public.venta_valida(si.estado)
       AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
  )
  SELECT json_build_object(
    'total', (SELECT json_build_object(
                'documentos', count(*),
                'sin_sello',  count(*) FILTER (WHERE NOT coalesce(con_sello, false)),
                'subtotal',   round(coalesce(sum(subtotal), 0), 2),
                'iva',        round(coalesce(sum(iva), 0), 2),
                'monto',      round(coalesce(sum(total), 0), 2)) FROM docs),
    'por_dia', (SELECT coalesce(json_agg(to_json(r) ORDER BY r.fecha DESC, r.sucursal), '[]'::json) FROM (
                  SELECT fecha, branch_id, sucursal,
                         count(*) AS documentos,
                         count(*) FILTER (WHERE NOT coalesce(con_sello, false)) AS sin_sello,
                         round(sum(subtotal), 2) AS subtotal,
                         round(sum(iva), 2) AS iva,
                         round(sum(total), 2) AS monto,
                         min(hora) AS primera, max(hora) AS ultima
                    FROM docs GROUP BY fecha, branch_id, sucursal) r),
    'detalle', CASE WHEN p_detalle THEN
                 (SELECT coalesce(json_agg(to_json(d) ORDER BY d.fecha DESC, d.sucursal, d.hora), '[]'::json) FROM docs d)
               END
  ) INTO v;
  RETURN v;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cof_sin_envio_mh(date, date, bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cof_sin_envio_mh(date, date, bigint, boolean) TO authenticated, service_role;
