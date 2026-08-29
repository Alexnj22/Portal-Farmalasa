-- Quién abrió la caja DE VERDAD, cuando la abre el portal.
--
-- La captura de cada media hora trae lo que la caja sabe —hora, monto, id de
-- apertura, y el nombre de la cuenta que abrió—. Lo que no puede saber es quién
-- pasó el carné, porque del otro lado eso no existe: hoy tres de las seis salas
-- abren con una cuenta compartida.
--
-- Tabla aparte y no una columna de `cortes_caja_aperturas` a propósito: aquélla
-- es el espejo de lo que dice la caja y se reescribe con cada lectura. Ésta es
-- un hecho del portal —alguien apretó un botón con su carné— y no se toca nunca
-- más. Mezclarlas haría que una relectura pudiera pisar la única identidad
-- verificada que existe.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.caja_aperturas_del_portal (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id       integer NOT NULL REFERENCES public.branches(id),
    abierta_por     uuid    NOT NULL REFERENCES public.employees(id),
    erp_empleado_id integer,
    caja_erp        integer,
    monto_apertura  numeric(12,2) NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS caja_aper_portal_branch_idx
    ON public.caja_aperturas_del_portal (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS caja_aper_portal_quien_idx
    ON public.caja_aperturas_del_portal (abierta_por);

ALTER TABLE public.caja_aperturas_del_portal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.caja_aperturas_del_portal;
CREATE POLICY bloqueo_global ON public.caja_aperturas_del_portal
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

DROP POLICY IF EXISTS caja_aper_portal_select ON public.caja_aperturas_del_portal;
CREATE POLICY caja_aper_portal_select ON public.caja_aperturas_del_portal
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('cortes_caja','can_view'))
        AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
             OR branch_id = (SELECT auth_employee_branch_id()))
    );

-- Append-only y escrito sólo por la función: sin policy de escritura.
REVOKE ALL ON public.caja_aperturas_del_portal FROM anon;
GRANT SELECT ON public.caja_aperturas_del_portal TO authenticated;
GRANT ALL    ON public.caja_aperturas_del_portal TO service_role;

COMMENT ON TABLE public.caja_aperturas_del_portal IS
    'Quién pasó el carné para abrir la caja. La caja no guarda esto: en tres salas abre una cuenta compartida.';
