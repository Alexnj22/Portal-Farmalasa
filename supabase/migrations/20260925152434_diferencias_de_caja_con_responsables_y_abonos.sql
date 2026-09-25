SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- Las diferencias de caja: el día entero, quién responde y cómo se abona.
--
-- Lo pidió el usuario el 2026-09-25 sobre Salud 2 del 24-sep: «necesito ver qué
-- días hay diferencias, y cómo puedo abonarlas. Si encontré causa, qué pasó y
-- cómo lo valido. Si no, que pueda seleccionar los responsables —por defecto
-- quienes hicieron ventas en el rango de ese corte— y que se pueda abonar,
-- individual o total».
--
-- Tres cambios de modelo, los tres decididos con el usuario ese día:
--
-- 1. «Se encontró la causa» exige COMPROBANTE: el número del documento que se
--    corrigió o una foto. Hasta hoy bastaba el texto, y una causa sin respaldo
--    es una opinión.
--
-- 2. `REPONE` deja de significar «el dinero ya entró». Pasa a ser «estas
--    personas responden por esta parte», y el dinero entra por ABONOS, que
--    pueden ser parciales y en días distintos. Medido al escribirlo: CERO filas
--    `REPONE` en toda la historia, así que el cambio no reinterpreta nada viejo.
--    El asiento en el sistema pasa a ser POR ABONO: el efectivo entra al cajón el
--    día del abono, no el del faltante.
--
--    Es una reposición VOLUNTARIA y nunca toca la planilla: un faltante no se
--    descuenta del salario (CT Arts. 132 y 134; ver
--    docs/FALTANTES-DE-CAJA-Y-DE-INVENTARIO-2026-08-27.md).
--
-- 3. Quién vendió en el tramo del corte sale de `sales_invoices.cod_vendedor`.
--    El turno (`timesheets`) sigue sin encenderse, y la sala entera como
--    propuesta obligaba a adivinar. En Salud 2, corte de la 1:05 p. m. del
--    24-sep: cinco personas con ventas en ese tramo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El comprobante de la causa ───────────────────────────────────────────
ALTER TABLE public.cortes_caja_diferencias
    ADD COLUMN IF NOT EXISTS evidencia_ref text,
    ADD COLUMN IF NOT EXISTS evidencia_foto_url text;

-- ── 2. Los abonos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cortes_caja_diferencia_abonos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    diferencia_id   bigint NOT NULL REFERENCES public.cortes_caja_diferencias(id) ON DELETE CASCADE,
    persona_id      bigint NOT NULL REFERENCES public.cortes_caja_diferencia_personas(id) ON DELETE CASCADE,
    employee_id     uuid   NOT NULL REFERENCES public.employees(id),
    branch_id       bigint NOT NULL REFERENCES public.branches(id),
    monto           numeric(12,2) NOT NULL CHECK (monto > 0),
    registrado_por  uuid REFERENCES public.employees(id),
    registrado_at   timestamptz NOT NULL DEFAULT now(),
    impreso_at      timestamptz,
    asentado_at     timestamptz,
    asentado_por    uuid REFERENCES public.employees(id),
    asentado_ref    text,
    anulada_at      timestamptz,
    anulada_por     uuid REFERENCES public.employees(id),
    anulada_motivo  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cortes_abono_anulado_con_motivo
        CHECK (anulada_at IS NULL OR btrim(coalesce(anulada_motivo, '')) <> ''),
    CONSTRAINT cortes_abono_asiento_completo
        CHECK ((asentado_at IS NULL) = (asentado_por IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_cortes_abonos_diferencia ON public.cortes_caja_diferencia_abonos (diferencia_id);
CREATE INDEX IF NOT EXISTS idx_cortes_abonos_persona    ON public.cortes_caja_diferencia_abonos (persona_id);
CREATE INDEX IF NOT EXISTS idx_cortes_abonos_empleado   ON public.cortes_caja_diferencia_abonos (employee_id);
CREATE INDEX IF NOT EXISTS idx_cortes_abonos_sin_asentar
    ON public.cortes_caja_diferencia_abonos (branch_id)
 WHERE anulada_at IS NULL AND asentado_at IS NULL;

ALTER TABLE public.cortes_caja_diferencia_abonos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.cortes_caja_diferencia_abonos;
CREATE POLICY bloqueo_global ON public.cortes_caja_diferencia_abonos
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT auth_no_bloqueado()));

-- Se escribe sólo por las funciones de abajo (DEFINER): no hay policy de
-- escritura a propósito. Se lee con las mismas reglas que su diferencia.
DROP POLICY IF EXISTS cortes_abonos_select ON public.cortes_caja_diferencia_abonos;
CREATE POLICY cortes_abonos_select ON public.cortes_caja_diferencia_abonos
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('cortes_caja', 'can_view'))
           AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
                OR branch_id = (SELECT auth_employee_branch_id())));

