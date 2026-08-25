SET lock_timeout = '5s';

-- ── La tarjeta de Confirmar tenía que pedir seis veces lo que ya es UNA ─────
--
-- `explicar_meta_propuesta` resuelve UNA sala, y el panel «De dónde sale» lo
-- pide al abrirlo — razonable cuando era sólo ese panel. Pero el contexto de la
-- tarjeta (el promedio de los meses base y en cuánto viene cerrando el mes
-- anterior) sale HOY del histórico, que sólo tiene meses CERRADOS: por eso la
-- tarjeta de septiembre decía «Cerró jul» mientras la fórmula ya se calculaba
-- contra agosto proyectado. Dos números distintos en la misma tarjeta, sin que
-- ninguno estuviera mal por su cuenta.
--
-- `metas_calculo_propuesta` ya devuelve TODAS las salas de un mes en una sola
-- pasada, así que la versión en lote no cuesta más que la individual y deja al
-- contexto y al panel leyendo el MISMO objeto — que es la única forma de que no
-- puedan contradecirse.
--
-- `tramo_ultimo` viene del servidor y no se deriva en el navegador: los
-- umbrales viven en `metas_config` y el color de ese porcentaje tiene que ser
-- el mismo que usa el bono. Derivarlo acá era la tercera copia de la regla.

CREATE OR REPLACE FUNCTION public.metas_tramo_de_pct(p_pct numeric)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_pct IS NULL                     THEN NULL
    WHEN p_pct >= c.umbral_bono_total      THEN 'completo'
    WHEN p_pct >= c.umbral_bono_medio      THEN 'medio'
    ELSE 'nada'
  END
  FROM public.metas_config c
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.metas_tramo_de_pct(numeric) IS
  'El tramo (completo/medio/nada) de un porcentaje de cumplimiento, con los umbrales de metas_config. Existe para que el color de un pct no se derive a mano en el navegador.';

REVOKE EXECUTE ON FUNCTION public.metas_tramo_de_pct(numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.metas_tramo_de_pct(numeric) TO service_role;


-- Una sala (el panel, cuando se abre suelto).
CREATE OR REPLACE FUNCTION public.explicar_meta_propuesta(p_branch_id bigint, p_year_month text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

  SELECT json_build_object(
    'branch_id',         c.branch_id,
    'meses_base',        c.meses,
    'suma_venta',        c.suma_venta,
    'suma_dias',         c.suma_dias,
    'ritmo_dia',         c.ritmo_dia,
    'dias_mes',          c.dias_mes,
    'sub_ritmo',         c.sub_ritmo,
    'ym_ultimo',         c.ym_ultimo,
    'meta_ultimo',       c.meta_ultimo,
    'pct_ultimo',        c.pct_ultimo,
    'tramo_ultimo',      public.metas_tramo_de_pct(c.pct_ultimo),
    'ultimo_proyectado', c.ultimo_proyectado,
    'factor',            c.factor,
    'tramos',            (SELECT json_agg(json_build_object('desde', t.desde_pct, 'factor', t.factor)
                                    ORDER BY t.desde_pct DESC)
                            FROM public.metas_factor_cumplimiento t),
    'recalculada',       c.propuesta
  ) INTO r
  FROM public.metas_calculo_propuesta(p_year_month) c
  WHERE c.branch_id = p_branch_id;

  RETURN r;
END;
$function$;


-- Todas las salas de un mes, con la MISMA forma: cada elemento entra tal cual
-- donde antes entraba el de arriba.
CREATE OR REPLACE FUNCTION public.explicar_metas_propuestas(p_year_month text)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE r json;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_view') THEN RETURN NULL; END IF;

  SELECT coalesce(json_agg(json_build_object(
    'branch_id',         c.branch_id,
    'meses_base',        c.meses,
    'suma_venta',        c.suma_venta,
    'suma_dias',         c.suma_dias,
    'ritmo_dia',         c.ritmo_dia,
    'dias_mes',          c.dias_mes,
    'sub_ritmo',         c.sub_ritmo,
    'ym_ultimo',         c.ym_ultimo,
    'meta_ultimo',       c.meta_ultimo,
    'pct_ultimo',        c.pct_ultimo,
    'tramo_ultimo',      public.metas_tramo_de_pct(c.pct_ultimo),
    'ultimo_proyectado', c.ultimo_proyectado,
    'factor',            c.factor,
    'tramos',            (SELECT json_agg(json_build_object('desde', t.desde_pct, 'factor', t.factor)
                                    ORDER BY t.desde_pct DESC)
                            FROM public.metas_factor_cumplimiento t),
    'recalculada',       c.propuesta
  ) ORDER BY c.branch_id), '[]'::json) INTO r
  FROM public.metas_calculo_propuesta(p_year_month) c;

  RETURN r;
END;
$function$;

COMMENT ON FUNCTION public.explicar_metas_propuestas(text) IS
  'El cálculo de la propuesta de TODAS las salas de un mes, con la misma forma que explicar_meta_propuesta. Lo usa la tarjeta de Confirmar para que su contexto y el panel «De dónde sale» lean el mismo objeto.';

REVOKE EXECUTE ON FUNCTION public.explicar_metas_propuestas(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.explicar_metas_propuestas(text) TO authenticated, service_role;
