-- Los cobros de crédito del portal también se leen desde Efectivo.
--
-- La policy vieja pedía `caja_vales.can_view`, que es el permiso de OPERAR la
-- caja. Con eso, la pestaña «Movimientos» —que es la de MIRAR, y pide
-- `cortes_caja`— recibía cero filas para quien tiene uno y no el otro:
-- Contabilidad, que es exactamente quien entra a esa pestaña a rastrear el
-- dinero. Y una policy que niega no da error: la lista se pintaba completa
-- salvo por los cobros, sin nada que dijera que faltaban.
--
-- Los dos módulos, cada uno con SU alcance: quien ve una sola sala sigue
-- viendo una sola sala por cualquiera de las dos puertas.
--
-- `(SELECT auth_*())` en las cuatro llamadas, sin excepción: sin el initplan
-- Postgres las evalúa POR FILA (incidente 2026-07-08).

SET lock_timeout = '5s';

DROP POLICY IF EXISTS creditos_abonos_select ON public.creditos_abonos_portal;

CREATE POLICY creditos_abonos_select ON public.creditos_abonos_portal
  FOR SELECT TO authenticated
  USING (
    (
      (SELECT auth_has_module_permission('caja_vales', 'can_view'))
      AND (
        (SELECT auth_module_scope('caja_vales')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
    OR (
      (SELECT auth_has_module_permission('cortes_caja', 'can_view'))
      AND (
        (SELECT auth_module_scope('cortes_caja')) = 'ALL'
        OR branch_id = (SELECT auth_employee_branch_id())
      )
    )
  );

COMMENT ON TABLE public.creditos_abonos_portal IS
  'Cada cobro de crédito hecho DESDE el portal: quién, a quién, cuánto y con qué forma de pago. Es lo único que guarda esos cuatro datos — el sistema de origen anota el renglón «POR ABONO A CREDITO» sin ninguno de ellos, y los cobros que no son efectivo ni siquiera llegan a anotarse allá. Se lee con `caja_vales` (operar la caja) o con `cortes_caja` (mirarla), cada uno con su alcance.';
