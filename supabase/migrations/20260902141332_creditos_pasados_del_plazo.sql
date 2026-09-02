SET lock_timeout = '5s';

/* ── Los créditos que se pasaron del mes ───────────────────────────────────
 *
 * La lista que alimenta el aviso. Existe como función y no como consulta
 * escrita en la edge function por lo de siempre: el criterio de «pasado del
 * plazo» tiene que estar en UN solo sitio, porque el día que el plazo cambie,
 * dos copias dan dos respuestas — es lo que costó `turno_del_dia`.
 *
 * `plpgsql` y no `sql`: una `LANGUAGE sql` con `SET search_path` nace con plan
 * genérico y nunca ve el valor de sus argumentos (regla 4 de CLAUDE.md).
 *
 * ── A quién nombra ────────────────────────────────────────────────────────
 * Al cliente, a la sala y a QUIÉN VENDIÓ. Lo tercero es lo que el sistema de
 * origen no puede decir y es lo que hace accionable el aviso: quien fió es
 * quien sabe a quién llamar.
 */
CREATE OR REPLACE FUNCTION public.creditos_pasados_del_plazo(p_dias integer DEFAULT 30)
RETURNS TABLE (
    id            bigint,
    branch_id     bigint,
    sala          text,
    credito_erp   text,
    cliente       text,
    saldo         numeric,
    fecha         date,
    dias          integer,
    customer_id   bigint,
    vendedor_id   uuid,
    vendedor      text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode TO 'force_custom_plan'
AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.branch_id, b.name, c.credito_erp, c.cliente, c.saldo, c.fecha,
           (current_date - c.fecha)::integer,
           c.customer_id, c.vendedor_id, e.name
    FROM public.creditos_de_clientes c
    JOIN public.branches  b ON b.id = c.branch_id
    LEFT JOIN public.employees e ON e.id = c.vendedor_id
    WHERE c.saldo > 0.004
      AND current_date - c.fecha > p_dias
    ORDER BY c.fecha;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creditos_pasados_del_plazo(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.creditos_pasados_del_plazo(integer) TO authenticated, service_role;
