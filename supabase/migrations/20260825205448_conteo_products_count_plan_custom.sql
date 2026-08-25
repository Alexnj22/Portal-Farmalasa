SET lock_timeout = '5s';

-- El cuerpo NO cambia: ni una línea. Lo que cambia es el envoltorio.
--
-- Esta función era LANGUAGE sql CON `SET search_path`, que es la peor
-- combinación posible: el `SET` impide que Postgres la inlinee, y entonces el
-- cuerpo se planifica UNA vez con los argumentos como Params — sin llegar a ver
-- los valores nunca. El planificador estima el CTE `base` en ~1 fila y elige
-- nested loops sobre CTE scans: ~21 millones de comparaciones (11.6M en
-- `nt.item_id = ci.id` y 9.4M en `b.erp_product_id = base.erp_product_id`)
-- donde el plan que conoce los argumentos hace dos hash joins.
--
-- Medido el 2026-08-25 sobre el conteo abierto (3,407 renglones), intercalado
-- bajo la misma carga: 2,606 ms de mediana con el plan genérico contra 56 ms
-- con el plan personalizado. En producción llevaba 3,546 llamadas × 5,549 ms =
-- 19,678 segundos de base en 5 días — trece veces la siguiente función, y el
-- 92% del costo de todo el catálogo de RPCs.
--
-- El daño no se quedaba en el conteo. Una llamada de 2.6 s ocupa una ranura del
-- pool de PostgREST 46× más tiempo, así que dos personas paginando bastaban
-- para llenarlo; a partir de ahí TODA petición del portal esperaba turno detrás
-- y se rendía con 504 «Timed out acquiring connection from connection pool».
-- Eso fue el corte del 2026-08-25 20:25–20:32 UTC: 161 peticiones caídas
-- —roles, notificaciones, bolsas, bitácoras— y ninguna de ellas tenía nada malo.
--
-- `plan_cache_mode = 'force_custom_plan'` a secas NO alcanzaba: se probó sobre
-- la función tal cual estaba y quedó igual (2,025 vs 1,969 ms). Mientras sea
-- LANGUAGE sql no existe el plan personalizado que pedir. Hay que pasarla a
-- plpgsql, que sí entra al caché de planes. Es el mismo arreglo que llevan
-- get_ventas_con_receta y get_ventas_receta_stats desde el 2026-08-17.
--
-- El área de vencidos (77 productos) tarda lo mismo con las dos versiones,
-- 65 ms: el plan genérico sólo duele cuando el conjunto es grande. Por eso el
-- defecto no se vio hasta que hubo un conteo de 3,407 renglones abierto — y por
-- eso iba a volver en el próximo conteo grande.
--
-- Resultado idéntico verificado antes de aplicar, con la candidata creada como
-- función temporal de sesión: 21 de 21 combinaciones devolvieron el mismo
-- número — los 4 filtros × 3 áreas, 6 búsquedas (nula, vacía, sin resultados,
-- con tildes) y 3 laboratorios.
CREATE OR REPLACE FUNCTION public.get_conteo_products_count(
  p_conteo_id uuid,
  p_search text DEFAULT NULL::text,
  p_filtro text DEFAULT 'TODOS'::text,
  p_laboratorio_id integer DEFAULT NULL::integer,
  p_area text DEFAULT NULL::text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  WITH cfg AS MATERIALIZED (
    SELECT CASE WHEN p_filtro IN ('DIFERENCIA', 'SIN_UBICAR') AND NOT public.conteo_puede_ver_sistema(p_conteo_id)
                THEN 'TODOS' ELSE p_filtro END AS filtro
  ),
  neto AS MATERIALIZED (
    SELECT * FROM public.conteo_lineas_netas(p_conteo_id)
  ),
  base AS MATERIALIZED (
    SELECT ci.erp_product_id, ci.estado_item, ci.diferencia, ci.lote, ci.presentacion,
           p.nombre AS product_nombre, l.nombre AS laboratorio_nombre,
           COALESCE(p.laboratorio_id, 0) AS laboratorio_id,
           p.codigo_barras,
           nt.neto_grupo
    FROM public.conteo_inventario_items ci
    LEFT JOIN public.products p ON p.id = ci.erp_product_id
    LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
    LEFT JOIN neto nt ON nt.item_id = ci.id
    WHERE ci.conteo_id = p_conteo_id
      AND (p_laboratorio_id IS NULL OR COALESCE(p.laboratorio_id, 0) = p_laboratorio_id)
      -- Misma partición que la página: si el contador y la lista no filtran por
      -- la misma área, la paginación dice «83 productos» y muestra otra cosa.
      AND (p_area IS NULL OR (p_area = 'VENCIDOS') = ci.is_vencidos)
  ),
  matched AS (
    SELECT DISTINCT erp_product_id FROM base
    WHERE (p_search IS NULL OR p_search = ''
           OR public.norm_search(
                coalesce(product_nombre,'') || ' ' || coalesce(laboratorio_nombre,'') || ' ' ||
                coalesce(lote,'') || ' ' || coalesce(presentacion,'') || ' ' ||
                coalesce(codigo_barras,'')
              ) LIKE ALL (
                ARRAY(SELECT '%'||tok||'%' FROM unnest(string_to_array(public.norm_search(p_search), ' ')) tok WHERE tok <> '')
              ))
  ),
  per_product AS (
    SELECT b.erp_product_id,
           count(*) AS item_count,
           count(*) FILTER (WHERE b.estado_item != 'PENDIENTE') AS contados_count,
           count(*) FILTER (WHERE b.diferencia IS NOT NULL AND b.diferencia != 0
                              AND coalesce(b.neto_grupo, 0) != 0) AS con_diferencia_count,
           count(*) FILTER (WHERE b.estado_item = 'SIN_UBICAR') AS sin_ubicar_count
    FROM base b
    WHERE b.erp_product_id IN (SELECT erp_product_id FROM matched)
    GROUP BY b.erp_product_id
  )
  SELECT count(*) INTO v_total FROM per_product, cfg
  WHERE (cfg.filtro = 'TODOS' OR cfg.filtro IS NULL
         OR (cfg.filtro = 'PENDIENTES' AND per_product.contados_count < per_product.item_count)
         OR (cfg.filtro = 'DIFERENCIA' AND per_product.con_diferencia_count > 0)
         OR (cfg.filtro = 'SIN_UBICAR' AND per_product.sin_ubicar_count > 0));

  RETURN v_total;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conteo_products_count(uuid, text, text, integer, text) TO authenticated, service_role;
