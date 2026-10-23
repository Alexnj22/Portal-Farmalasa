-- segunda-a2-04 · productos: la corrección de factor es por LOTE (H28)
-- Partido de la definición VIVA (2026-10-23).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.revision_de_presentaciones()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('productos_tab_presentaciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN: no tenés acceso a las presentaciones de productos';
  END IF;

  RETURN json_build_object(
    -- Lo que cambió en los últimos 120 días y qué se convirtió.
    'cambios', (
      SELECT coalesce(json_agg(json_build_object(
               'id', c.id, 'erp_product_id', c.erp_product_id, 'nombre', p.nombre,
               'detectado_at', c.detectado_at, 'procesado_at', c.procesado_at,
               'resultado', c.resultado) ORDER BY c.procesado_at DESC NULLS FIRST), '[]'::json)
        FROM public.cambios_de_factor c
        JOIN public.products p ON p.id = c.erp_product_id
       WHERE c.detectado_at >= now() - interval '120 days'
         AND (c.procesado_at IS NULL
              OR c.resultado ? 'factor_antes'
              OR coalesce((c.resultado->>'ventas_sin_convertir')::int, 0) > 0)),

    -- La existencia que quedó contada en la unidad vieja, lote por lote. Sólo
    -- de los cambios que el reproceso marcó con existencia a revisar (es decir,
    -- recientes: uno de hace un año ya se corrigió allá), y sólo las filas que
    -- todavía muestran al menos una caja vieja entera.
    'existencias', (
      WITH rec AS (
        SELECT DISTINCT ON (c.erp_product_id)
               c.id AS cambio_id, c.erp_product_id, c.procesado_at,
               (c.resultado->>'factor_antes')::int AS de,
               (c.resultado->>'factor_ahora')::int AS a
          FROM public.cambios_de_factor c
         WHERE c.procesado_at >= now() - interval '120 days'
           AND c.resultado ? 'existencia_a_revisar'
         ORDER BY c.erp_product_id, c.procesado_at DESC
      )
      SELECT coalesce(json_agg(json_build_object(
               'cambio_id', r.cambio_id, 'erp_product_id', r.erp_product_id, 'nombre', p.nombre,
               'sala', m.nombre, 'erp_sucursal_id', m.erp_sucursal_id, 'branch_id', m.branch_id,
               'presentacion', trim(i.presentacion), 'detalle', i.detalle,
               'lote', i.lote, 'vence', i.fecha_vencimiento,
               'muestra', i.cantidad, 'de', r.de, 'a', r.a,
               'quedan', floor(i.cantidad / r.de)::int,
               'descartar', (i.cantidad - floor(i.cantidad / r.de))::int,
               'sueltas', (i.cantidad - floor(i.cantidad / r.de) * r.de)::int,
               'solicitud', (SELECT json_build_object('id', ar.id, 'status', ar.status,
                                    'aplicada', ar.metadata ? 'erp_aplicado', 'at', ar.created_at)
                               FROM public.approval_requests ar
                              WHERE ar.type = 'INVENTORY_DISCARD_REQUEST'
                                AND ar.metadata->'correccion_de_factor'->>'cambio_id' = r.cambio_id::text
                                AND (ar.metadata->>'erp_sucursal_id')::int = m.erp_sucursal_id
                                -- H28: la corrección es de UN lote. Sin esto, corregir el lote A
                                -- marcaba «Corregida» al B de la misma sala y le quitaba el botón.
                                AND nullif(btrim(coalesce(ar.metadata->'correccion_de_factor'->>'lote',
                                                          ar.metadata->'items'->0->>'lote', '')), '')
                                    IS NOT DISTINCT FROM nullif(btrim(coalesce(i.lote, '')), '')
                                AND ar.status IN ('PENDING', 'APPROVED')
                              ORDER BY ar.created_at DESC LIMIT 1))
             ORDER BY p.nombre, m.erp_sucursal_id, i.lote), '[]'::json)
        FROM rec r
        JOIN public.inventory i ON i.erp_product_id = r.erp_product_id
                               AND NOT i.is_vencidos AND i.cantidad >= r.de
        JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
        JOIN public.products p ON p.id = r.erp_product_id
       WHERE r.a = 1 AND r.de > 1),

    'sospechosos', (
      SELECT coalesce(json_agg(to_json(f) ORDER BY f.nombre, f.tipo), '[]'::json)
        FROM public.factores_sospechosos() f)
  );
END;
$function$;
