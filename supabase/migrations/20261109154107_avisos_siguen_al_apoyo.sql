SET lock_timeout = '5s';

-- Los avisos que faltaban siguen al cargo y la sala del apoyo (2026-11-09).
--
-- `20261109153239` cubrió los avisos generales de sala. Estos otros seguían
-- leyendo la ficha, así que quien cubre una sala no los recibía esos días y
-- quien se fue de apoyo los seguía recibiendo de la suya. Se dejan fuera
-- `metas_avisar_cierre_a_admin` (cruza vendedor con su sala de ventas) y
-- `notify_missing_roster` (cuenta plantilla, no elige destinatarios).
-- Se parte de la definición VIVA; si un fragmento no está, falla todo.
DO $do$
DECLARE
  c record;
  d text;
  sala constant text := 'coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint)';
  dos  constant text := 'rp.role_id = ANY (public.roles_efectivos_de(e.id))';
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('public.audiencia_de_aviso(text,jsonb)', 'e.branch_id::text = ANY (v_vals)', sala || '::text = ANY (v_vals)'),
    ('public.audiencia_de_aviso(text,jsonb)', 'JOIN public.roles r ON r.id = e.role_id', 'JOIN public.roles r ON r.id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)'),
    ('public.avisar_diferencias_pendientes_a_jefes(uuid[])', 'JOIN public.roles r ON r.id = e.role_id', 'JOIN public.roles r ON r.id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)'),
    ('public.avisar_diferencias_pendientes_a_jefes(uuid[])', 'AND e.branch_id = v_s.branch_id', 'AND ' || sala || ' = v_s.branch_id'),
    ('public.avisar_diferencias_vencidas()', 'AND e.branch_id = v_bodega', 'AND ' || sala || ' = v_bodega'),
    ('public.avisar_diferencias_vencidas()', 'AND e.branch_id = r.sala_branch', 'AND ' || sala || ' = r.sala_branch'),
    ('public.avisar_facturas_descuadradas()', '(e.role_id = ro.id OR e.secondary_role_id = ro.id)', 'ro.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.avisar_facturas_descuadradas()', 'WHERE e.branch_id = r.branch_id AND', 'WHERE ' || sala || ' = r.branch_id AND'),
    ('public.avisar_productos_sin_venta(uuid)', 'JOIN public.roles r ON r.id = e.role_id', 'JOIN public.roles r ON r.id = coalesce(public.cargo_de_apoyo_vigente(e.id), e.role_id)'),
    ('public.avisar_productos_sin_venta(uuid)', 'WHERE e.branch_id = (s->>''branch'')::int', 'WHERE ' || sala || ' = (s->>''branch'')::int'),
    ('public.avisar_sala_lista_para_salir()', 'rp.role_id IN (e.role_id, e.secondary_role_id)', dos),
    ('public.avisar_sala_lista_para_salir()', 'AND e.branch_id = v_bod', 'AND ' || sala || ' = v_bod'),
    ('public.chat_vigilar_espera()', 'rp.role_id IN (e.role_id, e.secondary_role_id)', dos),
    ('public.chat_vigilar_espera()', 'AND e.branch_id = r.sala_id', 'AND ' || sala || ' = r.sala_id'),
    ('public.encuesta_cliente_avisar_detractor()', 'r.id IN (e.role_id, e.secondary_role_id)', 'r.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.encuesta_cliente_avisar_detractor()', 'AND e.branch_id = NEW.branch_id)', 'AND ' || sala || ' = NEW.branch_id)'),
    ('public.avisar_cierre_del_dia(date,boolean)', '(e.role_id = r.id OR e.secondary_role_id = r.id)', 'r.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.alertar_barrido_dte()', '(e.role_id = r.id OR e.secondary_role_id = r.id)', 'r.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.avisar_pedidos_sin_recibir()', 'ro.id IN (e.role_id, e.secondary_role_id)', 'ro.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.vigilar_servicios()', 'ro.id IN (e.role_id, e.secondary_role_id)', 'ro.id = ANY (public.roles_efectivos_de(e.id))'),
    ('public.avisar_rechazos_sin_arreglo()', 'rp.role_id IN (e.role_id, e.secondary_role_id)', dos),
    ('public.avisar_ventas_sin_sello(boolean,integer)', 'rp.role_id IN (e.role_id, e.secondary_role_id)', dos)
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
