-- Corregir la etiqueta de un renglón del sistema NO le cambia de quién es.
--
-- Bodega, conteo en vivo por lote (2026-11-16): «BEBELAC 1 X 900 dice 8 y en
-- inventario salen 5». El renglón «GENERICO · vence 05/2027» (2 latas) se
-- corrigió al lote impreso 101505512. Desde ese momento:
--   1. la lectura en vivo buscaba en la existencia el lote 101505512, que no
--      existe: el renglón pasó a decir 0 en sistema (y al contarlo guardó 0);
--   2. `sincronizar_conteo_en_vivo` ya no encontraba ningún renglón
--      «GENERICO · 05/2027», lo tomó por mercadería que llegó después y lo
--      volvió a agregar. La pantalla, además, recargaba la página entera.
-- En el conteo de Bodega: 28 etiquetas corregidas, 21 renglones duplicados.
--
-- La etiqueta corregida es el dato que se quiere (el lote real); lo que hay que
-- conservar aparte es CONTRA QUÉ existencia se compara el renglón. Tres
-- columnas: `etiqueta_corregida` y la identidad original (`lote_sistema`,
-- `vence_sistema`), que se fijan la PRIMERA vez que se corrige la etiqueta de
-- un renglón del sistema y no se vuelven a tocar.
--
-- Las funciones que cruzan un renglón con la existencia en vivo (y la que
-- corrige la etiqueta) se reescriben desde su definición VIVA, reemplazando
-- sólo el cruce. Cada
-- reemplazo se verifica: si el texto no aparece, la migración se cae en vez de
-- quedar a medias.

SET lock_timeout = '5s';

ALTER TABLE public.conteo_inventario_items
  ADD COLUMN IF NOT EXISTS etiqueta_corregida boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lote_sistema text,
  ADD COLUMN IF NOT EXISTS vence_sistema date;

COMMENT ON COLUMN public.conteo_inventario_items.etiqueta_corregida IS
  'La etiqueta (lote/vence) de este renglón del sistema se corrigió en el conteo. Si es true, la existencia con la que se compara es lote_sistema/vence_sistema, no lote/fecha_vencimiento.';
COMMENT ON COLUMN public.conteo_inventario_items.lote_sistema IS
  'Lote con el que el renglón existe en la existencia, antes de corregir su etiqueta. Sólo vale con etiqueta_corregida.';
COMMENT ON COLUMN public.conteo_inventario_items.vence_sistema IS
  'Vencimiento con el que el renglón existe en la existencia, antes de corregir su etiqueta. Sólo vale con etiqueta_corregida.';

DO $mig$
DECLARE
  v_def text;
  v_new text;

