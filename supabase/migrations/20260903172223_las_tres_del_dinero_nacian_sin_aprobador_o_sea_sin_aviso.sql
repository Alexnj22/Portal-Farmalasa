SET lock_timeout = '5s';

/* ── Las tres del dinero nacían SIN aprobador, o sea sin aviso ─────────────
 *
 * Encontrado el 2026-09-03 al revisar por qué una solicitud de abono no
 * generaba ninguna notificación. La cadena, y ninguna de las tres piezas da
 * error:
 *
 *  1. `operar-caja` y `creditos-erp` crean la solicitud SIN `approver_id` — no
 *     eligen a nadie a propósito: quien decide sale del permiso del módulo, no
 *     de un nombre escrito al crear.
 *  2. `asignar_aprobador_solicitud` sólo rellena ese hueco para SEIS tipos
 *     —los dos widgets de inventario y los cuatro de facturación—, que era la
 *     lista completa el día que se escribió.
 *  3. `notificar_solicitud_creada` sale por su primera línea cuando
 *     `approver_id IS NULL`.
 *
 * Resultado: la solicitud existía, quedaba PENDING, y **nadie recibía ni un
 * aviso**. Sólo aparecía entrando a la bandeja a mirar. Es el mismo modo de
 * falla de siempre — nada falla, y lo que no ocurre no deja rastro.
 *
 * ── Por qué se resuelve por PERMISO y no por cargo ─────────────────────────
 * La rama vieja busca «Supervisor de Ventas» por el nombre del cargo. Para
 * estas tres eso sería falso: quien decide un abono es quien tiene
 * `requests_cuentas_por_cobrar.can_approve`, y quien decide un movimiento de
 * caja, `requests_caja` — son módulos distintos a propósito («son dos públicos,
 * y con un solo interruptor dar uno regala el otro»). Se le pregunta a
 * `modulo_de_aprobacion(type)`, que es la MISMA función que usa la policy: si
 * mañana cambia el reparto, esto lo sigue solo.
 *
 * El `approver_id` acá es el PRIMER destinatario, no el dueño de la decisión:
 * `notificar_solicitud_creada` le avisa a todos los que pueden aprobar ese
 * módulo, y la policy deja decidir a cualquiera de ellos. Medido antes de
 * escribir esto: 4 personas con `requests_caja` y 4 con
 * `requests_cuentas_por_cobrar`.
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
  -- Los tipos que crean los dos widgets que elegían al aprobador del lado del
  -- navegador. El resto de las solicitudes ya llega con el suyo.
  v_tipos text[] := ARRAY['INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                          'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST',
                          'VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST'];
  -- Las tres del dinero. Van por su PERMISO y no por el nombre de un cargo:
  -- ver el encabezado de la migración.
  v_del_dinero text[] := ARRAY['CAJA_MOVIMIENTO_CHANGE','ABONO_CREDITO_CHANGE',
                               'ABONO_APROBACION'];
BEGIN
  IF NEW.approver_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = ANY (v_del_dinero) THEN
    v_mod := public.modulo_de_aprobacion(NEW.type);

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
    NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
                    || jsonb_build_object('notified_employee_id', v_ap,
                                          'notified_employee',    v_nom);
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
