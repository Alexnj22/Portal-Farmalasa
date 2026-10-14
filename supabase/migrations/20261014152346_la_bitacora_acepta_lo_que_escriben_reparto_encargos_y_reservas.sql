-- La bitácora rechazaba lo que escribían cinco funciones (2026-10-14).
--
-- audit_logs tiene dos CHECK y una FK que estas funciones no respetaban:
--   · source ∈ ADMIN_PANEL | KIOSK | SYSTEM   — mandaban 'portal'
--   · user_id → employees(id)                 — las del reparto mandaban
--     auth.uid(), el id de la CUENTA, que para la mayoría no es el de la ficha
-- Cualquiera de los tres lanzaba y la transacción deshacía la operación
-- entera: el reparto del acuse del Ministerio, responder un encargo, cambiar
-- el estado de una reserva y decidir su receta. La severidad en minúscula ya
-- se corrigió en 20261014151103.
--
-- Se reescribe desde la definición VIVA y se cambia sólo el literal; si un
-- patrón no aparece exactamente una vez, se aborta todo.
SET lock_timeout = '5s';

DO $$
DECLARE
  r     record;
  v_def text;
  n     int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.asignar_documento_a_empleados(uuid[], jsonb)',
     $q$SELECT auth.uid(), coalesce(q.name, 'sistema'), 'DOCUMENTO_COMPARTIDO_ASIGNADO'$q$,
     $q$SELECT v_quien, coalesce(q.name, 'sistema'), 'DOCUMENTO_COMPARTIDO_ASIGNADO'$q$),
    ('public.asignar_documento_a_empleados(uuid[], jsonb)',
     $q$'portal', 'INFO'$q$, $q$'ADMIN_PANEL', 'INFO'$q$),
    ('public.aplicar_documentos_pendientes(uuid)',
     $q$SELECT auth.uid(), coalesce(q.name, 'sistema'), 'DOCUMENTO_COMPARTIDO_APLICADO'$q$,
     $q$SELECT auth_employee_id(), coalesce(q.name, 'sistema'), 'DOCUMENTO_COMPARTIDO_APLICADO'$q$),
    ('public.aplicar_documentos_pendientes(uuid)',
     $q$'portal', 'INFO'$q$, $q$'ADMIN_PANEL', 'INFO'$q$),
    ('public.encargo_responder(bigint, text, numeric, date, text)',
     $q$e.branch_id, 'portal');$q$, $q$e.branch_id, 'ADMIN_PANEL');$q$),
    ('public.reserva_cambiar_estado(bigint, text, text)',
     $q$r.branch_id, 'portal');$q$, $q$r.branch_id, 'ADMIN_PANEL');$q$),
    ('public.reserva_receta_decidir(bigint, text, text)',
     $q$r.branch_id, 'portal');$q$, $q$r.branch_id, 'ADMIN_PANEL');$q$)
  ) t(fn, viejo, nuevo)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    n := (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo);
    IF n <> 1 THEN
      RAISE EXCEPTION 'En % el patrón «%» aparece % veces', r.fn, r.viejo, n;
    END IF;
    EXECUTE replace(v_def, r.viejo, r.nuevo);
  END LOOP;
END;
$$;
