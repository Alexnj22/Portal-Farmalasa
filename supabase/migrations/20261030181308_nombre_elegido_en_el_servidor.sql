-- El nombre elegido llega también a lo que arma el SERVIDOR (2026-10-30):
-- avisos, notificaciones del teléfono, el libro bajo receta, el conteo y el
-- chat con clientes. Es el gemelo en SQL de `shortEmployeeName`
-- (src/utils/nameUtils.js), que ya lo usa desde v2.1400.0.
SET lock_timeout = '5s';

-- El primer nombre (o apellido) de una lista, con las partículas pegadas:
-- «DE LA CRUZ MEJIA» → «DE LA CRUZ». Mismo corte que `gruposDeNombre`: las
-- partículas se pegan a la palabra que sigue, y las que quedan al final se
-- quedan con la anterior.
--
-- Sin `SET search_path` a propósito, igual que `venta_valida`: sólo usa
-- funciones de `pg_catalog`, y así se inlinea en las consultas de conteo, que
-- la llaman por renglón.
CREATE OR REPLACE FUNCTION public.primer_grupo_de_nombre(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((regexp_match(
    regexp_replace(btrim(coalesce(s, '')), '\s+', ' ', 'g'),
    '^((?:(?:DE|DEL|LA|LAS|LOS|SAN|SANTA|Y|VDA\.?) )*\S+(?:(?: (?:DE|DEL|LA|LAS|LOS|SAN|SANTA|Y|VDA\.?))+$)?)',
    'i'))[1], '');
$$;
REVOKE EXECUTE ON FUNCTION public.primer_grupo_de_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.primer_grupo_de_nombre(text) TO authenticated, service_role;

-- El nombre corto con la elección en la mano. Para quien ya tiene la fila de
-- `employees` (el conteo, por renglón): no consulta ninguna tabla. Sin `SET`
-- por lo mismo que la de arriba; `es_parte_del_nombre` sólo corre si la
-- persona eligió algo.
CREATE OR REPLACE FUNCTION public.nombre_corto_con_eleccion(
    p_first text, p_last text, p_full text, p_nombre text, p_apellido text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_first, '')) <> '' OR btrim(coalesce(p_last, '')) <> '' THEN btrim(
      CASE WHEN p_nombre IS NOT NULL AND public.es_parte_del_nombre(p_nombre, p_first)
           THEN btrim(p_nombre) ELSE public.primer_grupo_de_nombre(p_first) END
      || ' ' ||
      CASE WHEN p_apellido IS NOT NULL AND public.es_parte_del_nombre(p_apellido, p_last)
           THEN btrim(p_apellido) ELSE public.primer_grupo_de_nombre(p_last) END)
    WHEN regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g') = '' THEN 'Personal'
    WHEN array_length(string_to_array(regexp_replace(btrim(p_full), '\s+', ' ', 'g'), ' '), 1) <= 2
      THEN regexp_replace(btrim(p_full), '\s+', ' ', 'g')
    ELSE (string_to_array(regexp_replace(btrim(p_full), '\s+', ' ', 'g'), ' '))[1] || ' '
      || (string_to_array(regexp_replace(btrim(p_full), '\s+', ' ', 'g'), ' '))[3]
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.nombre_corto_con_eleccion(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nombre_corto_con_eleccion(text, text, text, text, text) TO authenticated, service_role;

-- El canónico de siempre, con la MISMA firma: sus diez llamadores (avisos,
-- `texto_de_push`, el libro bajo receta…) no cambian una línea. Ahora busca la
-- ficha para saber qué eligió la persona — por nombres y apellidos, o por el
-- nombre completo, que es lo único que traen los avisos (`quien`). Es lo que
-- hace en el navegador el registro de `nameUtils`. Pasa de `sql` IMMUTABLE a
-- `plpgsql` STABLE porque ahora lee una tabla (ningún índice ni columna
-- generada dependía de ella).
CREATE OR REPLACE FUNCTION public.nombre_corto_de_empleado(p_first text, p_last text, p_full text DEFAULT NULL::text)
RETURNS text LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE
    e record;
    completo text := upper(extensions.unaccent(regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g')));
BEGIN
    IF btrim(coalesce(p_first, '')) <> '' OR btrim(coalesce(p_last, '')) <> '' THEN
        SELECT x.nombre_preferido, x.apellido_preferido INTO e
          FROM public.employees x
         WHERE x.first_names = p_first AND x.last_names = p_last
           AND (x.nombre_preferido IS NOT NULL OR x.apellido_preferido IS NOT NULL)
         LIMIT 1;
        RETURN public.nombre_corto_con_eleccion(p_first, p_last, p_full, e.nombre_preferido, e.apellido_preferido);
    END IF;
    IF completo <> '' THEN
        SELECT x.first_names, x.last_names, x.nombre_preferido, x.apellido_preferido INTO e
          FROM public.employees x
         WHERE upper(extensions.unaccent(regexp_replace(btrim(x.name), '\s+', ' ', 'g'))) = completo
         LIMIT 1;
        IF FOUND THEN
            RETURN public.nombre_corto_con_eleccion(e.first_names, e.last_names, p_full, e.nombre_preferido, e.apellido_preferido);
        END IF;
    END IF;
    RETURN public.nombre_corto_con_eleccion(p_first, p_last, p_full, NULL, NULL);
END $$;

-- Los cuatro sitios que lo armaban a mano: se reescriben desde su definición
-- VIVA, y si el texto esperado no está, lanza en vez de seguir.
DO $$
DECLARE
    f   text;
    def text;
    nuevo text;
    a_mano constant text :=
      'NULLIF\(TRIM\(split_part\(COALESCE\((\w+)\.first_names,''''\), '' '', 1\) \|\| '' '' \|\| split_part\(COALESCE\(\1\.last_names,''''\), '' '', 1\)\), ''''\)';
BEGIN
    FOREACH f IN ARRAY ARRAY['get_conteo_item_history', 'get_conteo_items_jsonb', 'get_conteo_items_search'] LOOP
        SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = f;
        nuevo := regexp_replace(def, a_mano,
          'NULLIF(public.nombre_corto_con_eleccion(\1.first_names, \1.last_names, NULL, \1.nombre_preferido, \1.apellido_preferido), ''Personal'')', 'g');
        IF nuevo = def THEN RAISE EXCEPTION '%: no encuentro el nombre armado a mano', f; END IF;
        EXECUTE nuevo;
    END LOOP;

    -- El chat con clientes firma con el primer nombre: el elegido, si lo hay.
    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'chat_responder';
    nuevo := replace(def,
      $x$nullif(initcap(lower(split_part(btrim(coalesce(nullif(btrim(first_names), ''), name, '')), ' ', 1))), '')$x$,
      $x$nullif(initcap(lower(CASE WHEN public.es_parte_del_nombre(nombre_preferido, first_names) THEN btrim(nombre_preferido) ELSE split_part(btrim(coalesce(nullif(btrim(first_names), ''), name, '')), ' ', 1) END)), '')$x$);
    IF nuevo = def THEN RAISE EXCEPTION 'chat_responder: no encuentro el primer nombre'; END IF;
    EXECUTE nuevo;
END $$;
