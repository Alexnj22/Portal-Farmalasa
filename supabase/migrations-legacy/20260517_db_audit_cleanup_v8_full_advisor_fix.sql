-- ============================================================
-- DB AUDIT CLEANUP v8 — Fix all remaining Supabase advisor alerts
-- A) auth_has_module_permission: (select auth.jwt()) + search_path
-- B) 18 custom functions: SET search_path = '' + qualify table refs
-- C) RLS: wrap auth.role() in 4 policies
-- D) Consolidate overlapping permissive policies on 3 tables
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A. auth_has_module_permission — root cause of CRITICAL alerts
--    Uses auth.jwt() inside a STABLE SECURITY DEFINER fn called
--    from RLS policies on announcements + payroll_entries.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = (((select auth.jwt()) -> 'user_metadata') ->> 'roleId')::int
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    );
$$;

-- ─────────────────────────────────────────────────────────────
-- B. Function search_path fixes (all custom public functions)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_customers(names text[])
  RETURNS TABLE(customer_name text, customer_id bigint)
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.customers (name)
  SELECT DISTINCT upper(trim(n))
  FROM unnest(names) AS n
  WHERE upper(trim(n)) <> ''
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT c.name, c.id
  FROM public.customers c
  WHERE c.name = ANY(
    SELECT upper(trim(n)) FROM unnest(names) AS n WHERE upper(trim(n)) <> ''
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.next_cotizacion_numero()
  RETURNS text LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  year_str TEXT := TO_CHAR(CURRENT_DATE, 'YYYY');
  seq_num  INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(numero, '-', 3) AS INT)), 0) + 1
  INTO   seq_num
  FROM   public.cotizaciones
  WHERE  numero LIKE 'COT-' || year_str || '-%';
  RETURN 'COT-' || year_str || '-' || LPAD(seq_num::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_employee_sensitive_changes()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.base_salary IS DISTINCT FROM OLD.base_salary OR
            NEW.role_id     IS DISTINCT FROM OLD.role_id     OR
            NEW.status      IS DISTINCT FROM OLD.status) THEN
            INSERT INTO public.audit_logs (action, target_id, details, source, severity, branch_id)
            VALUES (
                'ALERTA_MODIFICACION_CRITICA', NEW.id::text,
                jsonb_build_object(
                    'old_salary', OLD.base_salary, 'new_salary', NEW.base_salary,
                    'old_role',   OLD.role_id,     'new_role',   NEW.role_id,
                    'old_status', OLD.status,       'new_status', NEW.status
                ),
                'SYSTEM', 'CRITICAL', NEW.branch_id
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_wfm_snapshot(p_branch_id bigint)
  RETURNS void LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
    v_base_hours       NUMERIC;
    v_min_concurrent   INT     := 2;
    v_target_rplh      NUMERIC := 80;
    v_shrinkage        NUMERIC := 0.15;
    v_extra_hours      NUMERIC := 0;
    v_max_avg_sales    NUMERIC := 0;
    v_peak_hour        INT;
    v_peak_day         INT;
    v_total_needed     NUMERIC;
    v_recommended_staff INT;
    r RECORD;
BEGIN
    v_base_hours := 84 * v_min_concurrent;

    FOR r IN (
        SELECT EXTRACT(ISODOW FROM sale_date) AS day_of_week,
               sale_hour, AVG(total_sales) AS avg_sales
        FROM public.branch_hourly_sales
        WHERE branch_id = p_branch_id
          AND sale_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY 1, 2
    ) LOOP
        IF (r.avg_sales / v_target_rplh) > v_min_concurrent THEN
            v_extra_hours := v_extra_hours + (CEIL(r.avg_sales / v_target_rplh) - v_min_concurrent);
        END IF;
        IF r.avg_sales > v_max_avg_sales THEN
            v_max_avg_sales := r.avg_sales;
            v_peak_day      := r.day_of_week;
            v_peak_hour     := r.sale_hour;
        END IF;
    END LOOP;

    v_total_needed      := (v_base_hours + v_extra_hours) * (1 + v_shrinkage);
    v_recommended_staff := CEIL(v_total_needed / 44);

    INSERT INTO public.wfm_snapshots (
        branch_id, recommended_staff, base_staff_hours,
        extra_volume_hours, shrinkage_hours, total_labor_hours,
        peak_day_name, peak_hour, peak_avg_sales
    ) VALUES (
        p_branch_id, v_recommended_staff, v_base_hours,
        v_extra_hours, (v_base_hours + v_extra_hours) * v_shrinkage, v_total_needed,
        CASE v_peak_day
            WHEN 1 THEN 'Lunes'     WHEN 2 THEN 'Martes'  WHEN 3 THEN 'Miércoles'
            WHEN 4 THEN 'Jueves'    WHEN 5 THEN 'Viernes'  WHEN 6 THEN 'Sábado'
            WHEN 7 THEN 'Domingo'
        END,
        v_peak_hour, v_max_avg_sales
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_ventas_month(p_mes date)
  RETURNS void LANGUAGE plpgsql
  SET search_path = ''
AS $$
DECLARE
  p_ffin DATE := (p_mes + INTERVAL '1 month' - INTERVAL '1 day')::date;
BEGIN
  DELETE FROM public.ventas_monthly_stats WHERE mes = p_mes;

  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes, branch_id, '', COUNT(*), COALESCE(SUM(total), 0),
         CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total), 0) / COUNT(*) ELSE 0 END
  FROM public.sales_invoices
  WHERE fecha BETWEEN p_mes AND p_ffin
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
  GROUP BY branch_id;

  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes, -1, '', COUNT(*), COALESCE(SUM(total), 0),
         CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total), 0) / COUNT(*) ELSE 0 END
  FROM public.sales_invoices
  WHERE fecha BETWEEN p_mes AND p_ffin
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH');

  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes, -1, cod_vendedor, COUNT(*), COALESCE(SUM(total), 0),
         CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total), 0) / COUNT(*) ELSE 0 END
  FROM public.sales_invoices
  WHERE fecha BETWEEN p_mes AND p_ffin
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND cod_vendedor IS NOT NULL AND cod_vendedor != ''
  GROUP BY cod_vendedor;

  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes, branch_id, cod_vendedor, COUNT(*), COALESCE(SUM(total), 0),
         CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(total), 0) / COUNT(*) ELSE 0 END
  FROM public.sales_invoices
  WHERE fecha BETWEEN p_mes AND p_ffin
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND cod_vendedor IS NOT NULL AND cod_vendedor != ''
  GROUP BY branch_id, cod_vendedor;

  UPDATE public.ventas_monthly_stats SET updated_at = NOW() WHERE mes = p_mes;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_sync_gaps(p_date date, p_max_gap integer DEFAULT 50)
  RETURNS TABLE(gap_start integer, gap_end integer, gap_size integer)
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  WITH ids AS (
    SELECT erp_invoice_id::int AS id
    FROM public.sales_invoices
    WHERE fecha = p_date
    ORDER BY 1
  ),
  consecutive AS (
    SELECT id, LEAD(id) OVER (ORDER BY id) AS next_id
    FROM ids
  )
  SELECT id + 1 AS gap_start, next_id - 1 AS gap_end, next_id - id - 1 AS gap_size
  FROM consecutive
  WHERE next_id IS NOT NULL AND next_id - id > 1 AND next_id - id - 1 <= p_max_gap
  ORDER BY gap_start;
