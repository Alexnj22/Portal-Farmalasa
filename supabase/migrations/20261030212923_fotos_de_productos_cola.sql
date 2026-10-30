SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Fotos de productos: una cola común para completar la foto y el principio
-- activo del catálogo (2026-10-30). Medido ese día: de 4,382 productos activos,
-- 4,362 sin foto y 3,632 sin principio activo.
--
-- El módulo `fotos_productos` deja escribir SÓLO la foto y los principios: no se
-- amplía la policy de UPDATE de `products` (que abriría precios, categoría y el
-- resto de la ficha, además de ser DDL sobre una tabla caliente). La escritura
-- va por una función DEFINER que comprueba el permiso y toca esas columnas.
-- ═══════════════════════════════════════════════════════════════════════════

-- Quién está trabajando qué producto ahora. Una toma vence a los 15 minutos:
-- quien deja el teléfono a medias no bloquea el producto para siempre.
-- Sin FK a `products` a propósito: la FK pediría un lock sobre una tabla
-- caliente y la toma es efímera.
CREATE TABLE public.producto_carga_tomas (
    product_id  integer PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    tomado_el   timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX producto_carga_tomas_employee_idx ON public.producto_carga_tomas (employee_id);
ALTER TABLE public.producto_carga_tomas ENABLE ROW LEVEL SECURITY;
CREATE POLICY producto_carga_tomas_select ON public.producto_carga_tomas FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('fotos_productos', 'can_view'))
        OR (SELECT auth_can_edit_any(ARRAY['productos', 'dash_srs_inv'])));

-- Lo que cada persona completó: el avance por persona. Historial de negocio,
-- append-only y sin purga; sólo lo escribe `guardar_carga_producto`.
CREATE TABLE public.producto_carga_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  integer NOT NULL,
    employee_id uuid NOT NULL REFERENCES public.employees(id),
    que         text NOT NULL CHECK (que IN ('foto', 'principio')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX producto_carga_log_employee_idx ON public.producto_carga_log (employee_id, created_at);
CREATE INDEX producto_carga_log_created_idx ON public.producto_carga_log (created_at);
CREATE INDEX producto_carga_log_product_idx ON public.producto_carga_log (product_id);
ALTER TABLE public.producto_carga_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY producto_carga_log_select ON public.producto_carga_log FOR SELECT TO authenticated
    USING ((SELECT auth_has_module_permission('fotos_productos', 'can_view'))
        OR (SELECT auth_can_edit_any(ARRAY['productos', 'dash_srs_inv'])));

REVOKE ALL ON public.producto_carga_tomas, public.producto_carga_log FROM anon;

-- ── La cola ────────────────────────────────────────────────────────────────
-- Los que más se venden primero: una foto en un producto que sale todos los
-- días vale más que en uno que no se mueve. Los que otra persona tomó hace
-- menos de 15 minutos no salen; el que tomé yo sale primero.
-- Con `p_ids` (la búsqueda) devuelve esos productos estén pendientes o no, en
-- ese orden: así se corrige también uno ya completado.
-- DEFINER porque las ventas viven en `product_stock_params`, que esta persona
-- no tiene por qué poder leer; sólo se usan para ordenar y no se devuelven.
CREATE FUNCTION public.cola_carga_productos(p_falta text DEFAULT 'cualquiera', p_ids integer[] DEFAULT NULL, p_limite integer DEFAULT 40)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo uuid := public.auth_employee_id();
    v_res json;
BEGIN
    IF NOT ((SELECT public.auth_has_module_permission('fotos_productos', 'can_view'))
            OR (SELECT public.auth_can_edit_any(ARRAY['productos', 'dash_srs_inv']))) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sin permiso de fotos de productos' USING ERRCODE = '42501';
    END IF;

    WITH ventas AS (
        SELECT erp_product_id AS id, sum(coalesce(units_sold_6m, 0)) AS u
          FROM public.product_stock_params GROUP BY 1
    ), tomas AS (
        SELECT t.product_id, t.employee_id, e.name
          FROM public.producto_carga_tomas t JOIN public.employees e ON e.id = t.employee_id
         WHERE t.tomado_el > now() - interval '15 minutes'
    ), base AS (
        SELECT p.id, p.nombre, p.codigo_barras, p.foto_url, p.principio_activo,
               l.nombre AS laboratorio,
               coalesce(p.foto_url, '') = '' AS falta_foto,
               (coalesce(p.principio_activo, '') = '' AND NOT coalesce(p.sin_principio_activo, false)) AS falta_principio,
               coalesce(v.u, 0) AS ventas,
               tm.employee_id AS tomado_por_id, tm.name AS tomado_por
          FROM public.products p
          LEFT JOIN public.laboratorios l ON l.id = p.laboratorio_id
          LEFT JOIN ventas v ON v.id = p.id
          LEFT JOIN tomas tm ON tm.product_id = p.id
         WHERE p.activo AND (p_ids IS NULL OR p.id = ANY (p_ids))
    ), elegidos AS (
        SELECT b.*, row_number() OVER (ORDER BY
                   array_position(p_ids, b.id),
                   (b.tomado_por_id IS NOT DISTINCT FROM v_yo) DESC,
                   b.ventas DESC, b.nombre) AS orden
          FROM base b
         WHERE p_ids IS NOT NULL
            OR ((CASE p_falta WHEN 'foto' THEN b.falta_foto
                              WHEN 'principio' THEN b.falta_principio
                              ELSE (b.falta_foto OR b.falta_principio) END)
                AND (b.tomado_por_id IS NULL OR b.tomado_por_id = v_yo))
         ORDER BY orden
         LIMIT least(greatest(coalesce(p_limite, 40), 1), 100)
    )
    SELECT coalesce(json_agg(json_build_object(
               'id', x.id, 'nombre', x.nombre, 'codigo_barras', x.codigo_barras,
               'foto_url', x.foto_url, 'principio_activo', x.principio_activo,
               'laboratorio', x.laboratorio, 'falta_foto', x.falta_foto,
               'falta_principio', x.falta_principio,
               'tomado_por', CASE WHEN x.tomado_por_id IS DISTINCT FROM v_yo THEN x.tomado_por END,
               'principios', (SELECT coalesce(json_agg(json_build_object('nombre', a.nombre, 'concentracion', a.concentracion) ORDER BY a.orden), '[]'::json)
                                FROM public.product_active_principles a WHERE a.product_id = x.id)
           ) ORDER BY x.orden), '[]'::json)
      INTO v_res
      FROM elegidos x;
    RETURN v_res;
END;
$$;

-- ── Tomar un producto ──────────────────────────────────────────────────────
-- Al abrirlo se toma; si otra persona lo tiene hace menos de 15 minutos, no.
-- Tomar uno suelta los demás que tenía la misma persona.
CREATE FUNCTION public.tomar_producto_para_carga(p_product_id integer)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo uuid := public.auth_employee_id();
    v_n int;
    v_quien text;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['fotos_productos', 'productos', 'dash_srs_inv'])) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sin permiso de fotos de productos' USING ERRCODE = '42501';
    END IF;
    IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_FICHA: la sesión no tiene ficha de empleado'; END IF;

    DELETE FROM public.producto_carga_tomas WHERE employee_id = v_yo AND product_id <> p_product_id;

    INSERT INTO public.producto_carga_tomas (product_id, employee_id, tomado_el)
    VALUES (p_product_id, v_yo, now())
    ON CONFLICT (product_id) DO UPDATE SET employee_id = EXCLUDED.employee_id, tomado_el = now()
     WHERE producto_carga_tomas.employee_id = EXCLUDED.employee_id
        OR producto_carga_tomas.tomado_el < now() - interval '15 minutes';
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n = 0 THEN
        SELECT coalesce(e.nombre_corto, e.name) INTO v_quien FROM public.producto_carga_tomas t
          JOIN public.employees e ON e.id = t.employee_id WHERE t.product_id = p_product_id;
        RETURN json_build_object('ok', false, 'tomado_por', v_quien);
    END IF;
    RETURN json_build_object('ok', true);
