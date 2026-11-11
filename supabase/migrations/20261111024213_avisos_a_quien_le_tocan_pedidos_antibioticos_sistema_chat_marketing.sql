-- Avisos a quien le tocan (2026-11-10, pedido del usuario).
--   · Pedido sin recibir: a las 6 h vuelve a la sala, no a supervisión.
--   · Antibióticos sin conteo del mes: uno por sala a la gente de esa sala;
--     a supervisión, UNO solo con todas.
--   · Avisos del sistema: a supervisión; si son de productos (cambio de
--     presentación, factor que no cuadra, conteo de existencia), también a Bodega.
--   · Chat de clientes: supervisión, no el resto de la administración.
--   · Recordatorios del calendario de marketing: sólo a marketing.
-- Se reemplaza sólo el fragmento, verificando que esté exactamente una vez.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.destinatarios_de_productos()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, extensions
AS $function$
  SELECT coalesce(array_agg(DISTINCT e.id), '{}')
    FROM public.employees e
   WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
     AND (13 = ANY (public.roles_efectivos_de(e.id))
          OR (EXISTS (SELECT 1 FROM public.branches b WHERE b.id = e.branch_id AND b.type = 'BODEGA')
              AND EXISTS (SELECT 1 FROM public.role_permissions rp
                           WHERE rp.role_id = ANY (public.roles_efectivos_de(e.id))
                             AND rp.module_key IN ('productos', 'inventario') AND rp.can_view)));
$function$;
REVOKE EXECUTE ON FUNCTION public.destinatarios_de_productos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.destinatarios_de_productos() TO service_role;