$$;

CREATE OR REPLACE FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date)
  RETURNS json LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_branch_id BIGINT;
  v_payload   JSON;
BEGIN
  SELECT branch_id INTO v_branch_id
  FROM public.kiosk_devices
  WHERE id = p_device_id AND device_token = p_device_token;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Kiosco no encontrado o credenciales inválidas';
  END IF;

  SELECT json_build_object(
    'shifts', (
      SELECT COALESCE(json_agg(s), '[]'::json)
      FROM public.shifts s WHERE s.branch_id = v_branch_id
    ),
    'announcements', (
      SELECT COALESCE(json_agg(a), '[]'::json)
      FROM public.announcements a WHERE a.is_archived = false
    ),
    'employees', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id', e.id, 'name', e.name, 'code', e.code,
          'branch_id', e.branch_id, 'photo_url', e.photo_url,
          'role_id', e.role_id, 'secondary_role_id', e.secondary_role_id,
          'role', main_r.name, 'secondary_role', sec_r.name,
          'weekly_roster', COALESCE(er.schedule_data, '{}'::jsonb)
        )
      ), '[]'::json)
      FROM public.employees e
      LEFT JOIN public.roles main_r ON e.role_id = main_r.id
      LEFT JOIN public.roles sec_r  ON e.secondary_role_id = sec_r.id
      LEFT JOIN public.employee_rosters er ON e.id = er.employee_id
                                          AND er.week_start_date = p_week_start
      WHERE e.branch_id = v_branch_id AND e.status = 'ACTIVO'
    ),
    'branches', (
      SELECT COALESCE(json_agg(b), '[]'::json)
      FROM (SELECT id, name FROM public.branches ORDER BY name) b
    )
  ) INTO v_payload;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_precio_tipo(p_precio_unitario numeric, p_product_id integer, p_id_presentacion integer, p_fecha date DEFAULT CURRENT_DATE)
  RETURNS text LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  SELECT CASE
    WHEN ABS(p_precio_unitario - h.vineta)      < 0.005 THEN 'vineta'
    WHEN ABS(p_precio_unitario - h.descuento_1) < 0.005 THEN 'descuento_1'
    WHEN ABS(p_precio_unitario - h.vip)         < 0.005 THEN 'vip'
    WHEN ABS(p_precio_unitario - h.clinica)     < 0.005 THEN 'clinica'
    WHEN ABS(p_precio_unitario - h.mayoreo)     < 0.005 THEN 'mayoreo'
    WHEN ABS(p_precio_unitario - h.premium)     < 0.005 THEN 'premium'
    WHEN ABS(p_precio_unitario - h.precio_7)    < 0.005 THEN 'precio_7'
    ELSE 'otro'
  END
  FROM public.product_precios_history h
  WHERE h.product_id      = p_product_id
    AND h.id_presentacion = p_id_presentacion
    AND h.valid_from::date <= p_fecha
    AND (h.valid_until IS NULL OR h.valid_until::date > p_fecha)
  ORDER BY h.valid_from DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
  RETURNS TABLE(item_id bigint, presentacion text, id_presentacion integer, cantidad numeric, precio_unitario numeric, neto numeric, invoice_id bigint, fecha date, erp_invoice_id text, correlativo text, cliente text, branch_id integer, tipo_documento text, cod_vendedor text, tipo_pago text, lote text, fecha_vencimiento date)
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = ''
AS $$
    SELECT
        sii.id, sii.presentacion, sii.id_presentacion, sii.cantidad::numeric,
        CASE WHEN si.tipo_documento = 'CCF' THEN sii.precio_unitario::numeric
             ELSE sii.precio_unitario::numeric / 1.13 END,
        CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13 END,
        si.id, si.fecha, si.erp_invoice_id, si.correlativo, si.cliente,
        si.branch_id, si.tipo_documento, si.cod_vendedor, si.tipo_pago,
        sii.lote, sii.fecha_vencimiento
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id = p_erp_product_id
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha BETWEEN p_fini AND p_ffin
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY si.fecha DESC, si.id DESC
    LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
  RETURNS TABLE(erp_product_id integer, descripcion text, cantidad numeric, neto numeric, costo_total numeric, presentaciones jsonb)
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = ''
AS $$
WITH pres AS (
    SELECT sii.erp_product_id, MAX(sii.descripcion) AS descripcion, sii.presentacion,
           SUM(sii.cantidad::numeric) AS cantidad,
           SUM(CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric
                    ELSE sii.total_linea::numeric / 1.13 END) AS neto,
           SUM(CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea::numeric
                    ELSE sii.total_linea::numeric / 1.13 END)
             / NULLIF(SUM(sii.cantidad::numeric), 0) AS precio_unitario_avg
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id IS NOT NULL AND sii.erp_product_id != 0
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND si.fecha BETWEEN p_fini AND p_ffin
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    GROUP BY sii.erp_product_id, sii.presentacion
),
pres_costed AS (
    SELECT p.*,
           COALESCE(
             (SELECT pp.costo FROM public.product_precios pp
              WHERE pp.product_id = p.erp_product_id AND pp.activo = true
                AND (pp.vineta = 0 OR pp.costo <= pp.vineta)
              ORDER BY ABS(pp.vineta - p.precio_unitario_avg) NULLS LAST LIMIT 1),
             (SELECT pp.costo FROM public.product_precios pp
              WHERE pp.product_id = p.erp_product_id AND pp.activo = true
              ORDER BY ABS(pp.vineta - p.precio_unitario_avg) NULLS LAST LIMIT 1)
           ) AS costo_matched
    FROM pres p
)
SELECT erp_product_id, MAX(descripcion), SUM(cantidad), SUM(neto),
       CASE WHEN COUNT(costo_matched) = 0 THEN NULL
            ELSE SUM(costo_matched * cantidad) END,
       jsonb_agg(jsonb_build_object(
           'presentacion', presentacion, 'cantidad', cantidad,
           'neto', neto, 'precio_unitario_avg', precio_unitario_avg
       ) ORDER BY neto DESC)
