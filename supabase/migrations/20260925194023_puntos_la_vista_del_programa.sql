SET lock_timeout = '5s';

-- ═══ La vista «Puntos» ══════════════════════════════════════════════════════
-- Desde el 1-oct-2026 el programa vive en el portal y lo único que se veía era
-- el panel de cada ficha. Pedido del usuario (2026-09-25): una vista para
-- verlo mejor. Cuatro preguntas, cuatro funciones:
--   ¿funciona?                 → puntos_panel_resumen
--   ¿qué hay que revisar?      → puntos_panel_avisos
--   ¿de quién es esta cuenta?  → puntos_panel_candidatas (sólo SUGIERE)
--   asignarla                  → puntos_panel_asignar (con permiso de editar)
--
-- Todas SECURITY DEFINER con el permiso del módulo `puntos` comprobado ADENTRO:
-- leen tablas cuyo RLS es de `clientes`, y la vista no puede depender de que
-- quien la abre tenga además ese otro módulo.

CREATE OR REPLACE FUNCTION public.puntos_panel_resumen()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json; v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
        v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver Puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'hoy', v_hoy,
    'config', (SELECT json_build_object('fuente', fuente, 'encendido', acumulacion_activa,
                                        'inicio', inicio, 'minimo_canje', minimo_canje)
                 FROM public.puntos_config WHERE id),
    'arranque', (SELECT json_build_object('ok', ok, 'encendido', encendido, 'simulado', simulado,
                                          'cuando', created_at, 'error', resultado->>'error',
                                          'cuentas', resultado->'cuadre'->'cuentas')
                   FROM public.puntos_arranque ORDER BY id DESC LIMIT 1),
    'libro', (SELECT json_build_object('cuentas_con_saldo', count(*) FILTER (WHERE saldo > 0),
                                       'puntos', coalesce(sum(saldo), 0))
                FROM public.puntos_cuenta),
    'ultima_acumulacion', (SELECT max(created_at) FROM public.puntos_lote WHERE origen = 'venta'),
    'periodos', (
      SELECT json_object_agg(p.nombre, json_build_object(
        'acumulado', (SELECT coalesce(sum(puntos), 0) FROM public.puntos_lote
                       WHERE origen = 'venta' AND ganado_el >= p.desde),
        'ventas',    (SELECT count(*) FROM public.puntos_lote
                       WHERE origen = 'venta' AND ganado_el >= p.desde),
        'canjeado',  (SELECT coalesce(sum(puntos), 0) FROM public.puntos_salida
                       WHERE tipo = 'canje' AND invoice_id IS NOT NULL
                         AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= p.desde),
        'canjes',    (SELECT count(*) FROM public.puntos_salida
                       WHERE tipo = 'canje' AND invoice_id IS NOT NULL
                         AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= p.desde),
        'devuelto',  (SELECT coalesce(sum(puntos), 0) FROM public.puntos_salida
                       WHERE tipo = 'anulacion'
                         AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= p.desde)))
        FROM (VALUES ('hoy', v_hoy), ('mes', v_mes)) p(nombre, desde)),
    'por_sala', (
      SELECT coalesce(json_agg(x ORDER BY x.acumulado DESC), '[]'::json) FROM (
        SELECT coalesce(b.name, s.sucursal) AS sala, s.sucursal,
               sum(s.acumulado)::bigint AS acumulado, sum(s.canjeado)::bigint AS canjeado
          FROM (
            SELECT sucursal, puntos AS acumulado, 0 AS canjeado FROM public.puntos_lote
             WHERE origen = 'venta' AND ganado_el >= v_mes
            UNION ALL
            SELECT sucursal, 0, puntos FROM public.puntos_salida
             WHERE tipo = 'canje' AND invoice_id IS NOT NULL
               AND (created_at AT TIME ZONE 'America/El_Salvador')::date >= v_mes
          ) s
          LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
         GROUP BY 1, 2) x),
    'vencimientos', (
      SELECT coalesce(json_agg(x ORDER BY x.mes), '[]'::json) FROM (
        SELECT date_trunc('month', vence_el)::date AS mes, sum(restantes)::bigint AS puntos,
               count(DISTINCT customer_id) AS clientes
          FROM public.puntos_lote WHERE restantes > 0
         GROUP BY 1) x),
    'pendientes', (
      SELECT json_build_object('cuentas', count(*), 'puntos', coalesce(sum(saldo), 0))
        FROM public.puntos_cuentas_pendientes
       WHERE motivo <> 'tiene ficha: pasa sola en la migración')
  ) INTO v;
  RETURN v;
END;
$$;

-- Lo que alguien tiene que mirar: canjes que el cliente no tenía cómo pagar, y
-- ventas anuladas con los puntos ya gastados. Últimos 60 días.
CREATE OR REPLACE FUNCTION public.puntos_panel_avisos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver Puntos.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(json_agg(x ORDER BY x.cuando DESC), '[]'::json) INTO v FROM (
    SELECT 'canje_sin_saldo' AS tipo, s.created_at AS cuando, s.customer_id, c.name AS cliente,
           coalesce(b.name, s.sucursal) AS sala, si.correlativo AS documento, si.id AS invoice_id,
           s.puntos AS puntos,
           nullif(substring(s.motivo FROM 'faltaron ([0-9]+) puntos'), '')::int AS faltaron
      FROM public.puntos_salida s
      JOIN public.customers c ON c.id = s.customer_id
      LEFT JOIN public.sales_invoices si ON si.id = s.invoice_id
      LEFT JOIN public.branches b ON b.codigo_puntos = s.sucursal
     WHERE s.tipo = 'canje' AND s.motivo LIKE '%faltaron%'
       AND s.created_at >= now() - interval '60 days'
    UNION ALL
    SELECT 'anulada_con_puntos_gastados', coalesce(pe.anulada_at, pe.created_at), si.customer_id, c.name,
           coalesce(b.name, pe.sucursal), si.correlativo, si.id,
           pe.puntos_no_recuperados, pe.puntos_no_recuperados
      FROM public.puntos_enviados pe
      JOIN public.sales_invoices si ON si.id = pe.invoice_id
      LEFT JOIN public.customers c ON c.id = si.customer_id
      LEFT JOIN public.branches b ON b.codigo_puntos = pe.sucursal
     WHERE pe.reversion = 'PUNTOS_YA_DADOS'
       AND pe.fecha >= coalesce((SELECT inicio FROM public.puntos_config WHERE id), DATE '2026-10-01')
       AND coalesce(pe.anulada_at, pe.created_at) >= now() - interval '60 days'
  ) x;
  RETURN v;
