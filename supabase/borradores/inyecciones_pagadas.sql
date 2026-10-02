-- ════════════════════════════════════════════════════════════════════════════
-- Aplicaciones de inyección PAGADAS: el control (borrador, 2026-10-02)
-- ════════════════════════════════════════════════════════════════════════════
--
-- BORRADOR. Probado en el entorno de pruebas con `execute_sql`; NO está en
-- producción. Al pasarlo a producción va por `apply_migration` y su archivo
-- nace en `supabase/migrations/` con la versión que devuelva el servidor.
--
-- ── Qué resuelve ────────────────────────────────────────────────────────────
-- Hasta hoy el cobro de una aplicación era un ingreso de caja con un detalle
-- de texto libre («Neurobion 25000», «1 NOMAGEST», «APLICACIÓN DE NEURABIÓN»)
-- y la pestaña Inyecciones lo ADIVINABA contra las ventas por hora y nombre.
-- Medido en septiembre: 947 cobros, 181 sin producto, 140 sin venta posible.
--
-- Pedido del usuario (2026-10-02): al cobrar se pregunta si la inyección se
-- compró aquí ($1) o la trajo el cliente ($2); la comprada se AMARRA a la
-- venta, y si la venta trae varias se pregunta cuáles y cuántas. Lo pagado y
-- no aplicado queda PENDIENTE a nombre del cliente y se canjea después.
--
-- ── Las piezas ──────────────────────────────────────────────────────────────
--   inyeccion_precios          lo que vale una aplicación, por origen
--   inyeccion_dosis_producto   cuántas aplicaciones trae cada presentación
--   inyeccion_aplicaciones     UNA fila por aplicación pagada: el control
--
-- ── Por qué las dosis son un catálogo y no una cuenta ───────────────────────
-- La factura no lo sabe. NEUROBION TRI PACK se vende «CAJA X 3 1x1» con
-- factor 1 y son tres aplicaciones; ANDIDEXA-A se vende en «CAJA 1x3»
-- (factor 3, tres) y en «UNIDAD 1x1» (una). Por eso la clave es producto +
-- presentación, y lo que guarda es «aplicaciones por unidad vendida». Mientras
-- supervisión no confirme, rige la sugerencia sacada del nombre.
--
-- ── Por qué nace sin confirmar ──────────────────────────────────────────────
-- `operar-caja` escribe la fila del portal ANTES de tocar la caja (si la caja
-- acepta y el portal no llega a anotarlo, queda plata sin respaldo). Si la
-- caja rechaza, la fila queda como intento visible. Una aplicación ligada a
-- ese intento NO puede ser canjeable: sería una aplicación pagada sin que haya
-- entrado un centavo. Por eso `confirmada` empieza en false y la pone en true
-- `operar-caja` recién cuando la caja aceptó.
--
-- ── Sin FK a sales_invoices / sales_invoice_items, a propósito ─────────────
-- Son tablas CALIENTES (sync cada minuto): una FK hacia ellas pide un lock que
-- choca con el sync, y además los renglones se identifican por
-- (invoice_id, linea_num), que es lo estable. Ver CLAUDE.md, incidente
-- 2026-07-08.
-- ════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

