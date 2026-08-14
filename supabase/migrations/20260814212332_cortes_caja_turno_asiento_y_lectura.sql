-- Cortes de caja: quiénes son «los del turno», anular, imprimir y asentar.

SET lock_timeout = '5s';

-- ── Los candidatos a aportar ───────────────────────────────────────────────
-- «Quedarán registrados los del turno, ahí se puede seleccionar o quitar si uno
-- no aportó» (usuario, 2026-08-14).
--
-- El módulo de turnos ESTÁ CONSTRUIDO PERO NO ENCENDIDO: al 2026-08-14
-- `attendance` tiene 0 filas y `timesheets` 380 de sólo dos salas, todas con
-- `is_absent`. O sea que hoy no hay turno que leer. Por eso esta función mira
-- primero el registro y, cuando no encuentra a nadie, cae a los activos de la
-- sala — así el día que turnos se encienda empieza a proponer el turno real sin
-- tocar una línea de código.
--
-- `del_turno` dice de dónde salió cada nombre, y se guarda en la fila: es la
-- diferencia entre «el registro dice que estaba» y «alguien dijo que estaba».
--
-- Pendiente para cuando turnos esté vivo: la cobertura entre salas vive en
-- `schedule_coverage`, que hoy está vacía y cuyo `schedule_data` es jsonb sin
-- forma conocida. Inventarle una forma sería adivinar; se agrega midiendo.
CREATE OR REPLACE FUNCTION public.get_corte_turno(p_corte_id bigint)
RETURNS TABLE(id uuid, name text, photo_url text, del_turno boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
           -- El turno de cierre puede cruzar la medianoche: ahí el rango es al revés.
           AND ((s.end_time > s.start_time AND v.hora BETWEEN s.start_time AND s.end_time)
             OR (s.end_time <= s.start_time AND (v.hora >= s.start_time OR v.hora <= s.end_time)))
    )
    SELECT e.id, e.name, e.photo_url,
           (e.id IN (SELECT t.employee_id FROM turno t)) AS del_turno
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND (e.branch_id = v.branch_id
            -- Quien resuelve entra siempre: es la persona responsable, y puede
            -- estar cubriendo una sala que no es la suya.
            OR e.id = (SELECT auth_employee_id()))
     ORDER BY (e.id IN (SELECT t.employee_id FROM turno t)) DESC, e.name;
END;
$$;

-- ── Anular una resolución ──────────────────────────────────────────────────
-- Se anula, nunca se borra: el comprobante ya salió en papel y alguien lo firmó.
CREATE OR REPLACE FUNCTION public.anular_diferencia_corte(p_id bigint, p_motivo text)
RETURNS public.cortes_caja_diferencias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

    -- Ya asentada significa que el dinero se movio en el sistema. Anularla en el
    -- portal dejaria las dos cuentas distintas sin que nadie se entere.
    IF v_dif.asentado_at IS NOT NULL THEN
        RAISE EXCEPTION 'Esta resolucion ya se registro en el sistema: no se puede anular desde aca.';
    END IF;

    UPDATE public.cortes_caja_diferencias SET
        anulada_at = now(), anulada_por = (SELECT auth_employee_id()),
        anulada_motivo = btrim(p_motivo), updated_at = now()
    WHERE id = p_id RETURNING * INTO v_dif;

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    VALUES (v_dif.corte_id, 'ANULAR_DIFERENCIA', btrim(p_motivo), (SELECT auth_employee_id()));

    RETURN v_dif;
END;
$$;

