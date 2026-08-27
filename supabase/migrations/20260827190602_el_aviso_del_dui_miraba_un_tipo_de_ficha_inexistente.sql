SET lock_timeout = '5s';

-- El portal ya leía y guardaba `dui_fecha_vencimiento` desde el documento, y ahí
-- se acababa: nadie volvía a mirar esa fecha. Un dato que se captura y no se
-- vigila es lo mismo que no tenerlo — con la diferencia de que da la impresión
-- contraria.
--
-- El filtro de la primera version comparaba tipo_ficha contra un valor que NO
-- EXISTE: los reales son `empleado`, `servicio_externo` y `tecnica`
-- (`src/utils/tipoDeFicha.js`). O sea que la funcion no encontraba a nadie NUNCA
-- y devolvia «0 personas» — un cero indistinguible del cero legitimo de un dia
-- sin vencimientos.
--
-- Lo destapo fabricarle el caso que debia cazar: con un DUI venciendo en 10 dias
-- seguia diciendo 0. Sin esa prueba habria quedado publicada y en silencio, que
-- es el modo de falla mas caro que tiene una alarma.
--
-- El corte ahora excluye solo las cuentas del SISTEMA (`tecnica`): un servicio
-- externo si es una persona con un DUI de verdad, y si alguien se tomo el
-- trabajo de anotarle el vencimiento es porque su expediente importa.
CREATE OR REPLACE FUNCTION public.avisar_dui_por_vencer(p_dias_antes int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_hoy        date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_emp        record;
    v_etapa      text;
    v_avisados   int := 0;
    v_lista      text := '';
    v_cuantos    int := 0;
    v_th         text[];
BEGIN
    FOR v_emp IN
        SELECT e.id, e.name, e.dui_fecha_vencimiento AS vence
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND e.dui_fecha_vencimiento IS NOT NULL
           AND coalesce(e.tipo_ficha, 'empleado') <> 'tecnica'
           AND e.dui_fecha_vencimiento <= v_hoy + p_dias_antes
         ORDER BY e.dui_fecha_vencimiento
    LOOP
        v_etapa := CASE WHEN v_emp.vence < v_hoy THEN 'vencido' ELSE 'por_vencer' END;
        v_cuantos := v_cuantos + 1;
        v_lista := v_lista || '• ' || coalesce(v_emp.name, 'Sin nombre') || ' — '
                 || CASE WHEN v_etapa = 'vencido'
                         THEN 'venció el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                         ELSE 'vence el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                              || ' (' || (v_emp.vence - v_hoy) || ' días)' END
                 || E'\n';
        IF EXISTS (
            SELECT 1 FROM public.announcements a
             WHERE a.metadata->>'source' = 'dui-vencimiento'
               AND a.metadata->>'employee_id' = v_emp.id::text
               AND a.metadata->>'etapa' = v_etapa
        ) THEN CONTINUE; END IF;

        INSERT INTO public.announcements
            (title, message, target_type, target_value, read_by, is_archived, priority, metadata)
        VALUES (
            CASE WHEN v_etapa = 'vencido' THEN 'Tu DUI está vencido' ELSE 'Tu DUI está por vencer' END,
            CASE WHEN v_etapa = 'vencido'
                 THEN 'Tu DUI venció el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                      || '. Renuévalo y pásale el nuevo a Talento Humano para actualizar tu expediente.'
                 ELSE 'Tu DUI vence el ' || to_char(v_emp.vence, 'DD/MM/YYYY')
                      || '. Renuévalo antes de esa fecha y pásale el nuevo a Talento Humano.'
            END,
            'EMPLOYEE', to_jsonb(ARRAY[v_emp.id::text]),
            '[]'::jsonb, false,
            CASE WHEN v_etapa = 'vencido' THEN 'HIGH' ELSE 'NORMAL' END,
            jsonb_build_object('source', 'dui-vencimiento', 'employee_id', v_emp.id::text,
                               'etapa', v_etapa, 'vence_el', v_emp.vence::text)
        );
        v_avisados := v_avisados + 1;
    END LOOP;

    IF v_cuantos = 0 THEN
        RETURN json_build_object('ok', true, 'personas', 0, 'avisadas', 0, 'resumen', false);
    END IF;

    SELECT ARRAY_AGG(id::text) INTO v_th
      FROM public.employees WHERE role_id = 11 AND status = 'ACTIVO';

    IF NOT EXISTS (
        SELECT 1 FROM public.announcements a
         WHERE a.metadata->>'source' = 'dui-vencimiento-resumen'
           AND (a.created_at AT TIME ZONE 'America/El_Salvador')::date = v_hoy
    ) THEN
        INSERT INTO public.announcements
            (title, message, target_type, target_value, read_by, is_archived, priority, metadata)
        VALUES (
            'DUI por vencer: ' || v_cuantos || ' ' || CASE WHEN v_cuantos = 1 THEN 'persona' ELSE 'personas' END,
            'Estos expedientes tienen el DUI vencido o a punto de vencer:' || E'\n\n' || v_lista
                || E'\nA cada persona se le avisó por su cuenta.',
            CASE WHEN v_th IS NOT NULL AND array_length(v_th, 1) > 0 THEN 'EMPLOYEE' ELSE 'ALL' END,
            CASE WHEN v_th IS NOT NULL AND array_length(v_th, 1) > 0 THEN to_jsonb(v_th) ELSE NULL END,
            '[]'::jsonb, false, 'NORMAL',
            jsonb_build_object('source', 'dui-vencimiento-resumen', 'personas', v_cuantos)
        );
    END IF;

    RETURN json_build_object('ok', true, 'personas', v_cuantos, 'avisadas', v_avisados, 'resumen', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.avisar_dui_por_vencer(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_dui_por_vencer(int) TO service_role;
