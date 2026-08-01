SET lock_timeout = '5s';

-- El número de control fiscal del DTE (`DTE-03-S006P007-000000000000035`).
-- NO es derivable del `correlativo` que ya guardamos: son dos contadores
-- independientes —el nuestro es interno del ERP, éste es el fiscal— y cada
-- punto de venta corre su propia serie. Medido el 2026-08-01 sobre dos
-- documentos: la diferencia entre ambos fue 39 y 103.
--
-- Se llena documento por documento desde `dteqr_json.php?codigoGeneracion=…`,
-- que es público y no pide sesión. Nullable a propósito: NULL significa "no
-- lo hemos traído todavía", nunca "no tiene". Un libro con NULL acá está
-- incompleto y no se debe presentar.
ALTER TABLE public.sales_invoices
    ADD COLUMN IF NOT EXISTS numero_control text;

COMMENT ON COLUMN public.sales_invoices.numero_control IS
    'Número de control fiscal del DTE (DTE-TT-CCCCPPPP-NNNNNNNNNNNNNNN). Se trae de dteqr_json.php por codigo_generacion; NO se deriva del correlativo. NULL = pendiente de backfill, no "sin dato".';
