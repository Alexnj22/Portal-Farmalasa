-- «¿Olvidaste tu contraseña?» en la app del personal (2026-11-17).
--
-- Una fila por pedido. Con correo válido en la ficha, el código de 6 dígitos
-- va al correo (gratis, por Resend) y se guarda SÓLO su hash; sin correo, la
-- fila anota que se avisó a Talento Humano, Administrador y Supervisor/a de
-- Ventas, que restablecen la contraseña desde la ficha como siempre.
--
-- La escribe y la lee SÓLO la edge function `recuperar-contrasena` (service
-- role). La policy de lectura es para quien administra Personal. Sin policies
-- de escritura: nadie la toca desde el navegador.
--
-- Retención: la propia función borra lo de más de 30 días en cada pedido.
SET lock_timeout = '5s';

CREATE TABLE public.recuperaciones_de_clave (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  canal        text NOT NULL CHECK (canal IN ('correo', 'aviso')),
  codigo_hash  text,
  vence_at     timestamptz,
  intentos     smallint NOT NULL DEFAULT 0,
  usada_at     timestamptz,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (canal = 'aviso' OR (codigo_hash IS NOT NULL AND vence_at IS NOT NULL))
);

CREATE INDEX recuperaciones_de_clave_employee_idx
  ON public.recuperaciones_de_clave (employee_id, created_at DESC);
CREATE INDEX recuperaciones_de_clave_created_idx
  ON public.recuperaciones_de_clave (created_at);

ALTER TABLE public.recuperaciones_de_clave ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.recuperaciones_de_clave FROM anon;

CREATE POLICY recuperaciones_de_clave_select ON public.recuperaciones_de_clave
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_can_edit_any(ARRAY['staff_list'])));
