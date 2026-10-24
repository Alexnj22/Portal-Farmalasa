-- ═══════════════════════════════════════════════════════════════════════════
-- Reglamento v2 de Puntos Salud — 2 de 4: el raspable (borrador 2026-10-24)
-- Depende de la 1 (`reglas_v2_desde()`).
--
-- QUÉ CAMBIA
--   · Cl. 5.1 v2: el raspable lo reciben SÓLO los Clientes Oro y Platino que
--     COMPRARON EN EL MES ANTERIOR (revierte la decisión del 19-oct de no
--     pedirlo), y los Mayoristas Rubí y Diamante según sus Condiciones. Desde
--     2.2: nunca una ficha jurídica.
--   · El TOPE del mes pasa a DÓLARES (decisión del usuario, literal: «el tope es
--     configurable, y debe ser en $, debe contemplar productos, puntos, si es
--     promocional se agrega $ si tiene costo. si no queda así, así como la
--     cantidad sea por sucursal o general de ese promocional o producto»):
--       - `puntos_config.raspable_presupuesto_usd` (NULL = sin tope). Arranca
--         con el tope de hoy convertido: 15,000 pts = US$150.00.
--         `cupon_presupuesto_mensual` (en puntos) queda deprecado.
--       - Cada premio vale: puntos × US$0.01 · producto a su COSTO (el de la
--         presentación en el catálogo, × cantidad) · promocional a su costo, o
--         US$0 si no lo tiene. Un producto sin costo conocido NO se reparte:
--         no se puede saber cuánto gasta.
--       - Lo usado del mes = puntos de raspable dados ÷ 100 + el costo sellado
--         de cada premio no-puntos (`puntos_premios.costo`, se guarda al darlo:
--         cambiar el costo después no reescribe el mes).
--     Y cada premio de producto o promocional puede llevar un CUPO al mes
--     (`cupo`), GENERAL (toda la red) o POR SUCURSAL (`cupo_por`).
--       - GENERAL se cuenta AL REPARTIR (como el tope en $).
--       - POR SUCURSAL se cuenta en la sala DONDE SE RETIRA (decisión del
--         usuario, 2026-10-24): al repartir no hay sala. El premio lleva su
--         cupo sellado (`puntos_premios.cupo_sala`) y apartar, pedir, tomar y
--         cerrar la entrega lo verifican en esa sala con
--         `puntos_premio_cupo_sala_libre`: si la sala ya entregó su cupo del
--         mes, ahí no se entrega y el sistema lo dice.
--   · Al repartir: de la lista del nivel se quitan los premios que no caben en
--     el presupuesto, sin cupo o sin existencia (promocional: sus existencias
--     menos lo ya comprometido; producto: inventario sin vencer en la red), y se sortea entre los que quedan con sus mismos pesos. Si no
--     queda ninguno, ese cliente no recibe raspable ese mes (se cuenta en
--     `sin_premio_disponible`). Primero los rangos/niveles más altos y las
--     compras más grandes, como antes.
--   · El panel (`puntos_niveles_panel`) devuelve el presupuesto en $ y lo usado
--     del mes; `puntos_config_guardar` acepta `raspable_presupuesto_usd` y ya
--     no los interruptores (rige la fecha).
--
-- DESDE CUÁNDO RIGE: el raspable se da desde reglas_v2_desde(). Antes de esa
--   fecha la función contesta «omitido» — que es exactamente lo que hace hoy:
--   con `niveles_activos` y `mayoreo_beneficios_activos` en false ningún nivel
--   con raspable es alcanzable y devuelve «ningún nivel da raspable».
--
-- TABLA CALIENTE: no (puntos_config, puntos_premios: pocas filas, sin crons
--   de sync encima).
-- CÓMO SE VERIFICÓ: staging con execute_sql — ver el informe de la tanda.
-- ═══════════════════════════════════════════════════════════════════════════
SET lock_timeout = '5s';

ALTER TABLE public.puntos_config
  ADD COLUMN IF NOT EXISTS raspable_presupuesto_usd numeric(10,2)
    CHECK (raspable_presupuesto_usd IS NULL OR raspable_presupuesto_usd >= 0);
COMMENT ON COLUMN public.puntos_config.raspable_presupuesto_usd IS
  'Tope del raspable al mes, en dólares (puntos × 0.01 + costo de productos y promocionales). NULL = sin tope.';
COMMENT ON COLUMN public.puntos_config.cupon_presupuesto_mensual IS
  'DEPRECADO (2026-10-24): el tope es raspable_presupuesto_usd, en dólares.';
-- Sólo la primera vez: el tope de hoy, convertido.
UPDATE public.puntos_config
   SET raspable_presupuesto_usd = round(cupon_presupuesto_mensual / 100.0, 2)
 WHERE id AND raspable_presupuesto_usd IS NULL AND cupon_presupuesto_mensual IS NOT NULL;

