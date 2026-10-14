-- El reparto de un documento colectivo nunca funcionó (2026-10-14).
--
-- Las tres funciones del reparto (20260828225224) pedían permiso de edición
-- sobre el módulo 'personal', que NO existe en role_permissions: el de las
-- fichas es 'staff_list', el mismo que exige la policy employees_update. Así
-- que auth_can_edit_any devolvía false para todo el mundo —Gerente General
-- incluido— y cada intento terminaba en FORBIDDEN. El 13-oct se subió el acuse
-- del Ministerio en la ficha de Dolores, se marcaron cuatro personas y las
-- cuatro llamadas fallaron; el diálogo se tragó el error (corregido aparte).
--
-- Además: el acuse lista a la gente con los APELLIDOS primero, y el cruce sólo
-- comparaba nombres + apellidos en ese orden. `nombre_ordenado` es la misma
-- clave con las palabras ordenadas, y se usa sólo DESPUÉS de la exacta. Tiene
-- gemela en `ordenarNombre` (src/data/documentosCompartidos.js); el orden es
-- byte a byte (COLLATE "C") porque así ordena JavaScript.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.nombre_ordenado(p_nombre text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT coalesce(string_agg(t, ' ' ORDER BY t COLLATE "C"), '')
    FROM regexp_split_to_table(nullif(nombre_normalizado(p_nombre), ''), ' ') t;
$function$;
REVOKE EXECUTE ON FUNCTION public.nombre_ordenado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nombre_ordenado(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asignar_documento_a_empleados(p_employee_ids uuid[], p_documento jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quien     uuid := auth_employee_id();
  v_categoria text := p_documento->>'category';
  v_id        uuid;
  v_asignados uuid[] := '{}';
  v_omitidos  jsonb  := '[]'::jsonb;
  v_nombre    text;
  v_ya        boolean;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['staff_list'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Hace falta permiso de edición en Personal.';
  END IF;
  IF v_categoria IS NULL OR coalesce(p_documento->>'url', '') = '' THEN
    RAISE EXCEPTION 'DOCUMENTO_INCOMPLETO' USING HINT = 'Falta la categoría o el archivo.';
  END IF;

  FOREACH v_id IN ARRAY coalesce(p_employee_ids, '{}') LOOP
    SELECT e.name,
           EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(e.employee_documents, '[]'::jsonb)) d
                   WHERE d->>'category' = v_categoria AND coalesce(d->>'url', '') <> '')
      INTO v_nombre, v_ya
      FROM public.employees e WHERE e.id = v_id;

    IF v_nombre IS NULL THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_id, 'motivo', 'no existe');
      CONTINUE;
    END IF;

    -- NUNCA se pisa un documento que ya está. Quien ya tiene su acuse cargado
    -- puede tener otro distinto —una recontratación anterior— y reemplazarlo
    -- desde acá sería borrar una prueba sin que nadie lo pidiera. Se informa y
    -- quien decide lo resuelve en esa ficha.
    IF v_ya THEN
      v_omitidos := v_omitidos || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'motivo', 'ya tiene uno');
      CONTINUE;
    END IF;

    UPDATE public.employees e
       SET employee_documents = (
             SELECT coalesce(jsonb_agg(d), '[]'::jsonb)
               FROM jsonb_array_elements(coalesce(e.employee_documents, '[]'::jsonb)) d
              WHERE d->>'category' <> v_categoria
           ) || jsonb_build_array(p_documento)
     WHERE e.id = v_id;

    v_asignados := v_asignados || v_id;

    INSERT INTO public.audit_logs (user_id, user_name, action, target_id, details, source, severity)
    SELECT auth.uid(), coalesce(q.name, 'sistema'), 'DOCUMENTO_COMPARTIDO_ASIGNADO',
           v_id::text,
           jsonb_build_object('categoria', v_categoria, 'nombre', v_nombre,
                              'archivo', p_documento->>'file_name'),
           'portal', 'info'
      FROM (SELECT name FROM public.employees WHERE id = v_quien) q;
  END LOOP;

  RETURN json_build_object('ok', true, 'asignados', to_json(v_asignados), 'omitidos', v_omitidos);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dejar_documento_pendiente(p_nombre text, p_documento jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := nombre_normalizado(p_nombre);
  v_id    uuid;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['staff_list'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = 'Hace falta permiso de edición en Personal.';
  END IF;
  IF coalesce(v_clave, '') = '' THEN
    RAISE EXCEPTION 'NOMBRE_VACIO';
  END IF;
  IF coalesce(p_documento->>'category', '') = '' OR coalesce(p_documento->>'url', '') = '' THEN
    RAISE EXCEPTION 'DOCUMENTO_INCOMPLETO';
  END IF;

  -- El mismo archivo esperando dos veces al mismo nombre no agrega nada y
  -- después se aplicaría dos veces.
  SELECT id INTO v_id FROM public.documentos_por_asignar
   WHERE nombre_clave = v_clave AND aplicado_a IS NULL
     AND documento->>'url' = p_documento->>'url'
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.documentos_por_asignar (nombre_visible, nombre_clave, documento, creado_por)
  VALUES (btrim(p_nombre), v_clave, p_documento, auth_employee_id())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_documentos_pendientes(p_employee_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave    text;
  v_nombre   text;
  v_fila     record;
  v_puestos  jsonb := '[]'::jsonb;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['staff_list'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT e.name, nombre_normalizado(
           coalesce(nullif(btrim(coalesce(e.first_names,'') || ' ' || coalesce(e.last_names,'')), ''), e.name))
    INTO v_nombre, v_clave
    FROM public.employees e WHERE e.id = p_employee_id;
  IF v_clave IS NULL OR v_clave = '' THEN
    RETURN json_build_object('ok', true, 'puestos', '[]'::json);
  END IF;

  FOR v_fila IN
    SELECT * FROM public.documentos_por_asignar
     WHERE aplicado_a IS NULL
       -- El papel puede traer los apellidos primero: la clave ordenada lo cruza.
       AND (nombre_clave = v_clave OR nombre_ordenado(nombre_clave) = nombre_ordenado(v_clave))
     ORDER BY created_at
  LOOP
    -- Si la ficha ya trae ese documento, el pendiente se cierra igual: quedó
    -- resuelto, aunque no por acá. Dejarlo abierto lo volvería a ofrecer para
    -- siempre.
    IF NOT EXISTS (
      SELECT 1 FROM public.employees e,
                    jsonb_array_elements(coalesce(e.employee_documents, '[]'::jsonb)) d
       WHERE e.id = p_employee_id
         AND d->>'category' = v_fila.documento->>'category'
         AND coalesce(d->>'url', '') <> ''
    ) THEN
      UPDATE public.employees
         SET employee_documents = coalesce(employee_documents, '[]'::jsonb)
                                  || jsonb_build_array(v_fila.documento)
       WHERE id = p_employee_id;
      v_puestos := v_puestos || jsonb_build_object(
        'categoria', v_fila.documento->>'category',
        'archivo',   v_fila.documento->>'file_name');
    END IF;

    UPDATE public.documentos_por_asignar
       SET aplicado_a = p_employee_id, aplicado_el = now()
     WHERE id = v_fila.id;
  END LOOP;

  IF jsonb_array_length(v_puestos) > 0 THEN
    INSERT INTO public.audit_logs (user_id, user_name, action, target_id, details, source, severity)
    SELECT auth.uid(), coalesce(q.name, 'sistema'), 'DOCUMENTO_COMPARTIDO_APLICADO',
           p_employee_id::text,
           jsonb_build_object('nombre', v_nombre, 'documentos', v_puestos),
           'portal', 'info'
      FROM (SELECT name FROM public.employees WHERE id = auth_employee_id()) q;
  END IF;

  RETURN json_build_object('ok', true, 'puestos', v_puestos);
END;
$function$;
