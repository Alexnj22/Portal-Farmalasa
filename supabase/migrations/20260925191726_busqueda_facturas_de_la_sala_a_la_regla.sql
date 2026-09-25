-- El buscador de facturas del widget de anulación, con la regla del portal
-- (docs/PLAN-BUSQUEDA-UNIFICADA-2026-09-25.md).
--
-- Antes era un `.or()` de `ilike` por palabra armado en el navegador: el texto
-- se mandaba SIN tildes contra una columna CON tildes, así que «jose» no
-- encontraba «JOSÉ» (1,089 de 61,781 facturas de 90 días tienen tilde o ñ en
-- el cliente). Y el vendedor se resolvía a códigos en el navegador.
--
-- Ahora el texto de cada factura es cliente + correlativo + total + el NOMBRE
-- del vendedor, y la regla decide sobre las facturas de la sala en el rango.
-- INVOKER: el RLS de `sales_invoices` sigue decidiendo lo mismo que antes.
-- Si nada coincide tal cual, las facturas de clientes PARECIDOS.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.buscar_facturas_sala_ids(
  p_branch_id integer, p_desde date, p_hasta date, p_q text, p_limite integer DEFAULT 50)
RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan'
AS $$
DECLARE
  v_tok  jsonb  := public.busqueda_palabras(p_q);
  v_pats text[] := public.busqueda_patrones_legados(public.busqueda_palabras(p_q));
  v_lim  int    := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_ids  json;
BEGIN
  IF v_pats IS NULL THEN
    RETURN json_build_object('ids', '[]'::json, 'aproximado', false);
  END IF;

  SELECT json_agg(x.id ORDER BY x.fecha DESC, x.correlativo DESC) INTO v_ids
  FROM (
    SELECT f.id, f.fecha, f.correlativo
    FROM (
      SELECT si.id, si.fecha, si.correlativo,
             coalesce(si.cliente, '') || ' ' || coalesce(si.correlativo, '') || ' ' ||
             coalesce(si.total::text, '') || ' ' || coalesce(e.name, '') AS texto
      FROM public.sales_invoices si
      LEFT JOIN public.employees e ON e.code = si.cod_vendedor
      WHERE si.branch_id = p_branch_id
        AND si.fecha BETWEEN p_desde AND p_hasta
    ) f
    WHERE public.norm_search(f.texto) LIKE ALL (v_pats)
      AND public.busqueda_coincide(v_tok, f.texto)
    ORDER BY f.fecha DESC, f.correlativo DESC
    LIMIT v_lim
  ) x;

  IF v_ids IS NOT NULL THEN
    RETURN json_build_object('ids', v_ids, 'aproximado', false);
  END IF;

  -- Nada tal cual: clientes PARECIDOS. Los trigramas eligen a los 100 más
  -- cercanos del rango; el parecido exacto —el mismo de JS— decide.
  SELECT json_agg(x.id ORDER BY x.s DESC, x.fecha DESC) INTO v_ids
  FROM (
    SELECT c.id, c.fecha,
           public.busqueda_parecido(v_tok, ARRAY[public.norm_busqueda(c.cliente)],
                                    ARRAY[public.compactar_busqueda(c.cliente)]) AS s
    FROM (
      SELECT si.id, si.fecha, si.cliente
      FROM public.sales_invoices si
      WHERE si.branch_id = p_branch_id
        AND si.fecha BETWEEN p_desde AND p_hasta
        AND public.word_similarity(public.norm_busqueda(p_q), lower(public.f_unaccent(coalesce(si.cliente, '')))) >= 0.3
      ORDER BY public.word_similarity(public.norm_busqueda(p_q), lower(public.f_unaccent(coalesce(si.cliente, '')))) DESC
      LIMIT 100
    ) c
  ) x
  WHERE x.s >= 0.75;

  RETURN json_build_object('ids', coalesce(v_ids, '[]'::json), 'aproximado', v_ids IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_facturas_sala_ids(integer, date, date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_facturas_sala_ids(integer, date, date, text, integer) TO authenticated, service_role;