-- ── El papel salió ─────────────────────────────────────────────────────────
-- `ok: true` de la ticketera significa RECIBIDO, nunca «salió papel» — la
-- respuesta del programa de la caja es opaca. Así que esto marca «se mandó a
-- imprimir», y por eso se puede volver a marcar: reimprimir es normal.
CREATE OR REPLACE FUNCTION public.marcar_comprobante_impreso(p_id bigint)
RETURNS public.cortes_caja_diferencias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_dif public.cortes_caja_diferencias;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    SELECT * INTO v_dif FROM public.cortes_caja_diferencias WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa resolucion no existe.'; END IF;

    IF (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
       AND v_dif.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    UPDATE public.cortes_caja_diferencias
       SET impreso_at = now(), updated_at = now()
     WHERE id = p_id RETURNING * INTO v_dif;
    RETURN v_dif;
END;
$$;

-- ── El asiento único ───────────────────────────────────────────────────────
-- «Lo que haríamos es hacer un solo ingreso / vale en el sistema, y en el portal
-- estarían bien definidos» (usuario). Varias resoluciones se marcan de una con
-- el MISMO número de asiento: acá queda el detalle, allá el total.
--
-- No se mezclan entradas con salidas: un ingreso y un vale son dos documentos
-- distintos allá, y marcarlos con la misma referencia haría imposible cuadrarlos.
CREATE OR REPLACE FUNCTION public.asentar_diferencias_corte(p_ids bigint[], p_ref text)
RETURNS SETOF public.cortes_caja_diferencias
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_signos integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['cortes_caja'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'No hay nada que registrar.';
    END IF;
    IF p_ref IS NULL OR btrim(p_ref) = '' THEN
        RAISE EXCEPTION 'Decinos con que numero quedo el ingreso o el vale.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.cortes_caja_diferencias d
         WHERE d.id = ANY(p_ids)
           AND (SELECT auth_module_scope('cortes_caja')) IS DISTINCT FROM 'ALL'
           AND d.branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id())
    ) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(p_ids) AND (d.anulada_at IS NOT NULL OR d.asentado_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Alguna ya estaba registrada o anulada. Volve a cargar la lista.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.cortes_caja_diferencias d
                WHERE d.id = ANY(p_ids) AND d.via = 'JUSTIFICA') THEN
        RAISE EXCEPTION 'Una diferencia justificada no mueve dinero: no va en el ingreso.';
    END IF;

    SELECT count(DISTINCT sign(d.monto)) INTO v_signos
      FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);
    IF v_signos > 1 THEN
        RAISE EXCEPTION 'No se pueden juntar faltantes y sobrantes: son dos documentos distintos.';
    END IF;

    UPDATE public.cortes_caja_diferencias d SET
        asentado_at = now(), asentado_por = (SELECT auth_employee_id()),
        asentado_ref = btrim(p_ref), updated_at = now()
    WHERE d.id = ANY(p_ids);

    INSERT INTO public.cortes_caja_eventos (corte_id, accion, motivo, employee_id)
    SELECT d.corte_id, 'ASENTAR', btrim(p_ref), (SELECT auth_employee_id())
      FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);

    RETURN QUERY
    SELECT d.* FROM public.cortes_caja_diferencias d WHERE d.id = ANY(p_ids);
END;
$$;

-- ── Leer las resoluciones ──────────────────────────────────────────────────
-- Es DEFINER y no un select directo por lo mismo que `get_cortes_resolutores`:
-- la policy de `employees` esconde a los `is_su`, y quien resuelve suele serlo.
-- Sin esto, la tarjeta diria «sin registrar quien» sobre una fila que si tiene
-- autor. Ver `esconder_una_fila_la_esconde_de_toda_pantalla_que_la_nombre`.
CREATE OR REPLACE FUNCTION public.get_cortes_diferencias(p_desde date, p_hasta date)
RETURNS TABLE(
    id bigint, corte_id bigint, branch_id bigint, fecha date,
    monto numeric, via text, causa text,
    registrado_at timestamptz, registrado_nombre text,
    impreso_at timestamptz,
    asentado_at timestamptz, asentado_ref text, asentado_nombre text,
    anulada_at timestamptz, anulada_motivo text,
    personas jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT d.id, d.corte_id, d.branch_id, d.fecha,
           d.monto, d.via, d.causa,
           d.registrado_at, r.name, d.impreso_at,
           d.asentado_at, d.asentado_ref, a.name,
           d.anulada_at, d.anulada_motivo,
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'employee_id', p.employee_id, 'nombre', e.name,
                          'monto', p.monto, 'del_turno', p.del_turno)
                      ORDER BY e.name)
                 FROM public.cortes_caja_diferencia_personas p
                 JOIN public.employees e ON e.id = p.employee_id
                WHERE p.diferencia_id = d.id), '[]'::jsonb)
      FROM public.cortes_caja_diferencias d
      LEFT JOIN public.employees r ON r.id = d.registrado_por
      LEFT JOIN public.employees a ON a.id = d.asentado_por
     WHERE (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR d.branch_id = (SELECT auth_employee_branch_id()))
       AND d.fecha BETWEEN p_desde AND p_hasta
     ORDER BY d.fecha DESC, d.registrado_at DESC;
$$;

-- ── La bitácora de un corte ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_corte_eventos(p_corte_id bigint)
RETURNS TABLE(id bigint, accion text, estado_antes text, estado_despues text,
              motivo text, nota text, nombre text, photo_url text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT v.id, v.accion, v.estado_antes, v.estado_despues, v.motivo, v.nota,
           e.name, e.photo_url, v.created_at
      FROM public.cortes_caja_eventos v
      JOIN public.cortes_caja c ON c.id = v.corte_id
      LEFT JOIN public.employees e ON e.id = v.employee_id
     WHERE v.corte_id = p_corte_id
       AND (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
       AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
            OR c.branch_id = (SELECT auth_employee_branch_id()))
     ORDER BY v.created_at DESC;
$$;

-- ── Permisos ───────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_corte_turno(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.anular_diferencia_corte(bigint, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.marcar_comprobante_impreso(bigint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.asentar_diferencias_corte(bigint[], text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_corte_eventos(bigint) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_corte_turno(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anular_diferencia_corte(bigint, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marcar_comprobante_impreso(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.asentar_diferencias_corte(bigint[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cortes_diferencias(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_corte_eventos(bigint) TO authenticated, service_role;
