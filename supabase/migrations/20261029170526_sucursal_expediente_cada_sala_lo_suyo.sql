-- Cada sucursal ve lo suyo (2026-10-29, pedido del usuario: «cada sucursal
-- debe tener lo suyo»).
--
-- `branches` se lee con `USING (true)`: la necesitan todos (nombre, horario,
-- ubicación) y el kiosco antes del login. Pero `settings` llevaba también el
-- expediente —lo legal, el alquiler con su monto y su arrendante, los servicios
-- y los documentos propios—, así que cualquier sesión del portal leía el de
-- toda la red. Un permiso por columna no sirve (cada `select('*')` reventaría)
-- y una policy de fila no puede ocultar media columna.
--
-- Esas cuatro claves se mudan a `sucursal_expediente`, con la misma regla que
-- los documentos y los gastos: el módulo `branches` con alcance a toda la red,
-- o la sala propia. Un trigger las saca de `branches.settings` en CADA
-- escritura, así ningún escritor —el portal, la app, una versión vieja abierta
-- en otra pestaña— tiene que saber que existe la tabla.
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.sucursal_expediente (
  branch_id  bigint PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  datos      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.sucursal_expediente IS
  'Expediente de cada sala (legal, rent, services, customDocs), separado de branches.settings para que cada sala vea lo suyo. Lo escribe sólo el trigger trg_separar_expediente de branches.';

ALTER TABLE public.sucursal_expediente ENABLE ROW LEVEL SECURITY;

CREATE POLICY bloqueo_global ON public.sucursal_expediente AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT auth_no_bloqueado()));

CREATE POLICY sucursal_expediente_select ON public.sucursal_expediente FOR SELECT TO authenticated
USING (
  (SELECT auth_has_module_permission('branches', 'can_view'))
  AND ((SELECT auth_module_scope('branches')) = 'ALL'
       OR branch_id = (SELECT auth_employee_branch_id()))
);
-- Sin policy de escritura a propósito: la escribe sólo el trigger (DEFINER),
-- y quién puede escribir lo decide la policy de UPDATE/INSERT de `branches`.

REVOKE ALL ON public.sucursal_expediente FROM anon, PUBLIC;
GRANT SELECT ON public.sucursal_expediente TO authenticated;
GRANT ALL ON public.sucursal_expediente TO service_role;

