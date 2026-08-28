-- La lista de pendientes tiene que comprobar el permiso ELLA.
--
-- Salió al revisar antes de dar por lista la prueba: `caja_vales_pendientes()`
-- es SECURITY DEFINER —o sea que pasa por encima del RLS— y su EXECUTE estaba
-- concedido a `authenticated` a secas. Cualquiera con sesión podía listar los
-- folios y los montos de todas las salas.
--
-- Que la pantalla esconda el aviso no arregla nada: esconder un botón es
-- comodidad, el candado es esto. Es la misma regla que ya obliga a envolver las
-- `auth_*` en las policies — un DEFINER sin guarda propia es una policy que no
-- se escribió.
--
-- ⚠️ ESTA VERSIÓN ROMPÍA AL SISTEMA y vivió cuatro minutos: la edge function
-- que escribe los vales llama a esta función con la llave de servicio, y sin
-- empleado detrás `auth_has_module_permission` contesta que no —correctamente—,
-- así que la lista quedaba vacía para el único que de verdad la necesita. Lo
-- corrige `20260828225942_caja_vales_pendientes_deja_pasar_al_sistema.sql`, que
-- es la que vale. Se archiva igual, con su SQL tal como se aplicó: el número
-- existe en producción y el registro no se reescribe.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.caja_vales_pendientes()
RETURNS TABLE (
    branch_id      integer,
    dia_abierto    date,
    movimiento_id  bigint,
    operacion_id   bigint,
    folio          text,
    monto          numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_todo    boolean;
  v_sala    bigint;
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Sin permiso para ver los vales de caja pendientes.';
  END IF;

  v_todo := (SELECT auth_module_scope('caja_vales')) = 'ALL';
  v_sala := (SELECT auth_employee_branch_id());

  RETURN QUERY
  SELECT b.branch_id::integer,
         a.abierta_el,
         m.id,
         o.id,
         o.folio,
         (-m.monto)::numeric
  FROM public.bolsas_movimientos m
  JOIN public.bolsas b             ON b.id = m.bolsa_id
  JOIN public.bolsas_operaciones o ON o.id = m.operacion_id
  JOIN LATERAL (
      SELECT ap.abierta_el
      FROM public.cortes_caja_aperturas ap
      WHERE ap.branch_id = b.branch_id AND ap.cerrada_at IS NULL
      ORDER BY ap.abierta_el DESC
      LIMIT 1
  ) a ON true
  WHERE m.anulado_at IS NULL
    AND o.anulada_at IS NULL
    AND m.caja_vale_id IS NULL
    AND m.monto < 0
    AND b.fecha = a.abierta_el
    AND (v_todo OR b.branch_id = v_sala);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.caja_vales_pendientes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.caja_vales_pendientes() TO authenticated, service_role;
