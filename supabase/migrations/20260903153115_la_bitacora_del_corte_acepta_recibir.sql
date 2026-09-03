SET lock_timeout = '5s';

-- `resolver_corte_caja` empezo a escribir un evento 'RECIBIR' y el CHECK seguia
-- siendo el del modelo viejo: la PRIMERA entrega habria fallado con un 23514 y
-- se habria llevado puesta la confirmacion entera, porque el INSERT del evento
-- va en la misma transaccion. Es
-- `feedback_una_funcion_nueva_no_prueba_que_la_tabla_la_acepte`: al ampliar lo
-- que se escribe, los CHECK siguen siendo los de antes y no avisan.
--
-- Se aplica ANTES de que exista quien la llame — el frente todavia no manda el
-- parametro—, asi que no hay ventana en la que una entrega pueda fallar.
ALTER TABLE public.cortes_caja_eventos
  DROP CONSTRAINT IF EXISTS cortes_caja_eventos_accion_check;

ALTER TABLE public.cortes_caja_eventos
  ADD CONSTRAINT cortes_caja_eventos_accion_check
  CHECK (accion = ANY (ARRAY[
    'CONFIRMAR'::text, 'DESCARTAR'::text, 'REABRIR'::text,
    'RESOLVER_DIFERENCIA'::text, 'ANULAR_DIFERENCIA'::text, 'ASENTAR'::text,
    -- Quien recibe la caja y se hace cargo del efectivo desde este corte.
    'RECIBIR'::text
  ]));