REVOKE ALL ON public.cortes_caja_diferencia_abonos FROM anon;
GRANT SELECT ON public.cortes_caja_diferencia_abonos TO authenticated;

ALTER TABLE public.cortes_caja_eventos DROP CONSTRAINT IF EXISTS cortes_caja_eventos_accion_check;
ALTER TABLE public.cortes_caja_eventos ADD CONSTRAINT cortes_caja_eventos_accion_check
    CHECK (accion = ANY (ARRAY['CONFIRMAR','DESCARTAR','REABRIR','RESOLVER_DIFERENCIA',
                               'ANULAR_DIFERENCIA','ASENTAR','RECIBIR',
                               'ABONAR','ANULAR_ABONO']));

-- ── 3. Quién vendió en el tramo ─────────────────────────────────────────────
-- El tramo empieza donde terminó el último corte CONFIRMADO del día —la misma
-- base que usa `corte_tramo`— y termina en la hora de este. Una factura
-- invalidada en Hacienda no es una venta que haya metido dinero.
--
-- Uso interno: la llaman funciones DEFINER. No se expone.
CREATE OR REPLACE FUNCTION public.corte_vendedores_del_tramo(p_corte_id bigint)
 RETURNS TABLE(employee_id uuid, ventas integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
    v       public.cortes_caja;
    v_desde time;
BEGIN
    SELECT * INTO v FROM public.cortes_caja c WHERE c.id = p_corte_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT c2.hora INTO v_desde
      FROM public.cortes_caja c2
     WHERE c2.branch_id = v.branch_id
       AND c2.fecha     = v.fecha
       AND c2.tipo      = 'C'
       AND c2.estado    = 'CONFIRMADO'
       AND (c2.hora, c2.id) < (v.hora, v.id)
     ORDER BY c2.hora DESC, c2.id DESC
     LIMIT 1;

    RETURN QUERY
    SELECT e.id, count(*)::integer
      FROM public.sales_invoices si
      JOIN public.employees e ON e.code = si.cod_vendedor
     WHERE si.branch_id = v.branch_id
       AND si.fecha     = v.fecha
       AND si.hora     <= v.hora
       AND (v_desde IS NULL OR si.hora > v_desde)
       AND si.estado IS DISTINCT FROM 'DTE INVALIDADO EN MH'
     GROUP BY e.id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.corte_vendedores_del_tramo(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.corte_vendedores_del_tramo(bigint) TO service_role;

-- Los candidatos a responder: ahora con cuántas ventas hizo cada uno en el
-- tramo, y quien vendió entra aunque su ficha sea de otra sala (estaba
-- cubriendo). DROP porque cambia el tipo de retorno.
DROP FUNCTION IF EXISTS public.get_corte_turno(bigint);
CREATE FUNCTION public.get_corte_turno(p_corte_id bigint)
 RETURNS TABLE(id uuid, name text, photo_url text, del_turno boolean, ventas integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
DECLARE
    v public.cortes_caja;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v FROM public.cortes_caja c WHERE c.id = p_corte_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    RETURN QUERY
    WITH turno AS (
        SELECT DISTINCT t.employee_id
          FROM public.timesheets t
          JOIN public.shifts s    ON s.id = t.scheduled_shift_id
          JOIN public.employees e ON e.id = t.employee_id
         WHERE t.work_date = v.fecha
           AND NOT t.is_absent
           AND e.branch_id = v.branch_id
           AND ((s.end_time > s.start_time AND v.hora BETWEEN s.start_time AND s.end_time)
             OR (s.end_time <= s.start_time AND (v.hora >= s.start_time OR v.hora <= s.end_time)))
    ), vend AS (
        SELECT x.employee_id, x.ventas FROM public.corte_vendedores_del_tramo(p_corte_id) x
    )
    SELECT e.id, e.name, e.photo_url,
           (e.id IN (SELECT t.employee_id FROM turno t)),
           coalesce(vd.ventas, 0)
      FROM public.employees e
      LEFT JOIN vend vd ON vd.employee_id = e.id
     WHERE e.status = 'ACTIVO'
       AND (e.branch_id = v.branch_id
            OR vd.employee_id IS NOT NULL
            OR e.id = (SELECT auth_employee_id()))
     ORDER BY coalesce(vd.ventas, 0) DESC,
              (e.id IN (SELECT t.employee_id FROM turno t)) DESC,
              e.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_corte_turno(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_corte_turno(bigint) TO authenticated, service_role;

-- ── 4. Resolver: la causa con comprobante, y REPONE como asignación ─────────
DROP FUNCTION IF EXISTS public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb);
CREATE FUNCTION public.resolver_diferencia_corte(
    p_corte_id bigint, p_via text, p_causa text, p_monto_esperado numeric,
    p_personas jsonb DEFAULT '[]'::jsonb,
    p_evidencia_ref text DEFAULT NULL,
    p_evidencia_foto text DEFAULT NULL)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_corte  public.cortes_caja;
    v_scope  text;
    v_monto  numeric;
    v_dif    public.cortes_caja_diferencias;
    v_suma   numeric;
    v_cuenta integer;
    v_ajeno  text;
    v_ref    text := NULLIF(btrim(coalesce(p_evidencia_ref, '')), '');
    v_foto   text := NULLIF(btrim(coalesce(p_evidencia_foto, '')), '');
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF p_via NOT IN ('REPONE','RETIRA','JUSTIFICA') THEN
        RAISE EXCEPTION 'Via invalida: %', p_via;
    END IF;

    IF p_causa IS NULL OR btrim(p_causa) = '' THEN
        RAISE EXCEPTION 'Resolver una diferencia exige decir la causa.';
    END IF;

    -- Decidido con el usuario el 2026-09-25: una causa encontrada se respalda.
    IF p_via = 'JUSTIFICA' AND v_ref IS NULL AND v_foto IS NULL THEN
        RAISE EXCEPTION 'Una causa encontrada necesita su comprobante: el numero del documento que se corrigio o una foto.';
    END IF;

    SELECT * INTO v_corte FROM public.cortes_caja WHERE id = p_corte_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El corte no existe.'; END IF;

    v_scope := (SELECT auth_module_scope('cortes_caja'));
    IF v_scope IS DISTINCT FROM 'ALL'
       AND v_corte.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_corte.tipo <> 'C' THEN
        RAISE EXCEPTION 'El cierre del dia no tiene diferencia que resolver.';
    END IF;

    IF v_corte.estado = 'DESCARTADO' THEN
        RAISE EXCEPTION 'Un corte descartado no tiene diferencia que reponer.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.corte_id = p_corte_id AND d.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este corte ya tiene su diferencia resuelta.';
    END IF;

    -- El monto lo pone el servidor. Ver el encabezado de 20260814211953.
    v_monto := public.corte_tramo(p_corte_id);

    IF abs(v_monto) < 0.01 THEN
        RAISE EXCEPTION 'Este corte cuadra: no hay diferencia que resolver.';
    END IF;

    IF p_monto_esperado IS NULL OR abs(v_monto - p_monto_esperado) >= 0.01 THEN
        RAISE EXCEPTION 'La diferencia cambio mientras se resolvia: ahora es %, no %. Hay que abrirla de nuevo.',
            to_char(v_monto, 'FM999999990.00'), to_char(coalesce(p_monto_esperado, 0), 'FM999999990.00');
    END IF;

    IF p_via = 'REPONE' AND v_monto > 0 THEN
        RAISE EXCEPTION 'Este corte tiene sobrante: no hay nada que reponer.';
    END IF;
    IF p_via = 'RETIRA' AND v_monto < 0 THEN
        RAISE EXCEPTION 'Este corte tiene faltante: no hay nada que retirar.';
    END IF;

    SELECT count(*), coalesce(sum((x->>'monto')::numeric), 0)
      INTO v_cuenta, v_suma
      FROM jsonb_array_elements(coalesce(p_personas, '[]'::jsonb)) x;

    IF p_via = 'REPONE' THEN
        IF v_cuenta = 0 THEN
            RAISE EXCEPTION 'Falta decir quien responde por el faltante.';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_personas) x
                    WHERE coalesce((x->>'monto')::numeric, 0) <= 0) THEN
            RAISE EXCEPTION 'Cada responsable tiene que llevar una parte mayor que cero.';
        END IF;
        IF abs(v_suma - abs(v_monto)) >= 0.01 THEN
            RAISE EXCEPTION 'Las partes suman % y el faltante es %.',
                to_char(v_suma, 'FM999999990.00'), to_char(abs(v_monto), 'FM999999990.00');
        END IF;

        -- Puede responder quien trabaja en la sala, o quien vendió en el tramo
        -- aunque su ficha sea de otra (estaba cubriendo).
        SELECT coalesce(e.name, 'Esa persona') INTO v_ajeno
          FROM jsonb_array_elements(p_personas) x
          LEFT JOIN public.employees e ON e.id = (x->>'employee_id')::uuid
         WHERE e.id IS NULL
            OR e.status <> 'ACTIVO'
            OR (e.branch_id IS DISTINCT FROM v_corte.branch_id
                AND NOT EXISTS (SELECT 1 FROM public.employee_branches eb
                                 WHERE eb.employee_id = e.id AND eb.branch_id = v_corte.branch_id)
                AND NOT EXISTS (SELECT 1 FROM public.corte_vendedores_del_tramo(p_corte_id) vt
                                 WHERE vt.employee_id = e.id))
         LIMIT 1;

        IF v_ajeno IS NOT NULL THEN
            RAISE EXCEPTION '% no trabaja en esa sala ni vendio en ese corte, o ya no esta activa: no puede responder por este faltante.', v_ajeno;
        END IF;
    ELSIF v_cuenta > 0 THEN
        RAISE EXCEPTION 'Solo un faltante sin causa lleva responsables.';
    END IF;

    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por,
         evidencia_ref, evidencia_foto_url)
    VALUES (p_corte_id, v_corte.branch_id, v_corte.fecha, v_monto, p_via,
            btrim(p_causa), (SELECT auth_employee_id()), v_ref, v_foto)
    RETURNING * INTO v_dif;

    IF v_cuenta > 0 THEN
        INSERT INTO public.cortes_caja_diferencia_personas
            (diferencia_id, employee_id, monto, del_turno)
        SELECT v_dif.id, (x->>'employee_id')::uuid, round((x->>'monto')::numeric, 2),
               coalesce((x->>'del_turno')::boolean, false)
          FROM jsonb_array_elements(p_personas) x;
    END IF;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (p_corte_id, 'RESOLVER_DIFERENCIA', btrim(p_causa),
            p_via || ' ' || to_char(v_monto, 'FM999999990.00')
              || CASE WHEN v_ref IS NOT NULL THEN ' · ' || v_ref ELSE '' END,
            (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_diferencia_corte(bigint, text, text, numeric, jsonb, text, text) TO authenticated, service_role;

-- ── 5. Corregir a causa encontrada: también con comprobante ─────────────────
DROP FUNCTION IF EXISTS public.justificar_diferencia_corte(bigint, text, text);
CREATE FUNCTION public.justificar_diferencia_corte(
    p_id bigint, p_motivo text, p_causa text DEFAULT NULL,
    p_evidencia_ref text DEFAULT NULL, p_evidencia_foto text DEFAULT NULL)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_vieja public.cortes_caja_diferencias;
    v_nueva public.cortes_caja_diferencias;
    v_causa text;
    v_ref   text := NULLIF(btrim(coalesce(p_evidencia_ref, '')), '');
    v_foto  text := NULLIF(btrim(coalesce(p_evidencia_foto, '')), '');
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Corregir una resolucion exige decir por que.';
    END IF;
    IF v_ref IS NULL AND v_foto IS NULL THEN
        RAISE EXCEPTION 'Una causa encontrada necesita su comprobante: el numero del documento que se corrigio o una foto.';
    END IF;

    SELECT * INTO v_vieja FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_vieja.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_vieja.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion ya estaba anulada.';
    END IF;
    IF v_vieja.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolucion ya se registro en el sistema: no se puede corregir desde aca.';
    END IF;
    IF v_vieja.via = 'JUSTIFICA' THEN
        RAISE EXCEPTION 'Esta diferencia ya esta como causa encontrada: no mueve dinero.';
    END IF;
    -- El dinero que ya entró por abonos está en el cajón: si la causa aparece
    -- después, primero se anulan (y se devuelven) los abonos.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                WHERE a.diferencia_id = p_id AND a.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este faltante ya tiene abonos: hay que anularlos antes de cambiarlo a causa encontrada.';
    END IF;

    v_causa := coalesce(NULLIF(btrim(coalesce(p_causa, '')), ''), v_vieja.causa);

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id;

    INSERT INTO public.cortes_caja_diferencias
        (corte_id, branch_id, fecha, monto, via, causa, registrado_por,
         evidencia_ref, evidencia_foto_url)
    VALUES (v_vieja.corte_id, v_vieja.branch_id, v_vieja.fecha, v_vieja.monto,
            'JUSTIFICA', v_causa, (SELECT auth_employee_id()), v_ref, v_foto)
    RETURNING * INTO v_nueva;

    INSERT INTO public.cortes_caja_eventos
        (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_vieja.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo),
            'Se corrige: era ' || v_vieja.via, (SELECT auth_employee_id())),
           (v_vieja.corte_id, 'RESOLVER_DIFERENCIA', v_causa,
            'JUSTIFICA ' || to_char(v_nueva.monto, 'FM999999990.00')
              || CASE WHEN v_ref IS NOT NULL THEN ' · ' || v_ref ELSE '' END,
            (SELECT auth_employee_id()));

    RETURN v_nueva;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.justificar_diferencia_corte(bigint, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.justificar_diferencia_corte(bigint, text, text, text, text) TO authenticated, service_role;

-- ── 6. Anular una resolución: no con abonos vivos ───────────────────────────
CREATE OR REPLACE FUNCTION public.anular_diferencia_corte(p_id bigint, p_motivo text)
 RETURNS cortes_caja_diferencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dif public.cortes_caja_diferencias;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular exige decir por que.';
    END IF;

    SELECT * INTO v_dif FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_dif.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_dif.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion ya estaba anulada.';
    END IF;

    IF v_dif.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolucion ya se registro en el sistema: no se puede anular desde aca.';
    END IF;

    -- Anularla con abonos vivos borraría de la cuenta dinero que ya entró.
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                WHERE a.diferencia_id = p_id AND a.anulada_at IS NULL) THEN
        RAISE EXCEPTION 'Este faltante ya tiene abonos: hay que anularlos primero.';
    END IF;

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id RETURNING * INTO v_dif;

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    VALUES (v_dif.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo), (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$function$;

-- ── 7. Abonar ───────────────────────────────────────────────────────────────
-- `p_abonos`: [{ persona_id, monto }]. «Individual» es una fila; «total» son
-- todas con su saldo. Nadie abona más de lo que le queda: el saldo lo calcula
-- el servidor con la diferencia bloqueada, así que dos pantallas abiertas no
-- pueden cobrar dos veces la misma parte.
CREATE OR REPLACE FUNCTION public.abonar_diferencia_corte(p_diferencia_id bigint, p_abonos jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_dif    public.cortes_caja_diferencias;
    v_mal    text;
    v_ids    bigint[];
    v_total  numeric;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_dif FROM public.cortes_caja_diferencias WHERE id = p_diferencia_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_dif.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF v_dif.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esa resolucion esta anulada.';
    END IF;
    IF v_dif.via <> 'REPONE' THEN
        RAISE EXCEPTION 'Solo un faltante con responsables recibe abonos.';
    END IF;

    IF p_abonos IS NULL OR jsonb_typeof(p_abonos) <> 'array' OR jsonb_array_length(p_abonos) = 0 THEN
        RAISE EXCEPTION 'No hay nada que abonar.';
    END IF;

    -- Una persona que no es de esta resolución, un monto en cero o repetida.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_abonos) x
                WHERE coalesce((x->>'monto')::numeric, 0) <= 0) THEN
        RAISE EXCEPTION 'Cada abono tiene que ser mayor que cero.';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT (x->>'persona_id')) FROM jsonb_array_elements(p_abonos) x) THEN
        RAISE EXCEPTION 'Una persona aparece dos veces en el mismo abono.';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_abonos) x
                WHERE NOT EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_personas p
                                   WHERE p.id = (x->>'persona_id')::bigint
                                     AND p.diferencia_id = p_diferencia_id)) THEN
        RAISE EXCEPTION 'Alguien del abono no responde por este faltante. Hay que cargar de nuevo.';
    END IF;

    SELECT e.name || ' debe ' || to_char(p.monto - coalesce(ya.abonado, 0), 'FM999999990.00')
             || ' y se quiere abonar ' || to_char(round((x->>'monto')::numeric, 2), 'FM999999990.00')
      INTO v_mal
      FROM jsonb_array_elements(p_abonos) x
      JOIN public.cortes_caja_diferencia_personas p ON p.id = (x->>'persona_id')::bigint
      JOIN public.employees e ON e.id = p.employee_id
      LEFT JOIN LATERAL (
          SELECT sum(a.monto) AS abonado FROM public.cortes_caja_diferencia_abonos a
           WHERE a.persona_id = p.id AND a.anulada_at IS NULL) ya ON true
     WHERE round((x->>'monto')::numeric, 2) > p.monto - coalesce(ya.abonado, 0) + 0.001
     LIMIT 1;

    IF v_mal IS NOT NULL THEN
        RAISE EXCEPTION 'No se puede abonar mas de lo que queda: %.', v_mal;
    END IF;

    WITH ins AS (
        INSERT INTO public.cortes_caja_diferencia_abonos
            (diferencia_id, persona_id, employee_id, branch_id, monto, registrado_por)
        SELECT p_diferencia_id, p.id, p.employee_id, v_dif.branch_id,
               round((x->>'monto')::numeric, 2), (SELECT auth_employee_id())
          FROM jsonb_array_elements(p_abonos) x
          JOIN public.cortes_caja_diferencia_personas p ON p.id = (x->>'persona_id')::bigint
        RETURNING id, monto
    )
    SELECT array_agg(id), sum(monto) INTO v_ids, v_total FROM ins;

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_dif.corte_id, 'ABONAR',
            'Abono al faltante',
            array_length(v_ids, 1) || ' abono(s) por ' || to_char(v_total, 'FM999999990.00'),
            (SELECT auth_employee_id()));

    RETURN (
        SELECT coalesce(json_agg(json_build_object(
                   'id', a.id, 'persona_id', a.persona_id, 'employee_id', a.employee_id,
                   'nombre', e.name, 'monto', a.monto, 'registrado_at', a.registrado_at)
                   ORDER BY e.name), '[]'::json)
          FROM public.cortes_caja_diferencia_abonos a
          JOIN public.employees e ON e.id = a.employee_id
         WHERE a.id = ANY(v_ids));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.abonar_diferencia_corte(bigint, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.abonar_diferencia_corte(bigint, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.anular_abono_diferencia(p_id bigint, p_motivo text)
 RETURNS cortes_caja_diferencia_abonos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ab  public.cortes_caja_diferencia_abonos;
    v_cid bigint;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
        RAISE EXCEPTION 'Anular exige decir por que.';
    END IF;

    SELECT * INTO v_ab FROM public.cortes_caja_diferencia_abonos WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese abono no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_ab.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_ab.anulada_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese abono ya estaba anulado.';
    END IF;
    IF v_ab.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Ese abono ya se registro en el sistema: no se puede anular desde aca.';
    END IF;

    UPDATE public.cortes_caja_diferencia_abonos SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo)
    WHERE id = p_id RETURNING * INTO v_ab;

    SELECT d.corte_id INTO v_cid FROM public.cortes_caja_diferencias d WHERE d.id = v_ab.diferencia_id;
    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, nota, employee_id)
    VALUES (v_cid, 'ANULAR_ABONO', btrim(p_motivo),
            to_char(v_ab.monto, 'FM999999990.00'), (SELECT auth_employee_id()));

    RETURN v_ab;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_abono_diferencia(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_abono_diferencia(bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.marcar_abonos_impresos(p_ids bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_n integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    UPDATE public.cortes_caja_diferencia_abonos a SET impreso_at = now()
     WHERE a.id = ANY(p_ids)
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR a.branch_id = (SELECT auth_employee_branch_id()));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.marcar_abonos_impresos(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.marcar_abonos_impresos(bigint[]) TO authenticated, service_role;

-- ── 8. Registrar en el sistema: ahora también abonos ────────────────────────
-- Una reposición ya no se asienta entera: se asientan sus abonos, que son los
-- que meten efectivo al cajón y cada uno el día en que se hizo. Un abono es
-- dinero que ENTRA, así que no se junta con un retiro de sobrante.
DROP FUNCTION IF EXISTS public.asentar_diferencias_corte(bigint[], text);
CREATE FUNCTION public.asentar_diferencias_corte(
    p_ids bigint[], p_ref text, p_abono_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_ids    bigint[] := coalesce(p_ids, '{}');
    v_abs    bigint[] := coalesce(p_abono_ids, '{}');
    v_signos integer;
    v_salas  integer;
    v_scope  text := (SELECT auth_module_scope('cortes_caja'));
    v_rama   bigint := (SELECT auth_employee_branch_id());
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF cardinality(v_ids) = 0 AND cardinality(v_abs) = 0 THEN
        RAISE EXCEPTION 'No hay nada que registrar.';
    END IF;
    IF p_ref IS NULL OR btrim(p_ref) = '' THEN
        RAISE EXCEPTION 'Falta el numero con que quedo el ingreso o el vale.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND v_scope IS DISTINCT FROM 'ALL'
                  AND d.branch_id IS DISTINCT FROM v_rama)
       OR EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                   WHERE a.id = ANY(v_abs) AND v_scope IS DISTINCT FROM 'ALL'
                     AND a.branch_id IS DISTINCT FROM v_rama) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND (d.anulada_at IS NOT NULL OR d.asentado_at IS NOT NULL))
       OR EXISTS (SELECT 1 FROM public.cortes_caja_diferencia_abonos a
                   WHERE a.id = ANY(v_abs) AND (a.anulada_at IS NOT NULL OR a.asentado_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Alguna ya estaba registrada o anulada. Hay que cargar la lista de nuevo.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND d.via = 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Una diferencia justificada no mueve dinero: no va en el ingreso.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(v_ids) AND d.via = 'REPONE') THEN
        RAISE EXCEPTION 'Un faltante con responsables se registra por sus abonos, no entero.';
    END IF;

    -- Un abono ENTRA (signo -1, como el faltante que repone); un retiro SALE.
    SELECT count(DISTINCT s), count(DISTINCT b) INTO v_signos, v_salas FROM (
        SELECT sign(d.monto) s, d.branch_id b FROM public.cortes_caja_diferencias d WHERE d.id = ANY(v_ids)
        UNION ALL
        SELECT -1, a.branch_id FROM public.cortes_caja_diferencia_abonos a WHERE a.id = ANY(v_abs)
    ) x;

    IF v_signos > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar faltantes y sobrantes: son dos documentos distintos.';
    END IF;
    IF v_salas > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar diferencias de dos salas: cada caja lleva su propio movimiento.';
    END IF;

    UPDATE public.cortes_caja_diferencias d SET
        asentado_at = now(), asentado_por = (SELECT auth_employee_id()),
        asentado_ref = btrim(p_ref), updated_at = now()
    WHERE d.id = ANY(v_ids);

    UPDATE public.cortes_caja_diferencia_abonos a SET
        asentado_at = now(), asentado_por = (SELECT auth_employee_id()),
        asentado_ref = btrim(p_ref)
    WHERE a.id = ANY(v_abs);

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    SELECT DISTINCT x.corte_id, 'ASENTAR', btrim(p_ref), (SELECT auth_employee_id())
      FROM (SELECT d.corte_id FROM public.cortes_caja_diferencias d WHERE d.id = ANY(v_ids)
            UNION
            SELECT d.corte_id FROM public.cortes_caja_diferencia_abonos a
              JOIN public.cortes_caja_diferencias d ON d.id = a.diferencia_id
             WHERE a.id = ANY(v_abs)) x;

    RETURN json_build_object('diferencias', cardinality(v_ids), 'abonos', cardinality(v_abs));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.asentar_diferencias_corte(bigint[], text, bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.asentar_diferencias_corte(bigint[], text, bigint[]) TO authenticated, service_role;

-- ── 9. Las resoluciones de un rango: con comprobante, saldos y abonos ───────
-- Sigue `LANGUAGE sql` —está declarada en scripts/planes-genericos.json— y sus
-- parámetros no cambian; sólo agrega columnas, por eso el DROP.
DROP FUNCTION IF EXISTS public.get_cortes_diferencias(date, date);
CREATE FUNCTION public.get_cortes_diferencias(p_desde date, p_hasta date)
 RETURNS TABLE(id bigint, corte_id bigint, branch_id bigint, fecha date, hora time without time zone,
               monto numeric, via text, causa text, registrado_at timestamp with time zone,
               registrado_nombre text, impreso_at timestamp with time zone,
               asentado_at timestamp with time zone, asentado_ref text, asentado_nombre text,
               anulada_at timestamp with time zone, anulada_motivo text, personas jsonb,
               evidencia_ref text, evidencia_foto_url text, abonos jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.id, d.corte_id, d.branch_id, d.fecha, c.hora,
           d.monto, d.via, d.causa,
           d.registrado_at, r.name, d.impreso_at,
           d.asentado_at, d.asentado_ref, a.name,
           d.anulada_at, d.anulada_motivo,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'persona_id', p.id,
                          'employee_id', p.employee_id, 'nombre', e.name,
                          'monto', p.monto, 'del_turno', p.del_turno,
                          'abonado', coalesce(ya.abonado, 0),
                          'saldo', p.monto - coalesce(ya.abonado, 0))
                      ORDER BY e.name)
                 FROM public.cortes_caja_diferencia_personas p
                 JOIN public.employees e ON e.id = p.employee_id
                 LEFT JOIN LATERAL (
                     SELECT sum(ab.monto) AS abonado FROM public.cortes_caja_diferencia_abonos ab
                      WHERE ab.persona_id = p.id AND ab.anulada_at IS NULL) ya ON true
                WHERE p.diferencia_id = d.id), '[]'::jsonb),
           d.evidencia_ref, d.evidencia_foto_url,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'id', ab.id, 'persona_id', ab.persona_id,
                          'employee_id', ab.employee_id, 'nombre', e.name,
                          'monto', ab.monto, 'registrado_at', ab.registrado_at,
                          'registrado_nombre', rr.name, 'impreso_at', ab.impreso_at,
                          'asentado_at', ab.asentado_at, 'asentado_ref', ab.asentado_ref,
                          'anulada_at', ab.anulada_at, 'anulada_motivo', ab.anulada_motivo)
                      ORDER BY ab.registrado_at)
                 FROM public.cortes_caja_diferencia_abonos ab
                 JOIN public.employees e ON e.id = ab.employee_id
                 LEFT JOIN public.employees rr ON rr.id = ab.registrado_por
                WHERE ab.diferencia_id = d.id), '[]'::jsonb)
      FROM public.cortes_caja_diferencias d
      JOIN public.cortes_caja c ON c.id = d.corte_id
      LEFT JOIN public.employees r ON r.id = d.registrado_por
      LEFT JOIN public.employees a ON a.id = d.asentado_por
     WHERE (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR d.branch_id = (SELECT auth_employee_branch_id()))
       AND d.fecha BETWEEN p_desde AND p_hasta
     ORDER BY d.fecha DESC, d.registrado_at DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) TO authenticated, service_role;

