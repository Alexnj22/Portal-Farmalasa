SET lock_timeout = '5s';
-- Inyecciones: cualquiera registra, ENFERMERÍA CONFIRMA, la bitácora es lo
-- confirmado. Definición del usuario (2026-10-28):
--   1. cualquiera puede registrar la aplicación;
--   2. la enfermera confirma cuáles aplicó (pestaña «Por confirmar»);
--   3. la bitácora son las que confirmó.
-- Las que marca ella misma se confirman solas. Las que no confirma hasta el
-- final del día siguiente quedan «no aplicada por enfermería» sin que nadie
-- haga nada: el estado se DERIVA (`inyeccion_enfermeria_estado`), no lo
-- escribe un cron. Cuenta desde el 1-nov-2026; lo anterior sólo lo ve Admin.
--
-- Reemplaza la regla de 20261028181138 («con enfermería en la sala, sólo ella
-- marca»), que se deshace acá.

-- 1 · Deshacer 20261028181138 (partiendo de la definición VIVA).
DO $$
DECLARE def text; nuevo text;
BEGIN
    SELECT pg_get_functiondef('public.inyeccion_aplicar'::regproc) INTO def;
    nuevo := regexp_replace(def, '\n  IF NOT EXISTS \(SELECT 1 FROM public\.employees WHERE id = v_emp AND role_id = 23\).*?END IF;', '', 's');
    IF nuevo = def OR nuevo LIKE '%inyeccion_enfermeria_presente%' THEN RAISE EXCEPTION 'Sin ancla en inyeccion_aplicar'; END IF;
    EXECUTE nuevo;

    SELECT pg_get_functiondef('public.inyeccion_registrar(bigint,text,jsonb,integer,text,integer,uuid,text)'::regprocedure) INTO def;
    nuevo := replace(def, E'\n  v_para_enf boolean := false;', '');
    nuevo := regexp_replace(nuevo, '\n  IF v_ahora > 0\n     AND NOT EXISTS .*?END IF;\n', '', 's');
    nuevo := replace(nuevo, ', ''para_enfermeria'', v_para_enf', '');
    IF nuevo LIKE '%v_para_enf%' OR nuevo LIKE '%inyeccion_enfermeria_presente%' THEN RAISE EXCEPTION 'Sin ancla en inyeccion_registrar'; END IF;
    EXECUTE nuevo;
END $$;
DROP FUNCTION public.inyeccion_enfermeria_presente(integer);

-- 2 · Quién de enfermería la confirmó, y cuándo.
ALTER TABLE public.inyeccion_aplicaciones
    ADD COLUMN enfermeria_por uuid REFERENCES public.employees(id),
    ADD COLUMN enfermeria_at  timestamptz;
CREATE INDEX inyeccion_aplicaciones_enfermeria_por_idx ON public.inyeccion_aplicaciones (enfermeria_por);

