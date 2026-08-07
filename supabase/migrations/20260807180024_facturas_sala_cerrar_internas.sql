-- Facturas de mi Sala — cerrar las tres funciones que el navegador no llama.
--
-- El advisor las marcó (lint 0029) junto a las cinco que SÍ son API. La
-- diferencia importa: `get_facturas_sala`, `contar_facturas_sala`,
-- `reclamar_factura_compra`, `soltar_factura_compra` y `get_facturas_sala_panel`
-- son el API del widget y hacen su propio control de permiso adentro. Estas tres
-- no: son piezas internas, y una de ellas ESCRIBE sin comprobar nada.
--
--   · `facturas_sala_guarda`      — el helper de permiso. Que sea llamable de
--                                   afuera no da nada, pero tampoco hay motivo.
--   · `linea_telefonica_de`       — parser de texto, uso interno.
--   · `verificar_facturas_reclamadas` — ESTE es el que importaba: liga reclamos
--                                   con compras y no comprueba ningún permiso,
--                                   porque nació para que la corra el cron. Con
--                                   EXECUTE para `authenticated`, cualquiera con
--                                   sesión podía dispararla.
--
-- Las llamadas internas siguen funcionando: una función SECURITY DEFINER se
-- ejecuta con los privilegios de su dueño, y el dueño conserva EXECUTE.

SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.facturas_sala_guarda(bigint, text)        FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.linea_telefonica_de(text)                 FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.verificar_facturas_reclamadas(integer)    FROM authenticated;
