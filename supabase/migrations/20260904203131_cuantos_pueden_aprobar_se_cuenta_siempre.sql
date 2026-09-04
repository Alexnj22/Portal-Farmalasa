SET lock_timeout = '5s';

/* ── Cuántos pueden aprobar: se cuenta SIEMPRE, no sólo cuando el servidor
 *    elige el destinatario ────────────────────────────────────────────────
 *
 * Reportado el 2026-09-04: *«si varios tienen activados el de confirmar este
 * tipo de solicitud, ¿por qué siempre dice edwin y no administración?»* — sobre
 * una anulación de factura que en producción pueden resolver CUATRO personas.
 *
 * Es la otra mitad del arreglo del 3-sep, y no había alcanzado por dos motivos
 * que se tapaban entre sí:
 *
 *  1. **El conteo vivía DENTRO de la rama del dinero.** Arriba de todo hay un
 *     `IF NEW.approver_id IS NOT NULL THEN RETURN NEW`, y los dos widgets que
 *     crean estas solicitudes **sí eligen destinatario en el navegador**
 *     (`findTargetEmployee`, por `role_id = 13`). O sea que para las seis de
 *     facturación e inventario el trigger salía por esa puerta antes de contar
 *     nada: `aprobadores_n` venía `null` en las 10 filas más recientes.
 *
 *     Y son dos preguntas distintas: **a quién se le avisa** y **cuántos pueden
 *     decidir**. La primera puede venir resuelta del navegador; la segunda no
 *     —`puede_aprobar_modulo` mira permisos que la pantalla no lee— y no deja
 *     de tener respuesta porque la primera ya la tenga. Por eso el conteo sube
 *     ANTES del corte y no dentro de una rama.
 *
 *  2. **La rama de respaldo elegía por NOMBRE DE CARGO, no por permiso**
 *     (`r.name ILIKE 'Supervisor%Ventas%'`). Ese cargo lo tiene una sola
 *     persona, así que cuando el trigger sí llegaba a elegir, elegía siempre el
 *     mismo nombre — y podía nombrar a alguien que ni siquiera tuviera el
 *     permiso. Ahora se prefiere a esa supervisión **si además puede
 *     resolverla**, y si no, a cualquiera que pueda; la administración por
 *     rango queda de último recurso, para cuando nadie tiene el módulo.
 *
 * El alcance sale de `modulo_de_aprobacion()`, que devuelve NULL para todo lo
 * demás: así se cuenta exactamente en los nueve tipos que se deciden por
 * permiso y en ninguno más. Una solicitud personal —vacaciones, anticipo— la
 * resuelve una jefatura concreta y ahí el nombre ES el dato.
 *
 * `aprobadores_n = 0` se escribe tal cual y no se disimula: significa que
 * cuando se creó la solicitud NADIE tenía el permiso, y la pantalla entonces
 * nombra al destinatario de respaldo, que es lo útil («andá a buscar a esta
 * persona»). Es el retrato del momento, como el resto de la metadata: si mañana
 * cambia el reparto de permisos, una solicitud vieja sigue diciendo lo que era
 * cierto al crearse.
 */

CREATE OR REPLACE FUNCTION public.asignar_aprobador_solicitud()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ap    uuid;
  v_nom   text;
  v_mod   text;
  v_n     integer;
  -- Los tipos que crean los dos widgets que eligen al aprobador del lado del
  -- navegador. El resto de las solicitudes ya llega con el suyo.
  v_tipos text[] := ARRAY['INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                          'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST',
                          'VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST'];
  -- Las tres del dinero. Van por su PERMISO y no por el nombre de un cargo.
  v_del_dinero text[] := ARRAY['CAJA_MOVIMIENTO_CHANGE','ABONO_CREDITO_CHANGE',
                               'ABONO_APROBACION'];
BEGIN
  v_mod := public.modulo_de_aprobacion(NEW.type);

  /* ── Cuántos pueden resolverla ────────────────────────────────────────
   * Antes que nada, porque la respuesta no depende de si el destinatario ya
   * viene elegido. Sin esto, las seis que lo traen del navegador nunca
   * llegaban a contarse y la pantalla nombraba a una persona sobre algo que
   * podían resolver cuatro. */
  IF v_mod IS NOT NULL THEN
    SELECT count(*)::integer INTO v_n
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod);

    NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
                    || jsonb_build_object('aprobadores_n', v_n);
  END IF;

  IF NEW.approver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = ANY (v_del_dinero) THEN
    /* Se elige de la MISMA lista que se acaba de contar: dos consultas sobre
     * la misma pregunta es cómo el número y el nombre terminan diciendo cosas
     * distintas. */
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod)
    ORDER BY e.name
    LIMIT 1;

    IF v_ap IS NULL THEN
      RETURN NEW;   -- nadie con ese permiso; queda como estaba
    END IF;

    NEW.approver_id := v_ap;
    NEW.metadata := NEW.metadata
                    || jsonb_build_object('notified_employee_id', v_ap,
                                          'notified_employee',    v_nom);
    RETURN NEW;
  END IF;

  IF NOT (NEW.type = ANY (v_tipos)) THEN
    RETURN NEW;
  END IF;

  -- 1 · Supervisión de Ventas, **si además puede resolverla**. Es la preferida
  --     —es quien lo resuelve todos los días— pero avisarle a quien no tiene el
  --     permiso es dejar la solicitud esperando a alguien que no puede tocarla.
  SELECT e.id, e.name INTO v_ap, v_nom
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id
  WHERE e.status = 'ACTIVO'
    AND r.name ILIKE 'Supervisor%Ventas%'
    AND e.id <> NEW.employee_id
    AND public.puede_aprobar_modulo(e.id, v_mod)
  ORDER BY e.name
  LIMIT 1;

  -- 2 · Si no, cualquiera de los que SÍ tienen el permiso.
  IF v_ap IS NULL THEN
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod)
    ORDER BY e.name
    LIMIT 1;
  END IF;

  -- 3 · Nadie con el módulo: la administración del sistema, como último
  --     recurso. Acá `aprobadores_n` vale 0 y la pantalla nombra a esta
  --     persona, que es lo único accionable que queda.
  IF v_ap IS NULL THEN
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND public.rango_de_empleado(e.id) >= 4
      AND e.id <> NEW.employee_id
    ORDER BY e.name
    LIMIT 1;
  END IF;

  IF v_ap IS NULL THEN
    RETURN NEW;   -- de verdad no hay a quién; queda como estaba
  END IF;

  NEW.approver_id := v_ap;
  -- La nota que lee la pantalla decía «Sin supervisión asignada»: si el
  -- servidor sí encontró a alguien, tiene que decir quién.
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
                  || jsonb_build_object('notified_employee_id', v_ap,
                                        'notified_employee',    v_nom);
  RETURN NEW;
END;
$function$;
