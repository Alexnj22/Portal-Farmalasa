-- El vale que el portal le anota a la caja — F2 de
-- docs/PLAN-CAJA-EN-EL-PORTAL-2026-08-28.md
--
-- ── El defecto que cierra ───────────────────────────────────────────────────
-- El corte cuenta, por día, todo lo que entró a la caja desde el Z anterior.
-- Meter el dinero en una bolsa no le avisa nada, así que la plata de las bolsas
-- DE HOY sigue siendo caja para el sistema hasta el Z de la noche. Cuando una
-- remesa se paga con esa plata, la caja sigue esperando dinero que ya salió.
--
-- Medido: de 29 salidas registradas, 6 tomaron de una bolsa del mismo día
-- ($2,200) y sólo UNA tiene su movimiento anotado. Las otras cinco quedaron
-- como faltantes falsos — REM-1028 de Salud 1 hizo que dos cortes seguidos
-- marcaran −$425.10 y −$400.10.
--
-- Y el error espejo también está medido: el 22-ago dos remesas que salieron de
-- una bolsa del DÍA ANTERIOR se anotaron igual, y el corte marcó +$454.00 de
-- sobrante, que taparon con un ingreso falso por el mismo monto.
--
-- ── La regla, que no es «toda salida lleva vale» ────────────────────────────
-- Sólo lleva vale lo que salió de una bolsa del día que la caja TIENE ABIERTO.
-- Y no es la fecha de hoy: es `cortes_caja_aperturas.abierta_el` de la apertura
-- vigente de esa sala, que es exactamente el día que el sistema sigue contando.
-- Sin apertura vigente no se anota nada — que es la falla segura.
--
-- El monto tampoco es el de la operación: una salida puede repartirse entre
-- varias bolsas (CMB-1032 tomó de cuatro). Al vale va sólo la parte que salió
-- de bolsas del día abierto, y por eso el vínculo es con `bolsas_movimientos`
-- —el vale POR BOLSA— y no con `bolsas_operaciones`.
--
-- ── Un vale por TRAMO, no uno por salida ────────────────────────────────────
-- Pedido del usuario: un solo asiento allá y el detalle acá. El portal abre un
-- vale al primer movimiento y le va subiendo el monto mientras no haya corte;
-- cuando aparece un corte, ese vale se cierra y la próxima salida abre otro.
--
-- El cierre por corte NO es cosmético: editar un movimiento que un corte ya
-- contó es justo lo que la auditoría de v2.838.0 marca como hallazgo, y sería
-- el portal generando la señal que el portal vigila.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.caja_vales_portal (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    branch_id         integer NOT NULL REFERENCES public.branches(id),
    -- El día de caja que estaba abierto cuando se abrió el vale.
    fecha             date    NOT NULL,
    -- El movimiento del sistema de la caja. NULL mientras no se pudo escribir.
    erp_movimiento_id integer,
    monto             numeric(12,2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
    estado            text NOT NULL DEFAULT 'PENDIENTE'
                      CHECK (estado IN ('PENDIENTE','ANOTADO','CERRADO','FALLIDO')),
    -- El último corte visto al abrirlo: si aparece otro, este vale se cierra.
    corte_id_al_abrir bigint REFERENCES public.cortes_caja(id),
    intentos          smallint NOT NULL DEFAULT 0,
    ultimo_error      text,
    anotado_at        timestamptz,
    cerrado_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Un solo vale ABIERTO por sala: es lo que hace que «sumarle» sea una decisión
-- sin ambigüedad. Los cerrados y los fallidos no compiten por esta ranura.
CREATE UNIQUE INDEX IF NOT EXISTS caja_vales_portal_abierto_unico
    ON public.caja_vales_portal (branch_id)
    WHERE estado IN ('PENDIENTE','ANOTADO');

CREATE INDEX IF NOT EXISTS caja_vales_portal_branch_idx
    ON public.caja_vales_portal (branch_id, fecha DESC);

COMMENT ON TABLE public.caja_vales_portal IS
    'El vale consolidado que el portal le anota a la caja por cada tramo: un asiento allá, el detalle acá.';
COMMENT ON COLUMN public.caja_vales_portal.estado IS
    'PENDIENTE = falta escribirlo · ANOTADO = está en la caja y todavía admite sumas · CERRADO = pasó un corte · FALLIDO = se intentó y no entró.';

-- El vínculo va en el movimiento de bolsa, que es la unidad que de verdad
-- consumió plata de una bolsa concreta.
ALTER TABLE public.bolsas_movimientos
    ADD COLUMN IF NOT EXISTS caja_vale_id bigint REFERENCES public.caja_vales_portal(id);

CREATE INDEX IF NOT EXISTS bolsas_mov_caja_vale_idx
    ON public.bolsas_movimientos (caja_vale_id);

COMMENT ON COLUMN public.bolsas_movimientos.caja_vale_id IS
    'El vale del portal que ya cubre este movimiento en el sistema de la caja. NULL = todavía no está anotado allá (o no hace falta: salió de una bolsa de un día ya cerrado).';

ALTER TABLE public.caja_vales_portal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bloqueo_global ON public.caja_vales_portal;
CREATE POLICY bloqueo_global ON public.caja_vales_portal
    AS RESTRICTIVE FOR ALL TO public USING ((SELECT auth_no_bloqueado()));

DROP POLICY IF EXISTS caja_vales_portal_select ON public.caja_vales_portal;
CREATE POLICY caja_vales_portal_select ON public.caja_vales_portal
    FOR SELECT TO authenticated
    USING (
        (SELECT auth_has_module_permission('bolsas','can_view'))
        AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
             OR branch_id = (SELECT auth_employee_branch_id()))
    );

REVOKE ALL ON public.caja_vales_portal FROM anon;
GRANT SELECT ON public.caja_vales_portal TO authenticated;
GRANT ALL    ON public.caja_vales_portal TO service_role;

-- ── Qué falta anotar ────────────────────────────────────────────────────────
--
-- `plpgsql` y no `sql`: con `SET search_path`, una función `LANGUAGE sql` se
-- planifica UNA vez con los parámetros como `Params` y nunca ve un valor —la
-- trampa 4 de CLAUDE.md—. Acá no tiene parámetros, pero el cuerpo es el mismo
-- que va a crecer, y el modo de falla es invisible.
--
-- Devuelve el detalle y no un total: quien lo escriba tiene que poder marcar
-- exactamente los movimientos que quedaron cubiertos, y un total no dice cuáles.
CREATE OR REPLACE FUNCTION public.caja_vales_pendientes()
RETURNS TABLE (
    branch_id      integer,
    dia_abierto    date,
    movimiento_id  bigint,
    operacion_id   bigint,
    folio          text,
    monto          numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT b.branch_id::integer,
         a.abierta_el,
         m.id,
         o.id,
         o.folio,
         (-m.monto)::numeric
  FROM public.bolsas_movimientos m
  JOIN public.bolsas b            ON b.id = m.bolsa_id
  JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
  -- La apertura VIGENTE de esa sala dice qué día sigue contando la caja. Sin
  -- apertura abierta no hay nada que anotar: la falla segura es no escribir.
  JOIN LATERAL (
      SELECT ap.abierta_el
      FROM public.cortes_caja_aperturas ap
      WHERE ap.branch_id = b.branch_id AND ap.cerrada_at IS NULL
      ORDER BY ap.abierta_el DESC
      LIMIT 1
  ) a ON true
  WHERE m.anulado_at IS NULL
    AND o.anulada_at IS NULL
    AND m.caja_vale_id IS NULL
    AND m.monto < 0                 -- sólo lo que SALE
    AND b.fecha = a.abierta_el;     -- y sólo lo que la caja todavía cuenta
END;
$$;

REVOKE EXECUTE ON FUNCTION public.caja_vales_pendientes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.caja_vales_pendientes() TO authenticated, service_role;

COMMENT ON FUNCTION public.caja_vales_pendientes() IS
    'Los movimientos de bolsa que salieron de una bolsa del día que la caja tiene ABIERTO y todavía no están anotados allá. Lo que salió de una bolsa de un día ya cerrado NO aparece: la caja no lo cuenta, y anotarlo inventaría un sobrante.';