-- ── El trigger ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.separar_expediente_de_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_claves constant text[] := ARRAY['legal', 'rent', 'services', 'customDocs'];
  v_parte jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- AFTER INSERT: la fila de `branches` ya existe para la FK. Toda sala
    -- tiene su fila de expediente, aunque esté vacía: así «no hay fila» en el
    -- navegador significa «no tienes permiso», nunca «no hay datos».
    INSERT INTO public.sucursal_expediente (branch_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    IF NEW.settings ?| v_claves THEN
      UPDATE public.branches SET settings = settings WHERE id = NEW.id;  -- lo muda la rama UPDATE
    END IF;
    RETURN NULL;
  END IF;

  -- BEFORE UPDATE: lo que traiga de esas claves va al expediente (clave por
  -- clave: una ausente NO borra lo que había) y sale de `settings`.
  IF NEW.settings IS NOT NULL AND NEW.settings ?| v_claves THEN
    SELECT coalesce(jsonb_object_agg(k, NEW.settings -> k), '{}'::jsonb)
      INTO v_parte
      FROM unnest(v_claves) AS k
     WHERE NEW.settings ? k;
    INSERT INTO public.sucursal_expediente AS e (branch_id, datos) VALUES (NEW.id, v_parte)
    ON CONFLICT (branch_id) DO UPDATE
       SET datos = e.datos || EXCLUDED.datos, updated_at = now()
     WHERE e.datos IS DISTINCT FROM e.datos || EXCLUDED.datos;
    NEW.settings := NEW.settings - v_claves;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.separar_expediente_de_sucursal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_separar_expediente ON public.branches;
CREATE TRIGGER trg_separar_expediente BEFORE UPDATE OF settings ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.separar_expediente_de_sucursal();
DROP TRIGGER IF EXISTS trg_separar_expediente_alta ON public.branches;
CREATE TRIGGER trg_separar_expediente_alta AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.separar_expediente_de_sucursal();

-- ── La mudanza ────────────────────────────────────────────────────────────
INSERT INTO public.sucursal_expediente (branch_id) SELECT id FROM public.branches ON CONFLICT DO NOTHING;
UPDATE public.branches SET settings = settings
 WHERE settings ?| ARRAY['legal', 'rent', 'services', 'customDocs'];

-- ── `editar_sucursal`: lee y devuelve la sucursal ENTERA ──────────────────
-- Arma `settings` con las dos mitades, aplica los parches y escribe en
-- `branches`; el trigger vuelve a separar. INVOKER: quien no ve el expediente
-- de esa sala lo recibe vacío (y no tiene `branches_update` para escribir).
CREATE OR REPLACE FUNCTION public.editar_sucursal(p_id bigint, p_columnas jsonb, p_parches jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_antes public.branches;
  v_exp jsonb;
  v_s jsonb;
  v_s_antes jsonb;
  v_p jsonb;
  v_ruta text[];
  v_n int;
  i int;
BEGIN
  SELECT * INTO v_antes FROM public.branches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la sucursal o no tienes permiso para editarla.' USING ERRCODE = '42501';
  END IF;
  SELECT datos INTO v_exp FROM public.sucursal_expediente WHERE branch_id = p_id;

  v_s_antes := coalesce(v_antes.settings, '{}'::jsonb) || coalesce(v_exp, '{}'::jsonb);
  v_s := v_s_antes;
  FOR v_p IN SELECT * FROM jsonb_array_elements(coalesce(p_parches, '[]'::jsonb)) LOOP
    v_ruta := ARRAY(SELECT jsonb_array_elements_text(v_p->'ruta'));
    IF coalesce(array_length(v_ruta, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Parche sin ruta' USING ERRCODE = '22023';
    END IF;
    -- Los padres que falten (o que no sean objeto) se crean: `jsonb_set` sólo
    -- crea la ÚLTIMA clave y, sin padre, devuelve el valor intacto sin error.
    FOR i IN 1 .. array_length(v_ruta, 1) - 1 LOOP
      IF jsonb_typeof(v_s #> v_ruta[1:i]) IS DISTINCT FROM 'object' THEN
        v_s := jsonb_set(v_s, v_ruta[1:i], '{}'::jsonb, true);
      END IF;
    END LOOP;
    v_s := jsonb_set(v_s, v_ruta, coalesce(v_p->'valor', 'null'::jsonb), true);
  END LOOP;

  UPDATE public.branches SET
    settings     = v_s,
    name         = CASE WHEN p_columnas ? 'name'         THEN p_columnas->>'name'                ELSE name END,
    address      = CASE WHEN p_columnas ? 'address'      THEN p_columnas->>'address'             ELSE address END,
    phone        = CASE WHEN p_columnas ? 'phone'        THEN p_columnas->>'phone'               ELSE phone END,
    cell         = CASE WHEN p_columnas ? 'cell'         THEN p_columnas->>'cell'                ELSE cell END,
    opening_date = CASE WHEN p_columnas ? 'opening_date' THEN (p_columnas->>'opening_date')::date ELSE opening_date END,
    weekly_hours = CASE WHEN p_columnas ? 'weekly_hours' THEN p_columnas->'weekly_hours'         ELSE weekly_hours END
  WHERE id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No tienes permiso para editar esta sucursal.' USING ERRCODE = '42501';
  END IF;

  RETURN json_build_object(
    'antes',   to_jsonb(v_antes) || jsonb_build_object('settings', v_s_antes),
    'despues', (SELECT to_jsonb(b) || jsonb_build_object('settings',
                         coalesce(b.settings, '{}'::jsonb)
                         || coalesce((SELECT e.datos FROM public.sucursal_expediente e WHERE e.branch_id = b.id), '{}'::jsonb))
                  FROM public.branches b WHERE b.id = p_id));
END;
$$;

-- ── El único lector de la base que miraba el expediente ───────────────────
DO $$
DECLARE
  v_def text;
  v_viejo constant text := $q$(b.settings->'legal'->>'regentEmployeeId')$q$;
  v_nuevo constant text := $q$((SELECT e.datos->'legal'->>'regentEmployeeId' FROM public.sucursal_expediente e WHERE e.branch_id = b.id))$q$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avisar_cuadre_antibioticos';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 2 THEN
    RAISE EXCEPTION 'avisar_cuadre_antibioticos no tiene las dos lecturas esperadas; revisar a mano';
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END $$;