FROM pres_costed
GROUP BY erp_product_id
ORDER BY SUM(neto) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_product_trend(p_erp_product_id integer, p_branch_id integer DEFAULT NULL::integer)
  RETURNS TABLE(month date, neto numeric, cantidad numeric)
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = ''
AS $$
    SELECT DATE_TRUNC('month', si.fecha)::date AS month,
           SUM(CASE WHEN si.tipo_documento = 'CCF' THEN sii.total_linea
                    ELSE sii.total_linea / 1.13 END)::numeric AS neto,
           SUM(sii.cantidad)::numeric AS cantidad
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id = sii.invoice_id
    WHERE sii.erp_product_id = p_erp_product_id
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND si.fecha >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '2 months')::date
      AND si.fecha <  DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')::date
    GROUP BY DATE_TRUNC('month', si.fecha)
    ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
  RETURNS numeric LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  WITH deduped AS (
    SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
    FROM public.sales_invoice_items ii
    JOIN public.sales_invoices si ON si.id = ii.invoice_id
    WHERE ii.erp_product_id = 0
      AND si.fecha BETWEEN p_fini AND p_ffin
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    ORDER BY ii.invoice_id, ii.total_linea DESC
  )
  SELECT COALESCE(SUM(total_linea), 0) FROM deduped;
