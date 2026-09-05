SET lock_timeout = '5s';

-- Los productos que se pueden meter en una promoción, para elegirlos EN BLOQUE.
--
-- ── Por qué no alcanzaba `buscar_productos_minmax` ────────────────────────
-- Ésa devuelve 20 y está hecha para elegir UNO. Acá el caso es «agregá todas
-- las leches»: el usuario marca varios de una lista, o se trae un laboratorio
-- entero. Con un tope de 20 la lista miente por omisión — y el que la mira no
-- tiene cómo saber que faltan.
--
-- ── Dos caminos, una función ──────────────────────────────────────────────
-- Por TEXTO o por LABORATORIO, porque son las dos agrupaciones que tienen dato:
-- medido el 2026-09-05, `products` **no tiene columna de categoría** y ninguna
-- clave foránea apunta a `product_categories` (30 filas huérfanas), y
-- `tipo_medicamento` está vacío en 4,371 de 4,376 productos activos. Un filtro
-- por categoría sólo podría devolver vacío.
--
-- `RETURNS json` para no caer bajo el techo de las 1000 filas de PostgREST. El
-- tope de 400 es holgado a propósito: el laboratorio más grande tiene 150
-- productos activos (MEDIKEM), así que nunca corta en la práctica — y si algún
-- día lo hiciera, `total` lo dice y la pantalla puede avisarlo en vez de
-- mostrar una lista corta que parece completa.
--
-- NO lleva `plan_cache_mode = 'force_custom_plan'`: los dos predicados entran
-- por índice valga el argumento que valga, así que el plan bueno no depende de
-- ellos y forzarlo sólo agregaría el costo de replanificar.
CREATE OR REPLACE FUNCTION public.get_productos_para_promocion(
    p_search          text    DEFAULT NULL,
    p_laboratorio_id  integer DEFAULT NULL,
    p_limit           integer DEFAULT 400
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_q      text := btrim(coalesce(p_search, ''));
    v_lim    integer := least(greatest(coalesce(p_limit, 400), 1), 400);
    v_total  integer;
    v_filas  json;
BEGIN
    IF NOT public.auth_has_module_permission('promociones','can_edit') THEN
        RETURN NULL;
    END IF;

    -- Sin ninguno de los dos no se devuelve el catálogo entero: una lista de
    -- 4,376 para elegir a mano no es una lista, es un volcado.
    IF v_lim IS NULL OR (v_q = '' AND p_laboratorio_id IS NULL) THEN
        RETURN json_build_object('total', 0, 'productos', '[]'::json);
    END IF;

    -- El total se cuenta SIN el tope: así la pantalla puede decir «hay 512, se
    -- muestran 400» en vez de callarse lo que no entró.
    SELECT count(*) INTO v_total
      FROM public.products p
     WHERE p.activo
       AND (p_laboratorio_id IS NULL OR p.laboratorio_id = p_laboratorio_id)
       AND (v_q = '' OR p.nombre_norm LIKE '%' || public.norm_search(v_q) || '%');

    SELECT coalesce(json_agg(to_json(x) ORDER BY x.nombre), '[]'::json)
      INTO v_filas
      FROM (
        SELECT p.id, p.nombre, p.es_antibiotico,
               l.nombre AS laboratorio_nombre, p.laboratorio_id
          FROM public.products p
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
         WHERE p.activo
           AND (p_laboratorio_id IS NULL OR p.laboratorio_id = p_laboratorio_id)
           AND (v_q = '' OR p.nombre_norm LIKE '%' || public.norm_search(v_q) || '%')
         ORDER BY p.nombre
         LIMIT v_lim
      ) x;

    RETURN json_build_object('total', v_total, 'productos', v_filas);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_productos_para_promocion(text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_productos_para_promocion(text, integer, integer) TO authenticated, service_role;
