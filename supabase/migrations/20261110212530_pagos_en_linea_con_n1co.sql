-- El cobro en línea pasa de Wompi a n1co (2026-11-10, decisión del dueño:
-- Wompi se quita entero).
--
-- `app_reservas_pagos` sigue siendo la tabla de todo cobro en línea. Gana:
--   pasarela       con qué se cobró. La única fila de antes (un cobro de PRUEBA
--                  de Wompi, el 2026-11-03) queda como 'wompi'; las nuevas
--                  nacen 'n1co'.
--   enlace_codigo  el `orderCode` de n1co. Es con lo que se CONSULTA la orden
--                  (`GET /paymentlink/order/{orderCode}`): `n1co-pagos` lo lee
--                  de acá y nunca de la petición, así nadie le pega a un cobro
--                  la orden pagada de otro.
-- `enlace_id` guarda el `orderId` de n1co (entero), igual que guardaba el id
-- del enlace de Wompi.
--
-- `apartado_enlace_guardar` (la usa `operar-caja`) gana `p_codigo`, con
-- DEFAULT NULL: la versión desplegada de `operar-caja`, que la llama con
-- cuatro argumentos, sigue resolviendo a ésta. Se borra la firma vieja para
-- no dejar una sobrecarga con sus propios permisos.
SET lock_timeout = '5s';

ALTER TABLE public.app_reservas_pagos
  ADD COLUMN IF NOT EXISTS pasarela text,
  ADD COLUMN IF NOT EXISTS enlace_codigo text;

UPDATE public.app_reservas_pagos SET pasarela = 'wompi' WHERE pasarela IS NULL;

ALTER TABLE public.app_reservas_pagos
  ALTER COLUMN pasarela SET DEFAULT 'n1co',
  ALTER COLUMN pasarela SET NOT NULL,
  ADD CONSTRAINT app_reservas_pagos_pasarela_check CHECK (pasarela IN ('wompi', 'n1co'));

-- El aviso de n1co que no trae `orderReference` se busca por la orden.
CREATE INDEX IF NOT EXISTS app_reservas_pagos_orden_n1co_idx
  ON public.app_reservas_pagos (enlace_id) WHERE pasarela = 'n1co';

DROP FUNCTION IF EXISTS public.apartado_enlace_guardar(text, bigint, text, boolean);

CREATE FUNCTION public.apartado_enlace_guardar(p_identificador text, p_enlace_id bigint, p_url text, p_prueba boolean, p_codigo text DEFAULT NULL)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  UPDATE public.app_reservas_pagos
     SET enlace_id = p_enlace_id, enlace_url = p_url, enlace_prueba = p_prueba,
         enlace_codigo = COALESCE(p_codigo, enlace_codigo)
   WHERE identificador = p_identificador AND estado = 'creado';
$function$;

REVOKE EXECUTE ON FUNCTION public.apartado_enlace_guardar(text, bigint, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apartado_enlace_guardar(text, bigint, text, boolean, text) TO service_role;
