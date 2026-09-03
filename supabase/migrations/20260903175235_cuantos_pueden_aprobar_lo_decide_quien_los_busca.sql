SET lock_timeout = '5s';

/* ── Cuántos pueden aprobar ────────────────────────────────────────────────
 *
 * Refinamiento del usuario (2026-09-03): *«así que sea cuando hay más de 1
 * persona que pueda aprobar, que diga el área»*.
 *
 * Tiene razón y es la mitad que faltaba: con CUATRO aprobadores, «Pendiente de
 * Carlos Renderos» se lee como que hay que esperarlo a él —y si está de
 * vacaciones, como que no hay a quién recurrir—. Pero con UNO solo, nombrarlo
 * es el dato útil: se sabe a quién ir a buscar.
 *
 * El navegador no puede contarlos: `puede_aprobar_modulo` mira permisos que la
 * pantalla no lee. Y una consulta aparte por cada solicitud sería una petición
 * por ficha abierta. Lo cuenta quien YA los está buscando —este trigger, que
 * recorre la misma lista para elegir al primer destinatario— y lo deja escrito.
 *
 * Es el retrato del momento, como el resto de la metadata. Si mañana cambia el
 * reparto de permisos, la ficha de una solicitud vieja seguirá diciendo lo que
 * era cierto cuando se creó — que es lo correcto para una ficha, y es lo mismo
 * que ya pasa con `notified_employee`.
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
  -- Los tipos que crean los dos widgets que elegían al aprobador del lado del
  -- navegador. El resto de las solicitudes ya llega con el suyo.
  v_tipos text[] := ARRAY['INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                          'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST',
                          'VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST'];
  -- Las tres del dinero. Van por su PERMISO y no por el nombre de un cargo.
  v_del_dinero text[] := ARRAY['CAJA_MOVIMIENTO_CHANGE','ABONO_CREDITO_CHANGE',
                               'ABONO_APROBACION'];
BEGIN
  IF NEW.approver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = ANY (v_del_dinero) THEN
    v_mod := public.modulo_de_aprobacion(NEW.type);

    /* Se cuentan Y se elige en la misma pasada: dos consultas sobre la misma
     * lista es cómo el número y el nombre terminan diciendo cosas distintas. */
    SELECT count(*)::integer,
           (array_agg(e.id ORDER BY e.name))[1],
           (array_agg(e.name ORDER BY e.name))[1]
      INTO v_n, v_ap, v_nom
    FROM public.employees e
    WHERE e.status = 'ACTIVO'
      AND e.id <> NEW.employee_id
      AND public.puede_aprobar_modulo(e.id, v_mod);

    IF v_ap IS NULL THEN
      RETURN NEW;   -- nadie con ese permiso; queda como estaba
    END IF;

    NEW.approver_id := v_ap;
    NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
                    || jsonb_build_object('notified_employee_id', v_ap,
                                          'notified_employee',    v_nom,
                                          -- Cuántos podían resolverla al crearse.
                                          -- Con uno solo la ficha lo nombra; con
                                          -- más, dice el área.
                                          'aprobadores_n',        v_n);
    RETURN NEW;
  END IF;

  IF NOT (NEW.type = ANY (v_tipos)) THEN
    RETURN NEW;
  END IF;

  -- 1 · Supervisión de Ventas, que es quien resuelve.
  SELECT e.id, e.name INTO v_ap, v_nom
  FROM public.employees e
  JOIN public.roles r ON r.id = e.role_id
  WHERE e.status = 'ACTIVO'
    AND r.name ILIKE 'Supervisor%Ventas%'
    AND e.id <> NEW.employee_id
  ORDER BY e.name
  LIMIT 1;

  -- 2 · Sin supervisión activa, la administración del sistema.
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
