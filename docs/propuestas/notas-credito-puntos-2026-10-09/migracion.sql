-- ════════════════════════════════════════════════════════════════════════════
-- PROPUESTA (NO APLICADA) — Notas de crédito de venta: relación NC→factura,
-- que no cuenten como venta, y descuento proporcional de puntos.
-- Agente C, 2026-10-09. Partido de las definiciones VIVAS (pg_get_functiondef)
-- de puntos_anular_venta y ventas_elegibles_puntos medidas ese día.
--
-- Decisiones:
--  * La relación va en una TABLA APARTE, no en una columna de sales_invoices:
--    sales_invoices es tabla caliente (sync cada minuto) y un ALTER TABLE ahí
--    pide ACCESS EXCLUSIVE (outage 2026-07-08). La tabla nueva no toca ningún
--    lock de sales_invoices salvo la FK (SHARE ROW EXCLUSIVE breve al crearla:
--    por eso igual va con lock_timeout y en ventana 06:00–11:59 UTC).
--  * El descuento es un tipo de salida NUEVO, 'nota_credito', con invoice_id =
--    la NC (no la factura). Reutilizar 'anulacion' con invoice_id = factura
--    rompería puntos_barrer_anulaciones (su NOT EXISTS de 'anulacion' daría la
--    factura por anulada y nunca le quitaría el resto si después se anula
--    entera) y puntos_sellar_estado (la marcaría RESTADA).
--  * Proporción: «las fracciones no acumulan» → se QUEDA floor(puntos × lo que
--    sigue comprado / total) y se quita el resto. Acumulativo por factura, así
--    dos NC parciales quitan lo mismo que una por la suma (idempotente).
--  * Si la factura ya está anulada, la NC no quita nada: lo hace la anulación.
--  * Si la NC se invalida, se devuelve lo quitado a los MISMOS lotes (patrón de
--    puntos_devolver_canjes_anulados).
--  * NO se toca puntos_consumir ni puntos_consumir_canje (sólo se LLAMA a
--    puntos_consumir, igual que hace puntos_anular_venta hoy).
-- ════════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

-- ── (a) La relación ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ventas_nota_credito (
  nc_invoice_id        bigint PRIMARY KEY REFERENCES public.sales_invoices(id) ON DELETE CASCADE,
  -- Tal cual llega del DTE: documentoRelacionado[0].numeroDocumento.
  -- tipoGeneracion 2 = codigoGeneracion (uuid) · 1 = número de control/físico.
  codigo_relacionado   text NOT NULL,
  tipo_generacion      smallint,
  -- Resuelto en la base (trigger de abajo); NULL = la factura todavía no está.
  factura_invoice_id   bigint REFERENCES public.sales_invoices(id) ON DELETE RESTRICT,
  -- Marca de «ya procesada» del motor de puntos (idempotencia), y lo que hizo.
  puntos_procesada_at  timestamptz,
  puntos_quitados      integer NOT NULL DEFAULT 0 CHECK (puntos_quitados >= 0),
  puntos_no_recuperados integer NOT NULL DEFAULT 0 CHECK (puntos_no_recuperados >= 0),
  puntos_revertida_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ventas_nota_credito_factura
  ON public.ventas_nota_credito (factura_invoice_id) WHERE factura_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ventas_nota_credito_pendiente
  ON public.ventas_nota_credito (nc_invoice_id) WHERE puntos_procesada_at IS NULL;

ALTER TABLE public.ventas_nota_credito ENABLE ROW LEVEL SECURITY;
-- Ve la relación quien ve la NC (el RLS de sales_invoices decide adentro).
-- Escribe sólo service_role (sync-dte-sales) → sin policies de escritura.
DROP POLICY IF EXISTS ventas_nota_credito_select ON public.ventas_nota_credito;
CREATE POLICY ventas_nota_credito_select ON public.ventas_nota_credito
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_invoices si WHERE si.id = nc_invoice_id));
REVOKE ALL ON public.ventas_nota_credito FROM anon;
GRANT SELECT ON public.ventas_nota_credito TO authenticated;

