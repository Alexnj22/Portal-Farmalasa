-- El nombre con el que cada persona aparece en el portal lo elige ella
-- (2026-10-30). Hasta hoy el nombre corto era SIEMPRE el primer nombre + el
-- primer apellido; quien se hace llamar por su segundo nombre aparecía con uno
-- que no usa. Ahora elige UNO de sus nombres y UNO de sus apellidos —de los
-- suyos, tal como están en la ficha: no es un apodo— y el portal muestra ése.
--
-- `name` (generada) y `first_names`/`last_names` NO cambian: son el nombre
-- legal, y es el que sale en planilla, CSV, contratos y PDF.
SET lock_timeout = '5s';

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS nombre_preferido   text,
    ADD COLUMN IF NOT EXISTS apellido_preferido text,
    ADD COLUMN IF NOT EXISTS nombre_elegido_el  timestamptz;

COMMENT ON COLUMN public.employees.nombre_preferido IS
  'Cuál de sus nombres usa en el portal (uno de first_names). NULL = el primero.';
COMMENT ON COLUMN public.employees.apellido_preferido IS
  'Cuál de sus apellidos usa en el portal (uno de last_names). NULL = el primero.';
COMMENT ON COLUMN public.employees.nombre_elegido_el IS
  'Cuándo lo eligió. NULL = todavía no se le preguntó (el portal le pregunta al entrar).';

-- La vista que lee el portal: se agregan las tres columnas al final. Se arma
-- desde su definición viva para no reescribir 300 líneas a mano; si el ancla no
-- está, lanza en vez de dejar la vista sin las columnas.
DO $$
DECLARE
    def   text := pg_get_viewdef('public.employees_safe'::regclass);
    ancla text := 'rango_de_empleado(e.id) AS rango';
BEGIN
    IF position('nombre_preferido' IN def) > 0 THEN RETURN; END IF;
    IF position(ancla IN def) = 0 THEN
        RAISE EXCEPTION 'employees_safe cambió: no encuentro «%»', ancla;
    END IF;
    def := rtrim(def, E'; \n');
    def := replace(def, ancla,
        ancla || ', e.nombre_preferido, e.apellido_preferido, e.nombre_elegido_el');
    EXECUTE 'CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker = true) AS ' || def;
END $$;

-- ¿`parte` es uno de los nombres de `completo`? Por palabras enteras y sin
-- tildes: «DE LA CRUZ» sí es un apellido de «PEREZ DE LA CRUZ», «PER» no.
CREATE OR REPLACE FUNCTION public.es_parte_del_nombre(parte text, completo text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT nullif(trim(parte), '') IS NOT NULL
     AND position(
           ' ' || regexp_replace(upper(extensions.unaccent(trim(parte))), '\s+', ' ', 'g') || ' '
           IN ' ' || regexp_replace(upper(extensions.unaccent(coalesce(completo, ''))), '\s+', ' ', 'g') || ' '
         ) > 0;
$$;
REVOKE EXECUTE ON FUNCTION public.es_parte_del_nombre(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_parte_del_nombre(text, text) TO authenticated, service_role;

-- La persona elige SU nombre: la ficha sale de la sesión, nunca de un parámetro.
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
       SET nombre_preferido   = upper(trim(p_nombre)),
           apellido_preferido = upper(trim(p_apellido)),
           nombre_elegido_el  = now()
     WHERE id = yo;
    RETURN json_build_object('nombre_preferido', upper(trim(p_nombre)),
                             'apellido_preferido', upper(trim(p_apellido)),
                             'nombre_elegido_el', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.elegir_nombre_en_el_portal(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.elegir_nombre_en_el_portal(text, text) TO authenticated, service_role;
