SET lock_timeout = '5s';
-- Hasta hoy «Completar» y el RPC miraban `bitacoras.can_edit`, y el permiso
-- propio de la pestaña (`bitacoras_tab_libro.can_edit`) se otorgaba en la grilla
-- sin que nadie lo leyera. Decisión del usuario (2026-10-28): manda el de la
-- pestaña, así se puede dar Bitácoras sin dar el libro.
--
-- 1) Nadie que hoy completa lo pierde: se enciende la pestaña a los cargos de
--    sala que ya tenían `bitacoras.can_edit`. Quedan fuera, a propósito,
--    Auxiliar de Bodega y Servicios Generales (no venden con receta; 0 renglones
--    completados) y la cuenta de revisión de tienda.
UPDATE public.role_permissions rp
   SET can_edit = true, updated_at = now()
  FROM public.roles r
 WHERE r.id = rp.role_id
   AND rp.module_key = 'bitacoras_tab_libro'
   AND r.name IN ('Dependiente de Farmacia','Jefe/a de Sala','Subjefe/a de Sala',
                  'Regente de Enfermeria','Regente','Gerente General','Supervisor/a de Ventas')
   AND rp.can_edit IS DISTINCT FROM true;

-- 2) El freno, en un solo sitio. El alcance por sala sigue siendo el del módulo
--    (`bitacora_exigir_acceso` ya lo comprobó antes).
CREATE OR REPLACE FUNCTION public.bitacora_exigir_libro()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT public.auth_has_module_permission('bitacoras_tab_libro', 'can_edit') THEN
        RAISE EXCEPTION 'Tu cargo puede ver el libro bajo receta, pero no completarlo.' USING ERRCODE = '42501';
    END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.bitacora_exigir_libro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bitacora_exigir_libro() TO authenticated, service_role;

-- 3) Las tres que ESCRIBEN en el libro lo exigen después del freno del módulo.
--    Se parte de la definición VIVA y se inserta una línea; si la línea de
--    anclaje no está, la migración aborta en vez de dejar una sin freno.
DO $$
DECLARE
    f text; def text; nuevo text;
BEGIN
    FOREACH f IN ARRAY ARRAY['completar_dispensacion','anular_dispensacion','anular_receta'] LOOP
        SELECT pg_get_functiondef(p.oid) INTO def
          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f;
        IF def IS NULL THEN RAISE EXCEPTION 'No existe %', f; END IF;
        IF def LIKE '%bitacora_exigir_libro%' THEN CONTINUE; END IF;
        nuevo := regexp_replace(def,
            '(PERFORM public\.bitacora_exigir_acceso\([^;]*''can_edit''\);)',
            E'\\1\n    PERFORM public.bitacora_exigir_libro();');
        IF nuevo = def THEN RAISE EXCEPTION 'No encontré el freno del módulo en %', f; END IF;
        EXECUTE nuevo;
    END LOOP;
END $$;
