-- Régimen disciplinario del RIT Art. 83 — el modelo y la escalera.
--
-- ── Por qué NO se usa `employees.status = 'SUSPENDIDO'` ─────────────────────
-- El CHECK de `employees.status` ya admite ese valor y nada lo escribe nunca.
-- Es una trampa: medido el 2026-08-31, **65 funciones de Postgres y 16 archivos
-- del frontend filtran `status = 'ACTIVO'`**, así que ponerlo apaga las 65 a la
-- vez — incluidas las que no tienen nada que ver con una sanción.
-- `nombre_de_vendedor` es el caso claro: filtra ACTIVO, o sea que las ventas ya
-- hechas por esa persona **perderían su nombre** mientras dure la suspensión.
--
-- Y hay un motivo más de fondo: **un `status` no tiene fecha.** El Art. 83 num.
-- 3 es una suspensión de UN día; un interruptor global no vuelve solo, y
-- devolverlo exigiría un cron que lo apague — o sea una segunda verdad sobre
-- lo mismo, que es como se rompió `turno_del_dia`.
--
-- La suspensión es un EVENTO CON FECHAS, igual que una vacación o una
-- incapacidad, y se pregunta POR FECHA. Así reusa el camino que ya existe
-- (`get_estados_de_personas` y su gemelo `estadoDePersona.js`) en vez de abrir
-- uno nuevo.
--
-- ── Por qué `employee_events.type` NO recibe un CHECK ───────────────────────
-- Sería lo natural —hoy acepta cualquier texto— pero la lista de tipos vivos no
-- se puede cerrar con confianza: son los 12 de `EVENT_TYPES`, más `HIRING` que
-- sólo aparece en la vista del empleado, más lo que escriban las funciones. Un
-- CHECK con una lista incompleta no da un hallazgo: **rechaza una escritura
-- real en producción**. La validación va donde se escribe, que es
-- `registrar_sancion`.

SET lock_timeout = '5s';

