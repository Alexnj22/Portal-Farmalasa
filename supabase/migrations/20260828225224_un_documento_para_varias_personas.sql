SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- UN DOCUMENTO, VARIAS PERSONAS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El acuse sellado del Ministerio de Trabajo no es un papel por persona: cuando
-- se recontrata a varios, el Ministerio devuelve UN acuse con la lista de todos.
-- Hasta hoy el portal sólo sabía adjuntar un documento a la ficha que estaba
-- abierta, así que ese mismo papel había que subirlo una vez por persona —
-- buscando cada ficha a mano, y sin nada que dijera a quiénes cubre.
--
-- Pedido del usuario (2026-08-28): «ese documento no es personal, pueden haber
-- más personas involucradas… que al subirse detecte el listado de nombres, y al
-- crearlos lo asigne de un solo, o lo asigne si ya fue creado el empleado».
--
-- Son DOS casos y por eso hay dos caminos:
--
--   · la persona YA tiene ficha  → se le escribe el documento ahora
--     (`asignar_documento_a_empleados`)
--   · la persona TODAVÍA NO      → el documento queda esperando por su nombre
--     (`dejar_documento_pendiente`) y se aplica solo cuando la ficha nace
--     (`aplicar_documentos_pendientes`)
--
-- El archivo se sube UNA vez y las fichas comparten su dirección. No se copia:
-- copiarlo daría N archivos que después divergen —uno se reemplaza y los otros
-- no— y ninguno sería «el acuse», serían copias parecidas.

-- ── El nombre, comparable ──────────────────────────────────────────────────
--
-- Un nombre leído de un papel no coincide carácter por carácter con el de la
-- ficha: sobra un espacio, falta una tilde, viene en mayúsculas. Se compara la
-- versión normalizada, que es la misma idea que `buscarCargo` ya aplica a los
-- cargos (memoria: un rótulo no es una clave).
--
-- IMMUTABLE porque tiene que poder indexarse: sin índice, cada alta de empleado
-- barrería la tabla entera de pendientes.
CREATE OR REPLACE FUNCTION public.nombre_normalizado(p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $$
  SELECT btrim(regexp_replace(
    upper(translate(coalesce(p_nombre, ''),
                    'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
    '[^A-Z]+', ' ', 'g'));
$$;

COMMENT ON FUNCTION public.nombre_normalizado(text) IS
  'Nombre comparable: sin tildes, sin puntuación, en mayúsculas y con un solo espacio. Para cruzar un nombre leído de un documento contra el de una ficha.';

-- ── Los documentos que esperan a que exista la ficha ───────────────────────
CREATE TABLE IF NOT EXISTS public.documentos_por_asignar (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Como vino en el papel: es lo que se le muestra a quien decide.
  nombre_visible text NOT NULL,
  -- Como se compara. Se guarda calculado y no se calcula al buscar para que el
  -- índice sirva.
  nombre_clave   text NOT NULL,
  -- La entrada tal cual va a `employees.employee_documents`.
  documento      jsonb NOT NULL,
  creado_por     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  aplicado_a     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  aplicado_el    timestamptz
);

COMMENT ON TABLE public.documentos_por_asignar IS
  'Documentos compartidos (ej. el acuse del MTPS de una recontratación) que nombran a alguien que todavía no tiene ficha. Se aplican solos cuando la ficha nace.';

CREATE INDEX IF NOT EXISTS documentos_por_asignar_pendientes_idx
  ON public.documentos_por_asignar (nombre_clave) WHERE aplicado_a IS NULL;
CREATE INDEX IF NOT EXISTS documentos_por_asignar_creado_por_idx
  ON public.documentos_por_asignar (creado_por);
CREATE INDEX IF NOT EXISTS documentos_por_asignar_aplicado_a_idx
  ON public.documentos_por_asignar (aplicado_a);

ALTER TABLE public.documentos_por_asignar ENABLE ROW LEVEL SECURITY;

-- Lectura para quien puede ver personal. Sin policies de escritura a propósito:
-- se escribe SÓLO por las funciones de abajo, que son las que comprueban el
-- permiso y dejan rastro. Una policy de INSERT abierta acá dejaría fabricar una
-- asignación de documento desde el navegador.
DROP POLICY IF EXISTS documentos_por_asignar_select ON public.documentos_por_asignar;
CREATE POLICY documentos_por_asignar_select ON public.documentos_por_asignar
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('personal', 'can_view')));

-- ── Asignar a fichas que YA existen ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asignar_documento_a_empleados(
  p_employee_ids uuid[],
  p_documento    jsonb
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_quien     uuid := auth_employee_id();
  v_categoria text := p_documento->>'category';
  v_id        uuid;
  v_asignados uuid[] := '{}';
  v_omitidos  jsonb  := '[]'::jsonb;
  v_nombre    text;
  v_ya        boolean;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['personal'])) THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.asignar_documento_a_empleados(uuid[], jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.asignar_documento_a_empleados(uuid[], jsonb) TO authenticated, service_role;

-- ── Dejar el documento esperando a una ficha que todavía no existe ─────────
CREATE OR REPLACE FUNCTION public.dejar_documento_pendiente(
  p_nombre    text,
  p_documento jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_clave text := nombre_normalizado(p_nombre);
  v_id    uuid;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['personal'])) THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.dejar_documento_pendiente(text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dejar_documento_pendiente(text, jsonb) TO authenticated, service_role;

-- ── Aplicarlos cuando la ficha nace ────────────────────────────────────────
--
-- Se llama DESPUÉS de que el alta terminó de guardar los documentos del
-- formulario, y no desde un trigger de INSERT: el alta inserta la fila y
-- enseguida vuelve a escribir `employee_documents` con la lista del formulario,
-- así que lo que hubiera puesto un trigger se perdería en ese segundo paso.
CREATE OR REPLACE FUNCTION public.aplicar_documentos_pendientes(p_employee_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_clave    text;
  v_nombre   text;
  v_fila     record;
  v_puestos  jsonb := '[]'::jsonb;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['personal'])) THEN
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
     WHERE nombre_clave = v_clave AND aplicado_a IS NULL
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
$$;

REVOKE EXECUTE ON FUNCTION public.aplicar_documentos_pendientes(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.aplicar_documentos_pendientes(uuid) TO authenticated, service_role;
