SET lock_timeout = '5s';
-- Cuadre mensual de antibióticos (pedido del usuario, 2026-10-28): cada mes,
-- en cada sala y en la Bodega, un conteo «Bajo receta» y la hoja que explica
-- sus diferencias. RTS 6.4.2 / Guía de BPAD 3.3 (registro trazable de TODOS
-- los antibióticos) y 3.4 (existencia física igual al registro). La norma no
-- fija la frecuencia; la mensual es decisión de la empresa.
--
-- ── La hoja de movimientos ─────────────────────────────────────────────────
-- Por producto: saldo inicial, compras, traslados recibidos, ventas, «otros» y
-- saldo final. Los saldos salen de la foto diaria de existencias
-- (`inventory_daily`, que se toma al cierre del día: la foto del día 1 ya
-- incluye las ventas del día 1, medido el 2026-10-28 en Salud 3, 0 de
-- diferencia en 20 de 24 productos). Por eso el saldo inicial es la foto del
-- ÚLTIMO día del mes anterior y los movimientos van desde el día 1.
--
-- «Otros» es lo que el sistema movió y el portal no ve por renglón: traslados
-- ENVIADOS (el renglón de traslado sólo trae el destino), ajustes y bajas. Se
-- DESPEJA (final − inicial − entradas + ventas) en vez de inventarse: en la
-- Bodega, que despacha a las salas, es la columna grande, y está bien que lo sea.
--
-- Las unidades son las de la foto: venta × `factor_unidades`, traslado ×
-- `unidad`. Una fila sin foto es 0, no «sin dato»: la foto sólo guarda lo que
-- hay.

