SET lock_timeout = '5s';

-- ═══ ¿Qué salas pueden recibir un papel? ════════════════════════════════════
--
-- Pedido del usuario el 2026-08-20: al imprimir un carné del día, «que me
-- pregunte a qué sucursal mandarlo, así se imprime en esa ticketera».
--
-- Para preguntarlo hay que poder ofrecer la lista, y la tabla de cajas
-- (`impresion_dispositivos`) sólo la lee quien tiene el permiso `impresion` —
-- que Administración no tiene, ni tiene por qué: ahí se ve el equipo, la cola de
-- CUPS y el canal de cada caja, que es información de instalación.
--
-- Esta función devuelve lo ÚNICO que hace falta para elegir: qué sucursales
-- tienen una caja activa y si está latiendo. Ni nombre de equipo, ni impresora,
-- ni token. Ampliar `impresion` para que Administración pueda imprimir habría
-- sido darle una pantalla de mantenimiento por una lista de cinco filas.
--
-- **«Latiendo» son 2 minutos y no es un número al azar**: es el mismo umbral
-- con el que `CajasDeImpresion` pinta una caja como viva, y el agente pregunta
-- cada 2 segundos. Si los dos números se separan, la misma caja sale «lista» en
-- una pantalla y «sin señal» en la otra.
CREATE OR REPLACE FUNCTION public.salas_con_caja_de_impresion()
 RETURNS TABLE(branch_id bigint, latiendo boolean, ultimo_latido timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT d.branch_id,
           (max(d.ultimo_latido) > now() - interval '2 minutes') AS latiendo,
           max(d.ultimo_latido) AS ultimo_latido
      FROM public.impresion_dispositivos d
     WHERE d.activo
       AND (SELECT auth_employee_id()) IS NOT NULL
     GROUP BY d.branch_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.salas_con_caja_de_impresion() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salas_con_caja_de_impresion() TO authenticated, service_role;

COMMENT ON FUNCTION public.salas_con_caja_de_impresion() IS
 'Que sucursales tienen una caja de impresion activa y si esta latiendo. Solo eso: la tabla completa la lee quien tiene el permiso impresion.';