-- ── 1. El catálogo de faltas ────────────────────────────────────────────────
-- El RIT Art. 82 dice que «la Empresa establecerá los lineamientos», o sea que
-- la lista es de la empresa y va a crecer: por eso es una TABLA y no una
-- constante. Y lo que se guarda en la sanción es la CLAVE, nunca el rótulo —
-- corregir una tilde no puede desconectar la reincidencia (ver «un rótulo no es
-- una clave» en CLAUDE.md).
CREATE TABLE IF NOT EXISTS public.faltas_disciplinarias (
    clave       text PRIMARY KEY,
    nombre      text NOT NULL,
    articulo    text,
    activa      boolean NOT NULL DEFAULT true,
    orden       integer NOT NULL DEFAULT 100,
    created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.faltas_disciplinarias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faltas_disciplinarias_select ON public.faltas_disciplinarias;
CREATE POLICY faltas_disciplinarias_select ON public.faltas_disciplinarias
    FOR SELECT TO authenticated USING (true);

-- Editar el catálogo es cosa de quien maneja personal, no de cualquiera.
DROP POLICY IF EXISTS faltas_disciplinarias_write ON public.faltas_disciplinarias;
CREATE POLICY faltas_disciplinarias_write ON public.faltas_disciplinarias
    FOR ALL TO authenticated
    USING ((SELECT public.auth_can_edit_any(ARRAY['staff_detail'])))
    WITH CHECK ((SELECT public.auth_can_edit_any(ARRAY['staff_detail'])));

-- Semilla mínima: sólo faltas que el propio RIT o el Código nombran. No se
-- inventan categorías — el Art. 82 deja la lista en manos de la empresa, y una
-- entrada que nadie decidió se vuelve la opción por defecto de todo el mundo.
INSERT INTO public.faltas_disciplinarias (clave, nombre, articulo, orden) VALUES
    ('INASISTENCIA',       'Inasistencia sin justificar',                 'RIT Art. 83',          10),
    ('IMPUNTUALIDAD',      'Impuntualidad reiterada',                     'RIT Art. 83',          20),
    ('FALTANTE_CAJA',      'Faltante de caja',                            'CT Art. 50 num. 9',    30),
    ('FALTANTE_INVENTARIO','Faltante de inventario',                      'CT Art. 50 num. 9',    40),
    ('NEGLIGENCIA',        'Negligencia en el desempeño',                 'CT Art. 50 num. 2',    50),
    ('INCUMPLE_RIT',       'Incumplimiento del Reglamento Interno',       'CT Art. 50 num. 20',   60)
ON CONFLICT (clave) DO NOTHING;

-- ── 2. Dónde vive una sanción ───────────────────────────────────────────────
-- En `employee_events`, que ES el expediente: el Art. 83 num. 1 manda
-- registrarla «en el formato de Acción de Personal» y el Art. 86 que quede «en
-- el expediente». Y `employee_documents.event_id` ya existe, así que la
-- constancia firmada cuelga del evento sin inventar nada.
--
-- Cuatro tipos nuevos:
--   AMONESTACION_VERBAL   peldaño 1
--   AMONESTACION_ESCRITA  peldaño 2
--   SUSPENSION            peldaños 3 y 4 (el 4 exige autorización del DGIT)
--   RECTIFICACION         Art. 86 — la escalera también BAJA
--
-- En `metadata`:
--   falta        clave de `faltas_disciplinarias`
--   peldano      1..4
--   dias         sólo SUSPENSION
--   endDate      último día de la suspensión (la misma clave que usan vacación
--                e incapacidad, para que el estado se derive por el camino que
--                ya existe y no por uno nuevo)
--   impuesta_por employees.id de quien la impuso — la pone el servidor
--   autorizacion texto de la calificación del Director General de Inspección
--                de Trabajo (obligatorio en el peldaño 4)
--   rectifica    id del evento que esta RECTIFICACION deja atrás
--   reclamo      {estado, fecha, resuelto_por, resolucion}  (RIT Art. 77)

-- La consulta de reincidencia mira empleado + tipo + fecha. Sin índice son
-- cuatro filas hoy, pero esta tabla es el expediente de 48 personas por años.
CREATE INDEX IF NOT EXISTS idx_employee_events_disciplina
    ON public.employee_events (employee_id, date DESC)
    WHERE type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION','RECTIFICACION');

-- ── 3. ¿Está suspendido este día? ───────────────────────────────────────────
-- La ÚNICA respuesta a esa pregunta. La leen el kiosco, los horarios y la
-- planilla: si cada uno la resolviera por su cuenta, tendríamos las cuatro
-- respuestas distintas que ya costó `turno_del_dia`.
--
-- `plpgsql` y no `sql`: una `LANGUAGE sql` CON `SET search_path` nace con plan
-- genérico y no hay plan personalizado que pedir (ver la regla 4 de CLAUDE.md).
CREATE OR REPLACE FUNCTION public.esta_suspendido(p_employee_id uuid, p_fecha date DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.employee_events e
         WHERE e.employee_id = p_employee_id
           AND e.type = 'SUSPENSION'
           AND e.date <= v_fecha
           -- Sin `endDate` la suspensión es de UN día: el de su fecha. Se
           -- resuelve acá y no en quien pregunta, porque un `endDate` ausente
           -- leído como «para siempre» dejaría a alguien fuera sin que nadie
           -- lo haya decidido.
           AND coalesce(nullif(e.metadata->>'endDate','')::date, e.date) >= v_fecha
           -- Una sanción revocada por el reclamo del Art. 77 no suspende a
           -- nadie: dejó de existir el día que Administración la resolvió.
           AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.esta_suspendido(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esta_suspendido(uuid, date) TO authenticated, service_role;

-- ── 4. Qué peldaño toca ─────────────────────────────────────────────────────
-- El Art. 83 arma la escalera con DOS reglas distintas, y confundirlas es el
-- error caro:
--
--   · peldaño 2 (escrita): «cuando ya haya una o más amonestaciones verbales
--     POR LA MISMA CAUSA». No dice plazo — la causa es lo que manda.
--   · peldaños 3 y 4 (suspensión): «reincida en alguna falta cometida en un
--     periodo de 60 días». Acá manda el PLAZO, y dice «alguna falta», no «la
--     misma»: reincidir es volver a faltar, no repetir la misma falta.
--
-- Y el Art. 86 la hace BAJAR: una RECTIFICACION posterior deja atrás lo
-- anterior, así que los antecedentes se cuentan desde la última.
--
-- Devuelve la propuesta Y sus antecedentes: quien firma tiene que poder ver en
-- qué se apoya. Una escalera que sólo dice «peldaño 3» sin mostrar por qué es
-- indefendible en un juicio, que es justo para lo que existe este registro.
CREATE OR REPLACE FUNCTION public.escalera_disciplinaria(
    p_employee_id uuid,
    p_falta       text,
    p_fecha       date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_fecha    date := coalesce(p_fecha, (now() AT TIME ZONE 'America/El_Salvador')::date);
    v_desde    date;
    v_verbales integer;
    v_previas  integer;
    v_max      integer;
    v_peldano  integer;
    v_hist     json;
BEGIN
    -- El Art. 86: lo anterior a una rectificación «no interfiere en su
    -- desarrollo», o sea que no cuenta para subir de peldaño.
    SELECT max(e.date) INTO v_desde
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type = 'RECTIFICACION'
       AND e.date <= v_fecha;

    -- Verbales por la MISMA causa (Art. 83 num. 2), sin plazo.
    SELECT count(*) INTO v_verbales
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type = 'AMONESTACION_VERBAL'
       AND e.metadata->>'falta' = p_falta
       AND e.date <= v_fecha
       AND (v_desde IS NULL OR e.date > v_desde)
       AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA';

    -- Cualquier falta dentro de 60 días (Art. 83 num. 3 y 4), y el peldaño más
    -- alto ya aplicado en esa ventana: la escalera sube de a uno.
    SELECT count(*), coalesce(max((e.metadata->>'peldano')::int), 0)
      INTO v_previas, v_max
      FROM public.employee_events e
     WHERE e.employee_id = p_employee_id
       AND e.type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION')
       AND e.date <= v_fecha
       AND e.date >= v_fecha - 60
       AND (v_desde IS NULL OR e.date > v_desde)
       AND coalesce(e.metadata->'reclamo'->>'estado','') <> 'REVOCADA';

    v_peldano := CASE
        -- Reincidencia dentro de 60 días: sube uno desde lo más alto aplicado,
        -- con tope en 4. El peldaño 5 —terminación— NO lo propone una función:
        -- es una decisión con nombre y apellido y sale del Art. 50.
        WHEN v_previas > 0 THEN least(v_max + 1, 4)
        -- Sin reincidencia en 60 días, pero con verbales por la misma causa.
        WHEN v_verbales > 0 THEN 2
        ELSE 1
    END;

    SELECT coalesce(json_agg(to_json(h) ORDER BY h.date DESC), '[]'::json) INTO v_hist
      FROM (
        SELECT e.id, e.type, e.date, e.metadata->>'falta' AS falta,
               (e.metadata->>'peldano')::int AS peldano,
               e.metadata->'reclamo'->>'estado' AS reclamo
          FROM public.employee_events e
         WHERE e.employee_id = p_employee_id
           AND e.type IN ('AMONESTACION_VERBAL','AMONESTACION_ESCRITA','SUSPENSION','RECTIFICACION')
           AND e.date <= v_fecha
         ORDER BY e.date DESC
         LIMIT 20
      ) h;

    RETURN json_build_object(
        'peldano',            v_peldano,
        'verbales_misma_causa', v_verbales,
        'faltas_en_60_dias',  v_previas,
        'peldano_mas_alto',   v_max,
        'rectificado_el',     v_desde,
        'exige_autorizacion', v_peldano >= 4,
        'antecedentes',       v_hist
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.escalera_disciplinaria(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalera_disciplinaria(uuid, text, date) TO authenticated, service_role;
