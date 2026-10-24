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
--     (`cupo`), GENERAL (toda la red) o POR SUCURSAL (`cupo_por`). Por
--     sucursal = la SALA HABITUAL del cliente (donde más compró en 12 meses),
--     que queda sellada en `puntos_premios.sala_cupo`.
--   · Al repartir: de la lista del nivel se quitan los premios que no caben en
--     el presupuesto, sin cupo o sin existencia (promocional: sus existencias
--     menos lo ya comprometido; producto: inventario sin vencer en la sala o en
--     la red), y se sortea entre los que quedan con sus mismos pesos. Si no
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
  ADD COLUMN IF NOT EXISTS sala_cupo integer REFERENCES public.branches(id);
COMMENT ON COLUMN public.puntos_premios.costo IS 'Lo que costó el premio al darlo (cuenta contra el tope del raspable de su mes).';
COMMENT ON COLUMN public.puntos_premios.sala_cupo IS 'La sucursal cuyo cupo consumió (premio con cupo por sucursal). NULL = cupo general o sin cupo.';
CREATE INDEX IF NOT EXISTS puntos_premios_sala_cupo ON public.puntos_premios (sala_cupo) WHERE sala_cupo IS NOT NULL;
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

-- ── La sala habitual: donde más compró en los últimos 12 meses ─────────────
CREATE OR REPLACE FUNCTION public.puntos_sala_habitual(p_customer bigint, p_dia date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT si.branch_id::integer FROM public.sales_invoices si
    JOIN public.branches b ON b.id = si.branch_id AND b.type = 'FARMACIA'
   WHERE si.customer_id = ANY (public.puntos_clientes_de(p_customer))
     AND si.fecha > p_dia - 365 AND si.fecha <= p_dia
     AND public.venta_valida(si.estado)
   GROUP BY si.branch_id
   ORDER BY sum(si.total) DESC, max(si.fecha) DESC, si.branch_id
   LIMIT 1;
$function$;

-- ── Cuántos premios iguales ya se dieron en el mes (para el cupo) ──────────
CREATE OR REPLACE FUNCTION public.puntos_premio_usos(p_premio jsonb, p_sala integer, p_mes date)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT count(*)::integer FROM public.puntos_premios pp
   WHERE pp.mes = date_trunc('month', p_mes)::date
     AND pp.tipo = p_premio->>'tipo'
     AND (p_sala IS NULL OR pp.sala_cupo = p_sala)
     AND CASE p_premio->>'tipo'
           WHEN 'producto' THEN pp.product_id = (p_premio->>'product_id')::bigint
                                AND pp.presentacion_tipo = p_premio->>'presentacion_tipo'
                                AND pp.factor = (p_premio->>'factor')::integer
           WHEN 'promocional' THEN pp.promocional_id = (p_premio->>'promocional_id')::bigint
           ELSE false END;
$function$;

-- ── Existencia que queda para un premio (en la sala, o en toda la red) ─────
-- Promocional: sus existencias menos lo ya comprometido y sin entregar.
-- Producto: el inventario sin vencer del producto (en la sala, o en las
-- farmacias y Bodega) menos lo comprometido; es una guarda, no un conteo: el
-- inventario viene por presentación y el descarte real se valida al entregar.
CREATE OR REPLACE FUNCTION public.puntos_premio_existencia(p_premio jsonb, p_sala integer, p_dia date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_hay integer; v_comprometido integer;
BEGIN
  IF p_premio->>'tipo' = 'promocional' THEN
    SELECT coalesce(sum(e.cantidad), 0) INTO v_hay FROM public.promocionales_existencias e
     WHERE e.promocional_id = (p_premio->>'promocional_id')::bigint
       AND (p_sala IS NULL OR e.branch_id = p_sala);
    SELECT coalesce(sum(pp.cantidad), 0) INTO v_comprometido FROM public.puntos_premios pp
     WHERE pp.promocional_id = (p_premio->>'promocional_id')::bigint
       AND pp.estado <> 'ENTREGADO' AND pp.vence_el >= p_dia
       AND (p_sala IS NULL OR coalesce(pp.reserva_branch, pp.sala_cupo) = p_sala);
  ELSIF p_premio->>'tipo' = 'producto' THEN
    SELECT coalesce(sum(i.cantidad), 0) INTO v_hay FROM public.inventory i
      JOIN public.erp_sucursal_map m ON m.erp_sucursal_id = i.erp_sucursal_id
     WHERE i.erp_product_id = (p_premio->>'product_id')::integer
       AND NOT coalesce(i.is_vencidos, false) AND i.cantidad > 0
       AND (p_sala IS NULL OR m.branch_id = p_sala);
    SELECT coalesce(sum(pp.cantidad), 0) INTO v_comprometido FROM public.puntos_premios pp
     WHERE pp.tipo = 'producto' AND pp.product_id = (p_premio->>'product_id')::bigint
       AND pp.estado <> 'ENTREGADO' AND pp.vence_el >= p_dia
       AND (p_sala IS NULL OR pp.sala_cupo = p_sala);
  ELSE
    RETURN NULL;   -- los puntos no tienen existencia
  END IF;
  RETURN greatest(v_hay - v_comprometido, 0);
END $function$;

REVOKE EXECUTE ON FUNCTION public.puntos_premio_costo(jsonb), public.puntos_raspable_usado(date),
  public.puntos_sala_habitual(bigint, date), public.puntos_premio_usos(jsonb, integer, date),
  public.puntos_premio_existencia(jsonb, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_premio_costo(jsonb), public.puntos_raspable_usado(date),
  public.puntos_sala_habitual(bigint, date), public.puntos_premio_usos(jsonb, integer, date),
  public.puntos_premio_existencia(jsonb, integer, date) TO service_role;

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
  v_costo numeric; v_sala integer; v_sala_leida boolean; v_s integer; v_clave text; v_k integer;
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
    v_disp := '[]'::jsonb; v_sala := NULL; v_sala_leida := false;

    -- Sólo quedan los premios que se pueden dar HOY a ESTE cliente.
    FOR e IN SELECT CASE WHEN x ? 'tipo' THEN x ELSE x || '{"tipo":"puntos"}'::jsonb END
               FROM jsonb_array_elements(v_lista) x LOOP
      v_costo := public.puntos_premio_costo(e);
      CONTINUE WHEN v_costo IS NULL;                                        -- sin costo: no se sabe cuánto gasta
      CONTINUE WHEN v_tope IS NOT NULL AND v_usado + v_costo > v_tope;      -- no cabe en el mes
      v_s := NULL; v_clave := NULL;
      IF e->>'tipo' IN ('producto', 'promocional') THEN
        IF e->>'cupo_por' = 'sucursal' THEN
          IF NOT v_sala_leida THEN v_sala := public.puntos_sala_habitual(r.id, v_dia); v_sala_leida := true; END IF;
          CONTINUE WHEN v_sala IS NULL;                                     -- sin sala habitual no hay cupo de sala
          v_s := v_sala;
        END IF;
        v_clave := concat_ws(':', e->>'tipo', e->>'product_id', e->>'presentacion_tipo', e->>'factor',
                             e->>'promocional_id', coalesce(v_s::text, 'red'));
        IF e ? 'cupo' THEN
          IF NOT v_usos ? v_clave THEN
            v_usos := v_usos || jsonb_build_object(v_clave, public.puntos_premio_usos(e, v_s, v_mes));
          END IF;
          CONTINUE WHEN (v_usos->>v_clave)::integer >= (e->>'cupo')::integer;
        END IF;
        IF NOT v_exist ? v_clave THEN
          v_exist := v_exist || jsonb_build_object(v_clave, public.puntos_premio_existencia(e, v_s, v_dia));
        END IF;
        CONTINUE WHEN (v_exist->>v_clave)::integer < coalesce((e->>'cantidad')::integer, 1);
      END IF;
      v_disp := v_disp || jsonb_build_array(e || jsonb_build_object('_costo', v_costo, '_sala', v_s, '_clave', v_clave));
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
                                         promocional_id, nivel, mes, ganado_el, vence_el, costo, sala_cupo)
      VALUES (r.id, v_item->>'tipo', v_item->>'nombre', (v_item->>'product_id')::bigint, v_item->>'presentacion_tipo',
              (v_item->>'factor')::integer, coalesce((v_item->>'cantidad')::integer, 1),
              (v_item->>'promocional_id')::bigint, r.nombre, v_mes, v_dia, v_fin,
              v_costo, (v_item->>'_sala')::integer)
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