BEGIN
  ---------------------------------------------------------------------------
  -- 1. editar_lote_conteo_item: fija la identidad original la primera vez.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.editar_lote_conteo_item(uuid,text,date)'::regprocedure);
  v_new := regexp_replace(v_def,
    'SET lote = v_nuevo_lote,\s*fecha_vencimiento = p_fecha_vencimiento\s*WHERE id = p_item_id',
    E'SET lote = v_nuevo_lote,\n      fecha_vencimiento = p_fecha_vencimiento,\n'
    || E'      -- La primera corrección de un renglón del sistema guarda contra qué\n'
    || E'      -- existencia se compara. A la derecha del SET, las columnas valen lo de\n'
    || E'      -- ANTES del UPDATE.\n'
    || E'      lote_sistema  = CASE WHEN etiqueta_corregida OR es_agregado_manual THEN lote_sistema ELSE lote END,\n'
    || E'      vence_sistema = CASE WHEN etiqueta_corregida OR es_agregado_manual THEN vence_sistema ELSE fecha_vencimiento END,\n'
    || E'      etiqueta_corregida = etiqueta_corregida OR NOT es_agregado_manual\n'
    || E'  WHERE id = p_item_id');
  IF v_new = v_def THEN RAISE EXCEPTION 'editar_lote_conteo_item: no se encontró el UPDATE'; END IF;
  EXECUTE v_new;

  ---------------------------------------------------------------------------
  -- 2 y 3. guardar_conteo_item / recontar_conteo_item: el sistema en vivo se
  -- lee con la identidad original.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.guardar_conteo_item(uuid,integer,text,text)'::regprocedure);
  v_new := regexp_replace(v_def,
    'i\.lote IS NOT DISTINCT FROM v_item\.lote\s*AND i\.fecha_vencimiento IS NOT DISTINCT FROM v_item\.fecha_vencimiento',
    E'i.lote IS NOT DISTINCT FROM (CASE WHEN v_item.etiqueta_corregida THEN v_item.lote_sistema ELSE v_item.lote END)\n'
    || E'               AND i.fecha_vencimiento IS NOT DISTINCT FROM (CASE WHEN v_item.etiqueta_corregida THEN v_item.vence_sistema ELSE v_item.fecha_vencimiento END)');
  IF v_new = v_def THEN RAISE EXCEPTION 'guardar_conteo_item: no se encontró el cruce'; END IF;
  EXECUTE v_new;

  v_def := pg_get_functiondef('public.recontar_conteo_item(uuid,integer,text)'::regprocedure);
  v_new := regexp_replace(v_def,
    'i\.lote IS NOT DISTINCT FROM v_item\.lote\s*AND i\.fecha_vencimiento IS NOT DISTINCT FROM v_item\.fecha_vencimiento',
    E'i.lote IS NOT DISTINCT FROM (CASE WHEN v_item.etiqueta_corregida THEN v_item.lote_sistema ELSE v_item.lote END)\n'
    || E'               AND i.fecha_vencimiento IS NOT DISTINCT FROM (CASE WHEN v_item.etiqueta_corregida THEN v_item.vence_sistema ELSE v_item.fecha_vencimiento END)');
  IF v_new = v_def THEN RAISE EXCEPTION 'recontar_conteo_item: no se encontró el cruce'; END IF;
  EXECUTE v_new;

  ---------------------------------------------------------------------------
  -- 4. sincronizar_conteo_en_vivo: un renglón «existe» con su etiqueta actual
  -- Y con su identidad original. Las dos: si mañana la existencia trae el
  -- lote real, tampoco se duplica el renglón que ya lo lleva.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.sincronizar_conteo_en_vivo(uuid)'::regprocedure);
  v_new := regexp_replace(v_def,
    'FROM public\.conteo_inventario_items\s*WHERE conteo_id = p_conteo_id\s*\), nuevos AS \(',
    E'FROM public.conteo_inventario_items\n    WHERE conteo_id = p_conteo_id\n'
    || E'    UNION ALL\n'
    || E'    -- La existencia contra la que se compara un renglón cuya etiqueta se\n'
    || E'    -- corrigió: sin esto se lo tomaba por mercadería que llegó después.\n'
    || E'    SELECT erp_product_id, is_vencidos,\n'
    || E'           COALESCE(grupo_key, ''''),\n'
    || E'           COALESCE(lote_sistema, ''''),\n'
    || E'           COALESCE(vence_sistema::text, '''')\n'
    || E'    FROM public.conteo_inventario_items\n'
    || E'    WHERE conteo_id = p_conteo_id AND etiqueta_corregida\n'
    || E'  ), nuevos AS (');
  IF v_new = v_def THEN RAISE EXCEPTION 'sincronizar_conteo_en_vivo: no se encontró existentes'; END IF;
  EXECUTE v_new;

  ---------------------------------------------------------------------------
  -- 5. get_conteo_items_search
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.get_conteo_items_search(uuid,text,text,integer,integer,integer,integer[],text)'::regprocedure);
  v_new := replace(v_def,
    'ci.recontado_at, ci.grupo_key, (SELECT cc.costo_unitario',
    'ci.recontado_at, ci.grupo_key, ci.etiqueta_corregida, ci.lote_sistema, ci.vence_sistema, (SELECT cc.costo_unitario');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_items_search: no se encontró base'; END IF;
  v_def := v_new;
  v_new := regexp_replace(v_def,
    'lg\.g_lote IS NOT DISTINCT FROM f\.lote\s*AND lg\.g_fecha IS NOT DISTINCT FROM f\.fecha_vencimiento',
    E'lg.g_lote IS NOT DISTINCT FROM (CASE WHEN f.etiqueta_corregida THEN f.lote_sistema ELSE f.lote END)\n'
    || E'                       AND lg.g_fecha IS NOT DISTINCT FROM (CASE WHEN f.etiqueta_corregida THEN f.vence_sistema ELSE f.fecha_vencimiento END)');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_items_search: no se encontró el cruce'; END IF;
  EXECUTE v_new;

  ---------------------------------------------------------------------------
  -- 6. get_conteo_products_page
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.get_conteo_products_page(uuid,text,text,integer,integer,integer,text,text,text)'::regprocedure);
  v_new := replace(v_def,
    'ci.recontado_at, ci.grupo_key, p.nombre AS p_nombre',
    'ci.recontado_at, ci.grupo_key, ci.etiqueta_corregida, ci.lote_sistema, ci.vence_sistema, p.nombre AS p_nombre');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_page: no se encontró base'; END IF;
  v_def := v_new;
  v_new := regexp_replace(v_def,
    'lg\.g_lote IS NOT DISTINCT FROM b\.lote\s*AND lg\.g_fecha IS NOT DISTINCT FROM b\.fecha_vencimiento',
    E'lg.g_lote IS NOT DISTINCT FROM (CASE WHEN b.etiqueta_corregida THEN b.lote_sistema ELSE b.lote END)\n'
    || E'                         AND lg.g_fecha IS NOT DISTINCT FROM (CASE WHEN b.etiqueta_corregida THEN b.vence_sistema ELSE b.fecha_vencimiento END)');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_products_page: no se encontró el cruce'; END IF;
  EXECUTE v_new;

  ---------------------------------------------------------------------------
  -- 7. get_conteo_items_jsonb
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.get_conteo_items_jsonb(uuid)'::regprocedure);
  v_new := regexp_replace(v_def,
    'lg\.g_lote IS NOT DISTINCT FROM ci\.lote\s*AND lg\.g_fecha IS NOT DISTINCT FROM ci\.fecha_vencimiento',
    E'lg.g_lote IS NOT DISTINCT FROM (CASE WHEN ci.etiqueta_corregida THEN ci.lote_sistema ELSE ci.lote END)\n'
    || E'                           AND lg.g_fecha IS NOT DISTINCT FROM (CASE WHEN ci.etiqueta_corregida THEN ci.vence_sistema ELSE ci.fecha_vencimiento END)');
  IF v_new = v_def THEN RAISE EXCEPTION 'get_conteo_items_jsonb: no se encontró el cruce'; END IF;
  EXECUTE v_new;
END
$mig$;
