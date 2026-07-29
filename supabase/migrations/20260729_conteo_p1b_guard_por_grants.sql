SET lock_timeout = '5s';

-- El guard `auth.role() = 'service_role'` habría roto el cron: pg_cron ejecuta
-- SQL directo, sin contexto de request, así que auth.role() es NULL y la
-- función se habría negado a correr todos los días 15 en silencio.
--
-- El control lo hacen los GRANT, que es donde corresponde: revocada de PUBLIC,
-- anon y authenticated — ningún usuario del portal puede invocarla — y otorgada
-- a service_role. pg_cron corre como postgres (dueño), así que entra.

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
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_conteos_ciclicos_programados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_conteos_ciclicos_programados() TO service_role;


-- El 15 a las 15:00 UTC = 9am El Salvador. No el 1: ese día ya corren el
-- recálculo de MIN/MAX y el cierre de ventas del mes.
SELECT cron.schedule(
  'crear-conteos-ciclicos-mensual',
  '0 15 15 * *',
  $$SELECT public.crear_conteos_ciclicos_programados()$$
);
