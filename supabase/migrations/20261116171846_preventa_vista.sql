-- La vista de Preventa (2026-11-16): vender desde el portal y que la venta
-- llegue armada a la caja; corregirla y anularla mientras no se facture.
--
-- La entidad ya existía (`preventas`, 2026-10-21) y sólo nacía de reservas.
-- Acá nace también DIRECTA: sin reserva, con los productos que arma quien vende.
--
-- El precio lo decide el CLIENTE (usuario, 2026-11-16):
--   · cliente frecuente o sin ficha → Público   (descuento_1, el 2.º precio)
--   · todo cliente con ficha        → Preferente (vip)
--   · mayorista aprobado            → el habilitado (Mayoreo = clinica, Mayoreo Plus = mayoreo)
--   · empleado                      → Mayoreo Plus (mayoreo)
-- El mayoreo vale sólo en la presentación completa (`listaQueLeToca`): unidades
-- sueltas van a Preferente. Otro precio sólo con `preventa.can_approve` y motivo.
SET lock_timeout = '5s';

-- ── 1. La lista del cliente, con la regla de hoy ─────────────────────────
CREATE OR REPLACE FUNCTION public.cliente_es_generico(p_customer bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_customer IS NULL OR coalesce((
    SELECT coalesce(c.erp_id IN ('-1', '-2'), false)
        OR c.name ~* '^\s*(CLIENTES? VARIOS|CONSUMIDOR FINAL)' OR c.name ~* 'FRECUENTE'
      FROM public.customers c WHERE c.id = p_customer), true);
$$;
REVOKE EXECUTE ON FUNCTION public.cliente_es_generico(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_es_generico(bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lista_de_precio_del_cliente(p_customer bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_m json;
  v_emp boolean;
BEGIN
  -- Cliente frecuente o sin ficha: Público, el 2.º precio (usuario, 2026-11-16).
  IF public.cliente_es_generico(p_customer) THEN RETURN 'descuento_1'; END IF;
  v_m := public.mayorista_de(p_customer);
  v_emp := public.cliente_es_empleado(p_customer);
  IF v_m->>'estado' = 'aprobado' THEN
    RETURN CASE WHEN v_m->>'precio' = 'mayoreo_plus' OR v_emp THEN 'mayoreo' ELSE 'clinica' END;
  END IF;
  IF v_emp THEN RETURN 'mayoreo'; END IF;
  -- Todo cliente con ficha: Preferente (antes, sólo con cuenta en Puntos).
  RETURN 'vip';
END $$;
REVOKE EXECUTE ON FUNCTION public.lista_de_precio_del_cliente(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lista_de_precio_del_cliente(bigint) TO authenticated, service_role;

-- ── 2. La preventa directa ───────────────────────────────────────────────
ALTER TABLE public.preventas ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'reserva';
ALTER TABLE public.preventas DROP CONSTRAINT IF EXISTS preventas_origen_check;
ALTER TABLE public.preventas ADD CONSTRAINT preventas_origen_check CHECK (origen IN ('reserva', 'directa'));
ALTER TABLE public.preventas ADD COLUMN IF NOT EXISTS corregida_veces integer NOT NULL DEFAULT 0;
ALTER TABLE public.preventas ADD COLUMN IF NOT EXISTS anulada_por uuid REFERENCES public.employees(id);
ALTER TABLE public.preventas ADD COLUMN IF NOT EXISTS anulada_at timestamptz;
CREATE INDEX IF NOT EXISTS preventas_directas_idx ON public.preventas (branch_id, created_at DESC) WHERE origen = 'directa';
CREATE INDEX IF NOT EXISTS preventas_anulada_por_idx ON public.preventas (anulada_por) WHERE anulada_por IS NOT NULL;
COMMENT ON COLUMN public.preventas.origen IS 'reserva = nació de app_reservas; directa = la armó quien vende en la vista Preventa.';

-- ¿Quién puede vender en esa sala? El módulo `preventa`, en la propia, en la
-- que cubre ahora, o en cualquiera con alcance de toda la red.
CREATE OR REPLACE FUNCTION public.preventa_puede(p_employee uuid, p_branch bigint, p_que text DEFAULT 'can_edit')
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE e public.employees; v_puede boolean; v_todas boolean;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND status = 'ACTIVO';
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT bool_or(CASE p_que WHEN 'can_view' THEN rp.can_view OR rp.can_edit
                            WHEN 'can_approve' THEN rp.can_approve ELSE rp.can_edit END),
         bool_or(rp.scope = 'ALL')
    INTO v_puede, v_todas
    FROM public.role_permissions rp
   WHERE rp.role_id IN (e.role_id, e.secondary_role_id) AND rp.module_key = 'preventa';
  IF NOT coalesce(v_puede, false) THEN RETURN false; END IF;
  IF p_que = 'can_approve' OR coalesce(v_todas, false) OR e.branch_id = p_branch THEN RETURN true; END IF;
  RETURN e.branch_id IS NOT NULL AND p_branch = ANY (coalesce(public.salas_que_cubre_ahora(e.branch_id::int), '{}'));
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_puede(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_puede(uuid, bigint, text) TO service_role;

-- El precio de una presentación en una lista, bajando por la cadena si esa
-- lista no tiene precio (Mayoreo Plus → Mayoreo → Preferente → Público → Regular).
-- Es `listaQueLeToca` (src/utils/apartar.js) escrita en la base.
CREATE OR REPLACE FUNCTION public.preventa_lista_efectiva(p_lista text, p_factor integer, p_factor_mayor integer,
  p_mayoreo numeric, p_clinica numeric, p_vip numeric, p_descuento_1 numeric, p_vineta numeric)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  WITH cadena(k, i, v) AS (VALUES ('mayoreo', 0, p_mayoreo), ('clinica', 1, p_clinica), ('vip', 2, p_vip),
                                  ('descuento_1', 3, p_descuento_1), ('vineta', 4, p_vineta)),
  desde AS (SELECT CASE WHEN coalesce((SELECT i FROM cadena WHERE k = p_lista), 3) < 2 AND p_factor < p_factor_mayor
                        THEN 2 ELSE coalesce((SELECT i FROM cadena WHERE k = p_lista), 3) END AS i)
  SELECT k FROM cadena, desde WHERE cadena.i >= desde.i AND coalesce(v, 0) > 0 ORDER BY cadena.i LIMIT 1;
$$;

-- Cotizar: lo que la pantalla muestra y lo que el servidor vuelve a calcular
-- antes de mandar. Nunca confía en un precio que venga del navegador.
-- `p_lineas`: [{ producto_id, factor, cantidad, lista? }] — `lista` sólo si se
-- pide otro precio (lo autoriza `preparar`, no esto).
CREATE OR REPLACE FUNCTION public.preventa_cotizar(p_branch bigint, p_customer bigint, p_lineas jsonb)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lista text := public.lista_de_precio_del_cliente(p_customer);
  v_ids int[];
  v_exist json;
BEGIN
  -- Desde el navegador, sólo quien vende en esa sala; desde `preparar` (llave
  -- del servidor, sin sesión) ya se comprobó antes.
  IF auth.uid() IS NOT NULL AND NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'No se dijo qué productos.'; END IF;
  SELECT array_agg(DISTINCT (x->>'producto_id')::int) INTO v_ids FROM jsonb_array_elements(p_lineas) x;
  v_exist := CASE WHEN v_ids IS NULL THEN '[]'::json ELSE public.app_existencias_netas(v_ids) END;
  RETURN json_build_object(
    'lista', v_lista,
    'generico', public.cliente_es_generico(p_customer),
    'cliente', (SELECT json_build_object('id', c.id, 'name', c.name, 'erp_id', c.erp_id, 'nrc', c.nrc,
                                          'categoria', c.categoria, 'phone', c.phone)
                  FROM public.customers c WHERE c.id = p_customer),
    'lineas', coalesce((
      SELECT json_agg(json_build_object(
        'producto_id', l.producto_id, 'factor', l.factor, 'cantidad', l.cantidad,
        'nombre', p.nombre, 'bajo_receta', coalesce(p.es_antibiotico, false) OR coalesce(p.requiere_receta, false),
        'tipo', pr.tipo, 'precio', pr.precio, 'precio_regular', pr.vineta, 'lista', pr.lista,
        'subtotal', round(coalesce(pr.precio, 0) * l.cantidad, 2),
        'existencia', coalesce(ex.disp, 0),
        'presentaciones', pres.lista_pres,
        'error', CASE
          WHEN p.id IS NULL THEN 'Ese producto no existe.'
          WHEN NOT coalesce(p.activo, true) THEN 'Ese producto está inactivo.'
          WHEN pr.precio IS NULL THEN 'Esa presentación no tiene precio.'
          WHEN l.cantidad IS NULL OR l.cantidad < 1 OR l.cantidad > 999 THEN 'La cantidad va de 1 a 999.'
          WHEN coalesce(ex.disp, 0) < l.cantidad * l.factor THEN
            'En la sucursal hay ' || coalesce(ex.disp, 0)::int || ' unidades y se piden ' || (l.cantidad * l.factor) || '.'
        END) ORDER BY l.ord)
      FROM (SELECT (x->>'producto_id')::int AS producto_id, greatest(coalesce((x->>'factor')::int, 1), 1) AS factor,
                   (x->>'cantidad')::int AS cantidad, nullif(x->>'lista', '') AS lista_pedida, o AS ord
              FROM jsonb_array_elements(p_lineas) WITH ORDINALITY AS t(x, o)) l
      LEFT JOIN public.products p ON p.id = l.producto_id
      LEFT JOIN LATERAL (
        SELECT max(coalesce(pp.factor, 1))::int AS mayor FROM public.product_precios pp
         WHERE pp.product_id = l.producto_id AND pp.activo AND pp.vineta > 0) fm ON true
      LEFT JOIN LATERAL (
        SELECT q.*, round(CASE q.lista WHEN 'mayoreo' THEN q.mayoreo WHEN 'clinica' THEN q.clinica WHEN 'vip' THEN q.vip
                                       WHEN 'descuento_1' THEN q.descuento_1 ELSE q.vineta END, 2) AS precio
          FROM (SELECT pp.*, coalesce(pre.tipo, 'Unidad') AS tipo,
                       public.preventa_lista_efectiva(coalesce(l.lista_pedida, v_lista), l.factor, fm.mayor,
                         pp.mayoreo, pp.clinica, pp.vip, pp.descuento_1, pp.vineta) AS lista
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = l.producto_id AND coalesce(pp.factor, 1) = l.factor AND pp.activo AND pp.vineta > 0
                 ORDER BY pp.vineta DESC LIMIT 1) q) pr ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('factor', z.factor, 'tipo', z.tipo) ORDER BY z.factor) AS lista_pres
          FROM (SELECT DISTINCT coalesce(pp.factor, 1)::int AS factor, coalesce(pre.tipo, 'Unidad') AS tipo
                  FROM public.product_precios pp LEFT JOIN public.presentaciones pre ON pre.id = pp.id_presentacion
                 WHERE pp.product_id = l.producto_id AND pp.activo AND pp.vineta > 0) z) pres ON true
      LEFT JOIN LATERAL (
        SELECT max((e->>'disponibles')::numeric) AS disp FROM json_array_elements(v_exist) e
         WHERE (e->>'product_id')::int = l.producto_id AND (e->>'branch_id')::bigint = p_branch) ex ON true
    ), '[]'::json));
END $$;
REVOKE EXECUTE ON FUNCTION public.preventa_cotizar(bigint, bigint, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventa_cotizar(bigint, bigint, jsonb) TO authenticated, service_role;

-- Preparar (o corregir) una preventa directa. La llama `preventa-caja` con la
-- llave del servidor. Vuelve a cotizar acá: lo que viaja es lo de la base.
CREATE OR REPLACE FUNCTION public.preventa_directa_preparar(
  p_employee uuid, p_branch bigint, p_customer bigint, p_documento text, p_nota text,
  p_lineas jsonb, p_preventa bigint DEFAULT NULL, p_motivo_precio text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  e public.employees; pv public.preventas; v_c json; v_erp int; v_id bigint; l json; v_err text;
  v_otro boolean;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = p_employee AND status = 'ACTIVO';
  IF NOT FOUND OR NOT public.preventa_puede(p_employee, p_branch) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lineas) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Una preventa lleva de 1 a 30 productos.';
  END IF;
  IF (SELECT count(DISTINCT (x->>'producto_id') || '|' || coalesce(x->>'factor', '1')) FROM jsonb_array_elements(p_lineas) x)
     < jsonb_array_length(p_lineas) THEN
    RAISE EXCEPTION 'Un producto va una sola vez por presentación: súmale la cantidad.';
  END IF;
  -- Otro precio que el del cliente: sólo quien lo puede autorizar, y con motivo.
  v_otro := EXISTS (SELECT 1 FROM jsonb_array_elements(p_lineas) x WHERE nullif(x->>'lista', '') IS NOT NULL);
  IF v_otro AND NOT public.preventa_puede(p_employee, p_branch, 'can_approve') THEN
    RAISE EXCEPTION 'Otro precio que el del cliente necesita autorización.';
  END IF;
  IF v_otro AND length(btrim(coalesce(p_motivo_precio, ''))) < 4 THEN
    RAISE EXCEPTION 'Escribe por qué va otro precio.';
  END IF;
  IF p_documento NOT IN ('consumidor_final', 'credito_fiscal') THEN RAISE EXCEPTION 'Elige el documento.'; END IF;
  IF p_documento = 'credito_fiscal' AND NOT EXISTS (
       SELECT 1 FROM public.customers c WHERE c.id = p_customer AND nullif(btrim(c.nrc), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'El crédito fiscal necesita un cliente con NRC.';
  END IF;

  v_c := public.preventa_cotizar(p_branch, p_customer, p_lineas);
  FOR l IN SELECT * FROM json_array_elements(v_c->'lineas') LOOP
    v_err := l->>'error';
    IF v_err IS NOT NULL THEN RAISE EXCEPTION '«%»: %', coalesce(l->>'nombre', l->>'producto_id'), v_err; END IF;
  END LOOP;

  SELECT erp_sucursal_id INTO v_erp FROM public.erp_sucursal_map WHERE branch_id = p_branch AND NOT es_bodega;
  IF v_erp IS NULL THEN RAISE EXCEPTION 'Esa sucursal no factura en la caja.'; END IF;

  IF p_preventa IS NOT NULL THEN
    SELECT * INTO pv FROM public.preventas WHERE id = p_preventa FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa no existe.'; END IF;
    IF pv.branch_id <> p_branch THEN RAISE EXCEPTION 'Esa preventa es de otra sucursal.'; END IF;
    IF pv.origen <> 'directa' THEN RAISE EXCEPTION 'Esa preventa es de una reserva: se corrige desde Reservas.'; END IF;
    IF pv.estado <> 'viva' OR pv.externo_id IS NULL THEN
      RAISE EXCEPTION 'Esa preventa ya no está en caja (%).', pv.estado;
    END IF;
    IF EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.erp_invoice_id = pv.externo_id AND si.branch_id = pv.branch_id) THEN
      RAISE EXCEPTION 'Esa preventa ya se facturó: no se puede corregir.';
    END IF;
    UPDATE public.preventas SET estado = 'enviando', customer_id = p_customer, enviada_por = p_employee,
           corregida_veces = corregida_veces + 1, error = NULL, updated_at = now()
     WHERE id = pv.id;
    v_id := pv.id;
  ELSE
    INSERT INTO public.preventas (branch_id, customer_id, reservas_ids, enviada_por, origen)
    VALUES (p_branch, p_customer, '{}', p_employee, 'directa') RETURNING id INTO v_id;
  END IF;

  RETURN json_build_object(
    'preventa_id', v_id, 'erp_sucursal', v_erp, 'branch_id', p_branch,
    'codigo', 'V-' || lpad(v_id::text, 6, '0'), 'tipo', 'directa',
    'externo_id', pv.externo_id, 'externo_ref', pv.externo_ref,
    'documento', p_documento, 'nota', left(btrim(coalesce(p_nota, '')), 60),
    'motivo_precio', CASE WHEN v_otro THEN btrim(p_motivo_precio) END,
    'cliente', (SELECT json_build_object('erp_id', c.erp_id, 'name', c.name) FROM public.customers c WHERE c.id = p_customer),
    'vendedor', json_build_object('code', e.code, 'role_id', e.role_id),
    'pagado', 0, 'falta_pagar', NULL,
    'renglones', (SELECT json_agg(json_build_object(
        'reserva_id', NULL, 'producto_id', x->'producto_id', 'nombre', x->>'nombre', 'cantidad', x->'cantidad',
        'factor', x->'factor', 'precio_unitario', x->'precio', 'precio_normal', x->'precio_regular',
        'lista_precio', x->>'lista'))
      FROM json_array_elements(v_c->'lineas') x));
END $$;
REVOKE ALL ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_directa_preparar(uuid, bigint, bigint, text, text, jsonb, bigint, text) TO service_role;

-- Registrar: igual que antes, más dos cosas. Una CORRECCIÓN que falla no deja
-- la preventa como «fallida»: la de la caja sigue viva con lo de antes. Y la
-- directa firma su propia acción en el registro.
CREATE OR REPLACE FUNCTION public.preventa_registrar(
  p_id bigint, p_ok boolean, p_venta jsonb DEFAULT NULL, p_externo_id text DEFAULT NULL,
  p_externo_ref text DEFAULT NULL, p_destino jsonb DEFAULT NULL, p_error text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE pv public.preventas;
BEGIN
  UPDATE public.preventas
     SET estado = CASE WHEN NOT p_ok AND externo_id IS NOT NULL THEN 'viva'
                       WHEN NOT p_ok THEN 'fallida'
                       WHEN nullif(coalesce(p_externo_id, externo_id), '') IS NULL THEN 'sin_enlace' ELSE 'viva' END,
         venta = CASE WHEN p_ok OR externo_id IS NULL THEN coalesce(p_venta, venta) ELSE venta END,
         total = CASE WHEN p_ok OR externo_id IS NULL THEN coalesce((p_venta->>'total')::numeric, total) ELSE total END,
         vendedor_codigo = coalesce(p_venta->>'vendedor', vendedor_codigo),
         externo_id = coalesce(nullif(p_externo_id, ''), externo_id),
         externo_ref = coalesce(nullif(p_externo_ref, ''), externo_ref),
         destino = CASE WHEN p_ok OR externo_id IS NULL THEN p_destino ELSE destino END, error = p_error,
         enviada_at = CASE WHEN p_ok THEN now() ELSE enviada_at END, updated_at = now()
   WHERE id = p_id AND estado = 'enviando'
  RETURNING * INTO pv;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa ya no se está enviando.'; END IF;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (pv.enviada_por,
          CASE WHEN pv.origen = 'directa' THEN
                 CASE WHEN NOT p_ok THEN 'PREVENTA_FALLIDA' WHEN pv.corregida_veces > 0 THEN 'PREVENTA_CORREGIDA' ELSE 'PREVENTA_ENVIADA' END
               WHEN p_ok THEN 'RESERVA_PREVENTA_ENVIADA' ELSE 'RESERVA_PREVENTA_FALLIDA' END,
          CASE WHEN pv.origen = 'directa' THEN pv.id::text ELSE array_to_string(pv.reservas_ids, ',') END,
          jsonb_build_object('preventa', pv.id, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref,
                             'total', pv.total, 'error', p_error), pv.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', pv.id, 'estado', pv.estado, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.preventa_registrar(bigint, boolean, jsonb, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_registrar(bigint, boolean, jsonb, text, text, jsonb, text) TO service_role;

-- Anular: la edge function ya la borró de la caja; acá queda «descartada».
CREATE OR REPLACE FUNCTION public.preventa_anular(p_employee uuid, p_id bigint, p_paso text DEFAULT 'revisar')
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE pv public.preventas;
BEGIN
  SELECT * INTO pv FROM public.preventas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa preventa no existe.'; END IF;
  IF NOT public.preventa_puede(p_employee, pv.branch_id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF pv.origen <> 'directa' THEN RAISE EXCEPTION 'Esa preventa es de una reserva: se maneja desde Reservas.'; END IF;
  IF pv.estado NOT IN ('viva', 'fallida', 'sin_enlace') THEN RAISE EXCEPTION 'Esa preventa ya está %.', pv.estado; END IF;
  IF pv.externo_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.sales_invoices si WHERE si.erp_invoice_id = pv.externo_id AND si.branch_id = pv.branch_id) THEN
    RAISE EXCEPTION 'Esa preventa ya se facturó: no se puede anular.';
  END IF;
  IF p_paso = 'revisar' THEN
    RETURN json_build_object('id', pv.id, 'externo_id', pv.externo_id, 'branch_id', pv.branch_id,
      'erp_sucursal', (SELECT erp_sucursal_id FROM public.erp_sucursal_map WHERE branch_id = pv.branch_id AND NOT es_bodega),
      'vendedor', pv.vendedor_codigo,
      'productos', (SELECT json_agg((r->>'producto_id')::int) FROM jsonb_array_elements(coalesce(pv.venta->'renglones', '[]')) r));
  END IF;
  UPDATE public.preventas SET estado = 'descartada', anulada_por = p_employee, anulada_at = now(), updated_at = now()
   WHERE id = pv.id;
  INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
  VALUES (p_employee, 'PREVENTA_ANULADA', pv.id::text,
          jsonb_build_object('preventa', pv.id, 'externo_id', pv.externo_id, 'referencia', pv.externo_ref, 'total', pv.total),
          pv.branch_id, 'ADMIN_PANEL');
  RETURN json_build_object('id', pv.id, 'estado', 'descartada');
END $$;
REVOKE ALL ON FUNCTION public.preventa_anular(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preventa_anular(uuid, bigint, text) TO service_role;

-- La lista de la pantalla: las preventas directas de la sala, de hoy hacia atrás.
CREATE OR REPLACE FUNCTION public.preventas_de_sala(p_branch bigint, p_dias integer DEFAULT 1)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.preventa_puede(public.auth_employee_id(), p_branch, 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(json_agg(json_build_object(
      'id', pv.id, 'codigo', 'V-' || lpad(pv.id::text, 6, '0'), 'estado', pv.estado, 'total', pv.total,
      'externo_ref', pv.externo_ref, 'customer_id', pv.customer_id, 'cliente', c.name,
      'enviada_por', pv.enviada_por, 'vendedor', em.name, 'enviada_at', pv.enviada_at, 'created_at', pv.created_at,
      'corregida_veces', pv.corregida_veces, 'error', pv.error, 'venta', pv.venta, 'avisos', pv.destino->'avisos',
      'factura', si.correlativo, 'facturada_at', pv.facturada_at, 'anulada_at', pv.anulada_at)
      ORDER BY pv.created_at DESC), '[]'::json)
    FROM public.preventas pv
    LEFT JOIN public.customers c ON c.id = pv.customer_id
    LEFT JOIN public.employees em ON em.id = pv.enviada_por
    LEFT JOIN public.sales_invoices si ON si.id = pv.sales_invoice_id
   WHERE pv.branch_id = p_branch AND pv.origen = 'directa'
     AND pv.created_at >= (date_trunc('day', now() AT TIME ZONE 'America/El_Salvador') - make_interval(days => greatest(coalesce(p_dias, 1), 1) - 1))
                           AT TIME ZONE 'America/El_Salvador');
END $$;
REVOKE EXECUTE ON FUNCTION public.preventas_de_sala(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preventas_de_sala(bigint, integer) TO authenticated, service_role;

-- ── 3. El cierre por factura: la directa no avisa como reserva ──────────
-- Partido de la definición VIVA (pg_get_functiondef, 2026-11-16). Cambios:
-- un envío colgado que ya tenía número vuelve a «viva» (era una corrección), y
-- el aviso «Reserva facturada» sólo sale si hubo reservas.
CREATE OR REPLACE FUNCTION public.preventas_cerrar_facturadas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  p record; a record; k record;
  v_cerradas int := 0; v_dest uuid[]; v_pend text[]; v_ok text[]; v_cod text;
BEGIN
  -- Un envío que nunca contestó no traba la reserva para siempre.
  UPDATE public.preventas
     SET estado = CASE WHEN externo_id IS NOT NULL THEN 'viva' ELSE 'fallida' END,
         error = coalesce(error, 'el envío no terminó'), updated_at = now()
   WHERE estado = 'enviando' AND updated_at < now() - interval '10 minutes';

  FOR p IN
    SELECT pv.id, pv.branch_id, pv.reservas_ids, pv.externo_ref, si.id AS si_id, si.correlativo, si.codigo_generacion
      FROM public.preventas pv
      JOIN public.sales_invoices si ON si.erp_invoice_id = pv.externo_id
     WHERE pv.estado = 'viva' AND pv.sistema = 'caja' AND pv.externo_id IS NOT NULL
       AND si.branch_id = pv.branch_id AND public.venta_valida(si.estado)
       FOR UPDATE OF pv SKIP LOCKED
  LOOP
    UPDATE public.preventas
       SET estado = 'facturada', sales_invoice_id = p.si_id, codigo_generacion = p.codigo_generacion,
           facturada_at = now(), updated_at = now()
     WHERE id = p.id;
    IF cardinality(p.reservas_ids) = 0 THEN CONTINUE; END IF;
    v_pend := ARRAY[]::text[]; v_ok := ARRAY[]::text[];

    FOR a IN SELECT * FROM public.app_reservas WHERE id = ANY (p.reservas_ids) AND preventa_id = p.id ORDER BY id FOR UPDATE LOOP
      v_cod := coalesce(a.pedido, 'R-' || lpad(a.id::text, 6, '0'));
      SELECT * INTO k FROM public.reserva_cuenta(a.id);
      IF a.estado NOT IN ('pendiente', 'lista') THEN
        v_pend := v_pend || (v_cod || ' ya estaba ' || a.estado);
        CONTINUE;
      END IF;
      IF k.pagado > 0.004 AND NOT EXISTS (SELECT 1 FROM public.apartado_aplicaciones x WHERE x.reserva_id = a.id) THEN
        v_pend := v_pend || (v_cod || ': tiene $' || to_char(k.pagado, 'FM999990.00') || ' pagado; termínala con «Retirar»');
        CONTINUE;
      END IF;
      BEGIN
        UPDATE public.app_reservas
           SET estado = 'retirada', cerrada_at = now(), updated_at = now(),
               pago_estado = CASE WHEN pago_estado IN ('pendiente', 'anticipo') THEN 'pagado' ELSE pago_estado END,
               pagado_at = coalesce(pagado_at, now())
         WHERE id = a.id;
        INSERT INTO public.audit_logs (user_id, action, target_id, details, branch_id, source)
        VALUES (NULL, 'RESERVA_RETIRADA', a.id::text,
                jsonb_build_object('por', 'factura', 'preventa', p.id, 'factura', p.correlativo, 'sales_invoice_id', p.si_id),
                a.branch_id, 'SYSTEM');
        IF a.origen = 'app' THEN
          INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
          VALUES (a.customer_id, 'reserva', 'base:retirada:' || v_cod, '¡Gracias por tu compra!',
                  a.producto_nombre || ' ya es tuyo. Tu reserva quedó entregada.', '/reservas')
          ON CONFLICT (customer_id, tipo, ref) DO NOTHING;
        END IF;
        v_ok := v_ok || v_cod;
        v_cerradas := v_cerradas + 1;
      EXCEPTION WHEN OTHERS THEN
        v_pend := v_pend || (v_cod || ': no se pudo cerrar (' || SQLERRM || ')');
      END;
    END LOOP;

    v_dest := public.destinatarios_de_reservas(p.branch_id);
    IF v_dest IS NOT NULL THEN
      PERFORM public.notify_employees(v_dest, 'RESERVA_APP',
        CASE WHEN cardinality(v_pend) = 0 THEN 'Reserva entregada · ' ELSE 'Reserva facturada · ' END
          || coalesce(v_ok[1], split_part(coalesce(v_pend[1], ''), ':', 1)),
        CASE WHEN cardinality(v_ok) > 0 THEN 'Se cerró sola con la factura ' || coalesce(p.correlativo, '') || '.'
             ELSE 'Se facturó la preventa #' || coalesce(p.externo_ref, '') || '.' END
          || CASE WHEN cardinality(v_pend) > 0 THEN ' ' || array_to_string(v_pend, '. ') || '.' ELSE '' END,
        '/reservas', jsonb_build_object('check_key', 'reserva_facturada:' || p.id, 'preventa_id', p.id), true, p.branch_id::int);
    END IF;
  END LOOP;
  RETURN v_cerradas;
END;
$function$;

-- ── 4. El permiso: módulo `preventa`, de entrada sólo para los 4 cargos admin
-- (Talento Humano 11, Administrador 3, Gerente General 2, Supervisor/a de
-- Ventas 13). El resto lo da el usuario en Roles y permisos.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'preventa', true, true, true, 'ALL' FROM public.roles r
 WHERE r.id IN (2, 3, 11, 13)
   AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r.id AND x.module_key = 'preventa');
