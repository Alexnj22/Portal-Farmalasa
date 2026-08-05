SET lock_timeout = '5s';

-- El MIN/MAX manual de Bodega se guarda como DELTA sobre la Σ de sucursales
-- (`effective = Σ + delta`, modelo aditivo de la Fase 1 de la auditoría
-- 2026-07-17). El recálculo reescribe la Σ y deja el delta donde está — que es
-- lo correcto: «Bodega guarda 1 más que las salas» sigue significando lo mismo
-- cuando la Σ cambia.
--
-- El problema es que las restricciones vigilan la BASE y nadie vigila el
-- EFECTIVO: `chk_min_lt_max` mira min_units/max_units, y de manual_* solo se
-- exige `manual_max >= manual_min`. Al bajar la Σ debajo del delta, el par
-- efectivo cae en una combinación que la propia regla prohíbe.
--
-- Medido el 2026-08-05: 48 filas de Bodega con manual (todas manual_max),
-- **3 con el efectivo inválido**, las tres de la misma forma —base 0·1 más un
-- delta de +1 da 0·2, «con MIN 0 el MAX solo puede ser 0 o 1»—. Y dos de las
-- tres nacieron ese mismo día, a las 16:14:55 y 16:16:57 UTC: los instantes
-- exactos en que se publicaron La Popular y Salud 5. La Σ bajó a 0·1 y el +1
-- se quedó donde estaba. Fuera de Bodega no hay un solo manual, así que la
-- escalera es una identidad en las 6 sucursales — simulada sobre las 18,978
-- filas antes de aplicar: cambian 3, ninguna fuera de Bodega, 0 inválidas
-- después.
--
-- Se resuelve aplicando al par EFECTIVO la misma escalera que ya se aplica al
-- publicado y al borrador (`publish_stock_params`,
-- `sync_bodega_draft_from_branch_stmt`): si el MAX pasa de 1, el MIN sube a 1;
-- si el MIN llegó a 1, el MAX sube a MIN+1. Los 3 casos quedan en 1·2, que
-- conserva la intención de quien escribió «MAX 2» en vez de descartarle el
-- delta.
--
-- `minmax_effective` NO se toca: la usan otras cosas y su contrato —sumar dos
-- números— sigue siendo correcto. Lo que faltaba era una función que vea el
-- PAR, porque la escalera no se puede decidir columna por columna.

CREATE OR REPLACE FUNCTION public.minmax_eff_min(
  p_base_min integer, p_base_max integer,
  p_manual_min integer, p_manual_max integer)
 RETURNS integer LANGUAGE sql IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    COALESCE(p_base_min, 0) + COALESCE(p_manual_min, 0),
    CASE WHEN COALESCE(p_base_max, 0) + COALESCE(p_manual_max, 0) > 1 THEN 1 ELSE 0 END
  )
$function$;

CREATE OR REPLACE FUNCTION public.minmax_eff_max(
  p_base_min integer, p_base_max integer,
  p_manual_min integer, p_manual_max integer)
 RETURNS integer LANGUAGE sql IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.minmax_eff_min(p_base_min, p_base_max, p_manual_min, p_manual_max) >= 1
      THEN GREATEST(
             COALESCE(p_base_max, 0) + COALESCE(p_manual_max, 0),
             public.minmax_eff_min(p_base_min, p_base_max, p_manual_min, p_manual_max) + 1)
    ELSE COALESCE(p_base_max, 0) + COALESCE(p_manual_max, 0)
  END
$function$;

