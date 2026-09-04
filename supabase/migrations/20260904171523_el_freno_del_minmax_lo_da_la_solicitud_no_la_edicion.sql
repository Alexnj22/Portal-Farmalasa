SET lock_timeout = '5s';

-- QUÉ protege un número de MIN/MAX del recálculo del mes que viene.
--
-- Hasta hoy: `manual_at IS NOT NULL`, o sea CUALQUIER edición a mano. Y eso
-- mete en la misma bolsa dos cosas que no se parecen:
--
--   1. La REVISIÓN del mes. Alguien mira los borradores del recálculo, corrige
--      números y publica. Es trabajo de ese ciclo — no es una excepción que
--      deba sobrevivir al cálculo siguiente. Medido el 2026-09-04: de las 416
--      filas con borrador frenado, **365 son exactamente eso**, hechas entre el
--      3 y el 11 de agosto (el recálculo fue el 1). Tres sesiones de revisión.
--   2. La DECISIÓN sobre ese producto. Alguien pidió el cambio, escribió por
--      qué, y otra persona lo aprobó. Eso sí tiene que sobrevivir: nadie lo
--      volvió a mirar y el cálculo no sabe lo que sabía quien lo pidió.
--
-- Regla del usuario: «todo lo de antes de publicar el nuevo mes que no lo tome
-- en cuenta, sólo por solicitudes, ésos sí».
--
-- `manual_at`/`manual_por` NO cambian de sentido: siguen diciendo quién tocó la
-- fila y cuándo, que es la bitácora y se muestra en pantalla. Lo que se separa
-- es el FRENO, y para eso hace falta un dato que la fecha no puede dar.
ALTER TABLE public.product_stock_params
  ADD COLUMN IF NOT EXISTS ajuste_solicitud_id bigint;

COMMENT ON COLUMN public.product_stock_params.ajuste_solicitud_id IS
  'La solicitud aprobada que puso este MIN/MAX, si vino de una. Es lo que frena '
  'al recálculo y al barrido de publicar — una edición a mano durante la revisión '
  'del mes no frena nada. La limpia trg_marcar_ajuste_manual_minmax cuando alguien '
  'edita el número después: ahí el par ya no es el que se aprobó.';

-- FK con su índice, que es la regla 2 de la estructura. ON DELETE SET NULL y no
-- CASCADE: borrar la solicitud no puede borrar el MIN/MAX del producto.
ALTER TABLE public.product_stock_params
  DROP CONSTRAINT IF EXISTS psp_ajuste_solicitud_fk;
ALTER TABLE public.product_stock_params
  ADD CONSTRAINT psp_ajuste_solicitud_fk
  FOREIGN KEY (ajuste_solicitud_id) REFERENCES public.minmax_change_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_psp_ajuste_solicitud
  ON public.product_stock_params (ajuste_solicitud_id)
  WHERE ajuste_solicitud_id IS NOT NULL;

-- Relleno de lo ya aprobado. `approve_minmax_request` escribe `manual_at` con el
-- mismo `now()` que `decided_at` —misma transacción— así que la coincidencia es
-- exacta; el margen de 2 s es por si alguna vez dejan de compartirlo.
UPDATE public.product_stock_params p
SET ajuste_solicitud_id = r.id
FROM public.minmax_change_requests r
WHERE r.decided_at IS NOT NULL
  AND r.status = 'approved'
  AND r.erp_product_id  = p.erp_product_id
  AND r.erp_sucursal_id = p.erp_sucursal_id
  AND p.manual_at IS NOT NULL
  AND abs(extract(epoch FROM (r.decided_at - p.manual_at))) < 2
  AND p.ajuste_solicitud_id IS NULL;
