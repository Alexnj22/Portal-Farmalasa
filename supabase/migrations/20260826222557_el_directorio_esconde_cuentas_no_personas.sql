-- Un empleado con cargo poderoso SIGUE siendo un empleado.
--
-- `employees_select` escondía toda ficha cuyo cargo tuviera `roles.is_su`. La
-- intención escrita era «un superusuario no figura en el directorio de
-- personal», y para la cuenta técnica es correcta. El problema es que `is_su`
-- mezcla DOS cosas distintas:
--
--   · «esta cuenta tiene poderes»       → `roles.is_su`
--   · «esta ficha no es una persona»    → `employees.tipo_ficha` (desde hoy)
--
-- Fusionadas, el portal escondía del maestro de personal a personas reales.
-- Hoy alcanza a «Supervisor/a de Ventas», así que el conteo de cabezas decía
-- **45 cuando en planilla hay 46**, y el usuario lo reportó en una línea: «yo
-- debo salir. soy empleado».
--
-- Y ya había costado antes, sin que se viera la causa común: la ficha «Aprobó»
-- de las solicitudes quedaba en «Sin registro», sin cara ni nombre — medido el
-- 2026-08-12 con la sesión de una vendedora, **8 de 8 solicitudes resueltas**—
-- porque el aprobador real del portal tiene uno de esos cargos. Se resolvió
-- construyendo una RPC SECURITY DEFINER y un segundo mapa de personas
-- (`personasDeSolicitudes`) para esquivar esta misma policy. O sea que la
-- fusión de los dos conceptos ya había pagado un rodeo entero.
--
-- Ahora se esconde por lo que la ficha ES, no por lo que su cargo PUEDE:
--
--   Administrador del Sistema  is_su + tecnica  → sigue oculto (la intención original)
--   EDWIN NUÑEZ                is_su + empleado → VISIBLE: es una persona en planilla
--   QA Testing                 tecnica          → visible, y se administra en /personal?tab=externos
--
-- El rodeo de `personasDeSolicitudes` NO se quita: sigue siendo el respaldo
-- correcto para cualquier ficha que el RLS esconda, y desarmarlo por este
-- cambio dejaría la ficha «Aprobó» a merced de la próxima policy.
--
-- `auth_employee_id()` queda envuelto en `(SELECT …)` — sin ese initplan Postgres
-- lo evalúa POR FILA (incidente 2026-07-08).
SET lock_timeout = '5s';

ALTER POLICY employees_select ON public.employees
  USING (
    NOT (
      COALESCE((SELECT r.is_su FROM public.roles r WHERE r.id = employees.role_id), false)
      AND employees.tipo_ficha = 'tecnica'
    )
    OR employees.id = (SELECT auth_employee_id())
  );
