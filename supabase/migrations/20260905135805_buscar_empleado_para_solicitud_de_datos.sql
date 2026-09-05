SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Encontrar a un empleado para responder una solicitud sobre sus datos.
--
-- ── Por qué hace falta una función ─────────────────────────────────────────
-- `employees.dui` y `employees.code` NO tienen GRANT de SELECT para
-- `authenticated`: se leen sólo por funciones. Es una protección deliberada y
-- está bien, pero tiene una consecuencia que cuesta ver: un `select` que NOMBRE
-- una de esas dos columnas **falla entero**, no devuelve la fila sin ellas. Y
-- eso incluye filtrar por `dui`, no sólo leerlo.
--
-- El módulo de solicitudes lo pedía en su búsqueda y la consulta de personal
-- moría con «permission denied for column dui». En pantalla eso salía como
-- «expediente de personal: no se pudo consultar», que es correcto pero inútil:
-- una persona que pide acceso a SU expediente no aparecía.
--
-- La salida NO es abrirle el GRANT a todo el portal —eso expondría el DUI de
-- las 48 fichas a cualquiera que sepa escribir una consulta— sino esta función,
-- que exige el permiso del módulo y no sirve para nada más.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.buscar_empleado_para_solicitud(
    p_dui      text DEFAULT NULL,
    p_telefono text DEFAULT NULL,
    p_nombre   text DEFAULT NULL
)
RETURNS TABLE (
    id         uuid,
    name       text,
    code       text,
    dui        text,
    phone      text,
    email      text,
    address    text,
    birth_date date,
    status     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_dui text := nullif(regexp_replace(coalesce(p_dui, ''), '\D', '', 'g'), '');
    v_tel text := nullif(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), '');
    v_nom text := nullif(btrim(coalesce(p_nombre, '')), '');
BEGIN
    -- El permiso del MÓDULO, no un cargo: el día que el delegado sea otra
    -- persona, se le da el módulo y esto sigue funcionando sin tocar la base.
    IF NOT (SELECT public.auth_has_module_permission('datos_personales', 'can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING errcode = '42501';
    END IF;

    -- Sin ningún criterio no devuelve el padrón entero. Una función que con
    -- argumentos vacíos lista a las 48 personas es un volcado disfrazado de
    -- búsqueda.
    IF v_dui IS NULL AND v_tel IS NULL AND v_nom IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT e.id, e.name, e.code, e.dui, e.phone, e.email, e.address, e.birth_date, e.status
    FROM public.employees e
    WHERE (v_dui IS NOT NULL AND regexp_replace(coalesce(e.dui, ''), '\D', '', 'g') = v_dui)
       OR (v_tel IS NOT NULL AND regexp_replace(coalesce(e.phone, ''), '\D', '', 'g') = v_tel)
       OR (v_nom IS NOT NULL AND e.name ILIKE '%' || v_nom || '%')
    ORDER BY e.name
    LIMIT 20;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_empleado_para_solicitud(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.buscar_empleado_para_solicitud(text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.buscar_empleado_para_solicitud(text, text, text) IS
'Busca a un empleado por DUI, telefono o nombre para responder una solicitud sobre datos personales. DEFINER porque employees.dui y employees.code no tienen GRANT de SELECT para authenticated, y un select que los nombre falla entero. Exige can_edit en el modulo datos_personales.';
