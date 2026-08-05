SET lock_timeout = '5s';

-- ═══ GASTOS POR RECUPERAR ════════════════════════════════════════════════════
-- Pedido del usuario (2026-08-05): cargar un gasto a una o varias salas y que
-- se sume a su meta, pero NO como venta directa: como GANANCIA a recuperar.
--
--     venta a agregar = monto del gasto ÷ (margen ÷ 100)
--     $1,000 ÷ 0.25 = $4,000
--
-- Decisión explícita del usuario: la conversión es esa, simple, sobre la venta
-- tal como la ve la sala (que lleva IVA adentro, la base elegida en el plan
-- original). Eso recupera ~88.5% del gasto y está aceptado a propósito — el 25%
-- es una apuesta de negocio, no un cálculo contable. NO es un bug.

ALTER TABLE public.metas_config
  ADD COLUMN IF NOT EXISTS margen_recuperacion_pct numeric NOT NULL DEFAULT 25;

-- La meta pasa a tener sus dos mitades a la vista. `monto_meta` sigue siendo LA
-- verdad —lo que leen el tablero, el widget y el bono, sin cambiar su
-- matemática—; las otras dos existen para poder mostrar el desglose.
ALTER TABLE public.metas_sucursal
  ADD COLUMN IF NOT EXISTS monto_base numeric,
  ADD COLUMN IF NOT EXISTS monto_recuperacion numeric NOT NULL DEFAULT 0;

UPDATE public.metas_sucursal SET monto_base = monto_meta WHERE monto_base IS NULL;
ALTER TABLE public.metas_sucursal ALTER COLUMN monto_base SET NOT NULL;

-- La invariante, verificada por la base y no por la buena memoria de quien
-- escriba el próximo RPC.
ALTER TABLE public.metas_sucursal DROP CONSTRAINT IF EXISTS metas_sucursal_meta_es_base_mas_recuperacion;
ALTER TABLE public.metas_sucursal ADD CONSTRAINT metas_sucursal_meta_es_base_mas_recuperacion
  CHECK (monto_meta = monto_base + monto_recuperacion);

-- ── El gasto, una vez ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.metas_gasto (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  concepto     text NOT NULL,
  monto_total  numeric NOT NULL CHECK (monto_total > 0),
  -- Copiado de la config al crear: cambiar el margen mañana no reescribe lo ya
  -- cargado. Misma regla que el resto del módulo — lo decidido no se recalcula.
  margen_pct   numeric NOT NULL CHECK (margen_pct > 0),
  meses        integer NOT NULL CHECK (meses BETWEEN 1 AND 36),
  ym_inicio    text NOT NULL,
  nota         text,
  estado       text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','anulado')),
  creado_por   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  anulado_por  uuid,
  anulado_at   timestamptz,
  anulado_nota text
);

-- ── Cuánto le toca a cada sala (a mano: decisión del usuario) ────────────────
CREATE TABLE IF NOT EXISTS public.metas_gasto_sala (
  gasto_id  bigint NOT NULL REFERENCES public.metas_gasto(id) ON DELETE CASCADE,
  branch_id bigint NOT NULL,
  monto     numeric NOT NULL CHECK (monto > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gasto_id, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_metas_gasto_sala_branch ON public.metas_gasto_sala(branch_id);

-- ── La cuota: lo que efectivamente se suma a la meta de ese mes ─────────────
-- Se MATERIALIZA para congelar el margen y el reparto del momento en que se
-- cargó el gasto.
CREATE TABLE IF NOT EXISTS public.metas_gasto_cuota (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gasto_id    bigint NOT NULL REFERENCES public.metas_gasto(id) ON DELETE CASCADE,
  branch_id   bigint NOT NULL,
  year_month  text NOT NULL,
  monto_gasto numeric NOT NULL,   -- la parte del gasto de ese mes y esa sala
  monto_venta numeric NOT NULL,   -- lo que suma a la meta: monto_gasto ÷ margen
  estado      text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','anulada')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gasto_id, branch_id, year_month)
);
CREATE INDEX IF NOT EXISTS idx_metas_gasto_cuota_sala_mes
  ON public.metas_gasto_cuota(branch_id, year_month) WHERE estado = 'pendiente';

ALTER TABLE public.metas_gasto       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metas_gasto_sala  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metas_gasto_cuota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS metas_gasto_select       ON public.metas_gasto;
DROP POLICY IF EXISTS metas_gasto_sala_select  ON public.metas_gasto_sala;
DROP POLICY IF EXISTS metas_gasto_cuota_select ON public.metas_gasto_cuota;

CREATE POLICY metas_gasto_select ON public.metas_gasto
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
CREATE POLICY metas_gasto_sala_select ON public.metas_gasto_sala
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
CREATE POLICY metas_gasto_cuota_select ON public.metas_gasto_cuota
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('metas', 'can_view')));
-- Sin policies de escritura: todo entra por los RPC DEFINER de abajo.

