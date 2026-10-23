-- segunda-a2-03 · productos: la búsqueda filtra antes del tope (H27) y los
-- principios activos se guardan en un solo paso (H26)
-- `products` es tabla CALIENTE, pero acá no hay DDL sobre ella: sólo funciones.
-- Partido de la definición VIVA de buscar_productos_ids (2026-10-23).
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.buscar_productos_ids(text, integer, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.buscar_productos_ids(
    p_q text, p_limite integer DEFAULT 60, p_con_pactivo boolean DEFAULT false,
    p_con_laboratorio boolean DEFAULT false, p_solo_activos boolean DEFAULT true,
    p_laboratorio_id bigint DEFAULT NULL, p_categoria text DEFAULT NULL,
    p_creado_desde timestamptz DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_lim int := least(greatest(coalesce(p_limite, 60), 1), 1000);
  v_ids json;
  v_ap  boolean;
  v_n   int;
BEGIN
  SELECT json_agg(x.id ORDER BY x.puntaje DESC, x.nombre), bool_or(x.aproximado), count(*)
    INTO v_ids, v_ap, v_n
  FROM (
    SELECT b.id, b.puntaje, b.aproximado, p.nombre
    FROM public.busqueda_productos(p_q, p_con_pactivo, p_con_laboratorio, p_solo_activos) b
    JOIN public.products p ON p.id = b.id
    -- H27: los filtros de la pantalla, ANTES del tope.
    WHERE (p_laboratorio_id IS NULL OR p.laboratorio_id = p_laboratorio_id)
      AND (p_categoria IS NULL OR p.tipo_medicamento = p_categoria)
      AND (p_creado_desde IS NULL OR p.created_at >= p_creado_desde)
    ORDER BY b.puntaje DESC, p.nombre
    LIMIT v_lim
  ) x;
  RETURN json_build_object('ids', coalesce(v_ids, '[]'::json), 'aproximado', coalesce(v_ap, false),
                           -- Llegó al tope: hay más de las que se devuelven.
                           'topado', coalesce(v_n, 0) >= v_lim);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.buscar_productos_ids(text, integer, boolean, boolean, boolean, bigint, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_productos_ids(text, integer, boolean, boolean, boolean, bigint, text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guardar_principios_activos(p_product_id integer, p_filas jsonb, p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'extensions'
AS $function$
-- H26: borrar, insertar y escribir el texto en UNA transacción. INVOKER a
-- propósito: el RLS de product_active_principles (productos|compras) y el de
-- products (productos|dash_srs_inv) siguen decidiendo quién puede.
DECLARE
    v_n int;
    v_k int;
BEGIN
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'FALTA_PRODUCTO'; END IF;
    IF p_filas IS NOT NULL AND jsonb_typeof(p_filas) <> 'array' THEN
        RAISE EXCEPTION 'FILAS_INVALIDAS: se espera una lista';
    END IF;

    DELETE FROM public.product_active_principles WHERE product_id = p_product_id;

    INSERT INTO public.product_active_principles (product_id, nombre, concentracion, orden)
    SELECT p_product_id, btrim(f ->> 'nombre'), nullif(btrim(coalesce(f ->> 'concentracion', '')), ''),
           coalesce((f ->> 'orden')::smallint, (o - 1)::smallint)
      FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) WITH ORDINALITY AS t(f, o)
     WHERE nullif(btrim(coalesce(f ->> 'nombre', '')), '') IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.products SET principio_activo = nullif(btrim(coalesce(p_texto, '')), '')
     WHERE id = p_product_id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    -- Sin permiso de editar productos el UPDATE «funciona» y escribe cero
    -- filas: eso es un error, no un guardado.
    IF v_k = 0 THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: no se pudo escribir el producto % (¿permiso de editar productos?)', p_product_id
            USING ERRCODE = '42501';
    END IF;

    RETURN json_build_object('product_id', p_product_id, 'principios', v_n);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.guardar_principios_activos(integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_principios_activos(integer, jsonb, text) TO authenticated, service_role;
