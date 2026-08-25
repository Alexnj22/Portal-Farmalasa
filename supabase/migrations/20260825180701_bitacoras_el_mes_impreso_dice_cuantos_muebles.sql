SET lock_timeout = '5s';

-- El mes impreso dice cuántos muebles se limpiaron.
--
-- El RTS 6.1.14 prefiere el papel («preferiblemente debe estar de manera
-- física»), así que el detalle que se puede ver en pantalla tiene que poder
-- salir impreso: si el procedimiento del regente nombra cuatro vitrinas y el
-- libro sólo dice «limpieza: sí», el papel no prueba lo que promete el
-- procedimiento. Van los dos números y también la lista de muebles del área,
-- para que la hoja pueda nombrar el que faltó y no sólo contarlo.
CREATE OR REPLACE FUNCTION public.get_bitacora_mes_impreso(p_branch_id bigint, p_periodo text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_ini date; v_fin date; v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    IF p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Periodo invalido: se espera YYYY-MM.' USING ERRCODE = 'P0001';
    END IF;
    v_ini := to_date(p_periodo || '-01', 'YYYY-MM-DD');
    v_fin := least((v_ini + interval '1 month - 1 day')::date, public.bitacora_hoy_sv());

    SELECT json_build_object(
        'periodo',   p_periodo,
        'sucursal',  (SELECT name    FROM public.branches WHERE id = p_branch_id),
        'direccion', (SELECT address FROM public.branches WHERE id = p_branch_id),
        'desde', v_ini, 'hasta', v_fin,
        'cerrado',   public.bitacora_periodo_cerrado(p_branch_id, p_periodo),
        'resumen',   public.get_bitacora_resumen_mes(p_branch_id, p_periodo),
        'cierre', (
            SELECT json_build_object(
                'accion', c.accion, 'motivo', c.motivo, 'created_at', c.created_at,
                'firmado_por', e.name)
              FROM public.bitacora_cierres c
              LEFT JOIN public.employees e ON e.id = c.actor_id
             WHERE c.branch_id = p_branch_id AND c.periodo = p_periodo
             ORDER BY c.created_at DESC LIMIT 1
        ),
        'areas', (
            SELECT coalesce(json_agg(json_build_object(
                'nombre', a.nombre, 'tipo', a.tipo,
                'temp_min', a.temp_min, 'temp_max', a.temp_max,
                'mide_humedad', a.mide_humedad,
                'instrumento', a.instrumento, 'calibrado_hasta', a.calibrado_hasta,
                'franjas', a.franjas, 'limpiezas', a.limpiezas,
                'puntos', a.puntos,
                'dias', (
                    SELECT coalesce(json_agg(json_build_object(
                        'dia', d.dia::date,
                        'lecturas', (
                            SELECT coalesce(json_agg(json_build_object(
                                'franja', f->>'clave', 'label', f->>'label',
                                'temperatura', l.temperatura, 'humedad', l.humedad,
                                'fuera_de_rango', l.fuera_de_rango,
                                'accion', l.accion_correctiva,
                                'por', e2.name, 'tarde', l.tarde,
                                'hora', to_char(l.registrado_at AT TIME ZONE 'America/El_Salvador', 'HH24:MI'),
                                'correcciones', (SELECT count(*) FROM public.bitacora_correcciones c2 WHERE c2.lectura_id = l.id)
                            ) ORDER BY ord), '[]'::json)
                            FROM jsonb_array_elements(a.franjas) WITH ORDINALITY AS t(f, ord)
                            LEFT JOIN public.bitacora_lecturas l
                                   ON l.area_id = a.id AND l.fecha = d.dia::date AND l.franja = f->>'clave'
                            LEFT JOIN public.employees e2 ON e2.id = l.registrado_por
                        ),
                        'limpiezas', (
                            SELECT coalesce(json_agg(json_build_object(
                                'turno', f->>'clave', 'label', f->>'label',
                                'hecha', li.id IS NOT NULL, 'por', e3.name,
                                'observaciones', li.observaciones,
                                'puntos_hechos', (
                                    SELECT count(*) FROM jsonb_array_elements(coalesce(li.puntos, '[]'::jsonb)) q
                                     WHERE (q->>'hecho')::boolean),
                                'puntos_total', jsonb_array_length(coalesce(li.puntos, '[]'::jsonb)),
                                -- Los que faltaron, por nombre: en el papel, «3 de 4»
                                -- sin decir cuál obliga a ir a buscarlo a otro lado.
                                'puntos_faltantes', (
                                    SELECT coalesce(json_agg(p->>'label' ORDER BY p->>'label'), '[]'::json)
                                      FROM jsonb_array_elements(coalesce(li.puntos, '[]'::jsonb)) q
                                      JOIN jsonb_array_elements(coalesce(a.puntos, '[]'::jsonb)) p
                                        ON p->>'clave' = q->>'clave'
                                     WHERE NOT (q->>'hecho')::boolean)
                            ) ORDER BY ord), '[]'::json)
                            FROM jsonb_array_elements(a.limpiezas) WITH ORDINALITY AS t2(f, ord)
                            LEFT JOIN public.bitacora_limpiezas li
                                   ON li.area_id = a.id AND li.fecha = d.dia::date AND li.turno = f->>'clave'
                            LEFT JOIN public.employees e3 ON e3.id = li.realizada_por
                        )
                    ) ORDER BY d.dia), '[]'::json)
                    FROM generate_series(greatest(v_ini, a.vigente_desde), v_fin, interval '1 day') AS d(dia)
                    WHERE extract(isodow FROM d.dia)::smallint = ANY (a.dias_semana)
                )
            ) ORDER BY CASE a.tipo WHEN 'sala_ventas' THEN 1 WHEN 'bodega' THEN 2 ELSE 3 END), '[]'::json)
            FROM public.bitacora_areas a
            WHERE a.branch_id = p_branch_id AND a.activa
        ),
        'libro', (
            SELECT coalesce(json_agg(json_build_object(
                'folio', d.folio_txt, 'fecha', d.fecha,
                'hora', to_char(d.hora, 'HH24:MI'),
                'producto', d.producto_nombre, 'laboratorio', d.laboratorio,
                'cantidad', d.cantidad, 'lote', d.lote, 'vence', d.fecha_vencimiento,
                'documento', d.correlativo_doc,
                'paciente', r.paciente_nombre,
                'medico', m.nombre, 'numero_junta', m.numero_junta,
                'receta', CASE WHEN r.id IS NULL THEN NULL
                               ELSE r.anio::text || '-' || lpad(r.correlativo::text, 5, '0') END,
                'prescrito', ri.cantidad_prescrita,
                'vendedor', d.vendedor_nombre,
                'estado', d.estado, 'motivo_anulacion', d.motivo_anulacion
            ) ORDER BY d.folio), '[]'::json)
            FROM public.bitacora_dispensaciones d
            LEFT JOIN public.receta_items ri ON ri.id = d.receta_item_id
            LEFT JOIN public.recetas r ON r.id = ri.receta_id
            LEFT JOIN public.medicos m ON m.id = r.medico_id
            WHERE d.branch_id = p_branch_id AND d.fecha BETWEEN v_ini AND v_fin
        )
    ) INTO v_out;

    RETURN v_out;
END;
$function$;
