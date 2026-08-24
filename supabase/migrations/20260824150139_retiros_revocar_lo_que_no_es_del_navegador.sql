SET lock_timeout = '5s';

-- Dos funciones quedaron alcanzables por `authenticated` sin que nadie lo
-- decidiera, y el advisor las levantó. Revocar el PUBLIC no alcanza cuando el
-- rol tiene su propio camino: hay que nombrarlo.
--
-- `retiro_bultos_viejos` lista QUIÉN lleva QUÉ en todas las salas. Es para el
-- aviso automático de los tres días, o sea para el servidor: en manos del
-- navegador es un padrón de movimientos que nadie pidió poder consultar.
REVOKE EXECUTE ON FUNCTION public.retiro_bultos_viejos(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.retiro_bultos_viejos(int) TO service_role;

-- `retiro_cerrar_custodia` es una función de TRIGGER. Llamarla suelta falla
-- —sin `NEW` no hay nada que leer— así que no es un agujero, pero un DEFINER
-- expuesto por `/rest/v1/rpc` sin que nadie lo haya decidido es exactamente la
-- forma en que la superficie crece sola. Se cierra en vez de explicarla.
REVOKE EXECUTE ON FUNCTION public.retiro_cerrar_custodia() FROM PUBLIC, anon, authenticated;
