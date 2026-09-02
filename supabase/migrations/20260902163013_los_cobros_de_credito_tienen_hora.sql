SET lock_timeout = '5s';

/* ── Los cobros de crédito de un día, con la HORA de cada uno ──────────────
 *
 * El tiquete de un corte imprime «COBROS CREDITO» como un solo número del día,
 * y el sistema de la caja los publica como movimientos sin hora, todos con el
 * mismo concepto («POR ABONO A CREDITO») y sin decir de quién ni cómo pagó. Con
 * eso, un corte que no cuadra por esa línea no se puede investigar: el 1-sep en
 * Salud 3 fueron **$66.10 en nueve cobros** y el detalle mostraba nueve
 * renglones idénticos sin hora.
 *
 * Desde que el abono se hace en el portal, esa hora existe —y es la de verdad,
 * no la de la captura—. Esta función la devuelve para poder decir a QUÉ corte
 * pertenece cada cobro, en vez de deducirlo.
 *
 * ── Por qué una función y no un `select` desde el navegador ────────────────
 * La policy de `creditos_abonos_portal` pide `caja_vales.can_view`, y el
 * detalle del corte es `cortes_caja`. Medido: **Gerente General y Subjefe/a de
 * Sala ven cortes y NO ven vales** — o sea que a las dos personas que más
 * revisan un descuadre la consulta les devolvería una lista vacía, que se lee
 * idéntica a «ese día no hubo cobros de crédito». Un permiso que falta no da
 * error: da un cero que parece un dato.
 *
 * Por eso acepta CUALQUIERA de los dos módulos, y por eso LANZA en vez de
 * devolver vacío: quien no puede ver tiene que enterarse de que no puede.
 *
 * `plpgsql` y no `LANGUAGE sql`: con la cláusula `SET` de la regla 4, una
 * función `sql` se planifica una sola vez con los argumentos como `Params` y
 * nunca ve un valor. Acá el rango de un día es justamente lo que filtra.
 */
CREATE OR REPLACE FUNCTION public.get_abonos_del_dia(p_branch integer, p_fecha date)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_cortes boolean := (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'));
    v_vales  boolean := (SELECT public.auth_has_module_permission('caja_vales', 'can_view'));
    v_todas  boolean;
    v_out    json;
BEGIN
    -- El bloqueo de una persona vive en una policy, y una función DEFINER se
    -- las salta todas. Sin esta línea, bloquear a alguien le cerraría el portal
    -- y le dejaría abierta esta puerta.
    IF NOT (SELECT public.auth_no_bloqueado()) THEN
        RAISE EXCEPTION 'FORBIDDEN: sin acceso';
    END IF;
    IF NOT (v_cortes OR v_vales) THEN
        RAISE EXCEPTION 'FORBIDDEN: no puedes ver los cobros de crédito';
    END IF;

    v_todas := (v_cortes AND (SELECT public.auth_module_scope('cortes_caja')) = 'ALL')
            OR (v_vales  AND (SELECT public.auth_module_scope('caja_vales'))  = 'ALL');
    IF NOT v_todas AND p_branch IS DISTINCT FROM (SELECT public.auth_employee_branch_id()) THEN
        RAISE EXCEPTION 'FORBIDDEN: esa sala no es la tuya';
    END IF;

    SELECT coalesce(json_agg(to_json(t) ORDER BY t.momento), '[]'::json) INTO v_out
    FROM (
        SELECT a.id,
               a.created_at                                            AS momento,
               (a.created_at AT TIME ZONE 'America/El_Salvador')::time  AS hora,
               a.monto, a.forma, a.cliente, a.credito_erp, a.factura_erp,
               a.documento, a.erp_abono_id,
               a.anulado_at IS NOT NULL                                AS anulado,
               e.name                                                  AS quien
        FROM public.creditos_abonos_portal a
        LEFT JOIN public.employees e ON e.id = a.abonado_por
        WHERE a.branch_id = p_branch
          AND (a.created_at AT TIME ZONE 'America/El_Salvador')::date = p_fecha
    ) t;

    RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_abonos_del_dia(integer, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_abonos_del_dia(integer, date) TO authenticated, service_role;

-- El día de un abono se pregunta por sala y por fecha, y hoy eso barre la tabla
-- entera. Son 3 filas, así que no cambia nada todavía; existe para que no
-- empiece a costar el día que sean miles.
CREATE INDEX IF NOT EXISTS creditos_abonos_portal_sala_dia_idx
    ON public.creditos_abonos_portal (branch_id, created_at DESC);
