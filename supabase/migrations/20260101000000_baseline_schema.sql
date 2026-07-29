-- ============================================================================
-- BASELINE del esquema `public` — Portal Farmalasa
-- ============================================================================
-- Generado desde el CATALOGO DE PRODUCCION (no desde la historia de
-- migraciones) el 2026-07-29.
--
-- Motivo (PLAN-SUPABASE-CIERRE.md, C2): la historia registrada no es
-- replayeable. Las 19 migraciones `baseline_*` del 2026-07-11 no ejecutan DDL
-- —solo concatenan texto dentro de supabase_migrations.schema_migrations— y las
-- migraciones de abril esperan columnas que ya no existen (p.ej.
-- employees.is_admin). "Baseline reciente + historia vieja" no es una
-- combinacion valida; la unica arquitectura viable es baseline solo, con la
-- historia archivada en supabase/migrations-legacy/.
--
-- ⚠️  NO APLICAR A PRODUCCION. Prod ya tiene este esquema. Tras commitear este
--     archivo hay que registrarlo como aplicado sin ejecutarlo:
--         supabase migration repair --status applied 20260101000000
--     Sin ese paso, el proximo `db push` intentaria correr el baseline contra la
--     base viva.
--
-- Lo que este archivo SI reproduce, verificado por huella contra prod:
--   tablas, columnas (tipos/NOT NULL/defaults/identity/generated), secuencias
--   con sus parametros, storage parameters, funciones (cuerpo, SECURITY DEFINER,
--   volatilidad y search_path), vistas y matviews, PK/unique/FK/CHECK, indices,
--   triggers, RLS, policies, PRIVILEGIOS y membresia de Realtime.
--
-- Lo que NO reproduce, a proposito:
--   - Datos. Incluye el contenido de las matviews: se crean WITH NO DATA y hay
--     que refrescarlas.
--   - Objetos de extension (las 31 funciones de pg_trgm): los crea
--     CREATE EXTENSION, y su dueño es supabase_admin.
--   - Los jobs de pg_cron y los secretos de Vault: son configuracion, no
--     esquema.
--   - ALTER DEFAULT PRIVILEGES: los trae el bootstrap de Supabase. Por eso cada
--     objeto de la seccion de privilegios lleva REVOKE ALL primero — sin eso,
--     los default privileges de `public` le regalan ALL a anon sobre cada tabla
--     nueva y se reabre la superficie que el proyecto cerro (CLAUDE.md regla #4).
-- ============================================================================

SET check_function_bodies = off;
SET lock_timeout = '5s';



-- ── Extensiones (8) ───────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


-- ── Secuencias (las no-IDENTITY; las IDENTITY las recrea el CREATE TABLE) (39) ───

CREATE SEQUENCE IF NOT EXISTS public.cotizacion_items_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.cotizaciones_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.dispatch_rules_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.inventory_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.inventory_sync_log_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.kiosk_pin_attempts_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.lab_locations_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.login_rate_limit_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.module_locks_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.pedido_items_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.pedido_recepcion_extras_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.pedido_recepcion_firmas_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_active_principles_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_categories_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_locations_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_precios_changelog_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_precios_history_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_stock_params_history_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.product_stock_params_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.products_changelog_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.proveedores_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.purchase_receipt_items_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.purchase_receipts_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.purchase_sync_log_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.rutas_numero_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_alert_log_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_gap_resolutions_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_invoice_changelog_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_invoice_items_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_invoices_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_null_resolutions_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sales_payment_confirmations_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.suppliers_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.survey_bloques_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.survey_preguntas_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.survey_responses_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.surveys_id_seq AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.sync_log_id_seq AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;


-- ── Funciones y procedimientos (antes de las tablas: hay columnas GENERATED que las llaman. Excluye miembros de extension) (160) ───

CREATE OR REPLACE FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_pres text := NULLIF(TRIM(p_presentacion), '');
  v_lote text := NULLIF(TRIM(p_lote), '');
  v_id uuid;
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  IF v_pres IS NULL OR v_lote IS NULL THEN
    RAISE EXCEPTION 'PRESENTACION_Y_LOTE_REQUERIDOS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_erp_product_id AND activo = true) THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  -- El duplicado se chequea por (producto, presentación, lote), no por producto
  -- suelto: agregar el mismo renglón dos veces lo contaría dos veces, pero un
  -- lote NUEVO de un producto que ya está en el snapshot es el caso normal en
  -- farmacia y antes no se podía registrar (C7).
  IF EXISTS (
    SELECT 1 FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id
      AND erp_product_id = p_erp_product_id
      AND COALESCE(presentacion,'') = COALESCE(v_pres,'')
      AND COALESCE(lote,'') = COALESCE(v_lote,'')
  ) THEN
    RAISE EXCEPTION 'LINEA_YA_EXISTE';
  END IF;

  -- sistema 0 e is_vencidos false son la definición de "apareció algo que el
  -- libro no tiene": todo lo que se cuente aquí es sobrante. El costo lo pone
  -- el servidor con el mismo criterio que el snapshot (C3).
  INSERT INTO public.conteo_inventario_items (
    conteo_id, erp_product_id, presentacion, lote, fecha_vencimiento, is_vencidos,
    sistema_cantidad, sistema_inicial, costo_unitario, estado_item, es_agregado_manual)
  VALUES (
    p_conteo_id, p_erp_product_id, v_pres, v_lote, p_fecha_vencimiento, false,
    0, 0, public.conteo_costo_unitario(p_erp_product_id, v_pres), 'PENDIENTE', true)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.anular_pedido(p_pedido_id uuid, p_anulado_por uuid DEFAULT NULL::uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_status text;
    v_actor  uuid := auth_employee_id();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Pedido no encontrado.';
    END IF;

    IF v_status IN ('completado', 'anulado', 'parcial') THEN
        RAISE EXCEPTION 'El pedido está % y no puede ser anulado.', v_status;
    END IF;

    UPDATE pedido_items
    SET status = 'anulado'
    WHERE pedido_id = p_pedido_id AND status = 'pendiente';

    UPDATE pedidos
    SET status           = 'anulado',
        anulado_por      = v_actor,
        anulado_at       = now(),
        motivo_anulacion = p_motivo
    WHERE id = p_pedido_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.apply_proveedores_categoria_sugerida(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.proveedores_maestro p
     SET categoria_id = public.suggest_proveedor_categoria_id(p.desc_actividad),
         updated_at   = now()
   WHERE p.id = ANY(p_ids)
     AND public.suggest_proveedor_categoria_id(p.desc_actividad) IS NOT NULL
     AND p.categoria_id IS DISTINCT FROM public.suggest_proveedor_categoria_id(p.desc_actividad);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r public.minmax_change_requests%ROWTYPE;
  v_now timestamptz := now();
  v_publisher text := (SELECT auth.email());
  v_is_hidden boolean;
BEGIN
  -- p_decided_by se recibe y se IGNORA (F4.2).
  UPDATE public.minmax_change_requests
  SET status='approved', decided_by=v_publisher, decided_at=v_now, decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  IF r.erp_sucursal_id = 6 THEN
    RAISE EXCEPTION 'BODEGA_NOT_APPROVABLE_HERE: Bodega deriva su MIN/MAX de la suma de sucursales (trg_bodega_draft_sync), no admite solicitudes directas';
  END IF;

  SELECT is_hidden INTO v_is_hidden
  FROM public.product_stock_params
  WHERE erp_product_id = r.erp_product_id AND erp_sucursal_id = r.erp_sucursal_id;

  IF v_is_hidden IS TRUE THEN
    RAISE EXCEPTION 'PRODUCT_HIDDEN: el producto está oculto en Min/Max — quitale el ocultamiento antes de aprobar esta solicitud';
  END IF;

  INSERT INTO public.product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  VALUES (
    r.erp_product_id, r.erp_sucursal_id,
    r.requested_min, r.requested_max,
    NULL, NULL,
    v_now, v_publisher, v_now
  )
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = EXCLUDED.min_units,
    max_units    = EXCLUDED.max_units,
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = EXCLUDED.published_at,
    published_by = EXCLUDED.published_by,
    updated_at   = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'erp_product_id', r.erp_product_id,
    'erp_sucursal_id', r.erp_sucursal_id,
    'requested_by_id', r.requested_by_id,
    'product_name', r.product_name,
    'requested_min', r.requested_min,
    'requested_max', r.requested_max
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id bigint;
  v_result jsonb;
  v_approved jsonb := '[]'::jsonb;
  v_skipped_bodega jsonb := '[]'::jsonb;
  v_skipped_hidden jsonb := '[]'::jsonb;
  v_skipped_invalid jsonb := '[]'::jsonb;
  v_skipped_not_found jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_id IN ARRAY p_request_ids LOOP
    BEGIN
      v_result := approve_minmax_request(v_id, p_decided_by, 'Aprobación masiva') || jsonb_build_object('id', v_id);
      v_approved := v_approved || jsonb_build_array(v_result);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE 'BODEGA_NOT_APPROVABLE_HERE%' THEN
          v_skipped_bodega := v_skipped_bodega || jsonb_build_array(jsonb_build_object('id', v_id));
        ELSIF SQLERRM LIKE 'PRODUCT_HIDDEN%' THEN
          v_skipped_hidden := v_skipped_hidden || jsonb_build_array(jsonb_build_object('id', v_id));
        ELSIF SQLSTATE LIKE '23%' THEN
          -- Violacion de integridad (CHECK, unique, FK). NO es una carrera con
          -- otro aprobador: es una solicitud que no se puede aplicar nunca.
          -- Se devuelve el error real para que la UI lo pueda decir.
          v_skipped_invalid := v_skipped_invalid || jsonb_build_array(
            jsonb_build_object('id', v_id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
        ELSE
          v_skipped_not_found := v_skipped_not_found || jsonb_build_array(v_id);
        END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'approved', v_approved,
    'skipped_bodega', v_skipped_bodega,
    'skipped_hidden', v_skipped_hidden,
    'skipped_invalid', v_skipped_invalid,
    'skipped_not_found', v_skipped_not_found
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id AND status = 'FINALIZADO';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO_O_NO_FINALIZADO';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_conteo.finalizado_por THEN
    RAISE EXCEPTION 'APROBADOR_ES_QUIEN_FINALIZO';
  END IF;

  UPDATE public.conteos_inventario
  SET status = 'CERRADO', aprobado_por = v_actor, aprobado_at = now(), nota_aprobacion = p_nota
  WHERE id = p_conteo_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.attendance_kiosko_pedido_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_row RECORD;
BEGIN
    IF NEW.type = 'OUT_LUNCH' THEN
        FOR v_row IN
            SELECT pss.pedido_id, pss.erp_sucursal_id
            FROM   pedido_sucursal_status pss
            WHERE  pss.iniciado_por   = NEW.employee_id
              AND  pss.iniciado_at    IS NOT NULL
              AND  pss.finalizado_at  IS NULL
              AND  NOT EXISTS (
                  SELECT 1 FROM pedido_pausa_historial pph
                  WHERE  pph.pedido_id       = pss.pedido_id
                    AND  pph.erp_sucursal_id = pss.erp_sucursal_id
                    AND  pph.reanudado_at    IS NULL
              )
        LOOP
            PERFORM update_pedido_sucursal_lifecycle(
                v_row.pedido_id,
                v_row.erp_sucursal_id,
                'pausar',
                NEW.employee_id,
                'Almuerzo (kiosko)'
            );
        END LOOP;

    ELSIF NEW.type = 'IN_LUNCH' THEN
        FOR v_row IN
            SELECT pss.pedido_id, pss.erp_sucursal_id
            FROM   pedido_sucursal_status pss
            WHERE  pss.iniciado_por  = NEW.employee_id
              AND  pss.pausado_at    IS NOT NULL
              AND  pss.reanudado_at  IS NULL
              AND  pss.finalizado_at IS NULL
        LOOP
            PERFORM update_pedido_sucursal_lifecycle(
                v_row.pedido_id,
                v_row.erp_sucursal_id,
                'reanudar',
                NEW.employee_id,
                NULL
            );
        END LOOP;
    END IF;

    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.audit_employee_sensitive_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        IF (NEW.base_salary IS DISTINCT FROM OLD.base_salary OR
            NEW.role_id IS DISTINCT FROM OLD.role_id OR NEW.status IS DISTINCT FROM OLD.status) THEN
            INSERT INTO public.audit_logs (action, target_id, details, source, severity, branch_id)
            VALUES ('ALERTA_MODIFICACION_CRITICA', NEW.id::text,
                jsonb_build_object('old_salary',OLD.base_salary,'new_salary',NEW.base_salary,
                    'old_role',OLD.role_id,'new_role',NEW.role_id,'old_status',OLD.status,'new_status',NEW.status),
                'SYSTEM', 'CRITICAL', NEW.branch_id);
        END IF;
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.auth_can_edit_any(p_modules text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR (
      NOT public.auth_module_locked(p_modules)
      AND (
        EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_role_id()
            AND rp.module_key = ANY(p_modules)
            AND rp.can_edit
        )
        OR EXISTS (
          SELECT 1 FROM public.role_permissions rp
          WHERE rp.role_id = public.auth_employee_secondary_role_id()
            AND rp.module_key = ANY(p_modules)
            AND rp.can_edit
        )
      )
    );
$function$
;
CREATE OR REPLACE FUNCTION public.auth_can_edit_scope_all(p_modules text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id IN (public.auth_employee_role_id(), public.auth_employee_secondary_role_id())
        AND rp.module_key = ANY(p_modules)
        AND rp.can_edit
        AND COALESCE(rp.scope, 'ALL') = 'ALL'
    );
$function$
;
CREATE OR REPLACE FUNCTION public.auth_employee_branch_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.branch_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR (e.username IS NOT NULL AND e.username = split_part((select auth.email()), '@', 1))
     OR (e.code IS NOT NULL AND upper(e.code) = upper(COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'code', '')))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.auth_employee_erp_sucursal_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT esm.erp_sucursal_id FROM public.erp_sucursal_map esm WHERE esm.branch_id = auth_employee_branch_id();
$function$
;
CREATE OR REPLACE FUNCTION public.auth_employee_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR (e.username IS NOT NULL AND e.username = split_part((select auth.email()), '@', 1))
     OR (e.code IS NOT NULL AND upper(e.code) = upper(COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'code', '')))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.auth_employee_role_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.role_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR (e.username IS NOT NULL AND e.username = split_part((select auth.email()), '@', 1))
     OR (e.code IS NOT NULL AND upper(e.code) = upper(COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'code', '')))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.auth_employee_secondary_role_id()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT e.secondary_role_id FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR (e.username IS NOT NULL AND e.username = split_part((select auth.email()), '@', 1))
     OR (e.code IS NOT NULL AND upper(e.code) = upper(COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'code', '')))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.auth_has_module_permission(p_module_key text, p_action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    COALESCE(((select auth.jwt()) -> 'user_metadata') ->> 'systemRole', '') = 'SUPERADMIN'
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = public.auth_employee_role_id()
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    )
    OR EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = public.auth_employee_secondary_role_id()
        AND rp.module_key = p_module_key
        AND CASE p_action
              WHEN 'can_view'    THEN rp.can_view
              WHEN 'can_edit'    THEN rp.can_edit
              WHEN 'can_approve' THEN rp.can_approve
              ELSE false
            END
    );
$function$
;
CREATE OR REPLACE FUNCTION public.auth_module_locked(p_modules text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.module_locks ml
    WHERE ml.module_key = ANY(p_modules)
      AND ml.expires_at > now()
      AND ml.locked_by_id IS DISTINCT FROM public.auth_employee_id()
  );
$function$
;
CREATE OR REPLACE FUNCTION public.auth_module_scope(p_module_key text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE
    WHEN 'ALL' IN (
      COALESCE((SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_role_id() AND rp.module_key = p_module_key), ''),
      COALESCE((SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_secondary_role_id() AND rp.module_key = p_module_key), '')
    ) THEN 'ALL'
    ELSE COALESCE(
      (SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_role_id() AND rp.module_key = p_module_key),
      (SELECT rp.scope FROM public.role_permissions rp WHERE rp.role_id = public.auth_employee_secondary_role_id() AND rp.module_key = p_module_key),
      'ALL'
    )
  END;
$function$
;
CREATE OR REPLACE FUNCTION public.backfill_daily_stats_chunk()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_today       date := CURRENT_DATE;
    v_target      date := CURRENT_DATE - 185;
    v_earliest    date;
    v_chunk_end   date;
    v_chunk_start date;
    v_inserted    integer;
BEGIN
    SELECT MIN(date) INTO v_earliest FROM public.sales_daily_stats;

    IF v_earliest IS NOT NULL AND v_earliest <= v_target THEN
        PERFORM cron.unschedule('backfill-daily-stats');
        RETURN 'backfill complete, job removed';
    END IF;

    v_chunk_end   := COALESCE(v_earliest, v_today - 7) - 1;
    v_chunk_start := GREATEST(v_chunk_end - 4, v_target);

    INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total)
    SELECT fecha, branch_id, COUNT(*)::integer, COALESCE(SUM(total::numeric), 0)
    FROM public.sales_invoices
    WHERE fecha BETWEEN v_chunk_start AND v_chunk_end
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    GROUP BY fecha, branch_id
    ON CONFLICT (date, branch_id) DO UPDATE
      SET count_valid = EXCLUDED.count_valid, sum_total = EXCLUDED.sum_total;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN format('%s rows | %s → %s | earliest now %s', v_inserted, v_chunk_start, v_chunk_end, v_chunk_start);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.backup_dump_table(p_table text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result jsonb;
BEGIN
  IF p_table <> ALL(ARRAY[
    'employees','roles','role_permissions','branches','shifts','holidays',
    'employee_branches','employee_events','employee_documents','employee_rosters',
    'product_stock_params','dispatch_rules','stock_config','minmax_ignored',
    'product_categories','erp_sucursal_map',
    'kiosk_devices','overtime_bank','payroll_periods','payroll_entries',
    'vacation_plan_headers','vacation_plans','audit_logs'
  ]) THEN
    RAISE EXCEPTION 'TABLE_NOT_ALLOWED: %', p_table;
  END IF;
  EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %I t', p_table) INTO result;
  RETURN result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  cfg             public.stock_config%ROWTYPE;
  v_from          date;
  v_now           timestamptz := NOW();
  v_count         integer := 0;
  v_auto_applied  integer := 0;
  v_sparse_reset  integer := 0;
  v_lock          public.module_locks%ROWTYPE;
BEGIN
  -- Candado de mantenimiento: aplica INCLUSO a service_role.
  IF public.auth_module_locked(ARRAY['minmax','pedidos']) THEN
    SELECT * INTO v_lock
    FROM public.module_locks
    WHERE module_key = ANY(ARRAY['minmax','pedidos'])
      AND expires_at > now()
    ORDER BY locked_at
    LIMIT 1;

    IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'skipped',         true,
        'reason',          'module_locked',
        'locked_by',       v_lock.locked_by_name,
        'locked_module',   v_lock.module_key,
        'erp_sucursal_id', p_erp_sucursal_id
      );
    END IF;

    RAISE EXCEPTION 'MODULE_LOCKED: % esta en mantenimiento por % — no se puede recalcular',
      v_lock.module_key, v_lock.locked_by_name;
  END IF;

  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF p_erp_sucursal_id = 6 THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'skipped', true,
      'reason',  'bodega_not_calculated_here — su MIN/MAX real viene de trg_bodega_draft_sync (SUM de sucursales), no de este cálculo independiente'
    );
  END IF;

  SET LOCAL work_mem = '128MB';
  SELECT * INTO cfg FROM public.stock_config WHERE id = 1;
  v_from := CURRENT_DATE - (cfg.analysis_days || ' days')::interval;

  -- Saltar sucursal si tiene borradores pendientes de revisión manual.
  -- Los OCULTOS no cuentan: su borrador es inalcanzable desde la UI y este
  -- mismo cálculo no los toca, así que bloqueaban la sucursal para siempre.
  IF p_erp_sucursal_id IS NOT NULL THEN
    PERFORM 1 FROM product_stock_params
    WHERE erp_sucursal_id = p_erp_sucursal_id
      AND draft_status = 'pending'
      AND is_hidden IS NOT TRUE
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok',               false,
        'skipped',          true,
        'reason',           'branch_has_pending_drafts',
        'erp_sucursal_id',  p_erp_sucursal_id
      );
    END IF;
  END IF;

  WITH branch_map AS (
    SELECT branch_id AS bid, erp_sucursal_id AS esid
    FROM erp_sucursal_map
    WHERE es_bodega = false
  ),
  daily AS MATERIALIZED (
    SELECT
      bm.esid                                                                           AS erp_sucursal_id,
      ii.erp_product_id,
      inv.fecha,
      SUM(ii.cantidad::numeric
          * ii.factor_unidades) AS units,
      SUM(ii.total_linea)                                                               AS rev
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    WHERE inv.fecha         >= v_from
      AND inv.estado        != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad        > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
      AND NOT EXISTS (
        SELECT 1 FROM products p
        JOIN laboratorios l ON l.id = p.laboratorio_id
        WHERE p.id = ii.erp_product_id AND l.ocultar_en_minmax = true
      )
    GROUP BY bm.esid, ii.erp_product_id, inv.fecha
  ),
  daily_p95 AS (
    SELECT
      erp_sucursal_id,
      erp_product_id,
      PERCENTILE_CONT(cfg.outlier_percentile::float / 100.0)
          WITHIN GROUP (ORDER BY units) AS cap
    FROM daily
    GROUP BY erp_sucursal_id, erp_product_id
  ),
  -- F2.3: primera venta HISTORICA por producto/sucursal — sin filtro de fecha
  -- a proposito. Es lo unico que distingue un producto nuevo (que no pudo
  -- vender en los dias que no existia) de uno viejo con venta esporadica.
  primera_venta AS (
    SELECT bm.esid AS erp_sucursal_id, ii.erp_product_id, MIN(inv.fecha) AS primera
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    WHERE inv.estado        != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL
      AND ii.cantidad        > 0
      AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
    GROUP BY bm.esid, ii.erp_product_id
  ),
  -- Las sumas y el denominador real, separados del calculo de la velocidad para
  -- poder reusar data_days (un alias no se puede referenciar en el mismo SELECT).
  stats_raw AS (
    SELECT
      d.erp_sucursal_id,
      d.erp_product_id,
      SUM(d.units)::integer                                       AS sold_period,
      SUM(d.rev)                                                  AS rev_period,
      SUM(LEAST(d.units, p.cap))::numeric                         AS units_w,
      SUM(LEAST(d.units, p.cap) * LEAST(d.units, p.cap))::numeric AS units_w_sq,
      SUM(CASE WHEN d.fecha >= CURRENT_DATE - 30 THEN d.units ELSE 0 END)::numeric AS units_30d,
      LEAST(cfg.analysis_days,
            GREATEST(30, (CURRENT_DATE - GREATEST(COALESCE(pv.primera, v_from), v_from))::int + 1)) AS data_days,
      COUNT(DISTINCT d.fecha)                                     AS dias
    FROM daily d
    JOIN daily_p95 p ON p.erp_sucursal_id = d.erp_sucursal_id
                    AND p.erp_product_id  = d.erp_product_id
    LEFT JOIN primera_venta pv ON pv.erp_sucursal_id = d.erp_sucursal_id
                              AND pv.erp_product_id  = d.erp_product_id
    GROUP BY d.erp_sucursal_id, d.erp_product_id, pv.primera
    HAVING COUNT(DISTINCT d.fecha) >= 1
  ),
  stats AS (
    SELECT
      erp_sucursal_id, erp_product_id, sold_period, rev_period, data_days, dias,
      units_w / data_days   AS velocity,
      units_30d / 30        AS velocity_30d,
      ROUND((
        SQRT(GREATEST(0, units_w_sq / data_days - POWER(units_w / data_days, 2)))
        / NULLIF(units_w / data_days, 0) * 100
      )::numeric, 1) AS cv
    FROM stats_raw
  ),
  ranked AS (
    SELECT *,
      PERCENT_RANK() OVER (PARTITION BY erp_sucursal_id ORDER BY cv) AS cv_pctile,
      SUM(rev_period) OVER (
        PARTITION BY erp_sucursal_id
        ORDER BY rev_period DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )                                                    AS cum_rev,
      SUM(rev_period) OVER (PARTITION BY erp_sucursal_id) AS tot_rev
    FROM stats
    WHERE dias >= 3
  ),
  lead_times AS MATERIALIZED (
    SELECT erp_product_id, erp_sucursal_id, lead_time_days
    FROM product_stock_params
    WHERE lead_time_days IS NOT NULL AND erp_sucursal_id != 6
  ),
  classified AS (
    SELECT r.*,
      CASE
        WHEN r.tot_rev = 0                                               THEN 'D'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_a_pct/100 THEN 'A'
        WHEN (r.cum_rev - r.rev_period) / r.tot_rev < cfg.abc_b_pct/100 THEN 'B'
        ELSE                                                                  'C'
      END AS abc,
      CASE
        WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN 'X'
        WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN 'Y'
        ELSE                               'Z'
      END AS xyz,
      COALESCE(lt.lead_time_days,
        CASE
          WHEN r.cv_pctile <= cfg.xyz_x_percentile / 100.0 THEN cfg.reorder_x_days + cfg.buffer_x_days
          WHEN r.cv_pctile <= cfg.xyz_y_percentile / 100.0 THEN cfg.reorder_y_days + cfg.buffer_y_days
          ELSE                               cfg.reorder_z_days + cfg.buffer_z_days
        END
      ) AS effective_lead_days
    FROM ranked r
    LEFT JOIN lead_times lt ON lt.erp_product_id = r.erp_product_id
                            AND lt.erp_sucursal_id = r.erp_sucursal_id
  ),
  with_min AS (
    SELECT *,
      GREATEST(
        FLOOR(velocity * effective_lead_days)::int,
        CASE WHEN CEIL(velocity * cfg.cycle_days)::int > 1 THEN 1 ELSE 0 END
      ) AS computed_min
    FROM classified
  ),
  main_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      abc,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      cv, xyz,
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
      computed_min,
      GREATEST(CEIL(velocity * cfg.cycle_days)::int, computed_min + 1, 1),
      sold_period, rev_period, data_days,
      v_now, 'pending',
      v_now
    FROM with_min
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      abc_class                  = EXCLUDED.draft_abc_class,
      daily_velocity              = EXCLUDED.draft_velocity,
      velocity_30d                 = EXCLUDED.draft_velocity_30d,
      cv                           = EXCLUDED.draft_cv,
      demand_variability            = EXCLUDED.draft_demand_variability,
      units_sold_6m                 = EXCLUDED.draft_units_sold,
      revenue_6m                    = EXCLUDED.draft_revenue,
      calculated_at                 = EXCLUDED.draft_calculated_at,
      draft_abc_class            = EXCLUDED.draft_abc_class,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = EXCLUDED.draft_cv,
      draft_demand_variability   = EXCLUDED.draft_demand_variability,
      draft_min                  = EXCLUDED.draft_min,
      draft_max                  = EXCLUDED.draft_max,
      calc_min                   = EXCLUDED.calc_min,
      calc_max                   = EXCLUDED.calc_max,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = CASE
        WHEN product_stock_params.min_units IS NULL
          OR product_stock_params.min_units  IS DISTINCT FROM EXCLUDED.draft_min
          OR product_stock_params.max_units  IS DISTINCT FROM EXCLUDED.draft_max
        THEN 'pending'
        ELSE 'none'
      END,
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  sparse_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      draft_abc_class, draft_velocity, draft_velocity_30d, draft_cv, draft_demand_variability,
      draft_min, draft_max,
      calc_min, calc_max,
      draft_units_sold, draft_revenue, draft_data_days,
      draft_calculated_at, draft_status,
      updated_at
    )
    SELECT
      erp_product_id, erp_sucursal_id,
      NULL,
      ROUND(velocity::numeric, 6),
      ROUND(velocity_30d::numeric, 6),
      NULL, NULL,
      NULL, NULL,
      NULL, NULL,
      sold_period, rev_period, data_days,
      v_now, 'sparse_data',
      v_now
    FROM stats
    WHERE dias BETWEEN 1 AND 2
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_abc_class            = NULL,
      draft_velocity             = EXCLUDED.draft_velocity,
      draft_velocity_30d         = EXCLUDED.draft_velocity_30d,
      draft_cv                   = NULL,
      draft_demand_variability   = NULL,
      draft_min                  = NULL,
      draft_max                  = NULL,
      calc_min                   = NULL,
      calc_max                   = NULL,
      draft_units_sold           = EXCLUDED.draft_units_sold,
      draft_revenue              = EXCLUDED.draft_revenue,
      draft_data_days            = EXCLUDED.draft_data_days,
      draft_calculated_at        = EXCLUDED.draft_calculated_at,
      draft_status               = 'sparse_data',
      updated_at                 = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT erp_product_id FROM main_upsert
    UNION ALL
    SELECT erp_product_id FROM sparse_upsert
  ) combined;

  -- F2.5: los sparse_data que este recalculo NO volvio a escribir ya no tienen
  -- ni una venta en la ventana: dejan de ser "datos escasos".
  UPDATE product_stock_params
  SET draft_status             = 'none',
      draft_abc_class          = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_cv                 = NULL,
      draft_demand_variability = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_calculated_at      = NULL,
      updated_at               = v_now
  WHERE draft_status = 'sparse_data'
    AND erp_sucursal_id != 6
    AND (p_erp_sucursal_id IS NULL OR erp_sucursal_id = p_erp_sucursal_id)
    AND (draft_calculated_at IS NULL OR draft_calculated_at < v_now);

  GET DIAGNOSTICS v_sparse_reset = ROW_COUNT;

  -- F2.1: sin INSERT a product_stock_params_history — lo escribe
  -- trg_psp_capture_history, que ve este UPDATE igual que cualquier otro.
  WITH auto_apply AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = psp.draft_min,
      max_units                = psp.draft_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = 'auto',
      updated_at                = v_now
    WHERE psp.draft_status = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND psp.is_hidden IS NOT TRUE
      AND COALESCE(psp.min_units, 0) > 0
      AND COALESCE(psp.draft_min,  0) > 0
      AND COALESCE(psp.draft_max,  0) > 0
      AND ABS(psp.draft_min - psp.min_units)::numeric / GREATEST(psp.min_units, 1) <= 0.40
      AND ABS(psp.draft_max - psp.max_units)::numeric / GREATEST(psp.max_units, 1) <= 0.40
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_auto_applied FROM auto_apply;

  RETURN jsonb_build_object(
    'ok', true, 'rows', v_count,
    'auto_applied', v_auto_applied,
    'drafted', GREATEST(v_count - v_auto_applied, 0),
    'sparse_reset', v_sparse_reset,
    'at', v_now
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.classify_purchase_dte_review(p_review_id bigint, p_document_id bigint, p_tipo text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_tipo NOT IN ('anulacion', 'otro') THEN
    RAISE EXCEPTION 'tipo inválido: %', p_tipo;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_dte_review_queue
    WHERE id = p_review_id AND kind = 'orphan_pdf' AND status = 'pendiente'
  ) THEN
    RAISE EXCEPTION 'solo se puede clasificar una fila kind=orphan_pdf pendiente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_dte_documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'documento % no existe', p_document_id;
  END IF;

  IF p_tipo = 'anulacion' THEN
    UPDATE public.purchase_dte_documents SET
      invalidado        = true,
      invalidado_motivo = coalesce(nullif(p_motivo, ''), 'Anulación detectada en PDF adjunto (Revisión)'),
      invalidado_at     = now()
    WHERE id = p_document_id AND invalidado = false;
  END IF;

  UPDATE public.purchase_dte_review_queue SET
    status = 'emparejado',
    matched_document_id = p_document_id,
    resolved_by = auth_employee_id(),
    resolved_at = now()
  WHERE id = p_review_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.close_ventas_month(p_mes date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE p_ffin DATE := (p_mes + INTERVAL '1 month' - INTERVAL '1 day')::date;
BEGIN
  DELETE FROM public.ventas_monthly_stats WHERE mes = p_mes;
  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes, branch_id, '', COUNT(*), COALESCE(SUM(total),0),
    CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(total),0)/COUNT(*) ELSE 0 END
  FROM public.sales_invoices WHERE fecha BETWEEN p_mes AND p_ffin AND estado NOT IN ('NULA','DTE INVALIDADO EN MH') GROUP BY branch_id;
  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes,-1,'',COUNT(*),COALESCE(SUM(total),0),CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(total),0)/COUNT(*) ELSE 0 END
  FROM public.sales_invoices WHERE fecha BETWEEN p_mes AND p_ffin AND estado NOT IN ('NULA','DTE INVALIDADO EN MH');
  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes,-1,cod_vendedor,COUNT(*),COALESCE(SUM(total),0),CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(total),0)/COUNT(*) ELSE 0 END
  FROM public.sales_invoices WHERE fecha BETWEEN p_mes AND p_ffin AND estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    AND cod_vendedor IS NOT NULL AND cod_vendedor != '' GROUP BY cod_vendedor;
  INSERT INTO public.ventas_monthly_stats (mes, branch_id, cod_vendedor, total_count, total_sum, avg_ticket)
  SELECT p_mes,branch_id,cod_vendedor,COUNT(*),COALESCE(SUM(total),0),CASE WHEN COUNT(*)>0 THEN COALESCE(SUM(total),0)/COUNT(*) ELSE 0 END
  FROM public.sales_invoices WHERE fecha BETWEEN p_mes AND p_ffin AND estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    AND cod_vendedor IS NOT NULL AND cod_vendedor != '' GROUP BY branch_id, cod_vendedor;
  UPDATE public.ventas_monthly_stats SET updated_at = NOW() WHERE mes = p_mes;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid DEFAULT NULL::uuid, p_revisado_por uuid DEFAULT NULL::uuid, p_sucursal_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_pedido_id uuid;
  v_item      jsonb;
  v_qty       integer;
  v_suc_valid boolean;
  v_actor     uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un ítem.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    IF v_qty < 0 THEN
      RAISE EXCEPTION 'cantidad_asignada no puede ser negativa (product_id=%).', v_item->>'erp_product_id';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM erp_sucursal_map
      WHERE erp_sucursal_id = (v_item->>'erp_sucursal_id')::integer
    ) INTO v_suc_valid;
    IF NOT v_suc_valid THEN
      RAISE EXCEPTION 'erp_sucursal_id % no existe.', v_item->>'erp_sucursal_id';
    END IF;
  END LOOP;

  -- responsable_id/revisado_por: la única lógica cliente real hoy es
  -- "self o null" (esEmpleado ? user.id : null / siempre null) — se preserva
  -- ese comportamiento exacto pero resuelto server-side, sin aceptar un uuid
  -- de tercero.
  INSERT INTO pedidos (created_by, notes, responsable_id, revisado_por, sucursal_ids)
  VALUES (
    v_actor,
    p_notes,
    CASE WHEN p_responsable_id IS NOT NULL THEN v_actor ELSE NULL END,
    CASE WHEN p_revisado_por   IS NOT NULL THEN v_actor ELSE NULL END,
    p_sucursal_ids
  )
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'cantidad_asignada')::integer, 0);
    INSERT INTO pedido_items (
      pedido_id, erp_sucursal_id, erp_product_id, erp_presentacion_id,
      cantidad_asignada, sin_stock, revision_minmax,
      stock_packs_snapshot, max_qty_snapshot, min_qty_snapshot, urgencia_pct_snapshot,
      lotes_asignados,
      factor, dispatch_tipo, dispatch_factor, dispatch_multiplo,
      status, cantidad_recibida, received_at
    ) VALUES (
      v_pedido_id,
      (v_item->>'erp_sucursal_id')::integer,
      (v_item->>'erp_product_id')::integer,
      (v_item->>'erp_presentacion_id')::integer,
      v_qty,
      COALESCE((v_item->>'sin_stock')::boolean,       false),
      COALESCE((v_item->>'revision_minmax')::boolean,  false),
      (v_item->>'stock_packs_snapshot')::numeric,
      (v_item->>'max_qty_snapshot')::integer,
      (v_item->>'min_qty_snapshot')::integer,
      (v_item->>'urgencia_pct_snapshot')::integer,
      CASE WHEN v_qty > 0 THEN (v_item->'lotes_asignados') ELSE NULL END,
      (v_item->>'factor')::numeric,
      v_item->>'dispatch_tipo',
      (v_item->>'dispatch_factor')::numeric,
      COALESCE((v_item->>'dispatch_multiplo')::smallint, 1),
      CASE WHEN v_qty = 0 THEN 'recibido'  ELSE 'pendiente' END,
      CASE WHEN v_qty = 0 THEN 0           ELSE NULL        END,
      CASE WHEN v_qty = 0 THEN now()       ELSE NULL        END
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.conteo_costo_unitario(p_product_id integer, p_presentacion text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  -- Prefiere el costo de la presentación de la línea; si el producto no la
  -- tiene registrada, cae al costo más bajo activo (criterio anterior) para no
  -- dejar la línea sin valuar.
  SELECT pp.costo
  FROM public.product_precios pp
  LEFT JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
  WHERE pp.product_id = p_product_id
    AND pp.activo = true
  ORDER BY (pr.tipo IS NOT DISTINCT FROM p_presentacion) DESC, pp.costo
  LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.conteo_puede_ver_sistema(p_conteo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.conteos_inventario c
           WHERE c.id = p_conteo_id
             AND c.status NOT IN ('BORRADOR', 'EN_PROGRESO')
         )
         OR public.auth_has_module_permission('conteo_ver_sistema', 'can_view');
$function$
;
CREATE OR REPLACE FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb DEFAULT NULL::jsonb, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo_id uuid;
  v_erp_sucursal_ids int[];
  v_ciclico_ids int[];
  v_composicion jsonb;
BEGIN
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND p_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_scope_type NOT IN ('TOTAL','LABORATORIO','BAJO_RECETA','MANUAL','CICLICO') THEN
    RAISE EXCEPTION 'ALCANCE_INVALIDO';
  END IF;

  -- Dos conteos abiertos sobre la misma sucursal se pisan: ambos leen el mismo
  -- stock en vivo y producen diferencias que se contradicen.
  IF EXISTS (SELECT 1 FROM public.conteos_inventario
             WHERE branch_id = p_branch_id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
    RAISE EXCEPTION 'CONTEO_ABIERTO_EN_SUCURSAL';
  END IF;

  SELECT array_agg(erp_sucursal_id) INTO v_erp_sucursal_ids
  FROM public.erp_sucursal_map WHERE branch_id = p_branch_id;

  IF v_erp_sucursal_ids IS NULL THEN
    RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP';
  END IF;

  -- La muestra se sortea EN EL SERVIDOR: si la eligiera el cliente, elegir qué
  -- se cuenta dejaría de ser un control y pasaría a ser una preferencia.
  IF p_scope_type = 'CICLICO' THEN
    SELECT array_agg(s.erp_product_id),
           jsonb_object_agg(s.segmento, s.n)
    INTO v_ciclico_ids, v_composicion
    FROM (
      SELECT erp_product_id, segmento, count(*) OVER (PARTITION BY segmento) n
      FROM public.seleccionar_muestra_ciclica(p_branch_id, COALESCE((p_scope_filter->>'tamano')::int, 200))
    ) s;

    IF v_ciclico_ids IS NULL THEN RAISE EXCEPTION 'MUESTRA_CICLICA_VACIA'; END IF;

    -- Queda registrado con qué composición se sorteó: un conteo cíclico que no
    -- dice cómo se armó no se puede auditar después.
    p_scope_filter := COALESCE(p_scope_filter, '{}'::jsonb)
      || jsonb_build_object('composicion', v_composicion, 'productos', array_length(v_ciclico_ids, 1));
  END IF;

  -- Siempre incluye TODO el inventario (vencido o no) — el conteo físico debe
  -- reflejar la realidad completa del anaquel/bodega; lo vencido/próximo a
  -- vencer se señala como aviso en la UI, no se excluye del snapshot.
  INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status)
  VALUES (p_branch_id, public.auth_employee_id(), p_scope_type, p_scope_filter, true, 'EN_PROGRESO')
  RETURNING id INTO v_conteo_id;

  INSERT INTO public.conteo_inventario_items (conteo_id, erp_product_id, source_inventory_id, source_sync_key, presentacion, detalle, lote, fecha_vencimiento, is_vencidos, sistema_cantidad, sistema_inicial, costo_unitario)
  SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad, i.cantidad,
         public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
  FROM public.inventory i
  LEFT JOIN public.products p ON p.id = i.erp_product_id
  WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
    AND (
      p_scope_type = 'TOTAL'
      OR (p_scope_type = 'LABORATORIO' AND p.laboratorio_id = (p_scope_filter->>'laboratorio_id')::int)
      OR (p_scope_type = 'BAJO_RECETA' AND p.es_antibiotico = true)
      OR (p_scope_type = 'MANUAL' AND i.erp_product_id = ANY(p_erp_product_ids))
      OR (p_scope_type = 'CICLICO' AND i.erp_product_id = ANY(v_ciclico_ids))
    );

  RETURN v_conteo_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.crear_conteos_ciclicos_programados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record;
  v_conteo_id uuid;
  v_ids int[];
  v_composicion jsonb;
  v_creados jsonb := '[]'::jsonb;
  v_saltados jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT b.id, b.name, b.conteo_ciclico_tamano AS tamano
    FROM public.branches b
    WHERE b.conteo_ciclico_activo = true
      AND EXISTS (SELECT 1 FROM public.erp_sucursal_map m WHERE m.branch_id = b.id)
    ORDER BY b.id
  LOOP
    -- Una sucursal con un conteo abierto no recibe otro: se pisarían leyendo el
    -- mismo stock en vivo. Se salta y queda registrado, no se rompe la corrida.
    IF EXISTS (SELECT 1 FROM public.conteos_inventario
               WHERE branch_id = r.id AND status IN ('BORRADOR','EN_PROGRESO')) THEN
      v_saltados := v_saltados || jsonb_build_object('branch', r.name, 'motivo', 'conteo_abierto');
      CONTINUE;
    END IF;

    SELECT array_agg(s.erp_product_id), jsonb_object_agg(s.segmento, s.n)
    INTO v_ids, v_composicion
    FROM (
      SELECT erp_product_id, segmento, count(*) OVER (PARTITION BY segmento) n
      FROM public.seleccionar_muestra_ciclica(r.id, r.tamano)
    ) s;

    IF v_ids IS NULL THEN
      v_saltados := v_saltados || jsonb_build_object('branch', r.name, 'motivo', 'muestra_vacia');
      CONTINUE;
    END IF;

    -- created_by queda NULL: no hay empleado detrás, lo creó el sistema. El
    -- scope_filter deja constancia de eso y de cómo se sorteó.
    INSERT INTO public.conteos_inventario (branch_id, created_by, scope_type, scope_filter, incluye_vencidos, status)
    VALUES (r.id, NULL, 'CICLICO',
            jsonb_build_object('tamano', r.tamano, 'composicion', v_composicion,
                               'productos', array_length(v_ids, 1), 'programado', true),
            true, 'EN_PROGRESO')
    RETURNING id INTO v_conteo_id;

    INSERT INTO public.conteo_inventario_items (conteo_id, erp_product_id, source_inventory_id, source_sync_key, presentacion, detalle, lote, fecha_vencimiento, is_vencidos, sistema_cantidad, sistema_inicial, costo_unitario)
    SELECT v_conteo_id, i.erp_product_id, i.id, i.sync_key, i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.is_vencidos, i.cantidad, i.cantidad,
           public.conteo_costo_unitario(i.erp_product_id, i.presentacion)
    FROM public.inventory i
    JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id AND m.branch_id = r.id
    WHERE i.erp_product_id = ANY(v_ids);

    -- Crear el conteo y no avisarle a nadie lo dejaría esperando a que alguien
    -- entre a mirar.
    PERFORM public.notify_branch(
      r.id::int,
      'CONTEO_CICLICO',
      'Conteo cíclico del mes',
      format('Ya está listo el conteo de %s productos de este mes. Se cuenta a ciegas: anotá lo que ves en el anaquel.', array_length(v_ids, 1)),
      '/conteo-inventario/' || v_conteo_id::text,
      jsonb_build_object('conteo_id', v_conteo_id, 'composicion', v_composicion),
      true
    );

    v_creados := v_creados || jsonb_build_object(
      'branch', r.name, 'conteo_id', v_conteo_id,
      'productos', array_length(v_ids, 1), 'composicion', v_composicion);
  END LOOP;

  RETURN jsonb_build_object('creados', v_creados, 'saltados', v_saltados, 'at', now());
END;
$function$
;
CREATE OR REPLACE FUNCTION public.crear_ruta(p_conductor_id uuid, p_conductor_nombre text, p_paradas jsonb, p_distancia_total_m integer DEFAULT NULL::integer, p_duracion_min integer DEFAULT NULL::integer, p_creado_por uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ruta_id uuid;
  v_parada  jsonb;
  v_actor   uuid := auth_employee_id();
BEGIN
  -- Auditoría 2026-07 (0B.7): la función no chequeaba ningún rol, y usaba
  -- p_creado_por (mandado por el cliente) tal cual para autoría y para
  -- enviado_por de los pedidos incluidos — cualquier authenticated podía
  -- crear rutas y marcar pedidos enviados atribuyéndolo a otro empleado.
  -- p_creado_por queda en la firma por compatibilidad con el caller actual
  -- (CrearRutaModal.jsx) pero ya no se usa para autoría.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NOT auth_can_edit_any(ARRAY['pedidos_tab_rutas']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Rutas';
  END IF;

  INSERT INTO rutas (
    conductor_id, conductor_nombre,
    distancia_total_m, duracion_estimada_min,
    created_by, status
  )
  VALUES (
    p_conductor_id, p_conductor_nombre,
    p_distancia_total_m, p_duracion_min,
    v_actor, 'pendiente'
  )
  RETURNING id INTO v_ruta_id;

  FOR v_parada IN SELECT * FROM jsonb_array_elements(p_paradas) LOOP
    INSERT INTO ruta_pedidos (
      ruta_id, pedido_id, erp_sucursal_id, orden_entrega,
      distancia_desde_anterior_m, duracion_desde_anterior_min
    ) VALUES (
      v_ruta_id,
      (v_parada->>'pedido_id')::uuid,
      (v_parada->>'erp_sucursal_id')::integer,
      (v_parada->>'orden_entrega')::integer,
      (v_parada->>'dist_m')::integer,
      (v_parada->>'dur_min')::integer
    )
    ON CONFLICT (ruta_id, pedido_id, erp_sucursal_id) DO NOTHING;
  END LOOP;

  -- Marcar todos los pedidos incluidos como "enviado"
  UPDATE pedidos
  SET status      = 'enviado',
      enviado_por = v_actor,
      enviado_at  = now()
  WHERE id IN (
    SELECT DISTINCT (value->>'pedido_id')::uuid
    FROM jsonb_array_elements(p_paradas)
  )
  AND status = 'confirmado';

  RETURN v_ruta_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos']))
     AND p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id()) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: tu permiso es solo para tu sucursal';
  END IF;

  UPDATE product_stock_params
  SET
    draft_min                = NULL,
    draft_max                = NULL,
    draft_abc_class          = NULL,
    draft_velocity           = NULL,
    draft_velocity_30d       = NULL,
    draft_cv                 = NULL,
    draft_demand_variability = NULL,
    draft_units_sold         = NULL,
    draft_revenue            = NULL,
    draft_data_days          = NULL,
    draft_calculated_at      = NULL,
    draft_status             = 'none',
    updated_at               = now()
  WHERE erp_sucursal_id = p_erp_sucursal_id
    AND draft_status IN ('pending', 'sparse_data');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_lote text;
  v_fecha date;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  UPDATE public.conteo_inventario_items
  SET lote = NULLIF(TRIM(p_lote), ''),
      fecha_vencimiento = p_fecha_vencimiento
  WHERE id = p_item_id
  RETURNING lote, fecha_vencimiento INTO v_lote, v_fecha;

  IF (v_item.lote, v_item.fecha_vencimiento) IS DISTINCT FROM (v_lote, v_fecha) THEN
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    VALUES (p_item_id, v_item.fisico_cantidad, v_item.sistema_cantidad, v_item.diferencia, v_item.estado_item,
            format('Etiqueta corregida: lote %s → %s · vence %s → %s',
                   COALESCE(v_item.lote,'—'), COALESCE(v_lote,'—'),
                   COALESCE(v_item.fecha_vencimiento::text,'—'), COALESCE(v_fecha::text,'—')),
            public.auth_employee_id(), 'LOTE');
  END IF;

  RETURN jsonb_build_object('lote', v_lote, 'fecha_vencimiento', v_fecha);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_numeric_employee_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'CODE_NOT_NUMERIC: el código de empleado debe contener solo números (recibido: %)', NEW.code;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO ''
AS $function$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1) $function$
;
CREATE OR REPLACE FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_total_pend int;
  v_res public.conteos_inventario%ROWTYPE;
BEGIN
  SELECT branch_id INTO v_branch_id FROM public.conteos_inventario WHERE id = p_conteo_id AND status IN ('BORRADOR','EN_PROGRESO');
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO_O_YA_FINALIZADO';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  SELECT count(*) INTO v_total_pend
  FROM public.conteo_inventario_items
  WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;

  IF p_pendientes_como_cero THEN
    INSERT INTO public.conteo_inventario_item_history
      (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
    SELECT id, 0, sistema_cantidad, 0 - sistema_cantidad, 'SIN_UBICAR',
           'Cerrado como no ubicado al finalizar el conteo', public.auth_employee_id(), 'CIERRE'
    FROM public.conteo_inventario_items
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;

    UPDATE public.conteo_inventario_items
    SET fisico_cantidad = 0,
        diferencia = 0 - sistema_cantidad,
        estado_item = 'SIN_UBICAR',
        contado_por = COALESCE(contado_por, public.auth_employee_id()),
        contado_at = COALESCE(contado_at, now())
    WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NULL;
  END IF;

  UPDATE public.conteo_inventario_items
  SET diferencia = fisico_cantidad - sistema_cantidad
  WHERE conteo_id = p_conteo_id AND fisico_cantidad IS NOT NULL;

  UPDATE public.conteos_inventario
  SET status = 'FINALIZADO',
      finalizado_por = public.auth_employee_id(),
      finalizado_at = now(),
      total_pendientes = v_total_pend,
      pendientes_como_cero = p_pendientes_como_cero
  WHERE id = p_conteo_id;

  PERFORM public.recalcular_totales_conteo(p_conteo_id);

  SELECT * INTO v_res FROM public.conteos_inventario WHERE id = p_conteo_id;

  RETURN jsonb_build_object(
    'total_items', v_res.total_items, 'total_contados', v_res.total_contados,
    'total_diferencias', v_res.total_diferencias, 'total_pendientes', v_res.total_pendientes,
    'pendientes_como_cero', v_res.pendientes_como_cero,
    'valor_faltante', v_res.valor_faltante, 'valor_sobrante', v_res.valor_sobrante
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.find_purchase_dte_document_by_codigo(p_codigo text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT to_json(t) FROM (
    SELECT d.id, d.codigo_generacion, d.tipo_dte, d.fecha_emision, d.monto_total,
           d.json_path, d.pdf_path,
           coalesce(p.nombre, s.nombre, d.emisor_nombre) AS proveedor_nombre
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    LEFT JOIN public.proveedores_maestro p ON p.id = d.proveedor_id
    WHERE upper(d.codigo_generacion) = upper(p_codigo)
    LIMIT 1
  ) t;
$function$
;
CREATE OR REPLACE FUNCTION public.find_sync_gaps(p_date date, p_max_gap integer DEFAULT 50)
 RETURNS TABLE(gap_start integer, gap_end integer, gap_size integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH ids AS (SELECT erp_invoice_id::int AS id FROM public.sales_invoices WHERE fecha = p_date ORDER BY 1),
  consecutive AS (SELECT id, LEAD(id) OVER (ORDER BY id) AS next_id FROM ids)
  SELECT id+1,next_id-1,next_id-id-1 FROM consecutive
  WHERE next_id IS NOT NULL AND next_id-id>1 AND next_id-id-1<=p_max_gap ORDER BY 1;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_psp_capture_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Solo el par MIN/MAX. daily_velocity salio de la condicion: cambia en cada
  -- recalculo sin que el MIN/MAX se mueva, y generaba una fila transitoria por
  -- producto con el mismo captured_at que la real.
  IF (OLD.min_units IS DISTINCT FROM NEW.min_units
   OR OLD.max_units IS DISTINCT FROM NEW.max_units) THEN
    INSERT INTO product_stock_params_history
      (erp_product_id, erp_sucursal_id,
       min_units, max_units, daily_velocity, velocity_30d,
       abc_class, demand_variability, cv, calculated_at)
    VALUES
      (OLD.erp_product_id, OLD.erp_sucursal_id,
       OLD.min_units, OLD.max_units, OLD.daily_velocity, OLD.velocity_30d,
       OLD.abc_class, OLD.demand_variability, OLD.cv, OLD.calculated_at);
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_set_item_factor_unidades()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.factor_unidades := COALESCE((regexp_match(NEW.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1);
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_update_product_last_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_fecha         DATE;
    v_sucursal_id   INTEGER;
    v_units         NUMERIC;
    v_days          INTEGER;
BEGIN
    IF NEW.erp_product_id IS NULL OR NEW.erp_product_id = 0 OR NEW.cantidad <= 0 THEN
        RETURN NEW;
    END IF;

    SELECT inv.fecha::date, esm.erp_sucursal_id
      INTO v_fecha, v_sucursal_id
      FROM sales_invoices inv
      JOIN erp_sucursal_map esm ON esm.branch_id = inv.branch_id AND esm.es_bodega = false
     WHERE inv.id = NEW.invoice_id AND inv.estado != 'ANULADA'
     LIMIT 1;

    IF v_fecha IS NULL THEN RETURN NEW; END IF;

    INSERT INTO product_last_sale (erp_product_id, erp_sucursal_id, last_sale_date)
    VALUES (NEW.erp_product_id, v_sucursal_id, v_fecha)
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
      SET last_sale_date = EXCLUDED.last_sale_date
      WHERE EXCLUDED.last_sale_date > product_last_sale.last_sale_date;

    -- F3.1: rollup incremental de ventas. Solo suma lo que cae DENTRO de la
    -- ventana; la cola la recorta el refresh diario.
    SELECT analysis_days INTO v_days FROM stock_config WHERE id = 1;
    IF v_days IS NOT NULL AND v_fecha >= CURRENT_DATE - v_days THEN
        v_units := NEW.cantidad::numeric * COALESCE(NEW.factor_unidades, 1);

        INSERT INTO product_sales_rollup AS r
          (erp_product_id, erp_sucursal_id, units_analysis, units_30d, analysis_days, updated_at)
        VALUES (
          NEW.erp_product_id, v_sucursal_id,
          v_units,
          CASE WHEN v_fecha >= CURRENT_DATE - 30 THEN v_units ELSE 0 END,
          v_days, now()
        )
        ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
          SET units_analysis = r.units_analysis + EXCLUDED.units_analysis,
              units_30d      = r.units_30d      + EXCLUDED.units_30d,
              updated_at     = now();
    END IF;

    RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.generate_wfm_snapshot(p_branch_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    v_base_hours NUMERIC; v_min_concurrent INT := 2; v_target_rplh NUMERIC := 80;
    v_shrinkage NUMERIC := 0.15; v_extra_hours NUMERIC := 0; v_max_avg_sales NUMERIC := 0;
    v_peak_hour INT; v_peak_day INT; v_total_needed NUMERIC; v_recommended_staff INT; r RECORD;
BEGIN
    v_base_hours := 84 * v_min_concurrent;
    FOR r IN (SELECT EXTRACT(ISODOW FROM sale_date) AS day_of_week, sale_hour, AVG(total_sales) AS avg_sales
              FROM public.branch_hourly_sales WHERE branch_id = p_branch_id
                AND sale_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY 1, 2) LOOP
        IF (r.avg_sales / v_target_rplh) > v_min_concurrent THEN
            v_extra_hours := v_extra_hours + (CEIL(r.avg_sales / v_target_rplh) - v_min_concurrent);
        END IF;
        IF r.avg_sales > v_max_avg_sales THEN
            v_max_avg_sales := r.avg_sales; v_peak_day := r.day_of_week; v_peak_hour := r.sale_hour;
        END IF;
    END LOOP;
    v_total_needed := (v_base_hours + v_extra_hours) * (1 + v_shrinkage);
    v_recommended_staff := CEIL(v_total_needed / 44);
    INSERT INTO public.wfm_snapshots (branch_id, recommended_staff, base_staff_hours,
        extra_volume_hours, shrinkage_hours, total_labor_hours, peak_day_name, peak_hour, peak_avg_sales)
    VALUES (p_branch_id, v_recommended_staff, v_base_hours, v_extra_hours,
        (v_base_hours + v_extra_hours) * v_shrinkage, v_total_needed,
        CASE v_peak_day WHEN 1 THEN 'Lunes' WHEN 2 THEN 'Martes' WHEN 3 THEN 'Miércoles'
            WHEN 4 THEN 'Jueves' WHEN 5 THEN 'Viernes' WHEN 6 THEN 'Sábado' WHEN 7 THEN 'Domingo' END,
        v_peak_hour, v_max_avg_sales);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_active_product_lab_counts()
 RETURNS TABLE(laboratorio_id integer, product_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT laboratorio_id, count(*) AS product_count
  FROM products
  WHERE activo = true AND laboratorio_id IS NOT NULL
  GROUP BY laboratorio_id
$function$
;
CREATE OR REPLACE FUNCTION public.get_ccf_alerts()
 RETURNS TABLE(branch_id bigint, branch_name text, correlativo text, tipo text, estado text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH today_date AS (
    SELECT (current_timestamp AT TIME ZONE 'America/El_Salvador')::date AS d
  )
  SELECT
    si.branch_id,
    b.name                                                   AS branch_name,
    si.correlativo,
    CASE WHEN si.estado = 'NULA' THEN 'ccf_null' ELSE 'ccf_pending' END AS tipo,
    si.estado
  FROM sales_invoices si
  CROSS JOIN today_date t
  JOIN branches b ON b.id = si.branch_id
  WHERE si.tipo_documento = 'CCF'
    AND si.fecha = t.d
    AND (
      si.estado = 'NULA'
      OR ((si.recibido_mh IS NULL OR si.recibido_mh = 'undefined') AND si.estado != 'NULA')
    )
    AND NOT EXISTS (
      SELECT 1 FROM sales_alert_log l
      WHERE l.branch_id  = si.branch_id
        AND l.alert_type = CASE WHEN si.estado = 'NULA' THEN 'ccf_null' ELSE 'ccf_pending' END
        AND l.alert_key  = si.correlativo
    );
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_conteo_item_history(p_item_id uuid)
 RETURNS TABLE(id uuid, evento text, fisico_cantidad integer, sistema_cantidad integer, diferencia integer, estado_item text, nota text, contado_por_nombre text, contado_por_photo_url text, contado_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ver boolean;
BEGIN
  SELECT public.conteo_puede_ver_sistema(ci.conteo_id) INTO v_ver
  FROM public.conteo_inventario_items ci WHERE ci.id = p_item_id;

  RETURN QUERY
  SELECT h.id, h.evento, h.fisico_cantidad,
         CASE WHEN v_ver THEN h.sistema_cantidad END,
         CASE WHEN v_ver THEN h.diferencia END,
         h.estado_item, h.nota,
         NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
         e.photo_url AS contado_por_photo_url,
         h.contado_at
  FROM public.conteo_inventario_item_history h
  LEFT JOIN public.employees e ON e.id = h.contado_por
  WHERE h.item_id = p_item_id
  ORDER BY h.contado_at DESC;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_conteo_items_count(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_erp_product_id integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS (
    SELECT CASE WHEN p_filtro = 'DIFERENCIA' AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  base AS MATERIALIZED (
    SELECT ci.estado_item, ci.diferencia, ci.lote, ci.presentacion, ci.erp_product_id,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
  )
  SELECT count(*) FROM base, cfg
  WHERE (cfg.filtro = 'TODOS' OR cfg.filtro IS NULL
         OR (cfg.filtro = 'PENDIENTES' AND base.estado_item = 'PENDIENTE')
         OR (cfg.filtro = 'DIFERENCIA' AND base.diferencia IS NOT NULL AND base.diferencia != 0)
         OR (cfg.filtro = 'SIN_UBICAR' AND base.estado_item = 'SIN_UBICAR'))
    AND (p_search IS NULL OR p_search = ''
         OR public.norm_search(
              coalesce(base.product_nombre,'') || ' ' || coalesce(base.lote,'') || ' ' ||
              coalesce(base.laboratorio_nombre,'') || ' ' || coalesce(base.presentacion,'')
            ) LIKE ALL (
              ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
            ));
$function$
;
CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE WHEN NOT v_ver THEN NULL
             WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
               COALESCE((
                 SELECT i.cantidad FROM public.inventory i
                 WHERE i.sync_key = ci.source_sync_key
                   AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
               ), 0)
             ELSE ci.sistema_cantidad
        END AS sistema_cantidad,
        CASE WHEN v_ver THEN ci.sistema_inicial END AS sistema_inicial,
        ci.fisico_cantidad,
        CASE WHEN v_ver THEN ci.diferencia END AS diferencia,
        ci.estado_item, ci.nota,
        CASE WHEN v_ver THEN ci.costo_unitario END AS costo_unitario,
        ci.es_agregado_manual,
        CASE WHEN v_ver THEN ci.fisico_primer_conteo END AS fisico_primer_conteo,
        ci.recontado_at,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, p.codigo_barras, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS contado_por_nombre,
        NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS recontado_por_nombre,
        ci.contado_at,
        v_ver AS ver_sistema
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      LEFT JOIN public.employees r ON r.id = ci.recontado_por
      WHERE ci.conteo_id = p_conteo_id
      ORDER BY l.nombre NULLS LAST, p.nombre, ci.lote
    ) t
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_erp_product_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[])
 RETURNS TABLE(id uuid, erp_product_id integer, presentacion text, detalle text, lote text, fecha_vencimiento date, is_vencidos boolean, sistema_cantidad integer, fisico_cantidad integer, diferencia integer, estado_item text, nota text, costo_unitario numeric, es_agregado_manual boolean, product_nombre text, es_antibiotico boolean, foto_url text, laboratorio_nombre text, contado_por_nombre text, contado_at timestamp with time zone, fisico_primer_conteo integer, recontado_at timestamp with time zone, recontado_por_nombre text, contado_por_photo_url text, recontado_por_photo_url text, ediciones_count integer, ver_sistema boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro = 'DIFERENCIA' AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre,
           NULLIF(TRIM(split_part(COALESCE(e.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(e.last_names,''), ' ', 1)), '') AS e_nombre,
           NULLIF(TRIM(split_part(COALESCE(r.first_names,''), ' ', 1) || ' ' || split_part(COALESCE(r.last_names,''), ' ', 1)), '') AS r_nombre,
           e.photo_url AS e_photo, r.photo_url AS r_photo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN public.employees e ON e.id = ci.contado_por
    LEFT JOIN public.employees r ON r.id = ci.recontado_por
    WHERE ci.conteo_id = p_conteo_id
      AND (p_erp_product_id IS NULL OR ci.erp_product_id = p_erp_product_id)
      AND (p_erp_product_ids IS NULL OR ci.erp_product_id = ANY(p_erp_product_ids))
  ),
  live_inv AS MATERIALIZED (
    SELECT i.sync_key, i.cantidad::int AS sistema_live
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  filtered AS (
    SELECT b.* FROM base b
    WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
           OR (v_filtro = 'PENDIENTES' AND b.estado_item = 'PENDIENTE')
           OR (v_filtro = 'DIFERENCIA' AND b.diferencia IS NOT NULL AND b.diferencia != 0)
           OR (v_filtro = 'SIN_UBICAR' AND b.estado_item = 'SIN_UBICAR'))
      AND (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.lote,'') || ' ' ||
             coalesce(b.l_nombre,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
    ORDER BY b.l_nombre NULLS LAST, b.p_nombre, b.lote
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    f.id, f.erp_product_id, f.presentacion, f.detalle, f.lote, f.fecha_vencimiento, f.is_vencidos,
    CASE WHEN NOT v_ver THEN NULL
         WHEN f.fisico_cantidad IS NULL AND NOT f.es_agregado_manual THEN COALESCE(li.sistema_live, 0)
         ELSE f.sistema_cantidad END,
    f.fisico_cantidad,
    CASE WHEN v_ver THEN f.diferencia END,
    f.estado_item, f.nota,
    CASE WHEN v_ver THEN f.costo_unitario END,
    f.es_agregado_manual,
    f.p_nombre, f.p_es_antibiotico, f.p_foto_url, f.l_nombre,
    f.e_nombre, f.contado_at,
    CASE WHEN v_ver THEN f.fisico_primer_conteo END,
    f.recontado_at, f.r_nombre,
    f.e_photo, f.r_photo,
    (SELECT count(*)::int FROM public.conteo_inventario_item_history h
      WHERE h.item_id = f.id AND h.evento IN ('EDICION', 'BORRADO')),
    v_ver
  FROM filtered f
  LEFT JOIN live_inv li ON li.sync_key = f.source_sync_key
  ORDER BY f.l_nombre NULLS LAST, f.p_nombre, f.lote;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_conteo_products_count(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH cfg AS (
    SELECT CASE WHEN p_filtro = 'DIFERENCIA' AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  base AS MATERIALIZED (
    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
  ),
  matched AS (
    SELECT DISTINCT erp_product_id FROM base
    WHERE (p_search IS NULL OR p_search = ''
           OR public.norm_search(
                coalesce(product_nombre,'') || ' ' || coalesce(laboratorio_nombre,'') || ' ' ||
                coalesce(lote,'') || ' ' || coalesce(presentacion,'')
              ) LIKE ALL (
                ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
              ))
  ),
  per_product AS (
    SELECT b.erp_product_id,
           count(*) AS item_count,
           count(*) FILTER (WHERE b.estado_item != 'PENDIENTE') AS contados_count,
           count(*) FILTER (WHERE b.diferencia IS NOT NULL AND b.diferencia != 0) AS con_diferencia_count,
           count(*) FILTER (WHERE b.estado_item = 'SIN_UBICAR') AS sin_ubicar_count
    FROM base b
    WHERE b.erp_product_id IN (SELECT erp_product_id FROM matched)
    GROUP BY b.erp_product_id
  )
  SELECT count(*) FROM per_product, cfg
  WHERE (cfg.filtro = 'TODOS' OR cfg.filtro IS NULL
         OR (cfg.filtro = 'PENDIENTES' AND per_product.contados_count < per_product.item_count)
         OR (cfg.filtro = 'DIFERENCIA' AND per_product.con_diferencia_count > 0)
         OR (cfg.filtro = 'SIN_UBICAR' AND per_product.sin_ubicar_count > 0));
$function$
;
CREATE OR REPLACE FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text DEFAULT NULL::text, p_filtro text DEFAULT 'TODOS'::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS TABLE(erp_product_id integer, product_nombre text, laboratorio_nombre text, es_antibiotico boolean, foto_url text, item_count integer, contados_count integer, sistema_total integer, fisico_total integer, diferencia_total integer, con_diferencia_count integer, con_vencidos_count integer, con_proximos_count integer, sin_ubicar_count integer, ver_sistema boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
  v_ver boolean := public.conteo_puede_ver_sistema(p_conteo_id);
  v_filtro text;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  v_filtro := CASE WHEN p_filtro = 'DIFERENCIA' AND NOT v_ver THEN 'TODOS' ELSE p_filtro END;

  RETURN QUERY
  WITH base AS MATERIALIZED (
    SELECT ci.*, p.nombre AS p_nombre, p.es_antibiotico AS p_es_antibiotico, p.foto_url AS p_foto_url,
           l.nombre AS l_nombre
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    WHERE ci.conteo_id = p_conteo_id
  ),
  live_inv AS MATERIALIZED (
    SELECT i.sync_key, i.cantidad::int AS sistema_live
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
  ),
  matched AS (
    SELECT DISTINCT b.erp_product_id AS m_erp_product_id FROM base b
    WHERE (v_pats IS NULL OR public.norm_search(
             coalesce(b.p_nombre,'') || ' ' || coalesce(b.l_nombre,'') || ' ' ||
             coalesce(b.lote,'') || ' ' || coalesce(b.presentacion,'')
           ) LIKE ALL (v_pats))
  ),
  with_live AS (
    SELECT b.*,
           CASE
             WHEN b.fisico_cantidad IS NULL AND NOT b.es_agregado_manual THEN COALESCE(li.sistema_live, 0)
             ELSE b.sistema_cantidad
           END AS sistema_now
    FROM base b
    LEFT JOIN live_inv li ON li.sync_key = b.source_sync_key
    WHERE b.erp_product_id IN (SELECT m.m_erp_product_id FROM matched m)
  ),
  per_product AS (
    SELECT
      w.erp_product_id,
      max(w.p_nombre) AS product_nombre,
      max(w.l_nombre) AS laboratorio_nombre,
      bool_or(w.p_es_antibiotico) AS es_antibiotico,
      max(w.p_foto_url) AS foto_url,
      count(*)::int AS item_count,
      count(*) FILTER (WHERE w.estado_item != 'PENDIENTE')::int AS contados_count,
      sum(w.sistema_now)::int AS sistema_total,
      sum(w.fisico_cantidad)::int AS fisico_total,
      sum(w.diferencia)::int AS diferencia_total,
      count(*) FILTER (WHERE w.diferencia IS NOT NULL AND w.diferencia != 0)::int AS con_diferencia_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento < CURRENT_DATE)::int AS con_vencidos_count,
      count(*) FILTER (WHERE w.fecha_vencimiento IS NOT NULL AND w.fecha_vencimiento >= CURRENT_DATE AND w.fecha_vencimiento <= CURRENT_DATE + 90)::int AS con_proximos_count,
      count(*) FILTER (WHERE w.estado_item = 'SIN_UBICAR')::int AS sin_ubicar_count
    FROM with_live w
    GROUP BY w.erp_product_id
  )
  SELECT
    pp.erp_product_id, pp.product_nombre, pp.laboratorio_nombre, pp.es_antibiotico, pp.foto_url,
    pp.item_count, pp.contados_count,
    CASE WHEN v_ver THEN pp.sistema_total END,
    pp.fisico_total,
    CASE WHEN v_ver THEN pp.diferencia_total END,
    CASE WHEN v_ver THEN pp.con_diferencia_count END,
    pp.con_vencidos_count, pp.con_proximos_count,
    pp.sin_ubicar_count,
    v_ver
  FROM per_product pp
  WHERE (v_filtro = 'TODOS' OR v_filtro IS NULL
         OR (v_filtro = 'PENDIENTES' AND pp.contados_count < pp.item_count)
         OR (v_filtro = 'DIFERENCIA' AND pp.con_diferencia_count > 0)
         OR (v_filtro = 'SIN_UBICAR' AND pp.sin_ubicar_count > 0))
  ORDER BY pp.laboratorio_nombre NULLS LAST, pp.product_nombre
  LIMIT p_limit OFFSET p_offset;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result jsonb;
BEGIN
  IF NOT auth_has_module_permission('minmax', 'can_view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere acceso a Min/Max';
  END IF;

  WITH unit_costs AS (
    SELECT DISTINCT ON (product_id)
      product_id,
      (costo / factor::numeric) AS unit_cost
    FROM public.product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  params AS (
    SELECT
      psp.erp_product_id,
      psp.min_units                                                                        AS pub_min,
      psp.max_units                                                                        AS pub_max,
      COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min END, psp.min_units) AS eff_min,
      COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max END, psp.max_units) AS eff_max,
      (psp.draft_status = 'pending' AND psp.draft_min IS NOT NULL)                        AS has_draft,
      uc.unit_cost
    FROM public.product_stock_params psp
    LEFT JOIN unit_costs uc ON uc.product_id = psp.erp_product_id
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
      AND psp.is_hidden IS NOT TRUE
      AND (psp.min_units IS NOT NULL OR (psp.draft_status = 'pending' AND psp.draft_min IS NOT NULL))
  )
  SELECT jsonb_build_object(
    'pub_min_cost',  ROUND(COALESCE(SUM(pub_min * unit_cost), 0)::numeric, 2),
    'pub_max_cost',  ROUND(COALESCE(SUM(pub_max * unit_cost), 0)::numeric, 2),
    'eff_min_cost',  ROUND(COALESCE(SUM(eff_min * unit_cost), 0)::numeric, 2),
    'eff_max_cost',  ROUND(COALESCE(SUM(eff_max * unit_cost), 0)::numeric, 2),
    'product_count', COUNT(*),
    'draft_count',   COUNT(*) FILTER (WHERE has_draft),
    'costed_pct',    CASE WHEN COUNT(*) > 0
                       THEN ROUND((COUNT(CASE WHEN unit_cost IS NOT NULL THEN 1 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)
                       ELSE 0 END
  ) INTO result FROM params;
  RETURN COALESCE(result, '{}'::jsonb);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE result jsonb;
BEGIN
  WITH unit_costs AS (
    SELECT DISTINCT ON (product_id)
      product_id,
      (costo / factor::numeric) AS unit_cost
    FROM product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  inv_total AS (
    SELECT
      erp_product_id,
      SUM(cantidad * COALESCE((regexp_match(detalle, '\d+[xX](\d+)'))[1]::int, 1))::bigint AS total_units
    FROM inventory
    WHERE erp_sucursal_id = p_erp_sucursal_id
      AND is_vencidos = false
    GROUP BY erp_product_id
  ),
  params AS (
    SELECT
      erp_product_id,
      COALESCE(manual_min, min_units, draft_min, 0) AS eff_min,
      COALESCE(manual_max, max_units, draft_max, 0) AS eff_max
    FROM product_stock_params
    WHERE erp_sucursal_id = p_erp_sucursal_id
  ),
  valued AS (
    SELECT
      i.erp_product_id,
      i.total_units,
      p.erp_product_id IS NOT NULL                                                          AS has_params,
      uc.unit_cost,
      i.total_units * COALESCE(uc.unit_cost, 0)                                            AS stock_value,
      CASE
        WHEN p.erp_product_id IS NOT NULL AND i.total_units > 0 AND COALESCE(p.eff_max, 0) > 0
          THEN LEAST(i.total_units, p.eff_max) * COALESCE(uc.unit_cost, 0)
        ELSE 0
      END                                                                                   AS useful_value,
      CASE
        WHEN p.erp_product_id IS NOT NULL AND i.total_units > COALESCE(p.eff_max, 0) AND COALESCE(p.eff_max, 0) > 0
          THEN (i.total_units - p.eff_max) * COALESCE(uc.unit_cost, 0)
        ELSE 0
      END                                                                                   AS excess_value,
      CASE
        WHEN p.erp_product_id IS NULL
          THEN i.total_units * COALESCE(uc.unit_cost, 0)
        ELSE 0
      END                                                                                   AS dead_value
    FROM inv_total i
    LEFT JOIN params     p  ON p.erp_product_id = i.erp_product_id
    LEFT JOIN unit_costs uc ON uc.product_id    = i.erp_product_id
    WHERE i.total_units > 0
  )
  SELECT jsonb_build_object(
    'total_cost',   ROUND(COALESCE(SUM(stock_value),  0)::numeric, 2),
    'useful_cost',  ROUND(COALESCE(SUM(useful_value), 0)::numeric, 2),
    'excess_cost',  ROUND(COALESCE(SUM(excess_value), 0)::numeric, 2),
    'dead_cost',    ROUND(COALESCE(SUM(dead_value),   0)::numeric, 2),
    'coverage_pct', CASE
                      WHEN SUM(stock_value) > 0
                        THEN ROUND((SUM(useful_value) / SUM(stock_value) * 100)::numeric, 1)
                      ELSE 0
                    END,
    'costed_pct',   CASE
                      WHEN COUNT(*) > 0
                        THEN ROUND((COUNT(CASE WHEN unit_cost IS NOT NULL THEN 1 END)::numeric / COUNT(*)::numeric * 100)::numeric, 1)
                      ELSE 0
                    END
  )
  INTO result
  FROM valued;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_kiosk_auth_code(p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch BIGINT;
    v_bucket TIMESTAMPTZ := date_trunc('hour', now());
BEGIN
    IF NOT (SELECT auth_has_module_permission('kiosk_pin', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    v_branch := COALESCE(p_branch_id, (SELECT auth_employee_branch_id())::bigint);
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'BRANCH_REQUIRED';
    END IF;

    IF p_branch_id IS NOT NULL
       AND (SELECT auth_module_scope('kiosk_pin')) <> 'ALL'
       AND p_branch_id <> (SELECT auth_employee_branch_id())::bigint THEN
        RAISE EXCEPTION 'FORBIDDEN_BRANCH';
    END IF;

    RETURN json_build_object(
        'code',        public.kiosk_auth_code_for(v_branch, v_bucket, false),
        'su_suffix',   public.kiosk_auth_code_for(v_branch, v_bucket, true),
        'branch_id',   v_branch,
        'valid_until', v_bucket + INTERVAL '1 hour'
    );
END $function$
;
CREATE OR REPLACE FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id BIGINT;
  v_payload   JSON;
  v_prev_week date;
BEGIN
  SELECT branch_id INTO v_branch_id
  FROM public.kiosk_devices
  WHERE id = p_device_id AND device_token = p_device_token;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Kiosco no encontrado o credenciales inválidas';
  END IF;

  v_prev_week := p_week_start - INTERVAL '7 days';

  SELECT json_build_object(
    -- Turnos: incluye turnos globales (branch_id NULL) y de la sucursal
    'shifts', (
      SELECT COALESCE(json_agg(s), '[]'::json)
      FROM public.shifts s
      WHERE (s.branch_id IS NULL OR s.branch_id = v_branch_id)
        AND s.is_active = true
    ),

    'announcements', (
      SELECT COALESCE(json_agg(a), '[]'::json)
      FROM public.announcements a
      WHERE a.is_archived = false
    ),

    -- Empleados: branch_id principal + multi-sucursal desde employee_branches
    'employees', (
      SELECT COALESCE(json_agg(json_build_object(
        'id',                e.id,
        'name',              COALESCE(e.name, e.first_names || ' ' || e.last_names),
        'first_names',       e.first_names,
        'last_names',        e.last_names,
        'code',              e.code,
        'branch_id',         e.branch_id,
        'photo_url',         e.photo_url,
        'gender',            e.gender,
        'birth_date',        e.birth_date,
        'email',             e.email,
        'role_id',           e.role_id,
        'secondary_role_id', e.secondary_role_id,
        'role',              main_r.name,
        'secondary_role',    sec_r.name,
        -- Roster semana actual (solo PUBLISHED); si vacío cae a semana anterior
        'weekly_roster', COALESCE(
          NULLIF(er.schedule_data, '{}'::jsonb),
          er_prev.schedule_data,
          '{}'::jsonb
        ),
        -- Evento activo hoy (VACATION/DISABILITY/PERMIT/SUPPORT) sin recall de vacaciones
        'active_event_type', (
          SELECT ev.type
          FROM public.employee_events ev
          WHERE ev.employee_id = e.id
            AND ev.type IN ('VACATION', 'DISABILITY', 'PERMIT', 'SUPPORT')
            AND ev.date <= CURRENT_DATE
            AND COALESCE(ev.metadata->>'endDate', ev.date::text) >= CURRENT_DATE::text
            AND NOT EXISTS (
              SELECT 1 FROM public.employee_events recall
              WHERE recall.employee_id = e.id
                AND recall.type = 'VACATION_RECALL'
                AND recall.date = CURRENT_DATE
            )
          ORDER BY ev.date DESC
          LIMIT 1
        )
      )), '[]'::json)
      FROM (
        SELECT e.id
        FROM public.employees e
        WHERE e.branch_id = v_branch_id AND e.status = 'ACTIVO'
        UNION
        SELECT eb.employee_id AS id
        FROM public.employee_branches eb
        JOIN public.employees emp ON emp.id = eb.employee_id
        WHERE eb.branch_id = v_branch_id AND emp.status = 'ACTIVO'
      ) AS emp_ids
      JOIN public.employees e ON e.id = emp_ids.id
      LEFT JOIN public.roles main_r ON e.role_id = main_r.id
      LEFT JOIN public.roles sec_r  ON e.secondary_role_id = sec_r.id
      -- Only PUBLISHED rosters qualify; DRAFT rosters are ignored
      LEFT JOIN public.employee_rosters er
             ON e.id = er.employee_id AND er.week_start_date = p_week_start AND er.status = 'PUBLISHED'
      LEFT JOIN public.employee_rosters er_prev
             ON e.id = er_prev.employee_id AND er_prev.week_start_date = v_prev_week AND er_prev.status = 'PUBLISHED'
    ),

    'branches', (
      SELECT COALESCE(json_agg(b), '[]'::json)
      FROM (SELECT id, name FROM public.branches ORDER BY name) b
    ),

    'holidays', (
      SELECT COALESCE(json_agg(h), '[]'::json)
      FROM public.holidays h
      WHERE EXTRACT(YEAR FROM h.holiday_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         OR h.is_recurring = true
    )
  ) INTO v_payload;

  RETURN v_payload;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN (
        SELECT COALESCE(jsonb_agg(emp_data), '[]'::jsonb)
        FROM (
            SELECT jsonb_build_object(
                'id',              e.id,
                'name',            e.name,
                'code',            e.code,
                'kiosk_pin',       e.kiosk_pin,
                'photo_url',       e.photo_url,
                'status',          e.status,
                'branch_id',       e.branch_id,
                'role',            COALESCE(r.name, ''),
                'secondary_role',  COALESCE(sr.name, ''),
                'exceptions',      COALESCE(e.exceptions, '[]'::jsonb),
                'active_event_type', (
                    SELECT ee.type
                    FROM   employee_events ee
                    WHERE  ee.employee_id = e.id
                      AND  ee.date::date    <= CURRENT_DATE
                      AND  ee.end_date::date >= CURRENT_DATE
                      AND  ee.type IN ('VACATION','DISABILITY','PERMIT','INDUCTION')
                    ORDER BY ee.created_at DESC
                    LIMIT  1
                ),
                'weekly_roster',
                    -- base home roster (draft or published)
                    COALESCE(
                        (SELECT er.schedule_data
                         FROM   employee_rosters er
                         WHERE  er.employee_id    = e.id
                           AND  er.week_start_date = p_week_start
                         ORDER BY (er.status = 'PUBLISHED') DESC
                         LIMIT  1),
                        '{}'::jsonb
                    )
                    ||
                    -- coverage days override home-roster days for this branch
                    COALESCE(
                        (SELECT jsonb_object_agg(sc2.day_of_week::text, sc2.schedule_data)
                         FROM   schedule_coverage sc2
                         WHERE  sc2.employee_id        = e.id
                           AND  sc2.coverage_branch_id = p_branch_id
                           AND  sc2.week_start_date    = p_week_start),
                        '{}'::jsonb
                    )
            ) AS emp_data
            FROM (
                SELECT DISTINCT employee_id
                FROM   schedule_coverage
                WHERE  coverage_branch_id = p_branch_id
                  AND  week_start_date    = p_week_start
            ) covered
            JOIN employees_safe e ON e.id = covered.employee_id
            LEFT JOIN roles r  ON r.id  = e.role_id
            LEFT JOIN roles sr ON sr.id = e.secondary_role_id
            WHERE UPPER(COALESCE(e.status, 'ACTIVO')) <> 'INACTIVO'
        ) sub
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer)
 RETURNS TABLE(erp_product_id integer, last_sale_date date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    ii.erp_product_id,
    MAX(inv.fecha)::date AS last_sale_date
  FROM sales_invoice_items ii
  JOIN sales_invoices inv       ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm      ON bm.branch_id = inv.branch_id
  WHERE bm.erp_sucursal_id = p_erp_sucursal_id
    AND inv.estado         != 'ANULADA'
    AND ii.erp_product_id  IS NOT NULL
    AND ii.cantidad         > 0
  GROUP BY ii.erp_product_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_lockable_modules()
 RETURNS TABLE(module_key text, veces integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
  WITH fuentes AS (
    SELECT COALESCE(qual, with_check) AS src FROM pg_policies WHERE schemaname = 'public'
    UNION ALL
    SELECT p.prosrc FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  ),
  claves AS (
    SELECT trim(both '''' from m[1]) AS module_key
    FROM fuentes,
         regexp_matches(src, 'auth_can_edit_any\(ARRAY\[([^\]]+)\]', 'g') a(arr),
         regexp_matches(a.arr[1], '''[^'']+''', 'g') m
  )
  SELECT c.module_key, count(*)::integer AS veces
  FROM claves c
  WHERE EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.module_key = c.module_key)
  GROUP BY c.module_key
  ORDER BY c.module_key;
$function$
;
CREATE OR REPLACE FUNCTION public.get_logistics_chief_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chief_role  int;
  v_parent_role int;
  v_today       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids         uuid[];
BEGIN
  SELECT id, parent_role_id INTO v_chief_role, v_parent_role
  FROM roles WHERE name ILIKE '%compras%logistica%' ORDER BY id LIMIT 1;

  IF v_chief_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e
    WHERE e.role_id = v_chief_role AND e.status = 'ACTIVO'
      AND NOT EXISTS (
        SELECT 1 FROM employee_events ev
        WHERE ev.employee_id = e.id
          AND ev.type IN ('VACATION','DISABILITY','PERMIT')
          AND ev.date = v_today
      );
  END IF;

  IF (v_ids IS NULL OR array_length(v_ids, 1) IS NULL) AND v_parent_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e WHERE e.role_id = v_parent_role AND e.status = 'ACTIVO';
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_minmax_approver_ids()
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sup_role    CONSTANT int := 13; -- Supervisor/a de Ventas — ver reference_roles_and_approvers
  v_parent_role int;
  v_today       date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_ids         uuid[];
BEGIN
  SELECT parent_role_id INTO v_parent_role FROM roles WHERE id = v_sup_role;

  SELECT array_agg(e.id) INTO v_ids
  FROM employees e
  WHERE e.role_id = v_sup_role AND e.status = 'ACTIVO'
    AND NOT EXISTS (
      SELECT 1 FROM employee_events ev
      WHERE ev.employee_id = e.id
        AND ev.type IN ('VACATION','DISABILITY','PERMIT')
        AND ev.date = v_today
    );

  -- Fallback: jefe inmediato (rol padre) si no hay supervisores disponibles
  IF (v_ids IS NULL OR array_length(v_ids, 1) IS NULL) AND v_parent_role IS NOT NULL THEN
    SELECT array_agg(e.id) INTO v_ids
    FROM employees e WHERE e.role_id = v_parent_role AND e.status = 'ACTIVO';
  END IF;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_network_summary_json()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult
    FROM stock_config LIMIT 1
  ),
  pres_factors AS (
    SELECT product_id, UPPER(descripcion) AS desc_key, MAX(factor) AS factor
    FROM product_precios
    GROUP BY product_id, UPPER(descripcion)
  ),
  inv AS (
    SELECT i.erp_product_id, i.erp_sucursal_id,
      SUM(i.cantidad * COALESCE(pf.factor, 1))::bigint AS stock
    FROM inventory i
    LEFT JOIN pres_factors pf ON pf.product_id = i.erp_product_id AND pf.desc_key = UPPER(i.detalle)
    WHERE i.is_vencidos = false
    GROUP BY i.erp_product_id, i.erp_sucursal_id
  ),
  params AS (
    SELECT erp_product_id, erp_sucursal_id,
      (minmax_effective(min_units, manual_min)) AS eff_min,
      (minmax_effective(max_units, manual_max)) AS eff_max,
      COALESCE(daily_velocity, 0)       AS daily_velocity,
      abc_class, revenue_6m
    FROM product_stock_params
  ),
  pairs AS (
    SELECT
      p.erp_product_id, p.erp_sucursal_id,
      COALESCE(i.stock, 0)              AS current_stock,
      p.eff_min, p.eff_max,
      p.daily_velocity, p.abc_class, p.revenue_6m,
      CASE
        WHEN COALESCE(i.stock, 0) = 0                                                           THEN 'out_of_stock'
        WHEN COALESCE(i.stock, 0) < p.eff_min                                                  THEN 'below_min'
        WHEN COALESCE(i.stock, 0)::numeric < p.eff_min * (SELECT approaching_mult FROM config) THEN 'approaching'
        WHEN COALESCE(i.stock, 0) > p.eff_max AND p.eff_max > 0                                THEN 'overstocked'
        ELSE 'ok'
      END AS alert_status
    FROM params p
    LEFT JOIN inv i ON i.erp_product_id = p.erp_product_id AND i.erp_sucursal_id = p.erp_sucursal_id
  ),
  agg AS (
    SELECT
      pr.erp_product_id,
      COALESCE(prod.nombre, '(sin nombre)') AS product_name,
      MAX(pr.abc_class)                     AS abc_class,
      MAX(pr.revenue_6m)                    AS max_revenue_6m,
      SUM(CASE pr.alert_status
        WHEN 'out_of_stock' THEN 4
        WHEN 'below_min'    THEN 3
        WHEN 'approaching'  THEN 1
        WHEN 'overstocked'  THEN 1
        ELSE 0
      END)::integer AS alert_severity,
      jsonb_object_agg(
        pr.erp_sucursal_id::text,
        jsonb_build_object(
          'stk', pr.current_stock,
          'min', pr.eff_min,
          'max', pr.eff_max,
          'vel', pr.daily_velocity,
          'alr', pr.alert_status
        )
      ) AS branches
    FROM pairs pr
    JOIN products prod ON prod.id = pr.erp_product_id
    GROUP BY pr.erp_product_id, prod.nombre
  )
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT * FROM agg ORDER BY alert_severity DESC, max_revenue_6m DESC NULLS LAST
  ) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_no_sales_products(p_erp_sucursal_id integer)
 RETURNS TABLE(erp_product_id integer, product_name text, current_stock bigint, cost_value numeric, fecha_vencimiento_min date, sold_in jsonb, min_qty numeric, max_qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  sales_6m AS (
    SELECT
      bm.esid                                                                                  AS suc_id,
      ii.erp_product_id                                                                        AS prod_id,
      SUM(ii.cantidad::numeric
          * COALESCE((regexp_match(ii.presentacion, '\d+[xX](\d+)'))[1]::int, 1))::bigint      AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2)                                                   AS revenue
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id  = ii.invoice_id
    JOIN branch_map bm      ON bm.bid = inv.branch_id
    WHERE inv.fecha  >= (CURRENT_DATE - INTERVAL '6 months')
      AND inv.estado != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    GROUP BY bm.esid, ii.erp_product_id
  ),
  inv_cur AS (
    SELECT
      inv.erp_product_id                                                                       AS prod_id,
      SUM(inv.cantidad
          * COALESCE((regexp_match(inv.detalle, '\d+[xX](\d+)'))[1]::int, 1))::bigint          AS total_units,
      MIN(inv.fecha_vencimiento) FILTER (WHERE inv.fecha_vencimiento IS NOT NULL)              AS min_venc
    FROM inventory inv
    WHERE inv.erp_sucursal_id = p_erp_sucursal_id AND inv.is_vencidos = false
    GROUP BY inv.erp_product_id
  ),
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios
    WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  minmax_cur AS (
    SELECT
      psp.erp_product_id                        AS prod_id,
      COALESCE(psp.manual_min, psp.min_units)   AS min_qty,
      COALESCE(psp.manual_max, psp.max_units)   AS max_qty
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
  ),
  no_sales AS (
    SELECT p.id AS prod_id, p.nombre
    FROM products p
    WHERE p.activo = true
      AND NOT EXISTS (
        SELECT 1 FROM sales_6m sx WHERE sx.prod_id = p.id AND sx.suc_id = p_erp_sucursal_id
      )
      AND EXISTS (SELECT 1 FROM minmax_cur mm WHERE mm.prod_id = p.id)
  )
  SELECT
    ns.prod_id                                                          AS erp_product_id,
    ns.nombre                                                           AS product_name,
    COALESCE(ic.total_units, 0)                                        AS current_stock,
    ROUND(COALESCE(ic.total_units, 0) * COALESCE(uc.unit_cost, 0), 2) AS cost_value,
    ic.min_venc                                                         AS fecha_vencimiento_min,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('esid', s.suc_id, 'units', s.units_sold, 'rev', s.revenue)
        ORDER BY s.revenue DESC
      ) FILTER (WHERE s.suc_id IS NOT NULL),
      '[]'::jsonb
    )                                                                   AS sold_in,
    mm.min_qty,
    mm.max_qty
  FROM no_sales ns
  LEFT JOIN inv_cur    ic ON ic.prod_id    = ns.prod_id
  LEFT JOIN unit_costs uc ON uc.product_id = ns.prod_id
  LEFT JOIN minmax_cur mm ON mm.prod_id    = ns.prod_id
  LEFT JOIN sales_6m   s  ON s.prod_id    = ns.prod_id AND s.suc_id != p_erp_sucursal_id
  GROUP BY ns.prod_id, ns.nombre, ic.total_units, uc.unit_cost, ic.min_venc, mm.min_qty, mm.max_qty
  ORDER BY CASE WHEN COALESCE(ic.total_units, 0) > 0 THEN 0 ELSE 1 END, ns.nombre;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pausa_razones_stats(p_desde date DEFAULT (CURRENT_DATE - 30), p_hasta date DEFAULT CURRENT_DATE)
 RETURNS TABLE(razon text, conteo integer, min_promedio integer)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT
        COALESCE(pph.razon, 'Sin razón')  AS razon,
        COUNT(*)::integer                  AS conteo,
        AVG(
            EXTRACT(EPOCH FROM (
                COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at
            ))::integer / 60
        )::integer                         AS min_promedio
    FROM pedido_pausa_historial pph
    JOIN pedidos p ON p.id = pph.pedido_id
    WHERE p.created_at::date BETWEEN p_desde AND p_hasta
    GROUP BY COALESCE(pph.razon, 'Sin razón')
    ORDER BY COUNT(*) DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_diferencias_stats(p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
WITH diffs AS (
    SELECT
        pi.id,
        pi.erp_sucursal_id,
        pi.erp_product_id,
        pi.pedido_id,
        pi.cantidad_asignada,
        pi.cantidad_recibida,
        pi.nota_diferencia,
        pi.received_at,
        pi.resuelta_at,
        p.nombre                 AS product_name,
        pr.tipo                  AS presentacion_tipo,
        pd.numero                AS pedido_numero
    FROM pedido_items pi
    JOIN pedidos pd      ON pd.id = pi.pedido_id
    JOIN products p      ON p.id  = pi.erp_product_id
    LEFT JOIN presentaciones pr ON pr.id = pi.erp_presentacion_id
    WHERE pi.cantidad_recibida IS NOT NULL
      AND pi.cantidad_recibida < pi.cantidad_asignada
      AND (p_desde IS NULL OR pi.received_at >= p_desde)
      AND (p_hasta IS NULL OR pi.received_at <= p_hasta)
),
por_sucursal AS (
    SELECT
        erp_sucursal_id,
        COUNT(DISTINCT pedido_id)::integer                         AS pedidos_con_diferencia,
        COUNT(*)::integer                                          AS items_con_diferencia,
        SUM(cantidad_asignada)::integer                            AS packs_asignados,
        SUM(cantidad_recibida)::integer                            AS packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs
    GROUP BY erp_sucursal_id
    ORDER BY packs_faltantes DESC
),
por_producto AS (
    SELECT
        erp_product_id,
        product_name,
        presentacion_tipo,
        COUNT(*)::integer                                          AS veces_con_diferencia,
        SUM(cantidad_asignada)::integer                            AS packs_asignados,
        SUM(cantidad_recibida)::integer                            AS packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS packs_faltantes
    FROM diffs
    GROUP BY erp_product_id, product_name, presentacion_tipo
    ORDER BY packs_faltantes DESC
    LIMIT 50
),
detalle AS (
    SELECT
        id                                                         AS pedido_item_id,
        erp_sucursal_id,
        erp_product_id,
        pedido_numero,
        product_name,
        cantidad_asignada,
        cantidad_recibida,
        (cantidad_asignada - cantidad_recibida)                    AS diferencia,
        nota_diferencia,
        received_at,
        resuelta_at
    FROM diffs
    ORDER BY received_at DESC NULLS LAST
    LIMIT 500
),
totales AS (
    SELECT
        COUNT(DISTINCT pedido_id)::integer                         AS pedidos_afectados,
        COUNT(*)::integer                                          AS items_afectados,
        SUM(cantidad_asignada)::integer                            AS total_packs_asignados,
        SUM(cantidad_recibida)::integer                            AS total_packs_recibidos,
        (SUM(cantidad_asignada) - SUM(cantidad_recibida))::integer AS total_packs_faltantes
    FROM diffs
)
SELECT json_build_object(
    'por_sucursal', (SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json) FROM por_sucursal s),
    'por_producto', (SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json) FROM por_producto p),
    'detalle',      (SELECT COALESCE(json_agg(row_to_json(d)), '[]'::json) FROM detalle d),
    'totales',      (SELECT row_to_json(t) FROM totales t)
);
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_generar_dashboard(p_sucursal_ids integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 7])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET statement_timeout TO '60s'
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
RETURN (
WITH
suc_map    AS (SELECT erp_sucursal_id, branch_id FROM erp_sucursal_map WHERE NOT es_bodega),
bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

inv_dedup AS (
  SELECT DISTINCT ON (
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
  )
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    i.cantidad, i.detalle,
    i.cantidad::numeric * COALESCE(
      vf.factor,
      NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric,
      1
    ) AS unidades
  FROM inventory i
  LEFT JOIN v_product_factor vf
         ON vf.product_id = i.erp_product_id
        AND vf.pres_key   = UPPER(TRIM(i.presentacion))
  ORDER BY
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
),

inv_agg AS (
  SELECT erp_sucursal_id, erp_product_id,
    COALESCE(SUM(unidades) FILTER (WHERE is_vencidos = false), 0)::numeric AS units_vivos
  FROM inv_dedup
  GROUP BY erp_sucursal_id, erp_product_id
),

pending_committed AS (
  SELECT pi.erp_product_id,
    SUM(pi.cantidad_asignada::numeric * COALESCE(pp.factor, 1)) AS committed_units
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  LEFT JOIN product_precios pp
    ON pp.product_id = pi.erp_product_id AND pp.id_presentacion = pi.erp_presentacion_id
  WHERE pi.status = 'pendiente'
    AND pd.status NOT IN ('anulado', 'completado')
    AND (SELECT pedido_recepcion_activa FROM stock_config WHERE id = 1)
  GROUP BY pi.erp_product_id
),

pref_factor AS (
  SELECT dr.erp_product_id, pp.factor AS pref
  FROM dispatch_rules dr
  JOIN product_precios pp ON pp.product_id = dr.erp_product_id
                          AND pp.id_presentacion = dr.dispatch_id_presentacion
  WHERE dr.dispatch_id_presentacion IS NOT NULL
),

necesidades AS (
  SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
    psp.erp_sucursal_id,
    psp.erp_product_id,
    pp.id_presentacion AS erp_presentacion_id,
    ROUND(
      COALESCE(psp.manual_max, psp.max_units, 0)::numeric
      / NULLIF(pp.factor::numeric, 0)
    )::integer AS effective_max,
    GREATEST(0,
      ROUND(
        COALESCE(psp.manual_max, psp.max_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer
      - FLOOR(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0))
    )::integer AS reponer
  FROM product_stock_params psp
  JOIN product_precios pp
       ON pp.product_id = psp.erp_product_id AND pp.activo = true
  LEFT JOIN inv_agg ia
         ON ia.erp_sucursal_id = psp.erp_sucursal_id
        AND ia.erp_product_id  = psp.erp_product_id
  LEFT JOIN pref_factor pf ON pf.erp_product_id = psp.erp_product_id
  WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
    AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    AND ROUND(
          COALESCE(psp.manual_max, psp.max_units, 0)::numeric
          / NULLIF(pp.factor::numeric, 0)
        ) >= 1
  ORDER BY
    psp.erp_sucursal_id,
    psp.erp_product_id,
    (pp.factor = COALESCE(pf.pref, -1)) DESC,
    CASE WHEN pf.pref IS NULL THEN (pp.factor > 1)::int ELSE 0 END DESC,
    pp.factor ASC,
    pp.id_presentacion
),
necesidades_pos AS (SELECT * FROM necesidades WHERE reponer > 0),

bodega_net AS (
  SELECT inv.erp_product_id,
    SUM(inv.unidades) - COALESCE(MAX(pc.committed_units), 0) AS net_units
  FROM inv_dedup inv
  LEFT JOIN pending_committed pc ON pc.erp_product_id = inv.erp_product_id
  WHERE inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
    AND inv.is_vencidos = false AND inv.unidades > 0
  GROUP BY inv.erp_product_id
),
bodega_disponible AS (
  SELECT erp_product_id FROM bodega_net WHERE net_units > 0
),

flagged AS (
  SELECT n.erp_sucursal_id, n.erp_product_id, n.effective_max, n.reponer,
    EXISTS (SELECT 1 FROM bodega_disponible b WHERE b.erp_product_id = n.erp_product_id) AS tiene_bodega
  FROM necesidades_pos n
),

-- ── payload 1: stats por sucursal (= get_pedido_sucursal_stats) ──
last_pedidos AS (
  SELECT pi.erp_sucursal_id, MAX(pd.created_at) AS last_pedido_at
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  WHERE pi.erp_sucursal_id = ANY(p_sucursal_ids)
    AND pd.status NOT IN ('anulado')
  GROUP BY pi.erp_sucursal_id
),
main_stats AS (
  SELECT
    erp_sucursal_id,
    COUNT(DISTINCT erp_product_id)::integer                                 AS total_productos,
    SUM(reponer)::integer                                                    AS necesidad_packs,
    COALESCE(SUM(reponer) FILTER (WHERE tiene_bodega),     0)::integer      AS con_bodega_packs,
    COALESCE(SUM(reponer) FILTER (WHERE NOT tiene_bodega), 0)::integer      AS sin_bodega_packs,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE tiene_bodega)::integer     AS con_bodega_productos,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE NOT tiene_bodega)::integer AS sin_bodega_productos,
    ROUND(
      SUM(LEAST(100.0, reponer::numeric / NULLIF(effective_max, 0) * 100) * reponer)
      / NULLIF(SUM(reponer::numeric), 0)
    )::integer AS avg_urgencia_pct
  FROM flagged
  GROUP BY erp_sucursal_id
),
stats_json AS (
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'erp_sucursal_id',      ms.erp_sucursal_id,
      'total_productos',      ms.total_productos,
      'necesidad_packs',      ms.necesidad_packs,
      'con_bodega_packs',     ms.con_bodega_packs,
      'sin_bodega_packs',     ms.sin_bodega_packs,
      'con_bodega_productos', ms.con_bodega_productos,
      'sin_bodega_productos', ms.sin_bodega_productos,
      'avg_urgencia_pct',     ms.avg_urgencia_pct,
      'last_pedido_at',       lp.last_pedido_at
    ) ORDER BY ms.erp_sucursal_id
  ), '[]'::jsonb) AS j
  FROM main_stats ms
  LEFT JOIN last_pedidos lp ON lp.erp_sucursal_id = ms.erp_sucursal_id
),

-- ── payload 2: productos sin bodega (= get_pedido_sin_bodega) ──
ventas AS (
  SELECT sm.erp_sucursal_id, s.erp_product_id, SUM(s.cantidad)::numeric AS ventas_6m
  FROM product_sales_monthly_agg s
  JOIN suc_map sm ON sm.branch_id = s.branch_id
  WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
    AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY sm.erp_sucursal_id, s.erp_product_id
),
agrupado AS (
  SELECT
    n.erp_product_id,
    SUM(n.reponer)::integer         AS total_necesidad,
    COALESCE(SUM(v.ventas_6m), 0)  AS total_ventas_6m,
    jsonb_agg(
      jsonb_build_object('erp_sucursal_id', n.erp_sucursal_id, 'reponer', n.reponer)
      ORDER BY n.reponer DESC
    ) AS sucursales
  FROM flagged n
  LEFT JOIN ventas v ON v.erp_sucursal_id = n.erp_sucursal_id AND v.erp_product_id = n.erp_product_id
  WHERE NOT n.tiene_bodega
  GROUP BY n.erp_product_id
),
sin_bodega_json AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'erp_product_id',    a.erp_product_id,
        'product_name',      p.nombre::text,
        'laboratorio',       lab.nombre::text,
        'sucursales',        a.sucursales,
        'total_necesidad',   a.total_necesidad,
        'total_ventas_6m',   a.total_ventas_6m,
        'prioridad_score',   ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2)
      )
      ORDER BY ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2) DESC NULLS LAST
    ),
    '[]'::jsonb
  ) AS j
  FROM agrupado a
  JOIN products p ON p.id = a.erp_product_id
  LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
)

SELECT jsonb_build_object(
  'stats',      (SELECT j FROM stats_json),
  'sin_bodega', (SELECT j FROM sin_bodega_json)
)
);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[])
 RETURNS TABLE(pedido_id uuid, erp_sucursal_id integer, enviados integer, sin_stock integer, por_regla integer, agotamiento integer, pendientes integer, con_diferencia integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT
        pedido_id,
        erp_sucursal_id,
        COUNT(*) FILTER (WHERE cantidad_asignada > 0 AND NOT agotamiento)::INT AS enviados,
        COUNT(*) FILTER (WHERE sin_stock = true)::INT                          AS sin_stock,
        COUNT(*) FILTER (WHERE revision_minmax = true)::INT                    AS por_regla,
        COUNT(*) FILTER (WHERE agotamiento = true)::INT                        AS agotamiento,
        COUNT(*) FILTER (WHERE status = 'pendiente')::INT                      AS pendientes,
        COUNT(*) FILTER (WHERE status = 'con_diferencia')::INT                 AS con_diferencia
    FROM pedido_items
    WHERE pedido_id = ANY(p_pedido_ids)
    GROUP BY pedido_id, erp_sucursal_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_kpis(p_desde date DEFAULT (CURRENT_DATE - 30), p_hasta date DEFAULT CURRENT_DATE)
 RETURNS TABLE(pedido_id uuid, numero integer, erp_sucursal_id integer, created_at timestamp with time zone, tiempo_prep_neto_min integer, tiempo_pausado_min integer, tiempo_transito_min integer, tiempo_recuento_min integer, num_pausas integer)
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH pause_totals AS (
        SELECT
            pph.pedido_id,
            pph.erp_sucursal_id,
            COUNT(*)::integer AS num_pausas,
            SUM(
                EXTRACT(EPOCH FROM (
                    COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at
                ))::integer / 60
            )::integer        AS total_pausa_min
        FROM pedido_pausa_historial pph
        GROUP BY pph.pedido_id, pph.erp_sucursal_id
    ),
    primera_firma AS (
        SELECT pedido_id, erp_sucursal_id, MIN(created_at) AS primera_firma_at
        FROM pedido_recepcion_firmas
        GROUP BY pedido_id, erp_sucursal_id
    )
    SELECT
        p.id,
        p.numero,
        pss.erp_sucursal_id,
        p.created_at,
        CASE
            WHEN pss.iniciado_at IS NOT NULL AND pss.finalizado_at IS NOT NULL THEN
                GREATEST(0,
                    EXTRACT(EPOCH FROM (pss.finalizado_at - pss.iniciado_at))::integer / 60
                    - COALESCE(pt.total_pausa_min, 0)
                )
        END::integer                                             AS tiempo_prep_neto_min,
        COALESCE(pt.total_pausa_min, 0)::integer                AS tiempo_pausado_min,
        CASE
            WHEN pss.finalizado_at IS NOT NULL AND pf.primera_firma_at IS NOT NULL THEN
                GREATEST(0,
                    EXTRACT(EPOCH FROM (pf.primera_firma_at - pss.finalizado_at))::integer / 60
                )
        END::integer                                             AS tiempo_transito_min,
        CASE
            WHEN pf.primera_firma_at IS NOT NULL AND pss.recibido_erp_at IS NOT NULL THEN
                GREATEST(0,
                    EXTRACT(EPOCH FROM (pss.recibido_erp_at - pf.primera_firma_at))::integer / 60
                )
        END::integer                                             AS tiempo_recuento_min,
        COALESCE(pt.num_pausas, 0)                               AS num_pausas
    FROM pedidos p
    JOIN pedido_sucursal_status pss ON pss.pedido_id = p.id
    LEFT JOIN pause_totals pt
        ON pt.pedido_id = p.id AND pt.erp_sucursal_id = pss.erp_sucursal_id
    LEFT JOIN primera_firma pf
        ON pf.pedido_id = p.id AND pf.erp_sucursal_id = pss.erp_sucursal_id
    WHERE p.created_at::date BETWEEN p_desde AND p_hasta
      AND p.status NOT IN ('anulado', 'confirmado')
    ORDER BY p.created_at DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_preview(p_sucursal_ids integer[], p_target_ids integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  SET LOCAL work_mem = '32MB';

  CREATE TEMP TABLE _inv_agg ON COMMIT DROP AS
  SELECT i.erp_sucursal_id, i.erp_product_id,
    COALESCE(SUM(i.cantidad::numeric * COALESCE(vf.factor, NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric, 1)) FILTER (WHERE NOT i.is_vencidos), 0) AS units_vivos
  FROM inventory i
  LEFT JOIN mv_product_factor vf ON vf.product_id = i.erp_product_id AND vf.pres_key = UPPER(TRIM(i.presentacion))
  WHERE i.erp_sucursal_id = ANY(p_sucursal_ids)
  GROUP BY i.erp_sucursal_id, i.erp_product_id;
  CREATE INDEX ON _inv_agg(erp_sucursal_id, erp_product_id);

  CREATE TEMP TABLE _inv_bodega ON COMMIT DROP AS
  SELECT i.erp_product_id, i.lote, i.fecha_vencimiento,
    SUM(i.cantidad::numeric * COALESCE(vf.factor, NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric, 1)) AS unidades
  FROM inventory i
  LEFT JOIN mv_product_factor vf ON vf.product_id = i.erp_product_id AND vf.pres_key = UPPER(TRIM(i.presentacion))
  JOIN erp_sucursal_map bm ON bm.es_bodega AND i.erp_sucursal_id = bm.erp_sucursal_id
  WHERE NOT i.is_vencidos
  GROUP BY i.erp_product_id, i.lote, i.fecha_vencimiento;
  CREATE INDEX ON _inv_bodega(erp_product_id);

  CREATE TEMP TABLE _ventas_suc ON COMMIT DROP AS
  SELECT sm.erp_sucursal_id, s.erp_product_id, SUM(s.cantidad)::numeric AS ventas_6m
  FROM product_sales_monthly_agg s
  JOIN erp_sucursal_map sm ON sm.branch_id = s.branch_id AND NOT sm.es_bodega
  WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
    AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY sm.erp_sucursal_id, s.erp_product_id;
  CREATE INDEX ON _ventas_suc(erp_sucursal_id, erp_product_id);

  -- _necesidades: reponer y el filtro de entrada quedan EXACTAMENTE igual que antes
  -- (no se toca la distribucion de bodega entre sucursales). Se agrega need_u (la
  -- necesidad real en unidades, sin redondear) para usarla mas abajo, unicamente en la
  -- decision final del umbral 40% contra unit_base, evitando el doble redondeo que
  -- bloqueaba despachos validos (ej. reponer=2 de una regla x3 debia despachar la
  -- regla completa por superar el 40%, pero el redondeo previo lo dejaba en reponer=1
  -- y fallaba el segundo chequeo).
  CREATE TEMP TABLE _necesidades ON COMMIT DROP AS
  WITH pref_factor AS (
    SELECT dr.erp_product_id, pp.factor AS pref
    FROM dispatch_rules dr
    JOIN product_precios pp ON pp.product_id = dr.erp_product_id AND pp.id_presentacion = dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
  ),
  stock_sucursal AS (
    SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
      psp.erp_sucursal_id, psp.erp_product_id, pp.id_presentacion AS erp_presentacion_id,
      ROUND((minmax_effective(psp.min_units, psp.manual_min))::numeric / NULLIF(pp.factor::numeric, 0))::integer AS min_qty,
      ROUND((minmax_effective(psp.max_units, psp.manual_max))::numeric / NULLIF(pp.factor::numeric, 0))::integer AS max_qty,
      (minmax_effective(psp.max_units, psp.manual_max))::integer AS max_units_raw,
      COALESCE(ia.units_vivos, 0) AS stock_units_raw,
      pr.tipo AS presentacion_tipo, pp.factor::numeric AS factor,
      ROUND(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0), 2) AS stock_pk
    FROM product_stock_params psp
    JOIN product_precios pp ON pp.product_id = psp.erp_product_id AND pp.activo = true
    JOIN presentaciones pr ON pr.id = pp.id_presentacion
    LEFT JOIN _inv_agg ia ON ia.erp_sucursal_id = psp.erp_sucursal_id AND ia.erp_product_id = psp.erp_product_id
    LEFT JOIN pref_factor pf ON pf.erp_product_id = psp.erp_product_id
    WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
      AND (minmax_effective(psp.max_units, psp.manual_max)) > 0
      AND ROUND((minmax_effective(psp.max_units, psp.manual_max))::numeric / NULLIF(pp.factor::numeric, 0)) >= 1
    ORDER BY psp.erp_sucursal_id, psp.erp_product_id,
      (pp.factor = COALESCE(pf.pref, -1)) DESC,
      CASE WHEN pf.pref IS NULL THEN (pp.factor > 1)::int ELSE 0 END DESC,
      pp.factor ASC, pp.id_presentacion
  )
  SELECT ss.*, nu.need_u,
    (FLOOR(need_u::numeric / NULLIF(ss.factor, 0))
     + CASE WHEN (need_u::numeric % NULLIF(ss.factor, 0)) >= 0.40 * ss.factor THEN 1 ELSE 0 END
    )::integer AS reponer
  FROM stock_sucursal ss
  CROSS JOIN LATERAL (SELECT GREATEST(0, ss.max_units_raw - FLOOR(ss.stock_units_raw))::integer AS need_u) nu
  WHERE nu.need_u > 0
    AND (FLOOR(nu.need_u::numeric / NULLIF(ss.factor, 0)) + CASE WHEN (nu.need_u::numeric % NULLIF(ss.factor, 0)) >= 0.40 * ss.factor THEN 1 ELSE 0 END) > 0;
  CREATE INDEX ON _necesidades(erp_product_id, erp_presentacion_id);
  CREATE INDEX ON _necesidades(erp_sucursal_id, erp_product_id);

  CREATE TEMP TABLE _bodega ON COMMIT DROP AS
  WITH pres_units_needed AS (
    SELECT erp_product_id, erp_presentacion_id, factor, SUM(reponer)::numeric * factor AS units_needed
    FROM _necesidades GROUP BY erp_product_id, erp_presentacion_id, factor
  ),
  pres_units_total AS (
    SELECT erp_product_id, SUM(units_needed) AS units_total FROM pres_units_needed GROUP BY erp_product_id
  ),
  pending_committed AS (
    SELECT pi.erp_product_id, SUM(pi.cantidad_asignada::numeric * COALESCE(pp.factor, 1)) AS committed_units
    FROM pedido_items pi
    JOIN pedidos pd ON pd.id = pi.pedido_id
    JOIN pedido_sucursal_status pss ON pss.pedido_id = pi.pedido_id AND pss.erp_sucursal_id = pi.erp_sucursal_id
    LEFT JOIN product_precios pp ON pp.product_id = pi.erp_product_id AND pp.id_presentacion = pi.erp_presentacion_id
    WHERE pi.status = 'pendiente' AND pd.status NOT IN ('anulado','completado') AND pss.finalizado_at IS NULL
    GROUP BY pi.erp_product_id
  )
  SELECT pu.erp_product_id, pu.erp_presentacion_id,
    ROUND(GREATEST(0, COALESCE(SUM(ib.unidades), 0) - COALESCE(MAX(pc.committed_units), 0))
      * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0)
      / NULLIF(pu.factor, 0), 2) AS bodega_pk
  FROM pres_units_needed pu
  LEFT JOIN _inv_bodega ib ON ib.erp_product_id = pu.erp_product_id
  LEFT JOIN pres_units_total pt ON pt.erp_product_id = pu.erp_product_id
  LEFT JOIN pending_committed pc ON pc.erp_product_id = pu.erp_product_id
  GROUP BY pu.erp_product_id, pu.erp_presentacion_id, pu.factor, pu.units_needed, pt.units_total;
  CREATE INDEX ON _bodega(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _distribucion ON COMMIT DROP AS
  WITH ventas_total AS (
    SELECT erp_product_id, SUM(ventas_6m) AS ventas_total_6m FROM _ventas_suc GROUP BY erp_product_id
  ),
  distrib_totals AS (
    SELECT n.erp_product_id, n.erp_presentacion_id,
      SUM(n.reponer) AS total_reponer,
      SUM(CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END) AS total_pesos,
      COALESCE(b.bodega_pk, 0) AS bodega_disponible
    FROM _necesidades n
    LEFT JOIN _ventas_suc vs ON vs.erp_sucursal_id=n.erp_sucursal_id AND vs.erp_product_id=n.erp_product_id
    LEFT JOIN ventas_total vt ON vt.erp_product_id=n.erp_product_id
    LEFT JOIN _bodega b ON b.erp_product_id=n.erp_product_id AND b.erp_presentacion_id=n.erp_presentacion_id
    GROUP BY n.erp_product_id, n.erp_presentacion_id, b.bodega_pk
  ),
  distrib_floor AS (
    SELECT n.erp_sucursal_id, n.erp_product_id, n.erp_presentacion_id, n.stock_pk, n.min_qty, n.max_qty, n.presentacion_tipo, n.factor, n.reponer, n.need_u,
      COALESCE(vs.ventas_6m, 0) AS ventas_6m, t.bodega_disponible, t.total_reponer,
      CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END AS peso_suc,
      CASE WHEN t.bodega_disponible<=0 OR t.bodega_disponible>=t.total_reponer THEN 0::numeric
        WHEN t.total_pesos=0 THEN LEAST(n.reponer::numeric, t.bodega_disponible*n.reponer::numeric/NULLIF(t.total_reponer,0))
        ELSE LEAST(n.reponer::numeric, t.bodega_disponible*(CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END)/t.total_pesos)
      END AS quota_real,
      CASE WHEN t.bodega_disponible<=0 THEN 0
        WHEN t.bodega_disponible>=t.total_reponer THEN n.reponer
        WHEN t.total_pesos=0 THEN LEAST(n.reponer, FLOOR(t.bodega_disponible*n.reponer::numeric/NULLIF(t.total_reponer,0)))::integer
        ELSE LEAST(n.reponer, FLOOR(t.bodega_disponible*(CASE WHEN COALESCE(vt.ventas_total_6m,0)=0 THEN n.reponer::numeric ELSE COALESCE(vs.ventas_6m,0) END)/t.total_pesos))::integer
      END AS asignado_floor
    FROM _necesidades n
    JOIN distrib_totals t ON t.erp_product_id=n.erp_product_id AND t.erp_presentacion_id=n.erp_presentacion_id
    LEFT JOIN _ventas_suc vs ON vs.erp_sucursal_id=n.erp_sucursal_id AND vs.erp_product_id=n.erp_product_id
    LEFT JOIN ventas_total vt ON vt.erp_product_id=n.erp_product_id
  ),
  distrib_lr AS (
    SELECT df.*,
      GREATEST(0, FLOOR(df.bodega_disponible)::integer - SUM(df.asignado_floor) OVER (PARTITION BY df.erp_product_id, df.erp_presentacion_id)) AS sobrante,
      ROW_NUMBER() OVER (PARTITION BY df.erp_product_id, df.erp_presentacion_id ORDER BY (df.quota_real - df.asignado_floor) DESC, df.erp_sucursal_id) AS rn_fraccion
    FROM distrib_floor df
  )
  SELECT lr.erp_sucursal_id, lr.erp_product_id, lr.erp_presentacion_id, lr.stock_pk, lr.min_qty, lr.max_qty, lr.presentacion_tipo, lr.factor, lr.reponer, lr.need_u, lr.ventas_6m, lr.bodega_disponible,
    CASE WHEN lr.bodega_disponible<=0 OR lr.bodega_disponible>=lr.total_reponer THEN lr.asignado_floor
      WHEN lr.reponer>lr.asignado_floor AND lr.rn_fraccion<=lr.sobrante THEN lr.asignado_floor+1
      ELSE lr.asignado_floor END AS asignado_raw
  FROM distrib_lr lr;
  CREATE INDEX ON _distribucion(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _con_reglas_uncapped ON COMMIT DROP AS
  WITH raw_totals AS (
    SELECT erp_product_id, erp_presentacion_id, SUM(asignado_raw)::numeric AS total_raw_assigned
    FROM _distribucion GROUP BY erp_product_id, erp_presentacion_id
  ),
  caja_factor_map AS (
    SELECT DISTINCT ON (pp.product_id) pp.product_id, pp.factor AS caja_factor
    FROM product_precios pp JOIN presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pr.tipo ILIKE 'CAJA%' OR pr.tipo ILIKE 'BOLSA%'
    ORDER BY pp.product_id, pp.factor DESC
  ),
  dispatch_pres_factor AS (
    SELECT DISTINCT ON (dr.erp_product_id) dr.erp_product_id,
      pp.factor::numeric AS dp_factor,
      COALESCE(dr.dispatch_multiplo,1)::numeric AS dp_multiplo,
      COALESCE(dr.dispatch_label, pres.tipo) AS dp_tipo,
      (dr.dispatch_label IS NOT NULL) AS dp_tiene_label,
      CASE WHEN dr.dispatch_label IS NOT NULL THEN pp.factor::numeric * COALESCE(dr.dispatch_multiplo,1)::numeric ELSE pp.factor::numeric END AS dp_display_factor
    FROM dispatch_rules dr
    JOIN product_precios pp ON pp.product_id=dr.erp_product_id AND pp.id_presentacion=dr.dispatch_id_presentacion
    JOIN presentaciones pres ON pres.id=dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
    ORDER BY dr.erp_product_id, pp.factor DESC
  ),
  auto_pres_factor AS (
    SELECT DISTINCT ON (pp.product_id) pp.product_id, pp.factor::numeric AS ap_factor, pres.tipo AS ap_tipo
    FROM product_precios pp JOIN presentaciones pres ON pres.id=pp.id_presentacion
    WHERE pp.factor > 1 ORDER BY pp.product_id, pp.factor ASC
  ),
  con_reglas_unit AS (
    SELECT d.*, rt.total_raw_assigned,
      d.asignado_raw::numeric + GREATEST(0, d.bodega_disponible - rt.total_raw_assigned) * d.asignado_raw::numeric / NULLIF(rt.total_raw_assigned, 0) AS max_asignable,
      (dr.erp_product_id IS NOT NULL) AS tiene_regla,
      dr.multiplo AS regla_multiplo, dr.blister AS regla_blister,
      COALESCE(dr.solo_cajas, false) AS regla_solo_cajas, dr.multiplo_unidades AS regla_multiplo_unidades,
      COALESCE(dr.caja_especial, false) AS caja_especial,
      dpf.dp_tipo AS dp_tipo,
      dpf.dp_display_factor AS dp_display_factor,
      dpf.dp_factor AS dp_factor,
      dpf.dp_multiplo AS dp_multiplo,
      COALESCE(dpf.dp_tiene_label, false) AS tiene_dispatch_label,
      caja_factor_map.caja_factor,
      CASE
        WHEN dpf.dp_factor IS NOT NULL THEN dpf.dp_factor * dpf.dp_multiplo
        WHEN COALESCE(dr.solo_cajas,false)=true AND dr.multiplo IS NULL AND dr.blister IS NULL AND dr.multiplo_unidades IS NULL AND d.presentacion_tipo!='CAJA' AND caja_factor_map.caja_factor IS NOT NULL THEN caja_factor_map.caja_factor
        WHEN dr.multiplo IS NOT NULL THEN dr.multiplo * d.factor
        WHEN dr.blister IS NOT NULL THEN dr.blister * d.factor
        WHEN dr.multiplo_unidades IS NOT NULL THEN dr.multiplo_unidades::numeric
        WHEN dr.erp_product_id IS NULL AND apf.ap_factor IS NOT NULL THEN apf.ap_factor
        ELSE NULL
      END AS unit_base
    FROM _distribucion d
    JOIN raw_totals rt ON rt.erp_product_id=d.erp_product_id AND rt.erp_presentacion_id=d.erp_presentacion_id
    LEFT JOIN dispatch_rules dr ON dr.erp_product_id=d.erp_product_id
    LEFT JOIN caja_factor_map ON caja_factor_map.product_id=d.erp_product_id
    LEFT JOIN dispatch_pres_factor dpf ON dpf.erp_product_id=d.erp_product_id
    LEFT JOIN auto_pres_factor apf ON apf.product_id=d.erp_product_id
  )
  SELECT cu.*,
    CASE
      WHEN cu.asignado_raw<=0 OR cu.bodega_disponible<=0 THEN 0
      WHEN cu.unit_base IS NULL THEN cu.asignado_raw
      ELSE
        CASE
          WHEN (FLOOR(eu.units/cu.unit_base)
               + CASE WHEN (eu.units - FLOOR(eu.units/cu.unit_base)*cu.unit_base) >= 0.40*cu.unit_base THEN 1 ELSE 0 END) > 0
          THEN GREATEST(0, (FLOOR(eu.units/cu.unit_base)
               + CASE WHEN (eu.units - FLOOR(eu.units/cu.unit_base)*cu.unit_base) >= 0.40*cu.unit_base THEN 1 ELSE 0 END)
               * cu.unit_base / NULLIF(cu.factor,0))::integer
          WHEN NOT cu.tiene_regla OR cu.bodega_disponible * cu.factor < cu.unit_base
          THEN cu.asignado_raw
          ELSE 0
        END
    END AS asignado_uncapped
  FROM con_reglas_unit cu
  CROSS JOIN LATERAL (
    -- Si esta sucursal no esta limitada por bodega (recibe su reponer completo),
    -- usamos need_u (unidades reales, sin redondeo previo). Si esta limitada por
    -- bodega (asignado_raw < reponer, competencia con otras sucursales), se
    -- mantiene el comportamiento original basado en asignado_raw*factor.
    SELECT CASE WHEN cu.asignado_raw = cu.reponer THEN cu.need_u::numeric ELSE cu.asignado_raw::numeric*cu.factor END AS units
  ) eu;
  CREATE INDEX ON _con_reglas_uncapped(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _con_reglas ON COMMIT DROP AS
  WITH box_totals_per_product AS (
    SELECT DISTINCT ON (cu.erp_product_id, cu.erp_presentacion_id)
      cu.erp_product_id, cu.erp_presentacion_id, cu.unit_base, cu.factor, cu.bodega_disponible,
      FLOOR(cu.bodega_disponible*cu.factor/NULLIF(cu.unit_base,0))::integer AS cajas_bodega
    FROM _con_reglas_uncapped cu
    WHERE cu.unit_base IS NOT NULL AND cu.bodega_disponible>0 AND FLOOR(cu.bodega_disponible*cu.factor/NULLIF(cu.unit_base,0))>=1
    ORDER BY cu.erp_product_id, cu.erp_presentacion_id
  ),
  box_cajas_case12 AS (
    SELECT cu.erp_product_id, cu.erp_presentacion_id,
      SUM(CASE WHEN cu.asignado_uncapped<=cu.max_asignable THEN CEIL(cu.asignado_uncapped*cu.factor/NULLIF(bt.unit_base,0))
               WHEN FLOOR(cu.max_asignable*cu.factor/NULLIF(bt.unit_base,0))>=1 THEN FLOOR(cu.max_asignable*cu.factor/NULLIF(bt.unit_base,0))
               ELSE 0 END)::integer AS cajas_ya_usadas
    FROM _con_reglas_uncapped cu
    JOIN box_totals_per_product bt ON bt.erp_product_id=cu.erp_product_id AND bt.erp_presentacion_id=cu.erp_presentacion_id
    GROUP BY cu.erp_product_id, cu.erp_presentacion_id
  ),
  box_fill_ranked AS (
    SELECT cu.erp_sucursal_id, cu.erp_product_id, cu.erp_presentacion_id, cu.reponer,
      GREATEST(0, bt.cajas_bodega - bc.cajas_ya_usadas)::integer AS cajas_restantes,
      bt.unit_base, bt.factor,
      GREATEST(0, FLOOR(cu.reponer::numeric*bt.factor/NULLIF(bt.unit_base,0))
        + CASE WHEN (cu.reponer::numeric*bt.factor - FLOOR(cu.reponer::numeric*bt.factor/NULLIF(bt.unit_base,0))*bt.unit_base) >= 0.40*bt.unit_base THEN 1 ELSE 0 END
      )::integer AS cajas_max
    FROM _con_reglas_uncapped cu
    JOIN box_totals_per_product bt ON bt.erp_product_id=cu.erp_product_id AND bt.erp_presentacion_id=cu.erp_presentacion_id
    JOIN box_cajas_case12 bc ON bc.erp_product_id=cu.erp_product_id AND bc.erp_presentacion_id=cu.erp_presentacion_id
    WHERE cu.reponer>0 AND cu.asignado_uncapped>cu.max_asignable AND FLOOR(cu.max_asignable*cu.factor/NULLIF(bt.unit_base,0))<1
  ),
  box_fill_final AS (
    SELECT bfr.erp_sucursal_id, bfr.erp_product_id, bfr.erp_presentacion_id,
      (GREATEST(0, LEAST(bfr.cajas_max, bfr.cajas_restantes
        - COALESCE(SUM(bfr.cajas_max) OVER (PARTITION BY bfr.erp_product_id, bfr.erp_presentacion_id ORDER BY bfr.reponer DESC, bfr.erp_sucursal_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)))
       * bfr.unit_base / NULLIF(bfr.factor,0))::integer AS packs_asignados
    FROM box_fill_ranked bfr
  )
  SELECT cu.erp_sucursal_id, cu.erp_product_id, cu.erp_presentacion_id,
    cu.stock_pk, cu.min_qty, cu.max_qty, cu.presentacion_tipo, cu.factor,
    cu.reponer, cu.need_u, cu.ventas_6m, cu.bodega_disponible,
    cu.tiene_regla, cu.regla_multiplo, cu.regla_blister, cu.regla_solo_cajas, cu.regla_multiplo_unidades, cu.caja_especial,
    cu.tiene_dispatch_label,
    cu.unit_base,
    cu.dp_factor AS dispatch_pres_factor,
    COALESCE(cu.dp_multiplo::integer, 1) AS dispatch_multiplo,
    COALESCE(cu.dp_tipo, cu.presentacion_tipo) AS dispatch_tipo,
    COALESCE(cu.dp_display_factor, cu.factor) AS dispatch_factor,
    CASE
      WHEN cu.asignado_uncapped <= cu.max_asignable THEN cu.asignado_uncapped
      WHEN cu.unit_base IS NOT NULL AND FLOOR(cu.max_asignable*cu.factor/cu.unit_base)>=1
        THEN (FLOOR(cu.max_asignable*cu.factor/cu.unit_base)*cu.unit_base/NULLIF(cu.factor,0))::integer
      WHEN bff.packs_asignados IS NOT NULL THEN bff.packs_asignados
      ELSE cu.asignado_raw
    END AS asignado_final
  FROM _con_reglas_uncapped cu
  LEFT JOIN box_fill_final bff ON bff.erp_sucursal_id=cu.erp_sucursal_id AND bff.erp_product_id=cu.erp_product_id AND bff.erp_presentacion_id=cu.erp_presentacion_id;
  CREATE INDEX ON _con_reglas(erp_product_id, erp_presentacion_id);
  CREATE INDEX ON _con_reglas(erp_sucursal_id);

  CREATE TEMP TABLE _bodega_lotes ON COMMIT DROP AS
  WITH pres_units_needed AS (
    SELECT erp_product_id, erp_presentacion_id, factor, SUM(reponer)::numeric * factor AS units_needed
    FROM _necesidades GROUP BY erp_product_id, erp_presentacion_id, factor
  ),
  pres_units_total AS (
    SELECT erp_product_id, SUM(units_needed) AS units_total FROM pres_units_needed GROUP BY erp_product_id
  )
  SELECT ib.erp_product_id, pu.erp_presentacion_id, ib.lote, ib.fecha_vencimiento,
    GREATEST(0, FLOOR(ib.unidades * COALESCE(pu.units_needed / NULLIF(pt.units_total, 0), 1.0) / NULLIF(pu.factor, 0)))::integer AS lote_packs
  FROM _inv_bodega ib
  INNER JOIN (SELECT DISTINCT erp_product_id FROM _con_reglas) cr ON cr.erp_product_id = ib.erp_product_id
  JOIN pres_units_needed pu ON pu.erp_product_id = ib.erp_product_id
  JOIN pres_units_total  pt ON pt.erp_product_id = ib.erp_product_id
  WHERE ib.unidades > 0;
  CREATE INDEX ON _bodega_lotes(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _bodega_lotes_fefo ON COMMIT DROP AS
  SELECT bl.*,
    COALESCE(SUM(bl.lote_packs) OVER (PARTITION BY bl.erp_product_id, bl.erp_presentacion_id ORDER BY bl.fecha_vencimiento ASC NULLS LAST, bl.lote ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::integer AS lote_cum_start,
    SUM(bl.lote_packs) OVER (PARTITION BY bl.erp_product_id, bl.erp_presentacion_id ORDER BY bl.fecha_vencimiento ASC NULLS LAST, bl.lote ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer AS lote_cum_end
  FROM _bodega_lotes bl WHERE bl.lote_packs > 0;
  CREATE INDEX ON _bodega_lotes_fefo(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _suc_order ON COMMIT DROP AS
  SELECT cr.erp_sucursal_id, cr.erp_product_id, cr.erp_presentacion_id, cr.asignado_final,
    COALESCE(SUM(cr.asignado_final) OVER (PARTITION BY cr.erp_product_id, cr.erp_presentacion_id ORDER BY COALESCE(esm.orden_despacho, 999) ASC, cr.erp_sucursal_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::integer AS suc_cum_start,
    SUM(cr.asignado_final) OVER (PARTITION BY cr.erp_product_id, cr.erp_presentacion_id ORDER BY COALESCE(esm.orden_despacho, 999) ASC, cr.erp_sucursal_id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::integer AS suc_cum_end
  FROM _con_reglas cr
  JOIN erp_sucursal_map esm ON esm.erp_sucursal_id = cr.erp_sucursal_id
  WHERE cr.asignado_final > 0;
  CREATE INDEX ON _suc_order(erp_product_id, erp_presentacion_id);

  CREATE TEMP TABLE _lotes_por_sucursal ON COMMIT DROP AS
  SELECT so.erp_sucursal_id, so.erp_product_id, so.erp_presentacion_id,
    jsonb_agg(
      jsonb_build_object('lote', lf.lote, 'fecha_vencimiento', lf.fecha_vencimiento,
        'packs', GREATEST(0, LEAST(so.suc_cum_end, lf.lote_cum_end) - GREATEST(so.suc_cum_start, lf.lote_cum_start))::integer)
      ORDER BY lf.fecha_vencimiento ASC NULLS LAST, lf.lote ASC
    ) FILTER (WHERE GREATEST(0, LEAST(so.suc_cum_end, lf.lote_cum_end) - GREATEST(so.suc_cum_start, lf.lote_cum_start)) > 0)
    AS lotes_seq
  FROM _suc_order so
  JOIN _bodega_lotes_fefo lf ON lf.erp_product_id=so.erp_product_id AND lf.erp_presentacion_id=so.erp_presentacion_id
  GROUP BY so.erp_sucursal_id, so.erp_product_id, so.erp_presentacion_id;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'erp_sucursal_id', cr.erp_sucursal_id, 'erp_product_id', cr.erp_product_id,
        'erp_presentacion_id', cr.erp_presentacion_id, 'product_name', p.nombre::text,
        'laboratorio', COALESCE(lab.nombre, '')::text, 'presentacion_tipo', cr.presentacion_tipo::text,
        'factor', cr.factor, 'stock_packs', ROUND(cr.stock_pk, 2),
        'min_qty', cr.min_qty, 'max_qty', cr.max_qty, 'cantidad_reponer', cr.reponer::integer,
        'bodega_stock_packs', ROUND(cr.bodega_disponible, 2), 'cantidad_asignada', cr.asignado_final,
        'sin_stock', (cr.bodega_disponible <= 0),
        'revision_minmax', (
          cr.bodega_disponible > 0
          AND cr.asignado_final = 0
          AND cr.reponer > 0
          AND COALESCE(cr.tiene_regla, false)
          AND cr.unit_base IS NOT NULL
          AND (
            FLOOR(cr.need_u::numeric / cr.unit_base)
            + CASE WHEN (cr.need_u::numeric - FLOOR(cr.need_u::numeric / cr.unit_base) * cr.unit_base
                        ) >= 0.40 * cr.unit_base THEN 1 ELSE 0 END
          ) = 0
        ),
        'agotamiento', (
          cr.bodega_disponible > 0 AND (
            (cr.asignado_final > 0 AND cr.asignado_final < cr.reponer)
            OR (
              cr.asignado_final = 0 AND cr.reponer > 0 AND (
                NOT COALESCE(cr.tiene_regla, false)
                OR cr.unit_base IS NULL
                OR (
                  FLOOR(cr.need_u::numeric / cr.unit_base)
                  + CASE WHEN (cr.need_u::numeric - FLOOR(cr.need_u::numeric / cr.unit_base) * cr.unit_base
                              ) >= 0.40 * cr.unit_base THEN 1 ELSE 0 END
                ) > 0
              )
            )
          )
        ),
        'urgencia_pct', LEAST(100, ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100))::integer,
        'tiene_regla_despacho', COALESCE(cr.tiene_regla, false),
        'regla_multiplo', cr.regla_multiplo, 'regla_blister', cr.regla_blister,
        'regla_solo_cajas', cr.regla_solo_cajas, 'regla_multiplo_unidades', cr.regla_multiplo_unidades,
        'caja_especial', COALESCE(cr.caja_especial, false), 'es_antibiotico', COALESCE(p.es_antibiotico, false),
        'ventas_6m', cr.ventas_6m, 'lotes_bodega', lps.lotes_seq,
        'dispatch_tipo', cr.dispatch_tipo, 'dispatch_factor', cr.dispatch_factor,
        'dispatch_pres_factor', cr.dispatch_pres_factor,
        'dispatch_multiplo', cr.dispatch_multiplo,
        'tiene_dispatch_label', COALESCE(cr.tiene_dispatch_label, false),
        'presentations', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', pr2.tipo, 'factor', pp2.factor) ORDER BY pp2.factor DESC), '[]'::jsonb)
          FROM product_precios pp2
          JOIN presentaciones pr2 ON pr2.id = pp2.id_presentacion
          WHERE pp2.product_id = cr.erp_product_id AND pp2.activo = true AND pp2.factor >= 1
        )
      )
      ORDER BY cr.erp_sucursal_id, LEAST(100, ROUND((cr.reponer::numeric / NULLIF(cr.max_qty, 0)) * 100))::integer DESC, p.nombre
    ), '[]'::jsonb)
    FROM _con_reglas cr
    JOIN products p ON p.id = cr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN _lotes_por_sucursal lps ON lps.erp_sucursal_id=cr.erp_sucursal_id AND lps.erp_product_id=cr.erp_product_id AND lps.erp_presentacion_id=cr.erp_presentacion_id
    WHERE cr.erp_sucursal_id = ANY(COALESCE(p_target_ids, p_sucursal_ids))
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_sin_bodega(p_sucursal_ids integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 7])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET statement_timeout TO '60s'
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
BEGIN
RETURN (
WITH
suc_map    AS (SELECT erp_sucursal_id, branch_id FROM erp_sucursal_map WHERE NOT es_bodega),
bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

inv_dedup AS (
  SELECT DISTINCT ON (
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
  )
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    i.cantidad, i.detalle,
    i.cantidad::numeric * COALESCE(
      vf.factor,
      NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric,
      1
    ) AS unidades
  FROM inventory i
  LEFT JOIN v_product_factor vf
         ON vf.product_id = i.erp_product_id
        AND vf.pres_key   = UPPER(TRIM(i.presentacion))
  ORDER BY
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
),

inv_agg AS (
  SELECT erp_sucursal_id, erp_product_id,
    COALESCE(SUM(unidades) FILTER (WHERE is_vencidos = false), 0)::numeric AS units_vivos
  FROM inv_dedup
  GROUP BY erp_sucursal_id, erp_product_id
),

pending_committed AS (
  SELECT pi.erp_product_id,
    SUM(pi.cantidad_asignada::numeric * COALESCE(pp.factor, 1)) AS committed_units
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  LEFT JOIN product_precios pp
    ON pp.product_id = pi.erp_product_id AND pp.id_presentacion = pi.erp_presentacion_id
  WHERE pi.status = 'pendiente'
    AND pd.status NOT IN ('anulado', 'completado')
  GROUP BY pi.erp_product_id
),

pref_factor AS (
  SELECT dr.erp_product_id, pp.factor AS pref
  FROM dispatch_rules dr
  JOIN product_precios pp ON pp.product_id = dr.erp_product_id
                          AND pp.id_presentacion = dr.dispatch_id_presentacion
  WHERE dr.dispatch_id_presentacion IS NOT NULL
),

necesidades AS (
  SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
    psp.erp_sucursal_id,
    psp.erp_product_id,
    pp.id_presentacion AS erp_presentacion_id,
    GREATEST(0,
      ROUND(
        COALESCE(psp.manual_max, psp.max_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer
      - FLOOR(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0))
    )::integer AS reponer
  FROM product_stock_params psp
  JOIN product_precios pp
       ON pp.product_id = psp.erp_product_id AND pp.activo = true
  LEFT JOIN inv_agg ia
         ON ia.erp_sucursal_id = psp.erp_sucursal_id
        AND ia.erp_product_id  = psp.erp_product_id
  LEFT JOIN pref_factor pf ON pf.erp_product_id = psp.erp_product_id
  WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
    AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    AND ROUND(
          COALESCE(psp.manual_max, psp.max_units, 0)::numeric
          / NULLIF(pp.factor::numeric, 0)
        ) >= 1
  ORDER BY
    psp.erp_sucursal_id,
    psp.erp_product_id,
    (pp.factor = COALESCE(pf.pref, -1)) DESC,
    CASE WHEN pf.pref IS NULL THEN (pp.factor > 1)::int ELSE 0 END DESC,
    pp.factor ASC,
    pp.id_presentacion
),
necesidades_pos AS (SELECT * FROM necesidades WHERE reponer > 0),

bodega_net AS (
  SELECT inv.erp_product_id,
    SUM(inv.unidades) - COALESCE(MAX(pc.committed_units), 0) AS net_units
  FROM inv_dedup inv
  LEFT JOIN pending_committed pc ON pc.erp_product_id = inv.erp_product_id
  WHERE inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
    AND inv.is_vencidos = false AND inv.unidades > 0
  GROUP BY inv.erp_product_id
),

sin_bodega AS (
  SELECT DISTINCT n.erp_product_id
  FROM necesidades_pos n
  WHERE NOT EXISTS (
    SELECT 1 FROM bodega_net bn
    WHERE bn.erp_product_id = n.erp_product_id AND bn.net_units > 0
  )
),

ventas AS (
  SELECT sm.erp_sucursal_id, s.erp_product_id, SUM(s.cantidad)::numeric AS ventas_6m
  FROM product_sales_monthly_agg s
  JOIN suc_map sm ON sm.branch_id = s.branch_id
  WHERE sm.erp_sucursal_id = ANY(p_sucursal_ids)
    AND s.year_month >= to_char(NOW() - INTERVAL '6 months', 'YYYY-MM')
  GROUP BY sm.erp_sucursal_id, s.erp_product_id
),

agrupado AS (
  SELECT
    n.erp_product_id,
    SUM(n.reponer)::integer         AS total_necesidad,
    COALESCE(SUM(v.ventas_6m), 0)  AS total_ventas_6m,
    jsonb_agg(
      jsonb_build_object('erp_sucursal_id', n.erp_sucursal_id, 'reponer', n.reponer)
      ORDER BY n.reponer DESC
    ) AS sucursales
  FROM necesidades_pos n
  JOIN sin_bodega sb ON sb.erp_product_id = n.erp_product_id
  LEFT JOIN ventas v ON v.erp_sucursal_id = n.erp_sucursal_id AND v.erp_product_id = n.erp_product_id
  GROUP BY n.erp_product_id
)

SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'erp_product_id',    a.erp_product_id,
      'product_name',      p.nombre::text,
      'laboratorio',       lab.nombre::text,
      'sucursales',        a.sucursales,
      'total_necesidad',   a.total_necesidad,
      'total_ventas_6m',   a.total_ventas_6m,
      'prioridad_score',   ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2)
    )
    ORDER BY ROUND((a.total_necesidad::numeric * (1 + a.total_ventas_6m / NULLIF(a.total_necesidad, 0))), 2) DESC NULLS LAST
  ),
  '[]'::jsonb
)
FROM agrupado a
JOIN products p ON p.id = a.erp_product_id
LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedido_sucursal_stats(p_sucursal_ids integer[] DEFAULT ARRAY[1, 2, 3, 4, 5, 7])
 RETURNS TABLE(erp_sucursal_id integer, total_productos integer, necesidad_packs integer, con_bodega_packs integer, sin_bodega_packs integer, con_bodega_productos integer, sin_bodega_productos integer, avg_urgencia_pct integer, last_pedido_at timestamp with time zone)
 LANGUAGE sql
 SET statement_timeout TO '60s'
 SET search_path TO 'public', 'extensions'
AS $function$
WITH
bodega_suc AS (SELECT erp_sucursal_id FROM erp_sucursal_map WHERE es_bodega LIMIT 1),

inv_dedup AS (
  SELECT DISTINCT ON (
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
  )
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    i.cantidad, i.detalle,
    i.cantidad::numeric * COALESCE(
      vf.factor,
      NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric,
      1
    ) AS unidades
  FROM inventory i
  LEFT JOIN v_product_factor vf
         ON vf.product_id = i.erp_product_id
        AND vf.pres_key   = UPPER(TRIM(i.presentacion))
  ORDER BY
    i.erp_sucursal_id, i.erp_product_id, i.lote, i.fecha_vencimiento, i.is_vencidos,
    TRIM(LOWER(COALESCE(i.presentacion,''))), LOWER(COALESCE(i.detalle,''))
),

inv_agg AS (
  SELECT erp_sucursal_id, erp_product_id,
    COALESCE(SUM(unidades) FILTER (WHERE is_vencidos = false), 0)::numeric AS units_vivos
  FROM inv_dedup
  GROUP BY erp_sucursal_id, erp_product_id
),

pending_committed AS (
  SELECT pi.erp_product_id,
    SUM(pi.cantidad_asignada::numeric * COALESCE(pp.factor, 1)) AS committed_units
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  LEFT JOIN product_precios pp
    ON pp.product_id = pi.erp_product_id AND pp.id_presentacion = pi.erp_presentacion_id
  WHERE pi.status = 'pendiente'
    AND pd.status NOT IN ('anulado', 'completado')
  GROUP BY pi.erp_product_id
),

pref_factor AS (
  SELECT dr.erp_product_id, pp.factor AS pref
  FROM dispatch_rules dr
  JOIN product_precios pp ON pp.product_id = dr.erp_product_id
                          AND pp.id_presentacion = dr.dispatch_id_presentacion
  WHERE dr.dispatch_id_presentacion IS NOT NULL
),

necesidades AS (
  SELECT DISTINCT ON (psp.erp_sucursal_id, psp.erp_product_id)
    psp.erp_sucursal_id,
    psp.erp_product_id,
    ROUND(
      COALESCE(psp.manual_max, psp.max_units, 0)::numeric
      / NULLIF(pp.factor::numeric, 0)
    )::integer AS effective_max,
    GREATEST(0,
      ROUND(
        COALESCE(psp.manual_max, psp.max_units, 0)::numeric
        / NULLIF(pp.factor::numeric, 0)
      )::integer
      - FLOOR(COALESCE(ia.units_vivos, 0) / NULLIF(pp.factor::numeric, 0))
    )::integer AS reponer
  FROM product_stock_params psp
  JOIN product_precios pp
       ON pp.product_id = psp.erp_product_id AND pp.activo = true
  LEFT JOIN inv_agg ia
         ON ia.erp_sucursal_id = psp.erp_sucursal_id
        AND ia.erp_product_id  = psp.erp_product_id
  LEFT JOIN pref_factor pf ON pf.erp_product_id = psp.erp_product_id
  WHERE psp.erp_sucursal_id = ANY(p_sucursal_ids)
    AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    AND ROUND(
          COALESCE(psp.manual_max, psp.max_units, 0)::numeric
          / NULLIF(pp.factor::numeric, 0)
        ) >= 1
  ORDER BY
    psp.erp_sucursal_id,
    psp.erp_product_id,
    (pp.factor = COALESCE(pf.pref, -1)) DESC,
    CASE WHEN pf.pref IS NULL THEN (pp.factor > 1)::int ELSE 0 END DESC,
    pp.factor ASC,
    pp.id_presentacion
),
necesidades_pos AS (SELECT * FROM necesidades WHERE reponer > 0),

bodega_net AS (
  SELECT inv.erp_product_id,
    SUM(inv.unidades) - COALESCE(MAX(pc.committed_units), 0) AS net_units
  FROM inv_dedup inv
  LEFT JOIN pending_committed pc ON pc.erp_product_id = inv.erp_product_id
  WHERE inv.erp_sucursal_id = (SELECT erp_sucursal_id FROM bodega_suc)
    AND inv.is_vencidos = false AND inv.unidades > 0
  GROUP BY inv.erp_product_id
),
bodega_disponible AS (
  SELECT erp_product_id FROM bodega_net WHERE net_units > 0
),

con_bodega AS (
  SELECT n.erp_sucursal_id, n.erp_product_id, n.effective_max, n.reponer, true AS tiene_bodega
  FROM necesidades_pos n
  WHERE EXISTS (SELECT 1 FROM bodega_disponible b WHERE b.erp_product_id = n.erp_product_id)
),
sin_bodega AS (
  SELECT n.erp_sucursal_id, n.erp_product_id, n.effective_max, n.reponer, false AS tiene_bodega
  FROM necesidades_pos n
  WHERE NOT EXISTS (SELECT 1 FROM bodega_disponible b WHERE b.erp_product_id = n.erp_product_id)
),
all_rows AS (SELECT * FROM con_bodega UNION ALL SELECT * FROM sin_bodega),

last_pedidos AS (
  SELECT pi.erp_sucursal_id, MAX(pd.created_at) AS last_pedido_at
  FROM pedido_items pi
  JOIN pedidos pd ON pd.id = pi.pedido_id
  WHERE pi.erp_sucursal_id = ANY(p_sucursal_ids)
    AND pd.status NOT IN ('anulado')
  GROUP BY pi.erp_sucursal_id
),

main_stats AS (
  SELECT
    erp_sucursal_id,
    COUNT(DISTINCT erp_product_id)::integer                                        AS total_productos,
    SUM(reponer)::integer                                                           AS necesidad_packs,
    COALESCE(SUM(reponer) FILTER (WHERE tiene_bodega),     0)::integer             AS con_bodega_packs,
    COALESCE(SUM(reponer) FILTER (WHERE NOT tiene_bodega), 0)::integer             AS sin_bodega_packs,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE tiene_bodega)::integer            AS con_bodega_productos,
    COUNT(DISTINCT erp_product_id) FILTER (WHERE NOT tiene_bodega)::integer        AS sin_bodega_productos,
    ROUND(
      SUM(LEAST(100.0, reponer::numeric / NULLIF(effective_max, 0) * 100) * reponer)
      / NULLIF(SUM(reponer::numeric), 0)
    )::integer AS avg_urgencia_pct
  FROM all_rows
  GROUP BY erp_sucursal_id
)

SELECT
  ms.erp_sucursal_id,
  ms.total_productos,
  ms.necesidad_packs,
  ms.con_bodega_packs,
  ms.sin_bodega_packs,
  ms.con_bodega_productos,
  ms.sin_bodega_productos,
  ms.avg_urgencia_pct,
  lp.last_pedido_at
FROM main_stats ms
LEFT JOIN last_pedidos lp ON lp.erp_sucursal_id = ms.erp_sucursal_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_pedidos_en_curso()
 RETURNS TABLE(pedido_id uuid, numero integer, codigo text, notes text, status text, created_at timestamp with time zone, enviado_at timestamp with time zone, erp_sucursal_id integer, iniciado_at timestamp with time zone, finalizado_at timestamp with time zone, pausado_at timestamp with time zone, reanudado_at timestamp with time zone, llegada_fisica_at timestamp with time zone, llegada_fisica_por uuid, recibido_erp_at timestamp with time zone, recibido_erp_por uuid, diferencias_reportadas_at timestamp with time zone, diferencias_reportadas_por uuid, corregido_bodega_at timestamp with time zone, corregido_bodega_por uuid, corregido_bodega_nota text, confirmado_correccion_at timestamp with time zone, confirmado_correccion_por uuid, min_pausado_total integer, created_by uuid, iniciado_por uuid, finalizado_por uuid, enviado_por uuid, llegada_tipo text, llegada_nota text, falta_cajas jsonb, falta_caja_at timestamp with time zone, cajas_danadas jsonb, reenvios_historial jsonb, reenvio_bodega_at timestamp with time zone, reenvio_por uuid, segunda_llegada_at timestamp with time zone, total_cajas integer, caja_map jsonb, cajas_electrolit integer, electrolit_ok boolean, electrolit_faltantes integer, cajas_especiales jsonb, cajas_especiales_llegadas jsonb, pauses jsonb, pedido_status text, reanudado_por uuid, entrega_programada_at timestamp with time zone, entrega_programada_historial jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    p.id,
    p.numero, pss.codigo, p.notes, p.status,
    p.created_at, p.enviado_at, pss.erp_sucursal_id,
    pss.iniciado_at, pss.finalizado_at, pss.pausado_at, pss.reanudado_at,
    pss.llegada_fisica_at, pss.llegada_fisica_por,
    pss.recibido_erp_at, pss.recibido_erp_por,
    pss.diferencias_reportadas_at, pss.diferencias_reportadas_por,
    pss.corregido_bodega_at, pss.corregido_bodega_por, pss.corregido_bodega_nota,
    pss.confirmado_correccion_at, pss.confirmado_correccion_por,
    COALESCE(
      (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(pph.reanudado_at, NOW()) - pph.pausado_at)) / 60)::INT
       FROM   pedido_pausa_historial pph
       WHERE  pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id), 0
    ),
    p.created_by, pss.iniciado_por, pss.finalizado_por, p.enviado_por,
    pss.llegada_tipo, pss.llegada_nota,
    COALESCE(pss.falta_cajas,        '[]'::jsonb),
    pss.falta_caja_at,
    COALESCE(pss.cajas_danadas,      '[]'::jsonb),
    COALESCE(pss.reenvios_historial, '[]'::jsonb),
    pss.reenvio_bodega_at, pss.reenvio_por, pss.segunda_llegada_at,
    pss.total_cajas, COALESCE(pss.caja_map, '{}'::jsonb),
    COALESCE(pss.cajas_electrolit, 0),
    pss.electrolit_ok,
    pss.electrolit_faltantes,
    COALESCE(pss.cajas_especiales,          '[]'::jsonb),
    COALESCE(pss.cajas_especiales_llegadas, '{}'::jsonb),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'razon',         pph.razon,
          'pausado_at',    pph.pausado_at,
          'pausado_por',   pph.pausado_por,
          'reanudado_at',  pph.reanudado_at,
          'reanudado_por', pph.reanudado_por
        ) ORDER BY pph.pausado_at)
       FROM pedido_pausa_historial pph
       WHERE pph.pedido_id = p.id AND pph.erp_sucursal_id = pss.erp_sucursal_id),
      '[]'::jsonb
    ),
    p.status,
    pss.reanudado_por,
    pss.entrega_programada_at,
    COALESCE(pss.entrega_programada_historial, '[]'::jsonb)
  FROM  pedidos p
  JOIN  pedido_sucursal_status pss ON pss.pedido_id = p.id
  WHERE p.status <> 'anulado'
  ORDER BY
    CASE WHEN p.status IN ('completado', 'parcial') THEN 1 ELSE 0 END,
    p.created_at DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.get_precio_tipo(p_precio_unitario numeric, p_product_id integer, p_id_presentacion integer, p_fecha date DEFAULT CURRENT_DATE)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN ABS(p_precio_unitario-h.vineta)<0.005 THEN 'vineta'
    WHEN ABS(p_precio_unitario-h.descuento_1)<0.005 THEN 'descuento_1'
    WHEN ABS(p_precio_unitario-h.vip)<0.005 THEN 'vip'
    WHEN ABS(p_precio_unitario-h.clinica)<0.005 THEN 'clinica'
    WHEN ABS(p_precio_unitario-h.mayoreo)<0.005 THEN 'mayoreo'
    WHEN ABS(p_precio_unitario-h.premium)<0.005 THEN 'premium'
    WHEN ABS(p_precio_unitario-h.precio_7)<0.005 THEN 'precio_7'
    ELSE 'otro' END
  FROM public.product_precios_history h
  WHERE h.product_id=p_product_id AND h.id_presentacion=p_id_presentacion
    AND h.valid_from::date<=p_fecha AND (h.valid_until IS NULL OR h.valid_until::date>p_fecha)
  ORDER BY h.valid_from DESC LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_branch_summary(p_erp_product_id integer)
 RETURNS TABLE(erp_sucursal_id integer, current_stock bigint, vencidos_stock bigint, effective_min integer, effective_max integer, alert_status text, draft_min integer, draft_max integer, draft_status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult
    FROM stock_config LIMIT 1
  ),
  inv_agg AS (
    SELECT
      i.erp_sucursal_id,
      SUM(i.cantidad
        * COALESCE((regexp_match(i.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1))
        FILTER (WHERE NOT i.is_vencidos)::bigint AS total_units,
      SUM(i.cantidad
        * COALESCE((regexp_match(i.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1))
        FILTER (WHERE i.is_vencidos)::bigint AS vencidos_units
    FROM inventory i
    WHERE i.erp_product_id = p_erp_product_id
    GROUP BY i.erp_sucursal_id
  )
  SELECT
    psp.erp_sucursal_id,
    COALESCE(inv.total_units, 0)    AS current_stock,
    COALESCE(inv.vencidos_units, 0) AS vencidos_stock,
    COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)::int AS effective_min,
    COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0)::int AS effective_max,
    CASE
      WHEN COALESCE(inv.total_units, 0) = 0
        THEN 'out_of_stock'
      WHEN COALESCE(inv.total_units, 0)
           < COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)
        THEN 'below_min'
      WHEN COALESCE(inv.total_units, 0)::numeric
           < COALESCE(psp.manual_min, psp.min_units, psp.draft_min, 0)::numeric
             * (SELECT approaching_mult FROM config)
        THEN 'approaching'
      WHEN COALESCE(inv.total_units, 0)
           > COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0)
           AND COALESCE(psp.manual_max, psp.max_units, psp.draft_max, 0) > 0
        THEN 'overstocked'
      ELSE 'ok'
    END AS alert_status,
    psp.draft_min::int  AS draft_min,
    psp.draft_max::int  AS draft_max,
    COALESCE(psp.draft_status, 'none') AS draft_status
  FROM product_stock_params psp
  LEFT JOIN inv_agg inv ON inv.erp_sucursal_id = psp.erp_sucursal_id
  WHERE psp.erp_product_id = p_erp_product_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS TABLE(item_id bigint, presentacion text, id_presentacion integer, cantidad numeric, precio_unitario numeric, neto numeric, invoice_id bigint, fecha date, erp_invoice_id text, correlativo text, cliente text, branch_id integer, tipo_documento text, cod_vendedor text, tipo_pago text, lote text, fecha_vencimiento date)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    SELECT sii.id, sii.presentacion, sii.id_presentacion, sii.cantidad::numeric,
        CASE WHEN si.tipo_documento='CCF' THEN sii.precio_unitario::numeric ELSE sii.precio_unitario::numeric/1.13 END,
        CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea::numeric ELSE sii.total_linea::numeric/1.13 END,
        si.id, si.fecha, si.erp_invoice_id, si.correlativo, si.cliente, si.branch_id,
        si.tipo_documento, si.cod_vendedor, si.tipo_pago, sii.lote, sii.fecha_vencimiento
    FROM public.sales_invoice_items sii
    JOIN public.sales_invoices si ON si.id=sii.invoice_id
    WHERE sii.erp_product_id=p_erp_product_id AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND si.fecha BETWEEN p_fini AND p_ffin AND (p_branch_id IS NULL OR si.branch_id=p_branch_id)
    ORDER BY si.fecha DESC, si.id DESC LIMIT 300;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_expiring_lots(p_erp_product_id integer, p_days_ahead integer DEFAULT 60)
 RETURNS TABLE(erp_sucursal_id integer, lote text, fecha_vencimiento date, cantidad integer, presentacion text, days_remaining integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    erp_sucursal_id::integer,
    lote,
    fecha_vencimiento,
    cantidad,
    presentacion,
    (fecha_vencimiento - CURRENT_DATE)::integer AS days_remaining
  FROM inventory
  WHERE erp_product_id = p_erp_product_id
    AND is_vencidos     = false
    AND fecha_vencimiento IS NOT NULL
    AND fecha_vencimiento <= CURRENT_DATE + p_days_ahead
  ORDER BY fecha_vencimiento, erp_sucursal_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_last_sales(p_erp_product_id integer, p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(fecha date, cantidad numeric, total_linea numeric, cliente text, erp_sucursal_id integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    inv.fecha::date,
    (ii.cantidad::numeric
      * COALESCE((regexp_match(ii.presentacion, '[0-9]+[xX]([0-9]+)'))[1]::int, 1)) AS cantidad,
    ii.total_linea,
    inv.cliente,
    bm.erp_sucursal_id
  FROM sales_invoice_items ii
  JOIN sales_invoices inv  ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map bm ON bm.branch_id = inv.branch_id
  WHERE ii.erp_product_id  = p_erp_product_id
    AND (p_erp_sucursal_id IS NULL OR bm.erp_sucursal_id = p_erp_sucursal_id)
    AND inv.estado          != 'ANULADA'
    AND ii.cantidad          > 0
  ORDER BY inv.fecha DESC, inv.id DESC
  LIMIT 6;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text)
 RETURNS TABLE(erp_product_id integer, descripcion text, cantidad numeric, neto numeric, costo_total numeric, presentaciones jsonb, ultima_venta date, ultima_venta_por_suc jsonb, laboratorio_id integer, laboratorio_nombre text, oculto_en_ventas boolean, oculto_por_first_names text, oculto_por_last_names text, oculto_at timestamp with time zone)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
branch_to_erp(bid, esid) AS (
  VALUES (4::integer,1),(25::integer,2),(27::integer,3),
         (28::integer,4),(2::integer,5),(29::integer,7)
),
branch_esid AS (
  SELECT esid FROM branch_to_erp WHERE bid = p_branch_id
),

bounds AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS curr_month,
    LEAST(p_ffin, date_trunc('month', CURRENT_DATE)::date - 1) AS past_to
),
bounds2 AS (
  SELECT curr_month, past_to,
    CASE WHEN p_fini = date_trunc('month', p_fini)::date
         THEN to_char(p_fini, 'YYYY-MM')
         ELSE to_char((date_trunc('month', p_fini) + interval '1 month')::date, 'YYYY-MM') END AS ym_full_from,
    CASE WHEN past_to = (date_trunc('month', past_to) + interval '1 month' - interval '1 day')::date
         THEN to_char(past_to, 'YYYY-MM')
         ELSE to_char((date_trunc('month', past_to) - interval '1 month')::date, 'YYYY-MM') END AS ym_full_to
  FROM bounds
),

pres_partial AS (
  SELECT
    sii.erp_product_id,
    MAX(sii.descripcion)       AS descripcion,
    sii.presentacion,
    SUM(sii.cantidad::numeric) AS cantidad,
    SUM(CASE WHEN si.tipo_documento = 'CCF'
             THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13
        END)                   AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  CROSS JOIN bounds2 b
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND p_fini < b.curr_month
    AND si.fecha BETWEEN p_fini AND b.past_to
    AND (to_char(si.fecha, 'YYYY-MM') < b.ym_full_from
         OR to_char(si.fecha, 'YYYY-MM') > b.ym_full_to)
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY sii.erp_product_id, sii.presentacion
),

pres_past AS (
  SELECT
    a.erp_product_id,
    MAX(a.descripcion) AS descripcion,
    a.presentacion,
    SUM(a.cantidad)    AS cantidad,
    SUM(a.neto)        AS neto
  FROM public.product_sales_monthly_agg a
  CROSS JOIN bounds2 b
  WHERE p_fini < b.curr_month
    AND a.year_month >= b.ym_full_from
    AND a.year_month <= b.ym_full_to
    AND a.year_month <  to_char(b.curr_month, 'YYYY-MM')
    AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(a.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY a.erp_product_id, a.presentacion
),

pres_live AS (
  SELECT
    sii.erp_product_id,
    MAX(sii.descripcion)       AS descripcion,
    sii.presentacion,
    SUM(sii.cantidad::numeric) AS cantidad,
    SUM(CASE WHEN si.tipo_documento = 'CCF'
             THEN sii.total_linea::numeric
             ELSE sii.total_linea::numeric / 1.13
        END)                   AS neto
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND sii.erp_product_id != 0
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha BETWEEN GREATEST(p_fini, date_trunc('month', CURRENT_DATE)::date) AND p_ffin
    AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(sii.descripcion) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
  GROUP BY sii.erp_product_id, sii.presentacion
),

pres AS (
  SELECT
    erp_product_id,
    MAX(descripcion) AS descripcion,
    presentacion,
    SUM(cantidad)    AS cantidad,
    SUM(neto)        AS neto,
    SUM(neto) / NULLIF(SUM(cantidad), 0) AS precio_unitario_avg,
    COALESCE(
      (
        SELECT pp.factor
        FROM public.product_precios pp
        JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
        WHERE pp.product_id = u.erp_product_id
          AND pp.activo = true
          AND UPPER(u.presentacion) LIKE UPPER(pr.tipo) || ' %'
        ORDER BY length(pr.tipo) DESC
        LIMIT 1
      ),
      1
    ) AS factor
  FROM (
    SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_partial
    UNION ALL
    SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_past
    UNION ALL
    SELECT erp_product_id, descripcion, presentacion, cantidad, neto FROM pres_live
  ) u
  GROUP BY erp_product_id, presentacion
),

best_cost AS (
  SELECT
    product_id,
    COALESCE(
      MIN(costo) FILTER (WHERE vineta = 0 OR costo <= vineta),
      MIN(costo)
    ) AS costo
  FROM public.product_precios
  WHERE activo = true AND product_id IN (SELECT erp_product_id FROM pres)
  GROUP BY product_id
),

prod_with_sales AS (
  SELECT
    p.erp_product_id,
    MAX(p.descripcion)  AS descripcion,
    SUM(p.cantidad)     AS cantidad,
    SUM(p.neto)         AS neto,
    CASE WHEN COUNT(bc.costo) = 0 THEN NULL
         ELSE ROUND(SUM(bc.costo * p.cantidad), 2) END AS costo_total,
    jsonb_agg(jsonb_build_object(
      'presentacion',        p.presentacion,
      'cantidad',            p.cantidad,
      'neto',                p.neto,
      'precio_unitario_avg', p.precio_unitario_avg,
      'factor',              COALESCE(p.factor, 1)
    )) AS presentaciones
  FROM pres p
  LEFT JOIN best_cost bc ON bc.product_id = p.erp_product_id
  GROUP BY p.erp_product_id
),

zero_sale_cands AS (
  SELECT pr.id AS erp_product_id, pr.nombre AS descripcion
  FROM public.products pr
  CROSS JOIN branch_esid be
  WHERE pr.activo = true
    AND (p_search IS NULL OR p_search = '' OR public.norm_search(pr.nombre) LIKE ALL (
          ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
        ))
    AND NOT EXISTS (SELECT 1 FROM prod_with_sales pws WHERE pws.erp_product_id = pr.id)
    AND (
      EXISTS (
        SELECT 1 FROM public.product_stock_params psp
        WHERE psp.erp_product_id = pr.id AND psp.erp_sucursal_id = be.esid
          AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      )
      OR EXISTS (
        SELECT 1 FROM public.inventory inv
        WHERE inv.erp_product_id = pr.id AND inv.erp_sucursal_id = be.esid
          AND inv.is_vencidos = false AND inv.cantidad > 0
      )
    )
),

all_cands AS (
  SELECT erp_product_id, descripcion FROM prod_with_sales
  UNION ALL
  SELECT erp_product_id, descripcion FROM zero_sale_cands
),

last_sale_hist AS (
  SELECT
    a.erp_product_id AS prod_id, a.branch_id,
    ((MAX(a.year_month) || '-01')::date + INTERVAL '1 month' - INTERVAL '1 day')::date AS last_date
  FROM public.product_sales_monthly_agg a
  GROUP BY a.erp_product_id, a.branch_id
),

last_sale_live AS (
  SELECT sii.erp_product_id AS prod_id, si.branch_id, MAX(si.fecha) AS last_date
  FROM public.sales_invoice_items sii
  JOIN public.sales_invoices si ON si.id = sii.invoice_id
  WHERE sii.erp_product_id IS NOT NULL
    AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    AND si.fecha >= date_trunc('month', CURRENT_DATE)::date
  GROUP BY sii.erp_product_id, si.branch_id
),

ultima_venta_agg AS MATERIALIZED (
  SELECT
    pb.prod_id,
    MAX(pb.last_date)                                             AS ultima_venta_global,
    MAX(pb.last_date) FILTER (WHERE pb.branch_id = p_branch_id)  AS ultima_venta_branch,
    COALESCE(
      jsonb_agg(
        jsonb_build_object('branch_id', pb.branch_id, 'fecha', pb.last_date)
        ORDER BY pb.last_date DESC NULLS LAST
      ) FILTER (WHERE pb.last_date IS NOT NULL),
      '[]'::jsonb
    ) AS ultima_venta_por_suc
  FROM (
    SELECT prod_id, branch_id, MAX(last_date) AS last_date
    FROM (
      SELECT prod_id, branch_id, last_date FROM last_sale_hist
      UNION ALL
      SELECT prod_id, branch_id, last_date FROM last_sale_live
    ) u
    GROUP BY prod_id, branch_id
  ) pb
  GROUP BY pb.prod_id
)

SELECT
  ac.erp_product_id,
  COALESCE(pws.descripcion, ac.descripcion)::text AS descripcion,
  COALESCE(pws.cantidad,    0::numeric)           AS cantidad,
  COALESCE(pws.neto,        0::numeric)           AS neto,
  pws.costo_total,
  COALESCE(pws.presentaciones, '[]'::jsonb)       AS presentaciones,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END                                              AS ultima_venta,
  COALESCE(uva.ultima_venta_por_suc, '[]'::jsonb) AS ultima_venta_por_suc,
  p2.laboratorio_id,
  l2.nombre AS laboratorio_nombre,
  COALESCE(p2.oculto_en_ventas, false) AS oculto_en_ventas,
  emp.first_names AS oculto_por_first_names,
  emp.last_names  AS oculto_por_last_names,
  p2.oculto_at
FROM all_cands ac
LEFT JOIN prod_with_sales pws ON pws.erp_product_id = ac.erp_product_id
LEFT JOIN ultima_venta_agg uva ON uva.prod_id       = ac.erp_product_id
LEFT JOIN public.products p2 ON p2.id = ac.erp_product_id
LEFT JOIN public.laboratorios l2 ON l2.id = p2.laboratorio_id
LEFT JOIN public.employees emp ON emp.id = p2.oculto_por
ORDER BY
  (pws.erp_product_id IS NULL) ASC,
  COALESCE(pws.neto, 0)        DESC,
  CASE WHEN p_branch_id IS NULL
       THEN uva.ultima_venta_global
       ELSE uva.ultima_venta_branch
  END DESC NULLS LAST;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_sales_agg_jsonb(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM public.get_product_sales_agg(p_fini, p_ffin, p_branch_id, p_search) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_sales_total(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(sum(t.neto), 0)
  FROM public.get_product_sales_agg(p_fini, p_ffin, p_branch_id, NULL) t
  WHERE t.oculto_en_ventas = false;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_trend(p_erp_product_id integer, p_branch_id integer DEFAULT NULL::integer)
 RETURNS TABLE(month date, neto numeric, cantidad numeric)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
    SELECT DATE_TRUNC('month',si.fecha)::date,
           SUM(CASE WHEN si.tipo_documento='CCF' THEN sii.total_linea ELSE sii.total_linea/1.13 END)::numeric,
           SUM(sii.cantidad)::numeric
    FROM public.sales_invoice_items sii JOIN public.sales_invoices si ON si.id=sii.invoice_id
    WHERE sii.erp_product_id=p_erp_product_id AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id=p_branch_id)
      AND si.fecha>=DATE_TRUNC('month',CURRENT_DATE-INTERVAL '2 months')::date
      AND si.fecha<DATE_TRUNC('month',CURRENT_DATE+INTERVAL '1 month')::date
    GROUP BY DATE_TRUNC('month',si.fecha) ORDER BY 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_product_vencimiento_policy(p_erp_product_id integer)
 RETURNS TABLE(proveedor_id integer, proveedor_nombre text, meses_devolucion integer, es_devolutivo boolean, es_cofarsal boolean, resolucion text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH prod AS (
    SELECT p.id, p.laboratorio_id, COALESCE(p.devolutivo, true) AS producto_devolutivo
    FROM products p WHERE p.id = p_erp_product_id
  ),
  candidatos AS (
    SELECT pv.id, pv.nombre, pv.meses_devolucion, pv.devolutivo, pv.vineta
    FROM proveedores pv JOIN prod ON prod.laboratorio_id = pv.laboratorio_id
  ),
  por_vineta AS (
    SELECT c.*, 1 AS prioridad, 'vineta'::text AS metodo
    FROM candidatos c
    WHERE c.vineta IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM product_precios pp
        WHERE pp.product_id = p_erp_product_id AND pp.activo = true AND pp.vineta = c.vineta
      )
  ),
  unico AS (
    SELECT c.*, 2 AS prioridad, 'unico'::text AS metodo
    FROM candidatos c
    WHERE (SELECT count(*) FROM candidatos) = 1
  ),
  resuelto AS (
    SELECT * FROM por_vineta
    UNION ALL
    SELECT * FROM unico WHERE NOT EXISTS (SELECT 1 FROM por_vineta)
    ORDER BY prioridad, id
    LIMIT 1
  )
  SELECT
    r.id,
    r.nombre,
    r.meses_devolucion,
    (COALESCE(r.devolutivo, true) AND (SELECT producto_devolutivo FROM prod)),
    (r.nombre ~* 'cofarsal'),
    r.metodo
  FROM resuelto r;
$function$
;
CREATE OR REPLACE FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, units_sold bigint, revenue numeric, months_with_sales integer, invoice_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  )
  SELECT
    ii.erp_product_id,
    p.nombre,
    COALESCE(l.nombre, '—'),
    SUM(ii.cantidad::numeric)::bigint,
    ROUND(SUM(ii.total_linea)::numeric, 2),
    COUNT(DISTINCT DATE_TRUNC('month', inv.fecha))::integer,
    COUNT(DISTINCT ii.invoice_id)::integer
  FROM sales_invoice_items ii
  JOIN sales_invoices inv  ON inv.id  = ii.invoice_id
  JOIN branch_map bm       ON bm.bid  = inv.branch_id
    AND (p_erp_sucursal_id IS NULL OR bm.esid = p_erp_sucursal_id)
  JOIN products p          ON p.id    = ii.erp_product_id AND p.activo = true
  LEFT JOIN laboratorios l ON l.id    = p.laboratorio_id
  WHERE inv.fecha  >= CURRENT_DATE - INTERVAL '6 months'
    AND inv.estado != 'ANULADA'
    AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    AND NOT EXISTS (
      SELECT 1 FROM product_stock_params psp
      WHERE psp.erp_product_id = ii.erp_product_id
        AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
        AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
    )
  GROUP BY ii.erp_product_id, p.nombre, l.nombre
  ORDER BY SUM(ii.total_linea) DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.get_products_sold_no_minmax_jsonb(p_erp_sucursal_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM public.get_products_sold_no_minmax(p_erp_sucursal_id) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_proveedores_maestro()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      p.id, p.nit, p.dui, p.nrc, p.nombre, p.nombre_comercial, p.alias,
      p.cod_actividad, p.desc_actividad, p.tipo_establecimiento,
      p.departamento, p.municipio, p.direccion, p.telefono, p.correo,
      p.percibe_1, p.percibe_1_override, p.retiene_renta,
      p.categoria_id, c.nombre AS categoria_nombre, c.clase AS categoria_clase,
      sc.id AS categoria_sugerida_id, sc.nombre AS categoria_sugerida_nombre,
      CASE
        WHEN p.nrc IS NOT NULL THEN 'contribuyente'
        WHEN p.nit IS NOT NULL OR p.dui IS NOT NULL THEN 'sujeto_excluido'
        ELSE NULL
      END AS regimen_fiscal,
      p.supplier_id, s.nombre AS supplier_nombre,
      p.contacto_nombre, p.telefono2, p.nombre_cheques, p.notas,
      p.activo, p.pais, p.source,
      p.primera_vez_visto, p.ultima_vez_visto, p.docs_count,
      p.created_at, p.updated_at
    FROM public.proveedores_maestro p
    LEFT JOIN public.proveedores_categorias c  ON c.id = p.categoria_id
    LEFT JOIN public.suppliers s               ON s.id = p.supplier_id
    LEFT JOIN public.proveedores_categorias sc ON sc.id = public.suggest_proveedor_categoria_id(p.desc_actividad)
    ORDER BY p.nombre
  ) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH deduped AS (
    SELECT DISTINCT ON (ii.invoice_id) ii.total_linea
    FROM public.sales_invoice_items ii JOIN public.sales_invoices si ON si.id=ii.invoice_id
    WHERE ii.erp_product_id=0 AND si.fecha BETWEEN p_fini AND p_ffin
      AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id=p_branch_id)
    ORDER BY ii.invoice_id, ii.total_linea DESC)
  SELECT COALESCE(SUM(total_linea),0) FROM deduped;
$function$
;
CREATE OR REPLACE FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_hora_corte time without time zone DEFAULT NULL::time without time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH puntos_items AS MATERIALIZED (
    SELECT ii.invoice_id, ii.total_linea
    FROM public.sales_invoice_items ii
    WHERE ii.erp_product_id = 0
  ),
  deduped AS (
    SELECT DISTINCT ON (pi.invoice_id) pi.total_linea
    FROM puntos_items pi JOIN public.sales_invoices si ON si.id = pi.invoice_id
    WHERE si.fecha >= p_fini
      AND (si.fecha < p_ffin OR (si.fecha = p_ffin AND (p_hora_corte IS NULL OR si.hora <= p_hora_corte)))
      AND si.estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND si.cliente NOT ILIKE '%MAPFRE%'
    ORDER BY pi.invoice_id, pi.total_linea DESC
  )
  SELECT COALESCE(SUM(total_linea),0) FROM deduped;
$function$
;
CREATE OR REPLACE FUNCTION public.get_purchase_dte_documents(p_desde date DEFAULT (CURRENT_DATE - 60), p_hasta date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT
      d.id, d.codigo_generacion, d.tipo_dte, d.numero_control,
      d.emisor_nit, d.emisor_nrc, d.emisor_nombre,
      d.fecha_emision, d.monto_total, d.total_iva,
      d.json_path, d.pdf_path, d.account_id, d.from_email,
      d.source_message_id, d.received_at, d.created_at,
      d.supplier_id, s.nombre AS supplier_nombre,
      d.proveedor_id, p.nombre AS proveedor_nombre, p.alias AS proveedor_alias,
      d.documento_relacionado_id,
      d.invalidado, d.invalidado_motivo, d.invalidado_at,
      d.items_text,
      CASE WHEN dr.id IS NULL THEN NULL ELSE json_build_object(
        'id', dr.id, 'codigo_generacion', dr.codigo_generacion,
        'tipo_dte', dr.tipo_dte, 'numero_control', dr.numero_control,
        'monto_total', dr.monto_total, 'fecha_emision', dr.fecha_emision,
        'emisor_nombre', dr.emisor_nombre, 'json_path', dr.json_path, 'pdf_path', dr.pdf_path
      ) END AS documento_relacionado,
      (
        SELECT coalesce(json_agg(json_build_object(
          'id', nc.id, 'codigo_generacion', nc.codigo_generacion,
          'tipo_dte', nc.tipo_dte, 'numero_control', nc.numero_control,
          'monto_total', nc.monto_total, 'fecha_emision', nc.fecha_emision,
          'emisor_nombre', nc.emisor_nombre, 'json_path', nc.json_path, 'pdf_path', nc.pdf_path
        ) ORDER BY nc.fecha_emision), '[]'::json)
        FROM public.purchase_dte_documents nc
        WHERE nc.documento_relacionado_id = d.id
      ) AS notas_credito,
      (
        SELECT json_build_object('id', rq.id, 'file_path', rq.file_path, 'filename', rq.filename)
        FROM public.purchase_dte_review_queue rq
        WHERE rq.matched_document_id = d.id AND rq.status = 'emparejado' AND rq.file_path IS NOT NULL
        ORDER BY rq.resolved_at DESC
        LIMIT 1
      ) AS invalidacion_source
    FROM public.purchase_dte_documents d
    LEFT JOIN public.suppliers s ON s.id = d.supplier_id
    LEFT JOIN public.proveedores_maestro p ON p.id = d.proveedor_id
    LEFT JOIN public.purchase_dte_documents dr ON dr.id = d.documento_relacionado_id
    WHERE coalesce(d.fecha_emision, d.created_at::date) BETWEEN p_desde AND p_hasta
    ORDER BY coalesce(d.fecha_emision, d.created_at::date) DESC, d.created_at DESC
  ) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_purchase_dte_review_queue(p_status text DEFAULT 'pendiente'::text)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT id, kind, file_path, filename, reason, account_id, source_message_id,
           from_email, subject, received_at, status, matched_document_id, ai_suggested, created_at
    FROM public.purchase_dte_review_queue
    WHERE (p_status IS NULL OR status = p_status)
    ORDER BY created_at DESC
  ) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_purchase_dte_review_source(p_document_id bigint)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM (
    SELECT id, file_path, filename, subject, from_email, received_at, resolved_at
    FROM public.purchase_dte_review_queue
    WHERE matched_document_id = p_document_id AND status = 'emparejado'
    ORDER BY resolved_at DESC
  ) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(erp_product_id integer, product_name text, laboratorio text, current_stock bigint, cost_value numeric, fecha_vencimiento_min date, in_minmax boolean, min_qty numeric, max_qty numeric, sold_in jsonb, ultima_venta date, ultima_venta_por_suc jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH branch_map(bid, esid) AS (
    VALUES (4::bigint,1),(25::bigint,2),(27::bigint,3),
           (28::bigint,4),(2::bigint,5),(29::bigint,7)
  ),
  sales_6m AS (
    SELECT bm.esid AS suc_id, ii.erp_product_id AS prod_id,
      SUM(ii.cantidad::numeric * ii.factor_unidades)::bigint AS units_sold,
      ROUND(SUM(ii.total_linea)::numeric, 2) AS revenue
    FROM sales_invoice_items ii
    JOIN sales_invoices inv ON inv.id = ii.invoice_id
    JOIN branch_map bm ON bm.bid = inv.branch_id
    WHERE inv.fecha >= CURRENT_DATE - INTERVAL '6 months'
      AND inv.estado != 'ANULADA'
      AND ii.erp_product_id IS NOT NULL AND ii.cantidad > 0
    GROUP BY bm.esid, ii.erp_product_id
  ),
  last_sale_all AS (
    SELECT pls.erp_sucursal_id AS suc_id, pls.erp_product_id AS prod_id, pls.last_sale_date AS last_date
    FROM product_last_sale pls
  ),
  inv_cur AS (
    SELECT inv.erp_sucursal_id AS suc_id, inv.erp_product_id AS prod_id,
      SUM(inv.cantidad
          * COALESCE((regexp_match(inv.detalle,'\d+[xX](\d+)'))[1]::int,1))::bigint AS total_units,
      MIN(inv.fecha_vencimiento) FILTER (WHERE inv.fecha_vencimiento IS NOT NULL) AS min_venc
    FROM inventory inv
    WHERE inv.is_vencidos = false AND inv.cantidad > 0
    GROUP BY inv.erp_sucursal_id, inv.erp_product_id
  ),
  unit_costs AS (
    SELECT DISTINCT ON (product_id) product_id, (costo / factor::numeric) AS unit_cost
    FROM product_precios WHERE activo = true AND costo > 0 AND factor > 0
    ORDER BY product_id, factor ASC
  ),
  candidates AS (
    SELECT ic.suc_id, ic.prod_id, ic.total_units, ic.min_venc
    FROM inv_cur ic
    WHERE NOT EXISTS (
        SELECT 1 FROM sales_6m s
        WHERE s.suc_id = ic.suc_id AND s.prod_id = ic.prod_id
      )
      AND (p_erp_sucursal_id IS NULL OR ic.suc_id = p_erp_sucursal_id)

    UNION

    SELECT psp.erp_sucursal_id AS suc_id, psp.erp_product_id AS prod_id,
           0::bigint AS total_units, NULL::date AS min_venc
    FROM product_stock_params psp
    WHERE (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND COALESCE(psp.manual_max, psp.max_units, 0) > 0
      AND NOT EXISTS (
          SELECT 1 FROM sales_6m s
          WHERE s.suc_id = psp.erp_sucursal_id AND s.prod_id = psp.erp_product_id
        )
      AND NOT EXISTS (
          SELECT 1 FROM inv_cur ic
          WHERE ic.suc_id = psp.erp_sucursal_id AND ic.prod_id = psp.erp_product_id
        )
  ),
  candidates_agg AS (
    SELECT prod_id,
      SUM(total_units)::bigint AS total_units,
      MIN(min_venc) AS min_venc
    FROM candidates
    GROUP BY prod_id
  )
  SELECT
    c.prod_id,
    p.nombre,
    COALESCE(l.nombre, '—'),
    c.total_units,
    ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2),
    c.min_venc,
    CASE
      WHEN p_erp_sucursal_id IS NOT NULL
        THEN EXISTS (
          SELECT 1 FROM product_stock_params psp2
          WHERE psp2.erp_sucursal_id = p_erp_sucursal_id
            AND psp2.erp_product_id  = c.prod_id
            AND COALESCE(psp2.manual_max, psp2.max_units, 0) > 0
        )
      ELSE
        EXISTS (
          SELECT 1 FROM product_stock_params psp2
          WHERE psp2.erp_product_id = c.prod_id
            AND COALESCE(psp2.manual_max, psp2.max_units, 0) > 0
        )
    END AS in_minmax,
    CASE WHEN p_erp_sucursal_id IS NOT NULL
      THEN (SELECT COALESCE(psp2.manual_min, psp2.min_units)
            FROM product_stock_params psp2
            WHERE psp2.erp_sucursal_id = p_erp_sucursal_id AND psp2.erp_product_id = c.prod_id LIMIT 1)
      ELSE (SELECT COALESCE(psp2.manual_min, psp2.min_units)
            FROM product_stock_params psp2
            WHERE psp2.erp_product_id = c.prod_id LIMIT 1)
    END AS min_qty,
    CASE WHEN p_erp_sucursal_id IS NOT NULL
      THEN (SELECT COALESCE(psp2.manual_max, psp2.max_units)
            FROM product_stock_params psp2
            WHERE psp2.erp_sucursal_id = p_erp_sucursal_id AND psp2.erp_product_id = c.prod_id LIMIT 1)
      ELSE (SELECT COALESCE(psp2.manual_max, psp2.max_units)
            FROM product_stock_params psp2
            WHERE psp2.erp_product_id = c.prod_id LIMIT 1)
    END AS max_qty,
    COALESCE(
      (SELECT jsonb_agg(
                jsonb_build_object('esid', s.suc_id, 'units', s.units_sold, 'rev', s.revenue)
                ORDER BY s.revenue DESC)
       FROM sales_6m s
       WHERE s.prod_id = c.prod_id
         AND (p_erp_sucursal_id IS NULL OR s.suc_id != p_erp_sucursal_id)),
      '[]'::jsonb
    ) AS sold_in,
    (SELECT MAX(ls.last_date) FROM last_sale_all ls
     WHERE ls.prod_id = c.prod_id
       AND (p_erp_sucursal_id IS NULL OR ls.suc_id = p_erp_sucursal_id)) AS ultima_venta,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('esid', ls.suc_id, 'fecha', ls.last_date)
               ORDER BY ls.last_date DESC NULLS LAST)
       FROM last_sale_all ls WHERE ls.prod_id = c.prod_id),
      '[]'::jsonb
    ) AS ultima_venta_por_suc
  FROM candidates_agg c
  JOIN products p ON p.id = c.prod_id AND p.activo = true
  LEFT JOIN laboratorios l ON l.id = p.laboratorio_id
  LEFT JOIN unit_costs uc ON uc.product_id = c.prod_id
  ORDER BY ROUND(c.total_units * COALESCE(uc.unit_cost, 0), 2) DESC NULLS LAST;
$function$
;
CREATE OR REPLACE FUNCTION public.get_stagnant_inventory_jsonb(p_erp_sucursal_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM public.get_stagnant_inventory(p_erp_sucursal_id) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer)
 RETURNS TABLE(erp_product_id integer, product_name text, abc_class text, daily_velocity numeric, velocity_30d numeric, cv numeric, demand_variability text, effective_min integer, effective_max integer, has_manual boolean, units_sold_6m integer, revenue_6m numeric, current_stock bigint, presentations jsonb, calculated_at timestamp with time zone, alert_status text, is_dead_stock boolean, draft_min integer, draft_max integer, draft_abc_class text, draft_demand_variability text, draft_calculated_at timestamp with time zone, draft_status text, foto_url text, published_by text, laboratorio_nombre text, is_hidden boolean, calc_min integer, calc_max integer, last_sale_date date, last_sale_sucursal_id integer, is_catalog_only boolean, dispatch_multiplo smallint, dispatch_pres_factor numeric, dispatch_tipo text, pub_min integer, pub_max integer, has_pending_branches boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH config AS (
    SELECT (1.0 + approaching_pct / 100.0) AS approaching_mult
    FROM stock_config LIMIT 1
  ),
  live_sales AS (
    -- F3.1: antes escaneaba 574,848 lineas de sales_invoice_items + 133,260
    -- facturas EN CADA CARGA (983 ms de 1,085 ms medidos en Bodega) solo para
    -- pisar units_sold_6m y velocity_30d. Ahora son ~16 K filas indexadas.
    SELECT
      r.erp_product_id,
      SUM(r.units_analysis)::integer AS units_sold_live,
      SUM(r.units_30d) / 30.0        AS velocity_30d_live
    FROM product_sales_rollup r
    WHERE (p_erp_sucursal_id = 6 OR r.erp_sucursal_id = p_erp_sucursal_id)
    GROUP BY r.erp_product_id
  ),
  pres_factors AS (
    -- SIN `activo = true` A PROPOSITO: esto convierte unidades de inventario, no
    -- lista opciones de catalogo. Filtrar por activo subcontaria el stock de
    -- cualquier presentacion desactivada que todavia tenga existencia
    -- (COALESCE(factor,1) → una caja pasa a valer 1). El filtro por activo va en
    -- catalog_pres / catalog_base_pres, que si son catalogos de opciones.
    SELECT product_id, UPPER(descripcion) AS desc_key, MAX(factor) AS factor
    FROM product_precios
    GROUP BY product_id, UPPER(descripcion)
  ),
  dispatch_pres_factor AS (
    SELECT DISTINCT ON (dr.erp_product_id) dr.erp_product_id,
      pp.factor::numeric AS dp_factor,
      COALESCE(dr.dispatch_multiplo,1)::numeric AS dp_multiplo,
      COALESCE(dr.dispatch_label, pres.tipo) AS dp_tipo
    FROM dispatch_rules dr
    JOIN product_precios pp ON pp.product_id = dr.erp_product_id AND pp.id_presentacion = dr.dispatch_id_presentacion
    JOIN presentaciones pres ON pres.id = dr.dispatch_id_presentacion
    WHERE dr.dispatch_id_presentacion IS NOT NULL
    ORDER BY dr.erp_product_id, pp.factor DESC
  ),
  inv_rows AS MATERIALIZED (
    -- F3.2 — una sola pasada por inventory. Antes eran dos (inv_base + inv_all_pres).
    SELECT i.erp_product_id, i.erp_sucursal_id, i.presentacion AS tipo,
      COALESCE(pf.factor, 1) AS factor, i.cantidad
    FROM inventory i
    LEFT JOIN pres_factors pf ON pf.product_id = i.erp_product_id AND pf.desc_key = UPPER(i.detalle)
    WHERE i.is_vencidos = false
      AND (p_erp_sucursal_id = 6 OR i.erp_sucursal_id = p_erp_sucursal_id)
  ),
  inv_base AS (
    SELECT erp_product_id, tipo, factor, cantidad
    FROM inv_rows
    WHERE erp_sucursal_id = p_erp_sucursal_id
  ),
  inv_grouped AS (
    SELECT erp_product_id, tipo, factor, SUM(cantidad) AS qty
    FROM inv_base GROUP BY erp_product_id, tipo, factor
  ),
  inv_summary AS (
    SELECT erp_product_id,
      SUM(qty * factor)::bigint AS total_units,
      COALESCE(
        jsonb_agg(jsonb_build_object('tipo', tipo, 'factor', factor) ORDER BY factor DESC)
          FILTER (WHERE factor > 1),
        '[]'::jsonb
      ) AS presentations
    FROM inv_grouped GROUP BY erp_product_id
  ),
  inv_all_pres AS (
    SELECT DISTINCT ON (erp_product_id, factor)
      erp_product_id, tipo, factor
    FROM inv_rows
    ORDER BY erp_product_id, factor, tipo
  ),
  inv_base_pres AS (
    SELECT DISTINCT ON (erp_product_id)
      erp_product_id, jsonb_build_object('tipo', tipo, 'factor', factor) AS base_pres
    FROM inv_all_pres ORDER BY erp_product_id, factor ASC
  ),
  inv_other_pres_agg AS (
    SELECT erp_product_id,
      jsonb_agg(jsonb_build_object('tipo', tipo, 'factor', factor) ORDER BY factor DESC) AS presentations
    FROM inv_all_pres WHERE factor > 1
    GROUP BY erp_product_id
  ),
  catalog_pres AS (
    SELECT product_id,
      jsonb_agg(jsonb_build_object('tipo', descripcion, 'factor', factor) ORDER BY factor DESC) AS presentations
    FROM product_precios WHERE factor > 1 AND activo = true
    GROUP BY product_id
  ),
  catalog_base_pres AS (
    SELECT DISTINCT ON (pp.product_id)
      pp.product_id AS erp_product_id,
      jsonb_build_object('tipo', pr.tipo, 'factor', pp.factor) AS base_pres
    FROM product_precios pp
    JOIN presentaciones pr ON pr.id = pp.id_presentacion
    WHERE pp.activo = true
    ORDER BY pp.product_id, pp.factor ASC
  ),
  last_sale AS (
    SELECT
      pls.erp_product_id,
      MAX(pls.last_sale_date) AS last_sale_date,
      CASE WHEN p_erp_sucursal_id = 6 THEN (
        SELECT pls2.erp_sucursal_id FROM product_last_sale pls2
        WHERE pls2.erp_product_id = pls.erp_product_id
        ORDER BY pls2.last_sale_date DESC LIMIT 1
      ) ELSE NULL END AS last_sale_sucursal_id
    FROM product_last_sale pls
    WHERE p_erp_sucursal_id = 6 OR pls.erp_sucursal_id = p_erp_sucursal_id
    GROUP BY pls.erp_product_id
  ),
  pending_branches AS (
    SELECT erp_product_id, true AS has_pending
    FROM product_stock_params
    WHERE erp_sucursal_id != 6 AND draft_status = 'pending'
    GROUP BY erp_product_id
  ),
  params AS (
    SELECT
      psp.erp_product_id, psp.abc_class,
      COALESCE(psp.daily_velocity, psp.draft_velocity)         AS daily_velocity,
      COALESCE(psp.velocity_30d,   psp.draft_velocity_30d, 0) AS velocity_30d,
      psp.cv, psp.demand_variability,
      minmax_effective(COALESCE(psp.min_units, psp.draft_min, 0), psp.manual_min)::int AS eff_min,
      minmax_effective(COALESCE(psp.max_units, psp.draft_max, 0), psp.manual_max)::int AS eff_max,
      (psp.manual_min IS NOT NULL OR psp.manual_max IS NOT NULL) AS has_manual,
      COALESCE(psp.units_sold_6m, psp.draft_units_sold)       AS units_sold_6m,
      COALESCE(psp.revenue_6m,    psp.draft_revenue)          AS revenue_6m,
      psp.calculated_at, psp.draft_min, psp.draft_max,
      psp.draft_abc_class, psp.draft_demand_variability, psp.draft_calculated_at,
      COALESCE(psp.draft_status, 'none') AS draft_status,
      psp.published_by, psp.is_hidden, psp.calc_min, psp.calc_max,
      COALESCE(psp.min_units, 0)::int AS pub_min,
      COALESCE(psp.max_units, 0)::int AS pub_max
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id = p_erp_sucursal_id
  )
  SELECT
    combined.erp_product_id, combined.product_name, combined.abc_class,
    combined.daily_velocity,
    COALESCE(ls.velocity_30d_live::numeric, combined.velocity_30d)        AS velocity_30d,
    combined.cv, combined.demand_variability,
    combined.effective_min, combined.effective_max, combined.has_manual,
    COALESCE(ls.units_sold_live, combined.units_sold_6m)                  AS units_sold_6m,
    combined.revenue_6m, combined.current_stock,
    CASE
      WHEN cbp.base_pres IS NOT NULL THEN jsonb_build_array(cbp.base_pres)
      WHEN ibp.base_pres IS NOT NULL THEN jsonb_build_array(ibp.base_pres)
      ELSE '[]'::jsonb
    END || (CASE
      WHEN combined.presentations != '[]'::jsonb AND combined.presentations IS NOT NULL
           THEN combined.presentations
      WHEN iop.presentations IS NOT NULL THEN iop.presentations
      ELSE COALESCE(cp.presentations, '[]'::jsonb)
    END) AS presentations,
    combined.calculated_at, combined.alert_status, combined.is_dead_stock,
    combined.draft_min, combined.draft_max, combined.draft_abc_class, combined.draft_demand_variability,
    combined.draft_calculated_at, combined.draft_status,
    combined.foto_url, combined.published_by, combined.laboratorio_nombre, combined.is_hidden,
    combined.calc_min, combined.calc_max,
    ls_date.last_sale_date, ls_date.last_sale_sucursal_id,
    combined.is_catalog_only,
    COALESCE(dpf.dp_multiplo, 1)::smallint AS dispatch_multiplo,
    dpf.dp_factor AS dispatch_pres_factor,
    dpf.dp_tipo AS dispatch_tipo,
    combined.pub_min, combined.pub_max,
    COALESCE(pb.has_pending, false) AS has_pending_branches
  FROM (
    SELECT p.id AS erp_product_id, p.nombre AS product_name,
      pr.abc_class, pr.daily_velocity, pr.velocity_30d, pr.cv, pr.demand_variability,
      pr.eff_min AS effective_min, pr.eff_max AS effective_max, pr.has_manual,
      pr.units_sold_6m, pr.revenue_6m,
      COALESCE(inv.total_units, 0::bigint) AS current_stock,
      COALESCE(inv.presentations, '[]'::jsonb) AS presentations,
      pr.calculated_at,
      CASE
        WHEN COALESCE(inv.total_units,0) = 0 THEN 'out_of_stock'
        WHEN COALESCE(inv.total_units,0) < pr.eff_min THEN 'below_min'
        WHEN COALESCE(inv.total_units,0)::numeric < pr.eff_min*(SELECT approaching_mult FROM config)
             THEN 'approaching'
        WHEN COALESCE(inv.total_units,0) > pr.eff_max AND pr.eff_max > 0 THEN 'overstocked'
        ELSE 'ok'
      END AS alert_status,
      false::boolean AS is_dead_stock,
      pr.draft_min, pr.draft_max, pr.draft_abc_class, pr.draft_demand_variability,
      pr.draft_calculated_at, pr.draft_status, p.foto_url, pr.published_by,
      lab.nombre AS laboratorio_nombre, pr.is_hidden, pr.calc_min, pr.calc_max,
      false::boolean AS is_catalog_only, pr.pub_min, pr.pub_max
    FROM params pr
    JOIN products p ON p.id = pr.erp_product_id
    LEFT JOIN laboratorios lab ON lab.id = p.laboratorio_id
    LEFT JOIN inv_summary inv ON inv.erp_product_id = pr.erp_product_id
    WHERE (lab.ocultar_en_minmax IS NOT TRUE) AND p.activo = true AND pr.daily_velocity IS NOT NULL

    UNION ALL

    SELECT inv2.erp_product_id, p2.nombre,
      'D'::text, 0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int, false::boolean, NULL::int, NULL::numeric,
      inv2.total_units, inv2.presentations, NULL::timestamptz, 'dead_stock'::text, true::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text, NULL::timestamptz, 'none'::text,
      p2.foto_url, NULL::text, lab2.nombre, false::boolean, NULL::int, NULL::int,
      false::boolean, 0::int, 0::int
    FROM inv_summary inv2
    JOIN products p2 ON p2.id = inv2.erp_product_id
    LEFT JOIN laboratorios lab2 ON lab2.id = p2.laboratorio_id
    WHERE NOT EXISTS (SELECT 1 FROM product_stock_params psp2
                      WHERE psp2.erp_product_id = inv2.erp_product_id
                        AND psp2.erp_sucursal_id = p_erp_sucursal_id)
      AND p2.activo = true AND (lab2.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    SELECT p3.id, p3.nombre, 'D'::text, 0::numeric, 0::numeric, 0::numeric, 'X'::text,
      minmax_effective(COALESCE(psp3.min_units, psp3.draft_min,0), psp3.manual_min)::int,
      minmax_effective(COALESCE(psp3.max_units, psp3.draft_max,0), psp3.manual_max)::int,
      (psp3.manual_min IS NOT NULL OR psp3.manual_max IS NOT NULL)::boolean,
      0::int, NULL::numeric,
      COALESCE(inv3b.total_units, 0::bigint), COALESCE(inv3b.presentations, '[]'::jsonb),
      NULL::timestamptz, 'dead_stock'::text, true::boolean,
      psp3.draft_min, psp3.draft_max, NULL::text, NULL::text,
      psp3.draft_calculated_at, COALESCE(psp3.draft_status,'none'),
      p3.foto_url, psp3.published_by, lab3.nombre, COALESCE(psp3.is_hidden,false)::boolean,
      psp3.calc_min, psp3.calc_max,
      false::boolean, COALESCE(psp3.min_units,0)::int, COALESCE(psp3.max_units,0)::int
    FROM product_stock_params psp3
    JOIN products p3 ON p3.id = psp3.erp_product_id
    LEFT JOIN laboratorios lab3 ON lab3.id = p3.laboratorio_id
    LEFT JOIN inv_summary inv3b ON inv3b.erp_product_id = psp3.erp_product_id
    WHERE psp3.erp_sucursal_id = p_erp_sucursal_id AND p3.activo = true
      AND psp3.daily_velocity IS NULL AND psp3.draft_velocity IS NULL
      AND (lab3.ocultar_en_minmax IS NOT TRUE)

    UNION ALL

    SELECT p4.id, p4.nombre, 'D'::text, 0::numeric, 0::numeric, 0::numeric, 'X'::text,
      0::int, 0::int, false::boolean, 0::int, NULL::numeric,
      0::bigint, '[]'::jsonb, NULL::timestamptz, 'no_data'::text, false::boolean,
      NULL::int, NULL::int, NULL::text, NULL::text, NULL::timestamptz, 'none'::text,
      p4.foto_url, NULL::text, lab4.nombre, false::boolean, NULL::int, NULL::int,
      true::boolean, 0::int, 0::int
    FROM products p4
    LEFT JOIN laboratorios lab4 ON lab4.id = p4.laboratorio_id
    WHERE p4.activo = true AND (lab4.ocultar_en_minmax IS NOT TRUE)
      AND NOT EXISTS (SELECT 1 FROM product_stock_params psp4
                      WHERE psp4.erp_product_id = p4.id AND psp4.erp_sucursal_id = p_erp_sucursal_id)
      AND NOT EXISTS (SELECT 1 FROM inv_summary inv4b WHERE inv4b.erp_product_id = p4.id)
  ) combined
  LEFT JOIN live_sales       ls   ON ls.erp_product_id   = combined.erp_product_id
  LEFT JOIN last_sale        ls_date ON ls_date.erp_product_id = combined.erp_product_id
  LEFT JOIN dispatch_pres_factor dpf ON dpf.erp_product_id = combined.erp_product_id
  LEFT JOIN catalog_pres     cp   ON cp.product_id       = combined.erp_product_id
  LEFT JOIN inv_base_pres    ibp  ON ibp.erp_product_id  = combined.erp_product_id
  LEFT JOIN inv_other_pres_agg iop ON iop.erp_product_id = combined.erp_product_id
  LEFT JOIN catalog_base_pres cbp ON cbp.erp_product_id  = combined.erp_product_id
  LEFT JOIN pending_branches pb   ON pb.erp_product_id   = combined.erp_product_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_stock_analysis_jsonb(p_erp_sucursal_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json)
  FROM public.get_stock_analysis(p_erp_sucursal_id) t;
$function$
;
CREATE OR REPLACE FUNCTION public.get_sucursal_net_stock(p_product_ids integer[])
 RETURNS TABLE(erp_product_id integer, net_stock bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH pres_factors AS (
        -- Un factor por (producto, descripcion) — evita multiplicar filas en el SUM
        SELECT product_id, UPPER(descripcion) AS desc_key, MAX(factor) AS factor
        FROM product_precios
        GROUP BY product_id, UPPER(descripcion)
    )
    SELECT
        i.erp_product_id::INT,
        SUM(i.cantidad * COALESCE(pf.factor, 1))::bigint AS net_stock
    FROM inventory i
    LEFT JOIN pres_factors pf
        ON pf.product_id = i.erp_product_id
        AND pf.desc_key  = UPPER(i.detalle)
    WHERE i.erp_product_id = ANY(p_product_ids)
      AND i.erp_sucursal_id != 6
      AND i.is_vencidos = false
    GROUP BY i.erp_product_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_top_supplier_per_product(p_product_ids integer[])
 RETURNS TABLE(erp_product_id integer, proveedor text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
    WITH ranked AS (
        SELECT
            pri.erp_product_id,
            pr.proveedor,
            ROW_NUMBER() OVER (
                PARTITION BY pri.erp_product_id
                ORDER BY SUM(pri.cantidad) DESC
            ) AS rn
        FROM purchase_receipt_items pri
        JOIN purchase_receipts pr ON pr.id = pri.receipt_id
        WHERE pri.erp_product_id = ANY(p_product_ids)
          AND pr.proveedor IS NOT NULL
        GROUP BY pri.erp_product_id, pr.proveedor
    )
    SELECT erp_product_id::INT, proveedor
    FROM ranked
    WHERE rn = 1;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vendedor_diario(p_branch_id bigint, p_cod_vendedor text, p_fini date, p_ffin date)
 RETURNS TABLE(fecha date, total_ventas numeric, total_facturas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    SELECT fecha, ROUND(SUM(total)::numeric,2), COUNT(*)::bigint
    FROM public.sales_invoices WHERE branch_id=p_branch_id AND cod_vendedor=p_cod_vendedor
      AND fecha>=p_fini AND fecha<=p_ffin AND estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    GROUP BY fecha ORDER BY fecha;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vendedor_diario(p_cod_vendedor text, p_fini date, p_ffin date)
 RETURNS TABLE(fecha date, branch_id bigint, total_ventas numeric, total_facturas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    SELECT fecha, branch_id, ROUND(SUM(total)::numeric,2), COUNT(*)::bigint
    FROM public.sales_invoices WHERE cod_vendedor=p_cod_vendedor
      AND fecha>=p_fini AND fecha<=p_ffin AND estado NOT IN ('NULA','DTE INVALIDADO EN MH')
    GROUP BY fecha, branch_id ORDER BY fecha, branch_id;
$function$
;
CREATE OR REPLACE FUNCTION public.get_vendedores_resumen(p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(branch_id bigint, cod_vendedor text, total_ventas numeric, total_facturas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    SELECT branch_id, cod_vendedor, ROUND(SUM(total)::numeric,2), COUNT(*)::bigint
    FROM public.sales_invoices WHERE fecha>=p_fini AND fecha<=p_ffin
      AND estado NOT IN ('NULA','DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id=p_branch_id)
    GROUP BY branch_id, cod_vendedor ORDER BY SUM(total) DESC;
$function$
;
CREATE OR REPLACE FUNCTION public.get_ventas_con_puntos(p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL::bigint, p_sort_col text DEFAULT 'fecha'::text, p_sort_dir text DEFAULT 'DESC'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, branch_id bigint, erp_invoice_id text, correlativo text, tipo_documento text, fecha date, hora time without time zone, cliente text, cod_vendedor text, tipo_pago text, subtotal numeric, iva numeric, total numeric, estado text, n bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE v_sort_col text; v_sort_dir text; v_sql text;
BEGIN
    v_sort_col := CASE p_sort_col
        WHEN 'fecha' THEN 'si.fecha' WHEN 'correlativo' THEN 'si.correlativo'
        WHEN 'tipo_documento' THEN 'si.tipo_documento' WHEN 'branch_id' THEN 'si.branch_id'
        WHEN 'cod_vendedor' THEN 'si.cod_vendedor' WHEN 'cliente' THEN 'si.cliente'
        WHEN 'tipo_pago' THEN 'si.tipo_pago' WHEN 'total' THEN 'si.total' ELSE 'si.fecha' END;
    v_sort_dir := CASE WHEN lower(p_sort_dir)='asc' THEN 'ASC' ELSE 'DESC' END;
    v_sql := format('WITH base AS (SELECT si.* FROM public.sales_invoices si
        WHERE si.has_puntos=true AND si.fecha BETWEEN %L AND %L
          AND si.estado NOT IN (''NULA'',''DTE INVALIDADO EN MH'')
          AND (%L::bigint IS NULL OR si.branch_id=%L::bigint) AND si.cliente NOT ILIKE ''%%MAPFRE%%''),
        total_cnt AS (SELECT COUNT(*) AS n FROM base)
        SELECT si.id,si.branch_id,si.erp_invoice_id,si.correlativo,si.tipo_documento,si.fecha,si.hora,
               si.cliente,si.cod_vendedor,si.tipo_pago,si.subtotal,si.iva,si.total,si.estado,c.n
        FROM base si CROSS JOIN total_cnt c ORDER BY %s %s,si.fecha DESC,si.hora DESC LIMIT %s OFFSET %s',
        p_fini,p_ffin,p_branch_id,p_branch_id,v_sort_col,v_sort_dir,p_limit,p_offset);
    RETURN QUERY EXECUTE v_sql;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer DEFAULT NULL::integer, p_hora_corte time without time zone DEFAULT NULL::time without time zone)
 RETURNS TABLE(total_count bigint, total_sum numeric)
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
WITH
-- Earliest date in sales_daily_stats for this branch (NULL = table empty)
coverage AS (
    SELECT MIN(date) AS since
    FROM public.sales_daily_stats
    WHERE (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Past days covered by daily_stats (fast path)
from_stats AS (
    SELECT
        COALESCE(SUM(count_valid), 0)::bigint AS cnt,
        COALESCE(SUM(sum_total), 0)           AS total
    FROM public.sales_daily_stats
    WHERE date >= GREATEST(p_fini, COALESCE((SELECT since FROM coverage), CURRENT_DATE))
      AND date < CURRENT_DATE
      AND date <= p_ffin
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Raw scan for dates before daily_stats coverage (bootstrap fallback).
-- After full backfill: LEAST(since, CURRENT_DATE) <= p_fini → 0 rows → essentially free.
from_raw AS (
    SELECT
        COUNT(*)::bigint                 AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE fecha >= p_fini
      AND fecha <  LEAST(COALESCE((SELECT since FROM coverage), CURRENT_DATE), CURRENT_DATE)
      AND fecha <= p_ffin
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
),
-- Today from raw tables (always live, supports hora_corte)
live AS (
    SELECT
        COUNT(*)                         AS cnt,
        COALESCE(SUM(total::numeric), 0) AS total
    FROM public.sales_invoices
    WHERE p_ffin >= CURRENT_DATE
      AND fecha  >= GREATEST(p_fini, CURRENT_DATE)
      AND (fecha < p_ffin OR (fecha = p_ffin AND (p_hora_corte IS NULL OR hora <= p_hora_corte)))
      AND estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
)
SELECT (s.cnt + r.cnt + l.cnt), (s.total + r.total + l.total)
FROM from_stats s, from_raw r, live l;
$function$
;
CREATE OR REPLACE FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text, p_estado_item text DEFAULT 'CONTADO'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_live_sistema int4;
  v_diferencia int4;
  v_evento text;
BEGIN
  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;
  IF v_conteo.status NOT IN ('BORRADOR','EN_PROGRESO') THEN
    RAISE EXCEPTION 'CONTEO_CERRADO_NO_EDITABLE';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF p_estado_item NOT IN ('PENDIENTE','CONTADO','SIN_UBICAR') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO';
  END IF;

  -- Nada cambió: la línea queda EXACTAMENTE como estaba. Devolver lo guardado
  -- --no lo que diga inventory ahora-- es lo que evita que un click de más
  -- convierta una línea cuadrada en un faltante inventado.
  IF v_item.fisico_cantidad IS NOT DISTINCT FROM p_fisico_cantidad
     AND v_item.nota IS NOT DISTINCT FROM p_nota
     AND v_item.estado_item IS NOT DISTINCT FROM p_estado_item THEN
    RETURN jsonb_build_object(
      'sistema_cantidad', v_item.sistema_cantidad,
      'diferencia', v_item.diferencia,
      'evento', 'SIN_CAMBIO'
    );
  END IF;

  IF v_item.es_agregado_manual OR v_item.source_sync_key IS NULL THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSE
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  END IF;

  v_diferencia := CASE WHEN p_fisico_cantidad IS NULL THEN NULL ELSE p_fisico_cantidad - v_live_sistema END;

  v_evento := CASE
    WHEN v_item.fisico_cantidad IS NULL AND p_fisico_cantidad IS NOT NULL THEN 'CAPTURA'
    WHEN v_item.fisico_cantidad IS NOT NULL AND p_fisico_cantidad IS NULL THEN 'BORRADO'
    ELSE 'EDICION'
  END;

  UPDATE public.conteo_inventario_items
  SET fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = p_estado_item,
      nota = p_nota,
      contado_por = public.auth_employee_id(),
      contado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history
    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, p_estado_item, p_nota,
          public.auth_employee_id(), v_evento);

  RETURN jsonb_build_object('sistema_cantidad', v_live_sistema, 'diferencia', v_diferencia, 'evento', v_evento);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.init_pedido_sucursal_codigos(p_pedido_id uuid, p_codigos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    item JSONB;
BEGIN
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(p_codigos)
    LOOP
        INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id, codigo)
        VALUES (
            p_pedido_id,
            (item->>'erp_sucursal_id')::INTEGER,
            item->>'codigo'
        )
        ON CONFLICT (pedido_id, erp_sucursal_id) DO UPDATE
            SET codigo = EXCLUDED.codigo
            WHERE pedido_sucursal_status.codigo IS NULL;
    END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.insert_missing_products(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.nombre
  FROM json_to_recordset(p_rows) AS r(id integer, nombre text)
  WHERE r.id IS NOT NULL
  ORDER BY r.id
),
inserted AS (
  INSERT INTO public.products (id, nombre, updated_at)
  SELECT i.id, i.nombre, now()
  FROM incoming i
  WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = i.id)
  ON CONFLICT (id) DO NOTHING
  RETURNING 1
)
SELECT count(*)::integer FROM inserted;
$function$
;
CREATE OR REPLACE FUNCTION public.inventory_grouped(p_erp_id integer DEFAULT NULL::integer, p_vencidos boolean DEFAULT false, p_proximos boolean DEFAULT false, p_search text DEFAULT NULL::text, p_lab_id integer DEFAULT NULL::integer, p_categoria text DEFAULT NULL::text, p_sort text DEFAULT 'descripcion'::text, p_sort_dir text DEFAULT 'asc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_area_vencidos boolean DEFAULT false)
 RETURNS TABLE(total bigint, erp_sucursal_id integer, erp_product_id integer, descripcion text, presentaciones text[], num_lotes bigint, lote_sample text, total_unidades numeric, earliest_venc date, es_antibiotico boolean, laboratorio text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total bigint;
    v_today date := CURRENT_DATE;
    v_pats text[] := (
        SELECT array_agg('%' || tok || '%')
        FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
        WHERE tok <> ''
    );
BEGIN

-- ═══════════════════════════════════════════════════════════════
-- PATH D: área de vencidos (ubicación 2, bodega) — MV only
-- ═══════════════════════════════════════════════════════════════
IF p_area_vencidos THEN

    SELECT COUNT(*) INTO v_total
    FROM inventory_grouped_mv m
    WHERE m.vencidos_unidades > 0
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats));

    RETURN QUERY
    SELECT v_total,
           m.erp_sucursal_id, m.erp_product_id, m.descripcion,
           m.presentaciones,  m.num_lotes,       m.lote_sample,
           m.total_unidades,  m.earliest_venc,   m.es_antibiotico,
           l.nombre
    FROM inventory_grouped_mv m
    LEFT JOIN laboratorios l ON l.id = m.laboratorio_id
    WHERE m.vencidos_unidades > 0
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats))
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN m.descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN m.descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN l.nombre          END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN l.nombre          END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN m.vencidos_unidades END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN m.vencidos_unidades END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN m.earliest_venc   END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN m.earliest_venc   END DESC NULLS LAST,
        m.descripcion ASC,
        CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

-- ═══════════════════════════════════════════════════════════════
-- PATH A: normal view — MV only (<10ms)
-- ═══════════════════════════════════════════════════════════════
ELSIF NOT p_vencidos AND NOT p_proximos THEN

    SELECT COUNT(*) INTO v_total
    FROM inventory_grouped_mv m
    WHERE (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats));

    RETURN QUERY
    SELECT v_total,
           m.erp_sucursal_id, m.erp_product_id, m.descripcion,
           m.presentaciones,  m.num_lotes,       m.lote_sample,
           m.total_unidades,  m.earliest_venc,   m.es_antibiotico,
           l.nombre
    FROM inventory_grouped_mv m
    LEFT JOIN laboratorios l ON l.id = m.laboratorio_id
    WHERE (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats))
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN m.descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN m.descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN l.nombre          END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN l.nombre          END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN m.total_unidades  END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN m.total_unidades  END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN m.earliest_venc   END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN m.earliest_venc   END DESC NULLS LAST,
        m.descripcion ASC,
        CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

-- ═══════════════════════════════════════════════════════════════
-- PATH B: proximos — MV only, zero raw inventory scan (<5ms)
-- ═══════════════════════════════════════════════════════════════
ELSIF p_proximos THEN

    SELECT COUNT(*) INTO v_total
    FROM inventory_grouped_mv m
    WHERE m.soonest_active_venc IS NOT NULL
      AND m.soonest_active_venc < v_today + INTERVAL '180 days'
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats));

    RETURN QUERY
    SELECT v_total,
           m.erp_sucursal_id, m.erp_product_id, m.descripcion,
           m.presentaciones,  m.num_lotes,       m.lote_sample,
           m.total_unidades,  m.earliest_venc,   m.es_antibiotico,
           l.nombre
    FROM inventory_grouped_mv m
    LEFT JOIN laboratorios l ON l.id = m.laboratorio_id
    WHERE m.soonest_active_venc IS NOT NULL
      AND m.soonest_active_venc < v_today + INTERVAL '180 days'
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats))
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN m.descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN m.descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN l.nombre          END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN l.nombre          END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN m.total_unidades  END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN m.total_unidades  END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN m.soonest_active_venc END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN m.soonest_active_venc END DESC NULLS LAST,
        m.soonest_active_venc ASC NULLS LAST,
        m.descripcion ASC,
        CASE m.erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

-- ═══════════════════════════════════════════════════════════════
-- PATH C: vencidos por fecha (raw scan, semantics differ)
-- ═══════════════════════════════════════════════════════════════
ELSE

    SELECT COUNT(*) INTO v_total
    FROM (
        SELECT 1 FROM inventory i
        LEFT JOIN products p ON p.id = i.erp_product_id
        WHERE i.is_vencidos = false
          AND i.fecha_vencimiento IS NOT NULL
          AND i.fecha_vencimiento < v_today
          AND (p_erp_id    IS NULL OR i.erp_sucursal_id  = p_erp_id::smallint)
          AND (p_lab_id    IS NULL OR p.laboratorio_id   = p_lab_id)
          AND (p_categoria IS NULL OR p.tipo_medicamento = p_categoria)
          AND (v_pats IS NULL OR public.norm_search(i.descripcion) LIKE ALL (v_pats))
        GROUP BY i.erp_sucursal_id, i.erp_product_id
    ) sub;

    RETURN QUERY
    WITH base AS (
        SELECT
            i.erp_sucursal_id::int AS b_erp_sucursal_id,
            i.erp_product_id::int AS b_erp_product_id,
            MAX(i.descripcion)::text AS b_descripcion,
            array_remove(array_agg(DISTINCT i.presentacion) FILTER (
                WHERE i.cantidad * COALESCE(NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::int, 1) > 0
            ), NULL) AS b_presentaciones,
            COUNT(DISTINCT NULLIF(i.lote, '')) AS b_num_lotes,
            CASE WHEN COUNT(DISTINCT NULLIF(i.lote, '')) = 1
                 THEN MIN(NULLIF(i.lote, '')) END AS b_lote_sample,
            COALESCE(SUM(
                i.cantidad::numeric *
                COALESCE(NULLIF(split_part(LOWER(COALESCE(i.detalle,'')), 'x', 2), '')::numeric, 1)
            ), 0) AS b_total_unidades,
            MIN(i.fecha_vencimiento)
                FILTER (WHERE i.fecha_vencimiento IS NOT NULL) AS b_earliest_venc,
            COALESCE(BOOL_OR(p.es_antibiotico), false) AS b_es_antibiotico,
            MAX(l.nombre) AS b_laboratorio
        FROM inventory i
        LEFT JOIN products p ON p.id = i.erp_product_id
        LEFT JOIN laboratorios l ON l.id = p.laboratorio_id
        WHERE i.is_vencidos = false
          AND i.fecha_vencimiento IS NOT NULL
          AND i.fecha_vencimiento < v_today
          AND (p_erp_id    IS NULL OR i.erp_sucursal_id  = p_erp_id::smallint)
          AND (p_lab_id    IS NULL OR p.laboratorio_id   = p_lab_id)
          AND (p_categoria IS NULL OR p.tipo_medicamento = p_categoria)
          AND (v_pats IS NULL OR public.norm_search(i.descripcion) LIKE ALL (v_pats))
        GROUP BY i.erp_sucursal_id, i.erp_product_id
    )
    SELECT v_total, b.b_erp_sucursal_id, b.b_erp_product_id, b.b_descripcion,
           b.b_presentaciones, b.b_num_lotes, b.b_lote_sample,
           b.b_total_unidades, b.b_earliest_venc, b.b_es_antibiotico,
           b.b_laboratorio
    FROM base b
    ORDER BY
        CASE WHEN p_sort='sucursal' AND p_sort_dir='asc'  THEN
            CASE b.b_erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END ASC NULLS LAST,
        CASE WHEN p_sort='sucursal' AND p_sort_dir='desc' THEN
            CASE b.b_erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END
        END DESC NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='asc'  THEN b.b_descripcion     END ASC  NULLS LAST,
        CASE WHEN p_sort='descripcion' AND p_sort_dir='desc' THEN b.b_descripcion     END DESC NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='asc'  THEN b.b_laboratorio     END ASC  NULLS LAST,
        CASE WHEN p_sort='laboratorio' AND p_sort_dir='desc' THEN b.b_laboratorio     END DESC NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='asc'  THEN b.b_total_unidades  END ASC  NULLS LAST,
        CASE WHEN p_sort='unidades'    AND p_sort_dir='desc' THEN b.b_total_unidades  END DESC NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='asc'  THEN b.b_earliest_venc   END ASC  NULLS LAST,
        CASE WHEN p_sort='vence'       AND p_sort_dir='desc' THEN b.b_earliest_venc   END DESC NULLS LAST,
        b.b_descripcion ASC,
        CASE b.b_erp_sucursal_id WHEN 6 THEN 1 WHEN 5 THEN 2 WHEN 1 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 4 THEN 6 WHEN 7 THEN 7 ELSE 99 END ASC
    LIMIT p_limit OFFSET p_offset;

END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.inventory_inversion(p_erp_id integer DEFAULT NULL::integer, p_search text DEFAULT NULL::text, p_lab_id integer DEFAULT NULL::integer, p_categoria text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result numeric;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  IF NOT auth_has_module_permission('productos_tab_inventario', 'can_view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere acceso a Productos > Inventario';
  END IF;

  SELECT COALESCE(SUM(m.total_costo), 0) INTO v_result
  FROM inventory_grouped_mv m
  WHERE (p_erp_id    IS NULL OR m.erp_sucursal_id = p_erp_id)
    AND (p_lab_id    IS NULL OR m.laboratorio_id  = p_lab_id)
    AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
    AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats));

  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.inventory_proximos_count(p_erp_id integer DEFAULT NULL::integer, p_lab_id integer DEFAULT NULL::integer, p_categoria text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT COUNT(*)
    FROM inventory_grouped_mv m
    WHERE m.soonest_active_venc IS NOT NULL
      AND m.soonest_active_venc < CURRENT_DATE + INTERVAL '180 days'
      AND (p_erp_id    IS NULL OR m.erp_sucursal_id  = p_erp_id)
      AND (p_lab_id    IS NULL OR m.laboratorio_id   = p_lab_id)
      AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
      AND (p_search IS NULL OR p_search = ''
           OR public.norm_search(m.descripcion) LIKE ALL (
                ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
              ))
$function$
;
CREATE OR REPLACE FUNCTION public.kiosk_auth_code_for(p_branch_id bigint, p_bucket timestamp with time zone, p_su boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
DECLARE
    v_secret TEXT;
    v_hex    TEXT;
    v_num    INT;
BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'kiosk_auth_pepper';

    IF v_secret IS NULL THEN
        RAISE EXCEPTION 'KIOSK_PEPPER_MISSING';
    END IF;

    v_hex := encode(
        extensions.hmac(
            COALESCE(p_branch_id::text, '-') || ':' ||
            to_char(p_bucket AT TIME ZONE 'UTC', 'YYYYMMDDHH24') || ':' ||
            CASE WHEN p_su THEN 'SU' ELSE 'BASE' END,
            v_secret, 'sha256'),
        'hex');

    v_num := ('x0' || substr(v_hex, 1, 7))::bit(32)::int;

    RETURN CASE WHEN p_su
                THEN lpad((v_num % 100)::text,   2, '0')
                ELSE lpad((v_num % 10000)::text, 4, '0')
           END;
END $function$
;
CREATE OR REPLACE FUNCTION public.lock_module(p_module_key text, p_reason text DEFAULT NULL::text, p_hours integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp_id   uuid;
  v_emp_name text;
  v_hours    int := LEAST(GREATEST(COALESCE(p_hours, 4), 1), 24);
  v_now      timestamptz := now();
BEGIN
  v_emp_id := public.auth_employee_id();
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'NO_EMPLOYEE: no se pudo resolver tu empleado; no se puede tomar el candado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE module_key = p_module_key) THEN
    RAISE EXCEPTION 'UNKNOWN_MODULE: % no es un módulo conocido', p_module_key;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.get_lockable_modules() g WHERE g.module_key = p_module_key) THEN
    RAISE EXCEPTION 'MODULE_NOT_LOCKABLE: % no tiene escritura gateada por auth_can_edit_any, así que el candado no lo frenaría', p_module_key;
  END IF;

  IF NOT public.auth_has_module_permission(p_module_key, 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en %', p_module_key;
  END IF;

  SELECT name INTO v_emp_name FROM public.employees WHERE id = v_emp_id;

  INSERT INTO public.module_locks (module_key, locked_by_id, locked_by_name, reason, locked_at, expires_at)
  VALUES (p_module_key, v_emp_id, COALESCE(v_emp_name, 'Sin nombre'), p_reason, v_now,
          v_now + make_interval(hours => v_hours))
  ON CONFLICT (module_key) DO UPDATE SET
    locked_by_id   = EXCLUDED.locked_by_id,
    locked_by_name = EXCLUDED.locked_by_name,
    reason         = EXCLUDED.reason,
    locked_at      = EXCLUDED.locked_at,
    expires_at     = EXCLUDED.expires_at
  WHERE module_locks.expires_at <= v_now
     OR module_locks.locked_by_id = EXCLUDED.locked_by_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_LOCKED: % ya está bloqueado por otra persona', p_module_key;
  END IF;

  RETURN jsonb_build_object('ok', true, 'module_key', p_module_key,
                            'locked_by', COALESCE(v_emp_name, 'Sin nombre'),
                            'expires_at', v_now + make_interval(hours => v_hours));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.marcar_ajuste_erp(p_conteo_id uuid, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
BEGIN
  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = p_conteo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTEO_NO_ENCONTRADO'; END IF;

  -- Solo después de aprobado. Ajustar el ERP con un conteo que nadie firmó es
  -- exactamente lo que el paso de aprobación existe para impedir.
  IF v_conteo.status != 'CERRADO' THEN
    RAISE EXCEPTION 'CONTEO_NO_APROBADO';
  END IF;
  IF v_conteo.ajuste_erp_aplicado THEN
    RAISE EXCEPTION 'AJUSTE_YA_APLICADO';
  END IF;

  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_edit') THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;

  UPDATE public.conteos_inventario
  SET ajuste_erp_aplicado = true,
      ajuste_erp_por = v_actor,
      ajuste_erp_at = now(),
      ajuste_erp_nota = NULLIF(TRIM(p_nota), '')
  WHERE id = p_conteo_id;

  RETURN jsonb_build_object('ok', true, 'ajuste_erp_at', now());
END;
$function$
;
CREATE OR REPLACE FUNCTION public.marcar_pedido_enviado(p_pedido_id uuid, p_enviado_por uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_status text;
  v_actor  uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;

  SELECT status INTO v_status
  FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status <> 'confirmado' THEN
    RAISE EXCEPTION 'Solo un pedido en estado "confirmado" puede marcarse como enviado (estado actual: %).', v_status;
  END IF;

  UPDATE pedidos
  SET status      = 'enviado',
      enviado_por = v_actor,
      enviado_at  = now()
  WHERE id = p_pedido_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.merge_purchase_dte_documents(p_target_id bigint, p_source_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_target public.purchase_dte_documents;
  v_source public.purchase_dte_documents;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_target_id = p_source_id THEN
    RAISE EXCEPTION 'el documento destino y origen no pueden ser el mismo';
  END IF;

  SELECT * INTO v_target FROM public.purchase_dte_documents WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documento destino % no existe', p_target_id;
  END IF;
  IF v_target.codigo_generacion IS NOT NULL OR v_target.json_path IS NOT NULL THEN
    RAISE EXCEPTION 'el documento destino ya tiene JSON — no aplica "Adjuntar JSON"';
  END IF;

  SELECT * INTO v_source FROM public.purchase_dte_documents WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documento origen % no existe', p_source_id;
  END IF;
  IF v_source.codigo_generacion IS NULL OR v_source.json_path IS NULL THEN
    RAISE EXCEPTION 'el documento origen no tiene un JSON completo';
  END IF;

  -- NC/ND que apuntaban al origen (ahora se va a borrar) pasan a apuntar al destino.
  UPDATE public.purchase_dte_documents
    SET documento_relacionado_id = p_target_id
    WHERE documento_relacionado_id = p_source_id;

  -- Se borra el origen ANTES de copiar codigo_generacion al destino — la
  -- UNIQUE de codigo_generacion no es diferible, así que setearlo en destino
  -- mientras el origen todavía lo tiene falla con violación de unicidad.
  DELETE FROM public.purchase_dte_documents WHERE id = p_source_id;

  UPDATE public.purchase_dte_documents SET
    codigo_generacion         = v_source.codigo_generacion,
    tipo_dte                  = v_source.tipo_dte,
    numero_control             = v_source.numero_control,
    emisor_nit                 = v_source.emisor_nit,
    emisor_nrc                 = v_source.emisor_nrc,
    emisor_nombre               = v_source.emisor_nombre,
    fecha_emision               = v_source.fecha_emision,
    monto_total                 = v_source.monto_total,
    total_iva                   = v_source.total_iva,
    json_path                   = v_source.json_path,
    orig_json_path               = v_source.orig_json_path,
    sello_recibido               = v_source.sello_recibido,
    items_text                   = v_source.items_text,
    pdf_path                     = coalesce(v_target.pdf_path, v_source.pdf_path),
    supplier_id                  = coalesce(v_target.supplier_id, v_source.supplier_id),
    proveedor_id                 = coalesce(v_target.proveedor_id, v_source.proveedor_id),
    invalidado                   = v_source.invalidado,
    invalidado_motivo             = v_source.invalidado_motivo,
    invalidado_at                 = v_source.invalidado_at,
    documento_relacionado_id      = coalesce(v_target.documento_relacionado_id, v_source.documento_relacionado_id)
  WHERE id = p_target_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.minmax_effective(p_base integer, p_manual integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE($1, 0) + COALESCE($2, 0)
$function$
;
CREATE OR REPLACE FUNCTION public.next_cotizacion_numero()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE year_str TEXT := TO_CHAR(CURRENT_DATE, 'YYYY'); seq_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(numero, '-', 3) AS INT)), 0) + 1 INTO seq_num
  FROM public.cotizaciones WHERE numero LIKE 'COT-' || year_str || '-%';
  RETURN 'COT-' || year_str || '-' || LPAD(seq_num::TEXT, 5, '0');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.norm_search(text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT trim(lower(regexp_replace(
    public.f_unaccent(coalesce($1, '')),
    '[.\-/,;:()''"’]', '', 'g'
  )))
$function$
;
CREATE OR REPLACE FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_count integer;
BEGIN
  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
  SELECT e.id, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
  FROM public.employees e
  WHERE e.branch_id = p_branch_id
    AND e.status = 'ACTIVO'
    AND (v_actor IS NULL OR e.id <> v_actor);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
        'title', p_title,
        'message', COALESCE(p_body, ''),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'BRANCH',
        'target_value', jsonb_build_array(p_branch_id)
      )
    );
  END IF;

  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text DEFAULT ''::text, p_link text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_push boolean DEFAULT false, p_branch_id integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_actor uuid := public.auth_employee_id();
  v_targets uuid[];
  v_count integer;
BEGIN
  SELECT array_agg(DISTINCT e.id) INTO v_targets
  FROM public.employees e
  WHERE e.id = ANY(p_recipients)
    AND (v_actor IS NULL OR e.id <> v_actor);

  IF v_targets IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata, branch_id, created_by)
  SELECT t, p_type, p_title, COALESCE(p_body, ''), p_link, COALESCE(p_metadata, '{}'::jsonb), p_branch_id, v_actor
  FROM unnest(v_targets) t;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF p_push AND v_count > 0 THEN
    PERFORM net.http_post(
      url     := public.push_function_url(),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object(
        'title', p_title,
        'message', COALESCE(p_body, ''),
        'url', COALESCE(p_link, '/home'),
        'target_type', 'EMPLOYEE',
        'target_value', to_jsonb(v_targets)
      )
    );
  END IF;

  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_missing_roster()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_next_monday   date;
  v_roster_count  int;
  v_th_ids        text[];
  v_target_type   text;
  v_target_value  jsonb;
BEGIN
  v_next_monday := CURRENT_DATE + 2;

  SELECT COUNT(*) INTO v_roster_count
  FROM employee_rosters
  WHERE week_start_date = v_next_monday;

  IF v_roster_count > 0 THEN RETURN; END IF;

  -- Resolve TH recipients (role_id = 11). El status canonico es 'ACTIVO'.
  SELECT ARRAY_AGG(id::text) INTO v_th_ids
  FROM employees
  WHERE role_id = 11 AND status = 'ACTIVO';

  IF v_th_ids IS NOT NULL AND array_length(v_th_ids, 1) > 0 THEN
    v_target_type  := 'EMPLOYEE';
    v_target_value := to_jsonb(v_th_ids);
  ELSE
    v_target_type  := 'ALL';
    v_target_value := NULL;
  END IF;

  INSERT INTO announcements
    (title, message, target_type, target_value, read_by, is_archived, priority, metadata)
  VALUES (
    'Horario de próxima semana no configurado',
    'No se ha publicado ningún horario para la semana del ' ||
      to_char(v_next_monday, 'DD/MM/YYYY') ||
      '. Si no se configura antes del lunes, el kiosk usará el último horario disponible. Configura los horarios en el módulo de Turnos.',
    v_target_type,
    v_target_value,
    '[]'::jsonb,
    false,
    'HIGH',
    jsonb_build_object(
      'source',          'cron-roster-check',
      'next_week_start', v_next_monday::text,
      'triggered_at',    now()::text
    )
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_push_on_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  payload jsonb;
BEGIN
  IF NEW.is_archived THEN RETURN NEW; END IF;
  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for > now() THEN RETURN NEW; END IF;

  payload := jsonb_build_object(
    'announcement_id', NEW.id,
    'title',   COALESCE(NEW.title, 'Nuevo aviso'),
    'message', CASE WHEN NEW.priority = 'URGENT' THEN 'Aviso urgente · Portal Farmalasa' ELSE 'Nuevo aviso · Portal Farmalasa' END,
    'url',     '/my-announcements',
    'urgent',  (NEW.priority = 'URGENT'),
    'target_type',  NEW.target_type,
    'target_value', NEW.target_value
  );

  PERFORM net.http_post(
    url     := public.push_function_url(),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := payload
  );

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.preview_muestra_ciclica(p_branch_id bigint, p_tamano integer DEFAULT 200)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids int[];
  v_muestra json;
  v_cobertura json;
BEGIN
  SELECT array_agg(m.erp_sucursal_id) INTO v_ids FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
  IF v_ids IS NULL THEN RETURN json_build_object('error', 'SUCURSAL_SIN_MAPEO_ERP'); END IF;

  SELECT json_object_agg(segmento, n) INTO v_muestra
  FROM (SELECT segmento, count(*) n FROM public.seleccionar_muestra_ciclica(p_branch_id, p_tamano) GROUP BY 1) t;

  SELECT json_build_object(
    'universo', count(*),
    'nunca_contados', count(*) FILTER (WHERE u.last_at IS NULL),
    'mas_de_6_meses', count(*) FILTER (WHERE u.last_at IS NOT NULL AND u.last_at < now() - interval '6 months')
  ) INTO v_cobertura
  FROM (SELECT DISTINCT i.erp_product_id AS pid FROM public.inventory i WHERE i.erp_sucursal_id = ANY(v_ids)) x
  JOIN public.products p ON p.id = x.pid AND p.activo = true
  LEFT JOIN LATERAL (
    SELECT max(ci.contado_at) AS last_at
    FROM public.conteo_inventario_items ci
    JOIN public.conteos_inventario c ON c.id = ci.conteo_id
    WHERE c.branch_id = p_branch_id AND ci.erp_product_id = x.pid AND ci.contado_at IS NOT NULL
  ) u ON true;

  RETURN json_build_object('muestra', COALESCE(v_muestra, '{}'::json), 'cobertura', v_cobertura);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.publish_stock_params(p_erp_sucursal_id integer DEFAULT NULL::integer, p_erp_product_ids integer[] DEFAULT NULL::integer[], p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count        INTEGER;
  v_bodega_count INTEGER := 0;
  v_now          TIMESTAMPTZ := NOW();
  v_publisher    TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos']))
     AND (p_erp_sucursal_id IS NULL
          OR p_erp_sucursal_id IS DISTINCT FROM (SELECT public.auth_employee_erp_sucursal_id())) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: tu permiso es solo para tu sucursal';
  END IF;

  WITH par_ordenado AS (
    SELECT
      psp.id,
      LEAST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0))    AS lo,
      GREATEST(COALESCE(psp.draft_min, 0), COALESCE(psp.draft_max, 0)) AS hi
    FROM product_stock_params psp
    WHERE psp.draft_status     = 'pending'
      AND psp.erp_sucursal_id != 6
      AND (p_erp_sucursal_id IS NULL OR psp.erp_sucursal_id = p_erp_sucursal_id)
      AND (p_erp_product_ids IS NULL OR psp.erp_product_id  = ANY(p_erp_product_ids))
  ),
  con_min AS (
    SELECT id, hi, GREATEST(lo, CASE WHEN hi > 1 THEN 1 ELSE 0 END) AS n_min
    FROM par_ordenado
  ),
  par AS (
    SELECT id, n_min,
           CASE WHEN n_min >= 1 THEN GREATEST(hi, n_min + 1) ELSE hi END AS n_max
    FROM con_min
  ),
  published AS (
    UPDATE product_stock_params psp
    SET
      abc_class                = psp.draft_abc_class,
      daily_velocity           = psp.draft_velocity,
      velocity_30d             = psp.draft_velocity_30d,
      cv                       = psp.draft_cv,
      demand_variability       = psp.draft_demand_variability,
      min_units                = par.n_min,
      max_units                = par.n_max,
      units_sold_6m            = psp.draft_units_sold,
      revenue_6m               = psp.draft_revenue,
      data_days                = psp.draft_data_days,
      calculated_at            = psp.draft_calculated_at,
      draft_min                = NULL,
      draft_max                = NULL,
      draft_abc_class          = NULL,
      draft_demand_variability = NULL,
      draft_cv                 = NULL,
      draft_velocity           = NULL,
      draft_velocity_30d       = NULL,
      draft_units_sold         = NULL,
      draft_revenue            = NULL,
      draft_data_days          = NULL,
      draft_calculated_at      = NULL,
      draft_status             = 'none',
      published_at             = v_now,
      published_by             = v_publisher,
      updated_at               = v_now
    FROM par
    WHERE par.id = psp.id
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM published;

  IF p_erp_sucursal_id IS DISTINCT FROM 6 THEN
    WITH branch_sums AS (
      SELECT
        s.erp_product_id,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_min ELSE s.min_units END, 0))::integer AS eff_min,
        SUM(COALESCE(CASE WHEN s.draft_status = 'pending' THEN s.draft_max ELSE s.max_units END, 0))::integer AS eff_max,
        SUM(COALESCE(s.min_units, 0))::integer AS pub_min,
        SUM(COALESCE(s.max_units, 0))::integer AS pub_max
      FROM product_stock_params s
      WHERE s.erp_sucursal_id != 6
        AND s.is_hidden IS NOT TRUE
        AND (p_erp_product_ids IS NULL OR s.erp_product_id = ANY(p_erp_product_ids))
      GROUP BY s.erp_product_id
      HAVING
        SUM(COALESCE(s.min_units, 0)) > 0
        OR SUM(COALESCE(s.max_units, 0)) > 0
        OR EXISTS (
          SELECT 1 FROM product_stock_params b
          WHERE b.erp_sucursal_id = 6
            AND b.erp_product_id  = s.erp_product_id
            AND b.draft_status    = 'pending'
        )
    ),
    bodega_min AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max,
        GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS n_min
      FROM branch_sums
    ),
    bodega AS (
      SELECT
        erp_product_id, eff_min, eff_max, pub_min, pub_max, n_min,
        GREATEST(pub_max, CASE WHEN n_min >= 1 THEN n_min + 1 ELSE 0 END) AS n_max
      FROM bodega_min
    )
    INSERT INTO product_stock_params AS psp (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status,
      published_at, published_by, updated_at
    )
    SELECT
      erp_product_id, 6,
      n_min,
      n_max,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_min ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN eff_max ELSE NULL END,
      CASE WHEN eff_min != pub_min OR eff_max != pub_max THEN 'pending' ELSE 'none' END,
      v_now, v_publisher, v_now
    FROM bodega
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units    = EXCLUDED.min_units,
      max_units    = EXCLUDED.max_units,
      draft_min    = EXCLUDED.draft_min,
      draft_max    = EXCLUDED.draft_max,
      draft_status = EXCLUDED.draft_status,
      published_at = EXCLUDED.published_at,
      published_by = EXCLUDED.published_by,
      updated_at   = EXCLUDED.updated_at
    WHERE psp.is_hidden IS NOT TRUE
      AND (psp.min_units, psp.max_units, psp.draft_min, psp.draft_max, psp.draft_status)
       IS DISTINCT FROM
          (EXCLUDED.min_units, EXCLUDED.max_units, EXCLUDED.draft_min, EXCLUDED.draft_max, EXCLUDED.draft_status);

    GET DIAGNOSTICS v_bodega_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'published',      v_count,
    'bodega_updated', v_bodega_count,
    'at',             v_now
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.push_function_url()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT 'https://sacecdkdmsdvgqnrsett.supabase.co/functions/v1/send-push-notification'::text;
$function$
;
CREATE OR REPLACE FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  UPDATE public.conteos_inventario c
  SET total_items = t.n,
      total_contados = t.contados,
      total_diferencias = t.difs,
      total_recontados = t.recontados,
      valor_faltante = t.falt,
      valor_sobrante = t.sobra
  FROM (
    SELECT count(*) n,
           count(*) FILTER (WHERE estado_item != 'PENDIENTE') contados,
           count(*) FILTER (WHERE diferencia IS NOT NULL AND diferencia != 0) difs,
           count(*) FILTER (WHERE recontado_at IS NOT NULL) recontados,
           COALESCE(SUM(GREATEST(-diferencia,0) * COALESCE(costo_unitario,0)),0) falt,
           COALESCE(SUM(GREATEST(diferencia,0) * COALESCE(costo_unitario,0)),0) sobra
    FROM public.conteo_inventario_items WHERE conteo_id = p_conteo_id
  ) t
  WHERE c.id = p_conteo_id;
$function$
;
CREATE OR REPLACE FUNCTION public.receive_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_status    text;
  v_item      jsonb;
  v_qty_diff  boolean;
  v_has_diff  boolean;
  v_error     text;
  v_cant_prob integer;
  v_actor     uuid := auth_employee_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;

  SELECT status INTO v_status FROM pedidos WHERE id = p_pedido_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_status IN ('anulado', 'completado') THEN
    RAISE EXCEPTION 'El pedido ya está % y no puede ser modificado.', v_status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_error     := NULLIF(TRIM(v_item->>'error_tipo'), '');
    v_cant_prob := NULLIF(v_item->>'cantidad_problema', '')::integer;

    SELECT (pi.cantidad_asignada IS DISTINCT FROM (v_item->>'cantidad_recibida')::integer)
    INTO v_qty_diff
    FROM pedido_items pi
    WHERE pi.id              = (v_item->>'pedido_item_id')::integer
      AND pi.erp_sucursal_id = p_sucursal_id
      AND pi.pedido_id       = p_pedido_id
      AND pi.status          = 'pendiente'
      AND NOT COALESCE(pi.falta_caja, false);

    CONTINUE WHEN v_qty_diff IS NULL;

    v_has_diff := v_qty_diff OR (v_error IS NOT NULL);

    UPDATE pedido_items SET
      cantidad_recibida = (v_item->>'cantidad_recibida')::integer,
      nota_diferencia   = NULLIF(TRIM(v_item->>'nota_diferencia'), ''),
      error_tipo        = v_error,
      cantidad_problema = v_cant_prob,
      status            = CASE WHEN v_has_diff THEN 'con_diferencia' ELSE 'recibido' END,
      received_at       = now(),
      received_by       = v_actor
    WHERE id              = (v_item->>'pedido_item_id')::integer
      AND erp_sucursal_id = p_sucursal_id
      AND pedido_id       = p_pedido_id
      AND status          = 'pendiente'
      AND NOT COALESCE(falta_caja, false);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'pendiente'
  ) THEN
    IF EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'con_diferencia') THEN
      UPDATE pedidos SET status = 'parcial'    WHERE id = p_pedido_id;
    ELSE
      UPDATE pedidos SET status = 'completado' WHERE id = p_pedido_id;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pedido_items WHERE pedido_id = p_pedido_id AND status = 'con_diferencia') THEN
    UPDATE pedidos SET status = 'parcial' WHERE id = p_pedido_id;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item public.conteo_inventario_items%ROWTYPE;
  v_conteo public.conteos_inventario%ROWTYPE;
  v_actor uuid := public.auth_employee_id();
  v_live_sistema int4;
  v_diferencia int4;
BEGIN
  IF p_fisico_cantidad IS NULL OR p_fisico_cantidad < 0 THEN
    RAISE EXCEPTION 'CANTIDAD_INVALIDA';
  END IF;

  SELECT * INTO v_item FROM public.conteo_inventario_items WHERE id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NO_ENCONTRADO'; END IF;

  SELECT * INTO v_conteo FROM public.conteos_inventario WHERE id = v_item.conteo_id;

  IF v_conteo.status != 'FINALIZADO' THEN
    RAISE EXCEPTION 'CONTEO_NO_ESTA_EN_REVISION';
  END IF;
  IF NOT public.auth_has_module_permission('conteo_inventario', 'can_approve') THEN
    RAISE EXCEPTION 'SIN_PERMISO_RECUENTO';
  END IF;
  IF public.auth_module_scope('conteo_inventario') != 'ALL' AND v_conteo.branch_id != public.auth_employee_branch_id() THEN
    RAISE EXCEPTION 'FUERA_DE_ALCANCE';
  END IF;
  IF v_actor IS NOT NULL AND v_actor = v_item.contado_por THEN
    RAISE EXCEPTION 'RECUENTO_MISMO_CONTADOR';
  END IF;

  IF v_item.es_agregado_manual OR v_item.source_sync_key IS NULL THEN
    v_live_sistema := v_item.sistema_cantidad;
  ELSE
    SELECT COALESCE((SELECT cantidad FROM public.inventory WHERE sync_key = v_item.source_sync_key), 0)
    INTO v_live_sistema;
  END IF;

  v_diferencia := p_fisico_cantidad - v_live_sistema;

  UPDATE public.conteo_inventario_items
  SET fisico_primer_conteo = COALESCE(fisico_primer_conteo, fisico_cantidad),
      fisico_cantidad = p_fisico_cantidad,
      sistema_cantidad = v_live_sistema,
      diferencia = v_diferencia,
      estado_item = CASE WHEN p_fisico_cantidad = 0 AND v_live_sistema > 0 THEN 'SIN_UBICAR' ELSE 'CONTADO' END,
      nota = COALESCE(NULLIF(TRIM(p_nota), ''), nota),
      recontado_por = v_actor,
      recontado_at = now()
  WHERE id = p_item_id;

  INSERT INTO public.conteo_inventario_item_history
    (item_id, fisico_cantidad, sistema_cantidad, diferencia, estado_item, nota, contado_por, evento)
  VALUES (p_item_id, p_fisico_cantidad, v_live_sistema, v_diferencia, 'CONTADO',
          COALESCE(NULLIF(TRIM(p_nota), ''), 'Recuento de supervisor'), v_actor, 'RECUENTO');

  PERFORM public.recalcular_totales_conteo(v_item.conteo_id);

  RETURN jsonb_build_object(
    'sistema_cantidad', v_live_sistema,
    'diferencia', v_diferencia,
    'fisico_primer_conteo', COALESCE(v_item.fisico_primer_conteo, v_item.fisico_cantidad)
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.refresh_inventory_grouped_mv()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cur  bigint;
  v_prev bigint;
BEGIN
  SELECT n_tup_ins + n_tup_upd + n_tup_del INTO v_cur
  FROM pg_stat_user_tables WHERE relname = 'inventory';

  SELECT last_writes INTO v_prev
  FROM public.mv_refresh_state WHERE mv_name = 'inventory_grouped_mv';

  IF v_prev IS NOT NULL AND v_cur IS NOT NULL AND v_cur = v_prev THEN
    RETURN; -- inventory no cambió desde el último refresh
  END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY inventory_grouped_mv;

  INSERT INTO public.mv_refresh_state (mv_name, last_writes, refreshed_at)
  VALUES ('inventory_grouped_mv', COALESCE(v_cur, -1), now())
  ON CONFLICT (mv_name) DO UPDATE
    SET last_writes = EXCLUDED.last_writes, refreshed_at = now();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.refresh_product_sales_monthly_agg(p_months_back integer DEFAULT 3)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_curr_month     date;
    v_from_date      date;
    v_watermark      timestamptz;
    v_new_watermark  timestamptz;
    v_written        integer;
BEGIN
    v_curr_month := date_trunc('month', CURRENT_DATE)::date;
    v_from_date  := (v_curr_month - (p_months_back || ' months')::interval)::date;

    SELECT watermark INTO v_watermark
    FROM public.job_watermarks
    WHERE job_name = 'refresh_product_sales_monthly_agg';

    IF v_watermark IS NULL THEN
        v_watermark := v_from_date::timestamptz;
    END IF;

    v_new_watermark := now() - interval '15 minutes';

    IF v_new_watermark <= v_watermark THEN
        RETURN 0;
    END IF;

    WITH touched_invoices AS (
        SELECT si.id, si.fecha, si.branch_id
        FROM public.sales_invoices si
        WHERE si.updated_at > v_watermark
          AND si.updated_at <= v_new_watermark
          AND si.fecha >= v_from_date
          AND si.fecha <  v_curr_month
    ),
    affected_keys AS (
        SELECT DISTINCT
            to_char(ti.fecha, 'YYYY-MM')       AS year_month,
            ti.branch_id,
            sii.erp_product_id,
            COALESCE(sii.presentacion, '')     AS presentacion
        FROM public.sales_invoice_items sii
        JOIN touched_invoices ti ON ti.id = sii.invoice_id
        WHERE sii.erp_product_id IS NOT NULL
          AND sii.erp_product_id != 0
    ),
    fresh AS (
        SELECT
            to_char(si.fecha, 'YYYY-MM')       AS year_month,
            si.branch_id,
            sii.erp_product_id,
            COALESCE(sii.presentacion, '')     AS presentacion,
            MAX(sii.descripcion)               AS descripcion,
            SUM(sii.cantidad::numeric)         AS cantidad,
            SUM(CASE WHEN si.tipo_documento = 'CCF'
                     THEN sii.total_linea::numeric
                     ELSE sii.total_linea::numeric / 1.13
                END)                           AS neto
        FROM public.sales_invoice_items sii
        JOIN public.sales_invoices si ON si.id = sii.invoice_id
        JOIN affected_keys ak
          ON ak.year_month    = to_char(si.fecha, 'YYYY-MM')
         AND ak.branch_id     = si.branch_id
         AND ak.erp_product_id = sii.erp_product_id
         AND ak.presentacion  = COALESCE(sii.presentacion, '')
        WHERE sii.erp_product_id IS NOT NULL
          AND sii.erp_product_id != 0
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
          AND si.fecha >= v_from_date
          AND si.fecha <  v_curr_month
        GROUP BY 1, 2, 3, 4
    ),
    del AS (
        DELETE FROM public.product_sales_monthly_agg a
        WHERE (a.year_month, a.branch_id, a.erp_product_id, a.presentacion) IN
              (SELECT year_month, branch_id, erp_product_id, presentacion FROM affected_keys)
          AND NOT EXISTS (SELECT 1 FROM fresh f
                          WHERE f.year_month     = a.year_month
                            AND f.branch_id      = a.branch_id
                            AND f.erp_product_id = a.erp_product_id
                            AND f.presentacion   = a.presentacion)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO public.product_sales_monthly_agg
            (year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto)
        SELECT year_month, branch_id, erp_product_id, presentacion, descripcion, cantidad, neto
        FROM fresh
        ON CONFLICT (year_month, branch_id, erp_product_id, presentacion) DO UPDATE
        SET descripcion = EXCLUDED.descripcion,
            cantidad    = EXCLUDED.cantidad,
            neto        = EXCLUDED.neto
        WHERE (product_sales_monthly_agg.descripcion, product_sales_monthly_agg.cantidad, product_sales_monthly_agg.neto)
              IS DISTINCT FROM (EXCLUDED.descripcion, EXCLUDED.cantidad, EXCLUDED.neto)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    INSERT INTO public.job_watermarks (job_name, watermark, updated_at)
    VALUES ('refresh_product_sales_monthly_agg', v_new_watermark, now())
    ON CONFLICT (job_name) DO UPDATE SET watermark = EXCLUDED.watermark, updated_at = now();

    RETURN v_written;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.refresh_product_sales_rollup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_days     integer;
  v_upserted integer := 0;
  v_deleted  integer := 0;
BEGIN
  SELECT analysis_days INTO v_days FROM public.stock_config WHERE id = 1;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'NO_CONFIG: stock_config id=1 no existe';
  END IF;

  SET LOCAL work_mem = '128MB';

  CREATE TEMP TABLE _psr_agg ON COMMIT DROP AS
  SELECT
    esm.erp_sucursal_id,
    ii.erp_product_id,
    SUM(ii.cantidad::numeric * ii.factor_unidades) AS units_analysis,
    SUM(CASE WHEN inv.fecha >= CURRENT_DATE - 30
             THEN ii.cantidad::numeric * ii.factor_unidades
             ELSE 0 END)                           AS units_30d
  FROM sales_invoice_items ii
  JOIN sales_invoices inv    ON inv.id = ii.invoice_id
  JOIN erp_sucursal_map esm  ON esm.branch_id = inv.branch_id AND esm.es_bodega = false
  WHERE inv.fecha         >= CURRENT_DATE - v_days
    AND inv.estado        != 'ANULADA'
    AND ii.erp_product_id IS NOT NULL
    AND ii.cantidad        > 0
  GROUP BY esm.erp_sucursal_id, ii.erp_product_id;

  WITH up AS (
    INSERT INTO public.product_sales_rollup AS r
      (erp_product_id, erp_sucursal_id, units_analysis, units_30d, analysis_days, updated_at)
    SELECT a.erp_product_id, a.erp_sucursal_id, a.units_analysis, a.units_30d, v_days, now()
    FROM _psr_agg a
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE
      SET units_analysis = EXCLUDED.units_analysis,
          units_30d      = EXCLUDED.units_30d,
          analysis_days  = EXCLUDED.analysis_days,
          updated_at     = now()
      WHERE (r.units_analysis, r.units_30d, r.analysis_days)
         IS DISTINCT FROM (EXCLUDED.units_analysis, EXCLUDED.units_30d, EXCLUDED.analysis_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_upserted FROM up;

  DELETE FROM public.product_sales_rollup r
  WHERE NOT EXISTS (
    SELECT 1 FROM _psr_agg a
    WHERE a.erp_product_id = r.erp_product_id
      AND a.erp_sucursal_id = r.erp_sucursal_id
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'analysis_days', v_days,
    'upserted', v_upserted,
    'deleted', v_deleted,
    'at', now()
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.refresh_sales_daily_stats(p_days_back integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_from_date date;
    v_today     date;
    v_written   integer;
    v_has_history boolean;
BEGIN
    v_today := CURRENT_DATE;

    -- Cold-start: si no hay historia de ≥30 días, backfill completo de 365
    SELECT EXISTS(
        SELECT 1 FROM public.sales_daily_stats WHERE date <= v_today - 30
    ) INTO v_has_history;

    IF v_has_history THEN
        v_from_date := v_today - p_days_back;
    ELSE
        v_from_date := v_today - 365;
    END IF;

    WITH fresh AS (
        SELECT si.fecha AS date, si.branch_id,
               COUNT(*)::integer            AS count_valid,
               COALESCE(SUM(si.total::numeric), 0) AS sum_total
        FROM public.sales_invoices si
        WHERE si.fecha >= v_from_date
          AND si.fecha <  v_today
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
        GROUP BY si.fecha, si.branch_id
    ),
    del AS (
        DELETE FROM public.sales_daily_stats s
        WHERE s.date >= v_from_date AND s.date < v_today
          AND NOT EXISTS (SELECT 1 FROM fresh f
                          WHERE f.date = s.date AND f.branch_id = s.branch_id)
        RETURNING 1
    ),
    ins AS (
        INSERT INTO public.sales_daily_stats (date, branch_id, count_valid, sum_total)
        SELECT date, branch_id, count_valid, sum_total FROM fresh
        ON CONFLICT (date, branch_id) DO UPDATE
        SET count_valid = EXCLUDED.count_valid,
            sum_total   = EXCLUDED.sum_total
        WHERE (sales_daily_stats.count_valid, sales_daily_stats.sum_total)
              IS DISTINCT FROM (EXCLUDED.count_valid, EXCLUDED.sum_total)
        RETURNING 1
    )
    SELECT (SELECT count(*) FROM del) + (SELECT count(*) FROM ins) INTO v_written;

    RETURN v_written;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reject_minmax_request(p_request_id bigint, p_decided_by text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r public.minmax_change_requests%ROWTYPE;
BEGIN
  -- p_decided_by se recibe y se IGNORA (F4.2).
  UPDATE public.minmax_change_requests
  SET status='rejected', decided_by=(SELECT auth.email()), decided_at=now(), decision_note=p_note
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND_OR_NO_PERMISSION';
  END IF;

  RETURN jsonb_build_object('ok', true, 'requested_by_id', r.requested_by_id, 'product_name', r.product_name);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid DEFAULT NULL::uuid, p_tipo text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_pedido_id UUID;
    v_suc_id    INTEGER;
    v_cur_res   TEXT;
    v_actor     uuid := auth_employee_id();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED';
    END IF;
    IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
    END IF;

    SELECT pedido_id, erp_sucursal_id, resolucion_status
    INTO   v_pedido_id, v_suc_id, v_cur_res
    FROM   pedido_items WHERE id = p_item_id FOR UPDATE;

    IF v_pedido_id IS NULL THEN
        RAISE EXCEPTION 'Item no encontrado.';
    END IF;

    IF p_action = 'proponer' THEN
        UPDATE pedido_items SET
            resolucion_status  = 'propuesta',
            resolucion_tipo    = p_tipo,
            resolucion_nota    = NULLIF(TRIM(COALESCE(p_nota, '')), ''),
            resuelto_por       = v_actor,
            resuelto_at        = NOW(),
            rechazado_por      = NULL,
            rechazado_at       = NULL,
            nota_rechazo       = NULL,
            confirmado_suc_por = NULL,
            confirmado_suc_at  = NULL
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, resolucion_tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_propuesta',
             p_tipo, NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSIF p_action = 'confirmar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede confirmar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status  = 'confirmada',
            confirmado_suc_por = v_actor,
            confirmado_suc_at  = NOW()
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_confirmada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

        IF NOT EXISTS (
            SELECT 1 FROM pedido_items
            WHERE  pedido_id = v_pedido_id
              AND  status = 'con_diferencia'
              AND  (resolucion_status IS NULL OR resolucion_status IN ('propuesta', 'rechazada'))
        ) THEN
            UPDATE pedidos SET status = 'completado' WHERE id = v_pedido_id;
            UPDATE pedido_sucursal_status
               SET confirmado_correccion_at  = NOW(),
                   confirmado_correccion_por = v_actor
             WHERE pedido_id = v_pedido_id AND erp_sucursal_id = v_suc_id;
        END IF;

    ELSIF p_action = 'rechazar' THEN
        IF v_cur_res <> 'propuesta' THEN
            RAISE EXCEPTION 'Solo se puede rechazar una propuesta activa.';
        END IF;

        UPDATE pedido_items SET
            resolucion_status = 'rechazada',
            rechazado_por     = v_actor,
            rechazado_at      = NOW(),
            nota_rechazo      = NULLIF(TRIM(COALESCE(p_nota, '')), '')
        WHERE id = p_item_id;

        INSERT INTO pedido_item_eventos
            (pedido_item_id, pedido_id, erp_sucursal_id, tipo, nota, hecho_por)
        VALUES
            (p_item_id, v_pedido_id, v_suc_id, 'resolucion_rechazada',
             NULLIF(TRIM(COALESCE(p_nota, '')), ''), v_actor);

    ELSE
        RAISE EXCEPTION 'Acción desconocida: %', p_action;
    END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_purchase_dte_review(p_review_id bigint, p_action text, p_matched_document_id bigint DEFAULT NULL::bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated_docs integer;
  v_new_doc_id bigint;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_action NOT IN ('descartado', 'emparejado', 'confirmado') THEN
    RAISE EXCEPTION 'acción inválida: %', p_action;
  END IF;

  IF p_action = 'emparejado' THEN
    IF p_matched_document_id IS NULL THEN
      RAISE EXCEPTION 'p_matched_document_id requerido para emparejar';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_dte_review_queue
      WHERE id = p_review_id AND kind = 'orphan_pdf'
    ) THEN
      RAISE EXCEPTION 'solo se puede emparejar una fila kind=orphan_pdf';
    END IF;

    UPDATE public.purchase_dte_documents d
      SET pdf_path = rq.file_path
      FROM public.purchase_dte_review_queue rq
      WHERE d.id = p_matched_document_id AND rq.id = p_review_id AND d.pdf_path IS NULL;
    GET DIAGNOSTICS v_updated_docs = ROW_COUNT;

    IF v_updated_docs = 0 THEN
      RAISE EXCEPTION 'el documento destino ya tiene un PDF asociado';
    END IF;

    UPDATE public.purchase_dte_review_queue
      SET status = 'emparejado', matched_document_id = p_matched_document_id,
          resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;

  ELSIF p_action = 'confirmado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.purchase_dte_review_queue
      WHERE id = p_review_id AND kind = 'orphan_pdf' AND status = 'pendiente'
    ) THEN
      RAISE EXCEPTION 'solo se puede confirmar una fila kind=orphan_pdf pendiente';
    END IF;

    INSERT INTO public.purchase_dte_documents (
      codigo_generacion, tipo_dte, json_path, pdf_path,
      account_id, from_email, source_message_id, received_at
    )
    SELECT NULL, NULL, NULL, rq.file_path,
           rq.account_id, rq.from_email, rq.source_message_id, rq.received_at
    FROM public.purchase_dte_review_queue rq
    WHERE rq.id = p_review_id
    RETURNING id INTO v_new_doc_id;

    UPDATE public.purchase_dte_review_queue
      SET status = 'confirmado', matched_document_id = v_new_doc_id,
          resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;

  ELSE
    UPDATE public.purchase_dte_review_queue
      SET status = 'descartado', resolved_by = auth_employee_id(), resolved_at = now()
      WHERE id = p_review_id;
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id          uuid;
  v_datos       jsonb;
  v_total_filas integer;
  v_total_packs integer;
BEGIN
  IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
  END IF;

  v_datos := COALESCE(get_pedido_preview(p_sucursal_ids), '[]'::jsonb);

  SELECT COUNT(*)::integer,
         COALESCE(SUM((elem->>'cantidad_asignada')::integer), 0)::integer
  INTO v_total_filas, v_total_packs
  FROM jsonb_array_elements(v_datos) AS elem;

  INSERT INTO pedidos_snapshots (nombre, sucursal_ids, created_by, total_filas, total_packs, datos)
  VALUES (p_nombre, p_sucursal_ids, auth.uid(), v_total_filas, v_total_packs, v_datos)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.search_inventory_descripcion_ids(p_search text, p_erp_sucursal_id integer DEFAULT NULL::integer)
 RETURNS TABLE(id bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH pats AS (
    SELECT array_agg('%' || tok || '%') AS v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
    WHERE tok <> ''
  )
  SELECT i.id
  FROM public.inventory i, pats
  WHERE (p_erp_sucursal_id IS NULL OR i.erp_sucursal_id = p_erp_sucursal_id)
    AND (pats.v_pats IS NULL OR public.norm_search(i.descripcion) LIKE ALL (pats.v_pats));
$function$
;
CREATE OR REPLACE FUNCTION public.search_ventas_ids(p_search text, p_fini date DEFAULT NULL::date, p_ffin date DEFAULT NULL::date)
 RETURNS TABLE(id bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pats  text[];
  v_first text;
BEGIN
  SELECT array_agg('%' || tok || '%')
    INTO v_pats
    FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
   WHERE tok <> '';

  IF v_pats IS NULL THEN
    RETURN QUERY
    SELECT si.id
      FROM public.sales_invoices si
     WHERE (p_fini IS NULL OR si.fecha >= p_fini)
       AND (p_ffin IS NULL OR si.fecha <= p_ffin);
    RETURN;
  END IF;

  v_first := v_pats[1];

  RETURN QUERY
  SELECT si.id
    FROM public.sales_invoices si
   WHERE (p_fini IS NULL OR si.fecha >= p_fini)
     AND (p_ffin IS NULL OR si.fecha <= p_ffin)
     AND (
          (public.norm_search(si.erp_invoice_id) LIKE v_first
           AND public.norm_search(si.erp_invoice_id) LIKE ALL (v_pats))
       OR (public.norm_search(si.correlativo)    LIKE v_first
           AND public.norm_search(si.correlativo)    LIKE ALL (v_pats))
       OR (public.norm_search(si.cliente)        LIKE v_first
           AND public.norm_search(si.cliente)        LIKE ALL (v_pats))
     );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer DEFAULT 200)
 RETURNS TABLE(erp_product_id integer, segmento text, ultimo_conteo timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ids int[];
BEGIN
  SELECT array_agg(m.erp_sucursal_id) INTO v_ids FROM public.erp_sucursal_map m WHERE m.branch_id = p_branch_id;
  IF v_ids IS NULL THEN RAISE EXCEPTION 'SUCURSAL_SIN_MAPEO_ERP'; END IF;

  RETURN QUERY
  WITH universo AS (
    -- Solo lo que la sucursal tiene en existencia hoy: contar lo que no está
    -- ahí no verifica nada.
    SELECT DISTINCT i.erp_product_id AS pid
    FROM public.inventory i
    WHERE i.erp_sucursal_id = ANY(v_ids)
  ),
  clasificado AS (
    SELECT u.pid,
           CASE
             WHEN p.es_antibiotico THEN 'BAJO_RECETA'
             WHEN COALESCE(sp.abc, '') = 'A' THEN 'A'
             WHEN COALESCE(sp.abc, '') = 'B' THEN 'B'
             ELSE 'C'
           END AS seg
    FROM universo u
    JOIN public.products p ON p.id = u.pid AND p.activo = true
    LEFT JOIN LATERAL (
      -- Solo lo PUBLICADO. El borrador no decide qué se audita.
      SELECT s.abc_class AS abc
      FROM public.product_stock_params s
      WHERE s.erp_product_id = u.pid AND s.erp_sucursal_id = ANY(v_ids)
        AND s.abc_class IS NOT NULL
      LIMIT 1
    ) sp ON true
  ),
  ultimo AS (
    -- Cuándo se contó por última vez ese producto EN ESTA SUCURSAL.
    SELECT ci.erp_product_id AS pid, max(ci.contado_at) AS last_at
    FROM public.conteo_inventario_items ci
    JOIN public.conteos_inventario c ON c.id = ci.conteo_id
    WHERE c.branch_id = p_branch_id AND ci.contado_at IS NOT NULL
    GROUP BY 1
  ),
  pool AS (
    SELECT c.pid, c.seg, u.last_at,
           row_number() OVER (PARTITION BY c.seg ORDER BY u.last_at NULLS FIRST, random()) AS rn
    FROM clasificado c
    LEFT JOIN ultimo u ON u.pid = c.pid
  ),
  cuotas AS (
    SELECT
      LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano) AS q_abx,
      GREATEST(p_tamano - LEAST(count(*) FILTER (WHERE seg = 'BAJO_RECETA'), p_tamano), 0) AS resto
    FROM pool
  ),
  q AS (
    SELECT q_abx,
           floor(resto * 0.60)::int AS q_a,
           floor(resto * 0.25)::int AS q_b,
           resto - floor(resto * 0.60)::int - floor(resto * 0.25)::int AS q_c
    FROM cuotas
  ),
  base AS (
    SELECT p.pid, p.seg, p.last_at
    FROM pool p CROSS JOIN q
    WHERE (p.seg = 'BAJO_RECETA' AND p.rn <= q.q_abx)
       OR (p.seg = 'A'           AND p.rn <= q.q_a)
       OR (p.seg = 'B'           AND p.rn <= q.q_b)
       OR (p.seg = 'C'           AND p.rn <= q.q_c)
  ),
  -- Si un segmento tiene menos productos que su cuota (ej. una sucursal sin ABC
  -- publicado), el faltante se rellena con el resto por prioridad y antigüedad;
  -- si no, la muestra saldría más chica que lo pedido sin motivo.
  relleno AS (
    SELECT p.pid, p.seg, p.last_at
    FROM pool p
    WHERE NOT EXISTS (SELECT 1 FROM base b WHERE b.pid = p.pid)
    ORDER BY CASE p.seg WHEN 'BAJO_RECETA' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
             p.last_at NULLS FIRST, random()
    LIMIT GREATEST(p_tamano - (SELECT count(*) FROM base), 0)
  )
  SELECT b.pid, b.seg, b.last_at FROM base b
  UNION ALL
  SELECT r.pid, r.seg, r.last_at FROM relleno r;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_kiosk_pin(p_employee_id uuid, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor UUID;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['staff_list'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_pin IS NULL OR length(btrim(p_pin)) < 6 THEN
        RAISE EXCEPTION 'PIN_TOO_SHORT';
    END IF;

    v_actor := (SELECT auth_employee_id());

    INSERT INTO public.kiosk_credentials (employee_id, pin_hash, rotated_at, rotated_by)
    VALUES (p_employee_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), now(), v_actor)
    ON CONFLICT (employee_id) DO UPDATE
        SET pin_hash   = EXCLUDED.pin_hash,
            rotated_at = now(),
            rotated_by = v_actor;
END $function$
;
CREATE OR REPLACE FUNCTION public.set_proveedor_categoria(p_id bigint, p_categoria_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.proveedores_maestro
    SET categoria_id = p_categoria_id, updated_at = now()
    WHERE id = p_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.proveedores_maestro
    SET supplier_id = p_supplier_id, updated_at = now()
    WHERE id = p_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_proveedores_categoria_bulk(p_ids bigint[], p_categoria_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.proveedores_maestro
     SET categoria_id = p_categoria_id, updated_at = now()
   WHERE id = ANY(p_ids)
     AND categoria_id IS DISTINCT FROM p_categoria_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_purchase_dte_proveedor(p_document_id bigint, p_proveedor_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['facturas_compra'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.purchase_dte_documents SET proveedor_id = p_proveedor_id WHERE id = p_document_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;
CREATE OR REPLACE FUNCTION public.suggest_proveedor_categoria_id(p_desc_actividad text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT c.id
  FROM public.proveedores_categorias c
  WHERE c.nombre = CASE
    WHEN p_desc_actividad IS NULL OR btrim(p_desc_actividad) = '' THEN NULL
    WHEN unaccent(lower(p_desc_actividad)) ~ 'farmac|medicinal|medicamento|botanic|cosmetic'
      THEN 'Mercadería para reventa'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'banco|financier|intermediacion'
      THEN 'Servicios financieros/bancarios'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'combustible|gasolinera|lubricante|transporte'
      THEN 'Combustible y transporte'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'telefon|telecomunicacion|internet|cable'
      THEN 'Telecomunicaciones'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'agua'                          THEN 'Agua'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'electric|energia'              THEN 'Energía eléctrica'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'inmobiliar|arrendad|alquiler'  THEN 'Alquileres'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'ferreteria|reparacion|mantenimiento|construccion'
      THEN 'Mantenimiento y reparaciones'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'limpieza'                      THEN 'Limpieza'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'vigilancia|seguridad'          THEN 'Vigilancia/seguridad'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'papeler|utiles|imprenta|libreria'
      THEN 'Papelería y útiles'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'seguro'                        THEN 'Seguros'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'publicidad|propaganda'         THEN 'Publicidad'
    WHEN unaccent(lower(p_desc_actividad)) ~ 'contab|juridic|abogad|honorari|consultor|profesional'
      THEN 'Servicios profesionales y honorarios'
    ELSE NULL
  END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_bodega_draft_from_branch_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_product_ids integer[];
  v_count integer;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT erp_product_id) INTO v_product_ids
    FROM new_rows WHERE erp_sucursal_id != 6;
  ELSE
    SELECT array_agg(DISTINCT n.erp_product_id) INTO v_product_ids
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id
    WHERE n.erp_sucursal_id != 6
      AND (o.draft_min IS DISTINCT FROM n.draft_min
        OR o.draft_max IS DISTINCT FROM n.draft_max
        OR o.draft_status IS DISTINCT FROM n.draft_status
        OR o.min_units IS DISTINCT FROM n.min_units
        OR o.max_units IS DISTINCT FROM n.max_units
        OR o.is_hidden IS DISTINCT FROM n.is_hidden);
  END IF;

  IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  WITH sums AS (
    SELECT psp.erp_product_id,
      SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_min ELSE psp.min_units END, 0))::integer AS bodega_min,
      SUM(COALESCE(CASE WHEN psp.draft_status = 'pending' THEN psp.draft_max ELSE psp.max_units END, 0))::integer AS bodega_max,
      SUM(COALESCE(psp.min_units, 0))::integer AS pub_min,
      SUM(COALESCE(psp.max_units, 0))::integer AS pub_max,
      BOOL_AND(COALESCE(psp.draft_status, 'none') IS DISTINCT FROM 'pending') AS all_published
    FROM product_stock_params psp
    WHERE psp.erp_sucursal_id != 6
      AND psp.erp_product_id = ANY(v_product_ids)
      AND psp.is_hidden IS NOT TRUE
    GROUP BY psp.erp_product_id
  ),
  clamped_min AS (
    SELECT erp_product_id,
      GREATEST(bodega_min, CASE WHEN bodega_max > 1 THEN 1 ELSE 0 END) AS bodega_min,
      bodega_max,
      GREATEST(pub_min, CASE WHEN pub_max > 1 THEN 1 ELSE 0 END) AS pub_min,
      pub_max,
      all_published
    FROM sums
  ),
  clamped AS (
    SELECT erp_product_id,
      bodega_min,
      GREATEST(bodega_max, CASE WHEN bodega_min >= 1 THEN bodega_min + 1 ELSE 0 END) AS bodega_max,
      pub_min,
      GREATEST(pub_max, CASE WHEN pub_min >= 1 THEN pub_min + 1 ELSE 0 END) AS pub_max,
      all_published
    FROM clamped_min
  ),
  live_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_status, draft_min, draft_max,
      draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, bodega_min, bodega_max, 'none', NULL, NULL, NOW(), NOW()
    FROM clamped WHERE all_published
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      min_units           = EXCLUDED.min_units,
      max_units            = EXCLUDED.max_units,
      draft_status        = 'none',
      draft_min           = NULL,
      draft_max           = NULL,
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  ),
  pending_upsert AS (
    INSERT INTO product_stock_params (
      erp_product_id, erp_sucursal_id,
      min_units, max_units,
      draft_min, draft_max, draft_status, draft_calculated_at, updated_at
    )
    SELECT erp_product_id, 6, pub_min, pub_max, bodega_min, bodega_max, 'pending', NOW(), NOW()
    FROM clamped WHERE NOT all_published
    ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
      draft_min           = EXCLUDED.draft_min,
      draft_max           = EXCLUDED.draft_max,
      draft_status        = 'pending',
      draft_calculated_at = EXCLUDED.draft_calculated_at,
      updated_at           = EXCLUDED.updated_at
    WHERE product_stock_params.is_hidden IS NOT TRUE
    RETURNING erp_product_id
  )
  SELECT (SELECT count(*) FROM live_upsert) + (SELECT count(*) FROM pending_upsert) INTO v_count;

  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_inventory_batch(p_erp_sucursal_id integer, p_is_vencidos boolean, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT * FROM jsonb_to_recordset(p_rows) AS r(
    erp_product_id    integer,
    descripcion       text,
    presentacion      text,
    detalle           text,
    lote              text,
    fecha_vencimiento date,
    cantidad          integer,
    sync_key          text
  )
),
upserted AS (
  INSERT INTO public.inventory AS inv
    (erp_sucursal_id, is_vencidos, erp_product_id, descripcion, presentacion,
     detalle, lote, fecha_vencimiento, cantidad, synced_at, sync_key)
  SELECT p_erp_sucursal_id, p_is_vencidos, i.erp_product_id, i.descripcion,
         i.presentacion, i.detalle, i.lote, i.fecha_vencimiento, i.cantidad,
         now(), i.sync_key
  FROM incoming i
  ON CONFLICT (sync_key) DO UPDATE
    SET cantidad     = EXCLUDED.cantidad,
        descripcion  = EXCLUDED.descripcion,
        presentacion = EXCLUDED.presentacion,
        synced_at    = EXCLUDED.synced_at
    -- Solo escribir si el dato real cambió (lote/detalle/fecha_venc/producto
    -- forman parte del sync_key, no pueden divergir en un conflicto)
    WHERE (inv.cantidad, inv.descripcion, inv.presentacion)
          IS DISTINCT FROM
          (EXCLUDED.cantidad, EXCLUDED.descripcion, EXCLUDED.presentacion)
  RETURNING 1
),
removed AS (
  -- Filas de esta sucursal/área que ya no existen en el ERP: se detectan por
  -- diferencia de sync_keys (ya no dependemos de bumpear synced_at por fila)
  DELETE FROM public.inventory inv
  WHERE inv.erp_sucursal_id = p_erp_sucursal_id
    AND inv.is_vencidos = p_is_vencidos
    AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.sync_key = inv.sync_key)
  RETURNING 1
)
SELECT jsonb_build_object(
  'written', (SELECT count(*) FROM upserted),
  'deleted', (SELECT count(*) FROM removed)
);
$function$
;
CREATE OR REPLACE FUNCTION public.sync_laboratorios_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.nombre
  FROM json_to_recordset(p_rows) AS r(id integer, nombre text)
  WHERE r.id IS NOT NULL AND r.nombre IS NOT NULL
  ORDER BY r.id
),
written AS (
  INSERT INTO public.laboratorios AS l (id, nombre, updated_at)
  SELECT i.id, i.nombre, now() FROM incoming i
  ON CONFLICT (id) DO UPDATE
    SET nombre     = EXCLUDED.nombre,
        updated_at = EXCLUDED.updated_at
    WHERE l.nombre IS DISTINCT FROM EXCLUDED.nombre
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_presentaciones_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.tipo
  FROM json_to_recordset(p_rows) AS r(id integer, tipo text)
  WHERE r.id IS NOT NULL
  ORDER BY r.id
),
written AS (
  INSERT INTO public.presentaciones AS pr (id, tipo, updated_at)
  SELECT i.id, i.tipo, now() FROM incoming i
  ON CONFLICT (id) DO UPDATE
    SET tipo       = EXCLUDED.tipo,
        updated_at = EXCLUDED.updated_at
    WHERE pr.tipo IS DISTINCT FROM EXCLUDED.tipo
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_purchase_receipt_items_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.receipt_id, r.linea_num)
         r.receipt_id, r.linea_num, r.erp_product_id, r.descripcion,
         r.cantidad, r.precio_unitario, r.total_linea, r.lote, r.fecha_vencimiento
  FROM json_to_recordset(p_rows) AS r(
    receipt_id        integer,
    linea_num         integer,
    erp_product_id    integer,
    descripcion       text,
    cantidad          numeric,
    precio_unitario   numeric,
    total_linea       numeric,
    lote              text,
    fecha_vencimiento date
  )
  WHERE r.receipt_id IS NOT NULL AND r.linea_num IS NOT NULL
  ORDER BY r.receipt_id, r.linea_num
),
written AS (
  INSERT INTO public.purchase_receipt_items AS pri
    (receipt_id, linea_num, erp_product_id, descripcion, cantidad,
     precio_unitario, total_linea, lote, fecha_vencimiento)
  SELECT i.receipt_id, i.linea_num, i.erp_product_id, i.descripcion, i.cantidad,
         i.precio_unitario, i.total_linea, i.lote, i.fecha_vencimiento
  FROM incoming i
  ON CONFLICT (receipt_id, linea_num) DO UPDATE
    SET erp_product_id    = EXCLUDED.erp_product_id,
        descripcion       = EXCLUDED.descripcion,
        cantidad          = EXCLUDED.cantidad,
        precio_unitario   = EXCLUDED.precio_unitario,
        total_linea       = EXCLUDED.total_linea,
        lote              = EXCLUDED.lote,
        fecha_vencimiento = EXCLUDED.fecha_vencimiento
    WHERE (pri.erp_product_id, pri.descripcion, pri.cantidad, pri.precio_unitario,
           pri.total_linea, pri.lote, pri.fecha_vencimiento)
          IS DISTINCT FROM
          (EXCLUDED.erp_product_id, EXCLUDED.descripcion, EXCLUDED.cantidad,
           EXCLUDED.precio_unitario, EXCLUDED.total_linea, EXCLUDED.lote,
           EXCLUDED.fecha_vencimiento)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_suppliers_batch(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.erp_supplier_id) r.erp_supplier_id, r.nombre, r.nrc
  FROM json_to_recordset(p_rows) AS r(erp_supplier_id integer, nombre text, nrc text)
  WHERE r.erp_supplier_id IS NOT NULL AND r.nombre IS NOT NULL
  ORDER BY r.erp_supplier_id
),
written AS (
  INSERT INTO public.suppliers AS s (erp_supplier_id, nombre, nrc, updated_at)
  SELECT i.erp_supplier_id, i.nombre, i.nrc, now() FROM incoming i
  ON CONFLICT (erp_supplier_id) DO UPDATE
    SET nombre     = EXCLUDED.nombre,
        nrc        = EXCLUDED.nrc,
        updated_at = EXCLUDED.updated_at
    WHERE (s.nombre, s.nrc) IS DISTINCT FROM (EXCLUDED.nombre, EXCLUDED.nrc)
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$
;
CREATE OR REPLACE FUNCTION public.toggle_producto_oculto_ventas(p_erp_product_id integer, p_oculto boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT auth_has_module_permission('ventas_tab_productos', 'can_view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere acceso a Ventas > Productos';
  END IF;

  UPDATE public.products
  SET oculto_en_ventas = p_oculto,
      oculto_por = CASE WHEN p_oculto THEN public.auth_employee_id() ELSE NULL END,
      oculto_at  = CASE WHEN p_oculto THEN now() ELSE NULL END
  WHERE id = p_erp_product_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_promotions_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$
;
CREATE OR REPLACE FUNCTION public.unlock_module(p_module_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_emp_id uuid := public.auth_employee_id();
  v_owner  uuid;
BEGIN
  SELECT locked_by_id INTO v_owner FROM public.module_locks WHERE module_key = p_module_key;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'noop', true);
  END IF;

  IF v_owner IS DISTINCT FROM v_emp_id
     AND NOT public.auth_has_module_permission('permissions', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: solo el titular del candado o un administrador de permisos puede liberarlo';
  END IF;

  DELETE FROM public.module_locks WHERE module_key = p_module_key;
  RETURN jsonb_build_object('ok', true, 'module_key', p_module_key);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid DEFAULT NULL::uuid, p_razon text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid;
BEGIN
    IF pg_trigger_depth() = 0 THEN
        v_actor := auth_employee_id();
        IF v_actor IS NULL THEN
            RAISE EXCEPTION 'UNAUTHENTICATED';
        END IF;
        IF NOT auth_can_edit_any(ARRAY['pedidos']) THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Pedidos';
        END IF;
    ELSE
        v_actor := p_user_id;
    END IF;

    INSERT INTO pedido_sucursal_status (pedido_id, erp_sucursal_id)
    VALUES (p_pedido_id, p_sucursal_id)
    ON CONFLICT (pedido_id, erp_sucursal_id) DO NOTHING;

    IF p_stage = 'iniciar' THEN
        UPDATE pedido_sucursal_status
        SET iniciado_at  = NOW(), iniciado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NULL;

    ELSIF p_stage = 'pausar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN RETURN; END IF;
        UPDATE pedido_sucursal_status
        SET pausado_at = NOW(), pausa_razon = p_razon, reanudado_at = NULL, reanudado_por = NULL
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL;
        INSERT INTO pedido_pausa_historial
            (pedido_id, erp_sucursal_id, pausado_at, razon, pausado_por)
        VALUES (p_pedido_id, p_sucursal_id, NOW(), p_razon, v_actor);

    ELSIF p_stage = 'reanudar' THEN
        UPDATE pedido_pausa_historial
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND reanudado_at IS NULL;
        UPDATE pedido_sucursal_status
        SET reanudado_at = NOW(), reanudado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND pausado_at IS NOT NULL AND reanudado_at IS NULL AND finalizado_at IS NULL;

    ELSIF p_stage = 'finalizar' THEN
        IF EXISTS (
            SELECT 1 FROM pedido_pausa_historial
            WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
              AND reanudado_at IS NULL
        ) THEN
            RAISE EXCEPTION 'No se puede finalizar: hay una pausa activa sin reanudar.';
        END IF;
        UPDATE pedido_sucursal_status
        SET finalizado_at = NOW(), finalizado_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND iniciado_at IS NOT NULL AND finalizado_at IS NULL
          AND (pausado_at IS NULL OR reanudado_at IS NOT NULL);

    ELSIF p_stage = 'confirmar_llegada' THEN
        UPDATE pedido_sucursal_status
        SET llegada_fisica_at  = NOW(), llegada_fisica_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND llegada_fisica_at IS NULL;

    ELSIF p_stage = 'recibir_erp' THEN
        UPDATE pedido_sucursal_status
        SET recibido_erp_at  = NOW(), recibido_erp_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id
          AND recibido_erp_at IS NULL;

    ELSIF p_stage = 'reportar_diferencias' THEN
        UPDATE pedido_sucursal_status
        SET diferencias_reportadas_at  = NOW(),
            diferencias_reportadas_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'corregir_bodega' THEN
        UPDATE pedido_sucursal_status
        SET corregido_bodega_at   = NOW(),
            corregido_bodega_por  = v_actor,
            corregido_bodega_nota = p_nota
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSIF p_stage = 'confirmar_correccion' THEN
        UPDATE pedido_sucursal_status
        SET confirmado_correccion_at  = NOW(),
            confirmado_correccion_por = v_actor
        WHERE pedido_id = p_pedido_id AND erp_sucursal_id = p_sucursal_id;

    ELSE
        RAISE EXCEPTION 'stage desconocido: %', p_stage;
    END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.update_proveedor_manual(p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text, p_notas text, p_activo boolean, p_alias text DEFAULT NULL::text, p_percibe_1_override boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.proveedores_maestro SET
    contacto_nombre    = p_contacto_nombre,
    telefono2          = p_telefono2,
    nombre_cheques     = p_nombre_cheques,
    notas              = p_notas,
    activo             = p_activo,
    alias              = p_alias,
    percibe_1_override = p_percibe_1_override,
    percibe_1          = coalesce(p_percibe_1_override, percibe_1),
    updated_at         = now()
  WHERE id = p_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_customers(names text[])
 RETURNS TABLE(customer_name text, customer_id bigint)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.customers (name)
  SELECT DISTINCT upper(trim(n)) FROM unnest(names) AS n WHERE upper(trim(n)) <> ''
  ON CONFLICT DO NOTHING;
  RETURN QUERY
  SELECT c.name, c.id FROM public.customers c
  WHERE c.name = ANY(SELECT upper(trim(n)) FROM unnest(names) AS n WHERE upper(trim(n)) <> '');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_product_precios_batch(p_rows jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT * FROM jsonb_to_recordset(p_rows) AS r(
    product_id      integer,
    id_presentacion integer,
    descripcion     text,
    factor          integer,
    activo          boolean,
    costo           numeric,
    vineta          numeric,
    descuento_1     numeric,
    vip             numeric,
    clinica         numeric,
    mayoreo         numeric,
    premium         numeric,
    precio_7        numeric
  )
),
upserted AS (
  INSERT INTO public.product_precios AS pp
    (product_id, id_presentacion, descripcion, factor, activo, costo, vineta,
     descuento_1, vip, clinica, mayoreo, premium, precio_7, updated_at)
  SELECT i.product_id, i.id_presentacion, i.descripcion, i.factor, i.activo,
         i.costo, i.vineta, i.descuento_1, i.vip, i.clinica, i.mayoreo,
         i.premium, i.precio_7, now()
  FROM incoming i
  ON CONFLICT (product_id, id_presentacion) DO UPDATE
    SET descripcion = EXCLUDED.descripcion,
        factor      = EXCLUDED.factor,
        activo      = EXCLUDED.activo,
        costo       = EXCLUDED.costo,
        vineta      = EXCLUDED.vineta,
        descuento_1 = EXCLUDED.descuento_1,
        vip         = EXCLUDED.vip,
        clinica     = EXCLUDED.clinica,
        mayoreo     = EXCLUDED.mayoreo,
        premium     = EXCLUDED.premium,
        precio_7    = EXCLUDED.precio_7,
        updated_at  = EXCLUDED.updated_at
    WHERE (pp.descripcion, pp.factor, pp.activo, pp.costo, pp.vineta,
           pp.descuento_1, pp.vip, pp.clinica, pp.mayoreo, pp.premium, pp.precio_7)
          IS DISTINCT FROM
          (EXCLUDED.descripcion, EXCLUDED.factor, EXCLUDED.activo, EXCLUDED.costo,
           EXCLUDED.vineta, EXCLUDED.descuento_1, EXCLUDED.vip, EXCLUDED.clinica,
           EXCLUDED.mayoreo, EXCLUDED.premium, EXCLUDED.precio_7)
  RETURNING 1
)
SELECT count(*)::integer FROM upserted;
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_products_minimal(p_rows json)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
WITH incoming AS (
  SELECT DISTINCT ON (r.id) r.id, r.nombre
  FROM json_to_recordset(p_rows) AS r(id integer, nombre text)
  WHERE r.id IS NOT NULL AND r.nombre IS NOT NULL
  ORDER BY r.id
),
written AS (
  INSERT INTO public.products AS p (id, nombre, updated_at)
  SELECT i.id, i.nombre, now() FROM incoming i
  ON CONFLICT (id) DO UPDATE
    SET nombre     = EXCLUDED.nombre,
        updated_at = EXCLUDED.updated_at
    WHERE p.nombre IS DISTINCT FROM EXCLUDED.nombre
  RETURNING 1
)
SELECT count(*)::integer FROM written;
$function$
;
CREATE OR REPLACE FUNCTION public.upsert_proveedor_from_dte(p_data jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_nit         text := nullif(p_data->>'nit', '');
  v_dui         text := nullif(p_data->>'dui', '');
  v_nrc         text := nullif(p_data->>'nrc', '');
  v_fecha       date := (p_data->>'fecha_emision')::date;
  v_tipo_dte    text := p_data->>'tipo_dte';
  v_es_nc_nd    boolean := v_tipo_dte IN ('05', '06');
  v_supplier_id integer;
  v_id          bigint;
  v_out_supplier_id integer;
BEGIN
  IF v_nit IS NULL AND v_dui IS NULL THEN
    RAISE EXCEPTION 'nit o dui requerido';
  END IF;

  IF v_nrc IS NOT NULL THEN
    SELECT id INTO v_supplier_id FROM public.suppliers
      WHERE regexp_replace(nrc, '[^0-9]', '', 'g') = regexp_replace(v_nrc, '[^0-9]', '', 'g')
      LIMIT 1;
  END IF;

  IF v_nit IS NOT NULL THEN
    SELECT id INTO v_id FROM public.proveedores_maestro WHERE nit = v_nit;
  ELSE
    SELECT id INTO v_id FROM public.proveedores_maestro WHERE dui = v_dui AND nit IS NULL;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.proveedores_maestro (
      nit, dui, nrc, nombre, nombre_comercial, cod_actividad, desc_actividad,
      tipo_establecimiento, departamento, municipio, direccion, telefono, correo,
      percibe_1, retiene_renta, supplier_id, source,
      primera_vez_visto, ultima_vez_visto, docs_count
    ) VALUES (
      v_nit, v_dui, v_nrc, p_data->>'nombre', p_data->>'nombre_comercial',
      p_data->>'cod_actividad', p_data->>'desc_actividad', p_data->>'tipo_establecimiento',
      p_data->>'departamento', p_data->>'municipio', p_data->>'direccion',
      p_data->>'telefono', p_data->>'correo',
      coalesce((p_data->>'percibe_1')::boolean, false),
      coalesce((p_data->>'retiene_renta')::boolean, false),
      v_supplier_id, 'dte', v_fecha, v_fecha, CASE WHEN v_es_nc_nd THEN 0 ELSE 1 END
    )
    RETURNING id, supplier_id INTO v_id, v_out_supplier_id;
  ELSE
    UPDATE public.proveedores_maestro p SET
      nrc                   = coalesce(v_nrc, p.nrc),
      nombre                = coalesce(p_data->>'nombre', p.nombre),
      nombre_comercial      = coalesce(p_data->>'nombre_comercial', p.nombre_comercial),
      cod_actividad         = coalesce(p_data->>'cod_actividad', p.cod_actividad),
      desc_actividad        = coalesce(p_data->>'desc_actividad', p.desc_actividad),
      tipo_establecimiento  = coalesce(p_data->>'tipo_establecimiento', p.tipo_establecimiento),
      departamento          = coalesce(p_data->>'departamento', p.departamento),
      municipio             = coalesce(p_data->>'municipio', p.municipio),
      direccion             = coalesce(p_data->>'direccion', p.direccion),
      telefono              = coalesce(p_data->>'telefono', p.telefono),
      correo                = coalesce(p_data->>'correo', p.correo),
      percibe_1             = CASE
                                 WHEN p.percibe_1_override IS NOT NULL THEN p.percibe_1_override
                                 ELSE p.percibe_1 OR coalesce((p_data->>'percibe_1')::boolean, false)
                               END,
      retiene_renta         = p.retiene_renta OR coalesce((p_data->>'retiene_renta')::boolean, false),
      supplier_id           = coalesce(p.supplier_id, v_supplier_id),
      primera_vez_visto     = LEAST(p.primera_vez_visto, v_fecha),
      ultima_vez_visto      = CASE WHEN v_es_nc_nd THEN p.ultima_vez_visto ELSE GREATEST(p.ultima_vez_visto, v_fecha) END,
      docs_count            = p.docs_count + CASE WHEN v_es_nc_nd THEN 0 ELSE 1 END,
      updated_at            = now()
    WHERE p.id = v_id
    RETURNING p.supplier_id INTO v_out_supplier_id;
  END IF;

  RETURN json_build_object('id', v_id, 'supplier_id', v_out_supplier_id);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_role_headcount(p_role_id integer, p_branch_id integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_max_limit INT; v_current INT;
BEGIN
  SELECT max_limit INTO v_max_limit FROM public.roles WHERE id=p_role_id;
  IF v_max_limit IS NULL OR v_max_limit<=0 THEN RETURN TRUE; END IF;
  SELECT COUNT(*) INTO v_current FROM public.employees
  WHERE role_id=p_role_id AND branch_id=p_branch_id AND status='ACTIVO';
  RETURN v_current < v_max_limit;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch_id BIGINT;
    v_fails     INT;
    v_code      TEXT := upper(btrim(COALESCE(p_code, '')));
    v_needs_su  BOOLEAN;
    v_bucket    TIMESTAMPTZ := date_trunc('hour', now());
    v_expected  TEXT;
    v_ok        BOOLEAN := false;
    v_method    TEXT    := NULL;
    v_who       TEXT    := NULL;
    rec         RECORD;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND device_token = p_device_token
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE device_id = p_device_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '5 minutes';

    IF v_fails >= 10 THEN
        INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
        VALUES (p_device_id, p_employee_id, false);
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.employees e
        LEFT JOIN public.roles rl1 ON rl1.id = e.role_id
        LEFT JOIN public.roles rl2 ON rl2.id = e.secondary_role_id
        WHERE e.id = p_employee_id
          AND (upper(COALESCE(rl1.name, '')) LIKE '%JEFE%'
            OR upper(COALESCE(rl2.name, '')) LIKE '%JEFE%')
    ) INTO v_needs_su;

    FOR rec IN SELECT unnest(ARRAY[v_bucket, v_bucket - INTERVAL '1 hour']) AS b LOOP
        v_expected := public.kiosk_auth_code_for(v_branch_id, rec.b, false)
                   || CASE WHEN v_needs_su
                           THEN public.kiosk_auth_code_for(v_branch_id, rec.b, true)
                           ELSE '' END;
        IF v_code = v_expected THEN
            v_ok     := true;
            v_method := 'HOURLY_CODE';
            EXIT;
        END IF;
    END LOOP;

    IF NOT v_ok THEN
        FOR rec IN
            SELECT e.id,
                   COALESCE(e.name, e.first_names || ' ' || e.last_names) AS nombre,
                   k.pin_hash
            FROM public.employees e
            JOIN public.kiosk_credentials k ON k.employee_id = e.id
            LEFT JOIN public.roles rl1 ON rl1.id = e.role_id
            LEFT JOIN public.roles rl2 ON rl2.id = e.secondary_role_id
            WHERE e.branch_id = v_branch_id
              AND e.status = 'ACTIVO'
              AND (upper(COALESCE(rl1.name, '')) ~ '(JEFE|ADMIN|SUPERVISOR|GERENTE)'
                OR upper(COALESCE(rl2.name, '')) ~ '(JEFE|ADMIN|SUPERVISOR|GERENTE)')
        LOOP
            IF extensions.crypt(v_code, rec.pin_hash) = rec.pin_hash THEN
                v_ok     := true;
                v_method := 'SUPERVISOR_PIN';
                v_who    := rec.nombre;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
    VALUES (p_device_id, p_employee_id, v_ok);

    RETURN json_build_object('ok', v_ok, 'method', v_method, 'authorizer_name', v_who);
END $function$
;
CREATE OR REPLACE FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid)
 RETURNS TABLE(branch_id bigint, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT kd.branch_id, kd.status
  FROM public.kiosk_devices kd
  WHERE kd.id = p_device_id
    AND kd.device_token = p_device_token
    AND kd.status = 'ACTIVE';
$function$
;
CREATE OR REPLACE FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch_id BIGINT;
    v_hash      TEXT;
    v_fails     INT;
    v_ok        BOOLEAN := false;
BEGIN
    SELECT branch_id INTO v_branch_id
    FROM public.kiosk_devices
    WHERE id = p_device_id
      AND device_token = p_device_token
      AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
      AND revoked_at IS NULL;

    IF v_branch_id IS NULL THEN
        RAISE EXCEPTION 'KIOSK_DEVICE_INVALID';
    END IF;

    SELECT count(*) INTO v_fails
    FROM public.kiosk_pin_attempts
    WHERE device_id = p_device_id
      AND succeeded = false
      AND created_at > now() - INTERVAL '5 minutes';

    IF v_fails >= 10 THEN
        INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
        VALUES (p_device_id, p_employee_id, false);
        RAISE EXCEPTION 'KIOSK_PIN_RATE_LIMITED';
    END IF;

    SELECT pin_hash INTO v_hash
    FROM public.kiosk_credentials
    WHERE employee_id = p_employee_id;

    IF v_hash IS NOT NULL THEN
        v_ok := (extensions.crypt(p_pin, v_hash) = v_hash);
    END IF;

    INSERT INTO public.kiosk_pin_attempts (device_id, employee_id, succeeded)
    VALUES (p_device_id, p_employee_id, v_ok);

    RETURN json_build_object('ok', v_ok);
END $function$
;
CREATE OR REPLACE FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_published_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_now       TIMESTAMPTZ := NOW();
  v_count     INTEGER;
  v_publisher TEXT := (SELECT auth.email());
BEGIN
  IF NOT auth_can_edit_any(ARRAY['minmax']) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de edición en Min/Max';
  END IF;

  IF NOT (SELECT public.auth_can_edit_scope_all(ARRAY['minmax','pedidos'])) THEN
    RAISE EXCEPTION 'BRANCH_SCOPE_DENIED: retirar un producto de TODAS las salas requiere alcance total';
  END IF;

  INSERT INTO product_stock_params (
    erp_product_id, erp_sucursal_id,
    min_units, max_units,
    draft_min, draft_max, draft_status,
    manual_min, manual_max,
    published_at, published_by, updated_at
  )
  SELECT
    p_erp_product_id,
    m.erp_sucursal_id,
    0, 0,
    NULL, NULL, 'none',
    NULL, NULL,
    v_now, v_publisher, v_now
  FROM erp_sucursal_map m
  ON CONFLICT (erp_product_id, erp_sucursal_id) DO UPDATE SET
    min_units    = 0,
    max_units    = 0,
    draft_min    = NULL,
    draft_max    = NULL,
    draft_status = 'none',
    manual_min   = NULL,
    manual_max   = NULL,
    published_at = v_now,
    published_by = v_publisher,
    updated_at   = v_now
  WHERE product_stock_params.is_hidden IS NOT TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',      true,
    'updated', v_count,
    'at',      v_now
  );
END;
$function$
;


-- ── Tablas (110) ────────────────────────────────────────────────────────────

CREATE TABLE public.announcements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  target_type text NOT NULL,
  target_value jsonb,
  read_by jsonb DEFAULT '[]'::jsonb NOT NULL,
  is_archived boolean DEFAULT false NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  priority text DEFAULT 'NORMAL'::text NOT NULL,
  edited_at timestamp with time zone,
  scheduled_for timestamp with time zone,
  metadata jsonb,
  prev_read_by jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.approval_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  type text NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  current_level integer DEFAULT 1 NOT NULL,
  approvals jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  approver_id uuid,
  note text,
  approver_note text,
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.attendance (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  employee_id uuid NOT NULL,
  "timestamp" timestamp with time zone NOT NULL,
  type text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  user_name text,
  action text NOT NULL,
  target_id text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  source text DEFAULT 'ADMIN_PANEL'::text NOT NULL,
  severity text DEFAULT 'INFO'::text NOT NULL,
  branch_id bigint,
  branch_name text,
  device_name text,
  input_method text
);
CREATE TABLE public.backup_sync_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  success boolean NOT NULL,
  error_msg text,
  tables_ok integer,
  tables_failed integer,
  total_kb integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.branch_documents (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  branch_id bigint NOT NULL,
  document_type text NOT NULL,
  name text NOT NULL,
  file_url text,
  issue_date date,
  expiration_date date,
  status text DEFAULT 'ACTIVO'::text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.branch_expenses (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  branch_id bigint NOT NULL,
  expense_type text NOT NULL,
  billing_month text NOT NULL,
  amount numeric(10,2) NOT NULL,
  due_date date NOT NULL,
  status text DEFAULT 'PENDIENTE'::text,
  paid_at timestamp with time zone,
  receipt_url text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  notes text
);
CREATE TABLE public.branches (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  name text NOT NULL,
  address text,
  phone text,
  cell text,
  weekly_hours jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb,
  opening_date date,
  type text DEFAULT 'FARMACIA'::text NOT NULL,
  conteo_ciclico_activo boolean DEFAULT false NOT NULL,
  conteo_ciclico_tamano integer DEFAULT 200 NOT NULL
);
CREATE TABLE public.conteo_inventario_item_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item_id uuid NOT NULL,
  fisico_cantidad integer,
  sistema_cantidad integer,
  diferencia integer,
  estado_item text,
  nota text,
  contado_por uuid,
  contado_at timestamp with time zone DEFAULT now() NOT NULL,
  evento text DEFAULT 'EDICION'::text NOT NULL
);
CREATE TABLE public.conteo_inventario_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conteo_id uuid NOT NULL,
  erp_product_id integer NOT NULL,
  source_inventory_id bigint,
  presentacion text,
  detalle text,
  lote text,
  fecha_vencimiento date,
  is_vencidos boolean DEFAULT false NOT NULL,
  sistema_cantidad integer NOT NULL,
  fisico_cantidad integer,
  diferencia integer,
  estado_item text DEFAULT 'PENDIENTE'::text NOT NULL,
  nota text,
  costo_unitario numeric,
  contado_por uuid,
  contado_at timestamp with time zone,
  es_agregado_manual boolean DEFAULT false NOT NULL,
  source_sync_key text,
  sistema_inicial integer,
  fisico_primer_conteo integer,
  recontado_por uuid,
  recontado_at timestamp with time zone
);
CREATE TABLE public.conteos_inventario (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  branch_id bigint NOT NULL,
  created_by uuid,
  scope_type text NOT NULL,
  scope_filter jsonb,
  incluye_vencidos boolean DEFAULT false NOT NULL,
  status text DEFAULT 'BORRADOR'::text NOT NULL,
  finalizado_por uuid,
  finalizado_at timestamp with time zone,
  aprobado_por uuid,
  aprobado_at timestamp with time zone,
  nota_aprobacion text,
  total_items integer,
  total_contados integer,
  total_diferencias integer,
  valor_faltante numeric,
  valor_sobrante numeric,
  notas text,
  total_pendientes integer,
  pendientes_como_cero boolean,
  ajuste_erp_aplicado boolean DEFAULT false NOT NULL,
  ajuste_erp_por uuid,
  ajuste_erp_at timestamp with time zone,
  ajuste_erp_nota text,
  total_recontados integer
);
CREATE TABLE public.cotizacion_items (
  id bigint DEFAULT nextval('cotizacion_items_id_seq'::regclass) NOT NULL,
  cotizacion_id bigint NOT NULL,
  product_id integer,
  product_nombre text NOT NULL,
  presentacion_id integer,
  presentacion_desc text,
  price_type text DEFAULT 'vineta'::text NOT NULL,
  cantidad numeric(10,3) DEFAULT 1 NOT NULL,
  precio_unitario numeric(12,2) DEFAULT 0 NOT NULL,
  subtotal numeric(12,2) DEFAULT 0 NOT NULL,
  sort_order integer DEFAULT 0
);
CREATE TABLE public.cotizaciones (
  id bigint DEFAULT nextval('cotizaciones_id_seq'::regclass) NOT NULL,
  numero text NOT NULL,
  fecha date DEFAULT CURRENT_DATE NOT NULL,
  customer_id bigint,
  customer_name text DEFAULT 'Consumidor Final'::text NOT NULL,
  customer_nit text,
  document_type text DEFAULT 'COF'::text NOT NULL,
  payment_type text DEFAULT 'EFECTIVO'::text NOT NULL,
  applies_retention boolean DEFAULT false NOT NULL,
  subtotal_gravado numeric(12,2) DEFAULT 0 NOT NULL,
  iva_amount numeric(12,2) DEFAULT 0 NOT NULL,
  retention_amount numeric(12,2) DEFAULT 0 NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  notes text,
  status text DEFAULT 'ACTIVA'::text NOT NULL,
  branch_id bigint,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by_photo text
);
CREATE TABLE public.customers (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  nit text,
  dui text,
  erp_id text,
  phone text,
  email text,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  search_name text GENERATED ALWAYS AS (lower(translate(name, 'ÁÉÍÓÚÜÑáéíóúüñ'::text, 'aeiouunaeiouun'::text))) STORED
);
CREATE TABLE public.dispatch_rules (
  id integer DEFAULT nextval('dispatch_rules_id_seq'::regclass) NOT NULL,
  erp_product_id integer NOT NULL,
  solo_cajas boolean DEFAULT false NOT NULL,
  multiplo smallint,
  blister smallint,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  multiplo_unidades smallint,
  dispatch_id_presentacion integer,
  dispatch_multiplo smallint DEFAULT 1,
  dispatch_label text,
  caja_especial boolean DEFAULT false NOT NULL
);
CREATE TABLE public.education_catalog_entries (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  category text NOT NULL,
  value text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.email_sync_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  email text NOT NULL,
  provider text DEFAULT 'gmail'::text NOT NULL,
  vault_secret_name text NOT NULL,
  last_synced_date timestamp with time zone,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  client_id_secret_name text,
  client_secret_secret_name text
);
CREATE TABLE public.email_sync_log (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  account_id bigint,
  source text,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  success boolean NOT NULL,
  error_msg text,
  messages_scanned integer,
  documents_inserted integer,
  documents_skipped integer,
  pdfs_unmatched integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.employee_branches (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  employee_id uuid NOT NULL,
  branch_id bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.employee_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid,
  event_id uuid,
  name text NOT NULL,
  type text,
  url text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE TABLE public.employee_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid,
  type text NOT NULL,
  date date NOT NULL,
  note text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE TABLE public.employee_rosters (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  employee_id uuid NOT NULL,
  week_start_date date NOT NULL,
  schedule_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  status text DEFAULT 'DRAFT'::text NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
CREATE TABLE public.employees (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  code text NOT NULL,
  branch_id bigint,
  shift_id bigint,
  photo_url text,
  phone text,
  address text,
  dui text,
  birth_date date,
  status text DEFAULT 'ACTIVO'::text,
  hire_date date,
  afp_number text,
  isss_number text,
  bank_name text,
  account_number text,
  weekly_schedule jsonb DEFAULT '{}'::jsonb,
  exceptions jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  role_id bigint,
  secondary_role_id bigint,
  kiosk_pin text,
  username text,
  first_names text NOT NULL,
  last_names text NOT NULL,
  gender text,
  blood_type text,
  marital_status text,
  emergency_contact_name text,
  emergency_contact_phone text,
  contract_type text DEFAULT 'INDEFINIDO'::text,
  weekly_contracted_hours integer DEFAULT 44,
  base_salary numeric(10,2),
  department text,
  municipality text,
  education_level text,
  profession text,
  contract_end_date date,
  name text GENERATED ALWAYS AS (TRIM(BOTH FROM ((first_names || ' '::text) || COALESCE(last_names, ''::text)))) STORED,
  system_role text DEFAULT 'EMPLEADO'::text,
  email text,
  hours_owed numeric DEFAULT 0,
  afp_institution text,
  account_type text DEFAULT 'AHORRO'::text,
  education_grade_completed text,
  education_specialty text,
  is_studying boolean DEFAULT false NOT NULL,
  study_start_date date,
  study_duration_years numeric(3,1),
  extra_phones text[] DEFAULT '{}'::text[] NOT NULL,
  extra_addresses jsonb DEFAULT '[]'::jsonb NOT NULL,
  additional_skills jsonb DEFAULT '[]'::jsonb NOT NULL,
  has_maestria boolean DEFAULT false NOT NULL,
  maestria_title text,
  maestria_is_studying boolean DEFAULT false NOT NULL,
  maestria_study_start_date date,
  maestria_study_duration_years numeric,
  economic_dependents jsonb DEFAULT '[]'::jsonb NOT NULL,
  emergency_contact_relationship text,
  emergency_contact_extra_phones text[] DEFAULT '{}'::text[] NOT NULL,
  contract_start_date date,
  has_motorcycle boolean DEFAULT false NOT NULL,
  has_car boolean DEFAULT false NOT NULL,
  has_motorcycle_license boolean DEFAULT false NOT NULL,
  has_car_license boolean DEFAULT false NOT NULL,
  has_srs_accreditation boolean DEFAULT false NOT NULL,
  srs_accreditation_expiry date,
  nationality text,
  alt_identity_document text,
  contract_temporal_legal_basis text,
  contract_temporal_reason text,
  employee_documents jsonb DEFAULT '[]'::jsonb,
  alt_identity_document_type text,
  nursing_license_number text,
  pharmacist_license_number text,
  has_disability boolean DEFAULT false NOT NULL,
  disability_type text,
  disability_grade text,
  disability_has_certification boolean DEFAULT false NOT NULL,
  chronic_conditions jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.erp_sucursal_map (
  erp_sucursal_id integer NOT NULL,
  branch_id bigint NOT NULL,
  nombre text NOT NULL,
  es_bodega boolean DEFAULT false NOT NULL,
  orden_despacho integer,
  inv_ubicaciones jsonb
);
CREATE TABLE public.holidays (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  holiday_date date NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  municipality text,
  is_recurring boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.inventory (
  id bigint DEFAULT nextval('inventory_id_seq'::regclass) NOT NULL,
  erp_sucursal_id smallint NOT NULL,
  is_vencidos boolean DEFAULT false NOT NULL,
  erp_product_id integer,
  descripcion text,
  presentacion text,
  detalle text,
  lote text,
  fecha_vencimiento date,
  cantidad integer DEFAULT 0 NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  sync_key text
);
CREATE TABLE public.inventory_sync_log (
  id integer DEFAULT nextval('inventory_sync_log_id_seq'::regclass) NOT NULL,
  erp_sucursal_id smallint NOT NULL,
  is_vencidos boolean DEFAULT false NOT NULL,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  items_count integer,
  rows_upserted integer,
  success boolean DEFAULT true,
  error_msg text
);
CREATE TABLE public.job_watermarks (
  job_name text NOT NULL,
  watermark timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.kiosk_credentials (
  employee_id uuid NOT NULL,
  pin_hash text NOT NULL,
  rotated_at timestamp with time zone DEFAULT now() NOT NULL,
  rotated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.kiosk_devices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  branch_id bigint,
  device_name text NOT NULL,
  device_token uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  last_active_at timestamp with time zone,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  revoked_at timestamp with time zone
);
CREATE TABLE public.kiosk_pin_attempts (
  id bigint DEFAULT nextval('kiosk_pin_attempts_id_seq'::regclass) NOT NULL,
  device_id uuid NOT NULL,
  employee_id uuid,
  succeeded boolean NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.lab_locations (
  id integer DEFAULT nextval('lab_locations_id_seq'::regclass) NOT NULL,
  lab_id integer NOT NULL,
  branch_id integer NOT NULL,
  ubicacion text,
  updated_at timestamp with time zone DEFAULT now(),
  vitrina text,
  estante text,
  peldano text,
  bodega_numero text,
  bodega_peldano text
);
CREATE TABLE public.laboratorios (
  id integer NOT NULL,
  nombre text NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  ubicacion text,
  ocultar_en_minmax boolean DEFAULT false
);
CREATE TABLE public.login_rate_limit (
  id bigint DEFAULT nextval('login_rate_limit_id_seq'::regclass) NOT NULL,
  client_ip text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.minmax_change_requests (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  erp_product_id integer NOT NULL,
  erp_sucursal_id integer NOT NULL,
  product_name text,
  current_min integer,
  current_max integer,
  requested_min integer NOT NULL,
  requested_max integer NOT NULL,
  reason text,
  status text DEFAULT 'pending'::text NOT NULL,
  requested_by text NOT NULL,
  requested_by_id uuid,
  requested_by_name text,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_by text,
  decided_at timestamp with time zone,
  decision_note text,
  current_sales_6m integer
);
CREATE TABLE public.minmax_ignored (
  erp_sucursal_id integer NOT NULL,
  erp_product_id integer NOT NULL,
  ignored_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.minmax_sync_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  source text NOT NULL,
  erp_sucursal_id smallint,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  success boolean NOT NULL,
  error_msg text,
  items_count integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.module_locks (
  id bigint DEFAULT nextval('module_locks_id_seq'::regclass) NOT NULL,
  module_key text NOT NULL,
  locked_by_id uuid NOT NULL,
  locked_by_name text NOT NULL,
  reason text,
  locked_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.mv_refresh_state (
  mv_name text NOT NULL,
  last_writes bigint DEFAULT '-1'::integer NOT NULL,
  refreshed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  recipient_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text DEFAULT ''::text NOT NULL,
  link text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  branch_id integer,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  read_at timestamp with time zone
);
CREATE TABLE public.orphan_objects_registry (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  kind text NOT NULL,
  ref text NOT NULL,
  title text NOT NULL,
  status text DEFAULT 'candidate'::text NOT NULL,
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.overtime_bank (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  hours numeric(6,2) NOT NULL,
  type text NOT NULL,
  period_id uuid,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  subtype text DEFAULT 'DIURNAL'::text
);
CREATE TABLE public.payroll_entries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  branch_id bigint,
  days_worked numeric(5,2) DEFAULT 0,
  ordinary_salary numeric(10,2) DEFAULT 0,
  night_hours_ordinary numeric(5,2) DEFAULT 0,
  night_hours_extra numeric(5,2) DEFAULT 0,
  extra_hours_diurnal numeric(5,2) DEFAULT 0,
  extra_hours_nocturnal numeric(5,2) DEFAULT 0,
  holiday_surcharge numeric(10,2) DEFAULT 0,
  bonifications numeric(10,2) DEFAULT 0,
  vacation_bonus numeric(10,2) DEFAULT 0,
  viaticos numeric(10,2) DEFAULT 0,
  viaticos_detail text,
  isss_deduction numeric(10,2) DEFAULT 0,
  afp_deduction numeric(10,2) DEFAULT 0,
  renta_deduction numeric(10,2) DEFAULT 0,
  order_discount numeric(10,2) DEFAULT 0,
  other_discounts numeric(10,2) DEFAULT 0,
  salary_advance numeric(10,2) DEFAULT 0,
  subtotal_a numeric(10,2) DEFAULT 0,
  subtotal_b numeric(10,2) DEFAULT 0,
  total_deductions numeric(10,2) DEFAULT 0,
  net_pay numeric(10,2) DEFAULT 0,
  status text DEFAULT 'PENDING'::text,
  edit_history jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.payroll_periods (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  period_type text DEFAULT 'QUINCENA'::text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  pay_date date,
  branch_id bigint,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  paid_by uuid,
  paid_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.pedido_apoyo (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  employee_id uuid NOT NULL,
  registered_by uuid,
  registered_at timestamp with time zone DEFAULT now(),
  tipo character varying(12) DEFAULT 'preparacion'::character varying NOT NULL
);
CREATE TABLE public.pedido_item_eventos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pedido_item_id integer NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  tipo text NOT NULL,
  resolucion_tipo text,
  nota text,
  hecho_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pedido_items (
  id integer DEFAULT nextval('pedido_items_id_seq'::regclass) NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  erp_product_id integer NOT NULL,
  erp_presentacion_id integer,
  cantidad_asignada integer NOT NULL,
  cantidad_recibida integer,
  sin_stock boolean DEFAULT false NOT NULL,
  revision_minmax boolean DEFAULT false NOT NULL,
  status text DEFAULT 'pendiente'::text NOT NULL,
  nota_diferencia text,
  received_at timestamp with time zone,
  stock_packs_snapshot numeric,
  max_qty_snapshot integer,
  min_qty_snapshot integer,
  urgencia_pct_snapshot integer,
  lotes_asignados jsonb,
  received_by uuid,
  error_tipo text,
  resuelto_por uuid,
  resuelto_at timestamp with time zone,
  nota_resolucion text,
  resuelta_at timestamp with time zone,
  resuelta_por uuid,
  factor numeric,
  dispatch_tipo text,
  dispatch_factor numeric,
  resolucion_status text,
  resolucion_tipo text,
  resolucion_nota text,
  confirmado_suc_por uuid,
  confirmado_suc_at timestamp with time zone,
  rechazado_por uuid,
  rechazado_at timestamp with time zone,
  nota_rechazo text,
  cantidad_problema integer,
  falta_caja boolean DEFAULT false NOT NULL,
  caja_especial boolean DEFAULT false NOT NULL,
  agotamiento boolean DEFAULT false,
  dispatch_multiplo smallint
);
CREATE TABLE public.pedido_pausa_historial (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  pausado_at timestamp with time zone DEFAULT now() NOT NULL,
  reanudado_at timestamp with time zone,
  razon text,
  pausado_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reanudado_por uuid
);
CREATE TABLE public.pedido_recepcion_extras (
  id bigint DEFAULT nextval('pedido_recepcion_extras_id_seq'::regclass) NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  erp_product_id integer NOT NULL,
  cantidad integer NOT NULL,
  nota text,
  reported_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pedido_recepcion_firmas (
  id bigint DEFAULT nextval('pedido_recepcion_firmas_id_seq'::regclass) NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  employee_id uuid NOT NULL,
  added_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pedido_sucursal_status (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  iniciado_at timestamp with time zone,
  iniciado_por uuid,
  finalizado_at timestamp with time zone,
  finalizado_por uuid,
  recibido_erp_at timestamp with time zone,
  recibido_erp_por uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  codigo text,
  pausado_at timestamp with time zone,
  pausa_razon text,
  reanudado_at timestamp with time zone,
  llegada_fisica_at timestamp with time zone,
  llegada_fisica_por uuid,
  diferencias_reportadas_at timestamp with time zone,
  diferencias_reportadas_por uuid,
  corregido_bodega_at timestamp with time zone,
  corregido_bodega_por uuid,
  corregido_bodega_nota text,
  confirmado_correccion_at timestamp with time zone,
  confirmado_correccion_por uuid,
  llegada_tipo text,
  llegada_nota text,
  falta_cajas jsonb DEFAULT '[]'::jsonb NOT NULL,
  falta_caja_at timestamp with time zone,
  reenvio_bodega_at timestamp with time zone,
  segunda_llegada_at timestamp with time zone,
  total_cajas integer,
  caja_map jsonb DEFAULT '{}'::jsonb,
  pagina_items jsonb DEFAULT '{}'::jsonb,
  paginas jsonb,
  reenvio_por uuid,
  cajas_recibidas jsonb DEFAULT '[]'::jsonb,
  cajas_danadas jsonb DEFAULT '[]'::jsonb,
  reenvios_historial jsonb DEFAULT '[]'::jsonb,
  cajas_electrolit integer DEFAULT 0 NOT NULL,
  electrolit_ok boolean,
  electrolit_faltantes integer,
  cajas_especiales jsonb DEFAULT '[]'::jsonb,
  cajas_especiales_llegadas jsonb DEFAULT '{}'::jsonb,
  reanudado_por uuid,
  entrega_programada_at timestamp with time zone,
  entrega_programada_historial jsonb DEFAULT '[]'::jsonb
);
CREATE TABLE public.pedidos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  numero integer DEFAULT nextval('pedidos_numero_seq'::regclass) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  status text DEFAULT 'confirmado'::text NOT NULL,
  notes text,
  anulado_por uuid,
  anulado_at timestamp with time zone,
  motivo_anulacion text,
  responsable_id uuid,
  revisado_por uuid,
  enviado_por uuid,
  enviado_at timestamp with time zone,
  sucursal_ids integer[]
);
CREATE TABLE public.pedidos_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nombre text NOT NULL,
  sucursal_ids integer[] NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  total_filas integer DEFAULT 0 NOT NULL,
  total_packs integer DEFAULT 0 NOT NULL,
  datos jsonb NOT NULL
);
CREATE TABLE public.practicantes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  first_names text NOT NULL,
  last_names text NOT NULL,
  dui text,
  alt_identity_document text,
  branch_id bigint NOT NULL,
  institucion_educativa text NOT NULL,
  tutor_nombre text NOT NULL,
  tutor_telefono text,
  supervisor_employee_id uuid,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  horas_requeridas numeric,
  convenio_url text NOT NULL,
  estado text DEFAULT 'ACTIVO'::text NOT NULL,
  notas text,
  created_by uuid,
  birth_date date,
  phone text
);
CREATE TABLE public.presentaciones (
  id integer NOT NULL,
  tipo text,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.product_active_principles (
  id integer DEFAULT nextval('product_active_principles_id_seq'::regclass) NOT NULL,
  product_id integer NOT NULL,
  nombre text NOT NULL,
  concentracion text,
  orden smallint DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.product_categories (
  id integer DEFAULT nextval('product_categories_id_seq'::regclass) NOT NULL,
  nombre text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.product_last_sale (
  erp_product_id integer NOT NULL,
  erp_sucursal_id integer NOT NULL,
  last_sale_date date NOT NULL
);
CREATE TABLE public.product_locations (
  id bigint DEFAULT nextval('product_locations_id_seq'::regclass) NOT NULL,
  product_id integer NOT NULL,
  branch_id bigint NOT NULL,
  ubicacion text DEFAULT ''::text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  vitrina text,
  estante text,
  peldano text,
  bodega_numero text,
  bodega_peldano text
);
CREATE TABLE public.product_precios (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  product_id integer NOT NULL,
  id_presentacion integer NOT NULL,
  activo boolean DEFAULT true,
  costo numeric(10,4),
  vineta numeric(10,4),
  descuento_1 numeric(10,4),
  vip numeric(10,4),
  clinica numeric(10,4),
  mayoreo numeric(10,4),
  premium numeric(10,4),
  precio_7 numeric(10,4),
  updated_at timestamp with time zone DEFAULT now(),
  descripcion text,
  factor integer
);
CREATE TABLE public.product_precios_changelog (
  id bigint DEFAULT nextval('product_precios_changelog_id_seq'::regclass) NOT NULL,
  product_id integer NOT NULL,
  id_presentacion integer NOT NULL,
  campo text NOT NULL,
  valor_anterior text,
  valor_nuevo text,
  detected_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.product_precios_history (
  id bigint DEFAULT nextval('product_precios_history_id_seq'::regclass) NOT NULL,
  product_id integer NOT NULL,
  id_presentacion integer NOT NULL,
  vineta numeric,
  descuento_1 numeric,
  vip numeric,
  clinica numeric,
  mayoreo numeric,
  premium numeric,
  precio_7 numeric,
  valid_from timestamp with time zone DEFAULT now() NOT NULL,
  valid_until timestamp with time zone,
  costo numeric
);
CREATE TABLE public.product_sales_monthly_agg (
  year_month text NOT NULL,
  branch_id bigint NOT NULL,
  erp_product_id integer NOT NULL,
  presentacion text DEFAULT ''::text NOT NULL,
  descripcion text,
  cantidad numeric DEFAULT 0 NOT NULL,
  neto numeric DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.product_sales_rollup (
  erp_product_id integer NOT NULL,
  erp_sucursal_id integer NOT NULL,
  units_analysis numeric DEFAULT 0 NOT NULL,
  units_30d numeric DEFAULT 0 NOT NULL,
  analysis_days integer NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.product_stock_params (
  id bigint DEFAULT nextval('product_stock_params_id_seq'::regclass) NOT NULL,
  erp_product_id integer NOT NULL,
  erp_sucursal_id integer NOT NULL,
  abc_class text,
  daily_velocity numeric(14,6),
  cv numeric(8,2),
  demand_variability text,
  min_units integer,
  max_units integer,
  manual_min integer,
  manual_max integer,
  units_sold_6m integer,
  revenue_6m numeric(14,2),
  calculated_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  velocity_30d numeric,
  lead_time_days integer,
  draft_min integer,
  draft_max integer,
  draft_abc_class text,
  draft_demand_variability text,
  draft_cv numeric,
  draft_velocity numeric,
  draft_velocity_30d numeric,
  draft_units_sold integer,
  draft_revenue numeric,
  draft_calculated_at timestamp with time zone,
  draft_status text DEFAULT 'none'::text NOT NULL,
  published_at timestamp with time zone,
  published_by text,
  is_hidden boolean DEFAULT false NOT NULL,
  draft_data_days integer,
  data_days integer,
  calc_min integer,
  calc_max integer
);
CREATE TABLE public.product_stock_params_history (
  id bigint DEFAULT nextval('product_stock_params_history_id_seq'::regclass) NOT NULL,
  erp_product_id integer NOT NULL,
  erp_sucursal_id integer NOT NULL,
  captured_at timestamp with time zone DEFAULT now() NOT NULL,
  min_units integer,
  max_units integer,
  daily_velocity numeric,
  velocity_30d numeric,
  abc_class text,
  demand_variability text,
  cv numeric,
  calculated_at timestamp with time zone
);
CREATE TABLE public.products (
  id integer NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  nombre text NOT NULL,
  codigo_barras text,
  laboratorio_id integer,
  es_antibiotico boolean DEFAULT false,
  activo boolean DEFAULT true NOT NULL,
  perecedero boolean DEFAULT false,
  principio_activo text,
  tipo_medicamento text,
  requiere_receta boolean DEFAULT false NOT NULL,
  foto_url text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sin_principio_activo boolean DEFAULT false NOT NULL,
  devolutivo boolean DEFAULT true NOT NULL,
  oculto_en_ventas boolean DEFAULT false NOT NULL,
  oculto_por uuid,
  oculto_at timestamp with time zone,
  nombre_norm text GENERATED ALWAYS AS (norm_search(nombre)) STORED,
  pactivo_norm text GENERATED ALWAYS AS (norm_search(principio_activo)) STORED
);
CREATE TABLE public.products_changelog (
  id bigint DEFAULT nextval('products_changelog_id_seq'::regclass) NOT NULL,
  product_id integer NOT NULL,
  campo text NOT NULL,
  valor_anterior text,
  valor_nuevo text,
  detected_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.products_sync_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  checked_at timestamp with time zone DEFAULT now() NOT NULL,
  success boolean NOT NULL,
  error_msg text,
  products_written integer,
  product_changes integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.proveedores (
  id integer DEFAULT nextval('proveedores_id_seq'::regclass) NOT NULL,
  laboratorio_id integer NOT NULL,
  nombre text NOT NULL,
  devolutivo boolean DEFAULT false NOT NULL,
  meses_devolucion integer,
  notas text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  vineta numeric
);
CREATE TABLE public.proveedores_categorias (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  clase text NOT NULL,
  nombre text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.proveedores_maestro (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  nit text,
  dui text,
  nrc text,
  nombre text NOT NULL,
  nombre_comercial text,
  cod_actividad text,
  desc_actividad text,
  tipo_establecimiento text,
  departamento text,
  municipio text,
  direccion text,
  telefono text,
  correo text,
  percibe_1 boolean DEFAULT false NOT NULL,
  retiene_renta boolean DEFAULT false NOT NULL,
  categoria_id bigint,
  supplier_id integer,
  contacto_nombre text,
  telefono2 text,
  nombre_cheques text,
  notas text,
  activo boolean DEFAULT true NOT NULL,
  pais text DEFAULT 'SV'::text NOT NULL,
  source text DEFAULT 'dte'::text NOT NULL,
  primera_vez_visto date,
  ultima_vez_visto date,
  docs_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  nombre_norm text GENERATED ALWAYS AS (norm_search(nombre)) STORED,
  percibe_1_override boolean,
  alias text
);
CREATE TABLE public.purchase_dte_documents (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  codigo_generacion text,
  tipo_dte text,
  numero_control text,
  emisor_nit text,
  emisor_nrc text,
  emisor_nombre text,
  fecha_emision date,
  monto_total numeric(14,2),
  total_iva numeric(14,2),
  json_path text,
  pdf_path text,
  account_id bigint NOT NULL,
  from_email text,
  source_message_id text,
  received_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  supplier_id bigint,
  proveedor_id bigint,
  documento_relacionado_id bigint,
  invalidado boolean DEFAULT false NOT NULL,
  invalidado_motivo text,
  invalidado_at timestamp with time zone,
  items_text text,
  items_norm text GENERATED ALWAYS AS (norm_search(items_text)) STORED,
  orig_json_path text,
  sello_recibido text
);
CREATE TABLE public.purchase_dte_processed_messages (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  account_id bigint NOT NULL,
  source_message_id text NOT NULL,
  processed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.purchase_dte_review_queue (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  kind text NOT NULL,
  file_path text NOT NULL,
  filename text,
  reason text,
  account_id bigint NOT NULL,
  source_message_id text,
  from_email text,
  subject text,
  received_at timestamp with time zone,
  status text DEFAULT 'pendiente'::text NOT NULL,
  matched_document_id bigint,
  ai_suggested jsonb,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.purchase_receipt_items (
  id integer DEFAULT nextval('purchase_receipt_items_id_seq'::regclass) NOT NULL,
  receipt_id integer NOT NULL,
  linea_num integer NOT NULL,
  erp_product_id integer,
  descripcion text,
  cantidad numeric(10,3) DEFAULT 0,
  precio_unitario numeric(12,4) DEFAULT 0,
  total_linea numeric(12,2) DEFAULT 0,
  lote text,
  fecha_vencimiento date
);
CREATE TABLE public.purchase_receipts (
  id integer DEFAULT nextval('purchase_receipts_id_seq'::regclass) NOT NULL,
  erp_purchase_id integer NOT NULL,
  branch_id integer NOT NULL,
  erp_sucursal_id integer NOT NULL,
  fecha date NOT NULL,
  proveedor text,
  estado text,
  subtotal numeric(12,2) DEFAULT 0,
  iva numeric(12,2) DEFAULT 0,
  total numeric(12,2) DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  supplier_id integer,
  erp_supplier_id integer
);
CREATE TABLE public.purchase_sync_log (
  id integer DEFAULT nextval('purchase_sync_log_id_seq'::regclass) NOT NULL,
  synced_at timestamp with time zone DEFAULT now(),
  branch_id integer,
  erp_sucursal_id integer,
  fini date,
  ffin date,
  receipts_total integer DEFAULT 0,
  receipts_new integer DEFAULT 0,
  items_inserted integer DEFAULT 0,
  success boolean DEFAULT true,
  error_msg text
);
CREATE TABLE public.push_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.role_permissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  module_key text NOT NULL,
  can_view boolean DEFAULT false NOT NULL,
  can_edit boolean DEFAULT false NOT NULL,
  can_approve boolean DEFAULT false NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  role_id integer,
  scope text DEFAULT 'ALL'::text NOT NULL
);
CREATE TABLE public.roles (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  parent_role_id bigint,
  secondary_parent_role_id bigint,
  scope text DEFAULT 'BRANCH'::text,
  max_limit integer DEFAULT 99,
  max_price_level text,
  is_su boolean DEFAULT false NOT NULL
);
CREATE TABLE public.ruta_locations (
  ruta_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.ruta_pedidos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ruta_id uuid NOT NULL,
  pedido_id uuid NOT NULL,
  erp_sucursal_id integer NOT NULL,
  orden_entrega integer DEFAULT 1 NOT NULL,
  distancia_desde_anterior_m integer,
  duracion_desde_anterior_min integer,
  entregado_at timestamp with time zone,
  entregado_por uuid,
  confirmado_suc_at timestamp with time zone,
  confirmado_suc_por uuid,
  discrepancia boolean DEFAULT false,
  discrepancia_nota text
);
CREATE TABLE public.rutas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  numero integer DEFAULT nextval('rutas_numero_seq'::regclass) NOT NULL,
  conductor_id uuid,
  conductor_nombre text,
  salida_at timestamp with time zone,
  vuelta_base_at timestamp with time zone,
  status text DEFAULT 'pendiente'::text NOT NULL,
  distancia_total_m integer,
  duracion_estimada_min integer,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  visitas jsonb DEFAULT '[]'::jsonb NOT NULL
);
CREATE TABLE public.sales_alert_log (
  id bigint DEFAULT nextval('sales_alert_log_id_seq'::regclass) NOT NULL,
  branch_id bigint NOT NULL,
  alert_type text NOT NULL,
  alert_key text NOT NULL,
  sent_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.sales_daily_stats (
  date date NOT NULL,
  branch_id integer NOT NULL,
  count_valid integer DEFAULT 0 NOT NULL,
  sum_total numeric DEFAULT 0 NOT NULL
);
CREATE TABLE public.sales_gap_resolutions (
  id bigint DEFAULT nextval('sales_gap_resolutions_id_seq'::regclass) NOT NULL,
  branch_id bigint NOT NULL,
  tipo_documento text NOT NULL,
  gap_from bigint NOT NULL,
  gap_to bigint NOT NULL,
  comment text,
  resolved_by text,
  resolved_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.sales_invoice_changelog (
  id bigint DEFAULT nextval('sales_invoice_changelog_id_seq'::regclass) NOT NULL,
  invoice_id bigint NOT NULL,
  codigo_generacion uuid NOT NULL,
  branch_id bigint NOT NULL,
  tipo_documento text,
  campo text NOT NULL,
  valor_anterior text,
  valor_nuevo text,
  detected_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.sales_invoice_items (
  id bigint DEFAULT nextval('sales_invoice_items_id_seq'::regclass) NOT NULL,
  invoice_id bigint NOT NULL,
  erp_product_id integer,
  descripcion text,
  cantidad numeric(10,3),
  presentacion text,
  precio_unitario numeric(10,4),
  total_linea numeric(10,2),
  id_presentacion integer,
  linea_num smallint NOT NULL,
  lote text,
  fecha_vencimiento date,
  factor_unidades smallint
);
CREATE TABLE public.sales_invoice_resolutions (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  invoice_id bigint NOT NULL,
  comment text,
  resolved_at timestamp with time zone DEFAULT now(),
  resolved_by text
);
CREATE TABLE public.sales_invoices (
  id bigint DEFAULT nextval('sales_invoices_id_seq'::regclass) NOT NULL,
  branch_id bigint NOT NULL,
  erp_invoice_id text NOT NULL,
  codigo_generacion uuid,
  correlativo text,
  tipo_documento text,
  fecha date NOT NULL,
  hora time without time zone NOT NULL,
  cliente text,
  cod_vendedor text,
  tipo_pago text,
  estado text,
  subtotal numeric(10,2),
  iva numeric(10,2),
  total numeric(10,2),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  customer_id bigint,
  recibido_mh text,
  has_puntos boolean DEFAULT false NOT NULL
);
CREATE TABLE public.sales_null_resolutions (
  id bigint DEFAULT nextval('sales_null_resolutions_id_seq'::regclass) NOT NULL,
  null_id bigint NOT NULL,
  comment text,
  resolved_by text,
  resolved_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.sales_payment_confirmations (
  id bigint DEFAULT nextval('sales_payment_confirmations_id_seq'::regclass) NOT NULL,
  invoice_id bigint NOT NULL,
  confirmed_by text,
  confirmed_by_photo text,
  confirmed_at timestamp with time zone DEFAULT now(),
  notes text,
  proof_url text,
  tipo_pago text,
  branch_id bigint
);
CREATE TABLE public.schedule_coverage (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  coverage_branch_id bigint NOT NULL,
  home_branch_id bigint,
  week_start_date date NOT NULL,
  day_of_week integer NOT NULL,
  schedule_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.shifts (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  name text NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  branch_id bigint,
  color text DEFAULT '#007AFF'::text,
  is_active boolean DEFAULT true
);
CREATE TABLE public.stock_config (
  id integer DEFAULT 1 NOT NULL,
  cycle_days integer DEFAULT 45 NOT NULL,
  reorder_x_days integer DEFAULT 7 NOT NULL,
  reorder_y_days integer DEFAULT 10 NOT NULL,
  reorder_z_days integer DEFAULT 15 NOT NULL,
  xyz_x_cv_max numeric DEFAULT 30 NOT NULL,
  xyz_y_cv_max numeric DEFAULT 70 NOT NULL,
  abc_a_pct numeric DEFAULT 70 NOT NULL,
  abc_b_pct numeric DEFAULT 90 NOT NULL,
  analysis_days integer DEFAULT 180 NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  updated_by text,
  approaching_pct numeric DEFAULT 25,
  buffer_x_days integer DEFAULT 0,
  buffer_y_days integer DEFAULT 0,
  buffer_z_days integer DEFAULT 0,
  outlier_percentile integer DEFAULT 95,
  xyz_x_percentile numeric DEFAULT 5 NOT NULL,
  xyz_y_percentile numeric DEFAULT 35 NOT NULL,
  pedido_recepcion_activa boolean DEFAULT false NOT NULL
);
CREATE TABLE public.suppliers (
  id integer DEFAULT nextval('suppliers_id_seq'::regclass) NOT NULL,
  erp_supplier_id integer,
  nombre text NOT NULL,
  nrc text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.survey_bloques (
  id integer DEFAULT nextval('survey_bloques_id_seq'::regclass) NOT NULL,
  survey_id integer NOT NULL,
  numero integer NOT NULL,
  nombre text NOT NULL,
  color text DEFAULT 'slate'::text NOT NULL,
  descripcion text,
  indices integer[] DEFAULT '{}'::integer[] NOT NULL,
  ctx_dirigido text,
  ctx_tipo text,
  ctx_badge text,
  ctx_nota text
);
CREATE TABLE public.survey_preguntas (
  id integer DEFAULT nextval('survey_preguntas_id_seq'::regclass) NOT NULL,
  survey_id integer NOT NULL,
  bloque_id integer,
  numero integer NOT NULL,
  indice integer NOT NULL,
  texto text NOT NULL,
  opciones jsonb,
  tipo text DEFAULT 'abcd'::text NOT NULL,
  invertida boolean DEFAULT false NOT NULL
);
CREATE TABLE public.survey_responses (
  id integer DEFAULT nextval('survey_responses_id_seq'::regclass) NOT NULL,
  survey_id integer NOT NULL,
  employee_id uuid NOT NULL,
  responses jsonb NOT NULL,
  comentario text,
  created_at timestamp with time zone DEFAULT now(),
  is_jefe boolean DEFAULT false NOT NULL,
  display_name text,
  updated_at timestamp with time zone,
  updated_by uuid
);
CREATE TABLE public.surveys (
  id integer DEFAULT nextval('surveys_id_seq'::regclass) NOT NULL,
  nombre text NOT NULL,
  "año" integer NOT NULL,
  fecha_aplicacion date,
  descripcion text,
  created_at timestamp with time zone DEFAULT now(),
  estado text DEFAULT 'activa'::text NOT NULL,
  tipo text DEFAULT 'clima'::text NOT NULL,
  anonima boolean DEFAULT true NOT NULL,
  compartir_resultados boolean DEFAULT false NOT NULL,
  scope_tipo text DEFAULT 'all'::text NOT NULL,
  scope_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  fecha_inicio date,
  fecha_fin date,
  created_by uuid,
  ai_summaries jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.sync_alert_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  domain text NOT NULL,
  scope_key text NOT NULL,
  alert_key text NOT NULL,
  sent_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.sync_log (
  id bigint DEFAULT nextval('sync_log_id_seq'::regclass) NOT NULL,
  ran_at timestamp with time zone DEFAULT now(),
  branch_id bigint NOT NULL,
  fini date NOT NULL,
  ffin date NOT NULL,
  invoices_total integer DEFAULT 0,
  invoices_new integer DEFAULT 0,
  items_inserted integer DEFAULT 0,
  success boolean NOT NULL,
  attempts integer DEFAULT 1,
  error_msg text,
  id_min integer,
  id_max integer
);
CREATE TABLE public.timesheets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  scheduled_shift_id bigint,
  actual_start_time timestamp with time zone,
  actual_end_time timestamp with time zone,
  regular_hours numeric(5,2) DEFAULT 0,
  overtime_hours numeric(5,2) DEFAULT 0,
  late_minutes integer DEFAULT 0,
  is_absent boolean DEFAULT false,
  is_holiday_worked boolean DEFAULT false,
  status text DEFAULT 'PENDING'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  nocturnal_hours numeric DEFAULT 0,
  nocturnal_overtime_hours numeric DEFAULT 0,
  absence_type text
);
CREATE TABLE public.user_dashboard_prefs (
  user_id uuid NOT NULL,
  layout jsonb DEFAULT '{}'::jsonb NOT NULL,
  sizes jsonb DEFAULT '{}'::jsonb NOT NULL,
  widgets jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  mobile_layout jsonb DEFAULT '{}'::jsonb,
  mobile_sizes jsonb DEFAULT '{}'::jsonb,
  theme text
);
CREATE TABLE public.vacation_plan_headers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  year integer NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  ai_generated boolean DEFAULT false NOT NULL,
  generated_by uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.vacation_plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  year integer NOT NULL,
  employee_id uuid NOT NULL,
  branch_id integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days integer DEFAULT 15 NOT NULL,
  status text DEFAULT 'PLANNED'::text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  metadata jsonb,
  plan_header_id uuid,
  change_requested_start date,
  change_requested_end date
);
CREATE TABLE public.ventas_monthly_stats (
  mes date NOT NULL,
  branch_id bigint DEFAULT '-1'::integer NOT NULL,
  cod_vendedor text DEFAULT ''::text NOT NULL,
  total_count bigint DEFAULT 0 NOT NULL,
  total_sum numeric(14,2) DEFAULT 0 NOT NULL,
  avg_ticket numeric(10,2) DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.ventas_perdidas (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  producto_buscado text NOT NULL,
  erp_product_id integer,
  descripcion text,
  cantidad integer DEFAULT 1 NOT NULL,
  branch_id integer,
  reportado_por uuid,
  status text DEFAULT 'pendiente'::text NOT NULL,
  notas text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  principio_activo text,
  laboratorio text
);
CREATE TABLE public.wfm_snapshots (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  branch_id bigint NOT NULL,
  snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
  recommended_staff integer NOT NULL,
  base_staff_hours numeric NOT NULL,
  extra_volume_hours numeric NOT NULL,
  shrinkage_hours numeric NOT NULL,
  total_labor_hours numeric NOT NULL,
  peak_day_name text,
  peak_hour integer,
  peak_avg_sales numeric,
  created_at timestamp with time zone DEFAULT now()
);


-- ── Storage parameters por tabla (2) ──────────────────────────────────────

ALTER TABLE public.sales_invoice_items SET (autovacuum_vacuum_scale_factor=0.02, autovacuum_analyze_scale_factor=0.02);
ALTER TABLE public.sales_invoices SET (autovacuum_vacuum_scale_factor=0.02, autovacuum_analyze_scale_factor=0.02);


-- ── Secuencias IDENTITY con nombre fosilizado por un rename de tabla (1) ───

ALTER SEQUENCE public.product_precios_id_seq RENAME TO product_presentations_id_seq;


-- ── Vistas y vistas materializadas (matviews WITH NO DATA) (13) ────────────

CREATE OR REPLACE VIEW public.branch_hourly_sales WITH (security_invoker=true) AS  SELECT branch_id,
    fecha AS sale_date,
    (EXTRACT(hour FROM hora))::integer AS sale_hour,
    round(sum(total), 2) AS total_sales,
    count(*) AS transaction_count
   FROM sales_invoices
  WHERE (estado <> ALL (ARRAY['NULA'::text, 'DTE INVALIDADO EN MH'::text]))
  GROUP BY branch_id, fecha, (EXTRACT(hour FROM hora));
CREATE OR REPLACE VIEW public.employee_timeline WITH (security_invoker=true) AS  SELECT e.id AS employee_id,
    'HIRE'::text AS event_type,
    'Contratación'::text AS category,
    e.hire_date AS event_date,
    NULL::date AS event_end_date,
    jsonb_build_object('branch_id', e.branch_id, 'role_id', e.role_id, 'contract_type', e.contract_type) AS metadata,
    NULL::text AS note,
    (e.hire_date)::timestamp with time zone AS created_at
   FROM employees e
  WHERE (e.hire_date IS NOT NULL)
UNION ALL
 SELECT ev.employee_id,
    ev.type AS event_type,
        CASE ev.type
            WHEN 'VACATION'::text THEN 'Vacaciones'::text
            WHEN 'DISABILITY'::text THEN 'Incapacidad'::text
            WHEN 'PERMIT'::text THEN 'Permiso'::text
            WHEN 'SUPPORT'::text THEN 'Apoyo sucursal'::text
            WHEN 'VACATION_RECALL'::text THEN 'Regreso anticipado'::text
            WHEN 'INDUCTION'::text THEN 'Inducción'::text
            ELSE ev.type
        END AS category,
    ev.date AS event_date,
        CASE
            WHEN ((ev.metadata ->> 'endDate'::text) IS NOT NULL) THEN ((ev.metadata ->> 'endDate'::text))::date
            ELSE ev.date
        END AS event_end_date,
    ev.metadata,
    ev.note,
    ev.created_at
   FROM employee_events ev
UNION ALL
 SELECT (al.target_id)::uuid AS employee_id,
    al.action AS event_type,
        CASE al.action
            WHEN 'EMPLEADO_ASIGNADO'::text THEN 'Asignación'::text
            WHEN 'EMPLEADO_RELEVADO'::text THEN 'Relevo de jefatura'::text
            WHEN 'EMPLEADO_DESVINCULADO_SUCURSAL'::text THEN 'Desvinculación de sucursal'::text
            WHEN 'PROMOTION'::text THEN 'Ascenso / Cambio de cargo'::text
            WHEN 'REASSIGNMENT'::text THEN 'Traslado'::text
            WHEN 'UNASSIGNED'::text THEN 'Desvinculado'::text
            ELSE 'Movimiento'::text
        END AS category,
    (al.created_at)::date AS event_date,
    NULL::date AS event_end_date,
    al.details AS metadata,
    (al.details ->> 'note'::text) AS note,
    al.created_at
   FROM audit_logs al
  WHERE ((al.action = ANY (ARRAY['EMPLEADO_ASIGNADO'::text, 'EMPLEADO_RELEVADO'::text, 'EMPLEADO_DESVINCULADO_SUCURSAL'::text, 'PROMOTION'::text, 'REASSIGNMENT'::text, 'UNASSIGNED'::text])) AND (al.target_id IS NOT NULL) AND (al.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text))
UNION ALL
 SELECT er.employee_id,
    'ROSTER_PUBLISHED'::text AS event_type,
    'Horario publicado'::text AS category,
    er.week_start_date AS event_date,
    (er.week_start_date + 6) AS event_end_date,
    jsonb_build_object('week_start', er.week_start_date, 'schedule', er.schedule_data) AS metadata,
    NULL::text AS note,
    er.updated_at AS created_at
   FROM employee_rosters er
  WHERE (er.status = 'PUBLISHED'::text);
CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker=true) AS  SELECT id,
    code,
    branch_id,
    shift_id,
    photo_url,
    phone,
    address,
    dui,
    birth_date,
    status,
    hire_date,
    afp_number,
    isss_number,
    bank_name,
    account_number,
    weekly_schedule,
    exceptions,
    created_at,
    role_id,
    secondary_role_id,
    kiosk_pin,
    username,
    first_names,
    last_names,
    gender,
    blood_type,
    marital_status,
    emergency_contact_name,
    emergency_contact_phone,
    contract_type,
    weekly_contracted_hours,
    base_salary,
    department,
    municipality,
    education_level,
    profession,
    contract_end_date,
    name,
    system_role,
    email,
    hours_owed,
    afp_institution,
    account_type,
    education_grade_completed,
    education_specialty,
    is_studying,
    study_start_date,
    study_duration_years,
    extra_phones,
    extra_addresses,
    additional_skills,
    has_maestria,
    maestria_title,
    maestria_is_studying,
    maestria_study_start_date,
    maestria_study_duration_years,
    economic_dependents,
    emergency_contact_relationship,
    emergency_contact_extra_phones,
    contract_start_date,
    has_motorcycle,
    has_car,
    has_motorcycle_license,
    has_car_license,
    has_srs_accreditation,
    srs_accreditation_expiry,
    nationality,
    alt_identity_document,
    contract_temporal_legal_basis,
    contract_temporal_reason,
    employee_documents,
    alt_identity_document_type,
    nursing_license_number,
    pharmacist_license_number,
    chronic_conditions,
    has_disability,
    disability_type,
    disability_grade,
    disability_has_certification
   FROM employees;
CREATE MATERIALIZED VIEW public.inventory_grouped_mv AS  WITH costs AS (
         SELECT DISTINCT ON (pp.product_id, pres.tipo) pp.product_id,
            pres.tipo,
            pp.costo
           FROM (product_precios pp
             JOIN presentaciones pres ON ((pres.id = pp.id_presentacion)))
          WHERE (pp.activo = true)
          ORDER BY pp.product_id, pres.tipo, pp.updated_at DESC
        )
 SELECT (i.erp_sucursal_id)::integer AS erp_sucursal_id,
    i.erp_product_id,
    max(i.descripcion) AS descripcion,
    array_remove(array_agg(DISTINCT i.presentacion) FILTER (WHERE ((NOT i.is_vencidos) AND ((i.cantidad * COALESCE((NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text))::integer, 1)) > 0))), NULL::text) AS presentaciones,
    count(DISTINCT NULLIF(i.lote, ''::text)) FILTER (WHERE (NOT i.is_vencidos)) AS num_lotes,
        CASE
            WHEN (count(DISTINCT NULLIF(i.lote, ''::text)) FILTER (WHERE (NOT i.is_vencidos)) = 1) THEN min(NULLIF(i.lote, ''::text)) FILTER (WHERE (NOT i.is_vencidos))
            ELSE NULL::text
        END AS lote_sample,
    COALESCE(sum(((i.cantidad)::numeric * COALESCE((NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text))::numeric, (1)::numeric))) FILTER (WHERE (NOT i.is_vencidos)), (0)::numeric) AS total_unidades,
    min(i.fecha_vencimiento) FILTER (WHERE ((i.fecha_vencimiento IS NOT NULL) AND (NOT i.is_vencidos))) AS earliest_venc,
    min(i.fecha_vencimiento) FILTER (WHERE ((i.fecha_vencimiento IS NOT NULL) AND (i.fecha_vencimiento >= CURRENT_DATE) AND (NOT i.is_vencidos))) AS soonest_active_venc,
    COALESCE(bool_or(p.es_antibiotico), false) AS es_antibiotico,
    p.laboratorio_id,
    p.tipo_medicamento,
    COALESCE(sum(((i.cantidad)::numeric * (c.costo)::numeric)) FILTER (WHERE (NOT i.is_vencidos)), (0)::numeric) AS total_costo,
    COALESCE(sum(((i.cantidad)::numeric * COALESCE((NULLIF(split_part(lower(COALESCE(i.detalle, ''::text)), 'x'::text, 2), ''::text))::numeric, (1)::numeric))) FILTER (WHERE i.is_vencidos), (0)::numeric) AS vencidos_unidades
   FROM ((inventory i
     LEFT JOIN products p ON ((p.id = i.erp_product_id)))
     LEFT JOIN costs c ON (((c.product_id = i.erp_product_id) AND (c.tipo = TRIM(BOTH FROM i.presentacion)))))
  GROUP BY i.erp_sucursal_id, i.erp_product_id, p.laboratorio_id, p.tipo_medicamento
WITH NO DATA;
CREATE MATERIALIZED VIEW public.mv_product_factor AS  SELECT pp.product_id,
    upper(TRIM(BOTH FROM pr.tipo)) AS pres_key,
    max(pp.factor) AS factor
   FROM (product_precios pp
     JOIN presentaciones pr ON ((pr.id = pp.id_presentacion)))
  WHERE ((pp.activo = true) AND (pp.factor > 0))
  GROUP BY pp.product_id, (upper(TRIM(BOTH FROM pr.tipo)))
WITH NO DATA;
CREATE MATERIALIZED VIEW public.mv_stock_analysis AS  WITH inv_agg AS (
         SELECT inventory.erp_sucursal_id,
            inventory.erp_product_id,
            (sum(((inventory.cantidad)::bigint * COALESCE(((regexp_match(inventory.detalle, '[0-9]+[xX]([0-9]+)'::text))[1])::integer, 1))))::bigint AS total_units
           FROM inventory
          WHERE (inventory.is_vencidos = false)
          GROUP BY inventory.erp_sucursal_id, inventory.erp_product_id
        ), all_sucursales AS (
         SELECT DISTINCT erp_sucursal_map.erp_sucursal_id
           FROM erp_sucursal_map
        )
 SELECT psp.erp_sucursal_id,
    psp.erp_product_id,
    COALESCE(inv.total_units, (0)::bigint) AS current_stock,
    false AS is_dead_stock,
    false AS is_catalog_only
   FROM (((product_stock_params psp
     JOIN products p ON (((p.id = psp.erp_product_id) AND (p.activo = true))))
     LEFT JOIN laboratorios lab ON ((lab.id = p.laboratorio_id)))
     LEFT JOIN inv_agg inv ON (((inv.erp_product_id = psp.erp_product_id) AND (inv.erp_sucursal_id = psp.erp_sucursal_id))))
  WHERE (((psp.daily_velocity IS NOT NULL) OR (psp.draft_velocity IS NOT NULL)) AND (lab.ocultar_en_minmax IS NOT TRUE))
UNION ALL
 SELECT inv2.erp_sucursal_id,
    inv2.erp_product_id,
    inv2.total_units AS current_stock,
    true AS is_dead_stock,
    false AS is_catalog_only
   FROM ((inv_agg inv2
     JOIN products p2 ON (((p2.id = inv2.erp_product_id) AND (p2.activo = true))))
     LEFT JOIN laboratorios lab2 ON ((lab2.id = p2.laboratorio_id)))
  WHERE ((NOT (EXISTS ( SELECT 1
           FROM product_stock_params psp2
          WHERE ((psp2.erp_product_id = inv2.erp_product_id) AND (psp2.erp_sucursal_id = inv2.erp_sucursal_id))))) AND (lab2.ocultar_en_minmax IS NOT TRUE))
UNION ALL
 SELECT psp3.erp_sucursal_id,
    psp3.erp_product_id,
    COALESCE(inv3.total_units, (0)::bigint) AS current_stock,
    true AS is_dead_stock,
    false AS is_catalog_only
   FROM (((product_stock_params psp3
     JOIN products p3 ON (((p3.id = psp3.erp_product_id) AND (p3.activo = true))))
     LEFT JOIN laboratorios lab3 ON ((lab3.id = p3.laboratorio_id)))
     LEFT JOIN inv_agg inv3 ON (((inv3.erp_product_id = psp3.erp_product_id) AND (inv3.erp_sucursal_id = psp3.erp_sucursal_id))))
  WHERE ((psp3.daily_velocity IS NULL) AND (psp3.draft_velocity IS NULL) AND (lab3.ocultar_en_minmax IS NOT TRUE))
UNION ALL
 SELECT sm.erp_sucursal_id,
    p4.id AS erp_product_id,
    (0)::bigint AS current_stock,
    false AS is_dead_stock,
    true AS is_catalog_only
   FROM ((products p4
     CROSS JOIN all_sucursales sm)
     LEFT JOIN laboratorios lab4 ON ((lab4.id = p4.laboratorio_id)))
  WHERE ((p4.activo = true) AND (lab4.ocultar_en_minmax IS NOT TRUE) AND (NOT (EXISTS ( SELECT 1
           FROM product_stock_params psp4
          WHERE ((psp4.erp_product_id = p4.id) AND (psp4.erp_sucursal_id = sm.erp_sucursal_id))))) AND (NOT (EXISTS ( SELECT 1
           FROM inv_agg inv4
          WHERE ((inv4.erp_product_id = p4.id) AND (inv4.erp_sucursal_id = sm.erp_sucursal_id))))))
WITH NO DATA;
CREATE OR REPLACE VIEW public.product_cost_history WITH (security_invoker=true) AS  SELECT pri.erp_product_id,
    pr.fecha,
    pr.proveedor,
    pr.supplier_id,
    pri.descripcion,
        CASE
            WHEN ((pri.cantidad > (0)::numeric) AND (pri.total_linea > (0)::numeric)) THEN (round((pri.total_linea / pri.cantidad), 4))::numeric(12,4)
            ELSE pri.precio_unitario
        END AS precio_unitario,
    pri.cantidad,
    pri.total_linea,
    pri.lote,
    pri.fecha_vencimiento
   FROM (purchase_receipt_items pri
     JOIN purchase_receipts pr ON ((pr.id = pri.receipt_id)))
  WHERE ((pri.erp_product_id IS NOT NULL) AND ((pri.total_linea > (0)::numeric) OR (pri.precio_unitario > (0)::numeric)))
  ORDER BY pri.erp_product_id, pr.fecha DESC;
CREATE OR REPLACE VIEW public.product_purchase_summary WITH (security_invoker=true) AS  SELECT pri.erp_product_id,
    min(pr.fecha) AS first_purchase_date,
    max(pr.fecha) AS last_purchase_date,
    (CURRENT_DATE - min(pr.fecha)) AS days_since_first_purchase,
    count(DISTINCT pr.id) AS total_receipts,
    sum(pri.cantidad) AS total_units_received,
    round(avg(pri.precio_unitario), 4) AS avg_cost,
    ( SELECT pri2.precio_unitario
           FROM (purchase_receipt_items pri2
             JOIN purchase_receipts pr2 ON ((pr2.id = pri2.receipt_id)))
          WHERE ((pri2.erp_product_id = pri.erp_product_id) AND (pri2.precio_unitario > (0)::numeric))
          ORDER BY pr2.fecha DESC, pr2.id DESC
         LIMIT 1) AS latest_cost,
    count(DISTINCT pr.supplier_id) AS distinct_suppliers
   FROM (purchase_receipt_items pri
     JOIN purchase_receipts pr ON ((pr.id = pri.receipt_id)))
  WHERE (pri.erp_product_id IS NOT NULL)
  GROUP BY pri.erp_product_id;
CREATE OR REPLACE VIEW public.products_with_lab WITH (security_invoker=true) AS  SELECT p.id,
    p.nombre,
    p.es_antibiotico,
    p.activo,
    p.laboratorio_id,
    l.nombre AS laboratorio_nombre,
    p.nombre_norm
   FROM (products p
     LEFT JOIN laboratorios l ON ((l.id = p.laboratorio_id)));
CREATE OR REPLACE VIEW public.sales_invoice_gaps WITH (security_invoker=true) AS  WITH parsed AS (
         SELECT sales_invoices.branch_id,
            sales_invoices.tipo_documento,
            sales_invoices.correlativo,
            sales_invoices.fecha,
            ((regexp_match(sales_invoices.correlativo, '^(\d+)_'::text))[1])::bigint AS num
           FROM sales_invoices
          WHERE (sales_invoices.correlativo ~ '^\d+_[A-Z]+$'::text)
        ), with_lag AS (
         SELECT parsed.branch_id,
            parsed.tipo_documento,
            parsed.num,
            parsed.fecha,
            parsed.correlativo,
            lag(parsed.num) OVER (PARTITION BY parsed.branch_id, parsed.tipo_documento ORDER BY parsed.num) AS prev_num
           FROM parsed
        )
 SELECT branch_id,
    tipo_documento,
    (prev_num + 1) AS gap_from,
    (num - 1) AS gap_to,
    (((num - prev_num) - 1))::integer AS gap_count,
    correlativo AS siguiente_correlativo,
    fecha AS fecha_siguiente
   FROM with_lag
  WHERE ((prev_num IS NOT NULL) AND (num > (prev_num + 1)))
  ORDER BY branch_id, tipo_documento, (prev_num + 1);
CREATE OR REPLACE VIEW public.sales_invoice_nulls WITH (security_invoker=true) AS  SELECT id,
    branch_id,
    correlativo,
    erp_invoice_id,
    fecha,
    estado,
    array_remove(ARRAY[
        CASE
            WHEN (codigo_generacion IS NULL) THEN 'codigo_generacion'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((correlativo IS NULL) OR (correlativo = ''::text)) THEN 'correlativo'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((estado IS NULL) OR (estado = ''::text)) THEN 'estado'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (fecha IS NULL) THEN 'fecha'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (hora IS NULL) THEN 'hora'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (total IS NULL) THEN 'total'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((tipo_documento IS NULL) OR (tipo_documento = ''::text)) THEN 'tipo_documento'::text
            ELSE NULL::text
        END,
        CASE
            WHEN ((erp_invoice_id IS NULL) OR (erp_invoice_id = ''::text)) THEN 'erp_invoice_id'::text
            ELSE NULL::text
        END], NULL::text) AS campos_nulos
   FROM sales_invoices
  WHERE ((codigo_generacion IS NULL) OR ((correlativo IS NULL) OR (correlativo = ''::text)) OR ((estado IS NULL) OR (estado = ''::text)) OR (fecha IS NULL) OR (hora IS NULL) OR (total IS NULL) OR ((tipo_documento IS NULL) OR (tipo_documento = ''::text)) OR ((erp_invoice_id IS NULL) OR (erp_invoice_id = ''::text)));
CREATE OR REPLACE VIEW public.v_product_factor WITH (security_invoker=true) AS  SELECT DISTINCT ON (pp.product_id, (upper(TRIM(BOTH FROM pr.tipo)))) pp.product_id,
    upper(TRIM(BOTH FROM pr.tipo)) AS pres_key,
    pp.factor,
    pp.id_presentacion,
    pr.tipo AS pres_tipo
   FROM (product_precios pp
     JOIN presentaciones pr ON ((pr.id = pp.id_presentacion)))
  WHERE ((pp.activo = true) AND (pp.factor > 0))
  ORDER BY pp.product_id, (upper(TRIM(BOTH FROM pr.tipo))), pp.factor DESC;
CREATE OR REPLACE VIEW public.v_sync_health WITH (security_invoker=true) AS  SELECT 'dte'::text AS domain,
    NULL::text AS source,
    sync_log.branch_id,
    NULL::integer AS erp_sucursal_id,
    sync_log.ran_at AS checked_at,
    sync_log.success,
    sync_log.error_msg
   FROM sync_log
UNION ALL
 SELECT 'inventory'::text AS domain,
    NULL::text AS source,
    NULL::bigint AS branch_id,
    (inventory_sync_log.erp_sucursal_id)::integer AS erp_sucursal_id,
    inventory_sync_log.synced_at AS checked_at,
    inventory_sync_log.success,
    inventory_sync_log.error_msg
   FROM inventory_sync_log
UNION ALL
 SELECT 'purchases'::text AS domain,
    NULL::text AS source,
    (purchase_sync_log.branch_id)::bigint AS branch_id,
    purchase_sync_log.erp_sucursal_id,
    purchase_sync_log.synced_at AS checked_at,
    purchase_sync_log.success,
    purchase_sync_log.error_msg
   FROM purchase_sync_log
UNION ALL
 SELECT 'products'::text AS domain,
    NULL::text AS source,
    NULL::bigint AS branch_id,
    NULL::integer AS erp_sucursal_id,
    products_sync_log.checked_at,
    products_sync_log.success,
    products_sync_log.error_msg
   FROM products_sync_log
UNION ALL
 SELECT 'minmax'::text AS domain,
    minmax_sync_log.source,
    NULL::bigint AS branch_id,
    (minmax_sync_log.erp_sucursal_id)::integer AS erp_sucursal_id,
    minmax_sync_log.checked_at,
    minmax_sync_log.success,
    minmax_sync_log.error_msg
   FROM minmax_sync_log
UNION ALL
 SELECT 'backup'::text AS domain,
    NULL::text AS source,
    NULL::bigint AS branch_id,
    NULL::integer AS erp_sucursal_id,
    backup_sync_log.checked_at,
    backup_sync_log.success,
    backup_sync_log.error_msg
   FROM backup_sync_log
UNION ALL
 SELECT 'email'::text AS domain,
    email_sync_log.source,
    NULL::bigint AS branch_id,
    NULL::integer AS erp_sucursal_id,
    email_sync_log.checked_at,
    email_sync_log.success,
    email_sync_log.error_msg
   FROM email_sync_log;


-- ── Claves primarias y unicidad (149) ───────────────────────────────────────

ALTER TABLE public.announcements ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.attendance ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.backup_sync_log ADD CONSTRAINT backup_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.branch_documents ADD CONSTRAINT branch_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.branch_expenses ADD CONSTRAINT branch_expenses_pkey PRIMARY KEY (id);
ALTER TABLE public.branches ADD CONSTRAINT branches_pkey PRIMARY KEY (id);
ALTER TABLE public.conteo_inventario_item_history ADD CONSTRAINT conteo_inventario_item_history_pkey PRIMARY KEY (id);
ALTER TABLE public.conteo_inventario_items ADD CONSTRAINT conteo_inventario_items_pkey PRIMARY KEY (id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_pkey PRIMARY KEY (id);
ALTER TABLE public.cotizacion_items ADD CONSTRAINT cotizacion_items_pkey PRIMARY KEY (id);
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_numero_key UNIQUE (numero);
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_erp_product_id_key UNIQUE (erp_product_id);
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.education_catalog_entries ADD CONSTRAINT education_catalog_entries_category_value_key UNIQUE (category, value);
ALTER TABLE public.education_catalog_entries ADD CONSTRAINT education_catalog_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.email_sync_accounts ADD CONSTRAINT email_sync_accounts_email_key UNIQUE (email);
ALTER TABLE public.email_sync_accounts ADD CONSTRAINT email_sync_accounts_pkey PRIMARY KEY (id);
ALTER TABLE public.email_sync_log ADD CONSTRAINT email_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.employee_branches ADD CONSTRAINT employee_branches_employee_id_branch_id_key UNIQUE (employee_id, branch_id);
ALTER TABLE public.employee_branches ADD CONSTRAINT employee_branches_pkey PRIMARY KEY (id);
ALTER TABLE public.employee_documents ADD CONSTRAINT employee_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.employee_events ADD CONSTRAINT employee_events_pkey PRIMARY KEY (id);
ALTER TABLE public.employee_rosters ADD CONSTRAINT employee_rosters_pkey PRIMARY KEY (id);
ALTER TABLE public.employee_rosters ADD CONSTRAINT employee_rosters_unique_week UNIQUE (employee_id, week_start_date);
ALTER TABLE public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE public.employees ADD CONSTRAINT employees_username_key UNIQUE (username);
ALTER TABLE public.erp_sucursal_map ADD CONSTRAINT erp_sucursal_map_pkey PRIMARY KEY (erp_sucursal_id);
ALTER TABLE public.holidays ADD CONSTRAINT holidays_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_sync_log ADD CONSTRAINT inventory_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory ADD CONSTRAINT inventory_sync_key_unique UNIQUE (sync_key);
ALTER TABLE public.job_watermarks ADD CONSTRAINT job_watermarks_pkey PRIMARY KEY (job_name);
ALTER TABLE public.kiosk_credentials ADD CONSTRAINT kiosk_credentials_pkey PRIMARY KEY (employee_id);
ALTER TABLE public.kiosk_devices ADD CONSTRAINT kiosk_devices_pkey PRIMARY KEY (id);
ALTER TABLE public.kiosk_pin_attempts ADD CONSTRAINT kiosk_pin_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.lab_locations ADD CONSTRAINT lab_locations_lab_id_branch_id_key UNIQUE (lab_id, branch_id);
ALTER TABLE public.lab_locations ADD CONSTRAINT lab_locations_pkey PRIMARY KEY (id);
ALTER TABLE public.laboratorios ADD CONSTRAINT laboratorios_pkey PRIMARY KEY (id);
ALTER TABLE public.login_rate_limit ADD CONSTRAINT login_rate_limit_pkey PRIMARY KEY (id);
ALTER TABLE public.minmax_change_requests ADD CONSTRAINT minmax_change_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.minmax_ignored ADD CONSTRAINT minmax_ignored_pkey PRIMARY KEY (erp_sucursal_id, erp_product_id);
ALTER TABLE public.minmax_sync_log ADD CONSTRAINT minmax_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.module_locks ADD CONSTRAINT module_locks_module_key_key UNIQUE (module_key);
ALTER TABLE public.module_locks ADD CONSTRAINT module_locks_pkey PRIMARY KEY (id);
ALTER TABLE public.mv_refresh_state ADD CONSTRAINT mv_refresh_state_pkey PRIMARY KEY (mv_name);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.orphan_objects_registry ADD CONSTRAINT orphan_objects_registry_pkey PRIMARY KEY (id);
ALTER TABLE public.overtime_bank ADD CONSTRAINT overtime_bank_pkey PRIMARY KEY (id);
ALTER TABLE public.payroll_entries ADD CONSTRAINT payroll_entries_period_id_employee_id_key UNIQUE (period_id, employee_id);
ALTER TABLE public.payroll_entries ADD CONSTRAINT payroll_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.payroll_periods ADD CONSTRAINT payroll_periods_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_apoyo ADD CONSTRAINT pedido_apoyo_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_item_eventos ADD CONSTRAINT pedido_item_eventos_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_pausa_historial ADD CONSTRAINT pedido_pausa_historial_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_recepcion_extras ADD CONSTRAINT pedido_recepcion_extras_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_recepcion_firmas ADD CONSTRAINT pedido_recepcion_firmas_pkey PRIMARY KEY (id);
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_pedido_id_erp_sucursal_id_key UNIQUE (pedido_id, erp_sucursal_id);
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_pkey PRIMARY KEY (id);
ALTER TABLE public.pedidos_snapshots ADD CONSTRAINT pedidos_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_numero_key UNIQUE (numero);
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id);
ALTER TABLE public.practicantes ADD CONSTRAINT practicantes_pkey PRIMARY KEY (id);
ALTER TABLE public.presentaciones ADD CONSTRAINT presentaciones_pkey PRIMARY KEY (id);
ALTER TABLE public.product_active_principles ADD CONSTRAINT product_active_principles_pkey PRIMARY KEY (id);
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_nombre_key UNIQUE (nombre);
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);
ALTER TABLE public.product_last_sale ADD CONSTRAINT product_last_sale_pkey PRIMARY KEY (erp_product_id, erp_sucursal_id);
ALTER TABLE public.product_locations ADD CONSTRAINT product_locations_pkey PRIMARY KEY (id);
ALTER TABLE public.product_locations ADD CONSTRAINT product_locations_product_id_branch_id_key UNIQUE (product_id, branch_id);
ALTER TABLE public.product_precios_changelog ADD CONSTRAINT product_precios_changelog_pkey PRIMARY KEY (id);
ALTER TABLE public.product_precios_history ADD CONSTRAINT product_precios_history_pkey PRIMARY KEY (id);
ALTER TABLE public.product_precios ADD CONSTRAINT product_presentations_pkey PRIMARY KEY (id);
ALTER TABLE public.product_precios ADD CONSTRAINT product_presentations_product_id_id_presentacion_key UNIQUE (product_id, id_presentacion);
ALTER TABLE public.product_sales_monthly_agg ADD CONSTRAINT product_sales_monthly_agg_pkey PRIMARY KEY (year_month, branch_id, erp_product_id, presentacion);
ALTER TABLE public.product_sales_rollup ADD CONSTRAINT product_sales_rollup_pkey PRIMARY KEY (erp_product_id, erp_sucursal_id);
ALTER TABLE public.product_stock_params_history ADD CONSTRAINT product_stock_params_history_pkey PRIMARY KEY (id);
ALTER TABLE public.product_stock_params ADD CONSTRAINT product_stock_params_erp_product_id_erp_sucursal_id_key UNIQUE (erp_product_id, erp_sucursal_id);
ALTER TABLE public.product_stock_params ADD CONSTRAINT product_stock_params_pkey PRIMARY KEY (id);
ALTER TABLE public.products_changelog ADD CONSTRAINT products_changelog_pkey PRIMARY KEY (id);
ALTER TABLE public.products_sync_log ADD CONSTRAINT products_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedores_categorias ADD CONSTRAINT proveedores_categorias_nombre_key UNIQUE (nombre);
ALTER TABLE public.proveedores_categorias ADD CONSTRAINT proveedores_categorias_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_nit_key UNIQUE (nit);
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_pkey PRIMARY KEY (id);
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_dte_documents ADD CONSTRAINT purchase_dte_documents_codigo_generacion_key UNIQUE (codigo_generacion);
ALTER TABLE public.purchase_dte_documents ADD CONSTRAINT purchase_dte_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_dte_processed_messages ADD CONSTRAINT purchase_dte_processed_message_account_id_source_message_id_key UNIQUE (account_id, source_message_id);
ALTER TABLE public.purchase_dte_processed_messages ADD CONSTRAINT purchase_dte_processed_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_dedupe UNIQUE (account_id, source_message_id, filename);
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_receipt_items ADD CONSTRAINT purchase_receipt_items_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_receipt_items ADD CONSTRAINT purchase_receipt_items_receipt_id_linea_num_key UNIQUE (receipt_id, linea_num);
ALTER TABLE public.purchase_receipts ADD CONSTRAINT purchase_receipts_erp_purchase_id_erp_sucursal_id_key UNIQUE (erp_purchase_id, erp_sucursal_id);
ALTER TABLE public.purchase_receipts ADD CONSTRAINT purchase_receipts_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_sync_log ADD CONSTRAINT purchase_sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_id_module_key_unique UNIQUE (role_id, module_key);
ALTER TABLE public.roles ADD CONSTRAINT roles_name_key UNIQUE (name);
ALTER TABLE public.roles ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
ALTER TABLE public.ruta_locations ADD CONSTRAINT ruta_locations_pkey PRIMARY KEY (ruta_id);
ALTER TABLE public.ruta_pedidos ADD CONSTRAINT ruta_pedidos_pkey PRIMARY KEY (id);
ALTER TABLE public.ruta_pedidos ADD CONSTRAINT ruta_pedidos_ruta_pedido_suc_key UNIQUE (ruta_id, pedido_id, erp_sucursal_id);
ALTER TABLE public.rutas ADD CONSTRAINT rutas_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_alert_log ADD CONSTRAINT sales_alert_log_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_alert_log ADD CONSTRAINT sales_alert_log_unique UNIQUE (branch_id, alert_type, alert_key);
ALTER TABLE public.sales_daily_stats ADD CONSTRAINT sales_daily_stats_pkey PRIMARY KEY (date, branch_id);
ALTER TABLE public.sales_gap_resolutions ADD CONSTRAINT sales_gap_resolutions_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_invoice_changelog ADD CONSTRAINT sales_invoice_changelog_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT sales_invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT uq_invoice_items_linea UNIQUE (invoice_id, linea_num);
ALTER TABLE public.sales_invoice_resolutions ADD CONSTRAINT sales_invoice_resolutions_invoice_id_key UNIQUE (invoice_id);
ALTER TABLE public.sales_invoice_resolutions ADD CONSTRAINT sales_invoice_resolutions_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_codigo_generacion_key UNIQUE (codigo_generacion);
ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_erp_invoice_id_key UNIQUE (erp_invoice_id);
ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_null_resolutions ADD CONSTRAINT sales_null_resolutions_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_payment_confirmations ADD CONSTRAINT sales_payment_confirmations_pkey PRIMARY KEY (id);
ALTER TABLE public.schedule_coverage ADD CONSTRAINT schedule_coverage_employee_id_coverage_branch_id_week_start_key UNIQUE (employee_id, coverage_branch_id, week_start_date, day_of_week);
ALTER TABLE public.schedule_coverage ADD CONSTRAINT schedule_coverage_pkey PRIMARY KEY (id);
ALTER TABLE public.shifts ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);
ALTER TABLE public.stock_config ADD CONSTRAINT stock_config_pkey PRIMARY KEY (id);
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_erp_supplier_id_key UNIQUE (erp_supplier_id);
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
ALTER TABLE public.survey_bloques ADD CONSTRAINT survey_bloques_pkey PRIMARY KEY (id);
ALTER TABLE public.survey_preguntas ADD CONSTRAINT survey_preguntas_pkey PRIMARY KEY (id);
ALTER TABLE public.survey_responses ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);
ALTER TABLE public.survey_responses ADD CONSTRAINT survey_responses_survey_id_employee_id_key UNIQUE (survey_id, employee_id);
ALTER TABLE public.surveys ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);
ALTER TABLE public.sync_alert_log ADD CONSTRAINT sync_alert_log_domain_scope_key_alert_key_key UNIQUE (domain, scope_key, alert_key);
ALTER TABLE public.sync_alert_log ADD CONSTRAINT sync_alert_log_pkey PRIMARY KEY (id);
ALTER TABLE public.sync_log ADD CONSTRAINT sync_log_pkey PRIMARY KEY (id);
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_emp_date_unique UNIQUE (employee_id, work_date);
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_pkey PRIMARY KEY (id);
ALTER TABLE public.user_dashboard_prefs ADD CONSTRAINT user_dashboard_prefs_pkey PRIMARY KEY (user_id);
ALTER TABLE public.vacation_plan_headers ADD CONSTRAINT vacation_plan_headers_pkey PRIMARY KEY (id);
ALTER TABLE public.vacation_plan_headers ADD CONSTRAINT vacation_plan_headers_year_key UNIQUE (year);
ALTER TABLE public.vacation_plans ADD CONSTRAINT vacation_plans_pkey PRIMARY KEY (id);
ALTER TABLE public.ventas_monthly_stats ADD CONSTRAINT ventas_monthly_stats_pkey PRIMARY KEY (mes, branch_id, cod_vendedor);
ALTER TABLE public.ventas_perdidas ADD CONSTRAINT ventas_perdidas_pkey PRIMARY KEY (id);
ALTER TABLE public.wfm_snapshots ADD CONSTRAINT wfm_snapshots_pkey PRIMARY KEY (id);


-- ── Claves foraneas y CHECK (214) ───────────────────────────────────────────

ALTER TABLE public.announcements ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_current_level_check CHECK ((current_level = ANY (ARRAY[1, 2, 3])));
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE public.approval_requests ADD CONSTRAINT approval_requests_type_check CHECK ((type = ANY (ARRAY['PERMIT'::text, 'VACATION'::text, 'SHIFT_CHANGE'::text, 'OVERTIME'::text, 'ADVANCE'::text, 'CERTIFICATE'::text, 'DISABILITY'::text, 'VACATION_CHANGE'::text, 'SHIFT_EXCEPTION'::text, 'ANNULMENT_REQUEST'::text, 'PAYMENT_CHANGE_REQUEST'::text, 'VENDOR_CHANGE_REQUEST'::text])));
ALTER TABLE public.approval_requests ADD CONSTRAINT chk_approval_requests_status CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE public.attendance ADD CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_type_check CHECK ((type = ANY (ARRAY['IN'::text, 'OUT'::text, 'OUT_LUNCH'::text, 'IN_LUNCH'::text, 'OUT_LACTATION'::text, 'IN_LACTATION'::text, 'OUT_EARLY'::text, 'OUT_BUSINESS'::text, 'IN_RETURN'::text, 'IN_EXTRA'::text, 'OUT_EXTRA'::text])));
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_severity_check CHECK ((severity = ANY (ARRAY['INFO'::text, 'WARNING'::text, 'CRITICAL'::text])));
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_source_check CHECK ((source = ANY (ARRAY['ADMIN_PANEL'::text, 'KIOSK'::text, 'SYSTEM'::text])));
ALTER TABLE public.audit_logs ADD CONSTRAINT fk_audit_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.branch_documents ADD CONSTRAINT branch_documents_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.branch_expenses ADD CONSTRAINT branch_expenses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.branches ADD CONSTRAINT branches_type_check CHECK ((type = ANY (ARRAY['FARMACIA'::text, 'BODEGA'::text, 'ADMINISTRATIVA'::text, 'EXTERNA'::text])));
ALTER TABLE public.conteo_inventario_item_history ADD CONSTRAINT conteo_inventario_item_history_contado_por_fkey FOREIGN KEY (contado_por) REFERENCES employees(id);
ALTER TABLE public.conteo_inventario_item_history ADD CONSTRAINT conteo_inventario_item_history_item_id_fkey FOREIGN KEY (item_id) REFERENCES conteo_inventario_items(id) ON DELETE CASCADE;
ALTER TABLE public.conteo_inventario_item_history ADD CONSTRAINT conteo_item_history_evento_check CHECK ((evento = ANY (ARRAY['CAPTURA'::text, 'EDICION'::text, 'BORRADO'::text, 'RECUENTO'::text, 'LOTE'::text, 'CIERRE'::text])));
ALTER TABLE public.conteo_inventario_items ADD CONSTRAINT conteo_inventario_items_contado_por_fkey FOREIGN KEY (contado_por) REFERENCES employees(id);
ALTER TABLE public.conteo_inventario_items ADD CONSTRAINT conteo_inventario_items_conteo_id_fkey FOREIGN KEY (conteo_id) REFERENCES conteos_inventario(id) ON DELETE CASCADE;
ALTER TABLE public.conteo_inventario_items ADD CONSTRAINT conteo_inventario_items_estado_item_check CHECK ((estado_item = ANY (ARRAY['PENDIENTE'::text, 'CONTADO'::text, 'SIN_UBICAR'::text])));
ALTER TABLE public.conteo_inventario_items ADD CONSTRAINT conteo_items_recontado_por_fkey FOREIGN KEY (recontado_por) REFERENCES employees(id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_ajuste_erp_por_fkey FOREIGN KEY (ajuste_erp_por) REFERENCES employees(id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES employees(id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_finalizado_por_fkey FOREIGN KEY (finalizado_por) REFERENCES employees(id);
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_scope_type_check CHECK ((scope_type = ANY (ARRAY['TOTAL'::text, 'LABORATORIO'::text, 'BAJO_RECETA'::text, 'MANUAL'::text, 'CICLICO'::text])));
ALTER TABLE public.conteos_inventario ADD CONSTRAINT conteos_inventario_status_check CHECK ((status = ANY (ARRAY['BORRADOR'::text, 'EN_PROGRESO'::text, 'FINALIZADO'::text, 'CERRADO'::text])));
ALTER TABLE public.cotizacion_items ADD CONSTRAINT cotizacion_items_cotizacion_id_fkey FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id) ON DELETE CASCADE;
ALTER TABLE public.cotizacion_items ADD CONSTRAINT fk_ci_presentacion FOREIGN KEY (presentacion_id) REFERENCES presentaciones(id) ON DELETE SET NULL;
ALTER TABLE public.cotizacion_items ADD CONSTRAINT fk_ci_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE public.cotizaciones ADD CONSTRAINT chk_cotizaciones_status CHECK ((status = ANY (ARRAY['ACTIVA'::text, 'ANULADA'::text, 'CERRADA'::text])));
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_document_type_check CHECK ((document_type = ANY (ARRAY['CCF'::text, 'COF'::text])));
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_payment_type_check CHECK ((payment_type = ANY (ARRAY['EFECTIVO'::text, 'TARJETA'::text, 'TRANSFERENCIA'::text, 'CHEQUE'::text])));
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_status_check CHECK ((status = ANY (ARRAY['ACTIVA'::text, 'ANULADA'::text])));
ALTER TABLE public.cotizaciones ADD CONSTRAINT fk_cot_created_by FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_blister_check CHECK ((blister > 0));
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_dispatch_id_presentacion_fkey FOREIGN KEY (dispatch_id_presentacion) REFERENCES presentaciones(id);
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_dispatch_multiplo_check CHECK ((dispatch_multiplo >= 1));
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_erp_product_id_fkey FOREIGN KEY (erp_product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.dispatch_rules ADD CONSTRAINT dispatch_rules_multiplo_check CHECK ((multiplo > 0));
ALTER TABLE public.education_catalog_entries ADD CONSTRAINT education_catalog_entries_category_check CHECK ((category = ANY (ARRAY['BACHILLERATO_TECNICO_ESPECIALIDAD'::text, 'TECNICO_SUPERIOR_ESPECIALIDAD'::text, 'PROFESION_UNIVERSITARIA'::text, 'MAESTRIA_POSTGRADO'::text, 'CURSO_HABILIDAD'::text, 'INSTITUCION_CAPACITACION'::text, 'ENFERMEDAD_CRONICA'::text, 'TIPO_DISCAPACIDAD'::text])));
ALTER TABLE public.email_sync_accounts ADD CONSTRAINT email_sync_accounts_provider_check CHECK ((provider = 'gmail'::text));
ALTER TABLE public.email_sync_log ADD CONSTRAINT email_sync_log_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_sync_accounts(id);
ALTER TABLE public.employee_branches ADD CONSTRAINT employee_branches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.employee_branches ADD CONSTRAINT employee_branches_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_documents ADD CONSTRAINT employee_documents_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_documents ADD CONSTRAINT employee_documents_event_id_fkey FOREIGN KEY (event_id) REFERENCES employee_events(id) ON DELETE SET NULL;
ALTER TABLE public.employee_events ADD CONSTRAINT employee_events_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_rosters ADD CONSTRAINT chk_employee_rosters_status CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'APPROVED'::text])));
ALTER TABLE public.employee_rosters ADD CONSTRAINT employee_rosters_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.employee_rosters ADD CONSTRAINT employee_rosters_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'LOCKED'::text])));
ALTER TABLE public.employees ADD CONSTRAINT chk_employees_dui_format CHECK (((dui IS NULL) OR (dui ~ '^\d{8}-\d$'::text)));
ALTER TABLE public.employees ADD CONSTRAINT chk_employees_status CHECK ((status = ANY (ARRAY['ACTIVO'::text, 'INACTIVO'::text, 'BAJA'::text, 'LIQUIDADO'::text, 'SUSPENDIDO'::text])));
ALTER TABLE public.employees ADD CONSTRAINT employees_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE public.employees ADD CONSTRAINT employees_contract_temporal_legal_basis_check CHECK (((contract_temporal_legal_basis IS NULL) OR (contract_temporal_legal_basis = ANY (ARRAY['TRANSITORIO_EVENTUAL'::text, 'TERMINACION_NEGOCIO'::text]))));
ALTER TABLE public.employees ADD CONSTRAINT employees_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE public.employees ADD CONSTRAINT employees_secondary_role_id_fkey FOREIGN KEY (secondary_role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD CONSTRAINT employees_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE public.erp_sucursal_map ADD CONSTRAINT erp_sucursal_map_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.holidays ADD CONSTRAINT holidays_type_check CHECK ((type = ANY (ARRAY['NATIONAL'::text, 'LOCAL'::text])));
ALTER TABLE public.inventory ADD CONSTRAINT inventory_erp_product_id_fkey FOREIGN KEY (erp_product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE public.kiosk_credentials ADD CONSTRAINT kiosk_credentials_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.kiosk_credentials ADD CONSTRAINT kiosk_credentials_rotated_by_fkey FOREIGN KEY (rotated_by) REFERENCES employees(id);
ALTER TABLE public.kiosk_devices ADD CONSTRAINT kiosk_devices_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.kiosk_devices ADD CONSTRAINT kiosk_devices_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])));
ALTER TABLE public.lab_locations ADD CONSTRAINT lab_locations_lab_id_fkey FOREIGN KEY (lab_id) REFERENCES laboratorios(id) ON DELETE CASCADE;
ALTER TABLE public.minmax_change_requests ADD CONSTRAINT mmcr_pair_valid CHECK (((requested_min IS NULL) OR (requested_max IS NULL) OR ((requested_min = 0) AND (requested_max <= 1)) OR ((requested_min >= 1) AND (requested_max > requested_min))));
ALTER TABLE public.minmax_change_requests ADD CONSTRAINT mmcr_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public.minmax_ignored ADD CONSTRAINT minmax_ignored_erp_product_id_fkey FOREIGN KEY (erp_product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.minmax_sync_log ADD CONSTRAINT minmax_sync_log_source_check CHECK ((source = ANY (ARRAY['sync-erp-minmax'::text, 'auto-calculate-minmax'::text])));
ALTER TABLE public.module_locks ADD CONSTRAINT module_locks_expires_after_locked CHECK ((expires_at > locked_at));
ALTER TABLE public.module_locks ADD CONSTRAINT module_locks_locked_by_id_fkey FOREIGN KEY (locked_by_id) REFERENCES employees(id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.orphan_objects_registry ADD CONSTRAINT orphan_objects_registry_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'confirmed_orphan'::text, 'false_positive'::text, 'resolved'::text])));
ALTER TABLE public.overtime_bank ADD CONSTRAINT overtime_bank_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.overtime_bank ADD CONSTRAINT overtime_bank_period_id_fkey FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE SET NULL;
ALTER TABLE public.overtime_bank ADD CONSTRAINT overtime_bank_subtype_check CHECK ((subtype = ANY (ARRAY['DIURNAL'::text, 'NOCTURNAL'::text])));
ALTER TABLE public.overtime_bank ADD CONSTRAINT overtime_bank_type_check CHECK ((type = ANY (ARRAY['EARNED'::text, 'PAID'::text, 'TIME_OFF'::text])));
ALTER TABLE public.payroll_entries ADD CONSTRAINT payroll_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE public.payroll_entries ADD CONSTRAINT payroll_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_apoyo ADD CONSTRAINT pedido_apoyo_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id);
ALTER TABLE public.pedido_apoyo ADD CONSTRAINT pedido_apoyo_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_item_eventos ADD CONSTRAINT pedido_item_eventos_hecho_por_fkey FOREIGN KEY (hecho_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_item_eventos ADD CONSTRAINT pedido_item_eventos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_item_eventos ADD CONSTRAINT pedido_item_eventos_pedido_item_id_fkey FOREIGN KEY (pedido_item_id) REFERENCES pedido_items(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_confirmado_suc_por_fkey FOREIGN KEY (confirmado_suc_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_erp_presentacion_id_fkey FOREIGN KEY (erp_presentacion_id) REFERENCES presentaciones(id);
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_erp_product_id_fkey FOREIGN KEY (erp_product_id) REFERENCES products(id);
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_rechazado_por_fkey FOREIGN KEY (rechazado_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_items ADD CONSTRAINT pedido_items_status_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'recibido'::text, 'con_diferencia'::text, 'anulado'::text])));
ALTER TABLE public.pedido_pausa_historial ADD CONSTRAINT pedido_pausa_historial_pausado_por_fkey FOREIGN KEY (pausado_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_pausa_historial ADD CONSTRAINT pedido_pausa_historial_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_pausa_historial ADD CONSTRAINT pedido_pausa_historial_reanudado_por_fkey FOREIGN KEY (reanudado_por) REFERENCES auth.users(id);
ALTER TABLE public.pedido_recepcion_extras ADD CONSTRAINT pedido_recepcion_extras_cantidad_check CHECK ((cantidad > 0));
ALTER TABLE public.pedido_recepcion_extras ADD CONSTRAINT pedido_recepcion_extras_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_recepcion_extras ADD CONSTRAINT pre_product_fk FOREIGN KEY (erp_product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_recepcion_firmas ADD CONSTRAINT pedido_recepcion_firmas_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_recepcion_firmas ADD CONSTRAINT prf_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_confirmado_correccion_por_fkey FOREIGN KEY (confirmado_correccion_por) REFERENCES employees(id);
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_corregido_bodega_por_fkey FOREIGN KEY (corregido_bodega_por) REFERENCES employees(id);
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_diferencias_reportadas_por_fkey FOREIGN KEY (diferencias_reportadas_por) REFERENCES employees(id);
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_finalizado_por_fkey FOREIGN KEY (finalizado_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_iniciado_por_fkey FOREIGN KEY (iniciado_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_llegada_fisica_por_fkey FOREIGN KEY (llegada_fisica_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_reanudado_por_fkey FOREIGN KEY (reanudado_por) REFERENCES auth.users(id);
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_recibido_erp_por_fkey FOREIGN KEY (recibido_erp_por) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedido_sucursal_status ADD CONSTRAINT pedido_sucursal_status_reenvio_por_fkey FOREIGN KEY (reenvio_por) REFERENCES employees(id);
ALTER TABLE public.pedidos_snapshots ADD CONSTRAINT pedidos_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_status_check CHECK ((status = ANY (ARRAY['confirmado'::text, 'enviado'::text, 'parcial'::text, 'completado'::text, 'anulado'::text])));
ALTER TABLE public.practicantes ADD CONSTRAINT practicantes_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.practicantes ADD CONSTRAINT practicantes_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE public.practicantes ADD CONSTRAINT practicantes_estado_check CHECK ((estado = ANY (ARRAY['ACTIVO'::text, 'FINALIZADO'::text, 'CANCELADO'::text])));
ALTER TABLE public.practicantes ADD CONSTRAINT practicantes_fechas_check CHECK ((fecha_fin > fecha_inicio));
ALTER TABLE public.practicantes ADD CONSTRAINT practicantes_supervisor_employee_id_fkey FOREIGN KEY (supervisor_employee_id) REFERENCES employees(id);
ALTER TABLE public.product_active_principles ADD CONSTRAINT product_active_principles_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_locations ADD CONSTRAINT product_locations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.product_locations ADD CONSTRAINT product_locations_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_precios_changelog ADD CONSTRAINT fk_ppc_presentacion FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id) ON DELETE CASCADE;
ALTER TABLE public.product_precios_changelog ADD CONSTRAINT fk_ppc_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_precios_history ADD CONSTRAINT fk_pph_presentacion FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id) ON DELETE CASCADE;
ALTER TABLE public.product_precios_history ADD CONSTRAINT fk_pph_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.product_precios ADD CONSTRAINT product_precios_id_presentacion_fkey FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id);
ALTER TABLE public.product_precios ADD CONSTRAINT product_presentations_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public.product_stock_params ADD CONSTRAINT chk_min_lt_max CHECK (((min_units IS NULL) OR (max_units IS NULL) OR ((min_units = 0) AND (max_units <= 1)) OR ((min_units >= 1) AND (max_units > min_units))));
ALTER TABLE public.product_stock_params ADD CONSTRAINT psp_calc_max_gte_min CHECK (((min_units IS NULL) OR (max_units IS NULL) OR (max_units >= min_units)));
ALTER TABLE public.product_stock_params ADD CONSTRAINT psp_draft_pair_valid CHECK (((draft_min IS NULL) OR (draft_max IS NULL) OR ((draft_min = 0) AND (draft_max <= 1)) OR ((draft_min >= 1) AND (draft_max > draft_min))));
ALTER TABLE public.product_stock_params ADD CONSTRAINT psp_manual_max_gte_min CHECK (((manual_min IS NULL) OR (manual_max IS NULL) OR (manual_max >= manual_min)));
ALTER TABLE public.products_changelog ADD CONSTRAINT fk_pc_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE public.products ADD CONSTRAINT products_laboratorio_id_fkey FOREIGN KEY (laboratorio_id) REFERENCES laboratorios(id);
ALTER TABLE public.products ADD CONSTRAINT products_oculto_por_fkey FOREIGN KEY (oculto_por) REFERENCES employees(id);
ALTER TABLE public.proveedores_categorias ADD CONSTRAINT proveedores_categorias_clase_check CHECK ((clase = ANY (ARRAY['costo'::text, 'gasto_operativo'::text, 'gasto_admin'::text, 'otro'::text])));
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES proveedores_categorias(id);
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_check CHECK (((nit IS NOT NULL) OR (dui IS NOT NULL)));
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_source_check CHECK ((source = ANY (ARRAY['dte'::text, 'manual'::text])));
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_laboratorio_id_fkey FOREIGN KEY (laboratorio_id) REFERENCES laboratorios(id);
ALTER TABLE public.proveedores ADD CONSTRAINT proveedores_meses_devolucion_check CHECK (((meses_devolucion IS NULL) OR (meses_devolucion >= 0)));
ALTER TABLE public.purchase_dte_documents ADD CONSTRAINT purchase_dte_documents_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_sync_accounts(id);
ALTER TABLE public.purchase_dte_documents ADD CONSTRAINT purchase_dte_documents_documento_relacionado_id_fkey FOREIGN KEY (documento_relacionado_id) REFERENCES purchase_dte_documents(id);
ALTER TABLE public.purchase_dte_documents ADD CONSTRAINT purchase_dte_documents_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores_maestro(id);
ALTER TABLE public.purchase_dte_documents ADD CONSTRAINT purchase_dte_documents_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE public.purchase_dte_processed_messages ADD CONSTRAINT purchase_dte_processed_messages_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_sync_accounts(id);
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_account_id_fkey FOREIGN KEY (account_id) REFERENCES email_sync_accounts(id);
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_kind_check CHECK ((kind = ANY (ARRAY['orphan_pdf'::text, 'invalid_json'::text, 'invalidacion_pendiente'::text, 'orphan_zip'::text])));
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_matched_document_id_fkey FOREIGN KEY (matched_document_id) REFERENCES purchase_dte_documents(id);
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES employees(id);
ALTER TABLE public.purchase_dte_review_queue ADD CONSTRAINT purchase_dte_review_queue_status_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'emparejado'::text, 'descartado'::text, 'confirmado'::text])));
ALTER TABLE public.purchase_receipt_items ADD CONSTRAINT purchase_receipt_items_erp_product_id_fkey FOREIGN KEY (erp_product_id) REFERENCES products(id);
ALTER TABLE public.purchase_receipt_items ADD CONSTRAINT purchase_receipt_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_receipts ADD CONSTRAINT purchase_receipts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.purchase_receipts ADD CONSTRAINT purchase_receipts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_scope_check CHECK ((scope = ANY (ARRAY['ALL'::text, 'BRANCH'::text])));
ALTER TABLE public.roles ADD CONSTRAINT roles_parent_role_id_fkey FOREIGN KEY (parent_role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE public.roles ADD CONSTRAINT roles_scope_check CHECK ((scope = ANY (ARRAY['GLOBAL'::text, 'BRANCH'::text])));
ALTER TABLE public.roles ADD CONSTRAINT roles_secondary_parent_role_id_fkey FOREIGN KEY (secondary_parent_role_id) REFERENCES roles(id) ON DELETE SET NULL;
ALTER TABLE public.ruta_locations ADD CONSTRAINT ruta_locations_ruta_id_fkey FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE CASCADE;
ALTER TABLE public.ruta_pedidos ADD CONSTRAINT ruta_pedidos_confirmado_suc_por_fkey FOREIGN KEY (confirmado_suc_por) REFERENCES auth.users(id);
ALTER TABLE public.ruta_pedidos ADD CONSTRAINT ruta_pedidos_entregado_por_fkey FOREIGN KEY (entregado_por) REFERENCES auth.users(id);
ALTER TABLE public.ruta_pedidos ADD CONSTRAINT ruta_pedidos_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
ALTER TABLE public.ruta_pedidos ADD CONSTRAINT ruta_pedidos_ruta_id_fkey FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE CASCADE;
ALTER TABLE public.rutas ADD CONSTRAINT rutas_conductor_id_fkey FOREIGN KEY (conductor_id) REFERENCES auth.users(id);
ALTER TABLE public.rutas ADD CONSTRAINT rutas_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.rutas ADD CONSTRAINT rutas_status_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'en_ruta'::text, 'completada'::text, 'con_alerta'::text])));
ALTER TABLE public.sales_alert_log ADD CONSTRAINT sales_alert_log_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.sales_gap_resolutions ADD CONSTRAINT fk_sgr_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.sales_invoice_changelog ADD CONSTRAINT fk_sic_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.sales_invoice_changelog ADD CONSTRAINT sales_invoice_changelog_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id);
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT fk_sii_presentacion FOREIGN KEY (id_presentacion) REFERENCES presentaciones(id) ON DELETE SET NULL;
ALTER TABLE public.sales_invoice_items ADD CONSTRAINT sales_invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.sales_invoice_resolutions ADD CONSTRAINT fk_resolution_invoice FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.sales_invoices ADD CONSTRAINT sales_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.sales_payment_confirmations ADD CONSTRAINT sales_payment_confirmations_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_coverage ADD CONSTRAINT schedule_coverage_coverage_branch_id_fkey FOREIGN KEY (coverage_branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_coverage ADD CONSTRAINT schedule_coverage_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));
ALTER TABLE public.schedule_coverage ADD CONSTRAINT schedule_coverage_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_coverage ADD CONSTRAINT schedule_coverage_home_branch_id_fkey FOREIGN KEY (home_branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE public.stock_config ADD CONSTRAINT single_row CHECK ((id = 1));
ALTER TABLE public.stock_config ADD CONSTRAINT stock_config_outlier_percentile_check CHECK (((outlier_percentile >= 50) AND (outlier_percentile <= 100)));
ALTER TABLE public.survey_bloques ADD CONSTRAINT survey_bloques_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE;
ALTER TABLE public.survey_preguntas ADD CONSTRAINT survey_preguntas_bloque_id_fkey FOREIGN KEY (bloque_id) REFERENCES survey_bloques(id) ON DELETE SET NULL;
ALTER TABLE public.survey_preguntas ADD CONSTRAINT survey_preguntas_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE;
ALTER TABLE public.survey_responses ADD CONSTRAINT survey_responses_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.survey_responses ADD CONSTRAINT survey_responses_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES surveys(id) ON DELETE CASCADE;
ALTER TABLE public.survey_responses ADD CONSTRAINT survey_responses_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES employees(id);
ALTER TABLE public.surveys ADD CONSTRAINT surveys_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE public.sync_log ADD CONSTRAINT fk_synclog_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_scheduled_shift_id_fkey FOREIGN KEY (scheduled_shift_id) REFERENCES shifts(id);
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'DISPUTED'::text])));
ALTER TABLE public.user_dashboard_prefs ADD CONSTRAINT user_dashboard_prefs_theme_check CHECK (((theme IS NULL) OR (theme = ANY (ARRAY['liquid'::text, 'dark'::text, 'solid'::text, 'solid-dark'::text]))));
ALTER TABLE public.user_dashboard_prefs ADD CONSTRAINT user_dashboard_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.vacation_plans ADD CONSTRAINT vacation_plans_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.vacation_plans ADD CONSTRAINT vacation_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES employees(id);
ALTER TABLE public.vacation_plans ADD CONSTRAINT vacation_plans_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE public.vacation_plans ADD CONSTRAINT vacation_plans_plan_header_id_fkey FOREIGN KEY (plan_header_id) REFERENCES vacation_plan_headers(id) ON DELETE SET NULL;
ALTER TABLE public.vacation_plans ADD CONSTRAINT vacation_plans_status_check CHECK ((status = ANY (ARRAY['PLANNED'::text, 'CONFIRMED'::text, 'TAKEN'::text, 'CANCELLED'::text])));
ALTER TABLE public.ventas_perdidas ADD CONSTRAINT ventas_perdidas_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE public.ventas_perdidas ADD CONSTRAINT ventas_perdidas_cantidad_check CHECK ((cantidad > 0));
ALTER TABLE public.ventas_perdidas ADD CONSTRAINT ventas_perdidas_erp_product_id_fkey FOREIGN KEY (erp_product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE public.ventas_perdidas ADD CONSTRAINT ventas_perdidas_reportado_por_fkey FOREIGN KEY (reportado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.ventas_perdidas ADD CONSTRAINT ventas_perdidas_status_check CHECK ((status = ANY (ARRAY['pendiente'::text, 'procesado'::text])));
ALTER TABLE public.wfm_snapshots ADD CONSTRAINT fk_wfm_snapshots_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;


-- ── Indices (los que no respaldan un constraint) (224) ──────────────────────

CREATE INDEX approval_requests_created_at_idx ON public.approval_requests USING btree (created_at DESC);
CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);
CREATE INDEX audit_logs_branch_id_idx ON public.audit_logs USING btree (branch_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX audit_logs_severity_idx ON public.audit_logs USING btree (severity);
CREATE INDEX audit_logs_source_idx ON public.audit_logs USING btree (source);
CREATE INDEX audit_logs_target_id_idx ON public.audit_logs USING btree (target_id);
CREATE INDEX audit_logs_user_id_idx ON public.audit_logs USING btree (user_id);
CREATE UNIQUE INDEX customers_name_norm_idx ON public.customers USING btree (upper(TRIM(BOTH FROM name)));
CREATE UNIQUE INDEX customers_nit_idx ON public.customers USING btree (nit) WHERE (nit IS NOT NULL);
CREATE UNIQUE INDEX employees_code_norm_key ON public.employees USING btree (upper(TRIM(BOTH FROM code))) WHERE ((code IS NOT NULL) AND (TRIM(BOTH FROM code) <> ''::text));
CREATE UNIQUE INDEX employees_code_unique ON public.employees USING btree (code);
CREATE UNIQUE INDEX employees_dui_unique ON public.employees USING btree (dui) WHERE (dui IS NOT NULL);
CREATE INDEX idx_announcements_created_by ON public.announcements USING btree (created_by);
CREATE INDEX idx_approval_requests_approver ON public.approval_requests USING btree (approver_id) WHERE (approver_id IS NOT NULL);
CREATE INDEX idx_approval_requests_employee ON public.approval_requests USING btree (employee_id);
CREATE INDEX idx_approval_requests_status ON public.approval_requests USING btree (status);
CREATE INDEX idx_approval_requests_type ON public.approval_requests USING btree (type);
CREATE INDEX idx_attendance_employee_timestamp ON public.attendance USING btree (employee_id, "timestamp");
CREATE INDEX idx_backup_sync_log_checked_at ON public.backup_sync_log USING btree (checked_at DESC);
CREATE INDEX idx_branch_documents_branch ON public.branch_documents USING btree (branch_id);
CREATE INDEX idx_branch_expenses_branch ON public.branch_expenses USING btree (branch_id);
CREATE INDEX idx_changelog_branch_detected ON public.sales_invoice_changelog USING btree (branch_id, detected_at DESC);
CREATE INDEX idx_changelog_detected ON public.sales_invoice_changelog USING btree (detected_at DESC);
CREATE INDEX idx_changelog_invoice ON public.sales_invoice_changelog USING btree (invoice_id);
CREATE INDEX idx_conteo_item_history_item ON public.conteo_inventario_item_history USING btree (item_id);
CREATE INDEX idx_conteo_item_history_item_id ON public.conteo_inventario_item_history USING btree (item_id);
CREATE INDEX idx_conteo_items_conteo_id ON public.conteo_inventario_items USING btree (conteo_id);
CREATE INDEX idx_conteo_items_erp_product ON public.conteo_inventario_items USING btree (erp_product_id);
CREATE INDEX idx_conteo_items_source_sync_key ON public.conteo_inventario_items USING btree (source_sync_key);
CREATE INDEX idx_conteos_branch_id ON public.conteos_inventario USING btree (branch_id);
CREATE INDEX idx_cotizacion_items_cotizacion ON public.cotizacion_items USING btree (cotizacion_id);
CREATE INDEX idx_cotizacion_items_presentacion ON public.cotizacion_items USING btree (presentacion_id);
CREATE INDEX idx_cotizacion_items_product ON public.cotizacion_items USING btree (product_id) WHERE (product_id IS NOT NULL);
CREATE INDEX idx_cotizaciones_branch ON public.cotizaciones USING btree (branch_id);
CREATE INDEX idx_cotizaciones_created_by ON public.cotizaciones USING btree (created_by);
CREATE INDEX idx_cotizaciones_customer ON public.cotizaciones USING btree (customer_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX idx_cotizaciones_fecha ON public.cotizaciones USING btree (fecha DESC);
CREATE INDEX idx_cotizaciones_status ON public.cotizaciones USING btree (status);
CREATE INDEX idx_customers_erp_id ON public.customers USING btree (erp_id) WHERE (erp_id IS NOT NULL);
CREATE INDEX idx_dispatch_rules_pres ON public.dispatch_rules USING btree (dispatch_id_presentacion);
CREATE INDEX idx_dispatch_rules_product ON public.dispatch_rules USING btree (erp_product_id);
CREATE INDEX idx_email_sync_log_account ON public.email_sync_log USING btree (account_id);
CREATE INDEX idx_email_sync_log_checked_at ON public.email_sync_log USING btree (checked_at DESC);
CREATE INDEX idx_employee_branches_branch ON public.employee_branches USING btree (branch_id);
CREATE INDEX idx_employee_branches_employee ON public.employee_branches USING btree (employee_id);
CREATE INDEX idx_employee_documents_employee ON public.employee_documents USING btree (employee_id);
CREATE INDEX idx_employee_documents_event ON public.employee_documents USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX idx_employees_branch ON public.employees USING btree (branch_id);
CREATE UNIQUE INDEX idx_employees_kiosk_pin ON public.employees USING btree (kiosk_pin);
CREATE INDEX idx_employees_role ON public.employees USING btree (role_id);
CREATE INDEX idx_employees_secondary_role ON public.employees USING btree (secondary_role_id) WHERE (secondary_role_id IS NOT NULL);
CREATE INDEX idx_employees_shift ON public.employees USING btree (shift_id) WHERE (shift_id IS NOT NULL);
CREATE INDEX idx_employees_system_role ON public.employees USING btree (system_role) WHERE (system_role IS NOT NULL);
CREATE INDEX idx_erp_sucursal_map_branch_id ON public.erp_sucursal_map USING btree (branch_id);
CREATE INDEX idx_events_emp_date ON public.employee_events USING btree (employee_id, date);
CREATE INDEX idx_igmv_cat ON public.inventory_grouped_mv USING btree (tipo_medicamento) WHERE (tipo_medicamento IS NOT NULL);
CREATE INDEX idx_igmv_desc_norm_trgm ON public.inventory_grouped_mv USING gin (norm_search(descripcion) gin_trgm_ops);
CREATE INDEX idx_igmv_desc_trgm ON public.inventory_grouped_mv USING gin (descripcion gin_trgm_ops);
CREATE INDEX idx_igmv_lab ON public.inventory_grouped_mv USING btree (laboratorio_id) WHERE (laboratorio_id IS NOT NULL);
CREATE INDEX idx_igmv_proximos ON public.inventory_grouped_mv USING btree (soonest_active_venc) WHERE (soonest_active_venc IS NOT NULL);
CREATE INDEX idx_igmv_sucursal ON public.inventory_grouped_mv USING btree (erp_sucursal_id);
CREATE INDEX idx_igmv_venc ON public.inventory_grouped_mv USING btree (earliest_venc) WHERE (earliest_venc IS NOT NULL);
CREATE INDEX idx_inventory_product ON public.inventory USING btree (erp_product_id);
CREATE INDEX idx_inventory_proximos ON public.inventory USING btree (is_vencidos, fecha_vencimiento, erp_sucursal_id, erp_product_id) WHERE ((is_vencidos = false) AND (fecha_vencimiento IS NOT NULL));
CREATE INDEX idx_inventory_stock_pos ON public.inventory USING btree (erp_product_id, erp_sucursal_id) WHERE (cantidad > 0);
CREATE INDEX idx_inventory_sucursal ON public.inventory USING btree (erp_sucursal_id, is_vencidos);
CREATE INDEX idx_inventory_sync_log_venc_synced ON public.inventory_sync_log USING btree (is_vencidos, synced_at DESC);
CREATE INDEX idx_kiosk_devices_branch ON public.kiosk_devices USING btree (branch_id);
CREATE INDEX idx_kiosk_pin_attempts_device_time ON public.kiosk_pin_attempts USING btree (device_id, created_at DESC);
CREATE INDEX idx_login_rate_limit_ip_time ON public.login_rate_limit USING btree (client_ip, created_at);
CREATE INDEX idx_minmax_ignored_product ON public.minmax_ignored USING btree (erp_product_id);
CREATE INDEX idx_minmax_sync_log_checked_at ON public.minmax_sync_log USING btree (checked_at DESC);
CREATE INDEX idx_module_locks_key_exp ON public.module_locks USING btree (module_key, expires_at DESC);
CREATE INDEX idx_module_locks_locked_by ON public.module_locks USING btree (locked_by_id);
CREATE UNIQUE INDEX idx_mv_stock_analysis_lookup ON public.mv_stock_analysis USING btree (erp_sucursal_id, erp_product_id);
CREATE INDEX idx_mv_stock_analysis_sucursal ON public.mv_stock_analysis USING btree (erp_sucursal_id);
CREATE INDEX idx_notifications_created ON public.notifications USING btree (created_at);
CREATE INDEX idx_notifications_recipient ON public.notifications USING btree (recipient_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (recipient_id) WHERE (read_at IS NULL);
CREATE INDEX idx_pap_product_id ON public.product_active_principles USING btree (product_id);
CREATE INDEX idx_payment_confirmations_invoice ON public.sales_payment_confirmations USING btree (invoice_id);
CREATE INDEX idx_payroll_entries_employee ON public.payroll_entries USING btree (employee_id);
CREATE INDEX idx_pc_product ON public.products_changelog USING btree (product_id, detected_at DESC);
CREATE INDEX idx_pedido_items_erp_pres ON public.pedido_items USING btree (erp_presentacion_id);
CREATE INDEX idx_pedido_items_pedido ON public.pedido_items USING btree (pedido_id);
CREATE INDEX idx_pedido_items_pedido_status ON public.pedido_items USING btree (pedido_id, status);
CREATE INDEX idx_pedido_items_product ON public.pedido_items USING btree (erp_product_id);
CREATE INDEX idx_pedido_items_sucursal ON public.pedido_items USING btree (erp_sucursal_id);
CREATE INDEX idx_pedido_suc_status_pedido ON public.pedido_sucursal_status USING btree (pedido_id);
CREATE INDEX idx_pedidos_created_at ON public.pedidos USING btree (created_at DESC);
CREATE INDEX idx_pedidos_status ON public.pedidos USING btree (status);
CREATE INDEX idx_pie_item ON public.pedido_item_eventos USING btree (pedido_item_id);
CREATE INDEX idx_pie_pedido ON public.pedido_item_eventos USING btree (pedido_id, erp_sucursal_id);
CREATE INDEX idx_pls_product ON public.product_last_sale USING btree (erp_product_id);
CREATE INDEX idx_pp_activo_product_vineta_costo ON public.product_precios USING btree (product_id, vineta, costo) WHERE (activo = true);
CREATE INDEX idx_pp_factor_lookup ON public.product_precios USING btree (product_id, id_presentacion) INCLUDE (factor);
CREATE INDEX idx_ppc_product ON public.product_precios_changelog USING btree (product_id, detected_at DESC);
CREATE INDEX idx_pph_active ON public.product_precios_history USING btree (product_id, id_presentacion) WHERE (valid_until IS NULL);
CREATE INDEX idx_pph_lookup ON public.product_precios_history USING btree (product_id, id_presentacion, valid_from DESC);
CREATE INDEX idx_pph_pedido_suc ON public.pedido_pausa_historial USING btree (pedido_id, erp_sucursal_id);
CREATE INDEX idx_practicantes_branch_id ON public.practicantes USING btree (branch_id);
CREATE INDEX idx_practicantes_supervisor ON public.practicantes USING btree (supervisor_employee_id);
CREATE INDEX idx_pre_pedido ON public.pedido_recepcion_extras USING btree (pedido_id);
CREATE INDEX idx_pre_suc ON public.pedido_recepcion_extras USING btree (pedido_id, erp_sucursal_id);
CREATE INDEX idx_precios_history_pres_dates ON public.product_precios_history USING btree (id_presentacion, valid_from, valid_until);
CREATE INDEX idx_prf_pedido ON public.pedido_recepcion_firmas USING btree (pedido_id);
CREATE INDEX idx_product_locations_branch ON public.product_locations USING btree (branch_id);
CREATE INDEX idx_product_precios_changelog_pres ON public.product_precios_changelog USING btree (id_presentacion);
CREATE INDEX idx_product_precios_history_pres ON public.product_precios_history USING btree (id_presentacion);
CREATE INDEX idx_product_precios_presentacion ON public.product_precios USING btree (id_presentacion);
CREATE INDEX idx_products_filters ON public.products USING btree (activo, laboratorio_id, tipo_medicamento);
CREATE INDEX idx_products_laboratorio ON public.products USING btree (laboratorio_id) WHERE (laboratorio_id IS NOT NULL);
CREATE INDEX idx_products_nombre_norm_trgm ON public.products USING gin (nombre_norm gin_trgm_ops);
CREATE INDEX idx_products_nombre_trgm ON public.products USING gin (nombre gin_trgm_ops);
CREATE INDEX idx_products_oculto_por ON public.products USING btree (oculto_por) WHERE (oculto_por IS NOT NULL);
CREATE INDEX idx_products_pa_trgm ON public.products USING gin (principio_activo gin_trgm_ops) WHERE (principio_activo IS NOT NULL);
CREATE INDEX idx_products_pactivo_norm_trgm ON public.products USING gin (pactivo_norm gin_trgm_ops) WHERE ((pactivo_norm IS NOT NULL) AND (pactivo_norm <> ''::text));
CREATE INDEX idx_products_sync_log_checked_at ON public.products_sync_log USING btree (checked_at DESC);
CREATE INDEX idx_proveedores_laboratorio_id ON public.proveedores USING btree (laboratorio_id);
CREATE INDEX idx_proveedores_maestro_categoria ON public.proveedores_maestro USING btree (categoria_id);
CREATE UNIQUE INDEX idx_proveedores_maestro_dui_sin_nit ON public.proveedores_maestro USING btree (dui) WHERE (nit IS NULL);
CREATE INDEX idx_proveedores_maestro_nombre_norm ON public.proveedores_maestro USING btree (nombre_norm);
CREATE INDEX idx_proveedores_maestro_nrc ON public.proveedores_maestro USING btree (nrc);
CREATE INDEX idx_proveedores_maestro_supplier ON public.proveedores_maestro USING btree (supplier_id);
CREATE INDEX idx_psma_covering ON public.product_sales_monthly_agg USING btree (year_month, branch_id, erp_product_id, presentacion) INCLUDE (descripcion, cantidad, neto);
CREATE INDEX idx_psma_ym_bid ON public.product_sales_monthly_agg USING btree (year_month, branch_id);
CREATE INDEX idx_psp_history_lookup ON public.product_stock_params_history USING btree (erp_product_id, erp_sucursal_id, captured_at DESC);
CREATE INDEX idx_psp_pending_drafts ON public.product_stock_params USING btree (erp_product_id) WHERE ((draft_status = 'pending'::text) AND (erp_sucursal_id <> 6));
CREATE INDEX idx_psp_sucursal ON public.product_stock_params USING btree (erp_sucursal_id);
CREATE INDEX idx_psp_sucursal_updated_producto ON public.product_stock_params USING btree (erp_sucursal_id, updated_at, erp_product_id);
CREATE INDEX idx_psr_sucursal_producto ON public.product_sales_rollup USING btree (erp_sucursal_id, erp_product_id);
CREATE INDEX idx_pss_confirmado_correccion_por ON public.pedido_sucursal_status USING btree (confirmado_correccion_por);
CREATE INDEX idx_pss_corregido_bodega_por ON public.pedido_sucursal_status USING btree (corregido_bodega_por);
CREATE INDEX idx_pss_diferencias_reportadas_por ON public.pedido_sucursal_status USING btree (diferencias_reportadas_por);
CREATE INDEX idx_pss_finalizado_por ON public.pedido_sucursal_status USING btree (finalizado_por);
CREATE INDEX idx_pss_iniciado_por ON public.pedido_sucursal_status USING btree (iniciado_por);
CREATE INDEX idx_pss_llegada_fisica_por ON public.pedido_sucursal_status USING btree (llegada_fisica_por);
CREATE INDEX idx_pss_reanudado_por ON public.pedido_sucursal_status USING btree (reanudado_por);
CREATE INDEX idx_pss_recibido_erp_por ON public.pedido_sucursal_status USING btree (recibido_erp_por);
CREATE INDEX idx_pss_reenvio_por ON public.pedido_sucursal_status USING btree (reenvio_por);
CREATE INDEX idx_purchase_dte_docs_account ON public.purchase_dte_documents USING btree (account_id);
CREATE INDEX idx_purchase_dte_docs_emisor ON public.purchase_dte_documents USING btree (emisor_nit);
CREATE INDEX idx_purchase_dte_docs_fecha ON public.purchase_dte_documents USING btree (fecha_emision DESC);
CREATE INDEX idx_purchase_dte_docs_proveedor ON public.purchase_dte_documents USING btree (proveedor_id);
CREATE INDEX idx_purchase_dte_docs_relacionado ON public.purchase_dte_documents USING btree (documento_relacionado_id);
CREATE INDEX idx_purchase_dte_docs_supplier ON public.purchase_dte_documents USING btree (supplier_id);
CREATE INDEX idx_purchase_dte_docs_tipo ON public.purchase_dte_documents USING btree (tipo_dte);
CREATE INDEX idx_purchase_dte_processed_account ON public.purchase_dte_processed_messages USING btree (account_id);
CREATE INDEX idx_purchase_dte_review_account ON public.purchase_dte_review_queue USING btree (account_id);
CREATE INDEX idx_purchase_dte_review_kind ON public.purchase_dte_review_queue USING btree (kind);
CREATE INDEX idx_purchase_dte_review_matched_doc ON public.purchase_dte_review_queue USING btree (matched_document_id);
CREATE INDEX idx_purchase_dte_review_status ON public.purchase_dte_review_queue USING btree (status);
CREATE INDEX idx_purchase_items_product ON public.purchase_receipt_items USING btree (erp_product_id);
CREATE INDEX idx_purchase_items_receipt ON public.purchase_receipt_items USING btree (receipt_id);
CREATE INDEX idx_purchase_receipts_branch ON public.purchase_receipts USING btree (branch_id);
CREATE INDEX idx_purchase_receipts_erp_sucursal ON public.purchase_receipts USING btree (erp_sucursal_id);
CREATE INDEX idx_purchase_receipts_fecha ON public.purchase_receipts USING btree (fecha);
CREATE INDEX idx_purchase_receipts_supplier ON public.purchase_receipts USING btree (supplier_id);
CREATE INDEX idx_roles_parent ON public.roles USING btree (parent_role_id) WHERE (parent_role_id IS NOT NULL);
CREATE INDEX idx_roles_secondary_parent ON public.roles USING btree (secondary_parent_role_id) WHERE (secondary_parent_role_id IS NOT NULL);
CREATE INDEX idx_ruta_pedidos_confirmado_suc_por ON public.ruta_pedidos USING btree (confirmado_suc_por);
CREATE INDEX idx_ruta_pedidos_entregado_por ON public.ruta_pedidos USING btree (entregado_por);
CREATE INDEX idx_ruta_pedidos_pedido ON public.ruta_pedidos USING btree (pedido_id);
CREATE INDEX idx_ruta_pedidos_ruta ON public.ruta_pedidos USING btree (ruta_id);
CREATE INDEX idx_rutas_conductor ON public.rutas USING btree (conductor_id);
CREATE INDEX idx_rutas_status ON public.rutas USING btree (status);
CREATE INDEX idx_sales_invoices_cod_vendedor ON public.sales_invoices USING btree (cod_vendedor);
CREATE INDEX idx_sales_invoices_customer_id ON public.sales_invoices USING btree (customer_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX idx_sales_invoices_estado ON public.sales_invoices USING btree (estado);
CREATE INDEX idx_sales_invoices_fecha ON public.sales_invoices USING btree (fecha);
CREATE INDEX idx_sales_invoices_has_puntos ON public.sales_invoices USING btree (fecha, branch_id) WHERE (has_puntos = true);
CREATE INDEX idx_sales_invoices_updated_at ON public.sales_invoices USING btree (updated_at);
CREATE INDEX idx_sales_null_resolutions_null_id ON public.sales_null_resolutions USING btree (null_id);
CREATE INDEX idx_schedule_coverage_branch_week ON public.schedule_coverage USING btree (coverage_branch_id, week_start_date);
CREATE INDEX idx_schedule_coverage_employee_week ON public.schedule_coverage USING btree (employee_id, week_start_date);
CREATE INDEX idx_sds_date_branch ON public.sales_daily_stats USING btree (date, branch_id);
CREATE INDEX idx_sgr_branch_tipo ON public.sales_gap_resolutions USING btree (branch_id, tipo_documento);
CREATE INDEX idx_shifts_branch ON public.shifts USING btree (branch_id);
CREATE INDEX idx_si_branch_fecha_full ON public.sales_invoices USING btree (branch_id, fecha) INCLUDE (estado, tipo_documento, total, hora, has_puntos);
CREATE INDEX idx_si_branch_fecha_no_anulada ON public.sales_invoices USING btree (branch_id, fecha) WHERE (estado <> 'ANULADA'::text);
CREATE INDEX idx_si_cliente_norm_trgm ON public.sales_invoices USING gin (norm_search(cliente) gin_trgm_ops);
CREATE INDEX idx_si_correlativo_norm_trgm ON public.sales_invoices USING gin (norm_search(correlativo) gin_trgm_ops);
CREATE INDEX idx_si_erp_invoice_norm_trgm ON public.sales_invoices USING gin (norm_search(erp_invoice_id) gin_trgm_ops);
CREATE INDEX idx_si_fecha_estado_branch ON public.sales_invoices USING btree (fecha, estado, branch_id, id);
CREATE INDEX idx_si_fecha_full ON public.sales_invoices USING btree (fecha) INCLUDE (estado, branch_id, tipo_documento, total, hora, has_puntos);
CREATE INDEX idx_sii_id_presentacion ON public.sales_invoice_items USING btree (id_presentacion) WHERE (id_presentacion IS NOT NULL);
CREATE INDEX idx_sii_invoice_covering ON public.sales_invoice_items USING btree (invoice_id) INCLUDE (erp_product_id, descripcion, presentacion, cantidad, total_linea, factor_unidades);
CREATE INDEX idx_sii_product_invoice ON public.sales_invoice_items USING btree (erp_product_id, invoice_id) WHERE (erp_product_id IS NOT NULL);
CREATE INDEX idx_suppliers_erp_id ON public.suppliers USING btree (erp_supplier_id);
CREATE INDEX idx_suppliers_nombre ON public.suppliers USING btree (nombre);
CREATE INDEX idx_survey_bloques_survey ON public.survey_bloques USING btree (survey_id);
CREATE INDEX idx_survey_preguntas_bloque ON public.survey_preguntas USING btree (bloque_id);
CREATE INDEX idx_survey_preguntas_survey ON public.survey_preguntas USING btree (survey_id);
CREATE INDEX idx_survey_responses_employee ON public.survey_responses USING btree (employee_id);
CREATE INDEX idx_survey_responses_survey ON public.survey_responses USING btree (survey_id);
CREATE INDEX idx_survey_responses_updated ON public.survey_responses USING btree (updated_by) WHERE (updated_by IS NOT NULL);
CREATE INDEX idx_surveys_created_by ON public.surveys USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX idx_timesheets_shift ON public.timesheets USING btree (scheduled_shift_id) WHERE (scheduled_shift_id IS NOT NULL);
CREATE INDEX idx_vacation_plans_created_by ON public.vacation_plans USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX idx_vacation_plans_header ON public.vacation_plans USING btree (plan_header_id);
CREATE INDEX idx_vms_mes_branch ON public.ventas_monthly_stats USING btree (mes, branch_id);
CREATE INDEX idx_vms_vendedor ON public.ventas_monthly_stats USING btree (cod_vendedor, mes);
CREATE INDEX idx_wfm_snapshots_branch_date ON public.wfm_snapshots USING btree (branch_id, snapshot_date);
CREATE INDEX minmax_ignored_erp_sucursal_id_idx ON public.minmax_ignored USING btree (erp_sucursal_id);
CREATE INDEX mmcr_prod_idx ON public.minmax_change_requests USING btree (erp_product_id, erp_sucursal_id);
CREATE INDEX mmcr_requester_idx ON public.minmax_change_requests USING btree (requested_by_id);
CREATE INDEX mmcr_status_idx ON public.minmax_change_requests USING btree (status, requested_at DESC);
CREATE UNIQUE INDEX mv_product_factor_pk ON public.mv_product_factor USING btree (product_id, pres_key);
CREATE INDEX overtime_bank_employee_idx ON public.overtime_bank USING btree (employee_id);
CREATE INDEX overtime_bank_period_idx ON public.overtime_bank USING btree (period_id);
CREATE INDEX pedido_apoyo_pedido_idx ON public.pedido_apoyo USING btree (pedido_id, erp_sucursal_id);
CREATE UNIQUE INDEX pedido_apoyo_unique_quad ON public.pedido_apoyo USING btree (pedido_id, erp_sucursal_id, employee_id, tipo);
CREATE INDEX push_subscriptions_employee_idx ON public.push_subscriptions USING btree (employee_id);
CREATE INDEX sync_log_branch_fini ON public.sync_log USING btree (branch_id, fini);
CREATE INDEX sync_log_ran_at ON public.sync_log USING btree (ran_at DESC);
CREATE UNIQUE INDEX uq_igmv ON public.inventory_grouped_mv USING btree (erp_sucursal_id, erp_product_id);
CREATE INDEX vacation_plans_branch ON public.vacation_plans USING btree (branch_id);
CREATE INDEX vacation_plans_dates ON public.vacation_plans USING btree (start_date, end_date);
CREATE INDEX vacation_plans_employee ON public.vacation_plans USING btree (employee_id);
CREATE INDEX vacation_plans_year ON public.vacation_plans USING btree (year);
CREATE INDEX ventas_perdidas_branch_id_idx ON public.ventas_perdidas USING btree (branch_id);
CREATE INDEX ventas_perdidas_erp_product_id_idx ON public.ventas_perdidas USING btree (erp_product_id);
CREATE INDEX ventas_perdidas_status_created_at_idx ON public.ventas_perdidas USING btree (status, created_at DESC);


-- ── Triggers (11) ──────────────────────────────────────────────────────────

CREATE TRIGGER approval_requests_updated_at BEFORE UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER attendance_kiosko_pedido_auto_lifecycle AFTER INSERT ON public.attendance FOR EACH ROW EXECUTE FUNCTION attendance_kiosko_pedido_lifecycle();
CREATE TRIGGER trg_audit_employee_sensitive AFTER UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION audit_employee_sensitive_changes();
CREATE TRIGGER trg_bodega_draft_sync_stmt_ins AFTER INSERT ON public.product_stock_params REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_bodega_draft_from_branch_stmt();
CREATE TRIGGER trg_bodega_draft_sync_stmt_upd AFTER UPDATE ON public.product_stock_params REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION sync_bodega_draft_from_branch_stmt();
CREATE TRIGGER trg_employees_code_numeric_ins BEFORE INSERT ON public.employees FOR EACH ROW WHEN ((new.code IS NOT NULL)) EXECUTE FUNCTION enforce_numeric_employee_code();
CREATE TRIGGER trg_employees_code_numeric_upd BEFORE UPDATE OF code ON public.employees FOR EACH ROW WHEN ((new.code IS DISTINCT FROM old.code)) EXECUTE FUNCTION enforce_numeric_employee_code();
CREATE TRIGGER trg_psp_capture_history BEFORE UPDATE ON public.product_stock_params FOR EACH ROW EXECUTE FUNCTION fn_psp_capture_history();
CREATE TRIGGER trg_push_on_announcement AFTER INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION notify_push_on_announcement();
CREATE TRIGGER trg_set_item_factor_unidades BEFORE INSERT OR UPDATE OF presentacion ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION fn_set_item_factor_unidades();
CREATE TRIGGER trg_update_product_last_sale AFTER INSERT ON public.sales_invoice_items FOR EACH ROW EXECUTE FUNCTION fn_update_product_last_sale();


-- ── RLS habilitado (110) ────────────────────────────────────────────────────

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteo_inventario_item_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteo_inventario_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conteos_inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizacion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_catalog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sync_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_sucursal_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laboratorios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minmax_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minmax_ignored ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.minmax_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mv_refresh_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orphan_objects_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_apoyo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_item_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_pausa_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_recepcion_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_recepcion_firmas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_sucursal_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practicantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_active_principles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_last_sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_precios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_precios_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_precios_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_sales_monthly_agg ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_sales_rollup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_params_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores_maestro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_dte_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_dte_processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_dte_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruta_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruta_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_gap_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoice_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoice_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_null_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_payment_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_bloques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_preguntas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_dashboard_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacation_plan_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_monthly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_perdidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfm_snapshots ENABLE ROW LEVEL SECURITY;


-- ── Policies (219) ──────────────────────────────────────────────────────────

CREATE POLICY announcements_audience ON public.announcements AS PERMISSIVE FOR SELECT TO PUBLIC USING (((target_type = 'GLOBAL'::text) OR ((target_type = 'BRANCH'::text) AND ((target_value #>> '{}'::text[]) = (( SELECT auth_employee_branch_id() AS auth_employee_branch_id))::text)) OR ((target_type = 'ROLE'::text) AND ((target_value #>> '{}'::text[]) = ( SELECT r.name
   FROM roles r
  WHERE (r.id = ( SELECT auth_employee_role_id() AS auth_employee_role_id))))) OR ((target_type = 'EMPLOYEE'::text) AND (target_value @> to_jsonb((( SELECT auth_employee_id() AS auth_employee_id))::text))) OR (( SELECT auth_has_module_permission('announcements'::text, 'can_edit'::text) AS auth_has_module_permission) AND (( SELECT auth_module_scope('announcements'::text) AS auth_module_scope) = 'ALL'::text))));
CREATE POLICY announcements_delete ON public.announcements AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth_has_module_permission('announcements'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('announcements'::text) AS auth_module_scope) = 'ALL'::text) OR ((target_type = 'BRANCH'::text) AND ((target_value #>> '{}'::text[]) = (( SELECT auth_employee_branch_id() AS auth_employee_branch_id))::text)))));
CREATE POLICY announcements_insert ON public.announcements AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('announcements'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('announcements'::text) AS auth_module_scope) = 'ALL'::text) OR ((target_type = 'BRANCH'::text) AND ((target_value #>> '{}'::text[]) = (( SELECT auth_employee_branch_id() AS auth_employee_branch_id))::text)))));
CREATE POLICY announcements_update ON public.announcements AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('announcements'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('announcements'::text) AS auth_module_scope) = 'ALL'::text) OR ((target_type = 'BRANCH'::text) AND ((target_value #>> '{}'::text[]) = (( SELECT auth_employee_branch_id() AS auth_employee_branch_id))::text)))));
CREATE POLICY approval_requests_insert ON public.approval_requests AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((employee_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_has_module_permission('requests'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('requests'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))))));
CREATE POLICY approval_requests_select ON public.approval_requests AS PERMISSIVE FOR SELECT TO PUBLIC USING (((employee_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_has_module_permission('requests'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('requests'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))))));
CREATE POLICY approval_requests_update ON public.approval_requests AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('requests'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('requests'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))))) WITH CHECK ((( SELECT auth_has_module_permission('requests'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('requests'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = approval_requests.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY attendance_delete ON public.attendance AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth_has_module_permission('time_audit'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('time_audit'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY attendance_insert ON public.attendance AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY attendance_select ON public.attendance AS PERMISSIVE FOR SELECT TO PUBLIC USING (((employee_id = ( SELECT auth_employee_id() AS auth_employee_id)) OR (( SELECT auth_has_module_permission('monitor'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('monitor'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))))));
CREATE POLICY attendance_update ON public.attendance AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('time_audit'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('time_audit'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = attendance.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY admin_insert ON public.audit_logs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY admin_read ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY backup_sync_log_select ON public.backup_sync_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('sync_health'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY branch_documents_insert ON public.branch_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY branch_documents_select ON public.branch_documents AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY branch_expenses_insert ON public.branch_expenses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY branch_expenses_select ON public.branch_expenses AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY branch_expenses_update ON public.branch_expenses AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY branches_insert ON public.branches AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY branches_select ON public.branches AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY branches_update ON public.branches AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY kiosk_read ON public.branches AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY conteo_item_history_select ON public.conteo_inventario_item_history AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth_has_module_permission('conteo_inventario'::text, 'can_view'::text) AS auth_has_module_permission) AND (EXISTS ( SELECT 1
   FROM (conteo_inventario_items ci
     JOIN conteos_inventario c ON ((c.id = ci.conteo_id)))
  WHERE ((ci.id = conteo_inventario_item_history.item_id) AND ((( SELECT auth_module_scope('conteo_inventario'::text) AS auth_module_scope) = 'ALL'::text) OR (c.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY conteo_items_select ON public.conteo_inventario_items AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth_has_module_permission('conteo_inventario'::text, 'can_view'::text) AS auth_has_module_permission) AND (EXISTS ( SELECT 1
   FROM conteos_inventario c
  WHERE ((c.id = conteo_inventario_items.conteo_id) AND ((( SELECT auth_module_scope('conteo_inventario'::text) AS auth_module_scope) = 'ALL'::text) OR (c.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY conteos_select ON public.conteos_inventario AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth_has_module_permission('conteo_inventario'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('conteo_inventario'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY cotizacion_items_authenticated ON public.cotizacion_items AS PERMISSIVE FOR ALL TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY cotizaciones_delete ON public.cotizaciones AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth_has_module_permission('cotizaciones'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('cotizaciones'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY cotizaciones_insert ON public.cotizaciones AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('cotizaciones'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('cotizaciones'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY cotizaciones_select ON public.cotizaciones AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('cotizaciones'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('cotizaciones'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY cotizaciones_update ON public.cotizaciones AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('cotizaciones'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('cotizaciones'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY customers_select ON public.customers AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY dispatch_rules_delete ON public.dispatch_rules AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['pedidos'::text]) AS auth_can_edit_any));
CREATE POLICY dispatch_rules_insert ON public.dispatch_rules AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['pedidos'::text]) AS auth_can_edit_any));
CREATE POLICY dispatch_rules_select ON public.dispatch_rules AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY dispatch_rules_update ON public.dispatch_rules AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['pedidos'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['pedidos'::text]) AS auth_can_edit_any));
CREATE POLICY education_catalog_entries_insert ON public.education_catalog_entries AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['staff_detail'::text]) AS auth_can_edit_any));
CREATE POLICY education_catalog_entries_select ON public.education_catalog_entries AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY email_sync_accounts_select ON public.email_sync_accounts AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('facturas_compra'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY email_sync_log_select ON public.email_sync_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('sync_health'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY eb_delete ON public.employee_branches AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth_has_module_permission('staff_list'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('staff_list'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_branches.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY eb_insert ON public.employee_branches AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('staff_list'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('staff_list'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_branches.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY eb_select ON public.employee_branches AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY eb_update ON public.employee_branches AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('staff_list'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('staff_list'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_branches.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY employee_documents_insert ON public.employee_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['staff_detail'::text, 'emp_documents'::text]) AS auth_can_edit_any));
CREATE POLICY employee_documents_select ON public.employee_documents AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY employee_events_insert ON public.employee_events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['staff_detail'::text]) AS auth_can_edit_any));
CREATE POLICY employee_events_select ON public.employee_events AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY employee_events_update ON public.employee_events AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['staff_detail'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['staff_detail'::text]) AS auth_can_edit_any));
CREATE POLICY employee_rosters_insert ON public.employee_rosters AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('schedules'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('schedules'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rosters.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY employee_rosters_select ON public.employee_rosters AS PERMISSIVE FOR SELECT TO PUBLIC USING (((employee_id = ( SELECT auth_employee_id() AS auth_employee_id)) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rosters.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))) OR (( SELECT auth_has_module_permission('schedules'::text, 'can_view'::text) AS auth_has_module_permission) AND (( SELECT auth_module_scope('schedules'::text) AS auth_module_scope) = 'ALL'::text))));
CREATE POLICY employee_rosters_update ON public.employee_rosters AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('schedules'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('schedules'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = employee_rosters.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))));
CREATE POLICY employees_delete ON public.employees AS PERMISSIVE FOR DELETE TO authenticated USING ((( SELECT auth_has_module_permission('staff_list'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('staff_list'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY employees_insert ON public.employees AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_has_module_permission('staff_list'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY employees_select ON public.employees AS PERMISSIVE FOR SELECT TO authenticated USING ((NOT COALESCE(( SELECT r.is_su
   FROM roles r
  WHERE (r.id = employees.role_id)), false)));
CREATE POLICY employees_update ON public.employees AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth_has_module_permission('staff_list'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('staff_list'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY erp_sucursal_map_auth_read ON public.erp_sucursal_map AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY holidays_insert ON public.holidays AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_holidays'::text]) AS auth_can_edit_any));
CREATE POLICY holidays_update ON public.holidays AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_holidays'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_holidays'::text]) AS auth_can_edit_any));
CREATE POLICY read_all ON public.holidays AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "allow read inventory_sync_log" ON public.inventory_sync_log AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "allow read inventory" ON public.inventory AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY kiosk_devices_insert ON public.kiosk_devices AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY kiosk_devices_select ON public.kiosk_devices AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY kiosk_devices_update ON public.kiosk_devices AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['branches'::text]) AS auth_can_edit_any));
CREATE POLICY lab_locations_insert ON public.lab_locations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text, 'productos'::text]) AS auth_can_edit_any));
CREATE POLICY lab_locations_select ON public.lab_locations AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY lab_locations_update ON public.lab_locations AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text, 'productos'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text, 'productos'::text]) AS auth_can_edit_any));
CREATE POLICY laboratorios_read ON public.laboratorios AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY mmcr_insert ON public.minmax_change_requests AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('dash_minmax_req'::text, 'can_view'::text) AS auth_has_module_permission) AND (requested_by_id = ( SELECT auth.uid() AS uid))));
CREATE POLICY mmcr_select ON public.minmax_change_requests AS PERMISSIVE FOR SELECT TO PUBLIC USING (((requested_by_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_has_module_permission('minmax'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('minmax'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id))))));
CREATE POLICY mmcr_update ON public.minmax_change_requests AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('minmax'::text, 'can_approve'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('minmax'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY minmax_ignored_delete ON public.minmax_ignored AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['minmax'::text]) AS auth_can_edit_any));
CREATE POLICY minmax_ignored_insert ON public.minmax_ignored AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['minmax'::text]) AS auth_can_edit_any));
CREATE POLICY minmax_ignored_select ON public.minmax_ignored AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY minmax_ignored_update ON public.minmax_ignored AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['minmax'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['minmax'::text]) AS auth_can_edit_any));
CREATE POLICY minmax_sync_log_select ON public.minmax_sync_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('sync_health'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY module_locks_select ON public.module_locks AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY mv_refresh_state_select ON public.mv_refresh_state AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY notifications_delete ON public.notifications AS PERMISSIVE FOR DELETE TO authenticated USING ((recipient_id = ( SELECT auth_employee_id() AS auth_employee_id)));
CREATE POLICY notifications_select ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING ((recipient_id = ( SELECT auth_employee_id() AS auth_employee_id)));
CREATE POLICY notifications_update ON public.notifications AS PERMISSIVE FOR UPDATE TO authenticated USING ((recipient_id = ( SELECT auth_employee_id() AS auth_employee_id))) WITH CHECK ((recipient_id = ( SELECT auth_employee_id() AS auth_employee_id)));
CREATE POLICY orphan_objects_registry_select ON public.orphan_objects_registry AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('orphan_objects'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY orphan_objects_registry_update ON public.orphan_objects_registry AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['orphan_objects'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['orphan_objects'::text]) AS auth_can_edit_any));
CREATE POLICY overtime_bank_delete ON public.overtime_bank AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['payroll'::text, 'time_audit'::text]) AS auth_can_edit_any));
CREATE POLICY overtime_bank_insert ON public.overtime_bank AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['payroll'::text, 'time_audit'::text]) AS auth_can_edit_any));
CREATE POLICY overtime_bank_select ON public.overtime_bank AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY payroll_entries_read ON public.payroll_entries AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth_has_module_permission('payroll'::text, 'can_view'::text) AS auth_has_module_permission) AND (( SELECT auth_module_scope('payroll'::text) AS auth_module_scope) = 'ALL'::text)) OR (EXISTS ( SELECT 1
   FROM employees e
  WHERE ((e.id = payroll_entries.employee_id) AND (e.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))))));
CREATE POLICY payroll_periods_read ON public.payroll_periods AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY pedido_apoyo_insert ON public.pedido_apoyo AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pedido_apoyo_select ON public.pedido_apoyo AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pedido_apoyo_update ON public.pedido_apoyo AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pie_select ON public.pedido_item_eventos AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pedido_items_select ON public.pedido_items AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pph_insert ON public.pedido_pausa_historial AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pph_select ON public.pedido_pausa_historial AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pph_update ON public.pedido_pausa_historial AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pre_insert ON public.pedido_recepcion_extras AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pre_select ON public.pedido_recepcion_extras AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY prf_insert ON public.pedido_recepcion_firmas AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY prf_select ON public.pedido_recepcion_firmas AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pss_insert ON public.pedido_sucursal_status AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pss_select ON public.pedido_sucursal_status AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY pss_update ON public.pedido_sucursal_status AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY snapshots_delete ON public.pedidos_snapshots AS PERMISSIVE FOR DELETE TO authenticated USING ((created_by = ( SELECT auth.uid() AS uid)));
CREATE POLICY snapshots_insert ON public.pedidos_snapshots AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((created_by = ( SELECT auth.uid() AS uid)));
CREATE POLICY snapshots_select ON public.pedidos_snapshots AS PERMISSIVE FOR SELECT TO PUBLIC USING (((created_by = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id) = ANY (sucursal_ids))))));
CREATE POLICY pedidos_select ON public.pedidos AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos'::text) AS auth_module_scope) = 'ALL'::text) OR (( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id) = ANY (sucursal_ids)))));
CREATE POLICY practicantes_select ON public.practicantes AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY practicantes_write ON public.practicantes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['staff_list'::text]) AS auth_can_edit_any));
CREATE POLICY practicantes_write_delete ON public.practicantes AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['staff_list'::text]) AS auth_can_edit_any));
CREATE POLICY practicantes_write_update ON public.practicantes AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['staff_list'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['staff_list'::text]) AS auth_can_edit_any));
CREATE POLICY presentaciones_read ON public.presentaciones AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY pap_delete ON public.product_active_principles AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['productos'::text, 'compras'::text]) AS auth_can_edit_any));
CREATE POLICY pap_insert ON public.product_active_principles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['productos'::text, 'compras'::text]) AS auth_can_edit_any));
CREATE POLICY pap_select ON public.product_active_principles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_categories_insert ON public.product_categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['productos'::text]) AS auth_can_edit_any));
CREATE POLICY product_categories_select ON public.product_categories AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_last_sale_auth_read ON public.product_last_sale AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_locations_delete ON public.product_locations AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['productos'::text]) AS auth_can_edit_any));
CREATE POLICY product_locations_insert ON public.product_locations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['productos'::text]) AS auth_can_edit_any));
CREATE POLICY product_locations_select ON public.product_locations AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_locations_update ON public.product_locations AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['productos'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['productos'::text]) AS auth_can_edit_any));
CREATE POLICY product_precios_changelog_read ON public.product_precios_changelog AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_precios_history_read ON public.product_precios_history AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_precios_read ON public.product_precios AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY product_sales_monthly_agg_auth_read ON public.product_sales_monthly_agg AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY psr_select ON public.product_sales_rollup AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_read_history ON public.product_stock_params_history AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY psp_insert ON public.product_stock_params AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth_can_edit_any(ARRAY['minmax'::text, 'pedidos'::text]) AS auth_can_edit_any) AND (( SELECT auth_can_edit_scope_all(ARRAY['minmax'::text, 'pedidos'::text]) AS auth_can_edit_scope_all) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY psp_select ON public.product_stock_params AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY psp_update ON public.product_stock_params AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth_can_edit_any(ARRAY['minmax'::text, 'pedidos'::text]) AS auth_can_edit_any) AND (( SELECT auth_can_edit_scope_all(ARRAY['minmax'::text, 'pedidos'::text]) AS auth_can_edit_scope_all) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY "Authed can read products" ON public.products AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY products_changelog_read ON public.products_changelog AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY products_sync_log_select ON public.products_sync_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('sync_health'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY products_update ON public.products AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['productos'::text, 'dash_srs_inv'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['productos'::text, 'dash_srs_inv'::text]) AS auth_can_edit_any));
CREATE POLICY proveedores_categorias_select ON public.proveedores_categorias AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('proveedores'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY proveedores_maestro_select ON public.proveedores_maestro AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('proveedores'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY proveedores_delete ON public.proveedores AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text]) AS auth_can_edit_any));
CREATE POLICY proveedores_insert ON public.proveedores AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text]) AS auth_can_edit_any));
CREATE POLICY proveedores_select ON public.proveedores AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY proveedores_update ON public.proveedores AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['laboratorios'::text]) AS auth_can_edit_any));
CREATE POLICY purchase_dte_docs_select ON public.purchase_dte_documents AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('facturas_compra'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY purchase_dte_processed_select ON public.purchase_dte_processed_messages AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('facturas_compra'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY purchase_dte_review_select ON public.purchase_dte_review_queue AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('facturas_compra'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY purchase_dte_review_update ON public.purchase_dte_review_queue AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['facturas_compra'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['facturas_compra'::text]) AS auth_can_edit_any));
CREATE POLICY purchase_receipt_items_select ON public.purchase_receipt_items AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth_has_module_permission('compras'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('compras'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM purchase_receipts pr
  WHERE ((pr.id = purchase_receipt_items.receipt_id) AND (pr.branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))))) OR ( SELECT auth_has_module_permission('minmax_ver_costos'::text, 'can_view'::text) AS auth_has_module_permission) OR ( SELECT auth_has_module_permission('productos_tab_catalogo_costos'::text, 'can_view'::text) AS auth_has_module_permission)));
CREATE POLICY "service full purchase_receipt_items" ON public.purchase_receipt_items AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY purchase_receipts_select ON public.purchase_receipts AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth_has_module_permission('compras'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('compras'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))) OR ( SELECT auth_has_module_permission('minmax_ver_costos'::text, 'can_view'::text) AS auth_has_module_permission) OR ( SELECT auth_has_module_permission('productos_tab_catalogo_costos'::text, 'can_view'::text) AS auth_has_module_permission)));
CREATE POLICY "service full purchase_receipts" ON public.purchase_receipts AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY purchase_sync_log_select ON public.purchase_sync_log AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('compras'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('compras'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY "service full purchase_sync_log" ON public.purchase_sync_log AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY push_subscriptions_delete ON public.push_subscriptions AS PERMISSIVE FOR DELETE TO PUBLIC USING ((employee_id = ( SELECT e.id
   FROM employees e
  WHERE (e.username = split_part(( SELECT auth.email() AS email), '@'::text, 1))
 LIMIT 1)));
CREATE POLICY push_subscriptions_select ON public.push_subscriptions AS PERMISSIVE FOR SELECT TO PUBLIC USING (((employee_id = ( SELECT e.id
   FROM employees e
  WHERE (e.username = split_part(( SELECT auth.email() AS email), '@'::text, 1))
 LIMIT 1)) OR (( SELECT auth.role() AS role) = 'service_role'::text)));
CREATE POLICY push_subscriptions_update ON public.push_subscriptions AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((employee_id = ( SELECT e.id
   FROM employees e
  WHERE (e.username = split_part(( SELECT auth.email() AS email), '@'::text, 1))
 LIMIT 1)));
CREATE POLICY push_subscriptions_write ON public.push_subscriptions AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((employee_id = ( SELECT e.id
   FROM employees e
  WHERE (e.username = split_part(( SELECT auth.email() AS email), '@'::text, 1))
 LIMIT 1)));
CREATE POLICY role_permissions_authenticated_read ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.role() AS role) = 'authenticated'::text));
CREATE POLICY role_permissions_delete ON public.role_permissions AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_has_module_permission('permissions'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY role_permissions_insert ON public.role_permissions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_has_module_permission('permissions'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY role_permissions_update ON public.role_permissions AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_has_module_permission('permissions'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY admin_update ON public.roles AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['roles'::text, 'permissions'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['roles'::text, 'permissions'::text]) AS auth_can_edit_any));
CREATE POLICY admin_write ON public.roles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['roles'::text, 'permissions'::text]) AS auth_can_edit_any));
CREATE POLICY read_all ON public.roles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY roles_delete ON public.roles AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['roles'::text, 'permissions'::text]) AS auth_can_edit_any));
CREATE POLICY ruta_locations_select ON public.ruta_locations AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos_tab_rutas'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM ruta_pedidos rp
  WHERE ((rp.ruta_id = ruta_locations.ruta_id) AND (rp.erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id))))))));
CREATE POLICY ruta_locations_write ON public.ruta_locations AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY ruta_locations_write_delete ON public.ruta_locations AS PERMISSIVE FOR DELETE TO PUBLIC USING (( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY ruta_locations_write_update ON public.ruta_locations AS PERMISSIVE FOR UPDATE TO PUBLIC USING (( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_edit'::text) AS auth_has_module_permission)) WITH CHECK (( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY ruta_pedidos_select ON public.ruta_pedidos AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos_tab_rutas'::text) AS auth_module_scope) = 'ALL'::text) OR (erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id)))));
CREATE POLICY ruta_pedidos_update ON public.ruta_pedidos AS PERMISSIVE FOR UPDATE TO PUBLIC USING (( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY rutas_select ON public.rutas AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('pedidos_tab_rutas'::text) AS auth_module_scope) = 'ALL'::text) OR (EXISTS ( SELECT 1
   FROM ruta_pedidos rp
  WHERE ((rp.ruta_id = rutas.id) AND (rp.erp_sucursal_id = ( SELECT auth_employee_erp_sucursal_id() AS auth_employee_erp_sucursal_id))))))));
CREATE POLICY rutas_update ON public.rutas AS PERMISSIVE FOR UPDATE TO PUBLIC USING (( SELECT auth_has_module_permission('pedidos_tab_rutas'::text, 'can_edit'::text) AS auth_has_module_permission));
CREATE POLICY sales_alert_log_auth_read ON public.sales_alert_log AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read" ON public.sales_daily_stats AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_gap_resolutions_read ON public.sales_gap_resolutions AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed can read sales_invoice_changelog" ON public.sales_invoice_changelog AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authed can read sales_invoice_items" ON public.sales_invoice_items AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_invoice_resolutions_read ON public.sales_invoice_resolutions AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_invoices_select ON public.sales_invoices AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth_has_module_permission('ventas'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('ventas'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))) OR ( SELECT auth_has_module_permission('minmax_ver_costos'::text, 'can_view'::text) AS auth_has_module_permission) OR (( SELECT auth_has_module_permission('dash_top_productos'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('dash_top_productos'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))));
CREATE POLICY sales_null_resolutions_read ON public.sales_null_resolutions AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY spc_insert ON public.sales_payment_confirmations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['facturacion'::text]) AS auth_can_edit_any));
CREATE POLICY spc_select ON public.sales_payment_confirmations AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY schedule_coverage_delete ON public.schedule_coverage AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_calendar'::text]) AS auth_can_edit_any));
CREATE POLICY schedule_coverage_select ON public.schedule_coverage AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY schedule_coverage_update ON public.schedule_coverage AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_calendar'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_calendar'::text]) AS auth_can_edit_any));
CREATE POLICY schedule_coverage_write ON public.schedule_coverage AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_calendar'::text]) AS auth_can_edit_any));
CREATE POLICY read_all ON public.shifts AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY shifts_delete ON public.shifts AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['schedules'::text]) AS auth_can_edit_any));
CREATE POLICY shifts_insert ON public.shifts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_shifts'::text]) AS auth_can_edit_any));
CREATE POLICY shifts_update ON public.shifts AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_shifts'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['schedules'::text, 'schedules_tab_shifts'::text]) AS auth_can_edit_any));
CREATE POLICY stock_config_select ON public.stock_config AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_config_update ON public.stock_config AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['minmax'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['minmax'::text]) AS auth_can_edit_any));
CREATE POLICY "authenticated read suppliers" ON public.suppliers AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "service full suppliers" ON public.suppliers AS PERMISSIVE FOR ALL TO service_role USING (true);
CREATE POLICY survey_bloques_read ON public.survey_bloques AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY survey_preguntas_read ON public.survey_preguntas AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY survey_responses_delete ON public.survey_responses AS PERMISSIVE FOR DELETE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['encuesta_admin'::text]) AS auth_can_edit_any));
CREATE POLICY survey_responses_insert ON public.survey_responses AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['encuesta_admin'::text, 'encuesta'::text]) AS auth_can_edit_any));
CREATE POLICY survey_responses_select ON public.survey_responses AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY survey_responses_update ON public.survey_responses AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['encuesta_admin'::text, 'encuesta'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['encuesta_admin'::text, 'encuesta'::text]) AS auth_can_edit_any));
CREATE POLICY surveys_read ON public.surveys AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY sync_alert_log_select ON public.sync_alert_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('sync_health'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY sync_log_admin_read ON public.sync_log AS PERMISSIVE FOR SELECT TO authenticated USING (( SELECT auth_has_module_permission('dte_sync'::text, 'can_view'::text) AS auth_has_module_permission));
CREATE POLICY timesheets_select ON public.timesheets AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY timesheets_update ON public.timesheets AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['time_audit'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['time_audit'::text]) AS auth_can_edit_any));
CREATE POLICY owner_insert ON public.user_dashboard_prefs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY owner_select ON public.user_dashboard_prefs AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY owner_update ON public.user_dashboard_prefs AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY vph_insert ON public.vacation_plan_headers AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['vacation_plan'::text]) AS auth_can_edit_any));
CREATE POLICY vph_select ON public.vacation_plan_headers AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY vph_update ON public.vacation_plan_headers AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['vacation_plan'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['vacation_plan'::text]) AS auth_can_edit_any));
CREATE POLICY vacation_plans_insert ON public.vacation_plans AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth_has_module_permission('vacation_plan'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('vacation_plan'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id)))));
CREATE POLICY vacation_plans_select ON public.vacation_plans AS PERMISSIVE FOR SELECT TO PUBLIC USING (((employee_id = ( SELECT auth_employee_id() AS auth_employee_id)) OR ( SELECT auth_has_module_permission('payroll'::text, 'can_view'::text) AS auth_has_module_permission) OR (( SELECT auth_has_module_permission('vacation_plan'::text, 'can_view'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('vacation_plan'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))));
CREATE POLICY vacation_plans_update ON public.vacation_plans AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((employee_id = ( SELECT auth_employee_id() AS auth_employee_id)) OR (( SELECT auth_has_module_permission('vacation_plan'::text, 'can_edit'::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope('vacation_plan'::text) AS auth_module_scope) = 'ALL'::text) OR (branch_id = ( SELECT auth_employee_branch_id() AS auth_employee_branch_id))))));
CREATE POLICY ventas_monthly_stats_read ON public.ventas_monthly_stats AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff read" ON public.ventas_perdidas AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY ventas_perdidas_insert ON public.ventas_perdidas AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (( SELECT auth_can_edit_any(ARRAY['ventas_perdidas'::text]) AS auth_can_edit_any));
CREATE POLICY ventas_perdidas_update ON public.ventas_perdidas AS PERMISSIVE FOR UPDATE TO authenticated USING (( SELECT auth_can_edit_any(ARRAY['ventas_perdidas'::text]) AS auth_can_edit_any)) WITH CHECK (( SELECT auth_can_edit_any(ARRAY['ventas_perdidas'::text]) AS auth_can_edit_any));
CREATE POLICY wfm_snapshots_select ON public.wfm_snapshots AS PERMISSIVE FOR SELECT TO authenticated USING (true);


-- ── Privilegios (REVOKE ALL + los GRANT exactos de produccion) (348) ────────

REVOKE ALL ON TABLE public.announcements FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.announcements TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.announcements TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.announcements TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.announcements TO service_role;
REVOKE ALL ON TABLE public.approval_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approval_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approval_requests TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approval_requests TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.approval_requests TO service_role;
REVOKE ALL ON TABLE public.attendance FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.attendance TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.attendance TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.attendance TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.attendance TO service_role;
REVOKE ALL ON SEQUENCE public.attendance_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.attendance_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.attendance_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.attendance_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.attendance_id_seq TO service_role;
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_logs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_logs TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_logs TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_logs TO service_role;
REVOKE ALL ON TABLE public.backup_sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.backup_sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.backup_sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.backup_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.backup_sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.backup_sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.backup_sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.backup_sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.backup_sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.branch_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_documents TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_documents TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_documents TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_documents TO service_role;
REVOKE ALL ON SEQUENCE public.branch_documents_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_documents_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_documents_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_documents_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_documents_id_seq TO service_role;
REVOKE ALL ON TABLE public.branch_expenses FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_expenses TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_expenses TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_expenses TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_expenses TO service_role;
REVOKE ALL ON SEQUENCE public.branch_expenses_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_expenses_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_expenses_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_expenses_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branch_expenses_id_seq TO service_role;
REVOKE ALL ON TABLE public.branch_hourly_sales FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_hourly_sales TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_hourly_sales TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_hourly_sales TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_hourly_sales TO service_role;
REVOKE ALL ON TABLE public.branches FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branches TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branches TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branches TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branches TO service_role;
REVOKE ALL ON SEQUENCE public.branches_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branches_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branches_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branches_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.branches_id_seq TO service_role;
REVOKE ALL ON TABLE public.conteo_inventario_item_history FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_item_history TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_item_history TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_item_history TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_item_history TO service_role;
REVOKE ALL ON TABLE public.conteo_inventario_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_items TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteo_inventario_items TO service_role;
REVOKE ALL ON TABLE public.conteos_inventario FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteos_inventario TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteos_inventario TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteos_inventario TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.conteos_inventario TO service_role;
REVOKE ALL ON TABLE public.cotizacion_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizacion_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizacion_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizacion_items TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizacion_items TO service_role;
REVOKE ALL ON SEQUENCE public.cotizacion_items_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizacion_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizacion_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizacion_items_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizacion_items_id_seq TO service_role;
REVOKE ALL ON TABLE public.cotizaciones FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizaciones TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizaciones TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizaciones TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cotizaciones TO service_role;
REVOKE ALL ON SEQUENCE public.cotizaciones_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizaciones_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizaciones_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizaciones_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.cotizaciones_id_seq TO service_role;
REVOKE ALL ON TABLE public.customers FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.customers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.customers TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.customers TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.customers TO service_role;
REVOKE ALL ON SEQUENCE public.customers_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.customers_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.customers_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.customers_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.customers_id_seq TO service_role;
REVOKE ALL ON TABLE public.dispatch_rules FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dispatch_rules TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dispatch_rules TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dispatch_rules TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.dispatch_rules TO service_role;
REVOKE ALL ON SEQUENCE public.dispatch_rules_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.dispatch_rules_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.dispatch_rules_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.dispatch_rules_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.dispatch_rules_id_seq TO service_role;
REVOKE ALL ON TABLE public.education_catalog_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.education_catalog_entries TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.education_catalog_entries TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.education_catalog_entries TO service_role;
REVOKE ALL ON SEQUENCE public.education_catalog_entries_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.education_catalog_entries_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.education_catalog_entries_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.education_catalog_entries_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.education_catalog_entries_id_seq TO service_role;
REVOKE ALL ON TABLE public.email_sync_accounts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_accounts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_accounts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_accounts TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_accounts TO service_role;
REVOKE ALL ON SEQUENCE public.email_sync_accounts_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_accounts_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_accounts_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_accounts_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_accounts_id_seq TO service_role;
REVOKE ALL ON TABLE public.email_sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.email_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.email_sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.email_sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.employee_branches FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_branches TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_branches TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_branches TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_branches TO service_role;
REVOKE ALL ON SEQUENCE public.employee_branches_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_branches_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_branches_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_branches_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_branches_id_seq TO service_role;
REVOKE ALL ON TABLE public.employee_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_documents TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_documents TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_documents TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_documents TO service_role;
REVOKE ALL ON TABLE public.employee_events FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_events TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_events TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_events TO service_role;
REVOKE ALL ON TABLE public.employee_rosters FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_rosters TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_rosters TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_rosters TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_rosters TO service_role;
REVOKE ALL ON SEQUENCE public.employee_rosters_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_rosters_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_rosters_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_rosters_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.employee_rosters_id_seq TO service_role;
REVOKE ALL ON TABLE public.employee_timeline FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_timeline TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_timeline TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_timeline TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employee_timeline TO service_role;
REVOKE ALL ON TABLE public.employees FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees TO service_role;
REVOKE ALL ON TABLE public.employees_safe FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees_safe TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees_safe TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees_safe TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.employees_safe TO service_role;
REVOKE ALL ON TABLE public.erp_sucursal_map FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.erp_sucursal_map TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.erp_sucursal_map TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.erp_sucursal_map TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.erp_sucursal_map TO service_role;
REVOKE ALL ON TABLE public.holidays FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.holidays TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.holidays TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.holidays TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.holidays TO service_role;
REVOKE ALL ON TABLE public.inventory FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory TO service_role;
REVOKE ALL ON TABLE public.inventory_grouped_mv FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_grouped_mv TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_grouped_mv TO service_role;
REVOKE ALL ON SEQUENCE public.inventory_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_id_seq TO service_role;
REVOKE ALL ON TABLE public.inventory_sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_sync_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.inventory_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.inventory_sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.inventory_sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.job_watermarks FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.job_watermarks TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.job_watermarks TO service_role;
REVOKE ALL ON TABLE public.kiosk_credentials FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_credentials TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_credentials TO service_role;
REVOKE ALL ON TABLE public.kiosk_devices FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_devices TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_devices TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_devices TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_devices TO service_role;
REVOKE ALL ON TABLE public.kiosk_pin_attempts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_pin_attempts TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.kiosk_pin_attempts TO service_role;
REVOKE ALL ON SEQUENCE public.kiosk_pin_attempts_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.kiosk_pin_attempts_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.kiosk_pin_attempts_id_seq TO service_role;
REVOKE ALL ON TABLE public.lab_locations FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lab_locations TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lab_locations TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lab_locations TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.lab_locations TO service_role;
REVOKE ALL ON SEQUENCE public.lab_locations_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.lab_locations_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.lab_locations_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.lab_locations_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.lab_locations_id_seq TO service_role;
REVOKE ALL ON TABLE public.laboratorios FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.laboratorios TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.laboratorios TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.laboratorios TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.laboratorios TO service_role;
REVOKE ALL ON TABLE public.login_rate_limit FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.login_rate_limit TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.login_rate_limit TO service_role;
REVOKE ALL ON SEQUENCE public.login_rate_limit_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.login_rate_limit_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.login_rate_limit_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.login_rate_limit_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.login_rate_limit_id_seq TO service_role;
REVOKE ALL ON TABLE public.minmax_change_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_change_requests TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_change_requests TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_change_requests TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_change_requests TO service_role;
REVOKE ALL ON SEQUENCE public.minmax_change_requests_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_change_requests_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_change_requests_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_change_requests_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_change_requests_id_seq TO service_role;
REVOKE ALL ON TABLE public.minmax_ignored FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_ignored TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_ignored TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_ignored TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_ignored TO service_role;
REVOKE ALL ON TABLE public.minmax_sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.minmax_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.minmax_sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.minmax_sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.module_locks FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.module_locks TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.module_locks TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.module_locks TO service_role;
REVOKE ALL ON SEQUENCE public.module_locks_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.module_locks_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.module_locks_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.module_locks_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.module_locks_id_seq TO service_role;
REVOKE ALL ON TABLE public.mv_product_factor FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.mv_product_factor TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_product_factor TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_product_factor TO service_role;
REVOKE ALL ON TABLE public.mv_refresh_state FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_refresh_state TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_refresh_state TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_refresh_state TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_refresh_state TO service_role;
REVOKE ALL ON TABLE public.mv_stock_analysis FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_stock_analysis TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.mv_stock_analysis TO service_role;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.notifications TO service_role;
REVOKE ALL ON TABLE public.orphan_objects_registry FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.orphan_objects_registry TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.orphan_objects_registry TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.orphan_objects_registry TO service_role;
REVOKE ALL ON SEQUENCE public.orphan_objects_registry_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.orphan_objects_registry_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.orphan_objects_registry_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.orphan_objects_registry_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.orphan_objects_registry_id_seq TO service_role;
REVOKE ALL ON TABLE public.overtime_bank FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.overtime_bank TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.overtime_bank TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.overtime_bank TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.overtime_bank TO service_role;
REVOKE ALL ON TABLE public.payroll_entries FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_entries TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_entries TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_entries TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_entries TO service_role;
REVOKE ALL ON TABLE public.payroll_periods FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_periods TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_periods TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_periods TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payroll_periods TO service_role;
REVOKE ALL ON TABLE public.pedido_apoyo FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_apoyo TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_apoyo TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_apoyo TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_apoyo TO service_role;
REVOKE ALL ON TABLE public.pedido_item_eventos FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_item_eventos TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_item_eventos TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_item_eventos TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_item_eventos TO service_role;
REVOKE ALL ON TABLE public.pedido_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_items TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_items TO service_role;
REVOKE ALL ON SEQUENCE public.pedido_items_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_items_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_items_id_seq TO service_role;
REVOKE ALL ON TABLE public.pedido_pausa_historial FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_pausa_historial TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_pausa_historial TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_pausa_historial TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_pausa_historial TO service_role;
REVOKE ALL ON TABLE public.pedido_recepcion_extras FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_extras TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_extras TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_extras TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_extras TO service_role;
REVOKE ALL ON SEQUENCE public.pedido_recepcion_extras_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_extras_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_extras_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_extras_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_extras_id_seq TO service_role;
REVOKE ALL ON TABLE public.pedido_recepcion_firmas FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_firmas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_firmas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_firmas TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_recepcion_firmas TO service_role;
REVOKE ALL ON SEQUENCE public.pedido_recepcion_firmas_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_firmas_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_firmas_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_firmas_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedido_recepcion_firmas_id_seq TO service_role;
REVOKE ALL ON TABLE public.pedido_sucursal_status FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_sucursal_status TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_sucursal_status TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_sucursal_status TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedido_sucursal_status TO service_role;
REVOKE ALL ON TABLE public.pedidos FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos TO service_role;
REVOKE ALL ON SEQUENCE public.pedidos_numero_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedidos_numero_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedidos_numero_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedidos_numero_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.pedidos_numero_seq TO service_role;
REVOKE ALL ON TABLE public.pedidos_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos_snapshots TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos_snapshots TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos_snapshots TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.pedidos_snapshots TO service_role;
REVOKE ALL ON TABLE public.practicantes FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.practicantes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.practicantes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.practicantes TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.practicantes TO service_role;
REVOKE ALL ON TABLE public.presentaciones FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.presentaciones TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.presentaciones TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.presentaciones TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.presentaciones TO service_role;
REVOKE ALL ON TABLE public.product_active_principles FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_active_principles TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_active_principles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_active_principles TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_active_principles TO service_role;
REVOKE ALL ON SEQUENCE public.product_active_principles_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_active_principles_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_active_principles_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_active_principles_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_active_principles_id_seq TO service_role;
REVOKE ALL ON TABLE public.product_categories FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_categories TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_categories TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_categories TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_categories TO service_role;
REVOKE ALL ON SEQUENCE public.product_categories_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_categories_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_categories_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_categories_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_categories_id_seq TO service_role;
REVOKE ALL ON TABLE public.product_cost_history FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_cost_history TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_cost_history TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_cost_history TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_cost_history TO service_role;
REVOKE ALL ON TABLE public.product_last_sale FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_last_sale TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_last_sale TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_last_sale TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_last_sale TO service_role;
REVOKE ALL ON TABLE public.product_locations FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_locations TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_locations TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_locations TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_locations TO service_role;
REVOKE ALL ON SEQUENCE public.product_locations_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_locations_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_locations_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_locations_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_locations_id_seq TO service_role;
REVOKE ALL ON TABLE public.product_precios FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios TO service_role;
REVOKE ALL ON TABLE public.product_precios_changelog FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_changelog TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_changelog TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_changelog TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_changelog TO service_role;
REVOKE ALL ON SEQUENCE public.product_precios_changelog_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_changelog_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_changelog_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_changelog_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_changelog_id_seq TO service_role;
REVOKE ALL ON TABLE public.product_precios_history FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_history TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_history TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_history TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_precios_history TO service_role;
REVOKE ALL ON SEQUENCE public.product_precios_history_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_history_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_history_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_history_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_precios_history_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.product_presentations_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_presentations_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_presentations_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_presentations_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_presentations_id_seq TO service_role;
REVOKE ALL ON TABLE public.product_purchase_summary FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_purchase_summary TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_purchase_summary TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_purchase_summary TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_purchase_summary TO service_role;
REVOKE ALL ON TABLE public.product_sales_monthly_agg FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_monthly_agg TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_monthly_agg TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_monthly_agg TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_monthly_agg TO service_role;
REVOKE ALL ON TABLE public.product_sales_rollup FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_rollup TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_rollup TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_sales_rollup TO service_role;
REVOKE ALL ON TABLE public.product_stock_params FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params TO service_role;
REVOKE ALL ON TABLE public.product_stock_params_history FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params_history TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params_history TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params_history TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_params_history TO service_role;
REVOKE ALL ON SEQUENCE public.product_stock_params_history_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_history_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_history_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_history_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_history_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.product_stock_params_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.product_stock_params_id_seq TO service_role;
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO service_role;
REVOKE ALL ON TABLE public.products_changelog FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_changelog TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_changelog TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_changelog TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_changelog TO service_role;
REVOKE ALL ON SEQUENCE public.products_changelog_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_changelog_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_changelog_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_changelog_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_changelog_id_seq TO service_role;
REVOKE ALL ON TABLE public.products_sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.products_sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.products_sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.products_with_lab FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_with_lab TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_with_lab TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_with_lab TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products_with_lab TO service_role;
REVOKE ALL ON TABLE public.proveedores FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores TO service_role;
REVOKE ALL ON TABLE public.proveedores_categorias FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_categorias TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_categorias TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_categorias TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_categorias TO service_role;
REVOKE ALL ON SEQUENCE public.proveedores_categorias_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_categorias_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_categorias_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_categorias_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_categorias_id_seq TO service_role;
REVOKE ALL ON SEQUENCE public.proveedores_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_id_seq TO service_role;
REVOKE ALL ON TABLE public.proveedores_maestro FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_maestro TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_maestro TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_maestro TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.proveedores_maestro TO service_role;
REVOKE ALL ON SEQUENCE public.proveedores_maestro_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_maestro_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_maestro_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_maestro_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.proveedores_maestro_id_seq TO service_role;
REVOKE ALL ON TABLE public.purchase_dte_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_documents TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_documents TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_documents TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_documents TO service_role;
REVOKE ALL ON SEQUENCE public.purchase_dte_documents_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_documents_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_documents_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_documents_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_documents_id_seq TO service_role;
REVOKE ALL ON TABLE public.purchase_dte_processed_messages FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_processed_messages TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_processed_messages TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_processed_messages TO service_role;
REVOKE ALL ON SEQUENCE public.purchase_dte_processed_messages_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_processed_messages_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_processed_messages_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_processed_messages_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_processed_messages_id_seq TO service_role;
REVOKE ALL ON TABLE public.purchase_dte_review_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_review_queue TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_review_queue TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_review_queue TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_dte_review_queue TO service_role;
REVOKE ALL ON SEQUENCE public.purchase_dte_review_queue_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_review_queue_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_review_queue_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_review_queue_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_dte_review_queue_id_seq TO service_role;
REVOKE ALL ON TABLE public.purchase_receipt_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipt_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipt_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipt_items TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipt_items TO service_role;
REVOKE ALL ON SEQUENCE public.purchase_receipt_items_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipt_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipt_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipt_items_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipt_items_id_seq TO service_role;
REVOKE ALL ON TABLE public.purchase_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipts TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_receipts TO service_role;
REVOKE ALL ON SEQUENCE public.purchase_receipts_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipts_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipts_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipts_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_receipts_id_seq TO service_role;
REVOKE ALL ON TABLE public.purchase_sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_sync_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.purchase_sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.purchase_sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.purchase_sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.push_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.push_subscriptions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.push_subscriptions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.push_subscriptions TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.push_subscriptions TO service_role;
REVOKE ALL ON TABLE public.role_permissions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.role_permissions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.role_permissions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.role_permissions TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.role_permissions TO service_role;
REVOKE ALL ON TABLE public.roles FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.roles TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.roles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.roles TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.roles TO service_role;
REVOKE ALL ON SEQUENCE public.roles_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.roles_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.roles_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.roles_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.roles_id_seq TO service_role;
REVOKE ALL ON TABLE public.ruta_locations FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_locations TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_locations TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_locations TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_locations TO service_role;
REVOKE ALL ON TABLE public.ruta_pedidos FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_pedidos TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_pedidos TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_pedidos TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ruta_pedidos TO service_role;
REVOKE ALL ON TABLE public.rutas FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rutas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rutas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rutas TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rutas TO service_role;
REVOKE ALL ON SEQUENCE public.rutas_numero_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rutas_numero_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rutas_numero_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rutas_numero_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.rutas_numero_seq TO service_role;
REVOKE ALL ON TABLE public.sales_alert_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_alert_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_alert_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_alert_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_alert_log TO service_role;
REVOKE ALL ON SEQUENCE public.sales_alert_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_alert_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_alert_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_alert_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_alert_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_daily_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_daily_stats TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_daily_stats TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_daily_stats TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_daily_stats TO service_role;
REVOKE ALL ON TABLE public.sales_gap_resolutions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_gap_resolutions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_gap_resolutions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_gap_resolutions TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_gap_resolutions TO service_role;
REVOKE ALL ON SEQUENCE public.sales_gap_resolutions_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_gap_resolutions_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_gap_resolutions_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_gap_resolutions_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_gap_resolutions_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_invoice_changelog FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_changelog TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_changelog TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_changelog TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_changelog TO service_role;
REVOKE ALL ON SEQUENCE public.sales_invoice_changelog_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_changelog_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_changelog_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_changelog_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_changelog_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_invoice_gaps FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_gaps TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_gaps TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_gaps TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_gaps TO service_role;
REVOKE ALL ON TABLE public.sales_invoice_items FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_items TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_items TO service_role;
REVOKE ALL ON SEQUENCE public.sales_invoice_items_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_items_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_items_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_items_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_items_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_invoice_nulls FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_nulls TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_nulls TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_nulls TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_nulls TO service_role;
REVOKE ALL ON TABLE public.sales_invoice_resolutions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_resolutions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_resolutions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_resolutions TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoice_resolutions TO service_role;
REVOKE ALL ON SEQUENCE public.sales_invoice_resolutions_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_resolutions_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_resolutions_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_resolutions_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoice_resolutions_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_invoices FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoices TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoices TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoices TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_invoices TO service_role;
REVOKE ALL ON SEQUENCE public.sales_invoices_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoices_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoices_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoices_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_invoices_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_null_resolutions FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_null_resolutions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_null_resolutions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_null_resolutions TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_null_resolutions TO service_role;
REVOKE ALL ON SEQUENCE public.sales_null_resolutions_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_null_resolutions_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_null_resolutions_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_null_resolutions_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_null_resolutions_id_seq TO service_role;
REVOKE ALL ON TABLE public.sales_payment_confirmations FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_payment_confirmations TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_payment_confirmations TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_payment_confirmations TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sales_payment_confirmations TO service_role;
REVOKE ALL ON SEQUENCE public.sales_payment_confirmations_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_payment_confirmations_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_payment_confirmations_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_payment_confirmations_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sales_payment_confirmations_id_seq TO service_role;
REVOKE ALL ON TABLE public.schedule_coverage FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.schedule_coverage TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.schedule_coverage TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.schedule_coverage TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.schedule_coverage TO service_role;
REVOKE ALL ON TABLE public.shifts FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.shifts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.shifts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.shifts TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.shifts TO service_role;
REVOKE ALL ON SEQUENCE public.shifts_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.shifts_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.shifts_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.shifts_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.shifts_id_seq TO service_role;
REVOKE ALL ON TABLE public.stock_config FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_config TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_config TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_config TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_config TO service_role;
REVOKE ALL ON TABLE public.suppliers FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.suppliers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.suppliers TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.suppliers TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.suppliers TO service_role;
REVOKE ALL ON SEQUENCE public.suppliers_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.suppliers_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.suppliers_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.suppliers_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.suppliers_id_seq TO service_role;
REVOKE ALL ON TABLE public.survey_bloques FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_bloques TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_bloques TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_bloques TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_bloques TO service_role;
REVOKE ALL ON SEQUENCE public.survey_bloques_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_bloques_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_bloques_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_bloques_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_bloques_id_seq TO service_role;
REVOKE ALL ON TABLE public.survey_preguntas FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_preguntas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_preguntas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_preguntas TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_preguntas TO service_role;
REVOKE ALL ON SEQUENCE public.survey_preguntas_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_preguntas_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_preguntas_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_preguntas_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_preguntas_id_seq TO service_role;
REVOKE ALL ON TABLE public.survey_responses FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_responses TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_responses TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_responses TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.survey_responses TO service_role;
REVOKE ALL ON SEQUENCE public.survey_responses_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_responses_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_responses_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_responses_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.survey_responses_id_seq TO service_role;
REVOKE ALL ON TABLE public.surveys FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.surveys TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.surveys TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.surveys TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.surveys TO service_role;
REVOKE ALL ON SEQUENCE public.surveys_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.surveys_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.surveys_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.surveys_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.surveys_id_seq TO service_role;
REVOKE ALL ON TABLE public.sync_alert_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_alert_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_alert_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_alert_log TO service_role;
REVOKE ALL ON SEQUENCE public.sync_alert_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_alert_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_alert_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_alert_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_alert_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.sync_log FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_log TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_log TO service_role;
REVOKE ALL ON SEQUENCE public.sync_log_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_log_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_log_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_log_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.sync_log_id_seq TO service_role;
REVOKE ALL ON TABLE public.timesheets FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.timesheets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.timesheets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.timesheets TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.timesheets TO service_role;
REVOKE ALL ON TABLE public.user_dashboard_prefs FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_dashboard_prefs TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_dashboard_prefs TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_dashboard_prefs TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_dashboard_prefs TO service_role;
REVOKE ALL ON TABLE public.v_product_factor FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_factor TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_factor TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_factor TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_product_factor TO service_role;
REVOKE ALL ON TABLE public.v_sync_health FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_sync_health TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_sync_health TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_sync_health TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_sync_health TO service_role;
REVOKE ALL ON TABLE public.vacation_plan_headers FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plan_headers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plan_headers TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plan_headers TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plan_headers TO service_role;
REVOKE ALL ON TABLE public.vacation_plans FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plans TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plans TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plans TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.vacation_plans TO service_role;
REVOKE ALL ON TABLE public.ventas_monthly_stats FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_monthly_stats TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_monthly_stats TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_monthly_stats TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_monthly_stats TO service_role;
REVOKE ALL ON TABLE public.ventas_perdidas FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_perdidas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_perdidas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_perdidas TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ventas_perdidas TO service_role;
REVOKE ALL ON SEQUENCE public.ventas_perdidas_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ventas_perdidas_id_seq TO anon;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ventas_perdidas_id_seq TO authenticated;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ventas_perdidas_id_seq TO postgres;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.ventas_perdidas_id_seq TO service_role;
REVOKE ALL ON TABLE public.wfm_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.wfm_snapshots TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.wfm_snapshots TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.wfm_snapshots TO postgres;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.wfm_snapshots TO service_role;
REVOKE ALL ON FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date) TO postgres;
GRANT EXECUTE ON FUNCTION public.agregar_item_conteo(p_conteo_id uuid, p_erp_product_id integer, p_presentacion text, p_lote text, p_fecha_vencimiento date) TO service_role;
REVOKE ALL ON FUNCTION public.anular_pedido(p_pedido_id uuid, p_anulado_por uuid, p_motivo text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_pedido(p_pedido_id uuid, p_anulado_por uuid, p_motivo text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_pedido(p_pedido_id uuid, p_anulado_por uuid, p_motivo text) TO postgres;
GRANT EXECUTE ON FUNCTION public.anular_pedido(p_pedido_id uuid, p_anulado_por uuid, p_motivo text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_proveedores_categoria_sugerida(p_ids bigint[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_proveedores_categoria_sugerida(p_ids bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_proveedores_categoria_sugerida(p_ids bigint[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.apply_proveedores_categoria_sugerida(p_ids bigint[]) TO service_role;
REVOKE ALL ON FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text, p_note text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text, p_note text) TO postgres;
GRANT EXECUTE ON FUNCTION public.approve_minmax_request(p_request_id bigint, p_decided_by text, p_note text) TO service_role;
REVOKE ALL ON FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text) TO postgres;
GRANT EXECUTE ON FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text) TO service_role;
REVOKE ALL ON FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text) TO postgres;
GRANT EXECUTE ON FUNCTION public.aprobar_conteo_inventario(p_conteo_id uuid, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public.attendance_kiosko_pedido_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attendance_kiosko_pedido_lifecycle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_kiosko_pedido_lifecycle() TO postgres;
GRANT EXECUTE ON FUNCTION public.attendance_kiosko_pedido_lifecycle() TO service_role;
REVOKE ALL ON FUNCTION public.audit_employee_sensitive_changes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.audit_employee_sensitive_changes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_employee_sensitive_changes() TO postgres;
GRANT EXECUTE ON FUNCTION public.audit_employee_sensitive_changes() TO service_role;
REVOKE ALL ON FUNCTION public.auth_can_edit_any(p_modules text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_can_edit_any(p_modules text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_edit_any(p_modules text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_can_edit_any(p_modules text[]) TO service_role;
REVOKE ALL ON FUNCTION public.auth_can_edit_scope_all(p_modules text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_can_edit_scope_all(p_modules text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_can_edit_scope_all(p_modules text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_can_edit_scope_all(p_modules text[]) TO service_role;
REVOKE ALL ON FUNCTION public.auth_employee_branch_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_employee_branch_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_employee_branch_id() TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_employee_branch_id() TO service_role;
REVOKE ALL ON FUNCTION public.auth_employee_erp_sucursal_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_employee_erp_sucursal_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_employee_erp_sucursal_id() TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_employee_erp_sucursal_id() TO service_role;
REVOKE ALL ON FUNCTION public.auth_employee_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_employee_id() TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_employee_id() TO service_role;
REVOKE ALL ON FUNCTION public.auth_employee_role_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_employee_role_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_employee_role_id() TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_employee_role_id() TO service_role;
REVOKE ALL ON FUNCTION public.auth_employee_secondary_role_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_employee_secondary_role_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_employee_secondary_role_id() TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_employee_secondary_role_id() TO service_role;
REVOKE ALL ON FUNCTION public.auth_has_module_permission(p_module_key text, p_action text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_has_module_permission(p_module_key text, p_action text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_has_module_permission(p_module_key text, p_action text) TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_has_module_permission(p_module_key text, p_action text) TO service_role;
REVOKE ALL ON FUNCTION public.auth_module_locked(p_modules text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_module_locked(p_modules text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_module_locked(p_modules text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_module_locked(p_modules text[]) TO service_role;
REVOKE ALL ON FUNCTION public.auth_module_scope(p_module_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_module_scope(p_module_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_module_scope(p_module_key text) TO postgres;
GRANT EXECUTE ON FUNCTION public.auth_module_scope(p_module_key text) TO service_role;
REVOKE ALL ON FUNCTION public.backfill_daily_stats_chunk() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backfill_daily_stats_chunk() TO postgres;
GRANT EXECUTE ON FUNCTION public.backfill_daily_stats_chunk() TO service_role;
REVOKE ALL ON FUNCTION public.backup_dump_table(p_table text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.backup_dump_table(p_table text) TO postgres;
GRANT EXECUTE ON FUNCTION public.backup_dump_table(p_table text) TO service_role;
REVOKE ALL ON FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.calculate_stock_params(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.classify_purchase_dte_review(p_review_id bigint, p_document_id bigint, p_tipo text, p_motivo text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.classify_purchase_dte_review(p_review_id bigint, p_document_id bigint, p_tipo text, p_motivo text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.classify_purchase_dte_review(p_review_id bigint, p_document_id bigint, p_tipo text, p_motivo text) TO postgres;
GRANT EXECUTE ON FUNCTION public.classify_purchase_dte_review(p_review_id bigint, p_document_id bigint, p_tipo text, p_motivo text) TO service_role;
REVOKE ALL ON FUNCTION public.close_ventas_month(p_mes date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_ventas_month(p_mes date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_ventas_month(p_mes date) TO postgres;
GRANT EXECUTE ON FUNCTION public.close_ventas_month(p_mes date) TO service_role;
REVOKE ALL ON FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid, p_revisado_por uuid, p_sucursal_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid, p_revisado_por uuid, p_sucursal_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid, p_revisado_por uuid, p_sucursal_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.confirm_pedido(p_created_by uuid, p_notes text, p_items jsonb, p_responsable_id uuid, p_revisado_por uuid, p_sucursal_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.conteo_costo_unitario(p_product_id integer, p_presentacion text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conteo_costo_unitario(p_product_id integer, p_presentacion text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_costo_unitario(p_product_id integer, p_presentacion text) TO postgres;
GRANT EXECUTE ON FUNCTION public.conteo_costo_unitario(p_product_id integer, p_presentacion text) TO service_role;
REVOKE ALL ON FUNCTION public.conteo_puede_ver_sistema(p_conteo_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conteo_puede_ver_sistema(p_conteo_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conteo_puede_ver_sistema(p_conteo_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.conteo_puede_ver_sistema(p_conteo_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb, p_erp_product_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb, p_erp_product_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb, p_erp_product_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.crear_conteo_inventario(p_branch_id bigint, p_scope_type text, p_scope_filter jsonb, p_erp_product_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.crear_conteos_ciclicos_programados() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_conteos_ciclicos_programados() TO postgres;
GRANT EXECUTE ON FUNCTION public.crear_conteos_ciclicos_programados() TO service_role;
REVOKE ALL ON FUNCTION public.crear_ruta(p_conductor_id uuid, p_conductor_nombre text, p_paradas jsonb, p_distancia_total_m integer, p_duracion_min integer, p_creado_por uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_ruta(p_conductor_id uuid, p_conductor_nombre text, p_paradas jsonb, p_distancia_total_m integer, p_duracion_min integer, p_creado_por uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_ruta(p_conductor_id uuid, p_conductor_nombre text, p_paradas jsonb, p_distancia_total_m integer, p_duracion_min integer, p_creado_por uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.crear_ruta(p_conductor_id uuid, p_conductor_nombre text, p_paradas jsonb, p_distancia_total_m integer, p_duracion_min integer, p_creado_por uuid) TO service_role;
REVOKE ALL ON FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.discard_stock_drafts(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date) TO postgres;
GRANT EXECUTE ON FUNCTION public.editar_lote_conteo_item(p_item_id uuid, p_lote text, p_fecha_vencimiento date) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_numeric_employee_code() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_numeric_employee_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_numeric_employee_code() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_numeric_employee_code() TO service_role;
REVOKE ALL ON FUNCTION public.f_unaccent(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.f_unaccent(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.f_unaccent(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.f_unaccent(text) TO service_role;
REVOKE ALL ON FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.finalizar_conteo_inventario(p_conteo_id uuid, p_pendientes_como_cero boolean) TO service_role;
REVOKE ALL ON FUNCTION public.find_purchase_dte_document_by_codigo(p_codigo text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_purchase_dte_document_by_codigo(p_codigo text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_purchase_dte_document_by_codigo(p_codigo text) TO postgres;
GRANT EXECUTE ON FUNCTION public.find_purchase_dte_document_by_codigo(p_codigo text) TO service_role;
REVOKE ALL ON FUNCTION public.find_sync_gaps(p_date date, p_max_gap integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_sync_gaps(p_date date, p_max_gap integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_sync_gaps(p_date date, p_max_gap integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.find_sync_gaps(p_date date, p_max_gap integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_psp_capture_history() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_psp_capture_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_psp_capture_history() TO postgres;
GRANT EXECUTE ON FUNCTION public.fn_psp_capture_history() TO service_role;
REVOKE ALL ON FUNCTION public.fn_set_item_factor_unidades() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_item_factor_unidades() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_item_factor_unidades() TO postgres;
GRANT EXECUTE ON FUNCTION public.fn_set_item_factor_unidades() TO service_role;
REVOKE ALL ON FUNCTION public.fn_update_product_last_sale() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_product_last_sale() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_product_last_sale() TO postgres;
GRANT EXECUTE ON FUNCTION public.fn_update_product_last_sale() TO service_role;
REVOKE ALL ON FUNCTION public.generate_wfm_snapshot(p_branch_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_wfm_snapshot(p_branch_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_wfm_snapshot(p_branch_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.generate_wfm_snapshot(p_branch_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.get_active_product_lab_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_product_lab_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_product_lab_counts() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_active_product_lab_counts() TO service_role;
REVOKE ALL ON FUNCTION public.get_ccf_alerts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ccf_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ccf_alerts() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_ccf_alerts() TO service_role;
REVOKE ALL ON FUNCTION public.get_consecutive_mh_alerts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_consecutive_mh_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_consecutive_mh_alerts() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_consecutive_mh_alerts() TO service_role;
REVOKE ALL ON FUNCTION public.get_conteo_item_history(p_item_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conteo_item_history(p_item_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conteo_item_history(p_item_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_conteo_item_history(p_item_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_conteo_items_count(p_conteo_id uuid, p_search text, p_filtro text, p_erp_product_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_count(p_conteo_id uuid, p_search text, p_filtro text, p_erp_product_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_count(p_conteo_id uuid, p_search text, p_filtro text, p_erp_product_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_count(p_conteo_id uuid, p_search text, p_filtro text, p_erp_product_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer, p_erp_product_id integer, p_erp_product_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer, p_erp_product_id integer, p_erp_product_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer, p_erp_product_id integer, p_erp_product_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_conteo_items_search(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer, p_erp_product_id integer, p_erp_product_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_conteo_products_count(p_conteo_id uuid, p_search text, p_filtro text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_count(p_conteo_id uuid, p_search text, p_filtro text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_count(p_conteo_id uuid, p_search text, p_filtro text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_count(p_conteo_id uuid, p_search text, p_filtro text) TO service_role;
REVOKE ALL ON FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_page(p_conteo_id uuid, p_search text, p_filtro text, p_limit integer, p_offset integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_draft_cost_estimate(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_inventory_cost_summary(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_kiosk_auth_code(p_branch_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kiosk_auth_code(p_branch_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kiosk_auth_code(p_branch_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_kiosk_auth_code(p_branch_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_kiosk_boot_payload(p_device_id uuid, p_device_token uuid, p_week_start date) TO service_role;
REVOKE ALL ON FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date) TO anon;
GRANT EXECUTE ON FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_kiosk_coverage_employees(p_branch_id bigint, p_week_start date) TO service_role;
REVOKE ALL ON FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_last_sale_dates(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_lockable_modules() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_lockable_modules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lockable_modules() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_lockable_modules() TO service_role;
REVOKE ALL ON FUNCTION public.get_logistics_chief_ids() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_logistics_chief_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_logistics_chief_ids() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_logistics_chief_ids() TO service_role;
REVOKE ALL ON FUNCTION public.get_minmax_approver_ids() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_minmax_approver_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_minmax_approver_ids() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_minmax_approver_ids() TO service_role;
REVOKE ALL ON FUNCTION public.get_network_summary_json() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_network_summary_json() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_network_summary_json() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_network_summary_json() TO service_role;
REVOKE ALL ON FUNCTION public.get_no_sales_products(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_no_sales_products(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_no_sales_products(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_no_sales_products(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_pausa_razones_stats(p_desde date, p_hasta date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pausa_razones_stats(p_desde date, p_hasta date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pausa_razones_stats(p_desde date, p_hasta date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pausa_razones_stats(p_desde date, p_hasta date) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_diferencias_stats(p_desde timestamp with time zone, p_hasta timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_diferencias_stats(p_desde timestamp with time zone, p_hasta timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_diferencias_stats(p_desde timestamp with time zone, p_hasta timestamp with time zone) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_diferencias_stats(p_desde timestamp with time zone, p_hasta timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_generar_dashboard(p_sucursal_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_generar_dashboard(p_sucursal_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_generar_dashboard(p_sucursal_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_generar_dashboard(p_sucursal_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_item_stats(p_pedido_ids uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_kpis(p_desde date, p_hasta date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_kpis(p_desde date, p_hasta date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_kpis(p_desde date, p_hasta date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_kpis(p_desde date, p_hasta date) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_preview(p_sucursal_ids integer[], p_target_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_preview(p_sucursal_ids integer[], p_target_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_preview(p_sucursal_ids integer[], p_target_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_preview(p_sucursal_ids integer[], p_target_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_sin_bodega(p_sucursal_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_sin_bodega(p_sucursal_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_sin_bodega(p_sucursal_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_sin_bodega(p_sucursal_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedido_sucursal_stats(p_sucursal_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedido_sucursal_stats(p_sucursal_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedido_sucursal_stats(p_sucursal_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedido_sucursal_stats(p_sucursal_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_pedidos_en_curso() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pedidos_en_curso() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pedidos_en_curso() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pedidos_en_curso() TO service_role;
REVOKE ALL ON FUNCTION public.get_precio_tipo(p_precio_unitario numeric, p_product_id integer, p_id_presentacion integer, p_fecha date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_precio_tipo(p_precio_unitario numeric, p_product_id integer, p_id_presentacion integer, p_fecha date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_precio_tipo(p_precio_unitario numeric, p_product_id integer, p_id_presentacion integer, p_fecha date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_precio_tipo(p_precio_unitario numeric, p_product_id integer, p_id_presentacion integer, p_fecha date) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_branch_summary(p_erp_product_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_branch_summary(p_erp_product_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_branch_summary(p_erp_product_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_branch_summary(p_erp_product_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_drill_lines(p_erp_product_id integer, p_fini date, p_ffin date, p_branch_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_expiring_lots(p_erp_product_id integer, p_days_ahead integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_expiring_lots(p_erp_product_id integer, p_days_ahead integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_expiring_lots(p_erp_product_id integer, p_days_ahead integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_expiring_lots(p_erp_product_id integer, p_days_ahead integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_last_sales(p_erp_product_id integer, p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_last_sales(p_erp_product_id integer, p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_last_sales(p_erp_product_id integer, p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_last_sales(p_erp_product_id integer, p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer, p_search text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer, p_search text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer, p_search text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg(p_fini date, p_ffin date, p_branch_id integer, p_search text) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_sales_agg_jsonb(p_fini date, p_ffin date, p_branch_id integer, p_search text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg_jsonb(p_fini date, p_ffin date, p_branch_id integer, p_search text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg_jsonb(p_fini date, p_ffin date, p_branch_id integer, p_search text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_sales_agg_jsonb(p_fini date, p_ffin date, p_branch_id integer, p_search text) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_sales_total(p_fini date, p_ffin date, p_branch_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_sales_total(p_fini date, p_ffin date, p_branch_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_sales_total(p_fini date, p_ffin date, p_branch_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_sales_total(p_fini date, p_ffin date, p_branch_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_trend(p_erp_product_id integer, p_branch_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_trend(p_erp_product_id integer, p_branch_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_trend(p_erp_product_id integer, p_branch_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_trend(p_erp_product_id integer, p_branch_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_product_vencimiento_policy(p_erp_product_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_vencimiento_policy(p_erp_product_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_vencimiento_policy(p_erp_product_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_product_vencimiento_policy(p_erp_product_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_products_sold_no_minmax(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_products_sold_no_minmax_jsonb(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_products_sold_no_minmax_jsonb(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_products_sold_no_minmax_jsonb(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_products_sold_no_minmax_jsonb(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_proveedores_maestro() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_proveedores_maestro() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_proveedores_maestro() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_proveedores_maestro() TO service_role;
REVOKE ALL ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_purchase_dte_documents(p_desde date, p_hasta date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_documents(p_desde date, p_hasta date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_documents(p_desde date, p_hasta date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_documents(p_desde date, p_hasta date) TO service_role;
REVOKE ALL ON FUNCTION public.get_purchase_dte_review_queue(p_status text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_queue(p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_queue(p_status text) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_queue(p_status text) TO service_role;
REVOKE ALL ON FUNCTION public.get_purchase_dte_review_source(p_document_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_source(p_document_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_source(p_document_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_purchase_dte_review_source(p_document_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_stagnant_inventory_jsonb(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_stagnant_inventory_jsonb(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_stock_analysis(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_stock_analysis_jsonb(p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stock_analysis_jsonb(p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_analysis_jsonb(p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_stock_analysis_jsonb(p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_sucursal_net_stock(p_product_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sucursal_net_stock(p_product_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sucursal_net_stock(p_product_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_sucursal_net_stock(p_product_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_top_supplier_per_product(p_product_ids integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_supplier_per_product(p_product_ids integer[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_supplier_per_product(p_product_ids integer[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_top_supplier_per_product(p_product_ids integer[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_vendedor_diario(p_branch_id bigint, p_cod_vendedor text, p_fini date, p_ffin date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vendedor_diario(p_branch_id bigint, p_cod_vendedor text, p_fini date, p_ffin date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendedor_diario(p_branch_id bigint, p_cod_vendedor text, p_fini date, p_ffin date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_vendedor_diario(p_branch_id bigint, p_cod_vendedor text, p_fini date, p_ffin date) TO service_role;
REVOKE ALL ON FUNCTION public.get_vendedor_diario(p_cod_vendedor text, p_fini date, p_ffin date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vendedor_diario(p_cod_vendedor text, p_fini date, p_ffin date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendedor_diario(p_cod_vendedor text, p_fini date, p_ffin date) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_vendedor_diario(p_cod_vendedor text, p_fini date, p_ffin date) TO service_role;
REVOKE ALL ON FUNCTION public.get_vendedores_resumen(p_fini date, p_ffin date, p_branch_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vendedores_resumen(p_fini date, p_ffin date, p_branch_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vendedores_resumen(p_fini date, p_ffin date, p_branch_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_vendedores_resumen(p_fini date, p_ffin date, p_branch_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.get_ventas_con_puntos(p_fini date, p_ffin date, p_branch_id bigint, p_sort_col text, p_sort_dir text, p_limit integer, p_offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ventas_con_puntos(p_fini date, p_ffin date, p_branch_id bigint, p_sort_col text, p_sort_dir text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ventas_con_puntos(p_fini date, p_ffin date, p_branch_id bigint, p_sort_col text, p_sort_dir text, p_limit integer, p_offset integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_ventas_con_puntos(p_fini date, p_ffin date, p_branch_id bigint, p_sort_col text, p_sort_dir text, p_limit integer, p_offset integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_ventas_stats(p_fini date, p_ffin date, p_branch_id integer, p_hora_corte time without time zone) TO service_role;
REVOKE ALL ON FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text, p_estado_item text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text, p_estado_item text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text, p_estado_item text) TO postgres;
GRANT EXECUTE ON FUNCTION public.guardar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text, p_estado_item text) TO service_role;
REVOKE ALL ON FUNCTION public.init_pedido_sucursal_codigos(p_pedido_id uuid, p_codigos jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.init_pedido_sucursal_codigos(p_pedido_id uuid, p_codigos jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.init_pedido_sucursal_codigos(p_pedido_id uuid, p_codigos jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.init_pedido_sucursal_codigos(p_pedido_id uuid, p_codigos jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.insert_missing_products(p_rows json) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_missing_products(p_rows json) TO postgres;
GRANT EXECUTE ON FUNCTION public.insert_missing_products(p_rows json) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_grouped(p_erp_id integer, p_vencidos boolean, p_proximos boolean, p_search text, p_lab_id integer, p_categoria text, p_sort text, p_sort_dir text, p_limit integer, p_offset integer, p_area_vencidos boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_grouped(p_erp_id integer, p_vencidos boolean, p_proximos boolean, p_search text, p_lab_id integer, p_categoria text, p_sort text, p_sort_dir text, p_limit integer, p_offset integer, p_area_vencidos boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_grouped(p_erp_id integer, p_vencidos boolean, p_proximos boolean, p_search text, p_lab_id integer, p_categoria text, p_sort text, p_sort_dir text, p_limit integer, p_offset integer, p_area_vencidos boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.inventory_grouped(p_erp_id integer, p_vencidos boolean, p_proximos boolean, p_search text, p_lab_id integer, p_categoria text, p_sort text, p_sort_dir text, p_limit integer, p_offset integer, p_area_vencidos boolean) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_inversion(p_erp_id integer, p_search text, p_lab_id integer, p_categoria text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_inversion(p_erp_id integer, p_search text, p_lab_id integer, p_categoria text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_inversion(p_erp_id integer, p_search text, p_lab_id integer, p_categoria text) TO postgres;
GRANT EXECUTE ON FUNCTION public.inventory_inversion(p_erp_id integer, p_search text, p_lab_id integer, p_categoria text) TO service_role;
REVOKE ALL ON FUNCTION public.inventory_proximos_count(p_erp_id integer, p_lab_id integer, p_categoria text, p_search text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.inventory_proximos_count(p_erp_id integer, p_lab_id integer, p_categoria text, p_search text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_proximos_count(p_erp_id integer, p_lab_id integer, p_categoria text, p_search text) TO postgres;
GRANT EXECUTE ON FUNCTION public.inventory_proximos_count(p_erp_id integer, p_lab_id integer, p_categoria text, p_search text) TO service_role;
REVOKE ALL ON FUNCTION public.kiosk_auth_code_for(p_branch_id bigint, p_bucket timestamp with time zone, p_su boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.kiosk_auth_code_for(p_branch_id bigint, p_bucket timestamp with time zone, p_su boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.kiosk_auth_code_for(p_branch_id bigint, p_bucket timestamp with time zone, p_su boolean) TO service_role;
REVOKE ALL ON FUNCTION public.lock_module(p_module_key text, p_reason text, p_hours integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_module(p_module_key text, p_reason text, p_hours integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_module(p_module_key text, p_reason text, p_hours integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.lock_module(p_module_key text, p_reason text, p_hours integer) TO service_role;
REVOKE ALL ON FUNCTION public.marcar_ajuste_erp(p_conteo_id uuid, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_ajuste_erp(p_conteo_id uuid, p_nota text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_ajuste_erp(p_conteo_id uuid, p_nota text) TO postgres;
GRANT EXECUTE ON FUNCTION public.marcar_ajuste_erp(p_conteo_id uuid, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public.marcar_pedido_enviado(p_pedido_id uuid, p_enviado_por uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_pedido_enviado(p_pedido_id uuid, p_enviado_por uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_pedido_enviado(p_pedido_id uuid, p_enviado_por uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.marcar_pedido_enviado(p_pedido_id uuid, p_enviado_por uuid) TO service_role;
REVOKE ALL ON FUNCTION public.merge_purchase_dte_documents(p_target_id bigint, p_source_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merge_purchase_dte_documents(p_target_id bigint, p_source_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_purchase_dte_documents(p_target_id bigint, p_source_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.merge_purchase_dte_documents(p_target_id bigint, p_source_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.minmax_effective(p_base integer, p_manual integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.minmax_effective(p_base integer, p_manual integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minmax_effective(p_base integer, p_manual integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.minmax_effective(p_base integer, p_manual integer) TO service_role;
REVOKE ALL ON FUNCTION public.next_cotizacion_numero() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_cotizacion_numero() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_cotizacion_numero() TO postgres;
GRANT EXECUTE ON FUNCTION public.next_cotizacion_numero() TO service_role;
REVOKE ALL ON FUNCTION public.norm_search(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.norm_search(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.norm_search(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.norm_search(text) TO service_role;
REVOKE ALL ON FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_branch(p_branch_id integer, p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean) TO service_role;
REVOKE ALL ON FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean, p_branch_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean, p_branch_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean, p_branch_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_employees(p_recipients uuid[], p_type text, p_title text, p_body text, p_link text, p_metadata jsonb, p_push boolean, p_branch_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.notify_missing_roster() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_missing_roster() TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_missing_roster() TO service_role;
REVOKE ALL ON FUNCTION public.notify_push_on_announcement() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_push_on_announcement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_push_on_announcement() TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_push_on_announcement() TO service_role;
REVOKE ALL ON FUNCTION public.preview_muestra_ciclica(p_branch_id bigint, p_tamano integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_muestra_ciclica(p_branch_id bigint, p_tamano integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_muestra_ciclica(p_branch_id bigint, p_tamano integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.preview_muestra_ciclica(p_branch_id bigint, p_tamano integer) TO service_role;
REVOKE ALL ON FUNCTION public.publish_stock_params(p_erp_sucursal_id integer, p_erp_product_ids integer[], p_published_by text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_stock_params(p_erp_sucursal_id integer, p_erp_product_ids integer[], p_published_by text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_stock_params(p_erp_sucursal_id integer, p_erp_product_ids integer[], p_published_by text) TO postgres;
GRANT EXECUTE ON FUNCTION public.publish_stock_params(p_erp_sucursal_id integer, p_erp_product_ids integer[], p_published_by text) TO service_role;
REVOKE ALL ON FUNCTION public.push_function_url() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.push_function_url() TO authenticated;
GRANT EXECUTE ON FUNCTION public.push_function_url() TO postgres;
GRANT EXECUTE ON FUNCTION public.push_function_url() TO service_role;
REVOKE ALL ON FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.recalcular_totales_conteo(p_conteo_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.receive_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receive_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.receive_pedido_sucursal(p_pedido_id uuid, p_sucursal_id integer, p_items jsonb, p_received_by uuid) TO service_role;
REVOKE ALL ON FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text) TO postgres;
GRANT EXECUTE ON FUNCTION public.recontar_conteo_item(p_item_id uuid, p_fisico_cantidad integer, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_inventory_grouped_mv() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_inventory_grouped_mv() TO postgres;
GRANT EXECUTE ON FUNCTION public.refresh_inventory_grouped_mv() TO service_role;
REVOKE ALL ON FUNCTION public.refresh_product_sales_monthly_agg(p_months_back integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_product_sales_monthly_agg(p_months_back integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.refresh_product_sales_monthly_agg(p_months_back integer) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_product_sales_rollup() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_product_sales_rollup() TO postgres;
GRANT EXECUTE ON FUNCTION public.refresh_product_sales_rollup() TO service_role;
REVOKE ALL ON FUNCTION public.refresh_sales_daily_stats(p_days_back integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_sales_daily_stats(p_days_back integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.refresh_sales_daily_stats(p_days_back integer) TO service_role;
REVOKE ALL ON FUNCTION public.reject_minmax_request(p_request_id bigint, p_decided_by text, p_note text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_minmax_request(p_request_id bigint, p_decided_by text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_minmax_request(p_request_id bigint, p_decided_by text, p_note text) TO postgres;
GRANT EXECUTE ON FUNCTION public.reject_minmax_request(p_request_id bigint, p_decided_by text, p_note text) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid, p_tipo text, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid, p_tipo text, p_nota text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid, p_tipo text, p_nota text) TO postgres;
GRANT EXECUTE ON FUNCTION public.resolve_pedido_item(p_item_id integer, p_action text, p_user_id uuid, p_tipo text, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_purchase_dte_review(p_review_id bigint, p_action text, p_matched_document_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_dte_review(p_review_id bigint, p_action text, p_matched_document_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_dte_review(p_review_id bigint, p_action text, p_matched_document_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.resolve_purchase_dte_review(p_review_id bigint, p_action text, p_matched_document_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text) TO postgres;
GRANT EXECUTE ON FUNCTION public.save_pedido_snapshot(p_sucursal_ids integer[], p_nombre text) TO service_role;
REVOKE ALL ON FUNCTION public.search_inventory_descripcion_ids(p_search text, p_erp_sucursal_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_inventory_descripcion_ids(p_search text, p_erp_sucursal_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_inventory_descripcion_ids(p_search text, p_erp_sucursal_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.search_inventory_descripcion_ids(p_search text, p_erp_sucursal_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.search_ventas_ids(p_search text, p_fini date, p_ffin date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_ventas_ids(p_search text, p_fini date, p_ffin date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_ventas_ids(p_search text, p_fini date, p_ffin date) TO postgres;
GRANT EXECUTE ON FUNCTION public.search_ventas_ids(p_search text, p_fini date, p_ffin date) TO service_role;
REVOKE ALL ON FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.seleccionar_muestra_ciclica(p_branch_id bigint, p_tamano integer) TO service_role;
REVOKE ALL ON FUNCTION public.set_kiosk_pin(p_employee_id uuid, p_pin text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_kiosk_pin(p_employee_id uuid, p_pin text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_kiosk_pin(p_employee_id uuid, p_pin text) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_kiosk_pin(p_employee_id uuid, p_pin text) TO service_role;
REVOKE ALL ON FUNCTION public.set_proveedor_categoria(p_id bigint, p_categoria_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_proveedor_categoria(p_id bigint, p_categoria_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_proveedor_categoria(p_id bigint, p_categoria_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_proveedor_categoria(p_id bigint, p_categoria_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.set_proveedores_categoria_bulk(p_ids bigint[], p_categoria_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_proveedores_categoria_bulk(p_ids bigint[], p_categoria_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_proveedores_categoria_bulk(p_ids bigint[], p_categoria_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_proveedores_categoria_bulk(p_ids bigint[], p_categoria_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.set_purchase_dte_proveedor(p_document_id bigint, p_proveedor_id bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_purchase_dte_proveedor(p_document_id bigint, p_proveedor_id bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_purchase_dte_proveedor(p_document_id bigint, p_proveedor_id bigint) TO postgres;
GRANT EXECUTE ON FUNCTION public.set_purchase_dte_proveedor(p_document_id bigint, p_proveedor_id bigint) TO service_role;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO postgres;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.suggest_proveedor_categoria_id(p_desc_actividad text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suggest_proveedor_categoria_id(p_desc_actividad text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_proveedor_categoria_id(p_desc_actividad text) TO postgres;
GRANT EXECUTE ON FUNCTION public.suggest_proveedor_categoria_id(p_desc_actividad text) TO service_role;
REVOKE ALL ON FUNCTION public.sync_bodega_draft_from_branch_stmt() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_bodega_draft_from_branch_stmt() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_bodega_draft_from_branch_stmt() TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_bodega_draft_from_branch_stmt() TO service_role;
REVOKE ALL ON FUNCTION public.sync_inventory_batch(p_erp_sucursal_id integer, p_is_vencidos boolean, p_rows jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_inventory_batch(p_erp_sucursal_id integer, p_is_vencidos boolean, p_rows jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_inventory_batch(p_erp_sucursal_id integer, p_is_vencidos boolean, p_rows jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.sync_laboratorios_batch(p_rows json) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_laboratorios_batch(p_rows json) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_laboratorios_batch(p_rows json) TO service_role;
REVOKE ALL ON FUNCTION public.sync_presentaciones_batch(p_rows json) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_presentaciones_batch(p_rows json) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_presentaciones_batch(p_rows json) TO service_role;
REVOKE ALL ON FUNCTION public.sync_purchase_receipt_items_batch(p_rows json) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_purchase_receipt_items_batch(p_rows json) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_purchase_receipt_items_batch(p_rows json) TO service_role;
REVOKE ALL ON FUNCTION public.sync_suppliers_batch(p_rows json) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_suppliers_batch(p_rows json) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_suppliers_batch(p_rows json) TO service_role;
REVOKE ALL ON FUNCTION public.toggle_producto_oculto_ventas(p_erp_product_id integer, p_oculto boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.toggle_producto_oculto_ventas(p_erp_product_id integer, p_oculto boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_producto_oculto_ventas(p_erp_product_id integer, p_oculto boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.toggle_producto_oculto_ventas(p_erp_product_id integer, p_oculto boolean) TO service_role;
REVOKE ALL ON FUNCTION public.touch_promotions_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_promotions_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_promotions_updated_at() TO postgres;
GRANT EXECUTE ON FUNCTION public.touch_promotions_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.unlock_module(p_module_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlock_module(p_module_key text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_module(p_module_key text) TO postgres;
GRANT EXECUTE ON FUNCTION public.unlock_module(p_module_key text) TO service_role;
REVOKE ALL ON FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid, p_razon text, p_nota text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid, p_razon text, p_nota text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid, p_razon text, p_nota text) TO postgres;
GRANT EXECUTE ON FUNCTION public.update_pedido_sucursal_lifecycle(p_pedido_id uuid, p_sucursal_id integer, p_stage text, p_user_id uuid, p_razon text, p_nota text) TO service_role;
REVOKE ALL ON FUNCTION public.update_proveedor_manual(p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text, p_notas text, p_activo boolean, p_alias text, p_percibe_1_override boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_proveedor_manual(p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text, p_notas text, p_activo boolean, p_alias text, p_percibe_1_override boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_proveedor_manual(p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text, p_notas text, p_activo boolean, p_alias text, p_percibe_1_override boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.update_proveedor_manual(p_id bigint, p_contacto_nombre text, p_telefono2 text, p_nombre_cheques text, p_notas text, p_activo boolean, p_alias text, p_percibe_1_override boolean) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_customers(names text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_customers(names text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_customers(names text[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.upsert_customers(names text[]) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_product_precios_batch(p_rows jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_product_precios_batch(p_rows jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.upsert_product_precios_batch(p_rows jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_products_minimal(p_rows json) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_products_minimal(p_rows json) TO postgres;
GRANT EXECUTE ON FUNCTION public.upsert_products_minimal(p_rows json) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_proveedor_from_dte(p_data jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(p_data jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.upsert_proveedor_from_dte(p_data jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.validate_role_headcount(p_role_id integer, p_branch_id integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_role_headcount(p_role_id integer, p_branch_id integer) TO postgres;
GRANT EXECUTE ON FUNCTION public.validate_role_headcount(p_role_id integer, p_branch_id integer) TO service_role;
REVOKE ALL ON FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text) TO postgres;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text) TO service_role;
REVOKE ALL ON FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_device(p_device_id uuid, p_device_token uuid) TO service_role;
REVOKE ALL ON FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text) TO postgres;
GRANT EXECUTE ON FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text) TO service_role;
REVOKE ALL ON FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_published_by text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_published_by text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_published_by text) TO postgres;
GRANT EXECUTE ON FUNCTION public.zero_out_product_all_branches(p_erp_product_id integer, p_published_by text) TO service_role;


-- ── Publicaciones (Realtime) (14) ──────────────────────────────────────────

DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN CREATE PUBLICATION supabase_realtime WITH (publish='insert, update, delete, truncate'); END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='announcements') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.announcements; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='inventory_sync_log') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.inventory_sync_log; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='module_locks') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.module_locks; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='notifications') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.notifications; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='pedido_item_eventos') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.pedido_item_eventos; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='pedido_items') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.pedido_items; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='pedido_sucursal_status') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.pedido_sucursal_status; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='pedidos') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.pedidos; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='role_permissions') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.role_permissions; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='ruta_locations') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.ruta_locations; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='ruta_pedidos') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.ruta_pedidos; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='rutas') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.rutas; END IF; END $do$;
DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE pb.pubname='supabase_realtime' AND n.nspname='public' AND c.relname='ventas_perdidas') THEN ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.ventas_perdidas; END IF; END $do$;


-- ── Comentarios (49) ───────────────────────────────────────────────────────

COMMENT ON TABLE public.conteo_inventario_item_history IS 'Historial append-only de cada guardado de un ítem de conteo (quién contó, cuándo, y con qué valores) — incluye ediciones posteriores al primer conteo. Solo se escribe vía la función guardar_conteo_item (SECURITY DEFINER); sin policy de INSERT/UPDATE/DELETE para authenticated.';
COMMENT ON TABLE public.conteo_inventario_items IS 'Líneas de conteo, grano lote+presentación (copia literal de inventory al crear el conteo, sin reconvertir factor). costo_unitario es aproximado (MIN costo activo del producto) solo para valorar la diferencia.';
COMMENT ON TABLE public.conteos_inventario IS 'Conteo físico de inventario por sucursal/bodega. NO ajusta inventory (esa tabla la llena el sync del ERP) — solo detecta, documenta y deja firma de aprobación auditable de faltantes/sobrantes.';
COMMENT ON TABLE public.dispatch_rules IS 'Reglas de despacho por producto. Migradas desde Google Sheets. solo_cajas=true: solo cajas completas. multiplo=N: cantidades múltiplo de N. blister=N: múltiplo de N blísters.';
COMMENT ON TABLE public.education_catalog_entries IS 'Catálogo unificado de valores de select-con-"Otra..." del modal de Empleado (especialidades, profesiones, maestrías/postgrados, cursos/habilidades, instituciones de capacitación). Append-only (sin policy de UPDATE/DELETE) — cualquier valor tecleado en "Otra..." se agrega aquí vía upsert para el próximo registro.';
COMMENT ON TABLE public.inventory IS 'Current inventory snapshot per branch+presentation+lote. Replaced on each sync.';
COMMENT ON TABLE public.kiosk_credentials IS 'Hash bcrypt del PIN de kiosco. RLS sin policies a proposito: acceso solo via RPC SECURITY DEFINER. Nunca exponer pin_hash a la API.';
COMMENT ON TABLE public.kiosk_pin_attempts IS 'Intentos de PIN por dispositivo, para rate limiting. Retencion 30 dias via purge-sync-logs-daily.';
COMMENT ON TABLE public.module_locks IS 'Candado de mantenimiento por módulo: pone el módulo en solo-lectura para todos menos su titular. NO detiene crons ni edge functions (service_role saltea RLS).';
COMMENT ON TABLE public.pedido_items IS 'Detalle por producto/presentación/sucursal de un pedido. cantidad_asignada en packs comerciales (misma unidad que erp_minmax.max_qty). sin_stock=true cuando bodega no puede cubrir nada. revision_minmax=true cuando el asignado no alcanza un pack completo.';
COMMENT ON TABLE public.pedidos IS 'Cabecera de un pedido de reposición generado desde Bodega. status=confirmado: generado. parcial: alguna sucursal con diferencia. anulado: cancelado.';
COMMENT ON TABLE public.practicantes IS 'Estudiantes en horas sociales / pasantías académicas no remuneradas. Fuera de employees a propósito (sin kiosk_pin/ISSS/AFP/nómina) para no generar rastro de subordinación laboral (Art. 20 Código de Trabajo). Se muestran fusionados dentro de Gestión de Personal (StaffManagementView) con badge "Practicante", gateados bajo el mismo permiso staff_list — no tienen módulo/vista propia en Permisos.';
COMMENT ON TABLE public.purchase_dte_processed_messages IS 'Ledger de mensajes de Gmail ya procesados por sync-purchase-emails — fuente única de "ya visto" para no re-escanear. NUNCA agregar a un cron de purga: borrar filas de acá hace que esos mensajes se re-escaneen desde Gmail en la próxima corrida (potencialmente el historial completo).';
COMMENT ON VIEW public.v_product_factor IS 'Factor oficial por (product_id, presentacion). JOIN: vf.product_id = erp_product_id AND vf.pres_key = UPPER(TRIM(inventory.presentacion))';
COMMENT ON TABLE public.wfm_snapshots IS 'Memoria histórica semanal de cálculos WFM. Alimenta tendencias y el bot de Telegram de RRHH.';
COMMENT ON COLUMN public.branches.conteo_ciclico_activo IS 'La sucursal recibe automáticamente su conteo cíclico el 15 de cada mes.';
COMMENT ON COLUMN public.conteos_inventario.ajuste_erp_aplicado IS 'El ajuste de este conteo ya fue tecleado en el ERP. El portal no escribe stock: esto es constancia, no efecto.';
COMMENT ON COLUMN public.email_sync_accounts.vault_secret_name IS 'Nombre del secret de la edge function (Deno.env.get), pese al nombre de la columna NO es un secret de Supabase Vault — mismo patrón que ERP_PURCHASES_CREDS/GEMINI_API_KEY.';
COMMENT ON COLUMN public.employees.additional_skills IS 'Cursos/habilidades adicionales: array de objetos {skill, institution, hours} — cada uno completo, no solo texto libre.';
COMMENT ON COLUMN public.employees.education_grade_completed IS 'Grado finalizado cuando education_level = EDUCACION_BASICA (ej. "6to grado")';
COMMENT ON COLUMN public.employees.education_specialty IS 'Especialidad cuando education_level = BACHILLERATO_TECNICO o TECNICO_SUPERIOR';
COMMENT ON COLUMN public.employees.extra_addresses IS 'Direcciones alternas adicionales: array de objetos {department, municipality, address}, cada una completa (no solo texto libre)';
COMMENT ON COLUMN public.employees.extra_phones IS 'Números de teléfono adicionales, además de phone (principal)';
COMMENT ON COLUMN public.employees.has_maestria IS 'Solo aplica si education_level=UNIVERSITARIO — indica si además tiene una maestría/postgrado';
COMMENT ON COLUMN public.employees.is_studying IS 'true si actualmente cursa el nivel académico indicado';
COMMENT ON COLUMN public.employees.maestria_title IS 'Título de la maestría/postgrado (catálogo MAESTRIA_POSTGRADO), solo si has_maestria=true';
COMMENT ON COLUMN public.employees.nursing_license_number IS 'Número de carné JVPE (Junta de Vigilancia de la Profesión de Enfermería)';
COMMENT ON COLUMN public.employees.pharmacist_license_number IS 'Número de carné JVPQF (Junta de Vigilancia de la Profesión Químico Farmacéutica) — Regente/Químico Farmacéutico';
COMMENT ON COLUMN public.employees.study_duration_years IS 'Duración estimada en años de la carrera/programa en curso';
COMMENT ON COLUMN public.employees.study_start_date IS 'Mes/año de inicio de estudios en curso (día siempre 01)';
COMMENT ON COLUMN public.erp_sucursal_map.inv_ubicaciones IS 'Ubicaciones ERP a descargar en el sync de inventario: [{"id":int,"isVencidos":bool}]. NULL = usa la config del secret ERP_INV_BRANCH_MAP.';
COMMENT ON COLUMN public.inventory.erp_sucursal_id IS '1=Salud1, 2=Salud2, 3=Salud3, 4=Salud4, 5=LaPopular, 6=Bodega, 7=Salud5';
COMMENT ON COLUMN public.inventory.is_vencidos IS 'true = bodega vencidos shelf (id_ubicacion=2)';
COMMENT ON COLUMN public.practicantes.birth_date IS 'Determina mayoría/minoría de edad (Art. 23.2 CT: menores usan documento alterno en vez de DUI, que no se tramita hasta los 18). No es NOT NULL — igual que employees.birth_date, se trata como dato opcional/pendiente si falta.';
COMMENT ON COLUMN public.products.oculto_at IS 'Fecha/hora en que se ocultó (NULL cuando visible)';
COMMENT ON COLUMN public.products.oculto_en_ventas IS 'Oculta el producto del reporte Ventas > Productos para todos los usuarios (ej. líneas no-farmacéuticas como recargas/comisiones). No afecta Catálogo/Inventario/MinMax.';
COMMENT ON COLUMN public.products.oculto_por IS 'Empleado que ocultó el producto de Ventas > Productos (NULL cuando visible)';
COMMENT ON COLUMN public.products.sin_principio_activo IS 'true = producto no tiene principio activo por naturaleza (insumo, equipo, cosmético, etc.) — excluir del enriquecimiento SRS';
COMMENT ON COLUMN public.proveedores_maestro.percibe_1_override IS 'NULL = percibe_1 se deriva automático de los DTEs. true/false = el usuario lo fijó manualmente en update_proveedor_manual; upsert_proveedor_from_dte respeta este valor y no lo pisa con la detección automática.';
COMMENT ON COLUMN public.purchase_dte_documents.orig_json_path IS 'Bytes originales del adjunto/link tal cual llegaron, sin unwrapDteEnvelope ni repairMojibakeDeep — respaldo de integridad (Decreto 487 Art. 3). json_path (normalizado) es la fuente para UI/búsqueda; este campo no se expone en get_purchase_dte_documents.';
COMMENT ON COLUMN public.rutas.visitas IS 'Paradas extra sin pedido asociado (encargos, visitas). Array de {erp_sucursal_id, suc_name, orden, dist_m, dur_min, tipo}.';
COMMENT ON COLUMN public.stock_config.pedido_recepcion_activa IS 'Flag temporal (2026-07-17): activa el descuento de pedido_items pendientes contra el stock de Bodega en get_pedido_generar_dashboard (CTE pending_committed). false mientras las sucursales no tengan acceso al flujo de Confirmar Recepción (RecepcionModal) -- si no, el backlog de items nunca confirmados infla el "comprometido" indefinidamente y Bodega aparece con falso "sin stock" (ver caso Micropore 1x5, 2026-07-17). Poner en true cuando el flujo de recepción esté en uso real por todas las sucursales.';
COMMENT ON COLUMN public.timesheets.nocturnal_hours IS 'Horas ordinarias trabajadas en jornada nocturna (19:00-06:00 CST) — sujetas al 25% de recargo según Art. 168 Código de Trabajo SV';
COMMENT ON COLUMN public.timesheets.nocturnal_overtime_hours IS 'Horas extra trabajadas en jornada nocturna (19:00-06:00 CST) — sujetas al 100% OT + 25% nocturnal = ×2.25 según Art. 169';
COMMENT ON FUNCTION public.close_ventas_month(p_mes date) IS 'Auth: Audit trail for user actions.';
COMMENT ON FUNCTION public.get_kiosk_auth_code(p_branch_id bigint) IS 'Codigo horario de autorizacion del kiosco, para que el jefe lo lea en el portal. Gated por kiosk_pin/can_view. Rota cada hora y es distinto por sucursal.';
COMMENT ON FUNCTION public.get_puntos_canjeados(p_fini date, p_ffin date, p_branch_id integer) IS 'Auth: Manages updates to the auth system.';
COMMENT ON FUNCTION public.verify_kiosk_authorization(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_code text) IS 'Autoriza una excepcion de marcaje desde un kiosco vinculado: acepta el codigo horario del servidor o el PIN personal de un supervisor de la sucursal. anon a proposito (el kiosco es pre-login); valida device_token y aplica rate limit.';
COMMENT ON FUNCTION public.verify_kiosk_pin(p_device_id uuid, p_device_token uuid, p_employee_id uuid, p_pin text) IS 'Verifica el PIN de UN empleado desde un kiosco vinculado. anon a proposito (el kiosco es pre-login); valida device_token internamente y aplica rate limit.';