DO $do$
DECLARE r record; v_def text; v_hay int;
BEGIN
  FOR r IN
  SELECT * FROM (VALUES
    -- Pedido sin recibir: a las 6 h, otra vez la sala (no supervisión).
    ('public.avisar_pedidos_sin_recibir()'::regprocedure,
     $v$-- 6 h → supervisión.$v$,
     $v$-- 6 h → otra vez la sala (2026-11-10, usuario: «pedido sin recibir, sólo a la sala»).$v$, 1),
    ('public.avisar_pedidos_sin_recibir()'::regprocedure,
     $v$JOIN public.roles ro ON ro.id = ANY (public.roles_efectivos_de(e.id))
           WHERE ro.name IN ('Gerente General', 'Supervisor/a de Ventas')$v$,
     $v$WHERE coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = r.branch_id$v$, 1),
    -- Antibióticos: el mes vencido va a la gente de la sala; supervisión recibe UNO con todas.
    ('public.avisar_cuadre_antibioticos(date)'::regprocedure,
     $v$    v_n integer := 0; v_k integer;$v$,
     $v$    v_n integer := 0; v_k integer;
    v_salas text; v_cuantas integer; v_clave text;$v$, 1),
    ('public.avisar_cuadre_antibioticos(date)'::regprocedure,
     $v$        SELECT c.branch_id, e.id AS employee_id FROM casos c
          CROSS JOIN public.employees e
          JOIN public.roles r ON r.name IN ('Gerente General', 'Supervisor/a de Ventas')
         WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
           AND e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'$v$,
     $v$        -- La gente de la sala (2026-11-10); supervisión recibe uno solo, abajo.
        SELECT c.branch_id, e.id AS employee_id FROM casos c
          JOIN public.employees e ON e.branch_id = c.branch_id
         WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'$v$, 1),
    ('public.avisar_cuadre_antibioticos(date)'::regprocedure,
     $v$    SELECT count(*) INTO v_k FROM ins;
    RETURN v_n + v_k;$v$,
     $v$    SELECT count(*) INTO v_k FROM ins;
    v_n := v_n + v_k;

    -- Supervisión: UN aviso con todas las salas que quedaron sin conteo
    -- (2026-11-10, usuario: «a supervisión sólo 1 de todas»).
    SELECT string_agg(b.name, ', ' ORDER BY b.name), count(*) INTO v_salas, v_cuantas
      FROM public.branches b
     WHERE b.type IN ('FARMACIA', 'BODEGA')
       AND NOT EXISTS (SELECT 1 FROM public.conteos_inventario c
                        WHERE c.branch_id = b.id AND c.scope_type IN ('BAJO_RECETA', 'CICLICO')
                          AND c.status IN ('FINALIZADO', 'CERRADO')
                          AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date >= v_prev
                          AND (c.created_at AT TIME ZONE 'America/El_Salvador')::date < v_este);
    v_k := 0;
    IF coalesce(v_cuantas, 0) > 0 THEN
        v_clave := 'CUADRE_ABX:todas:' || to_char(v_prev, 'YYYY-MM') || ':vencido';
        WITH dest AS (
            SELECT e.id FROM public.employees e
             WHERE e.status = 'ACTIVO' AND coalesce(e.tipo_ficha, 'empleado') = 'empleado'
               AND 13 = ANY (public.roles_efectivos_de(e.id))
               AND NOT EXISTS (SELECT 1 FROM public.avisos_emitidos a
                                WHERE a.recipient_id = e.id AND a.clave = v_clave)
        ), ins AS (
            INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata)
            SELECT d.id, 'CUADRE_ANTIBIOTICOS',
                   CASE WHEN v_cuantas = 1
                        THEN v_salas || ': ' || v_mes[extract(month FROM v_prev)::int] || ' quedó sin conteo de antibióticos'
                        ELSE v_cuantas || ' salas quedaron sin conteo de antibióticos de ' || v_mes[extract(month FROM v_prev)::int] END,
                   'Sin conteo: ' || v_salas || '. La existencia de antibióticos de ese mes no quedó cuadrada contra el sistema.',
                   '/bitacoras',
                   jsonb_build_object('periodo', to_char(v_prev, 'YYYY-MM'), 'salas', v_salas, 'clase', 'vencido_resumen')
              FROM dest d
            RETURNING recipient_id
        ), marca AS (
            INSERT INTO public.avisos_emitidos (clave, recipient_id)
            SELECT v_clave, i.recipient_id FROM ins i ON CONFLICT DO NOTHING RETURNING 1
        )
        SELECT count(*) INTO v_k FROM ins;
    END IF;
    RETURN v_n + v_k;$v$, 1),
    -- Cambio de presentación y factor que no cuadra: supervisión y Bodega.
    ('public.procesar_cambios_de_factor()'::regprocedure,
     $v$public.get_minmax_approver_ids()$v$, $v$public.destinatarios_de_productos()$v$, 1),
    ('public.avisar_factores_sospechosos()'::regprocedure,
     $v$public.get_minmax_approver_ids()$v$, $v$public.destinatarios_de_productos()$v$, 1),
    -- Error en una factura: supervisión (y la sala, como ya estaba).
    ('public.avisar_facturas_descuadradas()'::regprocedure,
     $v$ro.name IN ('Gerente General', 'Supervisor/a de Ventas')$v$,
     $v$ro.name = 'Supervisor/a de Ventas'$v$, 1),
    -- Conteo de existencia / faltante: supervisión y quien lo pidió.
    ('public.consulta_existencia_avisar_resumen(uuid)'::regprocedure,
     $v$(e.role_id IN (11, 13) OR e.secondary_role_id IN (11, 13))$v$,
     $v$e.id = ANY (public.destinatarios_de_productos())$v$, 1),
    -- Chat de clientes: supervisión y quien atiende el chat, no el resto de la administración.
    ('public.app_chat_mensaje_nuevo()'::regprocedure,
     $v$rp.module_key = 'chat_clientes'$v$,
     $v$rp.module_key = 'chat_clientes' AND rp.role_id NOT IN (2, 3, 11)$v$, 1),
    ('public.chat_recordar_espera()'::regprocedure,
     $v$rp.module_key = 'chat_clientes'$v$,
     $v$rp.module_key = 'chat_clientes' AND rp.role_id NOT IN (2, 3, 11)$v$, 1),
    ('public.chat_vigilar_espera()'::regprocedure,
     $v$rp.module_key = 'chat_clientes'$v$,
     $v$rp.module_key = 'chat_clientes' AND rp.role_id NOT IN (2, 3, 11)$v$, 1),
    -- Recordatorios del calendario de marketing: sólo a marketing (Diseñador/a Gráfico/a, rol 38).
    ('public.marketing_recordatorios_diarios()'::regprocedure,
     $v$    v_editan  uuid[] := public.marketing_destinatarios('can_edit');
    v_aprueban uuid[] := public.marketing_destinatarios('can_approve');$v$,
     $v$    -- Los recordatorios del calendario van sólo a marketing (2026-11-10, usuario).
    v_editan  uuid[] := (SELECT coalesce(array_agg(x), '{}') FROM unnest(public.marketing_destinatarios('can_edit')) x
                          WHERE 38 = ANY (public.roles_efectivos_de(x)));
    v_aprueban uuid[] := '{}';$v$, 1)
  ) v(fn, viejo, nuevo, esperado)

  LOOP
    v_def := pg_get_functiondef(r.fn);
    v_hay := (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo);
    IF v_hay <> r.esperado THEN
      RAISE EXCEPTION '% : esperaba % y hay % de «%»', r.fn, r.esperado, v_hay, left(r.viejo, 60);
    END IF;
    EXECUTE replace(v_def, r.viejo, r.nuevo);
  END LOOP;
END $do$;
