SET lock_timeout = '5s';

/* La firma de una decisión sale de la BASE, nunca del navegador ni de lo que
 * quedó escrito al crear la solicitud.
 *
 * `asignar_aprobador_solicitud` escribe `approver_id` al INSERTAR con el PRIMER
 * destinatario de la lista — o sea, uno cualquiera de los seis a quienes les
 * llega el aviso. Mientras la solicitud está pendiente eso es correcto: es a
 * quién se enrutó. En cuanto se decide deja de serlo, y ahí cada camino tenía
 * que acordarse de pisarlo con quien decidió de verdad:
 *
 *   - `rejectRequest` (el genérico) lo pisaba.
 *   - `aplicar-traslado-inventario` y las otras Edge Functions lo pisan.
 *   - `rechazarTraslado` —un UPDATE desde el navegador— NO lo pisaba.
 *
 * Resultado medido el 2026-08-26 sobre los 12 rechazos de traslado: en TODOS
 * `approver_id` es `metadata.destinatarios[0]`. La tarjeta decía «RECHAZÓ Cendy
 * Quintanilla» sobre un rechazo que hizo Josué Guevara, y el aviso que le llega
 * a quien pidió sale con el mismo nombre equivocado (`notificar_resolucion_
 * traslado` usa `NEW.approver_id` como `created_by`).
 *
 * No falló nada: el campo estaba lleno, con un uuid válido, de una persona real
 * que además tenía permiso. Por eso vivió desde el día uno.
 *
 * La corrección no es agregar la línea que falta en ese camino: es que la firma
 * no dependa de que cada camino se acuerde. Sale de `auth_employee_id()`, que
 * es la MISMA cuenta que usan las policies para decidir si esa persona podía.
 *
 * Sólo en la transición PENDING → APPROVED/REJECTED:
 *   - CANCELLED queda afuera: retirar la propia solicitud no es una decisión, y
 *     firmarla con quien la retiró diría que alguien la aprobó.
 *   - Un `current_level` que avanza y deja el estado en PENDING tampoco: ahí
 *     `approver_id` vuelve a ser «a quién le toca ahora».
 *
 * Y si no hay empleado autenticado —service_role, o sea las Edge Functions— no
 * se toca: esas ya resuelven al actor desde su JWT y lo escriben ellas. Pisarlo
 * con NULL borraría la única firma buena que hay.
 */
CREATE OR REPLACE FUNCTION public.firmar_quien_decide()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
    v_yo uuid;
BEGIN
    v_yo := public.auth_employee_id();
    IF v_yo IS NULL THEN
        RETURN NEW;
    END IF;
    NEW.approver_id := v_yo;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.firmar_quien_decide() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_firmar_quien_decide ON public.approval_requests;

CREATE TRIGGER trg_firmar_quien_decide
BEFORE UPDATE OF status ON public.approval_requests
FOR EACH ROW
WHEN (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED'))
EXECUTE FUNCTION public.firmar_quien_decide();

COMMENT ON FUNCTION public.firmar_quien_decide() IS
'Al decidirse una solicitud, `approver_id` pasa a ser quien la decidió — resuelto por auth_employee_id(), no por lo que mande el cliente. Antes quedaba el primer destinatario del enrutado.';
