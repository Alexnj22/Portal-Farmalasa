SET lock_timeout = '5s';

-- El disparador del aviso. Va aparte de la función a propósito: `cortes_caja`
-- la escribe la captura cada minuto, y un error dentro de la función aborta ese
-- INSERT — o sea que dejarían de entrar los cortes de TODAS las salas. La
-- función se probó antes contra datos reales (un corte C de hoy, un cierre Z y
-- un corte viejo) dentro de una transacción revertida: 5 avisos, 0 y 0.
DROP TRIGGER IF EXISTS trg_notificar_corte_de_caja ON public.cortes_caja;
CREATE TRIGGER trg_notificar_corte_de_caja
AFTER INSERT ON public.cortes_caja
FOR EACH ROW EXECUTE FUNCTION public.notificar_corte_de_caja();