ALTER TABLE public.puntos_premios
  ADD COLUMN IF NOT EXISTS costo numeric(10,2),
  ADD COLUMN IF NOT EXISTS cupo_sala integer CHECK (cupo_sala IS NULL OR cupo_sala > 0);
COMMENT ON COLUMN public.puntos_premios.costo IS 'Lo que costó el premio al darlo (cuenta contra el tope del raspable de su mes).';
COMMENT ON COLUMN public.puntos_premios.cupo_sala IS 'Cupo al mes POR SUCURSAL del premio, sellado al darlo: se cuenta en la sala donde se retira. NULL = sin cupo por sucursal.';
CREATE INDEX IF NOT EXISTS puntos_premios_mes ON public.puntos_premios (mes);

-- ── Cuánto vale un premio, en dólares ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_premio_costo(p_premio jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_tipo text := coalesce(p_premio->>'tipo', 'puntos'); v numeric;
BEGIN
  IF v_tipo = 'puntos' THEN
    RETURN round(coalesce((p_premio->>'puntos')::numeric, 0) / 100, 2);
  ELSIF v_tipo = 'promocional' THEN
    -- Con costo, su costo; sin costo, US$0 (decisión del usuario).
    RETURN coalesce((SELECT p.costo FROM public.promocionales p
                      WHERE p.id = (p_premio->>'promocional_id')::bigint), 0);
  ELSIF v_tipo = 'producto' THEN
    -- El costo de ESA presentación en el catálogo (filas repetidas con la
    -- misma etiqueta y factor son intercambiables: la más cara, para no
    -- quedarse corto). Si no está, el de la unidad × factor.
    SELECT max(pp.costo) INTO v FROM public.product_precios pp
      JOIN public.presentaciones pr ON pr.id = pp.id_presentacion
     WHERE pp.product_id = (p_premio->>'product_id')::integer AND pp.activo
       AND pp.factor = (p_premio->>'factor')::integer AND pr.tipo = p_premio->>'presentacion_tipo'
       AND pp.costo > 0;
    IF v IS NULL THEN
      SELECT max(pp.costo) * (p_premio->>'factor')::integer INTO v FROM public.product_precios pp
       WHERE pp.product_id = (p_premio->>'product_id')::integer AND pp.activo AND pp.factor = 1 AND pp.costo > 0;
    END IF;
    RETURN round(v * coalesce((p_premio->>'cantidad')::integer, 1), 2);  -- NULL si no hay costo
  END IF;
  RETURN NULL;
END $function$;

-- ── Lo usado del tope en un mes ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_raspable_usado(p_mes date)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT round(
    coalesce((SELECT sum(l.puntos) FROM public.puntos_lote l
               WHERE l.origen = 'cupon'
                 AND l.ganado_el >= date_trunc('month', p_mes)::date
                 AND l.ganado_el <  (date_trunc('month', p_mes) + interval '1 month')::date), 0) / 100.0
    + coalesce((SELECT sum(pp.costo) FROM public.puntos_premios pp
                 WHERE pp.mes = date_trunc('month', p_mes)::date), 0), 2);
$function$;

-- ── Cuántos premios iguales ya se dieron en el mes (para el cupo) ──────────
-- (cupo GENERAL: se cuenta al repartir, en toda la red)
CREATE OR REPLACE FUNCTION public.puntos_premio_usos(p_premio jsonb, p_mes date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT count(*)::integer FROM public.puntos_premios pp
   WHERE pp.mes = date_trunc('month', p_mes)::date
     AND pp.tipo = p_premio->>'tipo'
     AND CASE p_premio->>'tipo'
           WHEN 'producto' THEN pp.product_id = (p_premio->>'product_id')::bigint
                                AND pp.presentacion_tipo = p_premio->>'presentacion_tipo'
                                AND pp.factor = (p_premio->>'factor')::integer
           WHEN 'promocional' THEN pp.promocional_id = (p_premio->>'promocional_id')::bigint
           ELSE false END;
$function$;

-- ── Cupo POR SUCURSAL: cuántos le quedan a una sala este mes ──────────────
-- Cuenta los premios IGUALES (mismo regalo, o mismo producto y presentación)
-- que esa sala ya entregó este mes, más los que tiene en mano: apartados ahí,
-- pedidos para ahí o entregándose ahí. NULL = el premio no tiene cupo por
-- sucursal. `p_id` no se cuenta a sí mismo.
CREATE OR REPLACE FUNCTION public.puntos_premio_cupo_sala_libre(p_id bigint, p_branch integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v public.puntos_premios%ROWTYPE;
  v_mes date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
  v_usados integer;
BEGIN
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id;
  IF NOT FOUND OR v.cupo_sala IS NULL OR p_branch IS NULL THEN RETURN NULL; END IF;
  SELECT count(*)::integer INTO v_usados FROM public.puntos_premios pp
   WHERE pp.id <> v.id AND pp.tipo = v.tipo
     AND CASE v.tipo
           WHEN 'promocional' THEN pp.promocional_id = v.promocional_id
           WHEN 'producto' THEN pp.product_id = v.product_id AND pp.presentacion_tipo = v.presentacion_tipo
                                AND pp.factor = v.factor
           ELSE false END
     AND ((pp.estado = 'ENTREGADO' AND pp.entregado_branch = p_branch
           AND (pp.entregado_at AT TIME ZONE 'America/El_Salvador') >= v_mes)
       OR (pp.estado = 'ENTREGANDO' AND pp.branch_id = p_branch)
       OR (pp.estado = 'POR_RETIRAR' AND pp.vence_el >= v_mes
           AND (pp.reserva_branch = p_branch OR (pp.espera_envio AND pp.branch_id = p_branch))));
  RETURN greatest(v.cupo_sala - v_usados, 0);
END $function$;

-- El freno, para las cuatro puertas (apartar, pedir, tomar, cerrar). Toma un
-- candado por premio y sala para que dos entregas a la vez no pasen el cupo.
CREATE OR REPLACE FUNCTION public.puntos_premio_exigir_cupo_sala(p_id bigint, p_branch integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.puntos_premios%ROWTYPE; v_libre integer; v_sala text;
BEGIN
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id;
  IF NOT FOUND OR v.cupo_sala IS NULL OR p_branch IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(concat_ws(':', 'premio-cupo', v.tipo, v.promocional_id, v.product_id,
                                                   v.presentacion_tipo, v.factor, p_branch)));
  v_libre := public.puntos_premio_cupo_sala_libre(p_id, p_branch);
  IF v_libre IS NOT NULL AND v_libre < 1 THEN
    SELECT name INTO v_sala FROM public.branches WHERE id = p_branch;
    RAISE EXCEPTION '% ya entregó este mes su cupo de «%» (% al mes): este premio se retira en otra sucursal.',
      coalesce(v_sala, 'Esta sucursal'), v.nombre, v.cupo_sala;
  END IF;
END $function$;

-- ── Existencia que queda para un premio, en toda la red ───────────────────
-- Promocional: sus existencias menos lo ya comprometido y sin entregar.
-- Producto: el inventario sin vencer del producto (en la sala, o en las
-- farmacias y Bodega) menos lo comprometido; es una guarda, no un conteo: el
-- inventario viene por presentación y el descarte real se valida al entregar.
CREATE OR REPLACE FUNCTION public.puntos_premio_existencia(p_premio jsonb, p_dia date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hay integer; v_comprometido integer;
BEGIN
  IF p_premio->>'tipo' = 'promocional' THEN
    SELECT coalesce(sum(e.cantidad), 0) INTO v_hay FROM public.promocionales_existencias e
     WHERE e.promocional_id = (p_premio->>'promocional_id')::bigint;
    SELECT coalesce(sum(pp.cantidad), 0) INTO v_comprometido FROM public.puntos_premios pp
     WHERE pp.promocional_id = (p_premio->>'promocional_id')::bigint
       AND pp.estado <> 'ENTREGADO' AND pp.vence_el >= p_dia;
  ELSIF p_premio->>'tipo' = 'producto' THEN
    SELECT coalesce(sum(i.cantidad), 0) INTO v_hay FROM public.inventory i
      JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
     WHERE i.erp_product_id = (p_premio->>'product_id')::integer
       AND NOT coalesce(i.is_vencidos, false) AND i.cantidad > 0;
    SELECT coalesce(sum(pp.cantidad), 0) INTO v_comprometido FROM public.puntos_premios pp
     WHERE pp.tipo = 'producto' AND pp.product_id = (p_premio->>'product_id')::bigint
       AND pp.estado <> 'ENTREGADO' AND pp.vence_el >= p_dia;
  ELSE
    RETURN NULL;   -- los puntos no tienen existencia
  END IF;
  RETURN greatest(v_hay - v_comprometido, 0);
END $function$;

REVOKE EXECUTE ON FUNCTION public.puntos_premio_costo(jsonb), public.puntos_raspable_usado(date),
  public.puntos_premio_usos(jsonb, date), public.puntos_premio_existencia(jsonb, date),
  public.puntos_premio_cupo_sala_libre(bigint, integer), public.puntos_premio_exigir_cupo_sala(bigint, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_premio_costo(jsonb), public.puntos_raspable_usado(date),
  public.puntos_premio_usos(jsonb, date), public.puntos_premio_existencia(jsonb, date),
  public.puntos_premio_cupo_sala_libre(bigint, integer), public.puntos_premio_exigir_cupo_sala(bigint, integer)
  TO service_role;

-- ── Validación de la lista: ahora con cupo ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_premios_validos(p_premios jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE e jsonb; v_tipo text;
BEGIN
  IF p_premios IS NULL OR p_premios = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_premios) <> 'array' THEN RETURN 'Los premios tienen que ser una lista.'; END IF;
  IF jsonb_array_length(p_premios) = 0 THEN RETURN NULL; END IF;
  IF jsonb_array_length(p_premios) > 12 THEN RETURN 'Como máximo 12 premios.'; END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_premios) x LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN 'Cada premio tiene que ser un objeto.'; END IF;
    IF jsonb_typeof(e->'peso') <> 'number' OR (e->>'peso')::numeric <= 0 OR (e->>'peso')::numeric > 100 THEN
      RETURN 'La probabilidad de cada premio va de más de 0 a 100.';
    END IF;
    v_tipo := coalesce(e->>'tipo', 'puntos');

    -- El cupo del mes (2026-10-24): sólo para producto y promocional.
    IF e ? 'cupo' AND (jsonb_typeof(e->'cupo') <> 'number' OR (e->>'cupo')::numeric <> floor((e->>'cupo')::numeric)
                       OR (e->>'cupo')::numeric < 1 OR (e->>'cupo')::numeric > 100000) THEN
      RETURN 'El cupo de un premio va de 1 a 100,000 al mes, sin decimales.';
    END IF;
    IF e ? 'cupo_por' AND coalesce(e->>'cupo_por', '') NOT IN ('general', 'sucursal') THEN
      RETURN 'El cupo es general o por sucursal.';
    END IF;

    IF v_tipo = 'puntos' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(e) k WHERE k NOT IN ('tipo', 'puntos', 'peso')) > 0 THEN
        RETURN 'Un premio de puntos lleva sólo los puntos y la probabilidad.';
      END IF;
      IF jsonb_typeof(e->'puntos') <> 'number' OR (e->>'puntos')::numeric <> floor((e->>'puntos')::numeric)
         OR (e->>'puntos')::numeric < 1 OR (e->>'puntos')::numeric > 10000 THEN
        RETURN 'Los puntos de un premio van de 1 a 10,000, sin decimales.';
      END IF;

    ELSIF v_tipo = 'producto' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(e) k
           WHERE k NOT IN ('tipo', 'product_id', 'presentacion_tipo', 'factor', 'cantidad', 'nombre', 'peso', 'cupo', 'cupo_por')) > 0 THEN
        RETURN 'Un premio de producto lleva el producto, su presentación, la cantidad, el cupo y la probabilidad.';
      END IF;
      IF jsonb_typeof(e->'product_id') <> 'number'
         OR NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = (e->>'product_id')::bigint) THEN
        RETURN 'Ese producto no existe.';
      END IF;
      IF coalesce(btrim(e->>'presentacion_tipo'), '') = '' OR jsonb_typeof(e->'factor') <> 'number'
         OR (e->>'factor')::numeric < 1 OR (e->>'factor')::numeric <> floor((e->>'factor')::numeric) THEN
        RETURN 'Falta la presentación del producto.';
      END IF;
      IF jsonb_typeof(e->'cantidad') <> 'number' OR (e->>'cantidad')::numeric <> floor((e->>'cantidad')::numeric)
         OR (e->>'cantidad')::numeric < 1 OR (e->>'cantidad')::numeric > 20 THEN
        RETURN 'La cantidad de un premio de producto va de 1 a 20.';
      END IF;
      IF coalesce(btrim(e->>'nombre'), '') = '' THEN RETURN 'El premio necesita un nombre.'; END IF;
      -- Sin costo no se puede contar contra el tope del mes.
      IF public.puntos_premio_costo(e) IS NULL THEN
        RETURN 'Ese producto no tiene costo en el catálogo: no se puede contar contra el tope del raspable.';
      END IF;

    ELSIF v_tipo = 'promocional' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(e) k
           WHERE k NOT IN ('tipo', 'promocional_id', 'nombre', 'peso', 'cupo', 'cupo_por')) > 0 THEN
        RETURN 'Un premio promocional lleva el regalo, el cupo y la probabilidad.';
      END IF;
      IF jsonb_typeof(e->'promocional_id') <> 'number'
         OR NOT EXISTS (SELECT 1 FROM public.promocionales p WHERE p.id = (e->>'promocional_id')::bigint AND p.activo) THEN
        RETURN 'Ese regalo promocional no existe o está apagado.';
      END IF;
      IF coalesce(btrim(e->>'nombre'), '') = '' THEN RETURN 'El premio necesita un nombre.'; END IF;

    ELSE
      RETURN 'Un premio es de puntos, de producto o promocional.';
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;

