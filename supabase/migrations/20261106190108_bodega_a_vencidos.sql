SET lock_timeout = '5s';

-- Bodega pasa producto de su estante a su área de vencidos (usuario,
-- 2026-11-06: «creemos algo para bodega que lo pueda hacer, con motivo, foto»).
--
-- Hasta hoy el portal sólo lo hacía AL CARGAR una compra («A vencidos» de un
-- renglón). Lo que ya estaba en el estante se movía en el sistema a mano, sin
-- rastro: el 6-nov el SUPLEX TRI de la compra 6520 apareció en vencidos dos
-- minutos después de cargarlo y nadie sabe por qué.
--
-- Una fila por movimiento. Se escribe ANTES de mandar el traslado
-- (`enviando`) y se cierra con lo que se comprobó en el sistema: así un corte a
-- medio camino queda escrito y no se manda dos veces.
--
-- Escribe sólo la función `cargar-compra-erp` (llave de servicio): sin
-- policies de escritura a propósito.
CREATE TABLE public.bodega_a_vencidos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  erp_product_id  integer     NOT NULL,
  descripcion     text        NOT NULL,
  presentacion    text        NOT NULL,
  factor          numeric     NOT NULL CHECK (factor > 0),
  cantidad        numeric     NOT NULL CHECK (cantidad > 0),
  unidades        numeric     NOT NULL CHECK (unidades > 0),
  lote            text,
  vence           date,
  motivo          text        NOT NULL
    CHECK (motivo IN ('proximo_a_vencer', 'vencido', 'danado', 'devolucion', 'retiro', 'otro')),
  detalle         text,
  fotos           text[]      NOT NULL DEFAULT '{}',
  estado          text        NOT NULL DEFAULT 'enviando'
    CHECK (estado IN ('enviando', 'en_vencidos', 'sin_verificar', 'fallido')),
  erp_traslado_id text,
  nota            text,
  hecho_por       uuid        NOT NULL REFERENCES public.employees(id),
  -- El daño se muestra: sin foto, nadie puede decidir después si se le
  -- reclama al proveedor o se da de baja (la misma regla que la «Avería»).
  CONSTRAINT bodega_a_vencidos_dano_con_foto CHECK (motivo <> 'danado' OR cardinality(fotos) >= 1),
  CONSTRAINT bodega_a_vencidos_otro_con_detalle CHECK (motivo <> 'otro' OR length(btrim(coalesce(detalle, ''))) >= 4),
  CONSTRAINT bodega_a_vencidos_max_fotos CHECK (cardinality(fotos) <= 3)
);

CREATE INDEX bodega_a_vencidos_hecho_por_idx ON public.bodega_a_vencidos (hecho_por);
CREATE INDEX bodega_a_vencidos_created_idx ON public.bodega_a_vencidos (created_at DESC);

ALTER TABLE public.bodega_a_vencidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY bodega_a_vencidos_select ON public.bodega_a_vencidos
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cargar_compra', 'can_view'))
      OR (SELECT auth_has_module_permission('compras', 'can_view')));

REVOKE ALL ON public.bodega_a_vencidos FROM anon;
GRANT SELECT ON public.bodega_a_vencidos TO authenticated;
GRANT ALL ON public.bodega_a_vencidos TO service_role;
