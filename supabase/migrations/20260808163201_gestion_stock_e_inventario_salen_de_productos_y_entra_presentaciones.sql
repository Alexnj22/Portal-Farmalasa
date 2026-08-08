-- Gestión de Stock e Inventario salen de ser pestañas de Productos, y Productos
-- gana el maestro de Presentaciones (pedido del usuario, 2026-08-08).
--
-- Tres cosas, y el orden importa:
--
--   1. `inventory_inversion` gateaba con `productos_tab_inventario`. Es
--      SECURITY DEFINER y RAISE EXCEPTION si falta el permiso, o sea que en el
--      momento en que esa clave deja de existir el valorizado de Inventario
--      falla con PERMISSION_DENIED para TODOS — no devuelve 0, revienta. Se
--      repunta al módulo nuevo ANTES de tocar los permisos.
--   2. Se siembran los permisos nuevos desde los viejos, para que nadie pierda
--      un acceso que ya tenía ni gane uno que no.
--   3. Recién entonces se borran las claves viejas. Si quedaran, la pantalla de
--      Permisos las seguiría mostrando como pestañas de Productos que ya no
--      existen.
--
-- Los dos RPC del maestro devuelven `json` (Patrón C de CLAUDE.md): el maestro
-- entero son 24 kB y el cap de 1000 filas no aplica, así que ni hay que
-- paginar ni se re-ejecuta la función por chunk.

SET lock_timeout = '5s';

-- ── 1 · el valorizado de Inventario apunta al módulo nuevo ──────────────────
-- Lo único que cambia es la clave del permiso y el search_path (la regla del
-- proyecto es `public, extensions`; tenía sólo `public`). El cuerpo es idéntico.
CREATE OR REPLACE FUNCTION public.inventory_inversion(
    p_erp_id    integer DEFAULT NULL,
    p_search    text    DEFAULT NULL,
    p_lab_id    integer DEFAULT NULL,
    p_categoria text    DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_result numeric;
  v_pats text[] := (
      SELECT array_agg('%' || tok || '%')
      FROM unnest(string_to_array(public.norm_search(p_search), ' ')) AS tok
      WHERE tok <> ''
  );
BEGIN
  IF NOT auth_has_module_permission('inventario', 'can_view') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere acceso a Inventario';
  END IF;

  SELECT COALESCE(SUM(m.total_costo), 0) INTO v_result
  FROM inventory_grouped_mv m
  WHERE (p_erp_id    IS NULL OR m.erp_sucursal_id = p_erp_id)
    AND (p_lab_id    IS NULL OR m.laboratorio_id  = p_lab_id)
    AND (p_categoria IS NULL OR m.tipo_medicamento = p_categoria)
    AND (v_pats IS NULL OR public.norm_search(m.descripcion) LIKE ALL (v_pats));

  RETURN v_result;
END;
$function$;

-- ── 2 · permisos: de las pestañas a los módulos ─────────────────────────────
-- `can_view` es la conjunción de las dos claves que hacían falta para VER la
-- pestaña: el guard de la ruta miraba `productos` y la vista filtraba sus
-- pestañas por la clave del tab. Con una sola de las dos no se veía nada, así
-- que copiar sólo la del tab regalaría accesos.
--
-- `can_edit` se copia tal cual de la pestaña. Hoy ninguna de las dos vistas lo
-- consulta —lo que gatea el "ignorar" de Gestión de Stock son las policies de
-- `minmax_ignored`, que piden can_edit en `minmax`— pero es lo que el
-- administrador marcó, y descartarlo sería decidir por él.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT t.role_id,
       'gestion_stock',
       coalesce(t.can_view, false) AND coalesce(p.can_view, false),
       coalesce(t.can_edit, false),
       false
FROM public.role_permissions t
LEFT JOIN public.role_permissions p
       ON p.role_id = t.role_id AND p.module_key = 'productos'
WHERE t.module_key = 'productos_tab_sinventa'
  AND t.role_id IS NOT NULL
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT t.role_id,
       'inventario',
       coalesce(t.can_view, false) AND coalesce(p.can_view, false),
       coalesce(t.can_edit, false),
       false
FROM public.role_permissions t
LEFT JOIN public.role_permissions p
       ON p.role_id = t.role_id AND p.module_key = 'productos'
WHERE t.module_key = 'productos_tab_inventario'
  AND t.role_id IS NOT NULL
ON CONFLICT (role_id, module_key) DO NOTHING;

-- La pestaña nueva de Productos hereda del Catálogo: es el mismo catálogo visto
-- por presentación, sobre tablas que cualquier autenticado ya puede leer.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve)
SELECT t.role_id, 'productos_tab_presentaciones', t.can_view, t.can_edit, false
FROM public.role_permissions t
WHERE t.module_key = 'productos_tab_catalogo'
  AND t.role_id IS NOT NULL
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ── 3 · las claves viejas se van ────────────────────────────────────────────
DELETE FROM public.role_permissions
WHERE module_key IN ('productos_tab_inventario', 'productos_tab_sinventa');

