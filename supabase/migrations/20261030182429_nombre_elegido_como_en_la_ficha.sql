-- Lo elegido se escribe COMO EN LA FICHA (2026-10-30). Si alguien eligió
-- «NUNEZ» y después Personal corrige la ficha a «NÚÑEZ», tiene que salir
-- «NÚÑEZ»: la elección dice CUÁL de sus apellidos, no cómo se escribe. Es el
-- gemelo de `comoEnLaFicha` en src/utils/nameUtils.js.
SET lock_timeout = '5s';

-- Las palabras de `completo` que coinciden con `parte` (por palabras enteras,
-- sin tildes ni mayúsculas), tal como están escritas en `completo`. NULL si no
-- está.
CREATE OR REPLACE FUNCTION public.parte_como_en_la_ficha(parte text, completo text)
RETURNS text LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE
    p text := upper(extensions.unaccent(regexp_replace(btrim(coalesce(parte, '')), '\s+', ' ', 'g')));
    palabras text[] := string_to_array(regexp_replace(btrim(coalesce(completo, '')), '\s+', ' ', 'g'), ' ');
    n int;
    ventana text;
BEGIN
    IF p = '' OR coalesce(array_length(palabras, 1), 0) = 0 THEN RETURN NULL; END IF;
    n := array_length(string_to_array(p, ' '), 1);
    FOR i IN 1 .. array_length(palabras, 1) - n + 1 LOOP
        ventana := array_to_string(palabras[i : i + n - 1], ' ');
        IF upper(extensions.unaccent(ventana)) = p THEN RETURN ventana; END IF;
    END LOOP;
    RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.parte_como_en_la_ficha(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parte_como_en_la_ficha(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nombre_corto_con_eleccion(
    p_first text, p_last text, p_full text, p_nombre text, p_apellido text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_first, '')) <> '' OR btrim(coalesce(p_last, '')) <> '' THEN btrim(
      coalesce(CASE WHEN p_nombre IS NOT NULL THEN public.parte_como_en_la_ficha(p_nombre, p_first) END,
               public.primer_grupo_de_nombre(p_first))
      || ' ' ||
      coalesce(CASE WHEN p_apellido IS NOT NULL THEN public.parte_como_en_la_ficha(p_apellido, p_last) END,
               public.primer_grupo_de_nombre(p_last)))
    WHEN regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g') = '' THEN 'Personal'
    WHEN array_length(string_to_array(regexp_replace(btrim(p_full), '\s+', ' ', 'g'), ' '), 1) <= 2
      THEN regexp_replace(btrim(p_full), '\s+', ' ', 'g')
    ELSE (string_to_array(regexp_replace(btrim(p_full), '\s+', ' ', 'g'), ' '))[1] || ' '
      || (string_to_array(regexp_replace(btrim(p_full), '\s+', ' ', 'g'), ' '))[3]
  END;
$$;

-- Y la elección guardada se reescribe con la escritura de la ficha cada vez
-- que cambia la ficha (o la elección). Si lo elegido ya no está, se borra:
-- vuelve al primero, igual que en el navegador.
CREATE OR REPLACE FUNCTION public.mantener_nombre_corto()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
    IF NEW.nombre_preferido IS NOT NULL THEN
        NEW.nombre_preferido := public.parte_como_en_la_ficha(NEW.nombre_preferido, NEW.first_names);
    END IF;
    IF NEW.apellido_preferido IS NOT NULL THEN
        NEW.apellido_preferido := public.parte_como_en_la_ficha(NEW.apellido_preferido, NEW.last_names);
    END IF;
    -- `name` es generada y en un BEFORE todavía no está: con nombres y
    -- apellidos vacíos el resultado es 'Personal', igual que en el navegador.
    NEW.nombre_corto := public.nombre_corto_con_eleccion(
        NEW.first_names, NEW.last_names, NULL, NEW.nombre_preferido, NEW.apellido_preferido);
    RETURN NEW;
END $$;

-- La función de elegir devuelve lo que QUEDÓ guardado (ya con la escritura de
-- la ficha), no lo que se mandó.
CREATE OR REPLACE FUNCTION public.elegir_nombre_en_el_portal(p_nombre text, p_apellido text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    yo uuid := public.auth_employee_id();
    e  public.employees;
BEGIN
    IF yo IS NULL THEN RAISE EXCEPTION 'SIN_FICHA'; END IF;
    SELECT * INTO e FROM public.employees WHERE id = yo;
    IF NOT public.es_parte_del_nombre(p_nombre, e.first_names) THEN
        RAISE EXCEPTION 'NOMBRE_AJENO: «%» no es uno de tus nombres', p_nombre;
    END IF;
    IF NOT public.es_parte_del_nombre(p_apellido, e.last_names) THEN
        RAISE EXCEPTION 'APELLIDO_AJENO: «%» no es uno de tus apellidos', p_apellido;
    END IF;
    UPDATE public.employees
       SET nombre_preferido   = p_nombre,
           apellido_preferido = p_apellido,
           nombre_elegido_el  = now()
     WHERE id = yo
     RETURNING * INTO e;
    RETURN json_build_object('nombre_preferido', e.nombre_preferido,
                             'apellido_preferido', e.apellido_preferido,
                             'nombre_elegido_el', e.nombre_elegido_el,
                             'nombre_corto', e.nombre_corto);
END $$;

-- Las elecciones que ya se hicieron, con la escritura de su ficha.
UPDATE public.employees SET nombre_corto = NULL
 WHERE nombre_preferido IS NOT NULL OR apellido_preferido IS NOT NULL;
