SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El aviso: qué parte de lo que se está mirando no es venta de productos
-- ════════════════════════════════════════════════════════════════════════════
-- Las pantallas de hora y de día siguen mostrando la venta ENTERA —son
-- operativas y fiscales: la factura existió, entró plata, y el corte de caja
-- tiene que cuadrar contra ella—. Lo que faltaba era decir que una parte de ese
-- número no es venta de productos, porque si no, un cobro de $428 a las 10:17
-- inventa una hora pico que nadie trabajó y un día bueno que no lo fue.
--
-- Un solo RPC sirve a las cuatro pantallas: devuelve el total, el detalle, y los
-- dos cortes —por día y por hora— ya agregados. Se resuelve del lado del
-- servidor y no en el navegador porque el permiso también se decide acá: quien
-- no lo tiene no recibe los montos, en vez de recibirlos y que la pantalla los
-- esconda.
CREATE OR REPLACE FUNCTION public.get_ventas_sin_producto(
    p_fini date, p_ffin date, p_branch_id bigint DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_branch bigint;
    v_todas  boolean := false;
    r json;
BEGIN
    -- Sin el permiso no se devuelve NULL «vacío» sino NULL a secas, y la
    -- pantalla no pinta nada. Un dependiente no ve este aviso (decisión del
    -- usuario 2026-08-20): para él la venta del día es la venta del día.
    IF NOT auth_has_module_permission('ventas_no_producto', 'can_view') THEN
        RETURN NULL;
    END IF;

    IF auth_module_scope('ventas') = 'ALL' THEN
        v_branch := p_branch_id;
        v_todas  := p_branch_id IS NULL;
    ELSE
        v_branch := auth_employee_branch_id();
        IF v_branch IS NULL THEN RETURN NULL; END IF;
    END IF;

    SELECT json_build_object(
        'total',    coalesce(sum(v.total::numeric), 0),
        'facturas', count(*)::int,
        'detalle',  coalesce(json_agg(json_build_object(
                        'invoice_id',  v.invoice_id,
                        'fecha',       v.fecha,
                        'hora',        to_char(v.hora, 'HH24:MI'),
                        'branch_id',   v.branch_id,
                        'cliente',     v.cliente,
                        'correlativo', v.correlativo,
                        'total',       v.total,
                        'motivo',      v.motivo)
                        ORDER BY v.fecha DESC, v.hora DESC), '[]'::json),
        -- Los dos cortes que piden las pantallas: la barra de un día y la
        -- columna de una hora. Se mandan como objeto —clave → monto— para que
        -- la pantalla busque por la misma clave con la que dibuja, sin recorrer
        -- una lista por cada barra.
        'por_dia',  coalesce((SELECT json_object_agg(x.f, x.m) FROM (
                        SELECT v2.fecha::text AS f, sum(v2.total::numeric) AS m
                        FROM public.ventas_sin_producto v2
                        WHERE v2.fecha BETWEEN p_fini AND p_ffin
                          AND (v_todas OR v2.branch_id = v_branch)
                        GROUP BY v2.fecha) x), '{}'::json),
        'por_hora', coalesce((SELECT json_object_agg(x.h, x.m) FROM (
                        SELECT EXTRACT(hour FROM v3.hora)::int::text AS h,
                               sum(v3.total::numeric) AS m
                        FROM public.ventas_sin_producto v3
                        WHERE v3.fecha BETWEEN p_fini AND p_ffin
                          AND (v_todas OR v3.branch_id = v_branch)
                        GROUP BY EXTRACT(hour FROM v3.hora)) x), '{}'::json)
    ) INTO r
    FROM public.ventas_sin_producto v
    WHERE v.fecha BETWEEN p_fini AND p_ffin
      AND (v_todas OR v.branch_id = v_branch);

    RETURN r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_ventas_sin_producto(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_ventas_sin_producto(date, date, bigint) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- El permiso del aviso
-- ════════════════════════════════════════════════════════════════════════════
-- «Para los dependientes en ninguna pantalla; para los que tengan permisos, en
-- todas» (decisión del usuario, 2026-08-20). Se copia el reparto que ya tiene
-- `ventas_ver_cards` —que es exactamente «quién puede ver montos de venta»— y
-- se le agregan jefatura y subjefatura de sala: son quienes leen el número
-- diario de su propia sala y quienes más se confunden si está distorsionado.
--
-- Encendido para: Administrador, Gerente General, Jefe/a de Talento Humano,
-- Supervisor/a de Ventas, QA, Jefe/a de Sala, Subjefe/a de Sala.
-- Apagado para: Dependiente de Farmacia, Regente de Enfermeria, y cualquier
-- rol que no esté en la lista (la fila se crea en `false`, no se omite: un
-- permiso ausente y uno negado se leen distinto en la pantalla de Permisos).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, scope)
SELECT r.id, 'ventas_no_producto',
       r.name IN ('Administrador', 'Gerente General', 'Jefe/a de Talento Humano',
                  'Supervisor/a de Ventas', 'QA / Testing (CI)',
                  'Jefe/a de Sala', 'Subjefe/a de Sala'),
       false, 'ALL'
FROM public.roles r
WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
              WHERE rp.role_id = r.id AND rp.module_key = 'ventas')
ON CONFLICT (role_id, module_key) DO NOTHING;