END;
$$;

-- ── Guardar ────────────────────────────────────────────────────────────────
-- Foto y/o principios en una transacción. Un NULL deja ese dato como está.
-- La foto tiene que ser del bucket del catálogo: el permiso es para subir
-- fotos de productos, no para apuntar la ficha a cualquier dirección.
CREATE FUNCTION public.guardar_carga_producto(p_product_id integer, p_foto_url text DEFAULT NULL,
                                              p_filas jsonb DEFAULT NULL, p_texto text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_yo uuid := public.auth_employee_id();
    v_k int;
    v_n int := NULL;
BEGIN
    IF NOT (SELECT public.auth_can_edit_any(ARRAY['fotos_productos', 'productos', 'dash_srs_inv'])) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sin permiso de fotos de productos' USING ERRCODE = '42501';
    END IF;
    IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_FICHA: la sesión no tiene ficha de empleado'; END IF;
    IF p_product_id IS NULL THEN RAISE EXCEPTION 'FALTA_PRODUCTO'; END IF;
    IF p_foto_url IS NULL AND p_filas IS NULL THEN RAISE EXCEPTION 'NADA_QUE_GUARDAR'; END IF;

    IF p_foto_url IS NOT NULL THEN
        IF position('/storage/v1/object/public/product-photos/' IN p_foto_url) = 0 THEN
            RAISE EXCEPTION 'FOTO_INVALIDA: la foto tiene que estar en el catálogo de fotos';
        END IF;
        UPDATE public.products SET foto_url = p_foto_url WHERE id = p_product_id;
        GET DIAGNOSTICS v_k = ROW_COUNT;
        IF v_k = 0 THEN RAISE EXCEPTION 'PRODUCTO_NO_EXISTE: %', p_product_id; END IF;
        INSERT INTO public.producto_carga_log (product_id, employee_id, que) VALUES (p_product_id, v_yo, 'foto');
    END IF;

    IF p_filas IS NOT NULL THEN
        IF jsonb_typeof(p_filas) <> 'array' THEN RAISE EXCEPTION 'FILAS_INVALIDAS: se espera una lista'; END IF;
        DELETE FROM public.product_active_principles WHERE product_id = p_product_id;
        INSERT INTO public.product_active_principles (product_id, nombre, concentracion, orden)
        SELECT p_product_id, btrim(f ->> 'nombre'), nullif(btrim(coalesce(f ->> 'concentracion', '')), ''),
               coalesce((f ->> 'orden')::smallint, (o - 1)::smallint)
          FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS t(f, o)
         WHERE nullif(btrim(coalesce(f ->> 'nombre', '')), '') IS NOT NULL;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n = 0 THEN RAISE EXCEPTION 'SIN_PRINCIPIOS: escribe al menos un principio activo'; END IF;
        UPDATE public.products SET principio_activo = nullif(btrim(coalesce(p_texto, '')), '') WHERE id = p_product_id;
        GET DIAGNOSTICS v_k = ROW_COUNT;
        IF v_k = 0 THEN RAISE EXCEPTION 'PRODUCTO_NO_EXISTE: %', p_product_id; END IF;
        INSERT INTO public.producto_carga_log (product_id, employee_id, que) VALUES (p_product_id, v_yo, 'principio');
    END IF;

    DELETE FROM public.producto_carga_tomas WHERE product_id = p_product_id AND employee_id = v_yo;
    RETURN json_build_object('product_id', p_product_id, 'foto', p_foto_url IS NOT NULL, 'principios', v_n);
END;
$$;

-- ── El avance ──────────────────────────────────────────────────────────────
-- Cuánto falta en el catálogo y cuánto hizo cada persona hoy y en 7 días.
-- «Hoy» es el día de El Salvador, no el de UTC.
CREATE FUNCTION public.resumen_carga_productos()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_hoy timestamptz := date_trunc('day', now() AT TIME ZONE 'America/El_Salvador') AT TIME ZONE 'America/El_Salvador';
BEGIN
    IF NOT ((SELECT public.auth_has_module_permission('fotos_productos', 'can_view'))
            OR (SELECT public.auth_can_edit_any(ARRAY['productos', 'dash_srs_inv']))) THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: sin permiso de fotos de productos' USING ERRCODE = '42501';
    END IF;
    RETURN json_build_object(
        'activos', (SELECT count(*) FROM public.products WHERE activo),
        'faltan_foto', (SELECT count(*) FROM public.products WHERE activo AND coalesce(foto_url, '') = ''),
        'faltan_principio', (SELECT count(*) FROM public.products WHERE activo
                               AND coalesce(principio_activo, '') = '' AND NOT coalesce(sin_principio_activo, false)),
        'personas', (SELECT coalesce(json_agg(json_build_object(
                         'employee_id', r.employee_id, 'name', r.name, 'nombre_corto', r.nombre_corto, 'photo_url', r.photo_url,
                         'fotos_hoy', r.fotos_hoy, 'principios_hoy', r.principios_hoy,
                         'fotos_semana', r.fotos_semana, 'principios_semana', r.principios_semana)
                         ORDER BY r.fotos_hoy + r.principios_hoy DESC, r.fotos_semana + r.principios_semana DESC), '[]'::json)
                       FROM (SELECT l.employee_id, e.name, e.nombre_corto, e.photo_url,
                                    count(*) FILTER (WHERE l.que = 'foto' AND l.created_at >= v_hoy) AS fotos_hoy,
                                    count(*) FILTER (WHERE l.que = 'principio' AND l.created_at >= v_hoy) AS principios_hoy,
                                    count(*) FILTER (WHERE l.que = 'foto') AS fotos_semana,
                                    count(*) FILTER (WHERE l.que = 'principio') AS principios_semana
                               FROM public.producto_carga_log l JOIN public.employees e ON e.id = l.employee_id
                              WHERE l.created_at >= v_hoy - interval '6 days'
                              GROUP BY l.employee_id, e.name, e.nombre_corto, e.photo_url) r)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cola_carga_productos(text, integer[], integer),
                           public.tomar_producto_para_carga(integer),
                           public.guardar_carga_producto(integer, text, jsonb, text),
                           public.resumen_carga_productos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cola_carga_productos(text, integer[], integer),
                          public.tomar_producto_para_carga(integer),
                          public.guardar_carga_producto(integer, text, jsonb, text),
                          public.resumen_carga_productos() TO authenticated, service_role;

-- ── El bucket: quien carga fotos también puede subirlas ────────────────────
ALTER POLICY product_photos_authenticated_insert ON storage.objects
    WITH CHECK ((bucket_id = 'product-photos') AND (SELECT auth_can_edit_any(ARRAY['productos', 'dash_srs_inv', 'fotos_productos'])));
ALTER POLICY product_photos_authenticated_update ON storage.objects
    USING ((bucket_id = 'product-photos') AND (SELECT auth_can_edit_any(ARRAY['productos', 'dash_srs_inv', 'fotos_productos'])))
    WITH CHECK ((bucket_id = 'product-photos') AND (SELECT auth_can_edit_any(ARRAY['productos', 'dash_srs_inv', 'fotos_productos'])));