-- Resolver la factura por el código, al escribir la fila.
CREATE OR REPLACE FUNCTION public.ventas_nota_credito_resolver()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.factura_invoice_id IS NULL OR NEW.codigo_relacionado IS DISTINCT FROM OLD.codigo_relacionado THEN
    IF NEW.codigo_relacionado ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT si.id INTO NEW.factura_invoice_id
        FROM public.sales_invoices si
       WHERE si.codigo_generacion = NEW.codigo_relacionado::uuid;     -- índice único
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.ventas_nota_credito_resolver() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS ventas_nota_credito_resolver ON public.ventas_nota_credito;
CREATE TRIGGER ventas_nota_credito_resolver
  BEFORE INSERT OR UPDATE ON public.ventas_nota_credito
  FOR EACH ROW EXECUTE FUNCTION public.ventas_nota_credito_resolver();

-- ── (b) Las NC no cuentan como venta ────────────────────────────────────────
-- venta_valida(estado) no ve el tipo, y la usan 68 funciones (55 de ellas sin
-- ningún filtro de tipo_documento). Cambiarle la firma es reescribir 68. Se
-- agrega la sobrecarga de DOS argumentos —lista blanca, igual que el estado:
-- un tipo que nadie conoce NO cuenta— y se migra por tandas; ésta lleva las del
-- motor de puntos, que son las que pueden REGALAR puntos por una NC.
-- Sin SET search_path a propósito (como venta_valida): así se inlinea.
CREATE OR REPLACE FUNCTION public.venta_valida(p_estado text, p_tipo_documento text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT p_estado = 'FINALIZADA' AND p_tipo_documento IN ('COF', 'CCF') $$;
REVOKE EXECUTE ON FUNCTION public.venta_valida(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venta_valida(text, text) TO authenticated, service_role;

-- ventas_elegibles_puntos: definición VIVA del 2026-10-09 + UNA línea
-- (venta_valida de dos argumentos). Sin esto una NC FINALIZADA de $5 con
-- vendedor y cliente daría 5 puntos en vez de quitarlos.
CREATE OR REPLACE FUNCTION public.ventas_elegibles_puntos(p_desde date, p_hasta date, p_margen numeric DEFAULT 0.02, p_tope integer DEFAULT 100000)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE v json;
BEGIN
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v FROM (
    WITH inv AS (
      SELECT si.id, b.codigo_puntos AS sucursal, si.erp_invoice_id, si.correlativo,
             si.customer_id, si.cod_vendedor::int AS cod_vendedor, si.total, si.fecha
      FROM public.sales_invoices si
      JOIN public.branches b
        ON b.id = si.branch_id AND b.codigo_puntos IS NOT NULL
      LEFT JOIN public.customers cu ON cu.id = si.customer_id
      WHERE si.fecha BETWEEN p_desde AND p_hasta
        AND public.venta_valida(si.estado)
        -- Una nota de crédito no es una venta (2026-10-09): no gana puntos,
        -- los QUITA (puntos_descontar_notas_credito).
        AND public.venta_valida(si.estado, si.tipo_documento)
        -- Cláusula 3.2: «vale US$1.00 o más». El circuito viejo usa `> 1`.
        AND si.total >= 1
        AND si.cod_vendedor ~ '^[0-9]{1,9}$'
        AND coalesce(cu.acumula_puntos, true)
        -- Quien salió del programa desde «Mis puntos» no acumula (2026-09-28).
        AND cu.acepta_programa_puntos IS DISTINCT FROM false
        -- Sólo las que todavía NO tienen su lote (2026-10-05). El motor corre
        -- cada minuto sobre 3 días y `puntos_acumular` ya descartaba estas
        -- después — pero recién DESPUÉS de evaluar cada renglón contra el
        -- historial de precios. Lo marcó `gate:perf` sección F: ~31,700
        -- bloques por llamada en 4,594 llamadas. Mismo resultado: el índice
        -- único de `puntos_lote.invoice_id` ya impedía acreditar dos veces.
        AND NOT EXISTS (SELECT 1 FROM public.puntos_lote pl WHERE pl.invoice_id = si.id)
    ),
    pv AS (
      SELECT p.product_id, p.id_presentacion,
             upper(regexp_replace(coalesce(pr.tipo,'') || ' ' || coalesce(p.descripcion,''),
                                  '\s+', ' ', 'g')) AS pkey,
             p.vineta, p.descuento_1, p.vip
      FROM public.product_precios p
      LEFT JOIN public.presentaciones pr ON pr.id = p.id_presentacion
      WHERE p.activo
    ),
    lin AS (
      SELECT ii.invoice_id, ii.precio_unitario, ii.erp_product_id, inv.fecha,
             upper(regexp_replace(coalesce(ii.presentacion,''), '\s+', ' ', 'g')) AS pkey,
             -- La lista por producto manda sobre el laboratorio (2026-09-28):
             -- chips y bebidas cargados en un laboratorio de farmacia.
             coalesce(lab.acumula_puntos, true)
               AND NOT EXISTS (SELECT 1 FROM public.puntos_producto_no_acumula x
                                WHERE x.product_id = ii.erp_product_id) AS acumula
      FROM public.sales_invoice_items ii
      JOIN inv ON inv.id = ii.invoice_id
      LEFT JOIN public.products      prd ON prd.id = ii.erp_product_id
      LEFT JOIN public.laboratorios  lab ON lab.id = prd.laboratorio_id
    ),
    ok AS (
      SELECT lin.invoice_id, lin.acumula,
             EXISTS (
               SELECT 1
               FROM pv
               CROSS JOIN LATERAL (
                 SELECT coalesce(h.vineta,      pv.vineta)      AS p1,
                        coalesce(h.descuento_1, pv.descuento_1) AS p2,
                        coalesce(h.vip,         pv.vip)         AS p3
                 FROM (SELECT 1) z
                 LEFT JOIN LATERAL (
                   SELECT h2.vineta, h2.descuento_1, h2.vip
                   FROM public.product_precios_history h2
                   WHERE h2.product_id      = pv.product_id
                     AND h2.id_presentacion = pv.id_presentacion
                     AND h2.valid_from  <  (lin.fecha + 1)::timestamptz
                     AND (h2.valid_until IS NULL OR h2.valid_until >= lin.fecha::timestamptz)
                   ORDER BY h2.valid_from DESC
                   LIMIT 1
                 ) h ON true
               ) e
               WHERE pv.product_id = lin.erp_product_id
                 AND pv.pkey       = lin.pkey
                 AND coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) IS NOT NULL
                 AND lin.precio_unitario >=
                     coalesce(nullif(e.p3,0), nullif(e.p2,0), nullif(e.p1,0)) * (1 - p_margen)
             ) AS ok
      FROM lin
    ),
    agg AS (
      SELECT invoice_id,
             bool_and(ok)      AS todas,
             bool_or(acumula)  AS lleva_producto
      FROM ok GROUP BY 1
    )
    SELECT inv.id AS invoice_id, inv.sucursal, inv.erp_invoice_id, inv.correlativo,
           inv.customer_id, inv.cod_vendedor, inv.total, inv.fecha,
           -- «Por cada US$1.00 se otorga 1 punto. Las fracciones no acumulan.»
           floor(inv.total)::int AS puntos
    FROM inv
    JOIN agg ON agg.invoice_id = inv.id
    WHERE agg.todas AND agg.lleva_producto
    ORDER BY inv.fecha, inv.id
    LIMIT p_tope
  ) t;

  RETURN v;
END;
$function$;

-- ── (c) El descuento de puntos ──────────────────────────────────────────────
-- puntos_salida NO es tabla caliente (la escribe el motor una vez por minuto),
-- pero igual lock_timeout. El CHECK se recrea NOT VALID + VALIDATE para no
-- bloquear lecturas mientras valida.
ALTER TABLE public.puntos_salida DROP CONSTRAINT IF EXISTS puntos_salida_tipo_check;
ALTER TABLE public.puntos_salida ADD CONSTRAINT puntos_salida_tipo_check
  CHECK (tipo = ANY (ARRAY['canje','anulacion','vencimiento','ajuste','cambio_cliente','nota_credito'])) NOT VALID;
ALTER TABLE public.puntos_salida VALIDATE CONSTRAINT puntos_salida_tipo_check;
ALTER TABLE public.puntos_salida DROP CONSTRAINT IF EXISTS puntos_salida_nc_con_venta;
ALTER TABLE public.puntos_salida ADD CONSTRAINT puntos_salida_nc_con_venta
  CHECK (tipo <> 'nota_credito' OR invoice_id IS NOT NULL);
-- Idempotencia dura: una salida de NC por NC.
CREATE UNIQUE INDEX IF NOT EXISTS puntos_salida_una_por_nota_credito
  ON public.puntos_salida (invoice_id) WHERE tipo = 'nota_credito';

CREATE OR REPLACE FUNCTION public.puntos_descontar_notas_credito(
  p_desde date, p_hasta date, p_simular boolean DEFAULT true, p_tope integer DEFAULT 200)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record; l record; k record;
  v_total numeric; v_acreditado numeric; v_objetivo integer; v_ya integer;
  v_quitar integer; v_propios integer; v_otros integer; v_falta integer;
  v_saldo integer; v_salida bigint; v_vuelve integer;
  v_vistas int := 0; v_quitados bigint := 0; v_no_rec bigint := 0;
  v_revertidas int := 0; v_devueltos bigint := 0;
BEGIN
  p_desde := public.puntos_desde_efectivo(p_desde);

  -- 1 · NC válidas, ligadas a su factura, todavía sin procesar.
  FOR r IN
    SELECT nc.nc_invoice_id, nc.factura_invoice_id, ncs.correlativo AS nc_doc
      FROM public.ventas_nota_credito nc
      JOIN public.sales_invoices ncs ON ncs.id = nc.nc_invoice_id
     WHERE nc.puntos_procesada_at IS NULL
       AND nc.factura_invoice_id IS NOT NULL
       AND ncs.fecha BETWEEN p_desde AND p_hasta
       AND public.venta_valida(ncs.estado)          -- la NC misma no está anulada
     ORDER BY nc.nc_invoice_id
     LIMIT p_tope
     FOR UPDATE OF nc
  LOOP
    v_vistas := v_vistas + 1;

    SELECT pl.*, si.total AS factura_total, si.estado AS factura_estado
      INTO l
      FROM public.puntos_lote pl
      JOIN public.sales_invoices si ON si.id = pl.invoice_id
     WHERE pl.invoice_id = r.factura_invoice_id
     FOR UPDATE OF pl;

    -- La factura no dio puntos, o ya se anuló entera (eso lo resuelve la
    -- anulación): se marca procesada sin quitar nada.
    IF NOT FOUND OR NOT public.venta_valida(l.factura_estado) OR coalesce(l.factura_total, 0) <= 0 THEN
      IF NOT p_simular THEN
        UPDATE public.ventas_nota_credito SET puntos_procesada_at = now()
         WHERE nc_invoice_id = r.nc_invoice_id;
      END IF;
      CONTINUE;
    END IF;

    -- Lo acreditado por TODAS las NC válidas de esa factura hasta ésta.
    SELECT coalesce(sum(abs(s.total)), 0) INTO v_acreditado
      FROM public.ventas_nota_credito n
      JOIN public.sales_invoices s ON s.id = n.nc_invoice_id
     WHERE n.factura_invoice_id = r.factura_invoice_id
       AND n.nc_invoice_id <= r.nc_invoice_id
       AND public.venta_valida(s.estado);
    v_total := l.factura_total;
    -- Se queda floor(puntos × lo que sigue comprado / total); se quita el resto.
    v_objetivo := l.puntos - floor(l.puntos * greatest(v_total - v_acreditado, 0) / v_total)::int;
    -- Lo que ya se le quitó a esa factura por OTRAS NC (vigentes).
    SELECT coalesce(sum(n.puntos_quitados + n.puntos_no_recuperados), 0) INTO v_ya
      FROM public.ventas_nota_credito n
     WHERE n.factura_invoice_id = r.factura_invoice_id
       AND n.nc_invoice_id <> r.nc_invoice_id
       AND n.puntos_procesada_at IS NOT NULL AND n.puntos_revertida_at IS NULL;
    v_quitar := greatest(least(v_objetivo, l.puntos) - v_ya, 0);

    SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = l.customer_id FOR UPDATE;
    v_saldo := coalesce(v_saldo, 0);
    v_propios := least(l.restantes, v_quitar);
    v_otros := least(v_quitar - v_propios, greatest(v_saldo - v_propios, 0));
    v_falta := v_quitar - v_propios - v_otros;

    v_quitados := v_quitados + v_propios + v_otros;
    v_no_rec := v_no_rec + v_falta;
    CONTINUE WHEN p_simular;

    IF v_propios + v_otros > 0 THEN
      INSERT INTO public.puntos_salida (customer_id, tipo, puntos, invoice_id, sucursal, motivo)
      VALUES (l.customer_id, 'nota_credito', v_propios + v_otros, r.nc_invoice_id, l.sucursal,
              'nota de crédito' || coalesce(' · ' || r.nc_doc, '')
              || CASE WHEN v_otros > 0 THEN ' · los puntos de esa compra ya se habían usado; se tomaron de sus otros puntos' ELSE '' END
              || CASE WHEN v_falta > 0 THEN format(' · faltaron %s', v_falta) ELSE '' END)
      RETURNING id INTO v_salida;

      IF v_propios > 0 THEN
        UPDATE public.puntos_lote SET restantes = restantes - v_propios WHERE id = l.id;
        INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, l.id, v_propios);
      END IF;
      IF v_otros > 0 THEN
        IF public.puntos_consumir(l.customer_id, v_otros, v_salida) <> v_otros THEN
          RAISE EXCEPTION 'El libro no cuadra al aplicar la nota de crédito %', r.nc_invoice_id;
        END IF;
      END IF;

      UPDATE public.puntos_cuenta
         SET saldo = saldo - (v_propios + v_otros), usados = usados + (v_propios + v_otros), updated_at = now()
       WHERE customer_id = l.customer_id;
    END IF;

    UPDATE public.ventas_nota_credito
       SET puntos_procesada_at = now(), puntos_quitados = v_propios + v_otros,
           puntos_no_recuperados = v_falta
     WHERE nc_invoice_id = r.nc_invoice_id;
  END LOOP;

  -- 2 · NC que se invalidaron después de procesadas: se devuelve lo quitado a
  -- los mismos lotes (patrón de puntos_devolver_canjes_anulados).
  FOR r IN
    SELECT nc.nc_invoice_id, s.id AS salida_id, s.customer_id, s.puntos
      FROM public.ventas_nota_credito nc
      JOIN public.sales_invoices ncs ON ncs.id = nc.nc_invoice_id
      LEFT JOIN public.puntos_salida s ON s.invoice_id = nc.nc_invoice_id AND s.tipo = 'nota_credito'
     WHERE nc.puntos_procesada_at IS NOT NULL AND nc.puntos_revertida_at IS NULL
       AND ncs.fecha BETWEEN p_desde AND p_hasta
       AND NOT public.venta_valida(ncs.estado)
     ORDER BY nc.nc_invoice_id
     LIMIT p_tope
     FOR UPDATE OF nc
  LOOP
    v_revertidas := v_revertidas + 1;
    v_devueltos := v_devueltos + coalesce(r.puntos, 0);
    CONTINUE WHEN p_simular;
    IF r.salida_id IS NOT NULL THEN
      v_vuelve := 0;
      FOR k IN SELECT sl.lote_id, sl.puntos FROM public.puntos_salida_lote sl WHERE sl.salida_id = r.salida_id LOOP
        UPDATE public.puntos_lote SET restantes = restantes + k.puntos WHERE id = k.lote_id;
        v_vuelve := v_vuelve + k.puntos;
      END LOOP;
      UPDATE public.puntos_salida SET revertida_at = now(),
             motivo = motivo || ' · devuelto: la nota de crédito se anuló'
       WHERE id = r.salida_id;
      UPDATE public.puntos_cuenta
         SET saldo = saldo + v_vuelve, usados = usados - v_vuelve, updated_at = now()
       WHERE customer_id = r.customer_id;
    END IF;
    UPDATE public.ventas_nota_credito SET puntos_revertida_at = now()
     WHERE nc_invoice_id = r.nc_invoice_id;
  END LOOP;

  RETURN json_build_object('simulado', p_simular, 'desde', p_desde, 'hasta', p_hasta,
    'vistas', v_vistas, 'puntos_quitados', v_quitados, 'no_recuperados', v_no_rec,
    'nc_anuladas_devueltas', v_revertidas, 'puntos_devueltos', v_devueltos,
    'tope_alcanzado', v_vistas >= p_tope);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.puntos_descontar_notas_credito(date, date, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_descontar_notas_credito(date, date, boolean, integer) TO service_role;

-- puntos_anular_venta: definición VIVA del 2026-10-09 + descontar lo que ya
-- quitaron las NC vigentes de esa factura. Sin esto, anular una factura que
-- tuvo una NC quitaría DOS veces los puntos de la parte acreditada.
CREATE OR REPLACE FUNCTION public.puntos_anular_venta(p_invoice_id bigint, p_simular boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  l record; v_salida bigint;
  v_propios integer;   -- lo que queda en el lote de ESA compra
  v_otros integer := 0;  -- lo que se toma de otras compras
  v_saldo integer;
  v_falta integer;
  v_doc text;
  v_motivo text;
  v_por_nc integer;    -- lo que ya quitaron sus notas de crédito (2026-10-09)
  v_dio integer;       -- lo que queda por quitar de lo que dio
BEGIN
  SELECT * INTO l FROM public.puntos_lote WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', true, 'accion', 'ninguna', 'motivo', 'esa venta nunca dio puntos en el portal');
  END IF;

  SELECT coalesce(sum(n.puntos_quitados + n.puntos_no_recuperados), 0) INTO v_por_nc
    FROM public.ventas_nota_credito n
   WHERE n.factura_invoice_id = p_invoice_id
     AND n.puntos_procesada_at IS NOT NULL AND n.puntos_revertida_at IS NULL;
  v_dio := greatest(l.puntos - v_por_nc, 0);

  -- La cuenta tomada: el saldo que se lee es el que se descuenta.
  SELECT saldo INTO v_saldo FROM public.puntos_cuenta WHERE customer_id = l.customer_id FOR UPDATE;
  v_saldo := coalesce(v_saldo, 0);
  v_propios := least(l.restantes, v_dio);
  v_otros := least(v_dio - v_propios, greatest(v_saldo - v_propios, 0));
  v_falta := v_dio - v_propios - v_otros;

  IF p_simular THEN
    RETURN json_build_object('simulado', true, 'ok', true, 'dio', l.puntos,
                             'ya_quitados_por_nc', v_por_nc,
                             'se_quitan', v_propios + v_otros, 'de_otras_compras', v_otros,
                             'ya_gastados', v_falta);
  END IF;

  IF v_propios + v_otros > 0 THEN
    SELECT correlativo INTO v_doc FROM public.sales_invoices WHERE id = p_invoice_id;
    v_motivo := 'compra anulada' || coalesce(' · ' || v_doc, '')
      || CASE WHEN v_por_nc > 0 THEN format(' · %s ya se habían quitado por nota de crédito', v_por_nc) ELSE '' END
      || CASE WHEN v_otros > 0 THEN ' · sus puntos ya se habían usado; se tomaron de sus otros puntos' ELSE '' END
      || CASE WHEN v_falta > 0 THEN format(' · faltaron %s', v_falta) ELSE '' END;

    INSERT INTO public.puntos_salida (customer_id, tipo, puntos, invoice_id, sucursal, motivo)
    VALUES (l.customer_id, 'anulacion', v_propios + v_otros, p_invoice_id, l.sucursal, v_motivo)
    RETURNING id INTO v_salida;

    IF v_propios > 0 THEN
      UPDATE public.puntos_lote SET restantes = restantes - v_propios WHERE id = l.id;
      INSERT INTO public.puntos_salida_lote (salida_id, lote_id, puntos) VALUES (v_salida, l.id, v_propios);
    END IF;
    IF v_otros > 0 THEN
      -- De las otras compras, las más viejas primero (el lote propio ya está en 0).
      IF public.puntos_consumir(l.customer_id, v_otros, v_salida) <> v_otros THEN
        RAISE EXCEPTION 'El libro no cuadra al anular la venta %', p_invoice_id;
      END IF;
    END IF;

    UPDATE public.puntos_cuenta
       SET saldo = saldo - (v_propios + v_otros), usados = usados + (v_propios + v_otros), updated_at = now()
     WHERE customer_id = l.customer_id;
  END IF;

  -- Lo que ni con sus otros puntos alcanzó: queda a la vista en Avisos. Es
  -- además la marca de «ya procesada» para el barrido cuando no se quitó nada.
  -- (Con v_dio = 0 —todo lo quitaron sus NC— también se marca, con 0.)
  IF v_falta > 0 OR v_propios + v_otros = 0 THEN
    INSERT INTO public.puntos_anulacion_gastada (invoice_id, customer_id, sucursal, dio, no_recuperados)
    VALUES (p_invoice_id, l.customer_id, l.sucursal, v_dio, v_falta)
    ON CONFLICT (invoice_id) DO NOTHING;
  END IF;

  RETURN json_build_object('ok', true,
    'accion', CASE WHEN v_dio = 0 THEN 'sus notas de crédito ya habían quitado todo'
                   WHEN v_falta = 0 THEN 'retirados enteros'
                   WHEN v_propios + v_otros = 0 THEN 'no tenía puntos para quitar'
                   ELSE 'retirados en parte' END,
    'dio', l.puntos, 'ya_quitados_por_nc', v_por_nc, 'se_quitaron', v_propios + v_otros,
    'de_otras_compras', v_otros, 'no_recuperados', v_falta);
END;
$function$;

-- NOTA de diseño sobre puntos_anular_venta: la versión viva sólo insertaba en
-- puntos_anulacion_gastada si v_falta > 0. Con v_dio = 0 y v_falta = 0 no
-- habría ni salida ni marca, y puntos_barrer_anulaciones la volvería a mirar
-- cada minuto. Por eso la condición se amplió a «o no se quitó nada».
-- VERIFICADO el 2026-10-09: puntos_panel_avisos y puntos_vigilar_irregularidades
-- leen puntos_anulacion_gastada SIN filtrar no_recuperados, así que una fila
-- con 0 saldría como aviso «N puntos no se recuperaron» con N = 0. Al aplicar
-- esto hay que agregarles `AND g.no_recuperados > 0` (partiendo de su
-- definición VIVA). Sólo pasa cuando las NC ya quitaron TODO y después se
-- anula la factura, o sea casi nunca, pero el aviso falso enseña a ignorarlos.

-- ── Llamada desde el motor (puntos-motor/index.ts, NO editado) ──────────────
-- Después de puntos_barrer_anulaciones y ANTES de puntos_sellar_estado:
--   const notas = await rpc('puntos_descontar_notas_credito', {
--     p_desde: desde, p_hasta: hasta, p_simular: simular, p_tope: 200 });
-- y devolver `notas` en la respuesta.
-- ════════════════════════════════════════════════════════════════════════════
