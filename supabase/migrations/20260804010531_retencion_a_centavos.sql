-- La retención, redondeada a centavos.
--
-- El origen la manda como FLOTANTE (`1.059999942779541`,
-- `3.5999999046325684`) mientras subtotal, iva y total llegan con dos
-- decimales. El DTE dice `ivaRete1: 3.6`: el valor real tiene dos decimales y
-- el resto es basura de coma flotante que entró tal cual a una columna de
-- dinero — `sum()` devolvía 179.3599987030029290 donde el dato es 179.36.
--
-- El sync ya redondea desde esta misma versión; esto limpia lo ya guardado.
-- No se puede arreglar re-sincronizando: la comparación del sync usa una
-- tolerancia de medio centavo, así que una diferencia de 6e-8 no dispara nada.
SET lock_timeout = '5s';

UPDATE public.sales_invoices
   SET retencion = round(retencion, 2)
 WHERE retencion <> 0
   AND retencion IS DISTINCT FROM round(retencion, 2);
