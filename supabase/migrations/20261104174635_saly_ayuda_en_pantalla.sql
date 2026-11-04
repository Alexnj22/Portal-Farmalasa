SET lock_timeout = '5s';
-- Saly, ayuda en pantalla (docs/PLAN-SALY-AYUDA-EN-PANTALLA-2026-11-04.md).
--
-- Dos tablas, y ninguna se escribe desde el navegador: las llena la función
-- `saly-ayuda` con la llave del servidor después de validar la sesión.
--
-- · registro: cada pregunta escrita y su respuesta (decisión del usuario:
--   «sí, para mejorarla»). La persona ve las suyas; administración —quien
--   tiene `auditview`— todas. Retención 180 días: la purga la hace la misma
--   función al anotar (sin cron, que no hace falta para una tabla así).
-- · memoria: un resumen corto por persona («siempre, resumido»).
--
-- El tope diario (30) se cuenta sobre el registro, en la base: así el
-- navegador no lo puede saltar.

CREATE TABLE public.saly_ayuda_registro (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  modulo      text NOT NULL,
  pregunta    text NOT NULL,
  respuesta   jsonb,
  util        boolean,
  tokens      integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saly_ayuda_registro_employee_created_idx ON public.saly_ayuda_registro (employee_id, created_at DESC);
CREATE INDEX saly_ayuda_registro_created_idx ON public.saly_ayuda_registro (created_at);
ALTER TABLE public.saly_ayuda_registro ENABLE ROW LEVEL SECURITY;
CREATE POLICY saly_ayuda_registro_select ON public.saly_ayuda_registro
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id())
         OR (SELECT public.auth_has_module_permission('auditview', 'can_view')));

CREATE TABLE public.saly_ayuda_memoria (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  resumen     text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saly_ayuda_memoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY saly_ayuda_memoria_select ON public.saly_ayuda_memoria
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT public.auth_employee_id()));

-- 👍/👎 de la persona sobre SU respuesta, y sólo del último día.
CREATE FUNCTION public.saly_ayuda_calificar(p_id bigint, p_util boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = public, extensions AS $$
  WITH u AS (
    UPDATE public.saly_ayuda_registro SET util = p_util
     WHERE id = p_id AND employee_id = public.auth_employee_id()
       AND created_at > now() - interval '1 day'
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM u);
$$;
REVOKE EXECUTE ON FUNCTION public.saly_ayuda_calificar(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.saly_ayuda_calificar(bigint, boolean) TO authenticated, service_role;
