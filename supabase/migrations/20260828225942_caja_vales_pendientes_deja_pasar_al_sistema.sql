-- La guarda de permiso tiene que dejar pasar al SISTEMA.
--
-- La migración anterior (20260828225910) exigía `caja_vales/can_view` a todo el
-- mundo, y con eso rompía a quien la llama con la llave de servicio: la edge
-- function que escribe los vales. Sin empleado detrás, `auth_has_module_permission`
-- contesta que no —correctamente— y la lista quedaba vacía para el único que
-- de verdad la necesita.
--
-- El corte es explícito y no por ausencia de ficha: se mira el rol del JWT. Si
-- fuera «no tiene empleado, entonces pasa», cualquier sesión cuya ficha no se
-- pudiera resolver entraría por la puerta de atrás — y ésa es una condición que
-- ya se sabe que pasa (33 de 42 personas entran con una cuenta ligada).
--
-- Verificado en los dos sentidos: sin permiso lanza FORBIDDEN, y con
-- `request.jwt.claims` en `service_role` devuelve las tres filas pendientes.

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
  v_sistema boolean;
  v_todo    boolean;
  v_sala    bigint;
BEGIN
  v_sistema := coalesce(
      current_setting('request.jwt.claims', true)::json ->> 'role', ''
  ) = 'service_role';

  IF NOT v_sistema AND NOT (SELECT auth_has_module_permission('caja_vales','can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Sin permiso para ver los vales de caja pendientes.';
  END IF;

  v_todo := v_sistema OR (SELECT auth_module_scope('caja_vales')) = 'ALL';
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
