-- El Gerente General no quedó con el permiso, y el motivo vale anotarlo.
--
-- La migración anterior (20260901195124) intentó dárselo con un INSERT guardado
-- por `NOT EXISTS (… module_key = 'promociones')`. Pero su fila YA existía: era
-- una de las 21 que venían de `bonificaciones` con los tres permisos en falso, y
-- el rename la trajo intacta. Así que el guard hizo exactamente lo que decía —
-- «no insertes si ya hay fila»— y el permiso nunca se otorgó.
--
-- El modo de falla es el de siempre: no hubo error. La migración devolvió
-- success, las 7 tablas quedaron bien, y el único rastro era una fila con
-- can_approve = false que nadie iba a mirar hasta que un excedente se quedara
-- sin quien lo decida. Con permiso por fila preexistente, la operación correcta
-- es UPDATE, no INSERT … NOT EXISTS.
--
-- Se le da ver + aprobar (no editar): arma las promociones Supervisión de
-- Ventas; Gerencia decide los excedentes cuando Supervisión no está.

SET lock_timeout = '5s';

UPDATE public.role_permissions rp
   SET can_view    = true,
       can_approve = true,
       scope       = 'ALL',
       updated_at  = now()
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'promociones'
   AND r.name = 'Gerente General';
