SET lock_timeout = '5s';

/* ── Lo que ESTE cliente debe, en esta sala ────────────────────────────────
 *
 * Para poder repartir un pago entre varios créditos hay que poder listarlos, y
 * la pregunta es «los del mismo cliente», no «los del mismo nombre».
 *
 * Se busca por `customer_id`, que es la FICHA, y sólo se cae al nombre cuando
 * el crédito no la tiene — hoy uno de 2,387. El nombre no sirve como clave: sale
 * de cómo se escribió la factura, y medido sobre 68 duplicados reales del
 * portal, el 96% son personas genuinamente distintas con nombres parecidos
 * (`VAQUEZ`/`VASQUEZ`). Repartir un pago por nombre le abonaría a otro.
 *
 * INVOKER: el RLS de la tabla decide qué salas se ven. Un DEFINER acá dejaría
 * leer la cartera de una sala ajena sabiendo un id.
 */
CREATE OR REPLACE FUNCTION public.creditos_del_cliente(p_credito_id bigint)
RETURNS TABLE (
    id            bigint,
    branch_id     bigint,
    credito       text,
    documento     text,
    fecha         date,
    total         numeric,
    abonado       numeric,
    saldo         numeric,
    dias          integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
    WITH base AS (
        SELECT c.branch_id, c.customer_id, c.cliente
        FROM public.creditos_de_clientes c
        WHERE c.id = p_credito_id
    )
    SELECT c.id, c.branch_id, c.credito_erp, c.numero_doc, c.fecha,
           c.total, c.abonado, c.saldo, (current_date - c.fecha)::integer
    FROM public.creditos_de_clientes c, base b
    WHERE c.branch_id = b.branch_id
      AND c.saldo > 0.004
      AND (
        CASE WHEN b.customer_id IS NOT NULL
             THEN c.customer_id = b.customer_id
             ELSE c.customer_id IS NULL AND c.cliente = b.cliente
        END
      )
    -- Los más viejos primero: es el orden en que se reparte un pago, porque el
    -- que lleva más tiempo es el que hay que cerrar.
    ORDER BY c.fecha, c.id;
$$;

REVOKE EXECUTE ON FUNCTION public.creditos_del_cliente(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.creditos_del_cliente(bigint) TO authenticated, service_role;
