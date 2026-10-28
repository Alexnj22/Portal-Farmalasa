SET lock_timeout = '5s';
-- «No va al libro» (pedido del usuario, 2026-10-28): un producto que pide
-- receta pero no se anota en el libro, aunque el catálogo de origen lo marque
-- como antibiótico. Caso que lo pidió: RANITIDINA 50 mg ampolla — no es
-- antibiótico ni controlado (LOM 2026 A02BA02; no está en el listado de venta
-- sin receta 2026). Hasta hoy tenía clase `bajo_receta`, o sea su propia
-- serie dentro del libro; el usuario decidió que no va en ninguno.
--
-- Es una tercera clase de `dispensacion_clases`, `sin_libro`, y no un borrado
-- de la fila: sin fila, la marca del origen la volvería a meter al libro.
-- `clase_de_dispensacion` la sigue devolviendo (no NULL), así la app de
-- clientes la sigue tratando como «con receta». Lo que cambia es sólo quién
-- entra al libro: las clases `antibiotico` y `bajo_receta`.
--
-- Freno: no se puede sacar del libro un producto que la regla de venta manda
-- al libro (las seis moléculas o un antibiótico inyectable).

ALTER TABLE public.dispensacion_clases DROP CONSTRAINT dispensacion_clases_clase_check;
ALTER TABLE public.dispensacion_clases ADD CONSTRAINT dispensacion_clases_clase_check
  CHECK (clase = ANY (ARRAY['antibiotico'::text, 'bajo_receta'::text, 'sin_libro'::text]));

-- ¿Entra al libro? Una sola respuesta.
CREATE FUNCTION public.va_al_libro(p_clase text, p_es_antibiotico boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_clase, CASE WHEN p_es_antibiotico THEN 'antibiotico' END) IN ('antibiotico', 'bajo_receta')
$$;
COMMENT ON FUNCTION public.va_al_libro(text, boolean) IS
  'Sin SET search_path a propósito: así se inlinea y no rompe los planes (igual que venta_valida).';

-- 1 · El libro: sólo las dos clases que van al libro.
DO $$
DECLARE def text; nuevo text;
BEGIN
  SELECT pg_get_functiondef('public.sincronizar_bitacora_dispensaciones(date,date,bigint)'::regprocedure) INTO def;
  nuevo := replace(def,
    'WHERE coalesce(dc.clase, CASE WHEN p.es_antibiotico THEN ''antibiotico'' END) IS NOT NULL',
    'WHERE public.va_al_libro(dc.clase, p.es_antibiotico)');
  IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en sincronizar_bitacora_dispensaciones'; END IF;
  EXECUTE nuevo;
END $$;

-- 2 · El listado y «Por revisar» miran el libro EFECTIVO, no la casilla.
DO $$
DECLARE def text; nuevo text;
BEGIN
  SELECT pg_get_functiondef('public.get_listado_antibioticos()'::regprocedure) INTO def;
  nuevo := replace(def,
    'SELECT p.id, p.nombre, p.principio_activo, coalesce(p.es_antibiotico, false) AS en_el_libro,',
    'SELECT p.id, p.nombre, p.principio_activo,
           public.va_al_libro((SELECT dc.clase FROM public.dispensacion_clases dc WHERE dc.erp_product_id = p.id), p.es_antibiotico) AS en_el_libro,');
  IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en get_listado_antibioticos'; END IF;
  EXECUTE nuevo;

  SELECT pg_get_functiondef('public.get_antibioticos_por_revisar()'::regprocedure) INTO def;
  nuevo := replace(def,
    'WHERE p.activo AND p.es_antibiotico',
    'WHERE p.activo
         AND public.va_al_libro((SELECT dc.clase FROM public.dispensacion_clases dc WHERE dc.erp_product_id = p.id), p.es_antibiotico)');
  nuevo := replace(nuevo,
    '''en_el_libro'', coalesce(p.es_antibiotico, false), ''editado_at'', ap.editado_at)',
    '''en_el_libro'', public.va_al_libro(dc.clase, p.es_antibiotico),
                ''sin_libro'', dc.clase = ''sin_libro'', ''marcado_antibiotico'', coalesce(p.es_antibiotico, false),
                ''editado_at'', ap.editado_at)');
  nuevo := replace(nuevo,
    'FROM public.antibioticos_producto ap JOIN public.products p ON p.id = ap.product_id',
    'FROM public.antibioticos_producto ap JOIN public.products p ON p.id = ap.product_id
        LEFT JOIN public.dispensacion_clases dc ON dc.erp_product_id = p.id');
  IF nuevo = def OR nuevo NOT LIKE '%sin_libro%' OR nuevo NOT LIKE '%LEFT JOIN public.dispensacion_clases dc%' THEN
    RAISE EXCEPTION 'Sin ancla en get_antibioticos_por_revisar';
  END IF;
  EXECUTE nuevo;
END $$;

-- 3 · Escribir: sacar del libro / devolver. Mismo permiso que editar el listado.
CREATE FUNCTION public.libro_sacar_producto(p_product_id integer, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_mol text; v_via text;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bitacoras_editar_antibioticos', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 10 THEN
    RAISE EXCEPTION 'Escribe por qué no va al libro.';
  END IF;
  SELECT x->>'molecula', x->>'via' INTO v_mol, v_via
    FROM json_array_elements(public.get_listado_antibioticos()) x
   WHERE (x->>'product_id')::int = p_product_id;
  IF public.antibiotico_venta(v_mol, v_via) = 'LIBRO' THEN
    RAISE EXCEPTION 'Este antibiótico va al libro por norma: es una de las seis moléculas o es inyectable.';
  END IF;
  INSERT INTO public.dispensacion_clases (erp_product_id, clase, motivo, definido_por, updated_at)
  VALUES (p_product_id, 'sin_libro', btrim(p_motivo), public.auth_employee_id(), now())
  ON CONFLICT (erp_product_id) DO UPDATE
     SET clase = 'sin_libro', motivo = EXCLUDED.motivo, definido_por = EXCLUDED.definido_por, updated_at = now();
END;
$$;

CREATE FUNCTION public.libro_devolver_producto(p_product_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('bitacoras_editar_antibioticos', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.dispensacion_clases WHERE erp_product_id = p_product_id AND clase = 'sin_libro';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.va_al_libro(text, boolean), public.libro_sacar_producto(integer, text),
  public.libro_devolver_producto(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.va_al_libro(text, boolean), public.libro_sacar_producto(integer, text),
  public.libro_devolver_producto(integer) TO authenticated, service_role;

-- 4 · La ranitidina, que es lo que lo pidió.
UPDATE public.dispensacion_clases
   SET clase = 'sin_libro', updated_at = now(),
       motivo = 'No es antibiótico ni controlado: pide receta, pero no va al libro (decisión del usuario, 2026-10-28). Antes tenía serie propia «bajo receta».'
 WHERE erp_product_id = 3680 AND clase = 'bajo_receta';