-- 3 · El juez, UNO solo: lo usan la lista, la confirmación, el trigger y la
-- bitácora. NULL = sin aplicar · CONFIRMADA · POR_CONFIRMAR (hasta el final
-- del día siguiente, hora SV) · NO (pasó el plazo, o es anterior al 1-nov).
CREATE FUNCTION public.inyeccion_enfermeria_estado(p_aplicada_at timestamptz, p_enfermeria_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_aplicada_at IS NULL THEN NULL
    WHEN p_enfermeria_at IS NOT NULL THEN 'CONFIRMADA'
    WHEN p_aplicada_at < timestamptz '2026-11-01 00:00:00 America/El_Salvador' THEN 'NO'
    WHEN (p_aplicada_at AT TIME ZONE 'America/El_Salvador')::date
         >= (now() AT TIME ZONE 'America/El_Salvador')::date - 1 THEN 'POR_CONFIRMAR'
    ELSE 'NO'
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_enfermeria_estado(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_enfermeria_estado(timestamptz, timestamptz) TO authenticated, service_role;

-- 4 · El permiso: la pestaña la ve y la opera Regente de Enfermería (23); los
-- cuatro cargos de administración la ven sin confirmar.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
VALUES (23, 'inyecciones_tab_confirmar', true, true, false, 'BRANCH'),
       (2,  'inyecciones_tab_confirmar', true, false, false, 'ALL'),
       (3,  'inyecciones_tab_confirmar', true, false, false, 'ALL'),
       (11, 'inyecciones_tab_confirmar', true, false, false, 'ALL'),
       (13, 'inyecciones_tab_confirmar', true, false, false, 'ALL')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- 5 · La que marca quien puede confirmar, se confirma sola.
CREATE FUNCTION public.inyeccion_confirma_enfermeria_sola()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.aplicada_por IS NOT NULL AND NEW.enfermeria_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.aplicada_por IS DISTINCT FROM NEW.aplicada_por)
     AND public.inyeccion_enfermeria_estado(NEW.aplicada_at, NULL) = 'POR_CONFIRMAR'
     AND EXISTS (SELECT 1 FROM public.employees e
                   JOIN public.role_permissions rp ON rp.role_id = e.role_id
                  WHERE e.id = NEW.aplicada_por
                    AND rp.module_key = 'inyecciones_tab_confirmar' AND rp.can_edit) THEN
    NEW.enfermeria_por := NEW.aplicada_por;
    NEW.enfermeria_at  := NEW.aplicada_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_confirma_enfermeria_sola() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER inyeccion_confirma_enfermeria_sola
  BEFORE INSERT OR UPDATE OF aplicada_por ON public.inyeccion_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION public.inyeccion_confirma_enfermeria_sola();

-- 6 · La lista de enfermería: lo aplicado en su sala que todavía puede confirmar.
CREATE FUNCTION public.inyecciones_por_confirmar(p_branch_id integer DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT (SELECT auth_has_module_permission('inyecciones_tab_confirmar', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    p_branch_id := (SELECT auth_employee_branch_id());
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN coalesce((
    SELECT json_agg(x ORDER BY x.aplicada_at DESC, x.id DESC)
    FROM (
      SELECT a.id, coalesce(a.aplicada_branch_id, a.branch_id) AS sala_id, ba.name AS aplicada_en,
             a.origen, si.correlativo, coalesce(a.cliente, si.cliente) AS cliente,
             CASE WHEN mz.otros IS NULL THEN a.producto
                  ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros END AS producto,
             CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml, (mz.otros IS NOT NULL) AS mezclada,
             a.aplicada_at, ea.name AS aplicada_por, a.aplicada_por AS aplicada_por_id,
             (a.aplicada_at AT TIME ZONE 'America/El_Salvador')::date + 1 AS confirmar_hasta
      FROM inyeccion_aplicaciones a
      JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
      LEFT JOIN branches ba ON ba.id = coalesce(a.aplicada_branch_id, a.branch_id)
      LEFT JOIN sales_invoices si ON si.id = a.invoice_id
      LEFT JOIN employees ea ON ea.id = a.aplicada_por
      LEFT JOIN LATERAL (
        SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
        FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
      ) mz ON true
      WHERE a.confirmada AND a.mezcla_de IS NULL
        AND a.aplicada_at > now() - interval '3 days'
        AND public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) = 'POR_CONFIRMAR'
        AND (p_branch_id IS NULL OR coalesce(a.aplicada_branch_id, a.branch_id) = p_branch_id)
      LIMIT 500
    ) x
  ), '[]'::json);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyecciones_por_confirmar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyecciones_por_confirmar(integer) TO authenticated, service_role;

-- 7 · Confirmar: queda a nombre de quien confirma. Una mezcla arrastra su grupo.
CREATE FUNCTION public.inyeccion_confirmar_enfermeria(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp  uuid := (SELECT auth_employee_id());
  v_sala integer;
  v_n    integer;
BEGIN
  IF v_emp IS NULL OR NOT (SELECT auth_has_module_permission('inyecciones_tab_confirmar', 'can_edit')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce((SELECT auth_module_scope('inyecciones')), '') <> 'ALL' THEN
    v_sala := (SELECT auth_employee_branch_id());
    IF v_sala IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  END IF;
  WITH u AS (
    UPDATE inyeccion_aplicaciones a
       SET enfermeria_por = v_emp, enfermeria_at = now()
     WHERE ((a.id = ANY (p_ids) AND a.mezcla_de IS NULL) OR a.mezcla_de = ANY (p_ids))
       AND public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) = 'POR_CONFIRMAR'
       AND (v_sala IS NULL OR coalesce(a.aplicada_branch_id, a.branch_id) = v_sala)
    RETURNING a.id
  )
  SELECT count(*) FILTER (WHERE u.id = ANY (p_ids)) INTO v_n FROM u;
  IF v_n <> coalesce(array_length(p_ids, 1), 0) THEN
    RAISE EXCEPTION 'Alguna ya no se puede confirmar: ya estaba confirmada o pasó el plazo. Vuelve a cargar.';
  END IF;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.inyeccion_confirmar_enfermeria(bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inyeccion_confirmar_enfermeria(bigint[]) TO authenticated, service_role;

-- 8 · La bitácora y el historial de Pendientes: lo confirmado por enfermería,
-- con la enfermera como quien aplicó. Admin (`inyecciones_ver_todas`) ve
-- además lo no confirmado, con su estado en `enfermeria`.
DO $$
DECLARE f text; def text; nuevo text;
BEGIN
  FOREACH f IN ARRAY ARRAY['inyecciones_bitacora', 'inyecciones_bitacora_buscar'] LOOP
    SELECT pg_get_functiondef(('public.' || f)::regproc) INTO def;
    nuevo := replace(def,
      'OR EXISTS (SELECT 1 FROM public.employees e_enf WHERE e_enf.id = a.aplicada_por AND e_enf.role_id = 23))',
      'OR a.enfermeria_at IS NOT NULL)');
    nuevo := replace(nuevo,
      'a.aplicada_at, ea.name AS aplicada_por, a.aplicada_por AS aplicada_por_id,',
      'a.aplicada_at, coalesce(en.name, ea.name) AS aplicada_por, coalesce(a.enfermeria_por, a.aplicada_por) AS aplicada_por_id, ea.name AS marcada_por, public.inyeccion_enfermeria_estado(a.aplicada_at, a.enfermeria_at) AS enfermeria,');
    nuevo := replace(nuevo,
      'LEFT JOIN employees ea ON ea.id = a.aplicada_por',
      E'LEFT JOIN employees ea ON ea.id = a.aplicada_por\n      LEFT JOIN employees en ON en.id = a.enfermeria_por');
    IF nuevo LIKE '%e_enf.role_id = 23%' OR nuevo NOT LIKE '%AS enfermeria,%' OR nuevo NOT LIKE '%employees en ON%' THEN
      RAISE EXCEPTION 'Sin ancla en %', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;

  SELECT pg_get_functiondef('public.inyecciones_pendientes'::regproc) INTO def;
  nuevo := replace(def,
    'OR EXISTS (SELECT 1 FROM public.employees e_enf WHERE e_enf.id = h.aplicada_por AND e_enf.role_id = 23))',
    'OR h.enfermeria_at IS NOT NULL)');
  nuevo := replace(nuevo,
    '''aplicada_por'', eh.name,',
    '''aplicada_por'', coalesce(enh.name, eh.name),');
  nuevo := replace(nuevo,
    '''aplicada_por_id'', h.aplicada_por,',
    '''aplicada_por_id'', coalesce(h.enfermeria_por, h.aplicada_por),');
  nuevo := replace(nuevo,
    'LEFT JOIN employees eh ON eh.id = h.aplicada_por',
    E'LEFT JOIN employees eh ON eh.id = h.aplicada_por\n                LEFT JOIN employees enh ON enh.id = h.enfermeria_por');
  IF nuevo LIKE '%e_enf.role_id = 23%' OR nuevo NOT LIKE '%employees enh ON%' OR nuevo NOT LIKE '%coalesce(h.enfermeria_por%' THEN
    RAISE EXCEPTION 'Sin ancla en inyecciones_pendientes';
  END IF;
  EXECUTE nuevo;
END $$;
