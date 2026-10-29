-- Sucursales: correcciones de la auditoría del 2026-10-29.
SET lock_timeout = '5s';

-- ── 1. Enfermería en UNA lista ─────────────────────────────────────────────
-- Las 6 farmacias guardaban sus enfermeras sólo en `legal.nurses` (ids). Desde
-- bba1a4e82 la lista que manda es `legal.nursingRegents` (filas con documentos
-- y anualidad), y la ficha, el expediente y el formulario dedicado leían sólo
-- ésa: las 6 salas mostraban «Sin Enfermero/a», y agregar una desde el
-- formulario BORRABA a las que estaban. Se pasan a filas con la misma forma que
-- arma `alternarEnfermera` y se quita la lista vieja.
UPDATE public.branches b
   SET settings = jsonb_set(
         b.settings #- '{legal,nurses}',
         '{legal,nursingRegents}',
         (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', (extract(epoch FROM now()) * 1000)::bigint + n.ord,
                    'employeeId', n.v,
                    'anualidadExp', '') ORDER BY n.ord), '[]'::jsonb)
            FROM jsonb_array_elements_text(b.settings->'legal'->'nurses') WITH ORDINALITY AS n(v, ord)
           WHERE n.v <> ''))
 WHERE jsonb_typeof(b.settings->'legal'->'nurses') = 'array'
   AND NOT (b.settings->'legal' ? 'nursingRegents');

-- Una sala que ya tenía las dos: la vieja ya no se lee.
UPDATE public.branches
   SET settings = settings #- '{legal,nurses}'
 WHERE settings->'legal' ? 'nurses' AND settings->'legal' ? 'nursingRegents';