-- ── El reparto del mes ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_dar_cupones(p_dia date DEFAULT NULL::date, p_simular boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/El_Salvador')::date);
  v_mes date := date_trunc('month', v_dia)::date;
  v_fin date := (date_trunc('month', v_dia) + interval '1 month - 1 day')::date;
  v_mes_ant date := (date_trunc('month', v_dia) - interval '1 month')::date;
  v_v2 date := public.reglas_v2_desde();
  v_tope numeric;          -- US$ al mes; NULL = sin tope
  v_usado numeric;         -- US$ ya dados este mes
  v_usos jsonb := '{}';    -- clave → cuántos van (cupo), leído una vez y llevado acá
  v_exist jsonb := '{}';   -- clave → existencia que queda, ídem
  r record; e jsonb; v_lista jsonb; v_disp jsonb; v_item jsonb;
  v_costo numeric; v_clave text;
  v_pts integer;
  v_n integer := 0; v_total bigint := 0; v_sin integer := 0; v_n_may integer := 0; v_n_reg integer := 0;
  v_gasto numeric := 0;
BEGIN
  IF public.puntos_fuente() <> 'portal' THEN
    RETURN json_build_object('dia', v_dia, 'omitido', 'el programa todavía no funciona en el portal');
  END IF;
  -- Antes del v2 no hay raspable para nadie: es lo que pasa hoy (con los
  -- niveles y el mayoreo apagados ningún nivel con raspable es alcanzable).
  IF v_dia < v_v2 THEN
    RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', 0, 'puntos', 0,
                             'vence', v_fin, 'omitido', 'el raspable rige desde el ' || to_char(v_v2, 'DD/MM/YYYY'));
  END IF;
  SELECT raspable_presupuesto_usd INTO v_tope FROM public.puntos_config WHERE id;
  v_usado := public.puntos_raspable_usado(v_mes);

  FOR r IN
    -- 1. Clientes Mayoristas aprobados con rango que da raspable (Condiciones §5).
    SELECT c.id, b.cupon_mensual, b.cupon_premios, b.nombre, true AS es_mayorista, b.orden AS prioridad, 0::numeric AS compra
      FROM public.clientes_mayoristas cm
      JOIN public.customers c ON c.id = cm.customer_id
      JOIN public.puntos_mayoreo_beneficios b ON b.clave = public.mayorista_rango(cm.customer_id)
     WHERE cm.estado = 'aprobado'
       AND (b.cupon_mensual > 0 OR b.cupon_premios IS NOT NULL)
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND c.tipo_persona IS DISTINCT FROM 'juridica'
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
       AND NOT EXISTS (SELECT 1 FROM public.puntos_premios pp WHERE pp.customer_id = c.id AND pp.mes = v_mes)
    UNION ALL
    -- 2. Por nivel (Oro y Platino), la compra completa de 12 meses — la MISMA
    --    regla que `puntos_compra_12m(c.id, v_dia)` en una sola pasada — y
    --    SÓLO si compró en el mes anterior (cl. 5.1 v2).
    SELECT c.id, n.cupon_mensual, n.cupon_premios, n.nombre, false, -1, x.compra
      FROM (SELECT coalesce(pc.fusionada_en, si.customer_id) AS customer_id, sum(si.total) AS compra,
                   bool_or(si.fecha >= v_mes_ant AND si.fecha < v_mes) AS compro_mes_anterior
              FROM public.sales_invoices si
              LEFT JOIN public.puntos_cuenta pc ON pc.customer_id = si.customer_id AND pc.fusionada_en IS NOT NULL
             WHERE si.fecha > v_dia - 365 AND si.fecha <= v_dia
               AND public.venta_valida(si.estado)
             GROUP BY 1) x
      JOIN public.customers c ON c.id = x.customer_id
      CROSS JOIN LATERAL public.puntos_nivel_de(x.compra, v_dia) n
     WHERE x.compro_mes_anterior
       AND (n.cupon_mensual > 0 OR n.cupon_premios IS NOT NULL)
       AND coalesce(c.acumula_puntos, true) AND c.acepta_programa_puntos IS DISTINCT FROM false
       AND c.tipo_persona IS DISTINCT FROM 'juridica'
       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)
       -- Mayorista aprobado: no tiene nivel (va por su rango, arriba).
       AND NOT EXISTS (SELECT 1 FROM public.clientes_mayoristas cm
                        WHERE cm.customer_id = c.id AND cm.estado = 'aprobado')
       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))
       AND NOT EXISTS (SELECT 1 FROM public.puntos_premios pp WHERE pp.customer_id = c.id AND pp.mes = v_mes)
    ORDER BY 6 DESC, 7 DESC, 1
  LOOP
    -- La lista del nivel; sin lista, los puntos fijos del nivel.
    v_lista := CASE WHEN r.cupon_premios IS NOT NULL AND jsonb_array_length(r.cupon_premios) > 0 THEN r.cupon_premios
                    WHEN coalesce(r.cupon_mensual, 0) > 0
                      THEN jsonb_build_array(jsonb_build_object('tipo', 'puntos', 'puntos', r.cupon_mensual, 'peso', 1)) END;
    CONTINUE WHEN v_lista IS NULL;
    v_disp := '[]'::jsonb;

    -- Sólo quedan los premios que se pueden dar HOY a ESTE cliente.
    FOR e IN SELECT CASE WHEN x ? 'tipo' THEN x ELSE x || '{"tipo":"puntos"}'::jsonb END
               FROM jsonb_array_elements(v_lista) x LOOP
      v_costo := public.puntos_premio_costo(e);
      CONTINUE WHEN v_costo IS NULL;                                        -- sin costo: no se sabe cuánto gasta
      CONTINUE WHEN v_tope IS NOT NULL AND v_usado + v_costo > v_tope;      -- no cabe en el mes
      v_clave := NULL;
      IF e->>'tipo' IN ('producto', 'promocional') THEN
        v_clave := concat_ws(':', e->>'tipo', e->>'product_id', e->>'presentacion_tipo', e->>'factor',
                             e->>'promocional_id');
        -- Cupo GENERAL: se cuenta al repartir. El POR SUCURSAL se cuenta en la
        -- sala donde se retira (`puntos_premio_exigir_cupo_sala`): acá no hay sala.
        IF e ? 'cupo' AND coalesce(e->>'cupo_por', 'general') = 'general' THEN
          IF NOT v_usos ? v_clave THEN
            v_usos := v_usos || jsonb_build_object(v_clave, public.puntos_premio_usos(e, v_mes));
          END IF;
          CONTINUE WHEN (v_usos->>v_clave)::integer >= (e->>'cupo')::integer;
        END IF;
        IF NOT v_exist ? v_clave THEN
          v_exist := v_exist || jsonb_build_object(v_clave, public.puntos_premio_existencia(e, v_dia));
        END IF;
        CONTINUE WHEN (v_exist->>v_clave)::integer < coalesce((e->>'cantidad')::integer, 1);
      END IF;
      v_disp := v_disp || jsonb_build_array(e || jsonb_build_object(
        '_costo', v_costo, '_clave', v_clave,
        '_cupo_sala', CASE WHEN e ? 'cupo' AND e->>'cupo_por' = 'sucursal' THEN (e->>'cupo')::integer END));
    END LOOP;

    -- El sorteo, con los mismos pesos, entre los que quedaron.
    v_item := CASE WHEN jsonb_array_length(v_disp) > 0 THEN public.puntos_premio_sorteado(v_disp, NULL) END;
    IF v_item IS NULL THEN v_sin := v_sin + 1; CONTINUE; END IF;

    v_costo := (v_item->>'_costo')::numeric;
    v_usado := v_usado + v_costo;
    v_gasto := v_gasto + v_costo;
    v_clave := v_item->>'_clave';
    IF v_clave IS NOT NULL THEN
      IF v_usos ? v_clave THEN
        v_usos := jsonb_set(v_usos, ARRAY[v_clave], to_jsonb((v_usos->>v_clave)::integer + 1));
      END IF;
      v_exist := jsonb_set(v_exist, ARRAY[v_clave],
                           to_jsonb((v_exist->>v_clave)::integer - coalesce((v_item->>'cantidad')::integer, 1)));
    END IF;
    IF r.es_mayorista THEN v_n_may := v_n_may + 1; END IF;

    IF v_item->>'tipo' IN ('producto', 'promocional') THEN
      v_n_reg := v_n_reg + 1;
      CONTINUE WHEN p_simular;
      INSERT INTO public.puntos_premios (customer_id, tipo, nombre, product_id, presentacion_tipo, factor, cantidad,
                                         promocional_id, nivel, mes, ganado_el, vence_el, costo, cupo_sala)
      VALUES (r.id, v_item->>'tipo', v_item->>'nombre', (v_item->>'product_id')::bigint, v_item->>'presentacion_tipo',
              (v_item->>'factor')::integer, coalesce((v_item->>'cantidad')::integer, 1),
              (v_item->>'promocional_id')::bigint, r.nombre, v_mes, v_dia, v_fin,
              v_costo, (v_item->>'_cupo_sala')::integer)
      ON CONFLICT (customer_id, mes) DO NOTHING;
      CONTINUE;
    END IF;

    v_pts := (v_item->>'puntos')::integer;
    CONTINUE WHEN coalesce(v_pts, 0) <= 0;
    v_n := v_n + 1;
    v_total := v_total + v_pts;
    CONTINUE WHEN p_simular;
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (r.id) ON CONFLICT (customer_id) DO NOTHING;
    -- «Cupón <nivel o rango> del mes»: la app lo reconoce por ese texto.
    INSERT INTO public.puntos_lote (customer_id, origen, puntos, restantes, ganado_el, vence_el, motivo)
    VALUES (r.id, 'cupon', v_pts, v_pts, v_dia, v_fin, 'Cupón ' || r.nombre || ' del mes');
    UPDATE public.puntos_cuenta SET saldo = saldo + v_pts, ganados = ganados + v_pts, updated_at = now()
     WHERE customer_id = r.id;
  END LOOP;

  RETURN json_build_object('dia', v_dia, 'simulado', p_simular, 'clientes', v_n, 'puntos', v_total,
                           'mayoristas', v_n_may, 'regalos', v_n_reg, 'vence', v_fin,
                           'gastado_usd', round(v_gasto, 2), 'usado_mes_usd', round(v_usado, 2), 'tope_usd', v_tope,
                           'sin_premio_disponible', v_sin,
                           -- El nombre viejo, para quien lo lea todavía.
                           'fuera_del_presupuesto', v_sin);