$$;

CREATE OR REPLACE FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_hora_corte time without time zone DEFAULT NULL::time without time zone)
  RETURNS numeric LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  WITH deduped AS (
    SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
    FROM public.sales_invoice_items ii
    JOIN public.sales_invoices si ON si.id = ii.invoice_id
    WHERE ii.erp_product_id = 0
      AND si.fecha >= p_fini
      AND (si.fecha < p_ffin OR (si.fecha = p_ffin AND (p_hora_corte IS NULL OR si.hora <= p_hora_corte)))
      AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND si.cliente NOT ILIKE '%MAPFRE%'
    ORDER BY ii.invoice_id, ii.total_linea DESC
  )
  SELECT COALESCE(SUM(total_linea), 0) FROM deduped;
$$;

CREATE OR REPLACE FUNCTION public.get_vendedores_resumen(p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint)
  RETURNS TABLE(branch_id bigint, cod_vendedor text, total_ventas numeric, total_facturas bigint)
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
    SELECT branch_id, cod_vendedor,
           ROUND(SUM(total)::numeric, 2) AS total_ventas,
           COUNT(*)::bigint               AS total_facturas
    FROM public.sales_invoices
    WHERE fecha >= p_fini AND fecha <= p_ffin
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    GROUP BY branch_id, cod_vendedor
    ORDER BY SUM(total) DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_vendedor_diario(p_cod_vendedor text, p_fini date, p_ffin date)
  RETURNS TABLE(fecha date, branch_id bigint, total_ventas numeric, total_facturas bigint)
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
    SELECT fecha, branch_id, ROUND(SUM(total)::numeric, 2), COUNT(*)::bigint
    FROM public.sales_invoices
    WHERE cod_vendedor = p_cod_vendedor
      AND fecha >= p_fini AND fecha <= p_ffin
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    GROUP BY fecha, branch_id ORDER BY fecha, branch_id;
$$;

