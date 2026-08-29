-- El id de empleado que usa la CAJA, aparte del de la ficha del portal.
--
-- Son dos cosas distintas y las dos hacen falta cuando el portal abre la caja:
--   `employee_id`     la persona de verdad, la que pasó su carné.
--   `erp_empleado_id` el número con el que la caja identifica a quien abre.
--
-- No hay forma de derivar el segundo del primero: la pantalla de apertura sólo
-- ofrece el empleado de la sesión, así que el número no se puede pedir por
-- nombre. Lo que sí se puede es LEERLO del panel de la sala —viene en el enlace
-- del cierre, `emp=38`— y reusarlo la próxima vez que el portal abra esa caja.

SET lock_timeout = '5s';

ALTER TABLE public.cortes_caja_aperturas
    ADD COLUMN IF NOT EXISTS erp_empleado_id integer;

COMMENT ON COLUMN public.cortes_caja_aperturas.erp_empleado_id IS
    'El número con el que la caja identifica a quien abrió. NO es la ficha del portal (`employee_id`): ése es quien pasó el carné.';