END $function$;

-- ── El panel ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_niveles_panel()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hoy date := (now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_tab_niveles', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los niveles del programa.' USING ERRCODE = '42501';
  END IF;
  RETURN json_build_object(
    'config', (SELECT json_build_object(
                        -- Desde el 2026-10-24 todo rige por la fecha del v2.
                        'reglas_v2_desde', c.reglas_v2_desde,
                        'v2_vigente', v_hoy >= c.reglas_v2_desde,
                        'raspable_presupuesto_usd', c.raspable_presupuesto_usd,
                        -- Deprecados: sólo para versiones viejas de la app.
                        'niveles_activos', v_hoy >= c.reglas_v2_desde,
                        'mayoreo_beneficios_activos', v_hoy >= c.reglas_v2_desde,
                        'cupon_presupuesto_mensual', c.cupon_presupuesto_mensual)
                 FROM public.puntos_config c WHERE c.id),
    'niveles', (SELECT coalesce(json_agg(to_json(n) ORDER BY n.orden), '[]'::json) FROM public.puntos_niveles n),
    'mayoreo', (SELECT coalesce(json_agg(to_json(m) ORDER BY m.orden), '[]'::json) FROM public.puntos_mayoreo_beneficios m),
    -- Lo ya repartido este mes en raspables: puntos, y TODO en dólares.
    'cupon_dado_mes', (SELECT coalesce(sum(l.puntos), 0) FROM public.puntos_lote l
                        WHERE l.origen = 'cupon' AND l.ganado_el >= date_trunc('month', v_hoy)::date),
    'raspable_usado_usd', public.puntos_raspable_usado(v_hoy),
    'historial', (SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
                    SELECT h.id, h.created_at, h.employee_id, e.name AS quien, h.tabla, h.clave, h.antes, h.despues, h.nota
                      FROM public.puntos_config_historial h
                      LEFT JOIN public.employees e ON e.id = h.employee_id
                     ORDER BY h.created_at DESC LIMIT 100) x));