CREATE OR REPLACE FUNCTION public.get_vendedor_diario(p_branch_id bigint, p_cod_vendedor text, p_fini date, p_ffin date)
  RETURNS TABLE(fecha date, total_ventas numeric, total_facturas bigint)
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
    SELECT fecha, ROUND(SUM(total)::numeric, 2) AS total_ventas, COUNT(*)::bigint AS total_facturas
    FROM public.sales_invoices
    WHERE branch_id = p_branch_id AND cod_vendedor = p_cod_vendedor
      AND fecha >= p_fini AND fecha <= p_ffin
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    GROUP BY fecha ORDER BY fecha;
$$;

CREATE OR REPLACE FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
  RETURNS TABLE(total_count bigint, total_sum numeric)
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  SELECT COUNT(*), COALESCE(SUM(total), 0)
  FROM public.sales_invoices
  WHERE fecha BETWEEN p_fini AND p_ffin
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR branch_id = p_branch_id);
$$;

CREATE OR REPLACE FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_hora_corte time without time zone DEFAULT NULL::time without time zone)
  RETURNS TABLE(total_count bigint, total_sum numeric)
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$
  SELECT COUNT(*), COALESCE(SUM(total), 0)
  FROM public.sales_invoices
  WHERE fecha >= p_fini
    AND (fecha < p_ffin OR (fecha = p_ffin AND (p_hora_corte IS NULL OR hora <= p_hora_corte)))
    AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND (p_branch_id IS NULL OR branch_id = p_branch_id);
$$;

CREATE OR REPLACE FUNCTION public.get_ventas_con_puntos(
  p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint,
  p_sort_col text DEFAULT 'fecha'::text, p_sort_dir text DEFAULT 'DESC'::text,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
)
  RETURNS TABLE(id bigint, branch_id bigint, erp_invoice_id text, correlativo text,
                tipo_documento text, fecha date, hora time without time zone, cliente text,
                cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric,
                total numeric, estado text, n bigint)
  LANGUAGE plpgsql STABLE
  SET search_path = ''
AS $$
DECLARE
    v_sort_col text;
    v_sort_dir text;
    v_sql      text;
