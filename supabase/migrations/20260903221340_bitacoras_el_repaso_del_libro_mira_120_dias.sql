-- El repaso diario del libro miraba 45 días hacia atrás. Una venta que llegara
-- del ERP más tarde que esa ventana no entraba NUNCA al libro, y sin dar error:
-- un renglón que falta y que nadie puede notar, que es el modo de falla que más
-- caro sale en un registro sanitario.
--
-- 120 días cubren el trimestre entero. Sigue siendo UN disparo por día y la
-- consulta entra por `sales_invoices(fecha)`, así que no cambia el volumen que
-- mide `gate:eficiencia` — cambia cuánto alcanza a ver.
--
-- Va por `cron.schedule` y no por un UPDATE a `cron.job`: esa tabla no acepta
-- escritura directa ni desde la migración («permission denied for table job»).
SELECT cron.schedule(
    'bitacora-dispensaciones-repaso-diario',
    '35 11 * * *',
    $cmd$ SELECT public.sincronizar_bitacora_dispensaciones(
        (now() AT TIME ZONE 'America/El_Salvador')::date - 120,
        (now() AT TIME ZONE 'America/El_Salvador')::date
    ) $cmd$
);