CREATE FUNCTION public.get_cuadre_antibioticos_mes(p_branch_id bigint, p_periodo text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
    v_ini date; v_fin date; v_snap_ini date; v_snap_fin date;
    v_erp int[]; v_ids int[]; v_conteo record; v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');
    IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Periodo invalido: se espera YYYY-MM.' USING ERRCODE = 'P0001';
    END IF;

    v_ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
    v_fin := least((v_ini + interval '1 month - 1 day')::date, public.bitacora_hoy_sv());
    SELECT array_agg(m.erp_sucursal_id) INTO v_erp FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
    v_ids := public.antibioticos_del_cuadre();

    SELECT max(d.fecha) INTO v_snap_ini FROM public.inventory_daily d
     WHERE d.erp_sucursal_id = ANY(v_erp) AND d.fecha <= v_ini - 1 AND d.fecha >= v_ini - 7;
    SELECT max(d.fecha) INTO v_snap_fin FROM public.inventory_daily d
     WHERE d.erp_sucursal_id = ANY(v_erp) AND d.fecha BETWEEN v_ini AND v_fin;

    -- El conteo del mes: el último terminado; si no hay, el último empezado.
    SELECT c.id, c.status, c.created_at, c.finalizado_at, c.total_items, c.total_contados, c.total_diferencias
      INTO v_conteo
      FROM public.conteos_inventario c
     WHERE c.branch_id = p_branch_id AND c.scope_type = 'BAJO_RECETA'
       AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date BETWEEN v_ini AND (v_ini + interval '1 month - 1 day')::date
     ORDER BY (c.status IN ('FINALIZADO', 'CERRADO')) DESC, c.created_at DESC
     LIMIT 1;

    WITH ini AS (
        SELECT d.erp_product_id AS pid, sum(d.unidades) AS u FROM public.inventory_daily d
         WHERE d.erp_sucursal_id = ANY(v_erp) AND d.fecha = v_snap_ini AND d.erp_product_id = ANY(v_ids) GROUP BY 1
    ), fin AS (
        SELECT d.erp_product_id AS pid, sum(d.unidades) AS u FROM public.inventory_daily d
         WHERE d.erp_sucursal_id = ANY(v_erp) AND d.fecha = v_snap_fin AND d.erp_product_id = ANY(v_ids) GROUP BY 1
    ), com AS (
        SELECT it.erp_product_id AS pid, sum(it.cantidad) AS u
          FROM public.purchase_receipt_items it JOIN public.purchase_receipts r ON r.id = it.receipt_id
         WHERE r.branch_id = p_branch_id AND r.fecha BETWEEN v_ini AND v_snap_fin
           AND r.estado IS DISTINCT FROM 'anulada' AND it.erp_product_id = ANY(v_ids) GROUP BY 1
    ), rec AS (
        SELECT t.erp_product_id AS pid, sum(t.cantidad * coalesce(t.unidad, 1)) AS u
          FROM public.traslados_erp_linea t
         WHERE t.erp_sucursal_destino = ANY(v_erp) AND t.fecha BETWEEN v_ini AND v_snap_fin
           AND t.erp_product_id = ANY(v_ids) GROUP BY 1
    ), ven AS (
        SELECT ii.erp_product_id AS pid, sum(ii.cantidad * coalesce(ii.factor_unidades, 1)) AS u
          FROM public.sales_invoice_items ii JOIN public.sales_invoices si ON si.id = ii.invoice_id
         WHERE si.branch_id = p_branch_id AND si.fecha BETWEEN v_ini AND v_snap_fin
           AND public.venta_valida(si.estado) AND ii.erp_product_id = ANY(v_ids) GROUP BY 1
    ), cnt AS (
        SELECT ci.erp_product_id AS pid, sum(ci.sistema_cantidad) AS sistema, sum(ci.fisico_cantidad) AS fisico,
               sum(ci.diferencia) AS diferencia, count(*) FILTER (WHERE ci.fisico_cantidad IS NULL) AS sin_contar
          FROM public.conteo_inventario_items ci WHERE ci.conteo_id = v_conteo.id GROUP BY 1
    ), filas AS (
        SELECT p.id AS product_id, p.nombre AS producto,
               coalesce(public.va_al_libro((SELECT dc.clase FROM public.dispensacion_clases dc WHERE dc.erp_product_id = p.id), p.es_antibiotico), false) AS en_el_libro,
               CASE WHEN v_snap_ini IS NULL THEN NULL ELSE coalesce(ini.u, 0) END AS inicial,
               coalesce(com.u, 0) AS compras, coalesce(rec.u, 0) AS recibidos, coalesce(ven.u, 0) AS ventas,
               CASE WHEN v_snap_ini IS NULL OR v_snap_fin IS NULL THEN NULL
                    ELSE coalesce(fin.u, 0) - coalesce(ini.u, 0) - coalesce(com.u, 0) - coalesce(rec.u, 0) + coalesce(ven.u, 0) END AS otros,
               CASE WHEN v_snap_fin IS NULL THEN NULL ELSE coalesce(fin.u, 0) END AS final,
               cnt.sistema AS conteo_sistema, cnt.fisico AS conteo_fisico, cnt.diferencia AS conteo_diferencia,
               cnt.sin_contar AS conteo_sin_contar
          FROM public.products p
          LEFT JOIN ini ON ini.pid = p.id LEFT JOIN fin ON fin.pid = p.id LEFT JOIN com ON com.pid = p.id
          LEFT JOIN rec ON rec.pid = p.id LEFT JOIN ven ON ven.pid = p.id LEFT JOIN cnt ON cnt.pid = p.id
         WHERE p.id = ANY(v_ids)
           AND (ini.pid IS NOT NULL OR fin.pid IS NOT NULL OR com.pid IS NOT NULL OR rec.pid IS NOT NULL
                OR ven.pid IS NOT NULL OR cnt.pid IS NOT NULL)
    )
    SELECT json_build_object(
        'periodo', p_periodo, 'branch_id', p_branch_id,
        'desde', v_ini, 'hasta', v_snap_fin,
        'saldo_inicial_del', v_snap_ini,
        'sin_saldo_inicial', v_snap_ini IS NULL,
        'conteo', CASE WHEN v_conteo.id IS NULL THEN NULL ELSE json_build_object(
            'id', v_conteo.id, 'status', v_conteo.status, 'creado', v_conteo.created_at,
            'finalizado', v_conteo.finalizado_at, 'productos', v_conteo.total_items,
            'contados', v_conteo.total_contados, 'diferencias', v_conteo.total_diferencias) END,
        'filas', (SELECT coalesce(json_agg(to_json(f) ORDER BY f.producto), '[]'::json) FROM filas f)
    ) INTO v_out;
    RETURN v_out;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_cuadre_antibioticos_mes(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cuadre_antibioticos_mes(bigint, text) TO authenticated, service_role;

-- ── El aviso ───────────────────────────────────────────────────────────────
-- Cada día a las 7:00 SV, y un solo aviso por sala y mes de cada clase:
--   · desde el día 20, si la sala todavía no terminó su conteo del mes →
--     a la gente de la sala y al regente;
--   · el día 1 y siguientes, si el mes ANTERIOR quedó sin conteo terminado →
--     a supervisión (Gerente General, Supervisor/a de Ventas) y al regente.
-- Salas de venta y Bodega; la sede administrativa no tiene existencias.
CREATE FUNCTION public.avisar_cuadre_antibioticos(p_hoy date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_mes  text[] := ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                           'agosto','septiembre','octubre','noviembre','diciembre'];
    v_n integer := 0; v_k integer;
    v_este date := date_trunc('month', p_hoy)::date;
    v_prev date := (date_trunc('month', p_hoy) - interval '1 month')::date;
BEGIN
    -- Recordatorio del mes en curso.
    IF extract(day FROM p_hoy) >= 20 THEN
        WITH casos AS (
            SELECT b.id AS branch_id, b.name AS sala, (b.settings->'legal'->>'regentEmployeeId') AS regente
              FROM public.branches b
             WHERE b.type IN ('FARMACIA', 'BODEGA')
               AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                                WHERE c.branch_id = b.id AND c.scope_type = 'BAJO_RECETA'
                                  AND c.status IN ('FINALIZADO', 'CERRADO')
                                  AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_este)
        ), destinatarios AS (
            SELECT c.branch_id, e.id AS employee_id FROM casos c
              JOIN public.employees e ON e.branch_id = c.branch_id
             WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
            UNION
            SELECT c.branch_id, e.id FROM casos c JOIN public.employees e ON e.id::text = c.regente
             WHERE e.status = 'ACTIVO'
        ), ins AS (
            INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
            SELECT d.employee_id, 'CUADRE_ANTIBIOTICOS',
                   c.sala || ': falta el conteo de antibióticos de ' || v_mes[extract(month FROM p_hoy)::int],
                   'Cada mes se cuentan todos los antibióticos de la sala y se cuadran contra el sistema. '
                     || 'En Conteo de inventario, «Nuevo conteo» → «Bajo receta». Hay tiempo hasta fin de mes.',
                   '/conteo-inventario',
                   jsonb_build_object('periodo', to_char(v_este, 'YYYY-MM'), 'sala', c.sala, 'clase', 'recordatorio'),
                   c.branch_id
              FROM destinatarios d JOIN casos c ON c.branch_id = d.branch_id
             WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                                WHERE a.recipient_id = d.employee_id
                                  AND a.clave = 'CUADRE_ABX:' || c.branch_id || ':' || to_char(v_este, 'YYYY-MM') || ':recordatorio')
            RETURNING recipient_id, branch_id
        ), marca AS (
            INSERT INTO public.avisos_emitidos (clave, recipient_id)
            SELECT 'CUADRE_ABX:' || i.branch_id || ':' || to_char(v_este, 'YYYY-MM') || ':recordatorio', i.recipient_id FROM ins i
            ON CONFLICT DO NOTHING RETURNING 1
        )
        SELECT count(*) INTO v_k FROM ins;
        v_n := v_n + v_k;
    END IF;

    -- El mes anterior que quedó sin conteo.
    WITH casos AS (
        SELECT b.id AS branch_id, b.name AS sala, (b.settings->'legal'->>'regentEmployeeId') AS regente
          FROM public.branches b
         WHERE b.type IN ('FARMACIA', 'BODEGA')
           AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                            WHERE c.branch_id = b.id AND c.scope_type = 'BAJO_RECETA'
                              AND c.status IN ('FINALIZADO', 'CERRADO')
                              AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_prev
                              AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date < v_este)
    ), destinatarios AS (
        SELECT c.branch_id, e.id AS employee_id FROM casos c
          CROSS JOIN public.employees e
          JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
         WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
           AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
        UNION
        SELECT c.branch_id, e.id FROM casos c JOIN public.employees e ON e.id::text = c.regente
         WHERE e.status = 'ACTIVO'
    ), ins AS (
        INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id)
        SELECT d.employee_id, 'CUADRE_ANTIBIOTICOS',
               c.sala || ': ' || v_mes[extract(month FROM v_prev)::int] || ' quedó sin conteo de antibióticos',
               'No se terminó el conteo «Bajo receta» de ' || v_mes[extract(month FROM v_prev)::int]
                 || '. La existencia de antibióticos de ese mes no quedó cuadrada contra el sistema.',
               '/bitacoras',
               jsonb_build_object('periodo', to_char(v_prev, 'YYYY-MM'), 'sala', c.sala, 'clase', 'vencido'),
               c.branch_id
          FROM destinatarios d JOIN casos c ON c.branch_id = d.branch_id
         WHERE NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                            WHERE a.recipient_id = d.employee_id
                              AND a.clave = 'CUADRE_ABX:' || c.branch_id || ':' || to_char(v_prev, 'YYYY-MM') || ':vencido')
        RETURNING recipient_id, branch_id
    ), marca AS (
        INSERT INTO public.avisos_emitidos (clave, recipient_id)
        SELECT 'CUADRE_ABX:' || i.branch_id || ':' || to_char(v_prev, 'YYYY-MM') || ':vencido', i.recipient_id FROM ins i
        ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT count(*) INTO v_k FROM ins;
    RETURN v_n + v_k;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.avisar_cuadre_antibioticos(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_cuadre_antibioticos(date) TO service_role;

-- Octubre no se reclama: el cuadre mensual empieza en noviembre de 2026. Sin
-- esta marca, mañana cada sala recibiría el recordatorio de octubre con tres
-- días por delante, y el 1-nov supervisión leería que octubre «quedó sin
-- conteo» por un pedido que es de hoy.
INSERT INTO public.avisos_emitidos (clave, recipient_id)
SELECT 'CUADRE_ABX:' || b.id || ':2026-10:' || k.clase, e.id
  FROM public.branches b CROSS JOIN public.employees e
  CROSS JOIN (VALUES ('recordatorio'), ('vencido')) k(clase)
 WHERE b.type IN ('FARMACIA', 'BODEGA') AND e.status = 'ACTIVO'
ON CONFLICT DO NOTHING;

SELECT cron.schedule('cuadre-antibioticos-0700-sv', '5 13 * * *',
    $c$SELECT public.avisar_cuadre_antibioticos((now() AT TIME ZONE 'America/El_Salvador')::date)$c$);
