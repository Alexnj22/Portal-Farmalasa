SET lock_timeout = '5s';

-- ─── auth_is_su() ────────────────────────────────────────────────────────────
-- Espejo EXACTO del `isSU` que calcula AuthContext, que sale de `roles.is_su`
-- del rol PRIMARIO y de ninguna otra cosa (`fetchRoleMeta` consulta un solo
-- `role_id`). Incluir acá el rol secundario dejaría escribir a alguien que la
-- interfaz trata como no-SU: una habilitación invisible, que es justo el
-- desajuste contra el que advierte la nota de `moduleLock` en AuthContext.
--
-- La única asimetría deliberada es SUPERADMIN, que tiene `role_id` NULL y por
-- lo tanto ningún `is_su` que leer — es la misma válvula que ya abre
-- `auth_can_edit_any`. Va en el sentido inofensivo: puede escribir, pero la
-- interfaz no le ofrece el botón.
CREATE OR REPLACE FUNCTION public.auth_is_su()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT COALESCE((SELECT public.auth_employee_system_role()), '') = 'SUPERADMIN'
      OR EXISTS (
           SELECT 1 FROM public.roles r
           WHERE r.id = (SELECT public.auth_employee_role_id())
             AND r.is_su
         );
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_is_su() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auth_is_su() TO authenticated, service_role;

-- ─── dashboard_canon ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_canon (
  tab_id      text        PRIMARY KEY CHECK (tab_id IN ('comercial','rrhh','operacion')),
  orden       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  medidas     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES public.employees(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.dashboard_canon IS
  'Acomodo publicado de las pestanas tematicas del tablero. Guarda ORDEN + MEDIDAS, nunca col/row: la posicion se recalcula por cargo (autoPlaceOrder) sobre los widgets que ese cargo puede ver, asi al que le falta uno no le queda el hueco. General no vive aca: sigue siendo personal de cada usuario, y el CHECK deja esa decision escrita en el esquema.';
COMMENT ON COLUMN public.dashboard_canon.orden IS
  'Array de widget ids en orden de lectura. El orden es lo unico que sobrevive a la adaptacion: las coordenadas se calculan al pintar, y por eso sirven igual para 4 columnas que para 2.';
COMMENT ON COLUMN public.dashboard_canon.medidas IS
  '{ [widgetId]: { cols, rows } } de escritorio. En el telefono el ancho lo decide anchoEnTelefono sobre WIDGET_SIZES, asi que no hace falta un canon aparte por formato.';

ALTER TABLE public.dashboard_canon ENABLE ROW LEVEL SECURITY;

-- Lo lee todo el mundo: es el acomodo con el que se pinta el tablero.
CREATE POLICY dashboard_canon_select ON public.dashboard_canon
  FOR SELECT TO authenticated USING (true);

-- Escritura solo SU. `(SELECT ...)` obligatorio: sin el initplan, Postgres
-- evalua la funcion POR FILA (incidente 2026-07-08).
CREATE POLICY dashboard_canon_insert ON public.dashboard_canon
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_is_su()));

CREATE POLICY dashboard_canon_update ON public.dashboard_canon
  FOR UPDATE TO authenticated
  USING      ((SELECT public.auth_is_su()))
  WITH CHECK ((SELECT public.auth_is_su()));

CREATE POLICY dashboard_canon_delete ON public.dashboard_canon
  FOR DELETE TO authenticated USING ((SELECT public.auth_is_su()));

-- La autoria NO la manda el cliente: el trigger la pisa siempre, asi que un
-- payload que traiga `updated_by` de otro no puede mentir. Y `updated_at` sale
-- del reloj del servidor, no del navegador.
CREATE OR REPLACE FUNCTION public.dashboard_canon_sellar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := (SELECT public.auth_employee_id());
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.dashboard_canon_sellar() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_canon_sellar() TO authenticated, service_role;

DROP TRIGGER IF EXISTS dashboard_canon_sellar_trg ON public.dashboard_canon;
CREATE TRIGGER dashboard_canon_sellar_trg
  BEFORE INSERT OR UPDATE ON public.dashboard_canon
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_canon_sellar();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_canon TO authenticated;
REVOKE ALL ON public.dashboard_canon FROM anon;
