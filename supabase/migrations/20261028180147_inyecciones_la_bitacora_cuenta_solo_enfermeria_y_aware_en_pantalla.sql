SET lock_timeout = '5s';
-- ── 1) Inyecciones: la bitácora cuenta sólo lo que aplicó enfermería ────────
-- Decisión del usuario (2026-10-28): «solo contará para la bitácora las que son
-- aplicadas por la regente, las demás no. Quedarán como aplicadas, pero no se
-- podrá ver ni en la bitácora, ni los dependientes, solo Admin lo podrá ver.»
--
-- Nada se borra ni se cambia: la fila sigue `aplicada`. Lo que cambia es QUIÉN
-- la ve. Una aplicación marcada por alguien que no es Regente de Enfermería
-- (roles.id 23 — el id, no el rótulo, que va sin tilde) sólo la ve quien tenga
-- `inyecciones_ver_todas`: los cuatro cargos de administración. Lo pendiente
-- (sin aplicar) se sigue viendo igual.
--
-- El permiso va envuelto en (SELECT …): se evalúa una vez, no por fila.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'inyecciones_ver_todas', true, false, false, 'ALL'
  FROM public.roles r WHERE r.id IN (2, 3, 11, 13)   -- Gerente General, Administrador, Talento Humano, Supervisor/a de Ventas
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();

DO $$
DECLARE
    v_cond text := E'\n        AND (a.aplicada_at IS NULL\n             OR (SELECT public.auth_has_module_permission(''inyecciones_ver_todas'', ''can_view''))\n             OR EXISTS (SELECT 1 FROM public.employees e_enf WHERE e_enf.id = a.aplicada_por AND e_enf.role_id = 23))';
    v_cond_h text := E'\n                 AND ((SELECT public.auth_has_module_permission(''inyecciones_ver_todas'', ''can_view''))\n                      OR EXISTS (SELECT 1 FROM public.employees e_enf WHERE e_enf.id = h.aplicada_por AND e_enf.role_id = 23))';
    f text; def text; nuevo text;
BEGIN
    -- Partir de la definición VIVA; si el ancla no está, abortar.
    FOREACH f IN ARRAY ARRAY['inyecciones_bitacora','inyecciones_bitacora_buscar'] LOOP
        SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = f;
        IF def LIKE '%inyecciones_ver_todas%' THEN CONTINUE; END IF;
        nuevo := regexp_replace(def, '(WHERE a\.confirmada\s+AND a\.mezcla_de IS NULL)', '\1' || v_cond);
        IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en %', f; END IF;
        EXECUTE nuevo;
    END LOOP;

    SELECT pg_get_functiondef(p.oid) INTO def FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'inyecciones_pendientes';
    IF def NOT LIKE '%inyecciones_ver_todas%' THEN
        nuevo := regexp_replace(def, '(AND h\.producto = a\.producto)', '\1' || v_cond_h);
        IF nuevo = def THEN RAISE EXCEPTION 'Sin ancla en inyecciones_pendientes'; END IF;
        EXECUTE nuevo;
    END IF;
END $$;

-- ── 2) Listado AWaRe: la pestaña y la confirmación del regente ──────────────
-- La pestaña la ve quien ve el libro. Confirmar una molécula es firma del
-- regente: un permiso propio, sólo para su cargo.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT rp.role_id, 'bitacoras_tab_antibioticos', true, false, false, rp.scope
  FROM public.role_permissions rp
 WHERE rp.module_key = 'bitacoras_tab_libro' AND rp.can_view
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'bitacoras_confirmar_aware', true, true, false, 'ALL'
  FROM public.roles r WHERE r.name = 'Regente'
ON CONFLICT (role_id, module_key) DO NOTHING;

-- La confirmación firma con `auth_employee_id()`: el navegador conoce la
-- cuenta, no la ficha, y para la mayoría no son el mismo id.
CREATE OR REPLACE FUNCTION public.aware_confirmar(p_molecula text, p_grupo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('bitacoras_confirmar_aware', 'can_edit')) THEN
        RAISE EXCEPTION 'Sólo el regente confirma el listado.' USING ERRCODE = '42501';
    END IF;
    IF p_grupo IS NULL OR p_grupo NOT IN ('acceso','precaucion','reserva') THEN
        RAISE EXCEPTION 'Grupo inválido.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.antibioticos_aware
       SET grupo = p_grupo, confirmado_por = public.auth_employee_id(), confirmado_at = now()
     WHERE molecula = p_molecula;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa molécula no está en el listado.' USING ERRCODE = 'P0002'; END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.aware_confirmar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aware_confirmar(text, text) TO authenticated, service_role;

-- El listado lo lee quien ve la pestaña.
CREATE OR REPLACE FUNCTION public.get_listado_antibioticos()
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(json_agg(to_json(t) ORDER BY t.grupo NULLS LAST, t.molecula, t.producto), '[]'::json)
  FROM (
    SELECT DISTINCT ON (p.id)
           p.id            AS product_id,
           p.nombre        AS producto,
           p.principio_activo,
           a.molecula, a.grupo, a.atc, a.fuente,
           a.confirmado_at IS NOT NULL AS confirmado,
           a.confirmado_at,
           coalesce(p.es_antibiotico, false) AS en_el_libro
      FROM public.products p
      JOIN public.antibioticos_aware a
        ON coalesce(p.pactivo_norm, '') LIKE '%' || a.molecula || '%'
        OR coalesce(p.nombre_norm, '')  LIKE '%' || a.molecula || '%'
     WHERE p.activo
       AND (SELECT public.auth_has_module_permission('bitacoras_tab_antibioticos', 'can_view'))
     ORDER BY p.id, length(a.molecula) DESC
  ) t;
$$;