-- ── El reparto, en UN solo lugar ─────────────────────────────────────────────
-- La vista previa del modal y el alta real usan esta misma función. Calcular el
-- reparto dos veces es cómo un día divergen y la pantalla promete un número que
-- la base no guarda.
--
-- El residuo del redondeo va al ÚLTIMO mes, en las dos columnas, para que la
-- suma de las cuotas dé exactamente el monto de la sala y la suma de las ventas
-- dé exactamente monto ÷ margen.
CREATE OR REPLACE FUNCTION public.metas_gasto_reparto(
    p_salas jsonb, p_ym_inicio text, p_meses integer, p_margen numeric)
RETURNS TABLE(branch_id bigint, year_month text, monto_gasto numeric, monto_venta numeric)
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  s              jsonb;
  v_branch       bigint;
  v_monto        numeric;
  v_venta_total  numeric;
  v_cuota        numeric;
  v_cuota_venta  numeric;
  i              integer;
BEGIN
  FOR s IN SELECT value FROM jsonb_array_elements(p_salas) LOOP
    v_branch := (s->>'branch_id')::bigint;
    v_monto  := round((s->>'monto')::numeric, 2);
    v_venta_total := round(v_monto / (p_margen / 100), 2);
    v_cuota       := round(v_monto / p_meses, 2);
    v_cuota_venta := round(v_venta_total / p_meses, 2);

    FOR i IN 0 .. p_meses - 1 LOOP
      branch_id  := v_branch;
      year_month := to_char((p_ym_inicio || '-01')::date + (i || ' month')::interval, 'YYYY-MM');
      IF i < p_meses - 1 THEN
        monto_gasto := v_cuota;
        monto_venta := v_cuota_venta;
      ELSE
        -- El último mes se lleva el residuo: así la suma cierra al centavo.
        monto_gasto := v_monto       - v_cuota       * (p_meses - 1);
        monto_venta := v_venta_total - v_cuota_venta * (p_meses - 1);
      END IF;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$function$;

-- ── Recalcular la meta de una sala y un mes ─────────────────────────────────
-- El filtro es el estado de la CUOTA, no el del gasto: anular un gasto anula
-- solo sus cuotas futuras, y las de meses ya arrancados tienen que seguir
-- contando.
CREATE OR REPLACE FUNCTION public.metas_aplicar_recuperacion(
    p_branch_id bigint, p_year_month text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rec numeric;
BEGIN
  SELECT coalesce(sum(c.monto_venta), 0) INTO v_rec
  FROM public.metas_gasto_cuota c
  WHERE c.branch_id = p_branch_id
    AND c.year_month = p_year_month
    AND c.estado = 'pendiente';

  UPDATE public.metas_sucursal
  SET monto_recuperacion = v_rec,
      monto_meta         = monto_base + v_rec
  WHERE branch_id = p_branch_id AND year_month = p_year_month;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.metas_aplicar_recuperacion(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_aplicar_recuperacion(bigint, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.metas_gasto_reparto(jsonb, text, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metas_gasto_reparto(jsonb, text, integer, numeric) TO authenticated, service_role;
