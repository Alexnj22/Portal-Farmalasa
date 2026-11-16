SET lock_timeout = '5s';

-- Novedades (2026-11-16): la guía de lo nuevo del portal y la app, para todo
-- el personal. Desde ahí quien tiene Android deja el correo de su cuenta de
-- Google para entrar a la prueba interna de la app del personal en Google
-- Play. Ese correo además pone al día el de su ficha de empleado y, si el
-- empleado tiene ficha de cliente (se cruza por el DUI, como
-- `cliente_es_empleado`), el portal le propone actualizar también la de
-- cliente por `update_customer_fiscal`, que es el único camino de escritura
-- de `customers`.

CREATE TABLE IF NOT EXISTS public.app_pruebas_android (
  employee_id  uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  email        text NOT NULL,
  -- Cuándo se agregó a la lista de la prueba interna en Google Play. Se
  -- marca a mano desde la vista: Play no deja agregar correos por su API.
  agregado_at  timestamptz,
  agregado_por uuid REFERENCES public.employees(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_pruebas_android_agregado_por_idx ON public.app_pruebas_android(agregado_por);

ALTER TABLE public.app_pruebas_android ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_pruebas_android FROM anon;
GRANT SELECT ON public.app_pruebas_android TO authenticated;

-- Cada quien ve el suyo; quien edita Novedades ve la lista entera. Se escribe
-- sólo por las dos funciones de abajo (DEFINER), así que no hay policy de
-- escritura.
DROP POLICY IF EXISTS app_pruebas_android_select ON public.app_pruebas_android;
CREATE POLICY app_pruebas_android_select ON public.app_pruebas_android
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
         OR (SELECT public.auth_can_edit_any(ARRAY['novedades'])));

CREATE OR REPLACE FUNCTION public.novedades_correo_android(p_email text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_emp        uuid := public.auth_employee_id();
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_anterior   text;
  v_dui        text;
  v_clientes   bigint[];
  v_cliente    bigint;
  v_correo_cli text;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'SIN_EMPLEADO'; END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' THEN RAISE EXCEPTION 'CORREO_INVALIDO'; END IF;

  SELECT e.email, regexp_replace(coalesce(e.dui, ''), '\D', '', 'g')
    INTO v_anterior, v_dui
    FROM public.employees e WHERE e.id = v_emp;

  -- El correo de la ficha del empleado. El que tenía, si era otro, no se
  -- pierde: pasa a los correos adicionales.
  UPDATE public.employees e
     SET email = v_email,
         extra_emails = CASE
           WHEN v_anterior IS NOT NULL AND btrim(v_anterior) <> ''
            AND lower(btrim(v_anterior)) <> v_email
            AND NOT (v_anterior = ANY (coalesce(e.extra_emails, '{}')))
           THEN array_append(coalesce(e.extra_emails, '{}'), v_anterior)
           ELSE e.extra_emails END
   WHERE e.id = v_emp
     AND e.email IS DISTINCT FROM v_email;

  INSERT INTO public.app_pruebas_android (employee_id, email)
  VALUES (v_emp, v_email)
  ON CONFLICT (employee_id) DO UPDATE
     SET email = EXCLUDED.email,
         updated_at = now(),
         -- Otro correo es otra cuenta de Google: hay que volver a agregarlo.
         agregado_at  = CASE WHEN app_pruebas_android.email = EXCLUDED.email THEN app_pruebas_android.agregado_at END,
         agregado_por = CASE WHEN app_pruebas_android.email = EXCLUDED.email THEN app_pruebas_android.agregado_por END;

  -- Su ficha de cliente, sólo si hay UNA con su DUI.
  IF length(v_dui) = 9 THEN
    SELECT array_agg(c.id) INTO v_clientes
      FROM public.customers c
     WHERE c.anonimizada_at IS NULL
       AND regexp_replace(coalesce(c.dui, ''), '\D', '', 'g') = v_dui;
    IF coalesce(array_length(v_clientes, 1), 0) = 1 THEN
      v_cliente := v_clientes[1];
      SELECT c.email INTO v_correo_cli FROM public.customers c WHERE c.id = v_cliente;
    END IF;
  END IF;

  RETURN json_build_object(
    'correo', v_email,
    'correo_anterior', v_anterior,
    'cliente_id', v_cliente,
    'correo_cliente', v_correo_cli);
END $$;
REVOKE EXECUTE ON FUNCTION public.novedades_correo_android(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novedades_correo_android(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.novedades_android_agregados(p_empleados uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_n integer;
BEGIN
  IF NOT (SELECT public.auth_can_edit_any(ARRAY['novedades'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  UPDATE public.app_pruebas_android
     SET agregado_at = now(), agregado_por = public.auth_employee_id(), updated_at = now()
   WHERE employee_id = ANY (p_empleados) AND agregado_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE EXECUTE ON FUNCTION public.novedades_android_agregados(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novedades_android_agregados(uuid[]) TO authenticated, service_role;

-- El módulo: todos lo ven; administración (los cuatro cargos de «admin») lo
-- edita, que es ver la lista de correos y marcarlos como agregados.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'novedades', true, r.id IN (2, 3, 11, 13), false, 'ALL'
  FROM public.roles r
 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r.id AND x.module_key = 'novedades');
