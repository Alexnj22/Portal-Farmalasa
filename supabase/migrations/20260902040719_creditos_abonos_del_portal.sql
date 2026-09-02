SET lock_timeout = '5s';

/* ── QUIÉN COBRÓ UN ABONO A CRÉDITO, Y A QUÉ HORA ──────────────────────────
 *
 * El sistema de la caja NO lo guarda: allá el abono queda a nombre del usuario
 * de la caja, que es el mismo para toda la sala —«MI CAJA LA SALUD 5» en tres
 * de las seis—. La pregunta «¿quién recibió ese dinero?» no tiene respuesta
 * hoy, y es dinero que entra al cajón.
 *
 * Esta tabla es el ESPEJO del portal, no la fuente: el saldo y el crédito viven
 * en el sistema de origen y se leen de ahí. Acá queda lo que él no puede decir
 * —la persona, la hora, con qué saldo estaba antes y con cuál quedó—, y eso es
 * lo que se audita después.
 *
 * ── Se guarda el saldo de los DOS lados, y no es redundante ───────────────
 * `saldo_antes` es el que el portal releyó del origen inmediatamente antes de
 * abonar; `saldo_despues` es la resta. Si mañana el origen dice otra cosa, la
 * diferencia es el rastro de que alguien abonó por otro camino en el medio —
 * que es justamente lo que no se puede ver sin esto.
 *
 * ── Medido antes de escribirla (1-sep) ────────────────────────────────────
 * 126 créditos con saldo, $4,646.21, 43 clientes. **35 pasados del mes de
 * plazo** ($443.70), el más viejo con 462 días. Ninguna pantalla los lista.
 */
CREATE TABLE IF NOT EXISTS public.creditos_abonos_portal (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id      integer     NOT NULL REFERENCES public.branches(id),

    -- El id del CRÉDITO en el sistema de origen. Es texto porque allá es la
    -- clave de una fila y no un número con el que se haga aritmética.
    credito_erp    text        NOT NULL,
    -- Y el de la FACTURA, que es OTRO número. Se guardan los dos porque el
    -- formulario del origen los confunde —manda el del crédito en un campo
    -- llamado `id_factura`— y sin los dos no se puede volver a atar nada.
    factura_erp    text,

    -- Copiado tal como estaba al cobrar: si mañana le corrigen el nombre a la
    -- ficha, el registro de quién pagó sigue siendo legible.
    cliente        text        NOT NULL,

    monto          numeric(12,2) NOT NULL CHECK (monto > 0),
    forma          text        NOT NULL,
    documento      text,

    saldo_antes    numeric(12,2),
    saldo_despues  numeric(12,2),

    abonado_por    uuid        NOT NULL REFERENCES public.employees(id),
    erp_abono_id   text,

    anulado_at     timestamptz,
    anulado_por    uuid REFERENCES public.employees(id),

    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.creditos_abonos_portal IS
    'Quién cobró cada abono a crédito y a qué hora. El sistema de origen sólo guarda el usuario de la caja, que es el mismo para toda la sala.';

CREATE INDEX IF NOT EXISTS creditos_abonos_branch_idx
    ON public.creditos_abonos_portal (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creditos_abonos_credito_idx
    ON public.creditos_abonos_portal (credito_erp);
CREATE INDEX IF NOT EXISTS creditos_abonos_quien_idx
    ON public.creditos_abonos_portal (abonado_por);

ALTER TABLE public.creditos_abonos_portal ENABLE ROW LEVEL SECURITY;

-- Se ve con la caja y con su alcance: un abono es dinero de una sala.
CREATE POLICY creditos_abonos_select ON public.creditos_abonos_portal
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('caja_vales', 'can_view'))
        AND (
            (SELECT auth_module_scope('caja_vales')) = 'ALL'
            OR branch_id = (SELECT auth_employee_branch_id())
        )
    );

/* Sin INSERT para `authenticated`: la escribe la edge function con
 * `service_role`, y sólo DESPUÉS de que el abono entró de verdad al sistema de
 * la caja. Una fila que se pudiera escribir desde el navegador diría que
 * alguien cobró un dinero que nunca se movió. */

CREATE POLICY bloqueo_global ON public.creditos_abonos_portal
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

GRANT SELECT ON public.creditos_abonos_portal TO authenticated;
REVOKE ALL ON public.creditos_abonos_portal FROM anon;
