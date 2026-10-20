SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El premio del raspable se retira en CUALQUIER sucursal (2026-10-20, pedido
-- del usuario): el cliente ya no elige dónde; lo entrega la sala que escanea el
-- código, y de ésa sale el producto o el regalo.
--
-- Un regalo PROMOCIONAL que la sala no tiene NO se entrega: se dice dónde hay,
-- y el cliente elige (decisión del usuario):
--   · recogerlo allá → se APARTA una unidad en esa sala (`reserva_branch`);
--   · pedirlo aquí  → queda SOLICITADO para esta sala (`espera_envio`); cuando
--     el envío llega, se le aparta solo y se le avisa en la app que ya puede
--     retirarlo en la misma sala.
--
-- Lo apartado NO es un contador guardado: se cuenta en vivo desde los premios
-- vigentes. Un contador se desfasa el día que un premio vence sin retirarse;
-- contado, la unidad vuelve sola al vencer.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.puntos_premios
  ADD COLUMN IF NOT EXISTS reserva_branch integer REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS espera_envio boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS puntos_premios_reserva_branch ON public.puntos_premios (reserva_branch) WHERE reserva_branch IS NOT NULL;

-- Cuántos regalos de un promocional están APARTADOS en una sala (premios
-- vigentes, sin entregar). `p_salvo` excluye uno (el que se está entregando).
CREATE OR REPLACE FUNCTION public.promocional_apartados(p_promocional bigint, p_branch integer, p_salvo bigint DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(sum(pp.cantidad), 0)::integer FROM public.puntos_premios pp
   WHERE pp.promocional_id = p_promocional AND pp.reserva_branch = p_branch
     AND pp.estado <> 'ENTREGADO' AND pp.vence_el >= (now() AT TIME ZONE 'America/El_Salvador')::date
     AND pp.id IS DISTINCT FROM p_salvo;
$function$;
REVOKE ALL ON FUNCTION public.promocional_apartados(bigint, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocional_apartados(bigint, integer, bigint) TO authenticated, service_role;

-- Lo que una sala puede ENTREGAR hoy de un promocional: lo que hay menos lo
-- apartado para otros.
CREATE OR REPLACE FUNCTION public.promocional_libres(p_promocional bigint, p_branch integer, p_salvo bigint DEFAULT NULL)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT greatest(coalesce((SELECT e.cantidad FROM public.promocionales_existencias e
                             WHERE e.promocional_id = p_promocional AND e.branch_id = p_branch), 0)
                  - public.promocional_apartados(p_promocional, p_branch, p_salvo), 0);
$function$;
REVOKE ALL ON FUNCTION public.promocional_libres(bigint, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promocional_libres(bigint, integer, bigint) TO authenticated, service_role;

-- ── La lista ───────────────────────────────────────────────────────────────
-- Por entregar: los de CUALQUIER sala (se retiran en cualquiera). Entregados:
-- los de esta sala (o todos, para quien administra). Con cada promocional, en
-- qué salas se puede entregar hoy.
CREATE OR REPLACE FUNCTION public.puntos_premios_lista(p_branch integer, p_buscar text DEFAULT NULL, p_incluir_entregados boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
  v_b text := nullif(upper(btrim(coalesce(p_buscar, ''))), '');
  v_admin boolean := public.promocionales_puede_administrar();
BEGIN
  -- La sala opera la suya; quien administra, cualquiera o todas. Escrito aquí y
  -- no sólo en el ayudante, para que `gate:alcance` vea la comparación.
  IF NOT v_admin
     AND (p_branch IS NULL OR p_branch IS DISTINCT FROM (SELECT public.auth_employee_branch_id())
          OR NOT (SELECT public.auth_has_module_permission('puntos', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(json_agg(json_build_object(
      'id', pp.id, 'codigo', pp.codigo, 'tipo', pp.tipo, 'nombre', pp.nombre, 'cantidad', pp.cantidad,
      'presentacion', CASE WHEN pp.tipo = 'producto' THEN pp.presentacion_tipo || ' (' || pp.factor || ')' END,
      'product_id', pp.product_id, 'promocional_id', pp.promocional_id,
      'nivel', pp.nivel, 'ganado_el', pp.ganado_el, 'vence_el', pp.vence_el,
      'branch_id', pp.branch_id, 'reserva_branch', pp.reserva_branch, 'espera_envio', pp.espera_envio,
      'entregado_branch', pp.entregado_branch,
      'raspado', pp.raspado_el IS NOT NULL,
      'estado', CASE WHEN pp.estado = 'POR_RETIRAR' AND pp.vence_el < v_hoy THEN 'VENCIDO' ELSE pp.estado END,
      'entregado_at', pp.entregado_at, 'entregado_por', pp.entregado_por,
      'cliente', json_build_object('id', c.id, 'nombre', c.name, 'documento', coalesce(c.dui, c.nit)),
      -- Para un promocional: dónde se puede entregar hoy (su unidad apartada
      -- cuenta como suya, no de otro).
      'hay_en', CASE WHEN pp.tipo = 'promocional' THEN (
          SELECT coalesce(json_agg(json_build_object('branch_id', e.branch_id,
                   'libres', public.promocional_libres(pp.promocional_id, e.branch_id, pp.id)) ORDER BY e.branch_id), '[]'::json)
            FROM public.promocionales_existencias e
            JOIN public.branches b ON b.id = e.branch_id AND b.type = 'FARMACIA'   -- el cliente no retira en Bodega
           WHERE e.promocional_id = pp.promocional_id
             AND public.promocional_libres(pp.promocional_id, e.branch_id, pp.id) >= pp.cantidad) END,
      'hay_en_sala', CASE WHEN pp.tipo = 'promocional' AND p_branch IS NOT NULL THEN
          public.promocional_libres(pp.promocional_id, p_branch, pp.id) >= pp.cantidad END)
      ORDER BY (pp.estado <> 'ENTREGADO') DESC, pp.vence_el, pp.id), '[]'::json)
    FROM public.puntos_premios pp
    JOIN public.customers c ON c.id = pp.customer_id
   WHERE (pp.estado <> 'ENTREGADO'
          OR (p_incluir_entregados AND (v_admin AND p_branch IS NULL OR pp.entregado_branch = p_branch)))
     AND (v_b IS NULL OR pp.codigo ILIKE '%' || v_b || '%' OR upper(c.name) LIKE '%' || v_b || '%'
          OR upper(pp.nombre) LIKE '%' || v_b || '%' OR coalesce(c.dui, '') LIKE '%' || v_b || '%'));
END $function$;

-- ── Tomar: lo entrega la sala que escanea ──────────────────────────────────
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
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese premio no existe.'; END IF;
  IF v.estado = 'ENTREGADO' THEN RAISE EXCEPTION 'Ese premio ya se entregó.'; END IF;
  IF v.vence_el < v_hoy THEN RAISE EXCEPTION 'Ese premio venció el %.', to_char(v.vence_el, 'DD/MM/YYYY'); END IF;
  IF v.estado = 'ENTREGANDO' AND v.tomado_at >= now() - interval '3 minutes' THEN
    RAISE EXCEPTION 'Ese premio se está entregando en este momento.';
  END IF;
  -- Un regalo apartado en otra sala se entrega allá: ésa lo guarda para él.
  IF v.tipo = 'promocional' AND v.reserva_branch IS NOT NULL AND v.reserva_branch <> p_branch THEN
    RAISE EXCEPTION 'Ese regalo está apartado en otra sucursal: se retira allá.';
  END IF;
  IF v.tipo = 'promocional' AND public.promocional_libres(v.promocional_id, p_branch, v.id) < v.cantidad THEN
    RAISE EXCEPTION 'En esta sucursal no hay de ese regalo.';
  END IF;
  UPDATE public.puntos_premios SET estado = 'ENTREGANDO', tomado_at = now(), branch_id = p_branch WHERE id = p_id
  RETURNING * INTO v;
  RETURN (SELECT json_build_object('id', v.id, 'codigo', v.codigo, 'tipo', v.tipo, 'nombre', v.nombre,
            'product_id', v.product_id, 'presentacion_tipo', v.presentacion_tipo, 'factor', v.factor,
            'cantidad', v.cantidad, 'promocional_id', v.promocional_id, 'branch_id', v.branch_id,
            'cliente', c.name, 'customer_id', c.id)
            FROM public.customers c WHERE c.id = v.customer_id);
END $function$;

-- ── Cerrar: el promocional baja de la sala que entrega ─────────────────────
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
    -- Lo libre de esta sala, contando la unidad de este premio como suya.
    IF public.promocional_libres(v.promocional_id, v.branch_id, v.id) < v.cantidad THEN
      RAISE EXCEPTION 'En esta sucursal no hay de ese regalo.';
    END IF;
    UPDATE public.promocionales_existencias SET cantidad = cantidad - v.cantidad, updated_at = now()
     WHERE promocional_id = v.promocional_id AND branch_id = v.branch_id AND cantidad >= v.cantidad;
    IF NOT FOUND THEN RAISE EXCEPTION 'En esta sucursal no hay de ese regalo.'; END IF;
    INSERT INTO public.promocionales_movimientos (promocional_id, branch_id, tipo, cantidad, premio_id, employee_id)
    VALUES (v.promocional_id, v.branch_id, 'PREMIO', -v.cantidad, v.id, p_employee);
  END IF;
  UPDATE public.puntos_premios
     SET estado = 'ENTREGADO', entregado_at = now(), entregado_por = p_employee,
         entregado_branch = v.branch_id, erp_aplicado = p_erp, tomado_at = NULL, espera_envio = false
   WHERE id = p_id;
END $function$;

-- ── Apartar un regalo en una sala que SÍ tiene ─────────────────────────────
-- Lo hace la sala que atiende al cliente (la que escaneó), para otra.
CREATE OR REPLACE FUNCTION public.puntos_premio_apartar(p_id bigint, p_branch integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.puntos_premios%ROWTYPE; v_sala text;
BEGIN
  -- La sala que atiende, o el propio cliente desde la app (`app-clientes`
  -- llama con la llave del servidor después de comprobar que el premio es suyo).
  IF NOT (coalesce(auth.role(), '') = 'service_role'
          OR coalesce((SELECT public.auth_has_module_permission('puntos', 'can_view')), false)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.tipo <> 'promocional' THEN RAISE EXCEPTION 'Sólo un regalo promocional se aparta.'; END IF;
  IF v.estado <> 'POR_RETIRAR' OR v.vence_el < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Ese premio ya no se puede apartar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = p_branch AND type = 'FARMACIA') THEN
    RAISE EXCEPTION 'Un regalo se aparta en una farmacia.';
  END IF;
  IF public.promocional_libres(v.promocional_id, p_branch, v.id) < v.cantidad THEN
    RAISE EXCEPTION 'En esa sucursal ya no hay de ese regalo.';
  END IF;
  UPDATE public.puntos_premios SET reserva_branch = p_branch, branch_id = p_branch, espera_envio = false WHERE id = p_id;
  SELECT name INTO v_sala FROM public.branches WHERE id = p_branch;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (v.customer_id, 'ganado', 'premio:apartado:' || v.id, 'Tu regalo te espera',
          v.nombre || ' quedó apartado para ti en ' || coalesce(v_sala, 'la sucursal') || '. Retíralo antes del '
            || to_char(v.vence_el, 'DD/MM') || ' con el código de tu cupón.', '/puntos');
  RETURN json_build_object('ok', true, 'sala', v_sala);
END $function$;

-- ── Pedirlo para la sala que atiende ───────────────────────────────────────
-- Queda en «Pedidos de regalos» del panel; al recibir el envío se aparta solo.
CREATE OR REPLACE FUNCTION public.puntos_premio_pedir(p_id bigint, p_branch integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.puntos_premios%ROWTYPE;
BEGIN
  IF NOT public.promocionales_puede_en_sala(p_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.tipo <> 'promocional' THEN RAISE EXCEPTION 'Sólo un regalo promocional se pide.'; END IF;
  IF v.estado <> 'POR_RETIRAR' OR v.vence_el < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Ese premio ya no se puede pedir.';
  END IF;
  -- Si estaba apartado en otra sala, se suelta: ahora se espera aquí.
  UPDATE public.puntos_premios SET branch_id = p_branch, espera_envio = true, reserva_branch = NULL WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.puntos_premio_apartar(bigint, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.puntos_premio_pedir(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_premio_apartar(bigint, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puntos_premio_pedir(bigint, integer) TO authenticated, service_role;

-- ── Al recibir un envío, los pedidos de esa sala se apartan y se avisa ─────
CREATE OR REPLACE FUNCTION public.promocional_recibir(p_envio bigint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v public.promocionales_envios%ROWTYPE;
  v_queda integer; p record; v_sala text;
BEGIN
  SELECT * INTO v FROM public.promocionales_envios WHERE id = p_envio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ese envío no existe.'; END IF;
  IF NOT public.promocionales_puede_en_sala(v.hacia_branch) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v.estado = 'RECIBIDO' THEN RAISE EXCEPTION 'Ese envío ya se recibió.'; END IF;
  UPDATE public.promocionales_envios SET estado = 'RECIBIDO', recibido_por = public.auth_employee_id(), recibido_at = now()
   WHERE id = p_envio;
  v_queda := public.promocional_mover(v.promocional_id, v.hacia_branch, v.cantidad, 'ENVIO_LLEGA', NULL, p_envio, NULL);
  SELECT name INTO v_sala FROM public.branches WHERE id = v.hacia_branch;
  -- Los que lo esperaban en esta sala, por orden de llegada, mientras alcance.
  FOR p IN SELECT * FROM public.puntos_premios
            WHERE promocional_id = v.promocional_id AND branch_id = v.hacia_branch AND espera_envio
              AND estado = 'POR_RETIRAR' AND vence_el >= (now() AT TIME ZONE 'America/El_Salvador')::date
            ORDER BY id FOR UPDATE LOOP
    EXIT WHEN public.promocional_libres(v.promocional_id, v.hacia_branch, p.id) < p.cantidad;
    UPDATE public.puntos_premios SET espera_envio = false, reserva_branch = v.hacia_branch WHERE id = p.id;
    INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
    VALUES (p.customer_id, 'ganado', 'premio:llego:' || p.id, 'Tu regalo ya llegó',
            p.nombre || ' ya está en ' || coalesce(v_sala, 'la sucursal') || '. Retíralo antes del '
              || to_char(p.vence_el, 'DD/MM') || ' con el código de tu cupón.', '/puntos');
  END LOOP;
  RETURN v_queda;
END $function$;

-- ── El panel: además, los regalos pedidos por sala ─────────────────────────
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
        'apartados', (SELECT coalesce(json_object_agg(e.branch_id, public.promocional_apartados(p.id, e.branch_id)), '{}'::json)
                        FROM public.promocionales_existencias e
                       WHERE e.promocional_id = p.id AND public.promocional_apartados(p.id, e.branch_id) > 0),
        'en_camino', (SELECT coalesce(sum(v.cantidad), 0) FROM public.promocionales_envios v
                       WHERE v.promocional_id = p.id AND v.estado = 'ENVIADO'))
      ORDER BY p.activo DESC, p.nombre), '[]'::json) FROM public.promocionales p),
    'envios', (SELECT coalesce(json_agg(json_build_object(
        'id', v.id, 'promocional_id', v.promocional_id, 'nombre', p.nombre, 'desde', v.desde_branch,
        'hacia', v.hacia_branch, 'cantidad', v.cantidad, 'enviado_at', v.enviado_at, 'enviado_por', v.enviado_por)
      ORDER BY v.enviado_at), '[]'::json)
      FROM public.promocionales_envios v JOIN public.promocionales p ON p.id = v.promocional_id
      WHERE v.estado = 'ENVIADO'),
    -- Los regalos que una sala pidió para un cliente y todavía no llegan.
    'pedidos', (SELECT coalesce(json_agg(json_build_object('promocional_id', x.promocional_id, 'nombre', x.nombre,
        'hacia', x.branch_id, 'cantidad', x.cantidad, 'premios', x.premios) ORDER BY x.branch_id), '[]'::json)
      FROM (SELECT pp.promocional_id, max(pp.nombre) nombre, pp.branch_id, sum(pp.cantidad)::integer cantidad, count(*)::integer premios
              FROM public.puntos_premios pp
             WHERE pp.espera_envio AND pp.estado = 'POR_RETIRAR'
               AND pp.vence_el >= (now() AT TIME ZONE 'America/El_Salvador')::date
             GROUP BY pp.promocional_id, pp.branch_id) x),
    'puede_administrar', public.promocionales_puede_administrar());
END $function$;
