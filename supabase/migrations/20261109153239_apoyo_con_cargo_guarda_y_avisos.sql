SET lock_timeout = '5s';

-- El apoyo con cargo: la guarda de quién lo asigna, y los avisos (2026-11-09).
--
-- `20261109151653` dejó que un apoyo diga qué cargo cubre. Medido en el entorno
-- de pruebas: un Supervisor/a de Ventas (rango 3) se asignó un apoyo propio como
-- Gerente General y quedó con ese cargo y rango 4. Editar novedades no puede ser
-- una forma de subir de cargo.
--
-- Regla, en la base para que no dependa de la pantalla: nadie se asigna un apoyo
-- con cargo a sí mismo, ni asigna un cargo de rango mayor que el propio. Sin
-- sesión (cron, service_role) no hay persona a quien comparar. Un apoyo cancelado
-- o reemplazado ya no da nada, así que cerrarlo no se frena.
CREATE OR REPLACE FUNCTION public.validar_cargo_de_apoyo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cargo text := NEW.metadata->>'coverRoleId';
  v_yo    uuid;
  v_rango integer;
BEGIN
  IF NEW.type <> 'SUPPORT' OR coalesce(v_cargo, '') = ''
     OR coalesce(NEW.metadata->>'status', '') IN ('CANCELLED', 'SUPERSEDED') THEN
    RETURN NEW;
  END IF;

  v_yo := public.auth_employee_id();
  IF v_yo IS NULL THEN RETURN NEW; END IF;

  IF v_yo = NEW.employee_id THEN
    RAISE EXCEPTION 'Un apoyo con cargo lo tiene que asignar otra persona.' USING ERRCODE = '42501';
  END IF;

  SELECT r.rango INTO v_rango FROM public.roles r WHERE r.id::text = v_cargo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese cargo no existe.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_rango, 0) > public.rango_de_empleado(v_yo) THEN
    RAISE EXCEPTION 'No puedes asignar un cargo de mayor rango que el tuyo.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validar_cargo_de_apoyo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_cargo_de_apoyo ON public.employee_events;
CREATE TRIGGER trg_validar_cargo_de_apoyo
  BEFORE INSERT OR UPDATE ON public.employee_events
  FOR EACH ROW EXECUTE FUNCTION public.validar_cargo_de_apoyo();

-- La jefatura y los avisos de sala siguen a la persona mientras dure el apoyo.
-- Se parte de la definición VIVA; si un fragmento no está, falla todo.
DO $do$
DECLARE
  c record;
  d text;
  sala constant text := 'coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint)';
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('public.es_jefe_de_sala(uuid,bigint)', 'JOIN public.roles r ON r.id = e.role_id',
     'JOIN public.roles r ON r.id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)'),
    ('public.es_jefe_de_sala(uuid,bigint)', 'AND e.branch_id = p_branch_id', 'AND ' || sala || ' = p_branch_id'),
    ('public.destinatarios_de_modulo(integer,text)', 'ON rp.role_id = e.role_id',
     'ON rp.role_id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)'),
    ('public.destinatarios_de_modulo(integer,text)', 'WHERE e.branch_id = p_branch_id', 'WHERE ' || sala || ' = p_branch_id'),
    ('public.destinatarios_de_reservas(bigint)', 'ON rp.role_id IN (e.role_id, e.secondary_role_id)',
     'ON rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.destinatarios_de_reservas(bigint)', 'AND (e.branch_id = p_branch_id', 'AND (' || sala || ' = p_branch_id'),
    ('public.notify_branch_como(uuid,integer,text,text,text,text,jsonb,boolean)', 'WHERE e.branch_id = p_branch_id', 'WHERE ' || sala || ' = p_branch_id'),
    ('public.notify_branch_como(uuid,integer,text,text,text,text,jsonb,boolean)', 'WHERE rp.role_id IN (e.role_id, e.secondary_role_id)',
     'WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.libro_lote_encargados(bigint)', 'r.id IN (e.role_id, e.secondary_role_id)', 'r.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.libro_lote_encargados(bigint)', 'AND e.branch_id = p_branch_id', 'AND ' || sala || ' = p_branch_id'),
    ('public.app_reservas_avisar_receta()', 'AND e.branch_id = NEW.branch_id', 'AND ' || sala || ' = NEW.branch_id'),
    ('public.app_reservas_avisar_receta()', 'rp.role_id IN (e.role_id, e.secondary_role_id)', 'rp.role_id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.app_encargos_avisar()', '(e.branch_id = NEW.branch_id', '(' || sala || ' = NEW.branch_id'),
    ('public.resolver_destinatarios_traslado(integer)', 'AND (e.branch_id = p_branch_id', 'AND (' || sala || ' = p_branch_id')
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
