SET lock_timeout = '5s';

-- El historial de facturas perdía en silencio, justamente, los cambios más
-- interesantes: los de una venta que nunca llegó a generar documento.
--
-- `codigo_generacion` era NOT NULL y el sync la copia tal cual viene del
-- sistema de origen. Una venta anulada antes de transmitirse no tiene ese
-- número, así que su fila del historial violaba la restricción — y como el
-- `insert` del sync no revisa su error, se caía el LOTE ENTERO de esa sala en
-- ese minuto, sin una línea en ningún log.
--
-- Medido el 2026-08-21 con 0000061286_COF (La Popular): la factura pasó de
-- FINALIZADA a NULA a las 10:59 y el historial no tiene ni una fila de ese
-- cambio, mientras que las dos anulaciones del mismo día —ambas con documento—
-- sí quedaron registradas. El cambio existió; lo que faltó fue el renglón.
--
-- La columna es informativa: identifica el documento cuando lo hay. Que no lo
-- haya es un dato del caso, no una fila inválida.
ALTER TABLE public.sales_invoice_changelog
  ALTER COLUMN codigo_generacion DROP NOT NULL;

COMMENT ON COLUMN public.sales_invoice_changelog.codigo_generacion IS
  'UUID del DTE de la factura. NULL cuando la venta nunca llegó a generar documento — típicamente, anulada antes de transmitirse. Era NOT NULL hasta 2026-08-21 y eso descartaba en silencio el historial de esos casos.';