REVOKE EXECUTE ON FUNCTION public.minmax_eff_min(integer, integer, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.minmax_eff_max(integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.minmax_eff_min(integer, integer, integer, integer) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.minmax_eff_max(integer, integer, integer, integer) TO authenticated, service_role;

-- ── Los tres consumidores ───────────────────────────────────────────────────
-- Se reescriben desde `pg_get_functiondef`, no transcribiendo 42 KB de cuerpo a
-- mano: así lo único que cambia son las 11 llamadas y no hay margen para un
-- typo en el resto. `replace()` no falla cuando la aguja no está —devuelve el
-- texto igual— así que cada función se verifica exigiendo que NO quede ni una
-- `minmax_effective(` adentro. Si el cuerpo cambió y una aguja dejó de existir,
-- esto revienta en vez de aplicar a medias.
DO $mig$
DECLARE
  d text;
  quedan int;
BEGIN
  -- get_stock_analysis (4 llamadas: alias psp y psp3)
  d := pg_get_functiondef('public.get_stock_analysis'::regproc);
  d := replace(d,
    'minmax_effective(COALESCE(psp.min_units, psp.draft_min, 0), psp.manual_min)',
    'minmax_eff_min(COALESCE(psp.min_units, psp.draft_min, 0), COALESCE(psp.max_units, psp.draft_max, 0), psp.manual_min, psp.manual_max)');
  d := replace(d,
    'minmax_effective(COALESCE(psp.max_units, psp.draft_max, 0), psp.manual_max)',
    'minmax_eff_max(COALESCE(psp.min_units, psp.draft_min, 0), COALESCE(psp.max_units, psp.draft_max, 0), psp.manual_min, psp.manual_max)');
  d := replace(d,
    'minmax_effective(COALESCE(psp3.min_units, psp3.draft_min,0), psp3.manual_min)',
    'minmax_eff_min(COALESCE(psp3.min_units, psp3.draft_min,0), COALESCE(psp3.max_units, psp3.draft_max,0), psp3.manual_min, psp3.manual_max)');
  d := replace(d,
    'minmax_effective(COALESCE(psp3.max_units, psp3.draft_max,0), psp3.manual_max)',
    'minmax_eff_max(COALESCE(psp3.min_units, psp3.draft_min,0), COALESCE(psp3.max_units, psp3.draft_max,0), psp3.manual_min, psp3.manual_max)');
  quedan := (length(d) - length(replace(d, 'minmax_effective(', ''))) / length('minmax_effective(');
  IF quedan <> 0 THEN
    RAISE EXCEPTION 'get_stock_analysis: quedaron % llamadas a minmax_effective sin convertir', quedan;
  END IF;
  EXECUTE d;

  -- get_network_summary_json (2 llamadas, columnas sin alias)
  d := pg_get_functiondef('public.get_network_summary_json'::regproc);
  d := replace(d, 'minmax_effective(min_units, manual_min)',
                  'minmax_eff_min(min_units, max_units, manual_min, manual_max)');
  d := replace(d, 'minmax_effective(max_units, manual_max)',
                  'minmax_eff_max(min_units, max_units, manual_min, manual_max)');
  quedan := (length(d) - length(replace(d, 'minmax_effective(', ''))) / length('minmax_effective(');
  IF quedan <> 0 THEN
    RAISE EXCEPTION 'get_network_summary_json: quedaron % llamadas sin convertir', quedan;
  END IF;
  EXECUTE d;

  -- get_pedido_preview (5 llamadas: 1 de MIN y 4 de MAX — dos de ellas en el
  -- WHERE, o sea que la escalera también decide qué entra al pedido).
  d := pg_get_functiondef('public.get_pedido_preview'::regproc);
  d := replace(d, 'minmax_effective(psp.min_units, psp.manual_min)',
                  'minmax_eff_min(psp.min_units, psp.max_units, psp.manual_min, psp.manual_max)');
  d := replace(d, 'minmax_effective(psp.max_units, psp.manual_max)',
                  'minmax_eff_max(psp.min_units, psp.max_units, psp.manual_min, psp.manual_max)');
  quedan := (length(d) - length(replace(d, 'minmax_effective(', ''))) / length('minmax_effective(');
  IF quedan <> 0 THEN
    RAISE EXCEPTION 'get_pedido_preview: quedaron % llamadas sin convertir', quedan;
  END IF;
  EXECUTE d;
END $mig$;
