SET lock_timeout = '5s';

-- Metas Fase 3: la meta como widget del Inicio (docs/PLAN-METAS-2026-08-03.md).
--
-- Por qué un RPC propio y no `get_metas_dashboard` a secas: ese es INVOKER y su
-- CTE `vivo` lee `sales_invoices`, cuya policy exige can_view de 'ventas' /
-- 'minmax_ver_costos' / 'dash_top_productos'. La sala no tiene ninguno de los
-- tres, así que la lectura no falla — devuelve CERO filas — y el widget habría
-- mostrado el mes SIN el día de hoy, que es justo el número que la sala
-- persigue. Este envoltorio es DEFINER (el dueño saltea RLS), así que la venta
-- de hoy entra; y a cambio el permiso se valida acá adentro y la fila que
-- devuelve es SIEMPRE una sola sala.
--
-- La matemática (proyección por perfil de día de semana, tramo del bono) NO se
-- reescribe: sale de `get_metas_dashboard`, que sigue siendo la única fuente.
-- Acá se agregan solo los números que el widget necesita y el tablero no:
-- lo vendido HOY, los días que faltan y a qué ritmo diario hay que ir.
CREATE OR REPLACE FUNCTION public.get_meta_sala(p_branch_id bigint DEFAULT NULL)
RETURNS TABLE (
    branch_id              bigint,
    sala                   text,
    year_month             text,
    monto_meta             numeric,
    estado                 text,
    venta_acumulada        numeric,
    venta_hoy              numeric,
    pct_cumplimiento       numeric,
    proyeccion             numeric,
    pct_proyectado         numeric,
    bono_tier              text,
    dias_transcurridos     integer,
    dias_mes               integer,
    dias_restantes         integer,
    falta                  numeric,
    ritmo_necesario        numeric,
    umbral_medio           numeric,
    umbral_total           numeric,
    bonificaciones_activas boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_branch bigint;
    v_hoy    date := (now() AT TIME ZONE 'America/El_Salvador')::date;
    v_ym     text := to_char((now() AT TIME ZONE 'America/El_Salvador')::date, 'YYYY-MM');
BEGIN
    -- Sin permiso: cero filas. El widget ya no se pinta (showWidget lo esconde),
    -- esto es el candado del lado del servidor.
    IF NOT auth_has_module_permission('dash_meta_sala', 'can_view') THEN
        RETURN;
    END IF;

    -- Scope BRANCH: siempre su propia sala, el parámetro se ignora.
    IF auth_module_scope('dash_meta_sala') = 'ALL' THEN
        v_branch := COALESCE(p_branch_id, auth_employee_branch_id());
    ELSE
        v_branch := auth_employee_branch_id();
    END IF;

    IF v_branch IS NULL THEN
        RETURN;
    END IF;

    -- Bodega no vende: no tiene meta ni la tendrá.
    IF NOT EXISTS (
        SELECT 1 FROM public.erp_sucursal_map m
        WHERE m.branch_id = v_branch AND NOT m.es_bodega
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH d AS (
        SELECT * FROM public.get_metas_dashboard(v_ym) g WHERE g.branch_id = v_branch
    ),
    h AS (
        SELECT COALESCE(SUM(si.total::numeric), 0) AS neto
        FROM public.sales_invoices si
        WHERE si.branch_id = v_branch
          AND si.fecha = v_hoy
          AND si.estado NOT IN ('NULA', 'DTE INVALIDADO EN MH')
    )
    SELECT
        d.branch_id,
        b.name::text,
        v_ym,
        d.monto_meta,
        d.estado,
        d.venta_acumulada,
        ROUND(h.neto, 2),
        d.pct_cumplimiento,
        d.proyeccion,
        d.pct_proyectado,
        d.bono_tier,
        d.dias_transcurridos,
        d.dias_mes,
        -- HOY todavía cuenta como día por vender
        (d.dias_mes - d.dias_transcurridos + 1)::integer,
        CASE WHEN d.monto_meta IS NOT NULL
             THEN GREATEST(0, ROUND(d.monto_meta - d.venta_acumulada, 2)) END,
        CASE WHEN d.monto_meta IS NOT NULL
              AND (d.dias_mes - d.dias_transcurridos + 1) > 0
             THEN ROUND(GREATEST(0, d.monto_meta - d.venta_acumulada)
                        / (d.dias_mes - d.dias_transcurridos + 1), 2) END,
        c.umbral_bono_medio,
        c.umbral_bono_total,
        c.bonificaciones_activas
    FROM d
    JOIN public.branches b ON b.id = d.branch_id
    CROSS JOIN public.metas_config c;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_meta_sala(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_meta_sala(bigint) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_meta_sala(bigint) IS
    'Metas Fase 3 — una sola sala, mes en curso, para el widget del Inicio. DEFINER porque la sala no tiene permiso de ventas y la venta de HOY vive en sales_invoices. Valida dash_meta_sala.can_view y respeta el scope.';
