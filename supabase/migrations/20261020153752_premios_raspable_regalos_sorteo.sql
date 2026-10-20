SET lock_timeout = '5s';

-- Premios del raspable que no son puntos (2026-10-19), parte 2: qué se puede
-- poner en la lista y el sorteo del día 1. Parte 1: las tablas.

-- ── Qué se puede poner en la lista de premios ──────────────────────────────
-- Tres formas, y la de puntos sigue siendo la de siempre (sin `tipo`):
--   {puntos, peso}
--   {tipo:'producto', product_id, presentacion_tipo, factor, cantidad, nombre, peso}
--   {tipo:'promocional', promocional_id, nombre, peso}
-- STABLE y no IMMUTABLE: ahora mira que el producto y el promocional existan.
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
           WHERE k NOT IN ('tipo', 'product_id', 'presentacion_tipo', 'factor', 'cantidad', 'nombre', 'peso')) > 0 THEN
        RETURN 'Un premio de producto lleva el producto, su presentación, la cantidad y la probabilidad.';
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

    ELSIF v_tipo = 'promocional' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(e) k WHERE k NOT IN ('tipo', 'promocional_id', 'nombre', 'peso')) > 0 THEN
        RETURN 'Un premio promocional lleva el regalo y la probabilidad.';
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

-- ── El sorteo, devolviendo el premio entero ────────────────────────────────
-- `puntos_premio_al_azar` (que devuelve sólo los puntos) queda como estaba
-- para quien la llame: un premio que no es de puntos le da 0.
CREATE OR REPLACE FUNCTION public.puntos_premio_sorteado(p_premios jsonb, p_defecto integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_total numeric; v_tiro numeric; v_acum numeric := 0; e jsonb;
BEGIN
  IF p_premios IS NULL OR jsonb_array_length(p_premios) = 0 THEN
    RETURN CASE WHEN coalesce(p_defecto, 0) > 0 THEN jsonb_build_object('tipo', 'puntos', 'puntos', p_defecto) END;
  END IF;
  SELECT sum((x->>'peso')::numeric) INTO v_total FROM jsonb_array_elements(p_premios) x;
  v_tiro := random() * v_total;
  FOR e IN SELECT x FROM jsonb_array_elements(p_premios) x LOOP
    v_acum := v_acum + (e->>'peso')::numeric;
    IF v_tiro <= v_acum THEN
      RETURN CASE WHEN e ? 'tipo' THEN e ELSE e || jsonb_build_object('tipo', 'puntos') END;
    END IF;
  END LOOP;
  RETURN CASE WHEN coalesce(p_defecto, 0) > 0 THEN jsonb_build_object('tipo', 'puntos', 'puntos', p_defecto) END;
END $function$;

CREATE OR REPLACE FUNCTION public.puntos_premio_al_azar(p_premios jsonb, p_defecto integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN coalesce(x->>'tipo', 'puntos') = 'puntos' THEN (x->>'puntos')::integer ELSE 0 END
    FROM (SELECT public.puntos_premio_sorteado(p_premios, p_defecto) AS x) s;
$function$;

REVOKE ALL ON FUNCTION public.puntos_premio_sorteado(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puntos_premio_sorteado(jsonb, integer) TO service_role;

-- ── El reparto del mes, desde su definición VIVA ───────────────────────────
-- Se cambian cuatro pedazos y cada uno se comprueba: si el texto esperado no
-- estuviera, la migración aborta en vez de dejar la función a medias.
DO $do$
DECLARE
  v_def text := pg_get_functiondef('public.puntos_dar_cupones(date, boolean)'::regprocedure);
  v_antes text;
  v_viejo text;
BEGIN
  -- 1. Las variables nuevas.
  v_antes := v_def;
  v_def := replace(v_def, $a$  r record; v_n integer := 0;$a$,
                          $b$  v_item jsonb; v_n_reg integer := 0;
  r record; v_n integer := 0;$b$);
  IF v_def = v_antes THEN RAISE EXCEPTION 'puntos_dar_cupones: no se encontró la declaración de r'; END IF;

  -- 2. Un cliente con un premio que no es puntos este mes ya tiene su raspable.
  --    El texto aparece DOS veces (mayoristas y niveles): se cambian las dos.
  v_viejo := $a$       AND NOT EXISTS (SELECT 1 FROM public.puntos_lote l WHERE l.customer_id = c.id AND l.origen = 'cupon'
                        AND date_trunc('month', l.ganado_el) = date_trunc('month', v_dia))$a$;
  IF (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 2 THEN
    RAISE EXCEPTION 'puntos_dar_cupones: se esperaban dos chequeos del lote del mes';
  END IF;
  v_def := replace(v_def, v_viejo, v_viejo || $b$
       AND NOT EXISTS (SELECT 1 FROM public.puntos_premios pp WHERE pp.customer_id = c.id
                        AND pp.mes = date_trunc('month', v_dia)::date)$b$);

  -- 3. El sorteo: si sale un producto o un promocional, va a `puntos_premios`.
  v_antes := v_def;
  v_def := replace(v_def, $a$    v_pts := public.puntos_premio_al_azar(r.cupon_premios, r.cupon_mensual);
    CONTINUE WHEN coalesce(v_pts, 0) <= 0;$a$,
  $b$    v_item := public.puntos_premio_sorteado(r.cupon_premios, r.cupon_mensual);
    CONTINUE WHEN v_item IS NULL;
    -- Un regalo (producto o promocional) no cuenta contra el tope de PUNTOS del
    -- mes: el tope es de puntos. Su costo se ve en el panel de premios.
    IF v_item->>'tipo' IN ('producto', 'promocional') THEN
      v_n_reg := v_n_reg + 1;
      IF r.es_mayorista THEN v_n_may := v_n_may + 1; END IF;
      CONTINUE WHEN p_simular;
      INSERT INTO public.puntos_premios (customer_id, tipo, nombre, product_id, presentacion_tipo, factor, cantidad,
                                         promocional_id, nivel, mes, ganado_el, vence_el)
      VALUES (r.id, v_item->>'tipo', v_item->>'nombre', (v_item->>'product_id')::bigint, v_item->>'presentacion_tipo',
              (v_item->>'factor')::integer, coalesce((v_item->>'cantidad')::integer, 1),
              (v_item->>'promocional_id')::bigint, r.nombre, date_trunc('month', v_dia)::date, v_dia, v_fin)
      ON CONFLICT (customer_id, mes) DO NOTHING;
      CONTINUE;
    END IF;
    v_pts := (v_item->>'puntos')::integer;
    CONTINUE WHEN coalesce(v_pts, 0) <= 0;$b$);
  IF v_def = v_antes THEN RAISE EXCEPTION 'puntos_dar_cupones: no se encontró el sorteo'; END IF;

  -- 4. El resumen dice cuántos regalos salieron.
  v_antes := v_def;
  v_def := replace(v_def, $a$'mayoristas', v_n_may, 'vence', v_fin,$a$,
                          $b$'mayoristas', v_n_may, 'regalos', v_n_reg, 'vence', v_fin,$b$);
  IF v_def = v_antes THEN RAISE EXCEPTION 'puntos_dar_cupones: no se encontró el resumen'; END IF;

  EXECUTE v_def;
END $do$;