-- ── 10. Los días con diferencia ─────────────────────────────────────────────
-- Un día por sala con: cómo quedó (la suma de los tramos CONFIRMADOS, que
-- telescopa a la diferencia acumulada del último confirmado) y cada corte cuyo
-- tramo no cuadró, con su resolución.
--
-- Existe porque el día que cerró con −$20.25 en Salud 2 (24-sep) mostraba el
-- último corte en $0.00 —su tramo— y la única pista estaba en una línea chica
-- de ese corte. «Cómo quedó el día» no se leía en ninguna parte.
--
-- Todo el historial desde el 14-ago cuesta 65 ms (medido: 513 cortes).
CREATE OR REPLACE FUNCTION public.get_dias_con_diferencia(p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_scope text;
    v_rama  bigint;
BEGIN
    IF NOT (SELECT auth_has_module_permission('cortes_caja', 'can_view')) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    v_scope := (SELECT auth_module_scope('cortes_caja'));
    v_rama  := (SELECT auth_employee_branch_id());

    RETURN (
        WITH base AS (
            SELECT c.id, c.branch_id, c.fecha, c.hora, c.estado, c.empleado_texto,
                   c.total_declarado, public.corte_tramo(c.id) AS tramo
              FROM public.cortes_caja c
             WHERE c.tipo = 'C'
               AND c.estado <> 'DESCARTADO'
               AND c.fecha BETWEEN p_desde AND p_hasta
               AND (v_scope = 'ALL' OR c.branch_id = v_rama)
               AND NOT public.corte_no_conto_efectivo(c.tipo, c.total_declarado, c.diferencia_erp, c.tk_total_caja)
        ), dias AS (
            SELECT b.branch_id, b.fecha,
                   round(coalesce(sum(b.tramo) FILTER (WHERE b.estado = 'CONFIRMADO'), 0), 2) AS neto,
                   count(*) AS cortes
              FROM base b GROUP BY 1, 2
        ), con AS (
            SELECT b.* FROM base b WHERE abs(b.tramo) >= 0.01
        )
        SELECT coalesce(json_agg(json_build_object(
                   'branch_id', d.branch_id, 'fecha', d.fecha, 'neto', d.neto,
                   'cortes_del_dia', d.cortes,
                   'cortes', (
                       SELECT json_agg(json_build_object(
                                  'id', k.id, 'hora', k.hora, 'estado', k.estado,
                                  'empleado_texto', k.empleado_texto, 'tramo', k.tramo,
                                  'diferencia', (
                                      SELECT json_build_object(
                                          'id', df.id, 'via', df.via, 'monto', df.monto,
                                          'causa', df.causa,
                                          'evidencia_ref', df.evidencia_ref,
                                          'evidencia_foto_url', df.evidencia_foto_url,
                                          'registrado_at', df.registrado_at,
                                          'registrado_nombre', rg.name,
                                          'asentado_at', df.asentado_at, 'asentado_ref', df.asentado_ref,
                                          'impreso_at', df.impreso_at,
                                          'responsables', (SELECT count(*) FROM public.cortes_caja_diferencia_personas p
                                                            WHERE p.diferencia_id = df.id),
                                          'asignado', (SELECT coalesce(sum(p.monto), 0) FROM public.cortes_caja_diferencia_personas p
                                                        WHERE p.diferencia_id = df.id),
                                          'abonado', (SELECT coalesce(sum(ab.monto), 0) FROM public.cortes_caja_diferencia_abonos ab
                                                       WHERE ab.diferencia_id = df.id AND ab.anulada_at IS NULL),
                                          'abonos_sin_asentar', (SELECT count(*) FROM public.cortes_caja_diferencia_abonos ab
                                                                  WHERE ab.diferencia_id = df.id AND ab.anulada_at IS NULL
                                                                    AND ab.asentado_at IS NULL))
                                        FROM public.cortes_caja_diferencias df
                                        LEFT JOIN public.employees rg ON rg.id = df.registrado_por
                                       WHERE df.corte_id = k.id AND df.anulada_at IS NULL))
                              ORDER BY k.hora, k.id)
                         FROM con k
                        WHERE k.branch_id = d.branch_id AND k.fecha = d.fecha))
                   ORDER BY d.fecha DESC, d.branch_id), '[]'::json)
          FROM dias d
         WHERE EXISTS (SELECT 1 FROM con k WHERE k.branch_id = d.branch_id AND k.fecha = d.fecha)
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dias_con_diferencia(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dias_con_diferencia(date, date) TO authenticated, service_role;
