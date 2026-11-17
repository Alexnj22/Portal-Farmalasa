SET lock_timeout = '5s';

-- Novedades vistas (2026-11-17). Hasta hoy «revisada» vivía en el navegador:
-- en otro dispositivo la persona volvía a verlas todas sin revisar, y nadie
-- podía saber quién las había visto. Pedido del usuario: «así si entra en
-- otro dispositivo sepa cuál vio y cuál no».
--
-- `clave` es `<tanda>:<novedad>` para cada novedad abierta, y
-- `entrada:<tanda>` para la pantalla «Hay novedades» del inicio de sesión.
CREATE TABLE IF NOT EXISTS public.novedades_vistas (
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  clave       text NOT NULL CHECK (length(clave) BETWEEN 1 AND 120),
  visto_at    timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, clave)
);
CREATE INDEX IF NOT EXISTS novedades_vistas_clave_idx ON public.novedades_vistas(clave);

ALTER TABLE public.novedades_vistas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.novedades_vistas FROM anon;
GRANT SELECT, INSERT ON public.novedades_vistas TO authenticated;

-- Cada quien ve las suyas; quien edita Novedades ve las de todos.
DROP POLICY IF EXISTS novedades_vistas_select ON public.novedades_vistas;
CREATE POLICY novedades_vistas_select ON public.novedades_vistas
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
         OR (SELECT public.auth_can_edit_any(ARRAY['novedades'])));

-- Nadie marca vista una novedad a nombre de otro. Append-only: sin UPDATE ni DELETE.
DROP POLICY IF EXISTS novedades_vistas_insert ON public.novedades_vistas;
CREATE POLICY novedades_vistas_insert ON public.novedades_vistas
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT public.auth_employee_id()));

-- Marca varias de una vez (también sube lo que el navegador ya tenía visto).
-- INVOKER: la policy de INSERT decide. Devuelve cuántas eran nuevas.
CREATE OR REPLACE FUNCTION public.novedades_marcar_vistas(p_claves text[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions AS $$
DECLARE
  v_emp uuid := public.auth_employee_id();
  v_n   integer;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'SIN_EMPLEADO'; END IF;
  IF coalesce(array_length(p_claves, 1), 0) > 300 THEN RAISE EXCEPTION 'DEMASIADAS'; END IF;
  INSERT INTO public.novedades_vistas (employee_id, clave)
  SELECT DISTINCT v_emp, btrim(c)
    FROM unnest(coalesce(p_claves, '{}')) c
   WHERE length(btrim(c)) BETWEEN 1 AND 120
  ON CONFLICT (employee_id, clave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE EXECUTE ON FUNCTION public.novedades_marcar_vistas(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.novedades_marcar_vistas(text[]) TO authenticated, service_role;
