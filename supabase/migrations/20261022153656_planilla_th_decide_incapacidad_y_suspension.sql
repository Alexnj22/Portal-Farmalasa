-- Talento Humano tiene la última palabra sobre incapacidades y suspensiones en
-- la planilla (decisiones del dueño, 2026-10-22). Va DESPUÉS de
-- `planilla_quincenas_y_anticipos`.
--
-- 1. `payroll_entries`: dos marcas por renglón con los días que esperan una
--    decisión de Talento Humano. Mientras alguna sea > 0 el portal no deja
--    aprobar la planilla: esos días no se pagan ni se descuentan en silencio.
--      incapacidad_pendiente_dias  ausencias cubiertas por una solicitud de
--                                  incapacidad todavía PENDING
--      suspension_pendiente_dias   días de suspensión sin decidir si llevan
--                                  descuento de sueldo
--    La tabla está vacía en producción y no es de las calientes.
--
-- 2. Una suspensión puede ser CON o SIN descuento de sueldo: «las sanciones
--    pueden ser o no descontadas, así que queda a criterio de TH». Se guarda
--    en el propio evento, `metadata.descuento_de_sueldo` (true / false; sin la
--    clave = sin decidir), con quién y cuándo lo decidió.
--    - `registrar_sancion` recibe `p_con_descuento` (opcional) para decidirlo
--      al registrar. Se reemplaza la firma entera (DROP + CREATE) para no dejar
--      viva la sobrecarga vieja con sus permisos. El cuerpo parte de la
--      definición VIVA de producción (pg_get_functiondef, 2026-10-22).
--    - `decidir_descuento_de_suspension` decide (o corrige) una ya registrada.
SET lock_timeout = '5s';

ALTER TABLE public.payroll_entries
  ADD COLUMN IF NOT EXISTS incapacidad_pendiente_dias integer NOT NULL DEFAULT 0
    CHECK (incapacidad_pendiente_dias >= 0),
  ADD COLUMN IF NOT EXISTS suspension_pendiente_dias integer NOT NULL DEFAULT 0
    CHECK (suspension_pendiente_dias >= 0);

DROP FUNCTION IF EXISTS public.registrar_sancion(uuid, text, integer, date, integer, text, text);

CREATE FUNCTION public.registrar_sancion(
    p_employee_id   uuid,
    p_falta         text,
    p_peldano       integer,
    p_fecha         date,
    p_dias          integer DEFAULT NULL::integer,
    p_nota          text    DEFAULT NULL::text,
    p_autorizacion  text    DEFAULT NULL::text,
    p_con_descuento boolean DEFAULT NULL::boolean
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    -- Con o sin descuento de sueldo lo decide Talento Humano. Sin decidir, la
    -- planilla lo marca pendiente y no se aprueba hasta que alguien decida.
    IF v_tipo = 'SUSPENSION' AND p_con_descuento IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object(
            'descuento_de_sueldo',     p_con_descuento,
            'descuento_decidido_por',  v_yo,
            'descuento_decidido_at',   now());
    END IF;

    INSERT INTO public.employee_events (employee_id, type, date, note, metadata)
    VALUES (p_employee_id, v_tipo, p_fecha, nullif(btrim(coalesce(p_nota,'')), ''), v_meta)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_sancion(uuid, text, integer, date, integer, text, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_sancion(uuid, text, integer, date, integer, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decidir_descuento_de_suspension(
    p_evento_id     uuid,
    p_con_descuento boolean
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo uuid := public.auth_employee_id();
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['staff_detail'])) THEN
        RAISE EXCEPTION 'FORBIDDEN: decidir el descuento de una suspensión exige poder editar personal';
    END IF;
    IF v_yo IS NULL THEN
        RAISE EXCEPTION 'SIN_FICHA: quien decide tiene que tener ficha de empleado';
    END IF;
    IF p_con_descuento IS NULL THEN
        RAISE EXCEPTION 'SIN_DECISION: hay que elegir con o sin descuento de sueldo';
    END IF;

    UPDATE public.employee_events
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'descuento_de_sueldo',    p_con_descuento,
               'descuento_decidido_por', v_yo,
               'descuento_decidido_at',  now())
     WHERE id = p_evento_id
       AND type = 'SUSPENSION';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_ES_SUSPENSION: ese evento no es una suspensión';
    END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.decidir_descuento_de_suspension(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decidir_descuento_de_suspension(uuid, boolean) TO authenticated, service_role;
