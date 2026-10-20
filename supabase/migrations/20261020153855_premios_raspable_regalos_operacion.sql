SET lock_timeout = '5s';

-- Premios del raspable que no son puntos (2026-10-19), parte 3: lo que operan
-- la sala y administración (regalos, envíos, entregas). Partes 1 y 2: tablas y sorteo.

-- ── Permisos de quien opera ────────────────────────────────────────────────
-- Administrar el catálogo y mandar regalos: quien configura los niveles.
CREATE OR REPLACE FUNCTION public.promocionales_puede_administrar()
 RETURNS boolean
 LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(public.auth_has_module_permission('puntos_tab_niveles', 'can_edit'), false);
$function$;

-- ¿Puede operar en ESTA sucursal? Quien administra, en todas; el resto, sólo
-- en la suya. Es el freno por sucursal de recibir y entregar.
CREATE OR REPLACE FUNCTION public.promocionales_puede_en_sala(p_branch integer)
 RETURNS boolean
 LANGUAGE sql STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public.promocionales_puede_administrar()
      OR (coalesce(public.auth_has_module_permission('puntos', 'can_view'), false)
          AND p_branch IS NOT DISTINCT FROM public.auth_employee_branch_id());
$function$;

REVOKE ALL ON FUNCTION public.promocionales_puede_administrar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promocionales_puede_en_sala(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocionales_puede_administrar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promocionales_puede_en_sala(integer) TO authenticated, service_role;

-- Mueve una existencia y deja el renglón del movimiento. Interna.
CREATE OR REPLACE FUNCTION public.promocional_mover(p_promocional bigint, p_branch integer, p_delta integer,
                                                    p_tipo text, p_nota text, p_envio bigint, p_premio bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_queda integer;
BEGIN
  INSERT INTO public.promocionales_existencias (promocional_id, branch_id, cantidad)
  VALUES (p_promocional, p_branch, 0) ON CONFLICT DO NOTHING;
  UPDATE public.promocionales_existencias
     SET cantidad = cantidad + p_delta, updated_at = now()
   WHERE promocional_id = p_promocional AND branch_id = p_branch AND cantidad + p_delta >= 0
  RETURNING cantidad INTO v_queda;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay suficientes en esa sucursal.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.promocionales_movimientos (promocional_id, branch_id, tipo, cantidad, envio_id, premio_id, nota, employee_id)
  VALUES (p_promocional, p_branch, p_tipo, p_delta, p_envio, p_premio, nullif(btrim(p_nota), ''), public.auth_employee_id());
  RETURN v_queda;
END $function$;
REVOKE ALL ON FUNCTION public.promocional_mover(bigint, integer, integer, text, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promocional_mover(bigint, integer, integer, text, text, bigint, bigint) TO service_role;

-- Crear o editar un promocional del catálogo.
CREATE OR REPLACE FUNCTION public.promocional_guardar(p_id bigint, p_nombre text, p_descripcion text,
                                                      p_costo numeric, p_foto_url text, p_activo boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint;
BEGIN
  IF NOT public.promocionales_puede_administrar() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF coalesce(length(btrim(p_nombre)), 0) < 2 THEN RAISE EXCEPTION 'Escribe el nombre del regalo.'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.promocionales (nombre, descripcion, costo, foto_url, activo)
    VALUES (btrim(p_nombre), nullif(btrim(p_descripcion), ''), p_costo, nullif(btrim(p_foto_url), ''), coalesce(p_activo, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.promocionales
       SET nombre = btrim(p_nombre), descripcion = nullif(btrim(p_descripcion), ''), costo = p_costo,
           foto_url = nullif(btrim(p_foto_url), ''), activo = coalesce(p_activo, activo), updated_at = now()
     WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Ese regalo no existe.'; END IF;
  END IF;
  RETURN v_id;
END $function$;

-- Entrada (compra, donación) o ajuste de lo que hay en una sucursal.
CREATE OR REPLACE FUNCTION public.promocional_ajustar(p_id bigint, p_branch integer, p_delta integer, p_nota text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.promocionales_puede_administrar() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_delta, 0) = 0 THEN RAISE EXCEPTION 'La cantidad no puede ser cero.'; END IF;
  IF p_delta < 0 AND coalesce(length(btrim(p_nota)), 0) < 3 THEN
    RAISE EXCEPTION 'Para restar hay que decir por qué.';
  END IF;
  RETURN public.promocional_mover(p_id, p_branch, p_delta, CASE WHEN p_delta > 0 THEN 'ENTRADA' ELSE 'AJUSTE' END,
                                  p_nota, NULL, NULL);
END $function$;

-- Mandar a una sucursal. Sale de la de origen YA; llega al confirmarse.
CREATE OR REPLACE FUNCTION public.promocional_enviar(p_id bigint, p_desde integer, p_hacia integer, p_cantidad integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_envio bigint;
BEGIN
  IF NOT public.promocionales_puede_administrar() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_cantidad, 0) <= 0 THEN RAISE EXCEPTION 'Escribe cuántos se mandan.'; END IF;
  IF p_desde = p_hacia THEN RAISE EXCEPTION 'El envío tiene que ir a otra sucursal.'; END IF;
  INSERT INTO public.promocionales_envios (promocional_id, desde_branch, hacia_branch, cantidad, enviado_por)
  VALUES (p_id, p_desde, p_hacia, p_cantidad, public.auth_employee_id()) RETURNING id INTO v_envio;
  PERFORM public.promocional_mover(p_id, p_desde, -p_cantidad, 'ENVIO_SALE', NULL, v_envio, NULL);
  RETURN v_envio;
END $function$;

-- La sala confirma que llegó. Sólo la de destino (o quien administra).
CREATE OR REPLACE FUNCTION public.promocional_recibir(p_envio bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.promocionales_envios%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.promocionales_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese envío no existe.'; END IF;
  IF NOT public.promocionales_puede_en_sala(v.hacia_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v.estado = 'RECIBIDO' THEN RAISE EXCEPTION 'Ese envío ya se recibió.'; END IF;
  UPDATE public.promocionales_envios SET estado = 'RECIBIDO', recibido_por = public.auth_employee_id(), recibido_at = now()
   WHERE id = p_envio;
  RETURN public.promocional_mover(v.promocional_id, v.hacia_branch, v.cantidad, 'ENVIO_LLEGA', NULL, p_envio, NULL);
END $function$;

REVOKE ALL ON FUNCTION public.promocional_guardar(bigint, text, text, numeric, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promocional_ajustar(bigint, integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promocional_enviar(bigint, integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promocional_recibir(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocional_guardar(bigint, text, text, numeric, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promocional_ajustar(bigint, integer, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promocional_enviar(bigint, integer, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promocional_recibir(bigint) TO authenticated, service_role;

-- ── El panel: catálogo, existencias y envíos en camino ─────────────────────
CREATE OR REPLACE FUNCTION public.promocionales_panel()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN json_build_object(
    'promocionales', (SELECT coalesce(json_agg(json_build_object(
        'id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'foto_url', p.foto_url,
        'costo', p.costo, 'activo', p.activo,
        'existencias', (SELECT coalesce(json_object_agg(e.branch_id, e.cantidad), '{}'::json)
                          FROM public.promocionales_existencias e WHERE e.promocional_id = p.id AND e.cantidad > 0),
        'en_camino', (SELECT coalesce(sum(v.cantidad), 0) FROM public.promocionales_envios v
                       WHERE v.promocional_id = p.id AND v.estado = 'ENVIADO'))
      ORDER BY p.activo DESC, p.nombre), '[]'::json) FROM public.promocionales p),
    'envios', (SELECT coalesce(json_agg(json_build_object(
        'id', v.id, 'promocional_id', v.promocional_id, 'nombre', p.nombre, 'desde', v.desde_branch,
        'hacia', v.hacia_branch, 'cantidad', v.cantidad, 'enviado_at', v.enviado_at, 'enviado_por', v.enviado_por)
      ORDER BY v.enviado_at), '[]'::json)
      FROM public.promocionales_envios v JOIN public.promocionales p ON p.id = v.promocional_id
      WHERE v.estado = 'ENVIADO'),
    'puede_administrar', public.promocionales_puede_administrar());
END $function$;
REVOKE ALL ON FUNCTION public.promocionales_panel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocionales_panel() TO authenticated, service_role;

-- ── Los premios por entregar ───────────────────────────────────────────────
-- `p_branch` NULL = todas (sólo quien administra). `p_buscar`: código, nombre
-- del cliente o del premio. Los vencidos salen marcados: ya no se entregan.
CREATE OR REPLACE FUNCTION public.puntos_premios_lista(p_branch integer, p_buscar text DEFAULT NULL, p_incluir_entregados boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_b text := nullif(upper(btrim(coalesce(p_buscar, ''))), '');
BEGIN
  -- La sala ve la suya; quien administra, cualquiera o todas. Escrito aquí y
  -- no sólo en el ayudante, para que `gate:alcance` vea la comparación.
  IF NOT public.promocionales_puede_administrar()
     AND (p_branch IS NULL OR p_branch IS DISTINCT FROM (SELECT public.auth_employee_branch_id())
          OR NOT (SELECT public.auth_has_module_permission('puntos', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(json_agg(json_build_object(
      'id', pp.id, 'codigo', pp.codigo, 'tipo', pp.tipo, 'nombre', pp.nombre, 'cantidad', pp.cantidad,
      'presentacion', CASE WHEN pp.tipo = 'producto' THEN pp.presentacion_tipo || ' (' || pp.factor || ')' END,
      'product_id', pp.product_id, 'promocional_id', pp.promocional_id,
      'nivel', pp.nivel, 'ganado_el', pp.ganado_el, 'vence_el', pp.vence_el, 'branch_id', pp.branch_id,
      'raspado', pp.raspado_el IS NOT NULL,
      'estado', CASE WHEN pp.estado = 'POR_RETIRAR' AND pp.vence_el < v_hoy THEN 'VENCIDO' ELSE pp.estado END,
      'entregado_at', pp.entregado_at, 'entregado_por', pp.entregado_por,
      'cliente', json_build_object('id', c.id, 'nombre', c.name, 'documento', coalesce(c.dui, c.nit)),
      'hay_en_sala', CASE WHEN pp.tipo = 'promocional' THEN
          coalesce((SELECT e.cantidad FROM public.promocionales_existencias e
                     WHERE e.promocional_id = pp.promocional_id AND e.branch_id = pp.branch_id), 0) >= pp.cantidad END)
      ORDER BY (pp.estado <> 'ENTREGADO') DESC, pp.vence_el, pp.id), '[]'::json)
    FROM public.puntos_premios pp
    JOIN public.customers c ON c.id = pp.customer_id
   WHERE (p_branch IS NULL OR pp.branch_id = p_branch)
     AND (p_incluir_entregados OR pp.estado <> 'ENTREGADO')
     AND (v_b IS NULL OR pp.codigo ILIKE '%' || v_b || '%' OR upper(c.name) LIKE '%' || v_b || '%'
          OR upper(pp.nombre) LIKE '%' || v_b || '%' OR coalesce(c.dui, '') LIKE '%' || v_b || '%'));
END $function$;
REVOKE ALL ON FUNCTION public.puntos_premios_lista(integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_premios_lista(integer, text, boolean) TO authenticated, service_role;

-- ── Entregar: tomar, y después cerrar o soltar ─────────────────────────────
-- La entrega de un producto pasa por el sistema de la caja y tarda segundos:
-- dos clics a la vez descartarían dos veces. `tomar` reclama el premio de
-- forma atómica (ENTREGANDO, con un arriendo de 3 minutos por si la corrida
-- muere), y sólo quien lo tomó lo cierra.
CREATE OR REPLACE FUNCTION public.puntos_premio_tomar(p_id bigint, p_branch integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v public.puntos_premios%ROWTYPE;
BEGIN
  UPDATE public.puntos_premios
     SET estado = 'ENTREGANDO', tomado_at = now()
   WHERE id = p_id AND branch_id = p_branch AND vence_el >= v_hoy
     AND (estado = 'POR_RETIRAR' OR (estado = 'ENTREGANDO' AND tomado_at < now() - interval '3 minutes'))
  RETURNING * INTO v;
  IF NOT FOUND THEN
    SELECT * INTO v FROM public.puntos_premios WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese premio no existe.'; END IF;
    IF v.estado = 'ENTREGADO' THEN RAISE EXCEPTION 'Ese premio ya se entregó.'; END IF;
    IF v.branch_id IS DISTINCT FROM p_branch THEN RAISE EXCEPTION 'Ese premio se retira en otra sucursal.'; END IF;
    IF v.vence_el < v_hoy THEN RAISE EXCEPTION 'Ese premio venció el %.', to_char(v.vence_el, 'DD/MM/YYYY'); END IF;
    RAISE EXCEPTION 'Ese premio se está entregando en este momento.';
  END IF;
  RETURN (SELECT json_build_object('id', v.id, 'codigo', v.codigo, 'tipo', v.tipo, 'nombre', v.nombre,
            'product_id', v.product_id, 'presentacion_tipo', v.presentacion_tipo, 'factor', v.factor,
            'cantidad', v.cantidad, 'promocional_id', v.promocional_id, 'branch_id', v.branch_id,
            'cliente', c.name, 'customer_id', c.id)
            FROM public.customers c WHERE c.id = v.customer_id);
END $function$;

CREATE OR REPLACE FUNCTION public.puntos_premio_soltar(p_id bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  UPDATE public.puntos_premios SET estado = 'POR_RETIRAR', tomado_at = NULL WHERE id = p_id AND estado = 'ENTREGANDO';
$function$;

-- Cierra la entrega. Un promocional baja aquí mismo, en la MISMA transacción
-- que marca el premio: si no hay, no se entrega.
CREATE OR REPLACE FUNCTION public.puntos_premio_cerrar(p_id bigint, p_employee uuid, p_erp jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.puntos_premios%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id AND estado = 'ENTREGANDO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese premio no se estaba entregando.'; END IF;
  IF v.tipo = 'promocional' THEN
    INSERT INTO public.promocionales_existencias (promocional_id, branch_id, cantidad)
    VALUES (v.promocional_id, v.branch_id, 0) ON CONFLICT DO NOTHING;
    UPDATE public.promocionales_existencias SET cantidad = cantidad - v.cantidad, updated_at = now()
     WHERE promocional_id = v.promocional_id AND branch_id = v.branch_id AND cantidad >= v.cantidad;
    IF NOT FOUND THEN RAISE EXCEPTION 'En esta sucursal no hay de ese regalo. Pídelo a Bodega.'; END IF;
    INSERT INTO public.promocionales_movimientos (promocional_id, branch_id, tipo, cantidad, premio_id, employee_id)
    VALUES (v.promocional_id, v.branch_id, 'PREMIO', -v.cantidad, v.id, p_employee);
  END IF;
  UPDATE public.puntos_premios
     SET estado = 'ENTREGADO', entregado_at = now(), entregado_por = p_employee,
         entregado_branch = v.branch_id, erp_aplicado = p_erp, tomado_at = NULL
   WHERE id = p_id;
END $function$;

REVOKE ALL ON FUNCTION public.puntos_premio_tomar(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puntos_premio_soltar(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puntos_premio_cerrar(bigint, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_premio_tomar(bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.puntos_premio_soltar(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.puntos_premio_cerrar(bigint, uuid, jsonb) TO service_role;
