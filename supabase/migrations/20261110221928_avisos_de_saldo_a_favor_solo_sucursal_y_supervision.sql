-- Los avisos de SALDO A FAVOR van a la sucursal y a supervisión, y a nadie
-- más (2026-11-10, usuario: «saldo a favor no le debe llegar a bodega, solo a
-- la sucursal y a supervisión»).
--
-- Hasta hoy salían por `destinatarios_de_reservas` (la sala + Bodega) o por
-- `reserva_avisar_sala`, que usa esa misma lista. Son cinco avisos:
--   · «El saldo a favor no se descontó»           (reservas_vigilar)
--   · «Saldo a favor: posible intento indebido»   (saldo_favor_buscar)
--   · «Devolución en efectivo autorizada»          (reserva_saldo_devolver)
--   · «Devolución en efectivo no autorizada»       (reserva_saldo_negar_devolucion)
-- (el vencimiento del saldo sólo se anota, no notifica). «Devolución en
-- efectivo por autorizar» no cambia: va a quien puede autorizarla.
--
-- El resto de cada función queda igual: se cambia SÓLO a quién se le avisa,
-- reemplazando la llamada sobre la definición viva. Cada reemplazo exige
-- encontrar exactamente lo esperado; si no, la migración falla entera.
SET lock_timeout = '5s';

-- La sucursal (quien la tiene o la cubre hoy, con permiso de Reservas) y
-- supervisión (Supervisor/a de Ventas, rol 13, también si lo cubre de apoyo).
CREATE OR REPLACE FUNCTION public.destinatarios_de_saldo_favor(p_branch_id bigint)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT array_agg(DISTINCT x.id) FROM (
    SELECT e.id
      FROM public.employees e
      JOIN public.role_permissions rp
        ON rp.role_id = ANY (public.roles_efectivos_de(e.id))
       AND rp.module_key = 'reservas'
       AND (rp.can_view OR rp.can_edit)
     WHERE e.status = 'ACTIVO'
       AND coalesce(public.sala_de_apoyo_vigente(e.id)::bigint, e.branch_id::bigint) = p_branch_id
    UNION
    SELECT e.id
      FROM public.employees e
     WHERE e.status = 'ACTIVO' AND 13 = ANY (public.roles_efectivos_de(e.id))
  ) x;
$function$;
REVOKE EXECUTE ON FUNCTION public.destinatarios_de_saldo_favor(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.destinatarios_de_saldo_favor(bigint) TO service_role;

-- Gemelo de `reserva_avisar_sala` para los avisos de saldo a favor.
CREATE OR REPLACE FUNCTION public.reserva_avisar_saldo(p_id bigint, p_titulo text, p_cuerpo text, p_clave text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_branch bigint; v_dest uuid[]; v_codigo text := 'R-' || lpad(p_id::text, 6, '0');
BEGIN
  SELECT branch_id INTO v_branch FROM public.app_reservas WHERE id = p_id;
  v_dest := public.destinatarios_de_saldo_favor(v_branch);
  IF v_dest IS NULL THEN RETURN; END IF;
  PERFORM public.notify_employees(v_dest, 'RESERVA_APP', p_titulo || ' · ' || v_codigo, p_cuerpo, '/reservas',
    jsonb_build_object('codigo', v_codigo, 'check_key', p_clave || ':' || p_id), true, v_branch::integer);
END $function$;
REVOKE EXECUTE ON FUNCTION public.reserva_avisar_saldo(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserva_avisar_saldo(bigint, text, text, text) TO service_role;

DO $$
DECLARE
  f record; d text; n integer;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.reservas_vigilar()'::regprocedure,
     'public.destinatarios_de_reservas(m.branch_id), ''{}''::uuid[])' || E'\n' || '                  || coalesce(public.destinatarios_de_reservas(r.branch_id)',
     'public.destinatarios_de_saldo_favor(m.branch_id), ''{}''::uuid[])' || E'\n' || '                  || coalesce(public.destinatarios_de_saldo_favor(r.branch_id)', 1),
    ('public.saldo_favor_buscar(text,text)'::regprocedure,
     'public.destinatarios_de_reservas(', 'public.destinatarios_de_saldo_favor(', 2),
    ('public.reserva_saldo_devolver(bigint,text)'::regprocedure,
     'reserva_avisar_sala(', 'reserva_avisar_saldo(', 1),
    ('public.reserva_saldo_negar_devolucion(bigint,text)'::regprocedure,
     'reserva_avisar_sala(', 'reserva_avisar_saldo(', 1)
  ) v(fn, viejo, nuevo, esperado)
  LOOP
    d := pg_get_functiondef(f.fn);
    n := (length(d) - length(replace(d, f.viejo, ''))) / length(f.viejo);
    IF n <> f.esperado THEN
      RAISE EXCEPTION '% : se esperaban % apariciones y hay %', f.fn, f.esperado, n;
    END IF;
    EXECUTE replace(d, f.viejo, f.nuevo);
  END LOOP;
END $$;
