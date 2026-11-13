-- El libro de inyectables, completo (2026-11-13). Lo pide el CSSP por tener
-- inyectorio; no hay formato oficial publicado (se le consultó a la JVPE), así
-- que los campos salen de lo que llevan las farmacias que lo hacen bien y de lo
-- que exige la receta. Decisión del usuario del 13-nov («si» a la propuesta).
--
--   · Obligatorios para completar el renglón: documento del paciente, edad,
--     vía, sitio, reacción observada («Sin reacción» es una respuesta), y de la
--     ampolla: lote, vencimiento y dosis. Lote, vencimiento y dosis viven en
--     `inyeccion_aplicaciones`; si la aplicación ya los tiene no se tocan
--     (`coalesce`), y si no, el libro los completa.
--   · Nuevos en el libro: `edad`, `reaccion` y la firma del paciente
--     (`firma_png`, una imagen chica en la fila: va en el respaldo con ella y
--     no depende de un bucket). La firma no es obligatoria: el paciente puede
--     no querer firmar, y eso no invalida el renglón.
--   · Si el medicamento lo compró aquí o lo trajo el paciente ya estaba
--     (`inyeccion_aplicaciones.origen`).
SET lock_timeout = '5s';

ALTER TABLE public.inyeccion_libro
  ADD COLUMN IF NOT EXISTS edad smallint,
  ADD COLUMN IF NOT EXISTS reaccion text,
  ADD COLUMN IF NOT EXISTS firma_png text,
  ADD COLUMN IF NOT EXISTS firmado_at timestamptz;