END $function$;

CREATE OR REPLACE FUNCTION public.puntos_config_guardar(p_cambios jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_antes jsonb; v_despues jsonb; v_clave text; v_tope numeric;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['puntos_tab_niveles'])) THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar la configuración del programa.' USING ERRCODE = '42501';
  END IF;
  FOR v_clave IN SELECT jsonb_object_keys(coalesce(p_cambios, '{}'::jsonb)) LOOP
    IF v_clave IN ('niveles_activos', 'mayoreo_beneficios_activos') THEN
      RAISE EXCEPTION 'Los niveles y los beneficios del Cliente Mayorista ya no se encienden a mano: rigen desde el %.',
        to_char(public.reglas_v2_desde(), 'DD/MM/YYYY');
    END IF;
    IF v_clave NOT IN ('raspable_presupuesto_usd') THEN
      RAISE EXCEPTION 'No se puede cambiar «%» desde aquí.', v_clave;
    END IF;
  END LOOP;
  SELECT jsonb_build_object('raspable_presupuesto_usd', raspable_presupuesto_usd)
    INTO v_antes FROM public.puntos_config WHERE id FOR UPDATE;
  IF p_cambios ? 'raspable_presupuesto_usd' THEN
    v_tope := CASE WHEN jsonb_typeof(p_cambios->'raspable_presupuesto_usd') = 'null' THEN NULL
                   ELSE round((p_cambios->>'raspable_presupuesto_usd')::numeric, 2) END;
    IF v_tope IS NOT NULL AND (v_tope < 0 OR v_tope > 100000) THEN
      RAISE EXCEPTION 'El tope del raspable va de $0 a $100,000 al mes, o vacío para no tener tope.';
    END IF;
    UPDATE public.puntos_config SET raspable_presupuesto_usd = v_tope, updated_at = now() WHERE id;
  END IF;
  SELECT jsonb_build_object('raspable_presupuesto_usd', raspable_presupuesto_usd)
    INTO v_despues FROM public.puntos_config WHERE id;
  IF v_despues IS NOT DISTINCT FROM v_antes THEN RETURN json_build_object('ok', true, 'cambio', false); END IF;
  INSERT INTO public.puntos_config_historial (employee_id, tabla, clave, antes, despues, nota)
  VALUES (public.auth_employee_id(), 'config', NULL, v_antes, v_despues, nullif(btrim(p_nota), ''));
  RETURN json_build_object('ok', true, 'cambio', true);
