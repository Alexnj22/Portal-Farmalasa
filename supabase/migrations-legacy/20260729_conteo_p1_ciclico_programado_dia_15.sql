SET lock_timeout = '5s';

-- ─── P1 — El cíclico se programa solo, el 15 de cada mes ────────────────────
-- Un control que depende de que alguien se acuerde de crearlo no es un control.
-- El 15 (y no el 1) a propósito: el 1 ya está ocupado por el recálculo de
-- MIN/MAX y el cierre de ventas del mes.
--
-- Qué sucursales entran lo decide un flag en la tabla, no el código: Bodega
-- arranca en false por decisión del usuario (2026-07-29) — ellos llevan su
-- propio control y su MIN/MAX se deriva de las demás sucursales. Prenderlo
-- después es un UPDATE, no un deploy.
--
-- NOTA: la versión final de crear_conteos_ciclicos_programados está en
-- 20260729_conteo_p1b_guard_por_grants (el guard de auth.role() de acá habría
-- roto el cron), y el CHECK que faltaba para 'CICLICO' en
-- 20260729_conteo_p1c_check_scope_ciclico.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS conteo_ciclico_activo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conteo_ciclico_tamano integer NOT NULL DEFAULT 200;

COMMENT ON COLUMN public.branches.conteo_ciclico_activo IS
  'La sucursal recibe automáticamente su conteo cíclico el 15 de cada mes.';

-- Las 6 sucursales de venta entran; Bodega no (queda en el default false).
UPDATE public.branches
SET conteo_ciclico_activo = true
WHERE id IN (SELECT branch_id FROM public.erp_sucursal_map WHERE es_bodega = false);


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
  -- Solo el cron/servicio. Un usuario crea su conteo desde la vista, con su
  -- propia autoría; esta ruta no tiene empleado detrás.
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SOLO_SERVICE_ROLE';
  END IF;

  FOR r IN
    SELECT b.id, b.name, b.conteo_ciclico_tamano AS tamano
    FROM public.branches b
    WHERE b.conteo_ciclico_activo = true
      AND EXISTS (SELECT 1 FROM public.erp_sucursal_map m WHERE m.branch_id = b.id)
    ORDER BY b.id
  LOOP
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
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_conteos_ciclicos_programados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_conteos_ciclicos_programados() TO service_role;
