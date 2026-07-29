SET lock_timeout = '5s';

-- Un producto oculto en MIN/MAX debe quedar en -/- PUBLICADO, no arrastrando un
-- borrador de 0/0 pendiente de aprobar. Ese borrador era inalcanzable: la tabla
-- no lista los ocultos y el contador de borradores los saltea a propósito
-- (useMinMaxData.js:298), así que nadie podía verlo ni publicarlo — y
-- calculate_stock_params se salta la sucursal ENTERA ante un solo pendiente.
-- Por eso el recálculo mensual llevaba sin correr desde junio en las 6.
--
-- Las 32 filas que quedaron así son servicios y no-inventario ocultados el
-- 17-jul (APLICACION DE INYECCION, SERVICIO A DOMICILIO, COMISIONES POR
-- CORRESPONSAL, DIETAS COFARSAL, AQUA ECO, PRUEBA DE GLUCOSA…). Se les aplica
-- lo que el ocultar quiso decir: sin mínimo ni máximo.
UPDATE public.product_stock_params
SET min_units      = NULL,
    max_units      = NULL,
    draft_min      = NULL,
    draft_max      = NULL,
    draft_status   = 'none',
    updated_at     = now()
WHERE is_hidden IS TRUE
  AND draft_status = 'pending'
  AND COALESCE(draft_min, 0) = 0
  AND COALESCE(draft_max, 0) = 0;