END;
$$;

-- Fichas que PODRÍAN ser de una cuenta pendiente. Sólo sugiere: por teléfono
-- (últimos 8 dígitos) y por nombre parecido. Decisión del usuario: nada se une
-- solo; quien atiende el reclamo mira y elige. Con `p_busqueda`, busca además
-- lo que se escriba (nombre, DUI o teléfono): la ficha correcta puede no
-- parecerse en nada a la cuenta vieja.
CREATE OR REPLACE FUNCTION public.puntos_panel_candidatas(p_id_cliente bigint, p_busqueda text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE c record; v_tel text; v_nombre text; v_q text; v_qd text; v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver Puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.puntos_cuentas_pendientes WHERE id_cliente = p_id_cliente;
  IF NOT FOUND THEN RETURN '[]'::json; END IF;
  v_tel := right(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g'), 8);
  v_nombre := upper(unaccent(coalesce(c.nombre, '')));
  v_q := nullif(upper(unaccent(trim(coalesce(p_busqueda, '')))), '');
  v_qd := nullif(regexp_replace(coalesce(p_busqueda, ''), '\D', '', 'g'), '');

  SELECT coalesce(json_agg(x ORDER BY x.por_telefono DESC, x.parecido DESC), '[]'::json) INTO v FROM (
    SELECT f.id, f.name AS nombre, f.dui, f.phone AS telefono,
           (length(v_tel) = 8 AND right(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g'), 8) = v_tel) AS por_telefono,
           round(similarity(upper(unaccent(f.name)), v_nombre)::numeric, 2) AS parecido,
           (SELECT saldo FROM public.puntos_cuenta pc WHERE pc.customer_id = f.id) AS saldo_actual
      FROM public.customers f
     WHERE CASE WHEN v_q IS NULL THEN
             (length(v_tel) = 8 AND right(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g'), 8) = v_tel)
             OR (length(v_nombre) >= 6 AND upper(unaccent(f.name)) % v_nombre)
           ELSE
             upper(unaccent(f.name)) LIKE '%' || v_q || '%'
             OR (length(v_qd) >= 8 AND (regexp_replace(coalesce(f.dui, ''), '\D', '', 'g') = v_qd
                                        OR right(regexp_replace(coalesce(f.phone, ''), '\D', '', 'g'), 8) = right(v_qd, 8)))
           END
     ORDER BY 5 DESC, 6 DESC
     LIMIT 8
  ) x;
  RETURN v;
END;
$$;

-- Asignar desde la vista. Exige poder EDITAR Puntos, firma con la ficha de
-- quien asigna (`auth_employee_id()`, nunca un id que mande el navegador) y
-- delega TODO lo demás en la función que ya se probó.
CREATE OR REPLACE FUNCTION public.puntos_panel_asignar(
  p_id_cliente bigint, p_customer_id bigint, p_nota text, p_simular boolean DEFAULT true
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_edit')) THEN
    RAISE EXCEPTION 'No tienes permiso para asignar cuentas de puntos.' USING ERRCODE = '42501';
  END IF;
  RETURN public.puntos_asignar_cuenta_anterior(p_id_cliente, p_customer_id, p_nota, p_simular,
                                               (SELECT public.auth_employee_id()));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.puntos_panel_resumen()                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puntos_panel_avisos()                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puntos_panel_candidatas(bigint, text)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puntos_panel_asignar(bigint,bigint,text,boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_resumen()                          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_avisos()                           TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_candidatas(bigint, text)           TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_asignar(bigint,bigint,text,boolean) TO authenticated, service_role;

-- Las cuentas por asignar, enteras y en UN json (Patrón C de CLAUDE.md): son
-- ~709, demasiado cerca del techo de 1,000 filas de PostgREST para confiarle
-- una lista de filas. Las que «pasan solas en la migración» no son trabajo de
-- nadie y no se muestran.
CREATE OR REPLACE FUNCTION public.puntos_panel_pendientes()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver Puntos.' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(json_agg(to_json(p) ORDER BY p.saldo DESC), '[]'::json) INTO v
    FROM public.puntos_cuentas_pendientes p
   WHERE p.motivo <> 'tiene ficha: pasa sola en la migración';
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_panel_pendientes() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.puntos_panel_pendientes() TO authenticated, service_role;

-- ── El módulo `puntos` ──────────────────────────────────────────────────────
-- Ver y operar el programa: Gerencia, Administración y Supervisión de Ventas
-- (quien ya recibe los avisos de canje sin saldo), más la cuenta de QA, que
-- siempre tiene todo activo. La caja NO lo necesita: consulta el saldo en la
-- ficha del cliente, que es permiso de `clientes`.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'puntos', true, true, false, 'ALL'
  FROM public.roles r
 WHERE r.name IN ('Gerente General', 'Administrador', 'Supervisor/a de Ventas', 'QA / Testing (CI)')
ON CONFLICT (role_id, module_key) DO NOTHING;
