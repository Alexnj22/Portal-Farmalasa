SET lock_timeout = '5s';

-- Novena tanda de tarjetas de la campana (usuario, 24-sep: «continuemos»):
-- las metas por aprobar llevan la meta de cada sala contra la del mes anterior,
-- el total y quién las confirmó. `metas_notificar_rol` gana una variante con
-- `metadata`; la de cuatro argumentos la llama con '{}'.

CREATE OR REPLACE FUNCTION public.metas_notificar_rol(p_role_name text, p_type text, p_title text, p_body text, p_metadata jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
-- La misma que la de cuatro argumentos, más el `metadata` que dibuja la
-- tarjeta de la campana (24-sep). La de cuatro llama a ésta con '{}': la
-- regla —a quién, refrescar el aviso sin leer en vez de duplicarlo, y el
-- teléfono— vive una sola vez.
DECLARE
  v_n integer;
  v_ids uuid[];
BEGIN
  WITH destinatarios AS (
    SELECT e.id FROM public.employees e
    JOIN public.roles r ON r.name = p_role_name
    WHERE (e.role_id = r.id OR e.secondary_role_id = r.id)
      AND e.status = 'ACTIVO'
  ),
  refrescados AS (
    UPDATE public.notifications n
    SET body = p_body, metadata = coalesce(p_metadata, '{}'::jsonb), created_at = now()
    WHERE n.recipient_id IN (SELECT d.id FROM destinatarios d)
      AND n.type = p_type AND n.title = p_title AND n.read_at IS NULL
    RETURNING n.id, n.recipient_id
  ),
  nuevos AS (
    INSERT INTO public.notifications (recipient_id, type, title, body, link, metadata)
    SELECT d.id, p_type, p_title, p_body, '/metas?tab=confirmacion', coalesce(p_metadata, '{}'::jsonb)
    FROM destinatarios d
    WHERE d.id NOT IN (SELECT r.recipient_id FROM refrescados r)
    RETURNING id, recipient_id
  )
  SELECT (SELECT count(*) FROM refrescados) + (SELECT count(*) FROM nuevos),
         (SELECT array_agg(id) FROM (SELECT id FROM refrescados UNION ALL SELECT id FROM nuevos) x)
    INTO v_n, v_ids;

  -- También al teléfono (2026-09-23), incluido el aviso que se refresca.
  PERFORM public.push_de_notificaciones(v_ids);

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.metas_notificar_rol(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metas_notificar_rol(text, text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.metas_notificar_rol(p_role_name text, p_type text, p_title text, p_body text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.metas_notificar_rol(p_role_name, p_type, p_title, p_body, '{}'::jsonb);
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_meta_supervisor(p_id bigint, p_monto numeric DEFAULT NULL::numeric, p_nota text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.metas_sucursal%ROWTYPE;
  v_pendientes integer;
  v_meta       jsonb;
  v_mes        text;
BEGIN
  IF NOT auth_has_module_permission('metas', 'can_edit') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere edición en Metas';
  END IF;
  SELECT * INTO v_row FROM public.metas_sucursal WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'META_NO_EXISTE'; END IF;
  IF v_row.estado NOT IN ('propuesta', 'devuelta') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: la meta está en %', v_row.estado;
  END IF;
  IF p_monto IS NOT NULL AND p_monto <= 0 THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;

  -- El monto que llega del navegador es la BASE de venta: la recuperación de
  -- gastos no se confirma ni se ajusta, se arrastra.
  UPDATE public.metas_sucursal
  SET monto_base     = COALESCE(p_monto, monto_base),
      monto_meta     = COALESCE(p_monto, monto_base) + monto_recuperacion,
      nota           = COALESCE(p_nota, nota),
      estado         = 'confirmada_supervisor',
      supervisor_por = public.auth_employee_id(),
      supervisor_at  = now()
  WHERE id = p_id;

  PERFORM public.metas_log(p_id, 'confirmada', v_row.estado, 'confirmada_supervisor',
    v_row.monto_base, COALESCE(p_monto, v_row.monto_base), p_nota);

  SELECT count(*) INTO v_pendientes FROM public.metas_sucursal
  WHERE year_month = v_row.year_month AND estado IN ('propuesta', 'devuelta');
  IF v_pendientes = 0 THEN
    v_mes := public.metas_mes_label(v_row.year_month);

    -- Lo que dibuja la tarjeta (24-sep): la meta de cada sala contra la del
    -- mes anterior, el total, y quién las confirmó.
    SELECT jsonb_strip_nulls(jsonb_build_object(
             'mes',      v_mes,
             'total',    sum(m.monto_meta),
             'anterior', sum(a.monto_meta),
             'salas',    jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'sala', b.name, 'meta', m.monto_meta, 'anterior', a.monto_meta))
                           ORDER BY b.name),
             'quien',      (SELECT e.name FROM public.employees e WHERE e.id = public.auth_employee_id()),
             'quien_id',   public.auth_employee_id(),
             'quien_foto', public.foto_de_empleado(public.auth_employee_id())))
      INTO v_meta
      FROM public.metas_sucursal m
      JOIN public.branches b ON b.id = m.branch_id
      LEFT JOIN public.metas_sucursal a
             ON a.branch_id = m.branch_id
            AND a.year_month = to_char((m.year_month || '-01')::date - interval '1 month', 'YYYY-MM')
     WHERE m.year_month = v_row.year_month;

    PERFORM public.metas_notificar_rol('Gerente General', 'METAS_POR_APROBAR',
      'Metas de ' || v_mes || ' por aprobar',
      'Las metas de ' || v_mes || ' están confirmadas y esperan tu aprobación.',
      jsonb_build_object('metas', v_meta));
  END IF;
END;
$function$;
