SET lock_timeout = '5s';
-- Listado de antibióticos (Guía BPAD 1.13) editable, con vía y regla de venta.
-- Pedido del usuario 2026-10-28: «¿cómo lo puedo editar, quitar un
-- medicamento de ahí y agregarlo a otro? ¿cómo sé que todos están incluidos?»
-- y «debemos definir los que se venden sólo con receta y van al libro, y los
-- que no van».
--
-- Medido ese día: el listado cruzaba molécula contra el NOMBRE o el principio
-- activo, y 3,826 de 4,383 productos activos no tienen principio activo. Así
-- quedaban afuera 52 productos que SÍ están en el libro (ELEQUINE, KLARICID,
-- ROCEFORT, UNICIL…). Y entraban por el nombre cremas, óvulos y colirios, que
-- no tienen grupo AWaRe (la OMS clasifica sólo los de uso sistémico).
--
-- Tres piezas:
--   · `antibioticos_producto`: lo que una PERSONA decidió de un producto
--     (su molécula, o ninguna = no es antibiótico; y su vía). Manda sobre la
--     coincidencia por nombre, que queda como propuesta.
--   · `antibiotico_via_por_nombre`: la vía que sugiere el nombre.
--   · `antibiotico_venta`: la regla, UNA sola (RTS 6.4.3 y el listado de venta
--     sin receta de la SRS 2026, ver docs/BITACORAS-SRS.md §4.4):
--       LIBRO  = las seis moléculas, cualquier vía, + todo inyectable;
--       LIBRE  = neomicina y sulfadiazina de uso local;
--       RECETA = el resto: pide receta, no se retiene, no va al libro.
--
-- Sin FK a `products`: es tabla caliente (sync cada minuto) y una FK nueva
-- toma lock sobre ella. Un producto que desaparece sólo deja una fila muerta.

-- 1 · El permiso de editar (no confirmar: eso sigue siendo del regente).
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r, 'bitacoras_editar_antibioticos', true, true, false, 'ALL'
  FROM unnest(ARRAY[2, 3, 8, 11, 13, 33]) r
ON CONFLICT DO NOTHING;

-- 2 · Lo que decidió una persona.
CREATE TABLE public.antibioticos_producto (
    product_id  integer PRIMARY KEY,
    molecula    text REFERENCES public.antibioticos_aware(molecula) ON UPDATE CASCADE,
    via         text NOT NULL CHECK (via IN ('oral', 'inyectable', 'local')),
    editado_por uuid REFERENCES public.employees(id),
    editado_at  timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.antibioticos_producto IS
  'Asignación manual de un producto al listado de antibióticos. molecula NULL = no es antibiótico (sale del listado).';
CREATE INDEX antibioticos_producto_molecula_idx ON public.antibioticos_producto (molecula);
ALTER TABLE public.antibioticos_producto ENABLE ROW LEVEL SECURITY;
CREATE POLICY antibioticos_producto_select ON public.antibioticos_producto FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view')));
-- Se escribe sólo por las funciones de abajo (DEFINER).

-- 3 · La vía que sugiere el nombre.
CREATE FUNCTION public.antibiotico_via_por_nombre(p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_nombre, '')) ~ '(\mAMP\M|AMPOLLA|AMPULA|ÁMPULA|\mVIAL|\mINY|INYECTABLE|TRIPACK|\mI\.?V\.?\M|\mI\.?M\.?\M)' THEN 'inyectable'
    WHEN upper(coalesce(p_nombre, '')) ~ '(CREMA|OVULO|ÓVULO|COLIRIO|OTICO|ÓTICO|OFTALM|UNGUENTO|UNGÜENTO|\mGEL\M|LOCION|LOCIÓN|POMADA|VAGINAL|TOPIC|TÓPIC|\mGOTAS\M|SPRAY)' THEN 'local'
    ELSE 'oral'
  END;
$$;