DO $mig$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inyeccion_libro_edad_ck') THEN
    ALTER TABLE public.inyeccion_libro ADD CONSTRAINT inyeccion_libro_edad_ck CHECK (edad IS NULL OR edad BETWEEN 0 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inyeccion_libro_firma_ck') THEN
    ALTER TABLE public.inyeccion_libro ADD CONSTRAINT inyeccion_libro_firma_ck
      CHECK (firma_png IS NULL OR (firma_png LIKE 'data:image/png;base64,%' AND length(firma_png) < 200000));
  END IF;
END $mig$;

CREATE OR REPLACE FUNCTION public.inyeccion_libro_guardar(p_inyeccion_id bigint, p_datos jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_yo     uuid := public.auth_employee_id();
  v        public.inyeccion_aplicaciones;
  v_via    text := nullif(btrim(p_datos->>'via'), '');
  v_doc    text := nullif(btrim(p_datos->>'documento'), '');
  v_sitio  text := nullif(btrim(p_datos->>'sitio'), '');
  v_reac   text := nullif(btrim(p_datos->>'reaccion'), '');
  v_firma  text := nullif(p_datos->>'firma_png', '');
  v_edad   smallint;
  v_lote   text := nullif(upper(btrim(p_datos->>'lote')), '');
  v_vence  date;
  v_dosis  numeric;
BEGIN
  IF v_yo IS NULL THEN RAISE EXCEPTION 'SIN_SESION'; END IF;
  IF NOT (public.auth_has_module_permission('inyecciones', 'can_edit')
          OR public.auth_has_module_permission('inyecciones_confirmar', 'can_edit')) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'No puedes completar el libro de inyectables.';
  END IF;
  SELECT * INTO v FROM public.inyeccion_aplicaciones WHERE id = p_inyeccion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
  IF NOT public.inyeccion_al_alcance(v.branch_id, v.aplicada_branch_id) THEN
    RAISE EXCEPTION 'SIN_PERMISO' USING HINT = 'Esa aplicación no es de tu sala.';
  END IF;
  IF v.aplicada_at IS NULL THEN
    RAISE EXCEPTION 'NO_APLICADA' USING HINT = 'El libro se completa cuando la inyección ya se aplicó.';
  END IF;

  BEGIN
    v_edad  := nullif(btrim(p_datos->>'edad'), '')::smallint;
    v_vence := nullif(btrim(p_datos->>'vence'), '')::date;
    v_dosis := nullif(btrim(p_datos->>'dosis_ml'), '')::numeric;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'Revisa la edad, el vencimiento y la dosis.';
  END;

  IF v_via IS NOT NULL AND v_via NOT IN ('IM', 'IV', 'SC', 'ID') THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La vía no es válida.';
  END IF;
  IF v_edad IS NOT NULL AND (v_edad < 0 OR v_edad > 120) THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La edad no es válida.';
  END IF;
  IF v_dosis IS NOT NULL AND (v_dosis <= 0 OR v_dosis > 100) THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La dosis en ml no es válida.';
  END IF;
  IF v_lote IS NOT NULL AND length(v_lote) NOT BETWEEN 2 AND 30 THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'El lote no es válido.';
  END IF;
  IF v_firma IS NOT NULL AND (v_firma NOT LIKE 'data:image/png;base64,%' OR length(v_firma) >= 200000) THEN
    RAISE EXCEPTION 'DATO_INVALIDO' USING HINT = 'La firma no se pudo leer. Vuelve a firmar.';
  END IF;

  -- Lo que el renglón necesita para estar completo. La ampolla se juzga con lo
  -- que ya tenga la aplicación o con lo que llega ahora.
  IF v_doc IS NULL OR v_via IS NULL OR v_sitio IS NULL OR v_edad IS NULL OR v_reac IS NULL
     OR coalesce(v.lote, v_lote) IS NULL OR coalesce(v.vence, v_vence) IS NULL
     OR coalesce(v.dosis_ml, v_dosis) IS NULL THEN
    RAISE EXCEPTION 'DATO_FALTANTE'
      USING HINT = 'Faltan datos: documento, edad, vía, sitio, reacción, lote, vencimiento y dosis son obligatorios.';
  END IF;

  UPDATE public.inyeccion_aplicaciones
     SET lote = coalesce(lote, v_lote), vence = coalesce(vence, v_vence), dosis_ml = coalesce(dosis_ml, v_dosis)
   WHERE id = p_inyeccion_id AND (lote IS NULL OR vence IS NULL OR dosis_ml IS NULL);

  INSERT INTO public.inyeccion_libro AS l (inyeccion_id, documento, medico, junta_medico, via, sitio, observaciones,
                                           edad, reaccion, firma_png, firmado_at, registrado_por)
  VALUES (p_inyeccion_id, v_doc, nullif(btrim(p_datos->>'medico'), ''),
          nullif(btrim(p_datos->>'junta_medico'), ''), v_via, v_sitio,
          nullif(btrim(p_datos->>'observaciones'), ''), v_edad, v_reac, v_firma,
          CASE WHEN v_firma IS NOT NULL THEN now() END, v_yo)
  ON CONFLICT (inyeccion_id) DO UPDATE
     SET documento = EXCLUDED.documento, medico = EXCLUDED.medico, junta_medico = EXCLUDED.junta_medico,
         via = EXCLUDED.via, sitio = EXCLUDED.sitio, observaciones = EXCLUDED.observaciones,
         edad = EXCLUDED.edad, reaccion = EXCLUDED.reaccion,
         -- Una firma ya dada no se borra por guardar sin firma otra vez.
         firma_png = coalesce(EXCLUDED.firma_png, l.firma_png),
         firmado_at = CASE WHEN EXCLUDED.firma_png IS NOT NULL THEN now() ELSE l.firmado_at END,
         registrado_por = EXCLUDED.registrado_por, updated_at = now()
   WHERE (l.documento, l.medico, l.junta_medico, l.via, l.sitio, l.observaciones, l.edad, l.reaccion)
         IS DISTINCT FROM (EXCLUDED.documento, EXCLUDED.medico, EXCLUDED.junta_medico, EXCLUDED.via, EXCLUDED.sitio,
                           EXCLUDED.observaciones, EXCLUDED.edad, EXCLUDED.reaccion)
      OR EXCLUDED.firma_png IS NOT NULL;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_id, source, severity, branch_id, details)
  VALUES (v_yo, (SELECT e.name FROM public.employees e WHERE e.id = v_yo), 'INYECCION_LIBRO', p_inyeccion_id::text,
          'ADMIN_PANEL', 'INFO', coalesce(v.aplicada_branch_id, v.branch_id),
          jsonb_build_object('via', v_via, 'firmo', v_firma IS NOT NULL));
  RETURN json_build_object('id', p_inyeccion_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.inyeccion_libro_de(p_ids bigint[])
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.auth_has_module_permission('inyecciones', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF coalesce(array_length(p_ids, 1), 0) > 1000 THEN RAISE EXCEPTION 'DEMASIADOS'; END IF;
  RETURN coalesce((
    SELECT json_agg(json_build_object('inyeccion_id', l.inyeccion_id, 'documento', l.documento, 'medico', l.medico,
                                      'junta_medico', l.junta_medico, 'via', l.via, 'sitio', l.sitio,
                                      'observaciones', l.observaciones, 'edad', l.edad, 'reaccion', l.reaccion,
                                      'firmado', l.firma_png IS NOT NULL, 'firmado_at', l.firmado_at))
      FROM public.inyeccion_libro l JOIN public.inyeccion_aplicaciones i ON i.id = l.inyeccion_id
     WHERE l.inyeccion_id = ANY (p_ids)
       AND public.inyeccion_al_alcance(i.branch_id, i.aplicada_branch_id)), '[]'::json);
END;
$function$;

-- La firma se ve una por una (pesa), no en la lista.
CREATE OR REPLACE FUNCTION public.inyeccion_libro_firma(p_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_png text;
BEGIN
  IF NOT public.auth_has_module_permission('inyecciones', 'can_view') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT l.firma_png INTO v_png
    FROM public.inyeccion_libro l JOIN public.inyeccion_aplicaciones i ON i.id = l.inyeccion_id
   WHERE l.inyeccion_id = p_id AND public.inyeccion_al_alcance(i.branch_id, i.aplicada_branch_id);
  RETURN v_png;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_libro_firma(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_libro_firma(bigint) TO authenticated, service_role;
