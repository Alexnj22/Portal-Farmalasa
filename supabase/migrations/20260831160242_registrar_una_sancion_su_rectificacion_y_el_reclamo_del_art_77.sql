SET lock_timeout = '5s';

-- ── Imponer una sanción ─────────────────────────────────────────────────────
--
-- La firma —quién la impuso— la pone el SERVIDOR con `auth_employee_id()`, no
-- el cliente. Es la misma regla que `registrar_egreso`: el navegador conoce la
-- CUENTA (`auth.users.id`) y acá hace falta la FICHA (`employees.id`), y para
-- 33 de las 42 personas del portal esos dos ids no son el mismo valor. Un
-- `impuesta_por` que llegue por parámetro es un campo que se puede falsificar
-- justo en el registro que existe para sostener un despido.
--
-- Y valida la proporción del Art. 83, que no es cosmética: el num. 3 dice «por
-- un día» y el num. 4 «por más de un día y hasta treinta, previa autorización y
-- calificación de motivos del Director General de Inspección de Trabajo». Una
-- suspensión de tres días sin esa autorización es ilegal, así que no se guarda.
CREATE OR REPLACE FUNCTION public.registrar_sancion(
    p_employee_id  uuid,
    p_falta        text,
    p_peldano      integer,
    p_fecha        date,
    p_dias         integer DEFAULT NULL,
    p_nota         text    DEFAULT NULL,
    p_autorizacion text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo       uuid := public.auth_employee_id();
    v_tipo     text;
    v_hasta    date;
    v_id       uuid;
    v_meta     jsonb;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['staff_detail'])) THEN
        RAISE EXCEPTION 'FORBIDDEN: imponer una sanción exige poder editar personal';
    END IF;
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'SIN_FICHA: quien firma una sanción tiene que tener ficha de empleado';
    END IF;

    -- Una ficha que no es una persona no se sanciona: QA y el Contador Externo
    -- existen como fila y no como trabajador. Ver `tipo_ficha`.
    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_employee_id
                      AND coalesce(e.tipo_ficha, 'empleado') = 'empleado') THEN
        RAISE EXCEPTION 'NO_ES_UNA_PERSONA: esa ficha no corresponde a un trabajador';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.faltas_disciplinarias f
                    WHERE f.clave = p_falta AND f.activa) THEN
        RAISE EXCEPTION 'FALTA_DESCONOCIDA: %', p_falta;
    END IF;

    IF p_peldano IS NULL OR p_peldano NOT BETWEEN 1 AND 4 THEN
        -- El peldaño 5 del Art. 83 es la terminación del contrato y NO se
        -- registra por acá: es una baja, con su liquidación y su causal del
        -- Art. 50. Meterla como «sanción» la dejaría fuera de todo lo que el
        -- portal ya sabe hacer con una baja.
        RAISE EXCEPTION 'PELDANO_INVALIDO: el Art. 83 tiene 4 sanciones registrables (la 5 es una baja)';
    END IF;

    v_tipo := CASE p_peldano
        WHEN 1 THEN 'AMONESTACION_VERBAL'
        WHEN 2 THEN 'AMONESTACION_ESCRITA'
        ELSE 'SUSPENSION'
    END;

    IF p_peldano = 3 THEN
        IF coalesce(p_dias, 1) <> 1 THEN
            RAISE EXCEPTION 'ART83_3: la suspensión del num. 3 es de UN día; para más usá el peldaño 4';
        END IF;
        v_hasta := p_fecha;
    ELSIF p_peldano = 4 THEN
        IF p_dias IS NULL OR p_dias < 2 OR p_dias > 30 THEN
            RAISE EXCEPTION 'ART83_4: el num. 4 va de 2 a 30 días';
        END IF;
        IF btrim(coalesce(p_autorizacion, '')) = '' THEN
            RAISE EXCEPTION 'ART83_4_SIN_AUTORIZACION: exige la calificación de motivos del Director General de Inspección de Trabajo';
        END IF;
        v_hasta := p_fecha + (p_dias - 1);
    END IF;

    v_meta := jsonb_build_object(
        'falta',        p_falta,
        'peldano',      p_peldano,
        'impuesta_por', v_yo
    );
    IF v_hasta IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object('endDate', v_hasta::text,
                                               'dias',    coalesce(p_dias, 1));
    END IF;
    IF btrim(coalesce(p_autorizacion, '')) <> '' THEN
        v_meta := v_meta || jsonb_build_object('autorizacion', p_autorizacion);
    END IF;

    INSERT INTO public.employee_events (employee_id, type, date, note, metadata)
    VALUES (p_employee_id, v_tipo, p_fecha, nullif(btrim(coalesce(p_nota,'')), ''), v_meta)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_sancion(uuid, text, integer, date, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_sancion(uuid, text, integer, date, integer, text, text) TO authenticated;

-- ── El memorando del Art. 86 ────────────────────────────────────────────────
-- «deberá emitir, en un plazo NO MENOR de sesenta días, un memorando». O sea
-- que el plazo es un PISO, no un vencimiento: antes de los 60 días no se puede
-- emitir. El resumen que circulaba en el repo lo decía al revés («exige el
-- memorando A los 60 días»), y con esa lectura la función habría rechazado
-- justo los casos válidos.
CREATE OR REPLACE FUNCTION public.registrar_rectificacion(
    p_employee_id uuid,
    p_nota        text DEFAULT NULL,
    p_fecha       date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo      uuid := public.auth_employee_id();
    v_fecha   date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
    v_ultima  date;
    v_id      uuid;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['staff_detail'])) THEN
        RAISE EXCEPTION 'FORBIDDEN: emitir el memorando del Art. 86 exige poder editar personal';
    END IF;
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'SIN_FICHA: quien firma el memorando tiene que tener ficha de empleado';
    END IF;

    SELECT max(e.date) INTO v_ultima
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION')
       AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA';

    IF v_ultima IS NULL THEN
        RAISE EXCEPTION 'SIN_SANCIONES: no hay nada que rectificar';
    END IF;

    IF v_fecha < v_ultima + 60 THEN
        RAISE EXCEPTION 'ART86_ANTES_DE_TIEMPO: el memorando no puede emitirse antes del % (60 días desde la última sanción, del %)',
            (v_ultima + 60)::text, v_ultima::text;
    END IF;

    INSERT INTO public.employee_events (employee_id, type, date, note, metadata)
    VALUES (p_employee_id, 'RECTIFICACION', v_fecha,
            nullif(btrim(coalesce(p_nota,'')), ''),
            jsonb_build_object('emitida_por', v_yo, 'rectifica_desde', v_ultima::text))
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_rectificacion(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_rectificacion(uuid, text, date) TO authenticated;

-- ── El reclamo del Art. 77 ──────────────────────────────────────────────────
-- El trabajador puede reclamar la sanción: 2 días hábiles para presentarla ante
-- Recursos Humanos, que responde en 5; si no queda conforme, 2 días más ante la
-- Administración, que resuelve en 5 y en forma definitiva.
--
-- Acá se registra el DESENLACE, que es lo que cambia los hechos: una sanción
-- REVOCADA deja de contar para la escalera, deja de suspender y deja de pintar
-- el aro en la foto — las tres cosas ya lo consultan. Los plazos se guardan
-- para poder mirarlos, no para que una función los haga vencer solos: dejar que
-- un reloj revoque una sanción sin que nadie decida sería peor que no tenerlo.
CREATE OR REPLACE FUNCTION public.resolver_reclamo_sancion(
    p_evento_id  uuid,
    p_estado     text,
    p_resolucion text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_yo uuid := public.auth_employee_id();
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['staff_detail'])) THEN
        RAISE EXCEPTION 'FORBIDDEN: resolver un reclamo exige poder editar personal';
    END IF;
    IF p_estado NOT IN ('RECLAMADA','RATIFICADA','REVOCADA') THEN
        RAISE EXCEPTION 'ESTADO_INVALIDO: %', p_estado;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.employee_events e
                    WHERE e.id = p_evento_id
                      AND e.type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION')) THEN
        RAISE EXCEPTION 'NO_ES_UNA_SANCION';
    END IF;

    UPDATE public.employee_events
       SET metadata = metadata || jsonb_build_object('reclamo', jsonb_build_object(
             'estado',       p_estado,
             'fecha',        ((now() AT TIME ZONE 'America/El_Salvador')::date)::text,
             'resuelto_por', v_yo,
             'resolucion',   nullif(btrim(coalesce(p_resolucion,'')), '')
           ))
     WHERE id = p_evento_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolver_reclamo_sancion(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_reclamo_sancion(uuid, text, text) TO authenticated;

-- ── Quiénes están suspendidos un día ────────────────────────────────────────
-- La planilla consolida un día entero de una vez, así que preguntar persona por
-- persona con `esta_suspendido()` serían 48 llamadas. Esto responde lo mismo
-- para todos, **con la misma regla escrita una sola vez** — si la planilla
-- resolviera «sin endDate es un día» por su cuenta, tendríamos dos verdades
-- sobre lo mismo, que es como se rompió `turno_del_dia`.
CREATE OR REPLACE FUNCTION public.suspendidos_en(p_fecha date DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
BEGIN
    RETURN (
        SELECT coalesce(json_agg(DISTINCT e.employee_id), '[]'::json)
          FROM public.employee_events e
         WHERE e.type = 'SUSPENSION'
           AND e.date <= v_fecha
           AND coalesce(nullif(e.metadata->>'endDate','')::date, e.date) >= v_fecha
           AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.suspendidos_en(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspendidos_en(date) TO authenticated, service_role;