-- ── 4 · el maestro de presentaciones ────────────────────────────────────────
-- Se agrupa por NOMBRE y no por id a propósito: `presentaciones` trae el mismo
-- nombre en varios registros (CAJA existe con los id 9, 38, 194 y 227; UNIDAD
-- con 1, 102, 108 y 230) y no hay nada que los distinga —ni laboratorio, ni
-- rango de producto, ni factor—. Una lista con cuatro filas «CAJA» se lee como
-- un error de la pantalla; `codigos` deja ver que atrás hay más de un registro.
--
-- El FACTOR no es una propiedad de la presentación: vive en cada fila de
-- `product_precios`. «CAJA» aparece con 37 factores distintos (de 1 a 250). Por
-- eso van los cuatro números —el más frecuente, cuántos hay y el rango— en vez
-- de un solo valor que sería falso en la mayoría de las filas.
CREATE OR REPLACE FUNCTION public.get_presentaciones_maestro()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.productos DESC, t.tipo), '[]'::json)
  FROM (
    SELECT p.tipo                                                               AS tipo,
           count(DISTINCT p.id)                                                 AS codigos,
           count(DISTINCT pp.product_id)                                        AS productos,
           count(DISTINCT pp.product_id) FILTER (WHERE pp.activo AND pr.activo) AS activos,
           mode() WITHIN GROUP (ORDER BY pp.factor)                             AS factor,
           count(DISTINCT pp.factor)                                            AS factores,
           min(pp.factor)                                                       AS factor_min,
           max(pp.factor)                                                       AS factor_max
    FROM public.presentaciones p
    LEFT JOIN public.product_precios pp ON pp.id_presentacion = p.id
    LEFT JOIN public.products       pr  ON pr.id = pp.product_id
    WHERE p.tipo IS NOT NULL AND btrim(p.tipo) <> ''
    GROUP BY p.tipo
  ) t;
$$;

-- Los productos de una presentación. `activo` es la conjunción de las dos
-- banderas: un producto dado de baja no está activo en ninguna presentación,
-- por más que su fila de precio siga marcada.
CREATE OR REPLACE FUNCTION public.get_productos_por_presentacion(p_tipo text)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.nombre), '[]'::json)
  FROM (
    SELECT pr.id                     AS product_id,
           pr.nombre                 AS nombre,
           pr.codigo_barras          AS codigo_barras,
           pr.es_antibiotico         AS es_antibiotico,
           l.nombre                  AS laboratorio,
           pp.factor                 AS factor,
           pp.descripcion            AS descripcion,
           (pp.activo AND pr.activo) AS activo
    FROM public.presentaciones p
    JOIN public.product_precios pp ON pp.id_presentacion = p.id
    JOIN public.products        pr ON pr.id = pp.product_id
    LEFT JOIN public.laboratorios l ON l.id = pr.laboratorio_id
    WHERE p.tipo = p_tipo
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION public.get_presentaciones_maestro()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_productos_por_presentacion(text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_presentaciones_maestro()          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_productos_por_presentacion(text)  TO authenticated, service_role;
