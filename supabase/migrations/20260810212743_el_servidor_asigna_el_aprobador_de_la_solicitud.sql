SET lock_timeout = '5s';

-- Una solicitud sin aprobador no avisa a nadie, y quien la manda no siempre
-- puede saber a quién ponerle (2026-08-10).
--
-- El widget elegía al aprobador en el NAVEGADOR: recorría la lista de empleados
-- del store buscando el cargo «Supervisor/a de Ventas». Pero esa lista sale de
-- `staff_list`, y un cargo de sala no tiene ese permiso — Regente de Enfermería
-- lo tiene en `can_view = false`. Así que la lista llegaba vacía, no encontraba
-- a nadie, y la solicitud nacía con `approver_id = NULL` y la nota «Sin
-- supervisión asignada».
--
-- Y `notificar_solicitud_creada` empieza con:
--     IF NEW.status <> 'PENDING' OR NEW.approver_id IS NULL ... RETURN NEW
-- o sea que sin aprobador NO hay aviso. La solicitud quedaba en la base, viva y
-- sin que nadie se enterara. Pasó con el descarte de las 21:18 del 10-ago.
--
-- Quién aprueba no puede depender de lo que el navegador de quien pide alcance
-- a leer: es una decisión del negocio y se resuelve en el servidor, que ve a
-- todos los empleados. La regla es la misma que tenía el widget.
--
-- Nota: la ausencia (vacaciones/incapacidad) no se filtra acá porque hoy no hay
-- de dónde: `employees` no tiene la columna y `employee_events` está
-- prácticamente vacía. Cuando ese dato exista, el filtro va en esta función.
CREATE OR REPLACE FUNCTION public.asignar_aprobador_solicitud()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ap    uuid;
  v_nom   text;
  -- Los tipos que crean los dos widgets que elegían al aprobador del lado del
  -- navegador. El resto de las solicitudes ya llega con el suyo.
  v_tipos text[] := ARRAY['INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                          'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST',
                          'VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST'];
BEGIN
  IF NEW.approver_id IS NOT NULL OR NOT (NEW.type = ANY (v_tipos)) THEN
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
      AND upper(coalesce(e.system_role, '')) IN ('ADMIN','SUPERADMIN')
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
$$;

COMMENT ON FUNCTION public.asignar_aprobador_solicitud() IS
  'Pone el aprobador cuando la solicitud llega sin él: quien pide no siempre puede leer la lista de empleados para elegirlo.';

-- BEFORE INSERT, y por eso funciona: `trg_notificar_solicitud_creada` es AFTER
-- INSERT, así que ve el `approver_id` ya puesto y manda el aviso.
DROP TRIGGER IF EXISTS trg_asignar_aprobador_solicitud ON public.approval_requests;
CREATE TRIGGER trg_asignar_aprobador_solicitud
  BEFORE INSERT ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.asignar_aprobador_solicitud();

-- ── Las que ya están pendientes y quedaron sin aprobador ────────────────────
-- Se les asigna igual y se les manda el aviso que nunca salió. El aviso se
-- arma acá y no se re-dispara el trigger porque ese es de INSERT: la fila ya
-- existe y no se va a borrar y volver a crear para mandar un mensaje.
DO $backfill$
DECLARE
  s        record;
  v_ap     uuid;
  v_nom    text;
  v_quien  text;
  v_etiq   text;
  v_n      int := 0;
BEGIN
  FOR s IN
    SELECT * FROM public.approval_requests
    WHERE status = 'PENDING' AND approver_id IS NULL
      AND type IN ('INVENTORY_LOAD_REQUEST','INVENTORY_DISCARD_REQUEST',
                   'ANNULMENT_REQUEST','PAYMENT_CHANGE_REQUEST',
                   'VENDOR_CHANGE_REQUEST','CLIENT_CHANGE_REQUEST')
  LOOP
    SELECT e.id, e.name INTO v_ap, v_nom
    FROM public.employees e JOIN public.roles r ON r.id = e.role_id
    WHERE e.status='ACTIVO' AND r.name ILIKE 'Supervisor%Ventas%' AND e.id <> s.employee_id
    ORDER BY e.name LIMIT 1;

    IF v_ap IS NULL THEN
      SELECT e.id, e.name INTO v_ap, v_nom FROM public.employees e
      WHERE e.status='ACTIVO' AND upper(coalesce(e.system_role,'')) IN ('ADMIN','SUPERADMIN')
        AND e.id <> s.employee_id ORDER BY e.name LIMIT 1;
    END IF;
    CONTINUE WHEN v_ap IS NULL;

    SELECT name INTO v_quien FROM public.employees WHERE id = s.employee_id;
    v_etiq := CASE s.type
      WHEN 'INVENTORY_LOAD_REQUEST'    THEN 'Carga de Inventario'
      WHEN 'INVENTORY_DISCARD_REQUEST' THEN 'Descarte de Inventario'
      WHEN 'ANNULMENT_REQUEST'         THEN 'Anulación de Factura'
      WHEN 'PAYMENT_CHANGE_REQUEST'    THEN 'Cambio de Forma de Pago'
      WHEN 'VENDOR_CHANGE_REQUEST'     THEN 'Cambio de Vendedor'
      ELSE 'Cambio de Cliente' END;

    UPDATE public.approval_requests
       SET approver_id = v_ap,
           metadata = coalesce(metadata,'{}'::jsonb)
                      || jsonb_build_object('notified_employee_id', v_ap,
                                            'notified_employee',    v_nom)
     WHERE id = s.id;

    -- Mismo `type` y misma clave que usa `marcar_notificacion_solicitud_resuelta`
    -- para tacharla cuando se resuelva.
    PERFORM public.notify_employees(
      ARRAY[v_ap],
      'REQUEST_PENDING',
      v_etiq || ' · pendiente',
      coalesce(v_quien, 'Un empleado') || ' envió una solicitud que espera tu confirmación.',
      '/requests',
      jsonb_build_object('request_id', s.id::text, 'tipo', s.type),
      true,
      nullif(s.metadata->>'branch_id','')::integer
    );
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'Solicitudes rescatadas: %', v_n;
END
$backfill$;
