SET lock_timeout = '5s';
-- Inyecciones (2026-10-28, pedido del usuario sobre la bitácora):
--   «¿no podría confirmar de un solo en la bitácora?» → enfermería confirma
--     DESDE la bitácora; la pestaña «Por confirmar» desaparece. El permiso
--     deja de ser una pestaña: `inyecciones_tab_confirmar` pasa a
--     `inyecciones_confirmar` (el canon reserva `_tab_` para pestañas).
--   «unas están sin nombre, eso no puede pasar, debe agregar el cliente; si no
--     está, se debe crear» → `cliente_crear_de_mostrador`, la ficha que nace
--     en la caja. La traída sin ficha la frena `operar-caja`.

-- 1 · El permiso cambia de nombre, con sus filas y las tres funciones que lo leen.
UPDATE public.role_permissions SET module_key = 'inyecciones_confirmar'
 WHERE module_key = 'inyecciones_tab_confirmar';
DO $$
DECLARE f regprocedure; def text; nuevo text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.inyeccion_confirma_enfermeria_sola()'::regprocedure,
        'public.inyecciones_por_confirmar(integer)'::regprocedure,
        'public.inyeccion_confirmar_enfermeria(bigint[])'::regprocedure]
    LOOP
        SELECT pg_get_functiondef(f) INTO def;
        nuevo := replace(def, 'inyecciones_tab_confirmar', 'inyecciones_confirmar');
        IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en %', f; END IF;
        EXECUTE nuevo;
    END LOOP;
END $$;

-- 2 · La bitácora: quien puede confirmar ve también lo POR_CONFIRMAR de su
-- sala (con el botón), y el filtro de estado acepta POR_CONFIRMAR. Lo que
-- pasó el plazo sigue siendo sólo de Admin.
DO $$
DECLARE def text; nuevo text;
BEGIN
    SELECT pg_get_functiondef('public.inyecciones_bitacora_buscar(integer,date,date,jsonb,text,integer,integer)'::regprocedure) INTO def;
    nuevo := replace(def,
        E'OR a.enfermeria_at IS NOT NULL)',
        E'OR a.enfermeria_at IS NOT NULL\n             OR ((SELECT public.auth_has_module_permission(''inyecciones_confirmar'', ''can_edit''))\n                 AND public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) = ''POR_CONFIRMAR''))');
    nuevo := replace(nuevo,
        'SELECT * FROM base WHERE v_estado IS NULL OR estado = v_estado',
        'SELECT * FROM base WHERE v_estado IS NULL OR estado = v_estado OR (v_estado = ''POR_CONFIRMAR'' AND enfermeria = ''POR_CONFIRMAR'')');
    IF nuevo = def OR nuevo NOT LIKE '%inyecciones_confirmar%' OR nuevo NOT LIKE '%v_estado = ''POR_CONFIRMAR''%' THEN
        RAISE EXCEPTION 'Sin ancla en inyecciones_bitacora_buscar';
    END IF;
    EXECUTE nuevo;
END $$;

-- 3 · La ficha que nace en la caja. Nombre (dos palabras) y teléfono o DUI:
-- sin uno de los dos la ficha no se vuelve a encontrar y la app no la liga.
-- Si ya existe —mismo DUI, o mismo nombre sin un DUI que lo contradiga— se
-- devuelve ésa con `existente: true`: dos fichas de la misma persona parten
-- su historial. Nace sin número del sistema de la caja, como las que crea la
-- venta con sólo el nombre.
CREATE FUNCTION public.cliente_crear_de_mostrador(p_nombre text, p_dui text DEFAULT NULL, p_telefono text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_nombre text := upper(regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g'));
  v_dui_d text := regexp_replace(coalesce(p_dui, ''), '\D', '', 'g');
  v_tel_d text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_dui text; v_tel text;
  c public.customers%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF array_length(regexp_split_to_array(v_nombre, ' '), 1) < 2 OR length(v_nombre) < 6 THEN
    RAISE EXCEPTION 'Escribe nombre y apellido del cliente.';
  END IF;
  IF v_nombre ~ '^(CLIENTES? VARIOS|CLIENTE FRECUENTE|CONSUMIDOR FINAL)' THEN
    RAISE EXCEPTION 'Escribe el nombre de la persona, no uno de mostrador.';
  END IF;
  IF v_dui_d <> '' AND length(v_dui_d) <> 9 THEN RAISE EXCEPTION 'El DUI lleva 9 dígitos.'; END IF;
  IF v_tel_d <> '' AND length(v_tel_d) <> 8 THEN RAISE EXCEPTION 'El teléfono lleva 8 dígitos.'; END IF;
  IF v_dui_d = '' AND v_tel_d = '' THEN RAISE EXCEPTION 'Falta el teléfono o el DUI.'; END IF;
  v_dui := CASE WHEN v_dui_d <> '' THEN left(v_dui_d, 8) || '-' || right(v_dui_d, 1) END;
  v_tel := CASE WHEN v_tel_d <> '' THEN left(v_tel_d, 4) || '-' || right(v_tel_d, 4) END;

  IF v_dui IS NOT NULL THEN
    SELECT * INTO c FROM public.customers
     WHERE dui = v_dui AND fusionada_en_id IS NULL AND anonimizada_at IS NULL
     ORDER BY id LIMIT 1;
    IF FOUND THEN
      RETURN json_build_object('id', c.id, 'name', c.name, 'dui', c.dui, 'phone', c.phone, 'existente', true);
    END IF;
  END IF;
  SELECT * INTO c FROM public.customers WHERE upper(trim(name)) = v_nombre;
  IF FOUND AND c.fusionada_en_id IS NOT NULL THEN
    SELECT * INTO c FROM public.customers WHERE id = c.fusionada_en_id;
  END IF;
  IF FOUND THEN
    IF v_dui IS NOT NULL AND c.dui IS NOT NULL AND c.dui <> v_dui THEN
      RAISE EXCEPTION 'Ya hay otra persona con ese nombre. Escribe el nombre completo, con los dos apellidos.';
    END IF;
    RETURN json_build_object('id', c.id, 'name', c.name, 'dui', c.dui, 'phone', c.phone, 'existente', true);
  END IF;

  INSERT INTO public.customers (name, dui, phone, notes)
  VALUES (v_nombre, v_dui, v_tel, 'Creada en la caja para una inyección')
  RETURNING * INTO c;
  RETURN json_build_object('id', c.id, 'name', c.name, 'dui', c.dui, 'phone', c.phone, 'existente', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cliente_crear_de_mostrador(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_crear_de_mostrador(text, text, text) TO authenticated, service_role;
