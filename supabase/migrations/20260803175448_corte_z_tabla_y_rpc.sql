SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- CORTE Z (Gran Z) — lo que el ORIGEN declaró, guardado tal cual.
--
-- Decisión del usuario (2026-08-03): la vista muestra el dato del ORIGEN, no el
-- derivado del portal. El Z es un documento que la sucursal emite; lo que vale
-- es lo que dijo, no lo que nosotros calcularíamos. El número del portal queda
-- al lado, como CONTRASTE — que es justo donde apareció lo interesante:
--
--   · Salud 3 (may/jun/jul): el Gran Z se contradice con el propio libro de IVA
--     del origen. El portal coincide con el libro 92 de 92 días.
--   · Salud 1 (jul): el Z y el libro del origen coinciden entre sí y los dos
--     OMITEN una venta que existe, está FINALIZADA y tiene sello de Hacienda
--     ($9.00, 14/07 08:10:17, id interno 328969, dentro del propio rango que el
--     origen declara ese día).
--
-- Por eso se guarda el `ticket` crudo además de los números parseados: el día
-- que haya que defender una cifra, el texto que emitió el origen es la prueba, y
-- un parser nuevo no puede reescribir el pasado.
--
-- El endpoint no es un archivo aparte, es un POST a la misma pantalla:
--   POST reportez.php  process=imprimir_gz&fini=&ffin=&selectSucursal=&id_sucursal_dom=
-- y pide las credenciales de COMPRAS (con las de ventas: "No tiene permiso").
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.corte_z (
    id            bigserial PRIMARY KEY,
    branch_id     bigint NOT NULL REFERENCES public.branches(id),
    -- Primer día del mes. El Z es mensual; un rango arbitrario no se guarda.
    periodo       date NOT NULL,
    fecha_inicio  date NOT NULL,
    fecha_fin     date NOT NULL,

    -- Las tres secciones del ticket, en el orden en que salen impresas.
    tiquete_total  numeric(14,2) NOT NULL DEFAULT 0,
    factura_total  numeric(14,2) NOT NULL DEFAULT 0,
    ccf_total      numeric(14,2) NOT NULL DEFAULT 0,
    total_general  numeric(14,2) NOT NULL,

    -- El resto de cada sección (exentas, no sujetas, retención, del/al) y el
    -- encabezado. Va en jsonb y no en 20 columnas porque en toda la muestra
    -- disponible son cero: escribirlas como columnas sería fingir que se
    -- verificaron. Lo que se presenta son los cuatro números de arriba.
    detalle       jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- El texto tal cual lo emitió el origen. Es la prueba.
    ticket        text NOT NULL,

    obtenido_at   timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (branch_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_corte_z_branch   ON public.corte_z(branch_id);
CREATE INDEX IF NOT EXISTS idx_corte_z_periodo  ON public.corte_z(periodo);

ALTER TABLE public.corte_z ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS corte_z_select ON public.corte_z;
CREATE POLICY corte_z_select ON public.corte_z
    FOR SELECT TO authenticated
    USING (
      (SELECT auth_has_module_permission('corte_z', 'can_view'))
      AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
           OR branch_id = (SELECT auth_employee_branch_id()))
    );

-- Sin policies de escritura: lo llena el sync con service_role. Un Corte Z no se
-- edita a mano — si el número está mal, está mal en el origen y hay que
-- arreglarlo ahí y volver a traerlo.

COMMENT ON TABLE public.corte_z IS
  'Gran Z mensual por sucursal, tal como lo emitió el sistema de origen. `ticket` es el texto crudo y es la prueba; los numéricos son su parseo. El contraste contra el libro del portal lo hace get_cortes_z, no esta tabla.';

-- ── El RPC devuelve el Z Y el número del portal, en la misma fila ────────────
--
-- Los dos lados juntos y no en dos consultas: el cruce ES el dato que se quiere
-- mirar, y traerlos por separado deja al frontend armando el join —que es
-- exactamente donde se cuelan las comparaciones contra la columna equivocada.
--
-- OJO con el rótulo del origen: la línea dice «VENTAS GRAVADAS» pero trae el
-- TOTAL CON IVA. Por eso el contraste va contra `sum(total)` y NO contra la
-- columna «gravadas» del libro de contribuyentes, que es la base sin IVA.
DROP FUNCTION IF EXISTS public.get_cortes_z(date, date, bigint);
CREATE FUNCTION public.get_cortes_z(
    p_desde date, p_hasta date, p_branch_id bigint DEFAULT NULL)
RETURNS TABLE(
    branch_id bigint, sucursal text, periodo date,
    fecha_inicio date, fecha_fin date,
    tiquete_total numeric, factura_total numeric, ccf_total numeric, total_general numeric,
    portal_factura numeric, portal_ccf numeric, portal_total numeric,
    dif_factura numeric, dif_ccf numeric, dif_total numeric,
    detalle jsonb, ticket text, obtenido_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $fn$
    WITH portal AS (
        SELECT si.branch_id,
               date_trunc('month', si.fecha)::date AS periodo,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'COF'), 0) AS factura,
               coalesce(sum(si.total) FILTER (WHERE si.tipo_documento = 'CCF'), 0) AS ccf,
               coalesce(sum(si.total), 0) AS total
        FROM public.sales_invoices si
        WHERE si.estado = 'FINALIZADA'
          AND length(si.recibido_mh) = 40
          AND si.fecha >= date_trunc('month', p_desde)::date
          AND si.fecha <= (date_trunc('month', p_hasta) + interval '1 month - 1 day')::date
        GROUP BY 1, 2
    )
    SELECT z.branch_id, b.name, z.periodo, z.fecha_inicio, z.fecha_fin,
           z.tiquete_total, z.factura_total, z.ccf_total, z.total_general,
           p.factura, p.ccf, p.total,
           round(coalesce(p.factura, 0) - z.factura_total, 2),
           round(coalesce(p.ccf, 0)     - z.ccf_total, 2),
           round(coalesce(p.total, 0)   - z.total_general, 2),
           z.detalle, z.ticket, z.obtenido_at
    FROM public.corte_z z
    JOIN public.branches b ON b.id = z.branch_id
    LEFT JOIN portal p ON p.branch_id = z.branch_id AND p.periodo = z.periodo
    WHERE (SELECT auth_has_module_permission('corte_z', 'can_view'))
      AND ((SELECT auth_module_scope('corte_z')) = 'ALL'
           OR z.branch_id = (SELECT auth_employee_branch_id()))
      AND z.periodo >= date_trunc('month', p_desde)::date
      AND z.periodo <= date_trunc('month', p_hasta)::date
      AND (p_branch_id IS NULL OR z.branch_id = p_branch_id)
    ORDER BY z.periodo DESC, b.name;
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_cortes_z(date, date, bigint) TO authenticated, service_role;
