SET lock_timeout = '5s';

/* ── LAS CUENTAS POR COBRAR, EN EL PORTAL ──────────────────────────────────
 *
 * Espejo de los créditos del sistema de la caja. Pedido del usuario (2-sep):
 * «haz un cron que traiga las cuentas por cobrar, así amarramos a los clientes
 * con los usuarios y empleados, y podemos avisar cuando una venta ya pasó el
 * plazo».
 *
 * ── Por qué una copia, si la vista los leía en vivo ───────────────────────
 * Leer en vivo contesta «¿cuánto debe HOY?» y nada más. No puede contestar
 * ninguna de las tres que el usuario pide, porque las tres necesitan que el
 * dato esté ACÁ:
 *
 *   · **avisar** — un aviso lo dispara un cron, y un cron no puede depender de
 *     que alguien tenga la pantalla abierta.
 *   · **amarrar** — el origen sólo da el NOMBRE del cliente escrito en la
 *     factura. La ficha y el vendedor salen de cruzar contra `sales_invoices`,
 *     que vive acá.
 *   · **el día que cruzó el plazo** — el origen no lo guarda. Sin una copia,
 *     «se pasó del mes» se recalcula cada vez y no hay forma de saber si ya se
 *     avisó, ni de no avisar dos veces.
 *
 * ── Y la copia NO reemplaza la lectura del origen al COBRAR ───────────────
 * Ésa se queda. El saldo cambia cada vez que alguien cobra en la caja, y abonar
 * contra una copia de hace una hora es cobrarle de más a un cliente. La regla
 * es: **la lista se mira acá, el cobro se decide allá.**
 *
 * ── Medido antes de escribirla (1 y 2-sep) ────────────────────────────────
 * 2,386 créditos en las seis salas; 126 con saldo — $4,646.21 entre 43
 * clientes. 35 pasados del mes de plazo, el más viejo con 462 días.
 */
CREATE TABLE IF NOT EXISTS public.creditos_de_clientes (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id     bigint      NOT NULL REFERENCES public.branches(id),

    -- El id del CRÉDITO. Texto porque allá es la clave de una fila, no un
    -- número con el que se haga aritmética. Y NO es el de la factura: el
    -- formulario del origen los confunde y manda el del crédito en un campo
    -- llamado `id_factura`. Se guardan los dos, siempre.
    credito_erp   text        NOT NULL,
    factura_erp   text,
    numero_doc    text,
    tipo_doc      text,

    fecha         date        NOT NULL,
    -- El nombre TAL COMO se escribió la factura, y no el de la ficha: si mañana
    -- le corrigen la ficha, el crédito tiene que seguir diciendo a nombre de
    -- quién se fió.
    cliente       text        NOT NULL,

    total         numeric(12,2) NOT NULL DEFAULT 0,
    abonado       numeric(12,2) NOT NULL DEFAULT 0,
    saldo         numeric(12,2) NOT NULL DEFAULT 0,
    estado        text,

    /* ── Lo que el origen NO puede decir ───────────────────────────────────
     * La ficha del cliente y quién vendió. Salen de cruzar `factura_erp` contra
     * `sales_invoices`, que ya trae `customer_id` y `cod_vendedor` — verificado
     * el 2-sep: el crédito 1912 → factura 299063 → ficha 15600. */
    customer_id   bigint      REFERENCES public.customers(id),
    vendedor_code text,
    vendedor_id   uuid        REFERENCES public.employees(id),

    /* El día que se vio por primera vez con el plazo cumplido. Lo escribe el
     * sync y NO se recalcula: es lo que hace que el aviso sepa si ya avisó, y
     * lo que deja medir «cuánto tarda en cobrarse un crédito que se pasó». */
    vencio_el     date,
    -- Y el día que se vio pagado. Mismo criterio: una fecha que se observa una
    -- vez, no una resta que se rehace.
    pagado_el     date,

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (branch_id, credito_erp)
);

COMMENT ON TABLE public.creditos_de_clientes IS
    'Espejo de los créditos del sistema de la caja. La verdad del saldo sigue siendo el origen: acá se mira la lista, allá se decide el cobro.';

CREATE INDEX IF NOT EXISTS creditos_clientes_branch_idx
    ON public.creditos_de_clientes (branch_id, fecha DESC);
CREATE INDEX IF NOT EXISTS creditos_clientes_customer_idx
    ON public.creditos_de_clientes (customer_id);
CREATE INDEX IF NOT EXISTS creditos_clientes_vendedor_idx
    ON public.creditos_de_clientes (vendedor_id);
/* Parcial sobre los que DEBEN, que son 126 de 2,386. Es la consulta de la
 * pantalla y la del aviso, y un índice sobre la condición rara es lo que evita
 * que el planificador recorra la tabla entera creyendo que abundan. */
CREATE INDEX IF NOT EXISTS creditos_clientes_con_saldo_idx
    ON public.creditos_de_clientes (fecha) WHERE saldo > 0.004;

ALTER TABLE public.creditos_de_clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY creditos_clientes_select ON public.creditos_de_clientes
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('cuentas_por_cobrar', 'can_view'))
        AND (
            (SELECT auth_module_scope('cuentas_por_cobrar')) = 'ALL'
            OR branch_id = (SELECT auth_employee_branch_id())
        )
    );

/* Sin INSERT ni UPDATE para `authenticated`: la escribe el sync con
 * `service_role`. Una fila escrita desde el navegador diría que alguien debe un
 * dinero que el sistema de la caja nunca registró. */

CREATE POLICY bloqueo_global ON public.creditos_de_clientes
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

GRANT SELECT ON public.creditos_de_clientes TO authenticated;
REVOKE ALL ON public.creditos_de_clientes FROM anon;


/* ── Cuándo se leyó por última vez ─────────────────────────────────────────
 * Una fila. Existe porque `updated_at` de la tabla de arriba SÓLO se mueve
 * cuando algo cambió —así tiene que ser, ver el RPC— y entonces no sirve para
 * contestar «¿esto está fresco?»: una corrida que no encontró ningún cambio es
 * indistinguible de una que no corrió. Y una pantalla que se ve igual de bien
 * estando congelada no avisa de nada. */
CREATE TABLE IF NOT EXISTS public.creditos_sync (
    id         boolean PRIMARY KEY DEFAULT true CHECK (id),
    corrio_el  timestamptz NOT NULL DEFAULT now(),
    filas      integer     NOT NULL DEFAULT 0,
    cambios    integer     NOT NULL DEFAULT 0,
    ok         boolean     NOT NULL DEFAULT true,
    error      text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creditos_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY creditos_sync_select ON public.creditos_sync
    FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('cuentas_por_cobrar', 'can_view')));

GRANT SELECT ON public.creditos_sync TO authenticated;
REVOKE ALL ON public.creditos_sync FROM anon;
