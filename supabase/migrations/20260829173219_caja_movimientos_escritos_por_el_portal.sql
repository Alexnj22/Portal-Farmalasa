-- Los movimientos de caja que escribe el portal, con su respaldo.
--
-- Distinto de `caja_vales_portal`, que es el vale CONSOLIDADO de las salidas de
-- bolsa: acá va lo que entra y sale del CAJÓN y no pasa por ninguna bolsa — el
-- pago de un recibo, un depósito a cuenta, la compra de agua fría. Son cosas
-- que hasta hoy se tecleaban en la otra pantalla y desde el lunes no se puede.
--
-- Existe por dos motivos que no da la caja:
--   1. El RESPALDO. La caja guarda un concepto de 50 caracteres y nada más: ni
--      la boleta, ni la foto, ni quién lo anotó. Acá sí.
--   2. Poder CORREGIR. Anular o editar un movimiento pasa a ser una solicitud,
--      y una solicitud necesita apuntar a algo — a esta fila.
--
-- `erp_movimiento_id` en NULL significa que todavía no entró del otro lado. No
-- se borra la fila si falla: el intento queda, que es lo que permite reintentar
-- sin duplicar.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.caja_movimientos_portal (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id         integer NOT NULL REFERENCES public.branches(id),
    tipo              text    NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA')),
    monto             numeric(12,2) NOT NULL CHECK (monto > 0),
    concepto          text    NOT NULL,
    numero_boleta     text,
    foto_url          text,
    fecha             date    NOT NULL,
    erp_apertura_id   integer,
    erp_movimiento_id integer,
    registrado_por    uuid    NOT NULL REFERENCES public.employees(id),
    registrado_at     timestamptz NOT NULL DEFAULT now(),
    anulado_at        timestamptz,
    anulado_por       uuid REFERENCES public.employees(id),
    anulado_motivo    text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS caja_mov_portal_branch_idx
    ON public.caja_movimientos_portal (branch_id, fecha DESC);
CREATE INDEX IF NOT EXISTS caja_mov_portal_quien_idx
    ON public.caja_movimientos_portal (registrado_por);
CREATE INDEX IF NOT EXISTS caja_mov_portal_anulo_idx
    ON public.caja_movimientos_portal (anulado_por);
CREATE INDEX IF NOT EXISTS caja_mov_portal_erp_idx
    ON public.caja_movimientos_portal (branch_id, erp_movimiento_id);

ALTER TABLE public.caja_movimientos_portal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.caja_movimientos_portal;
CREATE POLICY bloqueo_global ON public.caja_movimientos_portal
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

DROP POLICY IF EXISTS caja_mov_portal_select ON public.caja_movimientos_portal;
CREATE POLICY caja_mov_portal_select ON public.caja_movimientos_portal
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('cortes_caja','can_view'))
        AND ((SELECT auth_module_scope('cortes_caja')) = 'ALL'
             OR branch_id = (SELECT auth_employee_branch_id()))
    );

-- Sin policy de escritura: sólo la función, con service_role. Un movimiento de
-- caja que el navegador pueda escribir directo no tendría autor verificable.
REVOKE ALL ON public.caja_movimientos_portal FROM anon;
GRANT SELECT ON public.caja_movimientos_portal TO authenticated;
GRANT ALL    ON public.caja_movimientos_portal TO service_role;

COMMENT ON TABLE public.caja_movimientos_portal IS
    'Ingresos y salidas del cajón escritos por el portal, con la boleta, la foto y quién los anotó — que es lo que la caja no guarda.';
