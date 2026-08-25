SET lock_timeout = '5s';

-- El día trae quién anotó: nombre partido y foto.
--
-- «SIEMPRE a la par del nombre la foto de quien lo hace, y siempre nombre y
-- apellido» (usuario). Es el «atribuible» del RTS 6.1.14 dicho como se lee en
-- una sala: una cara y dos palabras.
--
-- Van `first_names` y `last_names` por SEPARADO y no el `name` armado, porque
-- `employees.name` es una columna generada y partir ese texto es adivinar dónde
-- estaba la frontera: «ANA PEREZ LOPEZ» puede ser un nombre y dos apellidos o
-- dos nombres y un apellido, y en producción hay de las dos formas. Es la regla
-- de `shortEmployeeName` — «si la fila que estás pintando no trae
-- first_names/last_names, agregalos al select en vez de confiar en el corte».
--
-- La foto viaja como URL formato-public (el identificador que guarda la base) y
-- la firma el navegador con `signPhotosDeep`: una URL firmada guardada en la
-- base expira.

CREATE OR REPLACE FUNCTION public.get_bitacora_dia(p_branch_id bigint, p_fecha date)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_out json;
BEGIN
    PERFORM public.bitacora_exigir_acceso(p_branch_id, 'can_view');

    SELECT json_build_object(
        'fecha',    p_fecha,
        'periodo',  to_char(p_fecha, 'YYYY-MM'),
        'cerrado',  public.bitacora_periodo_cerrado(p_branch_id, to_char(p_fecha, 'YYYY-MM')),
        'hoy_sv',   public.bitacora_hoy_sv(),
        'areas',    coalesce(json_agg(a.obj ORDER BY a.orden, a.nombre), '[]'::json)
    ) INTO v_out
    FROM (
        SELECT
            ar.nombre,
            CASE ar.tipo WHEN 'sala_ventas' THEN 1 WHEN 'bodega' THEN 2 ELSE 3 END AS orden,
            json_build_object(
                'id', ar.id, 'tipo', ar.tipo, 'nombre', ar.nombre,
                'temp_min', ar.temp_min, 'temp_max', ar.temp_max,
                'hr_min', ar.hr_min, 'hr_max', ar.hr_max,
                'mide_humedad', ar.mide_humedad,
                'instrumento', ar.instrumento,
                'calibrado_hasta', ar.calibrado_hasta,
                'calibracion_vencida', ar.calibrado_hasta IS NOT NULL
                                       AND ar.calibrado_hasta < public.bitacora_hoy_sv(),
                'aplica_hoy', extract(isodow FROM p_fecha)::smallint = ANY (ar.dias_semana)
                              AND p_fecha >= ar.vigente_desde,
                -- Los muebles que se limpian en esta área. Viajan con el día
                -- para que la casilla pueda desplegarse sin una segunda vuelta.
                'puntos', ar.puntos,
                'franjas', (
                    SELECT coalesce(json_agg(json_build_object(
                        'clave',  f->>'clave',
                        'label',  f->>'label',
                        'desde',  f->>'desde',
                        'hasta',  f->>'hasta',
                        'estado', public.bitacora_estado_franja(
                                      p_fecha, (f->>'desde')::time, (f->>'hasta')::time, l.id IS NOT NULL),
                        'lectura', CASE WHEN l.id IS NULL THEN NULL ELSE json_build_object(
                            'id', l.id, 'temperatura', l.temperatura, 'humedad', l.humedad,
                            'fuera_de_rango', l.fuera_de_rango,
                            'accion_correctiva', l.accion_correctiva,
                            'tarde', l.tarde,
                            'registrado_at', l.registrado_at,
                            'registrado_por', l.registrado_por,
                            'registrado_por_nombre', e.name,
                            'registrado_por_nombres', e.first_names,
                            'registrado_por_apellidos', e.last_names,
                            'registrado_por_photo_url', e.photo_url,
                            'correcciones', (SELECT count(*) FROM public.bitacora_correcciones c WHERE c.lectura_id = l.id)
                        ) END
                    ) ORDER BY ord), '[]'::json)
                    FROM jsonb_array_elements(ar.franjas) WITH ORDINALITY AS t(f, ord)
                    LEFT JOIN public.bitacora_lecturas l
                           ON l.area_id = ar.id AND l.fecha = p_fecha AND l.franja = f->>'clave'
                    LEFT JOIN public.employees e ON e.id = l.registrado_por
                ),
                'limpiezas', (
                    SELECT coalesce(json_agg(json_build_object(
                        'clave',  f->>'clave',
                        'label',  f->>'label',
                        'desde',  f->>'desde',
                        'hasta',  f->>'hasta',
                        'estado', public.bitacora_estado_franja(
                                      p_fecha, (f->>'desde')::time, (f->>'hasta')::time, li.id IS NOT NULL),
                        'registro', CASE WHEN li.id IS NULL THEN NULL ELSE json_build_object(
                            'id', li.id, 'observaciones', li.observaciones, 'tarde', li.tarde,
                            'registrado_at', li.registrado_at,
                            'realizada_por', li.realizada_por,
                            'realizada_por_nombre', e2.name,
                            'realizada_por_nombres', e2.first_names,
                            'realizada_por_apellidos', e2.last_names,
                            'realizada_por_photo_url', e2.photo_url,
                            'corregida_at', li.corregida_at,
                            'correccion_motivo', li.correccion_motivo,
                            'puntos', li.puntos,
                            'puntos_hechos', (
                                SELECT count(*) FROM jsonb_array_elements(li.puntos) q
                                 WHERE (q->>'hecho')::boolean),
                            'puntos_total', jsonb_array_length(li.puntos)
                        ) END
                    ) ORDER BY ord), '[]'::json)
                    FROM jsonb_array_elements(ar.limpiezas) WITH ORDINALITY AS t2(f, ord)
                    LEFT JOIN public.bitacora_limpiezas li
                           ON li.area_id = ar.id AND li.fecha = p_fecha AND li.turno = f->>'clave'
                    LEFT JOIN public.employees e2 ON e2.id = li.realizada_por
                )
            ) AS obj
        FROM public.bitacora_areas ar
        WHERE ar.branch_id = p_branch_id AND ar.activa
    ) a;

    RETURN coalesce(v_out, json_build_object('fecha', p_fecha, 'areas', '[]'::json));
END;
$function$;
