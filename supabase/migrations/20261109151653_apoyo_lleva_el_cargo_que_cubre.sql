SET lock_timeout = '5s';

-- El apoyo temporal lleva el CARGO que cubre (2026-11-09).
--
-- Fernando Oliva (Bodega) apoya en Salud 4 por tramos. Hasta hoy el cargo de
-- Regente era su `secondary_role_id`, que vale TODOS los días y se SUMA al de
-- Bodega: en Bodega conservaba 30 módulos de Regente y en Salud 4 conservaba
-- Pedidos de toda la red. Decisión del usuario: en los días del apoyo tiene SÓLO
-- los permisos del cargo que cubre; los demás días, sólo los de su ficha.
--
-- El dato es `metadata.coverRoleId` del evento SUPPORT. Sin esa clave el apoyo
-- mueve la sala y no toca los permisos, que es lo que hacía hasta hoy. Un cargo
-- SU nunca se cubre por esta vía: la falla segura es que no cambie nada.

-- Una sola definición de «el apoyo de ese día»: la sala y el cargo salen del
-- MISMO evento.
CREATE OR REPLACE FUNCTION public.apoyo_vigente(
    p_employee_id uuid,
    p_dia date DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date)
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT ev.metadata
      FROM public.employee_events ev
     WHERE ev.employee_id = p_employee_id
       AND ev.type = 'SUPPORT'
       AND coalesce(ev.metadata->>'status', '') NOT IN ('CANCELLED', 'SUPERSEDED')
       AND coalesce(ev.metadata->>'targetBranchId', '') ~ '^[0-9]+$'
       AND CASE
             WHEN jsonb_typeof(ev.metadata->'supportRanges') = 'array'
              AND jsonb_array_length(ev.metadata->'supportRanges') > 0
             THEN EXISTS (
                    SELECT 1 FROM jsonb_array_elements(ev.metadata->'supportRanges') r
                     WHERE coalesce(r->>'start', '') ~ '^\d{4}-\d{2}-\d{2}$'
                       AND coalesce(r->>'end',   '') ~ '^\d{4}-\d{2}-\d{2}$'
                       AND (r->>'start')::date <= p_dia
                       AND (r->>'end')::date   >= p_dia)
             ELSE ev.date <= p_dia
              AND (CASE WHEN coalesce(ev.metadata->>'endDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
                        THEN (ev.metadata->>'endDate')::date ELSE ev.date END) >= p_dia
           END
     ORDER BY ev.date DESC, ev.created_at DESC
     LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.apoyo_vigente(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apoyo_vigente(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.sala_de_apoyo_vigente(
    p_employee_id uuid,
    p_dia date DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date)
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT (public.apoyo_vigente(p_employee_id, p_dia)->>'targetBranchId')::integer;
$$;

CREATE OR REPLACE FUNCTION public.cargo_de_apoyo_vigente(
    p_employee_id uuid,
    p_dia date DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date)
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT r.id::integer
      FROM public.roles r
     WHERE NOT coalesce(r.is_su, false)
       AND r.id::text = public.apoyo_vigente(p_employee_id, p_dia)->>'coverRoleId';
$$;
REVOKE EXECUTE ON FUNCTION public.cargo_de_apoyo_vigente(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cargo_de_apoyo_vigente(uuid, date) TO authenticated, service_role;

-- Los cargos que valen HOY para esa persona: el del apoyo y ninguno más, o los
-- dos de su ficha.
CREATE OR REPLACE FUNCTION public.roles_efectivos_de(
    p_employee_id uuid,
    p_dia date DEFAULT ((now() AT TIME ZONE 'America/El_Salvador')::date)
)
RETURNS integer[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT coalesce(
             (SELECT ARRAY[c] FROM public.cargo_de_apoyo_vigente(p_employee_id, p_dia) c WHERE c IS NOT NULL),
             array_remove(ARRAY[e.role_id::integer, e.secondary_role_id::integer], NULL))
      FROM public.employees e
     WHERE e.id = p_employee_id;
$$;
REVOKE EXECUTE ON FUNCTION public.roles_efectivos_de(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.roles_efectivos_de(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auth_employee_role_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id) FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_employee_secondary_role_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN public.cargo_de_apoyo_vigente(e.id) IS NOT NULL THEN NULL
              ELSE e.secondary_role_id END
    FROM public.employees e
  WHERE e.id = (select auth.uid())
     OR e.id = (SELECT l.employee_id FROM public.employee_auth_accounts l
                 WHERE l.auth_user_id = (select auth.uid()))
  ORDER BY (e.id = (select auth.uid())) DESC
  LIMIT 1;
$$;

-- Las que decidían con la ficha. Se parte de la definición VIVA y se cambia sólo
-- el fragmento; si un fragmento no está, la migración entera falla.
DO $do$
DECLARE
  c record;
  d text;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('public.cancelar_envio(uuid,text)', 'SELECT branch_id INTO v_mi FROM public.employees WHERE id = v_yo;',
     'SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_mi FROM public.employees WHERE id = v_yo;'),
    ('public.cancelar_envio(uuid,text)', 'rp.role_id IN (e.role_id, e.secondary_role_id)',
     'rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.cerrar_faltante(uuid,text,text)', 'SELECT branch_id INTO v_sala FROM public.employees WHERE id = v_yo;',
     'SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_sala FROM public.employees WHERE id = v_yo;'),
    ('public.declarar_faltante_tardio(uuid,jsonb)', 'SELECT branch_id INTO v_sala FROM public.employees WHERE id = v_yo;',
     'SELECT coalesce(public.sala_de_apoyo_vigente(id), branch_id) INTO v_sala FROM public.employees WHERE id = v_yo;'),
    ('public.datos_pedidos_de_mi_sala()', 'SELECT e.branch_id INTO v_branch',
     'SELECT coalesce(public.sala_de_apoyo_vigente(e.id), e.branch_id) INTO v_branch'),
    ('public.puede_entregar_de(uuid,bigint)', '( e.branch_id = p_branch_id',
     '( coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = p_branch_id'),
    ('public.empleado_sala_de_hoy(uuid,date)', 'RETURN (SELECT e.branch_id FROM public.employees e WHERE e.id = v_emp);',
     'RETURN (SELECT coalesce(public.sala_de_apoyo_vigente(e.id, p_fecha), e.branch_id) FROM public.employees e WHERE e.id = v_emp);'),
    ('public.puede_aprobar_modulo(uuid,text)', 'WHERE rp.role_id = e.role_id', 'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.puede_aprobar_modulo(uuid,text)', 'WHERE rp.role_id = e.secondary_role_id', 'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.puede_confirmar_traslado(uuid)', 'WHERE rp.role_id = e.role_id', 'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.puede_confirmar_traslado(uuid)', 'WHERE rp.role_id = e.secondary_role_id', 'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.puede_enviar_producto(uuid)', 'WHERE rp.role_id = e.role_id', 'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.puede_enviar_producto(uuid)', 'WHERE rp.role_id = e.secondary_role_id', 'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.rango_de_empleado(uuid)', 'r.id IN (e.role_id, e.secondary_role_id)', 'r.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.inyeccion_confirma_enfermeria_sola()', 'ON rp.role_id = e.role_id', 'ON rp.role_id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)'),
    ('public.preventa_preparar(uuid,bigint[])', 'rp.role_id IN (e.role_id, e.secondary_role_id)', 'rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.preventa_preparar(uuid,bigint[])', 'OR e.branch_id = v_branch)', 'OR coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = v_branch)')
  ) AS t(firma, viejo, nuevo)
  LOOP
    d := pg_get_functiondef(c.firma::regprocedure);
    IF position(c.viejo IN d) = 0 THEN
      RAISE EXCEPTION 'No encontré el fragmento en %: %', c.firma, c.viejo;
    END IF;
    EXECUTE replace(d, c.viejo, c.nuevo);
  END LOOP;
END;
$do$;