-- ── 1. Precios ──────────────────────────────────────────────────────────────
CREATE TABLE public.inyeccion_precios (
  origen          text PRIMARY KEY CHECK (origen IN ('COMPRADA', 'TRAIDA')),
  precio          numeric(8,2) NOT NULL CHECK (precio >= 0),
  actualizado_por uuid REFERENCES public.employees(id),
  actualizado_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.inyeccion_precios (origen, precio) VALUES ('COMPRADA', 1.00), ('TRAIDA', 2.00);

ALTER TABLE public.inyeccion_precios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inyeccion_precios FROM anon, authenticated;
GRANT SELECT ON public.inyeccion_precios TO authenticated;
GRANT ALL ON public.inyeccion_precios TO service_role;
CREATE POLICY bloqueo_global ON public.inyeccion_precios AS RESTRICTIVE
  FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY inyeccion_precios_select ON public.inyeccion_precios
  FOR SELECT TO authenticated USING (true);

-- ── 2. Aplicaciones por presentación ────────────────────────────────────────
CREATE TABLE public.inyeccion_dosis_producto (
  erp_product_id  integer  NOT NULL,
  id_presentacion integer  NOT NULL DEFAULT 0,   -- 0 = el renglón no traía presentación
  aplicaciones    smallint NOT NULL CHECK (aplicaciones BETWEEN 1 AND 20),
  confirmado_por  uuid REFERENCES public.employees(id),
  confirmado_at   timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (erp_product_id, id_presentacion)
);
ALTER TABLE public.inyeccion_dosis_producto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inyeccion_dosis_producto FROM anon, authenticated;
GRANT SELECT ON public.inyeccion_dosis_producto TO authenticated;
GRANT ALL ON public.inyeccion_dosis_producto TO service_role;
CREATE POLICY bloqueo_global ON public.inyeccion_dosis_producto AS RESTRICTIVE
  FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
CREATE POLICY inyeccion_dosis_producto_select ON public.inyeccion_dosis_producto
  FOR SELECT TO authenticated USING (true);

-- ── 3. El control: una fila por aplicación pagada ──────────────────────────
CREATE TABLE public.inyeccion_aplicaciones (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id          integer NOT NULL REFERENCES public.branches(id),
  origen             text    NOT NULL CHECK (origen IN ('COMPRADA', 'TRAIDA')),
  -- La venta y su renglón (sólo COMPRADA). Sin FK: ver el encabezado.
  invoice_id         bigint,
  linea_num          smallint,
  customer_id        bigint,
  cliente            text,
  producto           text    NOT NULL,
  precio             numeric(8,2) NOT NULL,
  cobro_id           bigint  NOT NULL REFERENCES public.caja_movimientos_portal(id),
  confirmada         boolean NOT NULL DEFAULT false,
  aplicada_at        timestamptz,
  aplicada_por       uuid REFERENCES public.employees(id),
  aplicada_branch_id integer REFERENCES public.branches(id),
  creada_por         uuid REFERENCES public.employees(id),
  -- Cuando la fila la creó supervisión ligando un cobro viejo a mano.
  vinculada_por      uuid REFERENCES public.employees(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((origen = 'COMPRADA') = (invoice_id IS NOT NULL AND linea_num IS NOT NULL)),
  CHECK ((aplicada_at IS NULL) = (aplicada_por IS NULL))
);
CREATE INDEX inyeccion_aplicaciones_cobro_idx    ON public.inyeccion_aplicaciones (cobro_id);
CREATE INDEX inyeccion_aplicaciones_venta_idx    ON public.inyeccion_aplicaciones (invoice_id, linea_num) WHERE invoice_id IS NOT NULL;
CREATE INDEX inyeccion_aplicaciones_pend_idx     ON public.inyeccion_aplicaciones (branch_id, created_at) WHERE aplicada_at IS NULL;
CREATE INDEX inyeccion_aplicaciones_cliente_idx  ON public.inyeccion_aplicaciones (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX inyeccion_aplicaciones_branch_idx   ON public.inyeccion_aplicaciones (branch_id);
CREATE INDEX inyeccion_aplicaciones_abranch_idx  ON public.inyeccion_aplicaciones (aplicada_branch_id) WHERE aplicada_branch_id IS NOT NULL;

ALTER TABLE public.inyeccion_aplicaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inyeccion_aplicaciones FROM anon, authenticated;
GRANT SELECT ON public.inyeccion_aplicaciones TO authenticated;
-- service_role explícito: en este proyecto una tabla nueva NO lo hereda.
-- Sin esto `operar-caja` no puede confirmar (medido en pruebas: permission denied).
GRANT ALL ON public.inyeccion_aplicaciones TO service_role;
CREATE POLICY bloqueo_global ON public.inyeccion_aplicaciones AS RESTRICTIVE
  FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));
-- Lo ve quien ve la caja (su sala o todas) y supervisión desde Inyecciones.
-- Las escrituras van SOLO por las funciones de abajo.
CREATE POLICY inyeccion_aplicaciones_select ON public.inyeccion_aplicaciones
  FOR SELECT TO authenticated USING (
    (SELECT public.auth_has_module_permission('ventas_tab_inyecciones', 'can_view'))
    OR ((SELECT public.auth_has_module_permission('caja_vales', 'can_view'))
        AND ((SELECT public.auth_module_scope('caja_vales')) = 'ALL'
             OR branch_id = (SELECT public.auth_employee_branch_id())))
  );

-- APLICACION lleva su propio diálogo, igual que el abono: lo decide la bandera
-- del catálogo y no un `if codigo ===` en la pantalla.
UPDATE public.caja_tipos_movimiento
   SET lleva_comprobante = true,
       leyenda = 'Se elige la venta, o se marca que el cliente trajo la inyección.'
 WHERE codigo = 'APLICACION';

-- ── Sugerencia: cuántas aplicaciones trae una unidad vendida ───────────────
-- Factor > 1: la presentación ya es un múltiplo de la ampolla (CAJA 1x3).
-- «UNIDAD …»: es la ampolla suelta de una caja, una sola.
-- Si no, se lee del nombre o la presentación: TRI PACK, «X 3 AMPOLLAS»,
-- «CAJA X 3». Es una sugerencia: supervisión la confirma.
CREATE OR REPLACE FUNCTION public.inyeccion_aplicaciones_sugeridas(
  p_descripcion text, p_presentacion text, p_factor integer)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public, extensions AS $$
  SELECT CASE
    WHEN coalesce(p_factor, 1) > 1 THEN least(p_factor, 20)
    WHEN upper(coalesce(p_presentacion, '')) LIKE 'UNIDAD%' THEN 1
    WHEN upper(coalesce(p_descripcion, '')) ~ 'TRI\s*PACK' THEN 3
    WHEN upper(coalesce(p_descripcion, '')) ~ 'X\s*\d+\s*AMP'
      THEN least(greatest(substring(upper(p_descripcion) FROM 'X\s*(\d+)\s*AMP')::int, 1), 20)
    WHEN upper(coalesce(p_presentacion, '')) ~ 'X\s*\d+\s'
      THEN least(greatest(substring(upper(p_presentacion) FROM 'X\s*(\d+)\s')::int, 1), 20)
    ELSE 1
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_aplicaciones_sugeridas(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_aplicaciones_sugeridas(text, text, integer) TO authenticated, service_role;

-- ── Los renglones inyectables de una venta, con su saldo de aplicaciones ───
-- La ÚNICA respuesta a «cuántas quedan por pagar de este renglón». La usan la
-- lista del cobro, la cotización y el registro: escrita tres veces, el día que
-- una cambie la pantalla ofrecería lo que el servidor rechaza.
-- «Usadas» cuenta las confirmadas y las que están en vuelo (sin confirmar,
-- de los últimos 5 minutos): sin eso, dos cobros simultáneos verían el mismo
-- saldo. Una sin confirmar más vieja es un intento que la caja rechazó.
CREATE OR REPLACE FUNCTION public.inyeccion_renglones_de_venta(p_invoice_ids bigint[])
RETURNS TABLE (invoice_id bigint, linea_num smallint, erp_product_id integer, id_presentacion integer,
               descripcion text, presentacion text, cantidad numeric,
               por_unidad integer, confirmado boolean, total integer, usadas integer, disponibles integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
  WITH r AS (
    SELECT ii.invoice_id, ii.linea_num, ii.erp_product_id, coalesce(ii.id_presentacion, 0) AS id_presentacion,
           ii.descripcion, ii.presentacion, ii.cantidad,
           d.aplicaciones AS confirmadas_por_unidad,
           public.inyeccion_aplicaciones_sugeridas(ii.descripcion, ii.presentacion, ii.factor_unidades) AS sugeridas
    FROM public.sales_invoice_items ii
    LEFT JOIN public.inyeccion_dosis_producto d
      ON d.erp_product_id = ii.erp_product_id AND d.id_presentacion = coalesce(ii.id_presentacion, 0)
    WHERE ii.invoice_id = ANY (p_invoice_ids)
      AND public.es_inyectable(ii.descripcion)
  ), u AS (
    SELECT a.invoice_id, a.linea_num, count(*)::int AS usadas
    FROM public.inyeccion_aplicaciones a
    JOIN public.caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
    WHERE a.invoice_id = ANY (p_invoice_ids)
      AND (a.confirmada OR a.created_at > now() - interval '5 minutes')
    GROUP BY 1, 2
  )
  SELECT r.invoice_id, r.linea_num, r.erp_product_id, r.id_presentacion, r.descripcion, r.presentacion, r.cantidad,
         coalesce(r.confirmadas_por_unidad, r.sugeridas)::int,
         r.confirmadas_por_unidad IS NOT NULL,
         floor(r.cantidad * coalesce(r.confirmadas_por_unidad, r.sugeridas))::int,
         coalesce(u.usadas, 0),
         greatest(floor(r.cantidad * coalesce(r.confirmadas_por_unidad, r.sugeridas))::int - coalesce(u.usadas, 0), 0)
  FROM r LEFT JOIN u USING (invoice_id, linea_num);
$$;
-- Sólo interna: no tiene guarda propia, la ponen quienes la llaman.
REVOKE EXECUTE ON FUNCTION public.inyeccion_renglones_de_venta(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inyeccion_renglones_de_venta(bigint[]) TO service_role;

-- ── La lista para cobrar: ventas con inyección de la sala ──────────────────
-- Siete días hacia atrás por defecto: la sala cobra hoy casi siempre, pero un
-- cliente vuelve al día siguiente por la segunda del tri pack.
CREATE OR REPLACE FUNCTION public.inyecciones_para_cobrar(p_branch_id integer, p_buscar text DEFAULT NULL, p_dias integer DEFAULT 7)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
SET plan_cache_mode = 'force_custom_plan' AS $$
DECLARE
  v_ids    bigint[];
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Igual que `operar-caja`: sin alcance total, sólo la sala propia.
  IF coalesce((SELECT auth_module_scope('caja_vales')), '') <> 'ALL'
     AND p_branch_id IS DISTINCT FROM (SELECT auth_employee_branch_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(si.id) INTO v_ids
  FROM sales_invoices si
  WHERE si.branch_id = p_branch_id
    AND si.fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - greatest(least(coalesce(p_dias, 7), 31), 0)
    AND public.venta_valida(si.estado)
    AND (v_buscar IS NULL OR upper(si.cliente) LIKE '%' || v_buscar || '%' OR si.correlativo LIKE '%' || v_buscar || '%')
    AND EXISTS (SELECT 1 FROM sales_invoice_items ii
                WHERE ii.invoice_id = si.id AND public.es_inyectable(ii.descripcion));

  RETURN coalesce((
    SELECT json_agg(v ORDER BY v.fecha DESC, v.hora DESC NULLS LAST, v.id DESC)
    FROM (
      SELECT si.id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora, si.correlativo, si.cliente,
             si.customer_id, si.cod_vendedor, ev.name AS vendedor_nombre, ev.id AS vendedor_id,
             json_agg(json_build_object(
               'linea_num', r.linea_num, 'descripcion', r.descripcion, 'presentacion', r.presentacion,
               'cantidad', r.cantidad, 'por_unidad', r.por_unidad, 'confirmado', r.confirmado,
               'total', r.total, 'usadas', r.usadas, 'disponibles', r.disponibles
             ) ORDER BY r.linea_num) AS renglones,
             sum(r.disponibles) AS disponibles
      FROM sales_invoices si
      JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      WHERE si.id = ANY (v_ids)
      GROUP BY si.id, ev.name, ev.id
      ORDER BY si.fecha DESC, si.hora DESC NULLS LAST
      LIMIT 80
    ) v
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyecciones_para_cobrar(integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyecciones_para_cobrar(integer, text, integer) TO authenticated, service_role;

-- ── Cotizar: cuánto se cobra y qué dice el concepto ────────────────────────
-- La llama `operar-caja` ANTES de escribir el movimiento: el monto lo decide el
-- servidor con el precio vigente, nunca el navegador. Valida que cada renglón
-- sea de la sala y tenga saldo. No escribe nada.
--
-- p_items: [{invoice_id, linea_num, cantidad}] (COMPRADA)
-- p_cantidad / p_producto: lo traído (TRAIDA)
CREATE OR REPLACE FUNCTION public.inyeccion_cotizar(
  p_branch_id integer, p_origen text, p_items jsonb, p_cantidad integer, p_producto text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_precio   numeric;
  v_total    integer := 0;
  v_ids      bigint[];
  v_producto text;
  v_falta    text;
  v_venta    record;
BEGIN
  -- COMPRADA_SUELTA: se compró aquí pero la venta todavía no llegó al portal.
  -- Se cobra como comprada y queda sin amarrar (ver `operar-caja`).
  IF p_origen NOT IN ('COMPRADA', 'TRAIDA', 'COMPRADA_SUELTA') THEN RAISE EXCEPTION 'Falta si la inyección se compró aquí o la trajo el cliente.'; END IF;
  SELECT precio INTO v_precio FROM inyeccion_precios
   WHERE origen = CASE WHEN p_origen = 'COMPRADA_SUELTA' THEN 'COMPRADA' ELSE p_origen END;
  IF v_precio IS NULL THEN RAISE EXCEPTION 'No hay precio para %.', p_origen; END IF;

  IF p_origen IN ('TRAIDA', 'COMPRADA_SUELTA') THEN
    v_producto := nullif(trim(coalesce(p_producto, '')), '');
    IF v_producto IS NULL THEN RAISE EXCEPTION 'Falta qué inyección trajo el cliente.'; END IF;
    IF coalesce(p_cantidad, 0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'La cantidad de aplicaciones no es válida.'; END IF;
    RETURN json_build_object('precio', v_precio, 'aplicaciones', p_cantidad,
      'monto', round(v_precio * p_cantidad, 2),
      'detalle', CASE WHEN p_origen = 'TRAIDA' THEN 'Traida · ' ELSE 'Sin venta · ' END
                 || p_cantidad || 'x ' || upper(v_producto));
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Falta elegir qué inyecciones de la venta se pagan.';
  END IF;
  SELECT array_agg(DISTINCT (e->>'invoice_id')::bigint) INTO v_ids FROM jsonb_array_elements(p_items) e;
  IF array_length(v_ids, 1) > 1 THEN RAISE EXCEPTION 'Un cobro se amarra a una sola venta.'; END IF;

  SELECT id, branch_id, correlativo INTO v_venta FROM sales_invoices WHERE id = v_ids[1] AND public.venta_valida(estado);
  IF v_venta.id IS NULL THEN RAISE EXCEPTION 'Esa venta no existe o está anulada.'; END IF;
  IF v_venta.branch_id <> p_branch_id THEN RAISE EXCEPTION 'Esa venta es de otra sala.'; END IF;

  -- Cada renglón pedido: que exista, sea inyectable y alcance el saldo.
  SELECT string_agg(coalesce(r.descripcion, 'renglón ' || (e->>'linea_num')), ', ') INTO v_falta
  FROM jsonb_array_elements(p_items) e
  LEFT JOIN public.inyeccion_renglones_de_venta(v_ids) r
    ON r.linea_num = (e->>'linea_num')::smallint
  WHERE r.linea_num IS NULL
     OR coalesce((e->>'cantidad')::int, 0) < 1
     OR (e->>'cantidad')::int > r.disponibles;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Ya no quedan esas aplicaciones por pagar: %.', v_falta;
  END IF;

  SELECT sum((e->>'cantidad')::int),
         string_agg((e->>'cantidad') || 'x ' || r.descripcion, ', ' ORDER BY r.linea_num)
    INTO v_total, v_producto
  FROM jsonb_array_elements(p_items) e
  JOIN public.inyeccion_renglones_de_venta(v_ids) r ON r.linea_num = (e->>'linea_num')::smallint;

  RETURN json_build_object('precio', v_precio, 'aplicaciones', v_total,
    'monto', round(v_precio * v_total, 2),
    'detalle', 'Fac ' || regexp_replace(coalesce(v_venta.correlativo, ''), '^0+', '') || ' · ' || v_producto);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_cotizar(integer, text, jsonb, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inyeccion_cotizar(integer, text, jsonb, integer, text) TO service_role;

-- ── Registrar las aplicaciones de un cobro ─────────────────────────────────
-- La llama `operar-caja` DESPUÉS de escribir el movimiento y ANTES de tocar la
-- caja. Vuelve a validar bajo candado —entre cotizar y registrar hay un hueco
-- y otra sala pudo cobrar el mismo renglón— y escribe una fila por aplicación,
-- sin confirmar. `p_aplicar_ahora` marca las primeras N como aplicadas por
-- quien cobra: lo normal es pagar y aplicar en el mismo acto.
CREATE OR REPLACE FUNCTION public.inyeccion_registrar(
  p_cobro_id bigint, p_origen text, p_items jsonb, p_cantidad integer, p_producto text,
  p_aplicar_ahora integer, p_por uuid)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_cobro  record;
  v_cot    json;
  v_precio numeric;
  v_venta  record;
  v_hechas integer := 0;
  v_ahora  integer := greatest(coalesce(p_aplicar_ahora, 0), 0);
  e        jsonb;
  r        record;
  i        integer;
BEGIN
  SELECT id, branch_id, tipo_codigo, anulado_at INTO v_cobro FROM caja_movimientos_portal WHERE id = p_cobro_id;
  IF v_cobro.id IS NULL OR v_cobro.tipo_codigo <> 'APLICACION' OR v_cobro.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El cobro no es una aplicación vigente.';
  END IF;
  IF EXISTS (SELECT 1 FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id) THEN
    RAISE EXCEPTION 'Ese cobro ya tiene sus aplicaciones.';
  END IF;

  IF p_origen = 'COMPRADA' THEN
    -- Candado por VENTA: dos cobros de la misma venta se ponen en fila; dos de
    -- ventas distintas no se esperan.
    PERFORM pg_advisory_xact_lock(hashtext('inyeccion_venta'), (p_items->0->>'invoice_id')::int);
  END IF;
  v_cot := public.inyeccion_cotizar(v_cobro.branch_id, p_origen, p_items, p_cantidad, p_producto);
  v_precio := (v_cot->>'precio')::numeric;

  IF p_origen = 'TRAIDA' THEN
    FOR i IN 1..p_cantidad LOOP
      INSERT INTO inyeccion_aplicaciones (branch_id, origen, producto, precio, cobro_id, creada_por,
                                          aplicada_at, aplicada_por, aplicada_branch_id)
      VALUES (v_cobro.branch_id, 'TRAIDA', upper(trim(p_producto)), v_precio, p_cobro_id, p_por,
              CASE WHEN v_hechas < v_ahora THEN now() END,
              CASE WHEN v_hechas < v_ahora THEN p_por END,
              CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END);
      v_hechas := v_hechas + 1;
    END LOOP;
  ELSE
    SELECT id, customer_id, cliente INTO v_venta FROM sales_invoices WHERE id = (p_items->0->>'invoice_id')::bigint;
    FOR e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      SELECT descripcion INTO r FROM sales_invoice_items
       WHERE invoice_id = v_venta.id AND linea_num = (e->>'linea_num')::smallint;
      FOR i IN 1..(e->>'cantidad')::int LOOP
        INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente,
                                            producto, precio, cobro_id, creada_por,
                                            aplicada_at, aplicada_por, aplicada_branch_id)
        VALUES (v_cobro.branch_id, 'COMPRADA', v_venta.id, (e->>'linea_num')::smallint, v_venta.customer_id,
                v_venta.cliente, r.descripcion, v_precio, p_cobro_id, p_por,
                CASE WHEN v_hechas < v_ahora THEN now() END,
                CASE WHEN v_hechas < v_ahora THEN p_por END,
                CASE WHEN v_hechas < v_ahora THEN v_cobro.branch_id END);
        v_hechas := v_hechas + 1;
      END LOOP;
    END LOOP;
  END IF;

  RETURN json_build_object('aplicaciones', v_hechas, 'aplicadas_ahora', least(v_ahora, v_hechas),
                           'monto', v_cot->'monto', 'detalle', v_cot->'detalle');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_registrar(bigint, text, jsonb, integer, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inyeccion_registrar(bigint, text, jsonb, integer, text, integer, uuid) TO service_role;

-- ── Las pendientes: qué tiene pagado y sin aplicar ─────────────────────────
-- Se busca por cliente, factura o producto. Todas las salas: el cliente puede
-- volver a otra; la fila dice dónde pagó.
CREATE OR REPLACE FUNCTION public.inyecciones_pendientes(p_buscar text DEFAULT NULL, p_branch_id integer DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_buscar text := nullif(upper(trim(coalesce(p_buscar, ''))), '');
BEGIN
  IF NOT ((SELECT auth_has_module_permission('caja_vales', 'can_view'))
          OR (SELECT auth_has_module_permission('ventas_tab_inyecciones', 'can_view'))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.pagada_at DESC)
    FROM (
      SELECT a.id, a.branch_id, b.name AS sala, a.origen, a.invoice_id, si.correlativo,
             coalesce(a.cliente, si.cliente) AS cliente, a.customer_id, a.producto, a.precio,
             c.registrado_at AS pagada_at, ec.name AS cobrada_por, a.cobro_id
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      JOIN branches b ON b.id = a.branch_id
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN employees ec ON ec.id = c.registrado_por
      WHERE a.confirmada AND a.aplicada_at IS NULL
        AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
        AND (v_buscar IS NULL
             OR upper(coalesce(a.cliente, si.cliente, '')) LIKE '%' || v_buscar || '%'
             OR coalesce(si.correlativo, '') LIKE '%' || v_buscar || '%'
             OR upper(a.producto) LIKE '%' || v_buscar || '%')
      ORDER BY c.registrado_at DESC
      LIMIT 200
    ) x
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyecciones_pendientes(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyecciones_pendientes(text, integer) TO authenticated, service_role;

-- ── Canjear: marcar aplicadas ──────────────────────────────────────────────
-- Lo hace quien opera una caja; queda en la sala de quien la aplica, que puede
-- no ser la que cobró.
CREATE OR REPLACE FUNCTION public.inyeccion_aplicar(p_ids bigint[])
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp  uuid := (SELECT auth_employee_id());
  v_sala integer := (SELECT auth_employee_branch_id());
  v_n    integer;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT auth_has_module_permission('caja_vales', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE inyeccion_aplicaciones a
     SET aplicada_at = now(), aplicada_por = v_emp, aplicada_branch_id = coalesce(v_sala, a.branch_id)
   WHERE a.id = ANY (p_ids) AND a.confirmada AND a.aplicada_at IS NULL
     AND EXISTS (SELECT 1 FROM caja_movimientos_portal c WHERE c.id = a.cobro_id AND c.anulado_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> coalesce(array_length(p_ids, 1), 0) THEN
    RAISE EXCEPTION 'Alguna de esas aplicaciones ya no está pendiente. Vuelve a buscar.';
  END IF;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_aplicar(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_aplicar(bigint[]) TO authenticated, service_role;

-- ── Supervisión: el catálogo de aplicaciones por presentación ──────────────
-- Las presentaciones inyectables vendidas en los últimos 90 días, con lo que
-- rige hoy y si ya lo confirmó alguien.
CREATE OR REPLACE FUNCTION public.inyeccion_catalogo_dosis()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT (SELECT auth_has_module_permission('ventas_tab_inyecciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    WITH f AS MATERIALIZED (
      SELECT min(id) lo, max(id) hi FROM sales_invoices
      WHERE fecha >= (now() AT TIME ZONE 'America/El_Salvador')::date - 90
    ), v AS MATERIALIZED (
      SELECT ii.erp_product_id, coalesce(ii.id_presentacion, 0) AS id_presentacion,
             max(ii.descripcion) AS descripcion, max(ii.presentacion) AS presentacion,
             max(ii.factor_unidades) AS factor, count(*) AS ventas
      FROM f JOIN sales_invoice_items ii ON ii.invoice_id BETWEEN f.lo AND f.hi
      WHERE ii.erp_product_id IS NOT NULL AND public.es_inyectable(ii.descripcion)
      GROUP BY 1, 2
    )
    SELECT json_agg(json_build_object(
             'erp_product_id', v.erp_product_id, 'id_presentacion', v.id_presentacion,
             'descripcion', v.descripcion, 'presentacion', v.presentacion, 'ventas', v.ventas,
             'sugeridas', public.inyeccion_aplicaciones_sugeridas(v.descripcion, v.presentacion, v.factor),
             'confirmadas', d.aplicaciones, 'confirmado_por', e.name, 'confirmado_at', d.confirmado_at
           ) ORDER BY (d.aplicaciones IS NOT NULL), v.ventas DESC)
    FROM v
    LEFT JOIN inyeccion_dosis_producto d USING (erp_product_id, id_presentacion)
    LEFT JOIN employees e ON e.id = d.confirmado_por
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_catalogo_dosis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_catalogo_dosis() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inyeccion_fijar_dosis(p_erp_product_id integer, p_id_presentacion integer, p_aplicaciones integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT (SELECT auth_has_module_permission('ventas_inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_aplicaciones, 0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Entre 1 y 20 aplicaciones.'; END IF;
  INSERT INTO inyeccion_dosis_producto (erp_product_id, id_presentacion, aplicaciones, confirmado_por, confirmado_at)
  VALUES (p_erp_product_id, coalesce(p_id_presentacion, 0), p_aplicaciones, (SELECT auth_employee_id()), now())
  ON CONFLICT (erp_product_id, id_presentacion) DO UPDATE
    SET aplicaciones = EXCLUDED.aplicaciones, confirmado_por = EXCLUDED.confirmado_por, confirmado_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_fijar_dosis(integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_fijar_dosis(integer, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.inyeccion_fijar_precio(p_origen text, p_precio numeric)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT (SELECT auth_has_module_permission('ventas_inyecciones_precios', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_precio IS NULL OR p_precio < 0 OR p_precio > 100 THEN RAISE EXCEPTION 'Precio no válido.'; END IF;
  UPDATE inyeccion_precios SET precio = round(p_precio, 2), actualizado_por = (SELECT auth_employee_id()), actualizado_at = now()
   WHERE origen = p_origen;
  IF NOT FOUND THEN RAISE EXCEPTION 'Origen no válido.'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_fijar_precio(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_fijar_precio(text, numeric) TO authenticated, service_role;

-- ── Supervisión: amarrar a mano un cobro que quedó suelto ──────────────────
-- Para los cobros de texto libre (los de antes, y los de «la venta no aparece
-- todavía»). Crea las aplicaciones como COMPRADA, confirmadas y aplicadas al
-- momento del cobro: es lo que pasó. Cuántas: monto / precio de COMPRADA.
CREATE OR REPLACE FUNCTION public.inyeccion_vincular_cobro(p_cobro_id bigint, p_invoice_id bigint, p_linea_num integer)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp   uuid := (SELECT auth_employee_id());
  v_cobro record;
  v_venta record;
  v_reng  record;
  v_n     integer;
  i       integer;
BEGIN
  IF NOT (SELECT auth_has_module_permission('ventas_inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT id, branch_id, monto, registrado_at, registrado_por, tipo_codigo, anulado_at INTO v_cobro
    FROM caja_movimientos_portal WHERE id = p_cobro_id;
  IF v_cobro.id IS NULL OR v_cobro.tipo_codigo <> 'APLICACION' OR v_cobro.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese cobro no es una aplicación vigente.';
  END IF;
  IF EXISTS (SELECT 1 FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id) THEN
    RAISE EXCEPTION 'Ese cobro ya está amarrado.';
  END IF;
  SELECT id, branch_id, customer_id, cliente INTO v_venta FROM sales_invoices
   WHERE id = p_invoice_id AND public.venta_valida(estado);
  IF v_venta.id IS NULL OR v_venta.branch_id <> v_cobro.branch_id THEN
    RAISE EXCEPTION 'La venta no existe, está anulada o es de otra sala.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inyeccion_venta'), p_invoice_id::int);
  SELECT * INTO v_reng FROM public.inyeccion_renglones_de_venta(ARRAY[p_invoice_id]) WHERE linea_num = p_linea_num;
  IF v_reng.linea_num IS NULL THEN RAISE EXCEPTION 'Ese renglón no es una inyección.'; END IF;
  v_n := greatest(round(v_cobro.monto / nullif((SELECT precio FROM inyeccion_precios WHERE origen = 'COMPRADA'), 0))::int, 1);
  IF v_n > v_reng.disponibles THEN
    RAISE EXCEPTION 'El cobro equivale a % aplicaciones y a ese renglón le quedan %.', v_n, v_reng.disponibles;
  END IF;
  FOR i IN 1..v_n LOOP
    INSERT INTO inyeccion_aplicaciones (branch_id, origen, invoice_id, linea_num, customer_id, cliente, producto,
                                        precio, cobro_id, confirmada, aplicada_at, aplicada_por, aplicada_branch_id,
                                        creada_por, vinculada_por)
    VALUES (v_cobro.branch_id, 'COMPRADA', p_invoice_id, p_linea_num, v_venta.customer_id, v_venta.cliente,
            v_reng.descripcion, round(v_cobro.monto / v_n, 2), p_cobro_id, true,
            v_cobro.registrado_at, coalesce(v_cobro.registrado_por, v_emp), v_cobro.branch_id, v_emp, v_emp);
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_vincular_cobro(bigint, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_vincular_cobro(bigint, bigint, integer) TO authenticated, service_role;

-- Deshacer SÓLO lo que se amarró a mano: lo registrado al cobrar es el acto de
-- la sala y no se borra desde una pantalla de supervisión.
CREATE OR REPLACE FUNCTION public.inyeccion_desvincular_cobro(p_cobro_id bigint)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_n integer;
BEGIN
  IF NOT (SELECT auth_has_module_permission('ventas_inyecciones_dosis', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id AND vinculada_por IS NULL) THEN
    RAISE EXCEPTION 'Ese cobro se amarró al cobrarse; no se deshace desde acá.';
  END IF;
  DELETE FROM inyeccion_aplicaciones WHERE cobro_id = p_cobro_id AND vinculada_por IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_desvincular_cobro(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_desvincular_cobro(bigint) TO authenticated, service_role;

-- ── La pestaña Inyecciones: primero lo REGISTRADO, después lo estimado ─────
-- Un cobro con filas en `inyeccion_aplicaciones` ya dice a qué venta va: no
-- entra al emparejamiento por hora y nombre. Ese emparejamiento queda sólo
-- para los cobros de texto libre (los de antes, y los de «la venta no aparece
-- todavía»), y la venta dice cuál de los dos le tocó (`vinculo`).
CREATE OR REPLACE FUNCTION public.get_inyecciones_aplicadas(p_branch_id integer, p_desde date, p_hasta date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_ids     bigint[];
  v_iny     text[];
  v_ventas  bigint[] := '{}';
  v_cobros  bigint[] := '{}';
  r         record;
BEGIN
  IF NOT (SELECT auth_has_module_permission('ventas_tab_inyecciones', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('ventas')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;
  IF p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'El rango no puede pasar de tres meses';
  END IF;

  -- (La pasada cara está explicada en 20260924145940.)
  WITH f AS MATERIALIZED (
    SELECT si.id FROM sales_invoices si
    WHERE si.fecha BETWEEN p_desde AND p_hasta
      AND (p_branch_id IS NULL OR si.branch_id = p_branch_id)
      AND public.venta_valida(si.estado)
      AND si.hora IS NOT NULL
  ), rango AS MATERIALIZED (
    SELECT min(id) AS lo, max(id) AS hi FROM f
  ), renglones AS MATERIALIZED (
    SELECT ii.invoice_id, ii.descripcion
    FROM rango JOIN sales_invoice_items ii ON ii.invoice_id BETWEEN rango.lo AND rango.hi
  ), descripciones AS MATERIALIZED (
    SELECT DISTINCT descripcion FROM renglones
  ), inyectables AS MATERIALIZED (
    SELECT descripcion FROM descripciones WHERE es_inyectable(descripcion)
  )
  SELECT coalesce((SELECT array_agg(descripcion) FROM inyectables), '{}'),
         coalesce((SELECT array_agg(DISTINCT x.invoice_id)
                     FROM renglones x
                     JOIN inyectables i ON i.descripcion = x.descripcion
                     JOIN f ON f.id = x.invoice_id), '{}')
    INTO v_iny, v_ids;

  -- Emparejamiento ESTIMADO, sólo entre lo que no tiene vínculo registrado.
  --   minutos entre venta y cobro
  --   + 5    si el cobro lo registró otra persona que el vendedor
  --   + 1000 si el cobro nombra un producto y la venta no lo tiene
  FOR r IN
    WITH ventas AS (
      SELECT si.id, si.branch_id, si.fecha, si.fecha + si.hora AS ts, si.cod_vendedor,
             translate(string_agg(upper(ii.descripcion), ' '), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS productos
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      WHERE si.id = ANY (v_ids)
        AND ii.descripcion = ANY (v_iny)
        AND NOT EXISTS (SELECT 1 FROM inyeccion_aplicaciones a WHERE a.invoice_id = si.id AND a.confirmada)
      GROUP BY si.id
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             (p.registrado_at AT TIME ZONE 'America/El_Salvador') AS ts,
             e.code,
             translate(upper(nullif(trim(split_part(p.concepto, '·', 2)), '')),
                       'ÁÉÍÓÚÜÑ', 'AEIOUUN') AS producto
      FROM caja_movimientos_portal p
      LEFT JOIN employees e ON e.id = p.registrado_por
      WHERE p.tipo_codigo = 'APLICACION'
        AND p.anulado_at IS NULL
        AND p.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
        AND NOT EXISTS (SELECT 1 FROM inyeccion_aplicaciones a WHERE a.cobro_id = p.id)
    )
    SELECT v.id AS venta_id, c.id AS cobro_id,
           abs(extract(epoch FROM c.ts - v.ts)) / 60
           + CASE WHEN c.code IS NOT DISTINCT FROM v.cod_vendedor THEN 0 ELSE 5 END
           + CASE WHEN c.producto IS NULL THEN 0
                  WHEN strpos(replace(v.productos, ' ', ''), replace(c.producto, ' ', '')) > 0 THEN 0
                  WHEN EXISTS (
                    SELECT 1 FROM regexp_split_to_table(c.producto, '[^A-Z0-9]+') w
                    WHERE length(w) >= 4
                      AND w NOT IN ('APLICACION', 'INYECCION', 'AMPOLLA', 'AMPOLLAS', 'VIAL')
                      AND strpos(v.productos, w) > 0) THEN 0
                  ELSE 1000 END AS puntaje
    FROM ventas v
    JOIN cobros c ON c.branch_id = v.branch_id AND c.fecha = v.fecha
     AND c.ts BETWEEN v.ts - interval '10 minutes' AND v.ts + interval '45 minutes'
    ORDER BY 3, 1, 2
  LOOP
    IF NOT (r.venta_id = ANY (v_ventas)) AND NOT (r.cobro_id = ANY (v_cobros)) THEN
      v_ventas := v_ventas || r.venta_id;
      v_cobros := v_cobros || r.cobro_id;
    END IF;
  END LOOP;

  RETURN (
    WITH pares AS (
      SELECT * FROM unnest(v_ventas, v_cobros) AS t(venta_id, cobro_id)
    ), registradas AS (
      -- Lo registrado: por venta, sus cobros y cuántas pagadas / aplicadas.
      SELECT a.invoice_id,
             count(*) AS pagadas,
             count(*) FILTER (WHERE a.aplicada_at IS NOT NULL) AS aplicadas,
             min(a.cobro_id) AS cobro_id,
             bool_or(a.vinculada_por IS NOT NULL) AS a_mano
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      WHERE a.confirmada AND a.invoice_id = ANY (v_ids)
      GROUP BY a.invoice_id
    ), dosis AS (
      SELECT invoice_id, sum(total) AS total FROM public.inyeccion_renglones_de_venta(v_ids) GROUP BY 1
    ), cobros AS (
      SELECT p.id, p.branch_id, p.fecha,
             to_char(p.registrado_at AT TIME ZONE 'America/El_Salvador', 'HH24:MI') AS hora,
             p.monto, p.concepto, p.registrado_por, e.name AS registrado_nombre,
             coalesce(pa.venta_id, (SELECT max(a.invoice_id) FROM inyeccion_aplicaciones a WHERE a.cobro_id = p.id)) AS venta_id,
             (SELECT max(a.origen) FROM inyeccion_aplicaciones a WHERE a.cobro_id = p.id) AS origen,
             (SELECT count(*) FROM inyeccion_aplicaciones a WHERE a.cobro_id = p.id) AS aplicaciones
      FROM caja_movimientos_portal p
      LEFT JOIN employees e ON e.id = p.registrado_por
      LEFT JOIN pares pa ON pa.cobro_id = p.id
      WHERE p.tipo_codigo = 'APLICACION'
        AND p.anulado_at IS NULL
        AND p.fecha BETWEEN p_desde AND p_hasta
        AND (p_branch_id IS NULL OR p.branch_id = p_branch_id)
    ), ventas AS (
      SELECT si.id, si.branch_id, si.fecha, to_char(si.hora, 'HH24:MI') AS hora,
             si.correlativo, si.cliente, si.cod_vendedor, ev.id AS vendedor_id, ev.name AS vendedor_nombre,
             json_agg(json_build_object('descripcion', ii.descripcion,
                                        'cantidad', ii.cantidad,
                                        'total', ii.total_linea,
                                        'linea_num', ii.linea_num) ORDER BY ii.linea_num) AS productos,
             sum(ii.cantidad) AS unidades,
             sum(ii.total_linea) AS total,
             coalesce(rg.cobro_id, pa.cobro_id) AS cobro_id,
             CASE WHEN rg.invoice_id IS NOT NULL THEN CASE WHEN rg.a_mano THEN 'a_mano' ELSE 'registrado' END
                  WHEN pa.cobro_id IS NOT NULL THEN 'estimado' END AS vinculo,
             coalesce(rg.pagadas, CASE WHEN pa.cobro_id IS NOT NULL THEN 1 ELSE 0 END) AS pagadas,
             coalesce(rg.aplicadas, CASE WHEN pa.cobro_id IS NOT NULL THEN 1 ELSE 0 END) AS aplicadas,
             max(d.total) AS dosis
      FROM sales_invoices si
      JOIN sales_invoice_items ii ON ii.invoice_id = si.id
      LEFT JOIN employees ev ON ev.code = si.cod_vendedor
      LEFT JOIN pares pa ON pa.venta_id = si.id
      LEFT JOIN registradas rg ON rg.invoice_id = si.id
      LEFT JOIN dosis d ON d.invoice_id = si.id
      WHERE si.id = ANY (v_ids)
        AND ii.descripcion = ANY (v_iny)
      GROUP BY si.id, ev.id, ev.name, pa.cobro_id, rg.invoice_id, rg.cobro_id, rg.a_mano, rg.pagadas, rg.aplicadas
    )
    SELECT json_build_object(
      'ventas', coalesce((
        SELECT json_agg(json_build_object(
                 'id', v.id, 'branch_id', v.branch_id, 'fecha', v.fecha, 'hora', v.hora,
                 'correlativo', v.correlativo, 'cliente', v.cliente,
                 'cod_vendedor', v.cod_vendedor, 'vendedor_id', v.vendedor_id,
                 'vendedor_nombre', v.vendedor_nombre,
                 'productos', v.productos, 'unidades', v.unidades, 'total', v.total,
                 'vinculo', v.vinculo, 'dosis', v.dosis, 'pagadas', v.pagadas, 'aplicadas', v.aplicadas,
                 'cobro', CASE WHEN c.id IS NULL THEN NULL ELSE json_build_object(
                   'id', c.id, 'hora', c.hora, 'monto', c.monto, 'concepto', c.concepto,
                   'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre) END
               ) ORDER BY v.fecha DESC, v.hora DESC, v.id DESC)
        FROM ventas v LEFT JOIN cobros c ON c.id = v.cobro_id
      ), '[]'::json),
      'cobros_sin_venta', coalesce((
        SELECT json_agg(json_build_object(
                 'id', c.id, 'branch_id', c.branch_id, 'fecha', c.fecha, 'hora', c.hora,
                 'monto', c.monto, 'concepto', c.concepto, 'origen', c.origen, 'aplicaciones', c.aplicaciones,
                 'registrado_por', c.registrado_por, 'registrado_nombre', c.registrado_nombre
               ) ORDER BY c.fecha DESC, c.hora DESC, c.id DESC)
        FROM cobros c WHERE c.venta_id IS NULL
      ), '[]'::json)
    )
  );
END;
$function$;

-- ── Los dos permisos nuevos ────────────────────────────────────────────────
-- Dosis y vínculos: supervisión. Precios: gerencia. En el branch se le dan a
-- los cargos que ya ven la pestaña; en producción, lo decide el usuario.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, k.key, true, true, false, 'ALL'
FROM public.role_permissions rp
CROSS JOIN (VALUES ('ventas_inyecciones_dosis'), ('ventas_inyecciones_precios')) k(key)
WHERE rp.module_key = 'ventas_tab_inyecciones' AND rp.can_view
  AND (k.key = 'ventas_inyecciones_dosis'
       OR rp.role_id IN (SELECT id FROM public.roles WHERE name IN ('Gerente General', 'Administrador', 'QA / Testing (CI)')))
ON CONFLICT DO NOTHING;