-- 4 · La regla de venta, una sola.
CREATE FUNCTION public.antibiotico_venta(p_molecula text, p_via text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_molecula IS NULL THEN NULL
    WHEN p_molecula IN ('cefixima', 'azitromicina', 'claritromicina', 'levofloxacin', 'moxifloxacin', 'norfloxacin')
      OR p_via = 'inyectable' THEN 'LIBRO'
    WHEN p_via = 'local' AND p_molecula IN ('neomicina', 'sulfadiazina') THEN 'LIBRE'
    ELSE 'RECETA'
  END;
$$;

-- 5 · El listado: lo decidido manda; si no hay decisión, el nombre propone.
CREATE OR REPLACE FUNCTION public.get_listado_antibioticos()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH por_nombre AS (
    SELECT DISTINCT ON (p.id) p.id, a.molecula
      FROM public.products p
      JOIN public.antibioticos_aware a
        ON coalesce(p.pactivo_norm, '') LIKE '%' || a.molecula || '%'
        OR coalesce(p.nombre_norm, '')  LIKE '%' || a.molecula || '%'
     WHERE p.activo
     ORDER BY p.id, length(a.molecula) DESC
  ), base AS (
    SELECT p.id, p.nombre, p.principio_activo, coalesce(p.es_antibiotico, false) AS en_el_libro,
           CASE WHEN ap.product_id IS NOT NULL THEN ap.molecula ELSE pn.molecula END AS molecula,
           coalesce(ap.via, public.antibiotico_via_por_nombre(p.nombre)) AS via,
           CASE WHEN ap.product_id IS NOT NULL THEN 'manual' ELSE 'nombre' END AS origen
      FROM public.products p
      LEFT JOIN por_nombre pn ON pn.id = p.id
      LEFT JOIN public.antibioticos_producto ap ON ap.product_id = p.id
     WHERE p.activo AND (pn.id IS NOT NULL OR ap.product_id IS NOT NULL)
  )
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.grupo NULLS LAST, t.molecula, t.producto), '[]'::json)
  FROM (
    SELECT b.id AS product_id, b.nombre AS producto, b.principio_activo,
           a.molecula, a.grupo, a.atc, a.fuente,
           a.confirmado_at IS NOT NULL AS confirmado, a.confirmado_at,
           b.via, b.origen, b.en_el_libro,
           public.antibiotico_venta(a.molecula, b.via) AS venta,
           (public.antibiotico_venta(a.molecula, b.via) = 'LIBRO') IS DISTINCT FROM b.en_el_libro AS revisar_libro
      FROM base b
      JOIN public.antibioticos_aware a ON a.molecula = b.molecula
     WHERE (SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view'))
  ) t;
$$;

-- 6 · Lo que falta mirar: marcado para el libro y fuera del listado, y lo que
-- alguien sacó (para poder devolverlo).
CREATE FUNCTION public.get_antibioticos_por_revisar()
RETURNS json LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH en_listado AS (
    SELECT (x->>'product_id')::int AS id FROM json_array_elements(public.get_listado_antibioticos()) x
  )
  SELECT json_build_object(
    'fuera', coalesce((
      SELECT json_agg(json_build_object('product_id', p.id, 'producto', p.nombre,
                'principio_activo', p.principio_activo,
                'via', public.antibiotico_via_por_nombre(p.nombre)) ORDER BY p.nombre)
        FROM public.products p
       WHERE p.activo AND p.es_antibiotico
         AND p.id NOT IN (SELECT id FROM en_listado)
         AND NOT EXISTS (SELECT 1 FROM public.antibioticos_producto ap WHERE ap.product_id = p.id)), '[]'::json),
    'excluidos', coalesce((
      SELECT json_agg(json_build_object('product_id', p.id, 'producto', p.nombre,
                'en_el_libro', coalesce(p.es_antibiotico, false), 'editado_at', ap.editado_at) ORDER BY p.nombre)
        FROM public.antibioticos_producto ap JOIN public.products p ON p.id = ap.product_id
       WHERE ap.molecula IS NULL AND p.activo), '[]'::json))
  WHERE (SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view'));
$$;

-- 7 · Escribir: asignar (molécula NULL = no es antibiótico), volver a lo
-- automático, y agregar una molécula que falte (queda sin confirmar).
CREATE FUNCTION public.antibiotico_asignar(p_product_id integer, p_molecula text, p_via text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bitacoras_editar_antibioticos', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Ese producto no existe.';
  END IF;
  IF p_molecula IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.antibioticos_aware WHERE molecula = p_molecula) THEN
    RAISE EXCEPTION 'Esa molécula no está en el listado.';
  END IF;
  IF p_via IS NULL OR p_via NOT IN ('oral', 'inyectable', 'local') THEN
    RAISE EXCEPTION 'Falta la vía: oral, inyectable o uso local.';
  END IF;
  INSERT INTO public.antibioticos_producto (product_id, molecula, via, editado_por, editado_at)
  VALUES (p_product_id, p_molecula, p_via, public.auth_employee_id(), now())
  ON CONFLICT (product_id) DO UPDATE
     SET molecula = EXCLUDED.molecula, via = EXCLUDED.via,
         editado_por = EXCLUDED.editado_por, editado_at = now();
END;
$$;

CREATE FUNCTION public.antibiotico_automatico(p_product_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bitacoras_editar_antibioticos', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.antibioticos_producto WHERE product_id = p_product_id;
END;
$$;

CREATE FUNCTION public.antibiotico_agregar_molecula(p_molecula text, p_grupo text, p_atc text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v text := lower(trim(translate(coalesce(p_molecula, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')));
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bitacoras_editar_antibioticos', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF length(v) < 4 THEN RAISE EXCEPTION 'Escribe el nombre de la molécula.'; END IF;
  IF p_grupo IS NOT NULL AND p_grupo NOT IN ('acceso', 'precaucion', 'reserva') THEN
    RAISE EXCEPTION 'Grupo inválido.';
  END IF;
  INSERT INTO public.antibioticos_aware (molecula, grupo, atc, fuente)
  VALUES (v, p_grupo, nullif(upper(trim(coalesce(p_atc, ''))), ''), 'Agregada en el portal')
  ON CONFLICT (molecula) DO NOTHING;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.antibiotico_via_por_nombre(text), public.antibiotico_venta(text, text),
  public.get_antibioticos_por_revisar(), public.antibiotico_asignar(integer, text, text),
  public.antibiotico_automatico(integer), public.antibiotico_agregar_molecula(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.antibiotico_via_por_nombre(text), public.antibiotico_venta(text, text),
  public.get_antibioticos_por_revisar(), public.antibiotico_asignar(integer, text, text),
  public.antibiotico_automatico(integer), public.antibiotico_agregar_molecula(text, text, text) TO authenticated, service_role;