-- ── 2. Editar la ficha sin pisar lo que guardó otra persona ────────────────
-- `updateBranch` escribía el `settings` ENTERO armado con la copia en memoria
-- de quien guarda: un pago anotado con la pantalla abierta desde la mañana
-- borraba la licencia que otro subió en el medio. Ahora el cliente manda sólo
-- lo que cambió (rutas dentro de `settings` + columnas) y se aplica sobre la
-- fila VIVA, bloqueada, en una sola sentencia. INVOKER: el RLS de `branches`
-- sigue decidiendo quién edita (el FOR UPDATE ya exige la policy de UPDATE).
CREATE OR REPLACE FUNCTION public.editar_sucursal(p_id bigint, p_columnas jsonb, p_parches jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_antes public.branches;
  v_s jsonb;
  v_p jsonb;
  v_ruta text[];
  v_n int;
  i int;
BEGIN
  SELECT * INTO v_antes FROM public.branches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró la sucursal o no tienes permiso para editarla.' USING ERRCODE = '42501';
  END IF;

  v_s := coalesce(v_antes.settings, '{}'::jsonb);
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
    'antes',   to_json(v_antes),
    'despues', (SELECT to_json(b) FROM public.branches b WHERE b.id = p_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.editar_sucursal(bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_sucursal(bigint, jsonb, jsonb) TO authenticated, service_role;

-- ── 3. Alcance por sucursal en lo que se LEE ───────────────────────────────
-- El cargo 40 ve sucursales con alcance de su sala, pero las policies sólo
-- miraban el permiso: leía gastos y archivos legales de toda la red.
DROP POLICY IF EXISTS branch_documents_select ON public.branch_documents;
CREATE POLICY branch_documents_select ON public.branch_documents FOR SELECT TO authenticated
USING (
  (SELECT auth_has_module_permission('branches', 'can_view'))
  AND ((SELECT auth_module_scope('branches')) = 'ALL'
       OR branch_id = (SELECT auth_employee_branch_id()))
);

DROP POLICY IF EXISTS branch_expenses_select ON public.branch_expenses;
CREATE POLICY branch_expenses_select ON public.branch_expenses FOR SELECT TO authenticated
USING (
  ((SELECT auth_has_module_permission('branches', 'can_view'))
    AND ((SELECT auth_module_scope('branches')) = 'ALL'
         OR branch_id = (SELECT auth_employee_branch_id())))
  OR
  ((SELECT auth_has_module_permission('metas', 'can_view'))
    AND ((SELECT auth_module_scope('metas')) = 'ALL'
         OR branch_id = (SELECT auth_employee_branch_id())))
);

-- Storage: sólo la rama `branches/%` de `documents_select`. Se reemplaza el
-- texto exacto y se aborta si no está: así no se reescribe a ciegas el resto
-- de la policy (empleados, solicitudes, practicantes…).
DO $$
DECLARE
  v_qual text;
  v_viejo text := '((name ~~ ''branches/%''::text) AND ( SELECT auth_has_module_permission(''branches''::text, ''can_view''::text) AS auth_has_module_permission))';
  v_nuevo text := '((name ~~ ''branches/%''::text) AND ( SELECT auth_has_module_permission(''branches''::text, ''can_view''::text) AS auth_has_module_permission) AND ((( SELECT auth_module_scope(''branches''::text) AS auth_module_scope) = ''ALL''::text) OR (split_part(name, ''/''::text, 2) = (( SELECT auth_employee_branch_id() AS auth_employee_branch_id))::text)))';
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_select';
  IF v_qual IS NULL OR position(v_viejo IN v_qual) = 0 THEN
    RAISE EXCEPTION 'documents_select no tiene la rama de sucursales esperada; revisar a mano';
  END IF;
  EXECUTE format('ALTER POLICY documents_select ON storage.objects USING (%s)', replace(v_qual, v_viejo, v_nuevo));
END $$;

-- ── 4. anon fuera de las tablas del expediente ─────────────────────────────
-- Grants por defecto de Supabase, inertes hoy por el RLS. Lo mismo que se le
-- revocó a `branches` el 2026-08-31.
REVOKE ALL ON public.branch_documents, public.branch_expenses, public.erp_sucursal_map FROM anon;

-- ── 5. Gastos: un registro por sala, servicio y mes ────────────────────────
ALTER TABLE public.branch_documents ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.branch_expenses  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.branch_expenses
  ADD CONSTRAINT branch_expenses_sala_servicio_mes_key UNIQUE (branch_id, expense_type, billing_month);

-- ── 6. Tope de kioscos en la base ──────────────────────────────────────────
-- El tope (3, `LIMITE_KIOSCOS`) vivía sólo en el navegador: si el conteo
-- fallaba registraba igual, y dos pantallas a la vez lo pasaban.
CREATE OR REPLACE FUNCTION public.kiosk_devices_tope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('kiosk_devices_tope'), NEW.branch_id::int);
    IF (SELECT count(*) FROM public.kiosk_devices
         WHERE branch_id = NEW.branch_id AND status = 'ACTIVE' AND id IS DISTINCT FROM NEW.id) >= 3 THEN
      RAISE EXCEPTION 'Límite alcanzado: ya hay 3 dispositivos activos en esta sucursal.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.kiosk_devices_tope() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_kiosk_devices_tope ON public.kiosk_devices;
CREATE TRIGGER trg_kiosk_devices_tope BEFORE INSERT ON public.kiosk_devices
  FOR EACH ROW EXECUTE FUNCTION public.kiosk_devices_tope();

-- ── 7. Historial de la sala: también lo que la nombra en `details` ─────────
-- Vincular/revocar un kiosco y asignar la jefatura se anotan con el id del
-- dispositivo o de la persona como `target_id`, y llevan la sala en
-- `details`: no salían en el historial de la sucursal.
CREATE OR REPLACE FUNCTION public.audit_log_de_sucursal(p_branch_id text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT ((SELECT public.auth_has_module_permission('branches','can_view'))
       OR (SELECT public.auth_has_module_permission('auditview','can_view'))) THEN
    RAISE EXCEPTION 'sin permiso para ver el historial de la sucursal' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT json_agg(to_json(t) ORDER BY t.created_at DESC)
    FROM (
      -- Dos ramas con UNION y no un OR: cada una entra por su índice
      -- (`target_id` / `action`) en vez de barrer la bitácora entera.
      SELECT a.* FROM public.audit_logs a
       WHERE a.target_id = p_branch_id
      UNION
      SELECT a.* FROM public.audit_logs a
       WHERE a.action IN ('VINCULAR_KIOSCO','REVOCAR_KIOSCO','EMPLEADO_ASIGNADO','EMPLEADO_RELEVADO',
                          'EMPLEADO_DESVINCULADO_SUCURSAL','PROMOTION','SINCRONIZAR_VENTAS_SUCURSAL')
         AND p_branch_id IN (a.details->>'branch_id', a.details->>'target_branch_id', a.details->>'previous_branch_id')
      ORDER BY created_at DESC
      LIMIT 200
    ) t
  ), '[]'::json);
END;
$function$;
