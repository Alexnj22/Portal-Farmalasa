SET lock_timeout = '5s';

-- ─── A1 — El ajuste sale al ERP, y queda constancia ─────────────────────────
-- Mientras el portal no sea el sistema completo, el ajuste de inventario se
-- aplica en el ERP. El conteo NO escribe stock — deliberadamente — pero tiene
-- que dejar el reporte con el que se hace ese ajuste y saber si ya se aplicó.
--
-- Sin esto, un conteo aprobado y uno ya reflejado en el ERP se ven idénticos:
-- la diferencia queda medida y firmada, pero nadie sabe si el stock del ERP
-- todavía miente. Es la mitad del trabajo que faltaba registrar.

ALTER TABLE public.conteos_inventario
  ADD COLUMN IF NOT EXISTS ajuste_erp_aplicado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ajuste_erp_por uuid,
  ADD COLUMN IF NOT EXISTS ajuste_erp_at timestamptz,
  ADD COLUMN IF NOT EXISTS ajuste_erp_nota text;

COMMENT ON COLUMN public.conteos_inventario.ajuste_erp_aplicado IS
  'El ajuste de este conteo ya fue tecleado en el ERP. El portal no escribe stock: esto es constancia, no efecto.';


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
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_ajuste_erp(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_ajuste_erp(uuid, text) TO authenticated, service_role;


-- ─── El payload de impresión trae lo que se teclea en el ERP ────────────────
-- codigo_barras (para escanear en vez de tipear) y sistema_inicial (la
-- existencia del libro al abrir el conteo, para poder explicar la diferencia).
-- RETURNS json: agregar campos no cambia la firma.
CREATE OR REPLACE FUNCTION public.get_conteo_items_jsonb(p_conteo_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_branch_id bigint;
  v_erp_sucursal_ids int[];
BEGIN
  SELECT c.branch_id INTO v_branch_id FROM public.conteos_inventario c WHERE c.id = p_conteo_id;
  SELECT array_agg(m.erp_sucursal_id) INTO v_erp_sucursal_ids FROM public.erp_sucursal_map m WHERE m.branch_id = v_branch_id;

  RETURN (
    SELECT coalesce(json_agg(to_json(t)), '[]'::json)
    FROM (
      SELECT ci.id, ci.erp_product_id, ci.presentacion, ci.detalle, ci.lote, ci.fecha_vencimiento, ci.is_vencidos,
        CASE
          WHEN ci.fisico_cantidad IS NULL AND NOT ci.es_agregado_manual THEN
            COALESCE((
              SELECT i.cantidad FROM public.inventory i
              WHERE i.sync_key = ci.source_sync_key
                AND i.erp_sucursal_id = ANY(v_erp_sucursal_ids)
            ), 0)
          ELSE ci.sistema_cantidad
        END AS sistema_cantidad,
        ci.sistema_inicial,
        ci.fisico_cantidad, ci.diferencia, ci.estado_item, ci.nota, ci.costo_unitario, ci.es_agregado_manual,
        p.nombre AS product_nombre, p.es_antibiotico, p.foto_url, p.codigo_barras, l.nombre AS laboratorio_nombre,
        NULLIF(TRIM(COALESCE(e.first_names,'') || ' ' || COALESCE(e.last_names,'')), '') AS contado_por_nombre,
        ci.contado_at
      FROM public.conteo_inventario_items ci
      LEFT JOIN public.products p ON p.id = ci.erp_product_id
      LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
      LEFT JOIN public.employees e ON e.id = ci.contado_por
      WHERE ci.conteo_id = p_conteo_id
      ORDER BY p.nombre, ci.lote
    ) t
  );
END;
$function$;
