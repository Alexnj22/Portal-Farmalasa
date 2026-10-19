-- Salud 1 vuelve al envío a Hacienda (2026-10-19).
--
-- La pausa de `20261019213352_dte_sucursales_en_pausa` era para unas pruebas
-- fiscales. Terminaron en la regla de los COF de las 6:00 p. m. en adelante
-- (`cof_no_se_envia_mh`), que vale para todas las sucursales, así que Salud 1
-- vuelve a mandarse como las demás. La tabla se queda: es el interruptor para
-- la próxima vez.

SET lock_timeout = '5s';

DELETE FROM public.dte_sucursales_en_pausa WHERE branch_id = 4;
