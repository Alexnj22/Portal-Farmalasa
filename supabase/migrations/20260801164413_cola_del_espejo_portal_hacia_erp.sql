SET lock_timeout = '5s';

-- ══════════════════════════════════════════════════════════════════════════
-- Fase 2: la cola del portal HACIA el ERP.
--
-- Hasta acá el espejo era de una sola dirección (ERP -> portal) y una edición
-- hecha en el portal quedaba protegida pero congelada: no se perdía, pero
-- tampoco llegaba nunca al ERP. Estas dos funciones son la cola que falta.
--
-- La cola es `customers_changelog` con `erp_synced_at IS NULL`, que es la misma
-- marca que usa `aplicar_espejo_erp` para saber qué proteger. Cuando esta cola
-- empuja y marca, la protección se levanta sola y el ERP vuelve a mandar.
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cola_espejo_portal_erp(p_limite integer DEFAULT NULL)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
WITH bloqueados AS (
    -- Si CUALQUIER entrada de este campo perdió una carrera contra el ERP, el
    -- campo entero queda viciado: el ERP ya se movió más allá, y las entradas
    -- que quedaron sin marcar son eslabones de una cadena superada. Empujar el
    -- último no-conflictivo mandaría al ERP un valor que la persona ya había
    -- reemplazado — pasó con el cliente 16164, cuya entrada 9 ('7538-5899')
    -- quedó limpia mientras la 10 (vaciarlo) perdió la carrera.
    SELECT DISTINCT cl.customer_id, cl.campo
    FROM public.customers_changelog cl
    JOIN public.espejo_conflictos k ON k.changelog_id = cl.id
), pend AS (
    SELECT cl.id, cl.customer_id, cl.campo, cl.valor_nuevo, cl.changed_at
    FROM public.customers_changelog cl
    WHERE cl.erp_synced_at IS NULL
), listos AS (
    SELECT p.* FROM pend p
    JOIN public.customers c ON c.id = p.customer_id
    WHERE c.erp_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bloqueados b
                      WHERE b.customer_id = p.customer_id AND b.campo = p.campo)
), ultimo AS (
    SELECT DISTINCT ON (customer_id, campo) customer_id, campo, valor_nuevo
    FROM listos ORDER BY customer_id, campo, changed_at DESC, id DESC
), agrupado AS (
    SELECT u.customer_id, u.campo, u.valor_nuevo,
           (SELECT array_agg(l.id ORDER BY l.id) FROM listos l
            WHERE l.customer_id = u.customer_id AND l.campo = u.campo) AS changelog_ids
    FROM ultimo u
), por_cliente AS (
    SELECT a.customer_id, c.erp_id, c.name,
           json_agg(json_build_object(
               'campo', a.campo, 'valor', a.valor_nuevo,
               'changelog_ids', a.changelog_ids) ORDER BY a.campo) AS cambios
    FROM agrupado a JOIN public.customers c ON c.id = a.customer_id
    GROUP BY a.customer_id, c.erp_id, c.name
    ORDER BY a.customer_id
    LIMIT p_limite
)
SELECT json_build_object(
  'cola', coalesce((SELECT json_agg(to_json(t)) FROM por_cliente t), '[]'::json),
  -- Nada desaparece en silencio: lo que no se puede empujar se dice y por qué.
  'excluidos', coalesce((
     SELECT json_agg(to_json(x)) FROM (
        SELECT p.customer_id, c.name, p.campo, count(*) AS entradas,
               CASE WHEN c.erp_id IS NULL
                    THEN 'sin erp_id: la ficha del portal no está emparejada con el ERP'
                    ELSE 'el ERP ya se movió más allá de este campo (espejo_conflictos)'
               END AS motivo
        FROM pend p
        JOIN public.customers c ON c.id = p.customer_id
        WHERE c.erp_id IS NULL
           OR EXISTS (SELECT 1 FROM bloqueados b
                      WHERE b.customer_id = p.customer_id AND b.campo = p.campo)
        GROUP BY p.customer_id, c.name, p.campo, c.erp_id
     ) x), '[]'::json)
);
$$;

REVOKE EXECUTE ON FUNCTION public.cola_espejo_portal_erp(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cola_espejo_portal_erp(integer) TO authenticated, service_role;


-- ── Saldar lo empujado ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_empujado_al_erp(p_ids bigint[])
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Solo las que siguen pendientes: marcar dos veces no reescribe la fecha del
  -- primer empuje, que es el dato que dice cuándo llegó al ERP de verdad.
  UPDATE public.customers_changelog
     SET erp_synced_at = now()
   WHERE id = ANY(p_ids) AND erp_synced_at IS NULL;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN json_build_object('marcadas', v_n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marcar_empujado_al_erp(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_empujado_al_erp(bigint[]) TO authenticated, service_role;
