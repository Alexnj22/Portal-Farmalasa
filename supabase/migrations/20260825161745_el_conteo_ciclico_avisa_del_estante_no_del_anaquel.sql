-- El aviso del conteo cíclico decía «anaquel», y además voseaba.
--
-- Decisión del usuario (2026-08-25): **el portal no dice «anaquel» nunca** —
-- sólo «vitrina» o «estante», que son las dos palabras que la empresa usa y las
-- únicas que el propio portal ya tenía en `laboratorios` (`vitrina`, `estante`,
-- `peldano`).
--
-- Este texto lo LEE la gente de sala: es el cuerpo de la notificación que se
-- manda al crear el conteo cíclico del mes. Grepear `src/` no lo encuentra
-- —vive dentro de una función de Postgres—, que es exactamente el hueco que
-- CLAUDE.md ya anota para los rótulos: «el chequeo tiene que incluir
-- `supabase/`, porque hay rótulos que también viven dentro de funciones de
-- Postgres». Salió de auditar `pg_proc.prosrc`, no del repo.
--
-- De paso se corrige «anotá» → «anota»: DESIGN.md §26.7 fija tuteo, y el gate
-- de copy tampoco puede ver un string que está dentro de la base.
--
-- Ningún aviso ya enviado lo dice (verificado: 0 filas en `notifications` con
-- esa palabra), así que no hay historia que reescribir — sólo el molde.
--
-- El cuerpo va copiado de `pg_get_functiondef` tal cual estaba: lo ÚNICO que
-- cambia es esa frase.
SET lock_timeout = '5s';

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
      format('Ya está listo el conteo de %s productos de este mes. Se cuenta a ciegas: anota lo que ves en el estante.', array_length(v_ids, 1)),
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
