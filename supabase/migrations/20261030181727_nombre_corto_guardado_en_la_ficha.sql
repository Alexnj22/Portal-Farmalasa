-- El nombre corto, GUARDADO en la ficha (2026-10-30). La migración anterior
-- (nombre_elegido_en_el_servidor) lo calculaba por renglón en el conteo, y
-- medido sobre 20,000 renglones costaba 231 ms contra 12.5 ms del corte viejo:
-- la expresión regular de las partículas, dos veces por renglón. Un conteo
-- tiene 3,407 renglones con dos nombres cada uno.
--
-- Pero el nombre corto sólo cambia cuando cambia la ficha, y la tabla tiene 50
-- filas: se calcula al escribir la ficha (trigger) y se lee como columna.
-- `nombre_corto_con_eleccion` sigue siendo la regla; esta columna es su
-- resultado guardado.
SET lock_timeout = '5s';

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS nombre_corto text;
COMMENT ON COLUMN public.employees.nombre_corto IS
  'Nombre corto del portal (nombre + apellido elegidos, o el primero de cada uno). Lo mantiene trg_nombre_corto; no se escribe a mano.';

CREATE OR REPLACE FUNCTION public.mantener_nombre_corto()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
    -- `name` es generada y en un BEFORE todavía no está: con nombres y
    -- apellidos vacíos el resultado es 'Personal', igual que en el navegador.
    NEW.nombre_corto := public.nombre_corto_con_eleccion(
        NEW.first_names, NEW.last_names, NULL, NEW.nombre_preferido, NEW.apellido_preferido);
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.mantener_nombre_corto() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_nombre_corto ON public.employees;
CREATE TRIGGER trg_nombre_corto
    BEFORE INSERT OR UPDATE OF first_names, last_names, nombre_preferido, apellido_preferido, nombre_corto
    ON public.employees FOR EACH ROW EXECUTE FUNCTION public.mantener_nombre_corto();

-- Relleno. Medido antes: `derivar_kiosk_pin` (BEFORE UPDATE) no le cambia el
-- PIN a nadie (0 de 50), y `audit_employee_sensitive_changes` no mira estas
-- columnas.
UPDATE public.employees SET nombre_corto = NULL;

-- El canónico de SQL lee la columna en vez de calcular.
CREATE OR REPLACE FUNCTION public.nombre_corto_de_empleado(p_first text, p_last text, p_full text DEFAULT NULL::text)
RETURNS text LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
DECLARE
    v text;
    completo text := upper(extensions.unaccent(regexp_replace(btrim(coalesce(p_full, '')), '\s+', ' ', 'g')));
BEGIN
    IF btrim(coalesce(p_first, '')) <> '' OR btrim(coalesce(p_last, '')) <> '' THEN
        SELECT x.nombre_corto INTO v FROM public.employees x
         WHERE x.first_names = p_first AND x.last_names = p_last LIMIT 1;
        RETURN coalesce(v, public.nombre_corto_con_eleccion(p_first, p_last, p_full, NULL, NULL));
    END IF;
    IF completo <> '' THEN
        SELECT x.nombre_corto INTO v FROM public.employees x
         WHERE upper(extensions.unaccent(regexp_replace(btrim(x.name), '\s+', ' ', 'g'))) = completo
         LIMIT 1;
        IF v IS NOT NULL THEN RETURN v; END IF;
    END IF;
    RETURN public.nombre_corto_con_eleccion(p_first, p_last, p_full, NULL, NULL);
END $$;

-- El conteo lee la columna.
DO $$
DECLARE
    f   text;
    def text;
    nuevo text;
BEGIN
    FOREACH f IN ARRAY ARRAY['get_conteo_item_history', 'get_conteo_items_jsonb', 'get_conteo_items_search'] LOOP
        SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = f;
        nuevo := regexp_replace(def,
          'NULLIF\(public\.nombre_corto_con_eleccion\((\w+)\.first_names, \1\.last_names, NULL, \1\.nombre_preferido, \1\.apellido_preferido\), ''Personal''\)',
          'NULLIF(\1.nombre_corto, ''Personal'')', 'g');
        IF nuevo = def THEN RAISE EXCEPTION '%: no encuentro el nombre calculado', f; END IF;
        EXECUTE nuevo;
    END LOOP;
END $$;

-- La vista del portal también la expone (el navegador sigue calculando con
-- `shortEmployeeName`, que es el gemelo; esto es para quien lee por SQL).
DO $$
DECLARE
    def   text := pg_get_viewdef('public.employees_safe'::regclass);
    ancla text := 'e.nombre_elegido_el';
BEGIN
    IF position('nombre_corto' IN def) > 0 THEN RETURN; END IF;
    IF position(ancla IN def) = 0 THEN
        RAISE EXCEPTION 'employees_safe cambió: no encuentro «%»', ancla;
    END IF;
    def := rtrim(def, E'; \n');
    def := replace(def, ancla, ancla || ', e.nombre_corto');
    EXECUTE 'CREATE OR REPLACE VIEW public.employees_safe WITH (security_invoker = true) AS ' || def;
END $$;