END $function$;

-- ── Las cuatro puertas del premio verifican el cupo POR SUCURSAL ──────────
-- (definiciones vivas de producción + una línea cada una). Apartar y pedir lo
-- miran en la sala elegida; tomar en la que entrega; cerrar lo vuelve a mirar
-- bajo candado justo antes de descontar.
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
  PERFORM public.puntos_premio_exigir_cupo_sala(p_id, p_branch);   -- cupo por sucursal (2026-10-24)
  UPDATE public.puntos_premios SET reserva_branch = p_branch, branch_id = p_branch, espera_envio = false WHERE id = p_id;
  SELECT name INTO v_sala FROM public.branches WHERE id = p_branch;
  INSERT INTO public.app_cliente_avisos (customer_id, tipo, ref, titulo, cuerpo, url)
  VALUES (v.customer_id, 'ganado', 'premio:apartado:' || v.id, 'Tu regalo te espera',
          v.nombre || ' quedó apartado para ti en ' || coalesce(v_sala, 'la sucursal') || '. Retíralo antes del '
            || to_char(v.vence_el, 'DD/MM') || ' con el código de tu cupón.', '/puntos');
  RETURN json_build_object('ok', true, 'sala', v_sala);
END $function$;

CREATE OR REPLACE FUNCTION public.puntos_premio_pedir(p_id bigint, p_branch integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v public.puntos_premios%ROWTYPE;
BEGIN
  IF NOT (public.promocionales_puede_administrar()
          OR (coalesce((SELECT public.auth_has_module_permission('puntos', 'can_view')), false)
              AND p_branch IS NOT DISTINCT FROM (SELECT public.auth_employee_branch_id()))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.puntos_premios WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR v.tipo <> 'promocional' THEN RAISE EXCEPTION 'Sólo un regalo promocional se pide.'; END IF;
  IF v.estado <> 'POR_RETIRAR' OR v.vence_el < (now() AT TIME ZONE 'America/El_Salvador')::date THEN
    RAISE EXCEPTION 'Ese premio ya no se puede pedir.';
  END IF;
  PERFORM public.puntos_premio_exigir_cupo_sala(p_id, p_branch);   -- cupo por sucursal (2026-10-24)
  -- Si estaba apartado en otra sala, se suelta: ahora se espera aquí.
  UPDATE public.puntos_premios SET branch_id = p_branch, espera_envio = true, reserva_branch = NULL WHERE id = p_id;
  RETURN json_build_object('ok', true);
END $function$;

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
  PERFORM public.puntos_premio_exigir_cupo_sala(p_id, p_branch);   -- cupo por sucursal (2026-10-24)
  UPDATE public.puntos_premios SET estado = 'ENTREGANDO', tomado_at = now(), branch_id = p_branch WHERE id = p_id
  RETURNING * INTO v;
  RETURN (SELECT json_build_object('id', v.id, 'codigo', v.codigo, 'tipo', v.tipo, 'nombre', v.nombre,
            'product_id', v.product_id, 'presentacion_tipo', v.presentacion_tipo, 'factor', v.factor,
            'cantidad', v.cantidad, 'promocional_id', v.promocional_id, 'branch_id', v.branch_id,
            'cliente', c.name, 'customer_id', c.id)
            FROM public.customers c WHERE c.id = v.customer_id);
END $function$;

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
  PERFORM public.puntos_premio_exigir_cupo_sala(p_id, v.branch_id);   -- cupo por sucursal (2026-10-24)
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