BEGIN
    v_sort_col := CASE p_sort_col
        WHEN 'fecha'          THEN 'si.fecha'
        WHEN 'correlativo'    THEN 'si.correlativo'
        WHEN 'tipo_documento' THEN 'si.tipo_documento'
        WHEN 'branch_id'      THEN 'si.branch_id'
        WHEN 'cod_vendedor'   THEN 'si.cod_vendedor'
        WHEN 'cliente'        THEN 'si.cliente'
        WHEN 'tipo_pago'      THEN 'si.tipo_pago'
        WHEN 'total'          THEN 'si.total'
        ELSE 'si.fecha'
    END;
    v_sort_dir := CASE WHEN lower(p_sort_dir) = 'asc' THEN 'ASC' ELSE 'DESC' END;

    v_sql := format('
        WITH base AS (
            SELECT si.*
            FROM public.sales_invoices si
            WHERE si.has_puntos = true
              AND si.fecha BETWEEN %L AND %L
              AND si.estado NOT IN (''NULA'', ''DTE INVALIDADO EN MH'')
              AND (%L::bigint IS NULL OR si.branch_id = %L::bigint)
              AND si.cliente NOT ILIKE ''%%MAPFRE%%''
        ),
        total_cnt AS (SELECT COUNT(*) AS n FROM base)
        SELECT si.id, si.branch_id, si.erp_invoice_id, si.correlativo,
               si.tipo_documento, si.fecha, si.hora, si.cliente,
               si.cod_vendedor, si.tipo_pago, si.subtotal, si.iva,
               si.total, si.estado, c.n
        FROM base si CROSS JOIN total_cnt c
        ORDER BY %s %s, si.fecha DESC, si.hora DESC
        LIMIT %s OFFSET %s
    ', p_fini, p_ffin, p_branch_id, p_branch_id, v_sort_col, v_sort_dir, p_limit, p_offset);

    RETURN QUERY EXECUTE v_sql;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_role_headcount(p_role_id integer, p_branch_id integer)
  RETURNS boolean LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_max_limit INT;
  v_current   INT;
BEGIN
  SELECT max_limit INTO v_max_limit FROM public.roles WHERE id = p_role_id;
  IF v_max_limit IS NULL OR v_max_limit <= 0 THEN RETURN TRUE; END IF;
  SELECT COUNT(*) INTO v_current
  FROM public.employees
  WHERE role_id = p_role_id AND branch_id = p_branch_id AND status = 'ACTIVO';
  RETURN v_current < v_max_limit;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- C. RLS: wrap auth.role() in (select ...) for plan caching
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cotizaciones_authenticated" ON cotizaciones;
CREATE POLICY "cotizaciones_authenticated" ON cotizaciones
  FOR ALL TO authenticated
  USING ((select auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "cotizacion_items_authenticated" ON cotizacion_items;
CREATE POLICY "cotizacion_items_authenticated" ON cotizacion_items
  FOR ALL TO authenticated
  USING ((select auth.role()) = 'authenticated');

-- role_permissions: wrap auth.role() + split ALL into non-overlapping cmds
DROP POLICY IF EXISTS "role_permissions_authenticated_read" ON role_permissions;
CREATE POLICY "role_permissions_authenticated_read" ON role_permissions
  FOR SELECT TO authenticated
  USING ((select auth.role()) = 'authenticated');

DROP POLICY IF EXISTS "role_permissions_write" ON role_permissions;
CREATE POLICY "role_permissions_insert" ON role_permissions
  FOR INSERT TO authenticated
  WITH CHECK (auth_has_module_permission('permissions', 'can_edit'));
CREATE POLICY "role_permissions_update" ON role_permissions
  FOR UPDATE TO authenticated
  USING (auth_has_module_permission('permissions', 'can_edit'));
CREATE POLICY "role_permissions_delete" ON role_permissions
  FOR DELETE TO authenticated
  USING (auth_has_module_permission('permissions', 'can_edit'));

-- ─────────────────────────────────────────────────────────────
-- D. Consolidate overlapping permissive policies
-- ─────────────────────────────────────────────────────────────

-- employee_branches: split ALL write policy → 3 specific cmds (no SELECT overlap)
DROP POLICY IF EXISTS "eb_write" ON employee_branches;
CREATE POLICY "eb_insert" ON employee_branches
  FOR INSERT TO authenticated
  WITH CHECK (auth_has_module_permission('staff_list', 'can_edit'));
CREATE POLICY "eb_update" ON employee_branches
  FOR UPDATE TO authenticated
  USING (auth_has_module_permission('staff_list', 'can_edit'));
CREATE POLICY "eb_delete" ON employee_branches
  FOR DELETE TO authenticated
  USING (auth_has_module_permission('staff_list', 'can_edit'));

-- approval_requests: remove 7 overlapping policies, replace with 3 clean ones
-- Old: authenticated_select=true (everyone sees everything) + specific ones = redundant
-- Old: approver_update_requests = auth.role()='authenticated' (anyone can update!)
DROP POLICY IF EXISTS "approval_requests_manage"  ON approval_requests;
DROP POLICY IF EXISTS "approval_requests_select"  ON approval_requests;
DROP POLICY IF EXISTS "authenticated_insert"       ON approval_requests;
DROP POLICY IF EXISTS "authenticated_select"       ON approval_requests;
DROP POLICY IF EXISTS "authenticated_update"       ON approval_requests;
DROP POLICY IF EXISTS "approver_update_requests"   ON approval_requests;
DROP POLICY IF EXISTS "employee_create_requests"   ON approval_requests;

CREATE POLICY "approval_requests_select" ON approval_requests
  FOR SELECT TO authenticated
  USING (
    employee_id = (select auth.uid())
    OR auth_has_module_permission('requests', 'can_approve')
  );

CREATE POLICY "approval_requests_insert" ON approval_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (select auth.uid())
    OR auth_has_module_permission('requests', 'can_approve')
  );

CREATE POLICY "approval_requests_update" ON approval_requests
  FOR UPDATE TO authenticated
  USING     (auth_has_module_permission('requests', 'can_approve'))
  WITH CHECK (auth_has_module_permission('requests', 'can_approve'));
