-- Fase 1 de docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md — VER antes de cerrar.
--
-- Nada de esto bloquea a nadie hoy. Instala las dos piezas que permiten decidir
-- con datos en vez de con intuición:
--   1. el interruptor, para que la marcha atrás de un control NUNCA sea una
--      migración sobre una tabla caliente (que es el outage del 2026-07-08);
--   2. el registro de egreso, que es la única forma de saber cómo se ve un mes
--      normal ANTES de ponerle un techo. Sin línea base, cualquier umbral es
--      inventado.
SET lock_timeout = '5s';

-- ── 1.1 · El interruptor ─────────────────────────────────────────────────────
-- Tres estados y no un booleano, a propósito: `avisar` es el que hace que esto
-- sirva — deja pasar y anota, así se descubre a quién se habría bloqueado antes
-- de bloquearlo.
CREATE TABLE IF NOT EXISTS public.security_config (
  key         text PRIMARY KEY,
  estado      text NOT NULL DEFAULT 'observar'
              CHECK (estado IN ('observar','avisar','exigir')),
  nota        text,
  updated_by  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.security_config IS
  'Interruptor de cada control de seguridad: observar (deja pasar) → avisar (deja pasar y anota) → exigir (bloquea). Encender o apagar es un UPDATE de una fila, nunca una migración: ver docs/PLAN-BLINDAJE-ANTE-TERCEROS-2026-08-13.md §0.';

ALTER TABLE public.security_config ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier autenticado: las policies de otras tablas van a
-- consultar esta, y una policy no puede leer lo que el rol no ve.
CREATE POLICY security_config_select ON public.security_config
  FOR SELECT TO authenticated USING (true);

-- Escritura sólo del superusuario. Es el panel de control de los frenos: quien
-- pueda apagarlos puede apagar todo lo que venga después.
CREATE POLICY security_config_insert ON public.security_config
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.auth_is_su()));
CREATE POLICY security_config_update ON public.security_config
  FOR UPDATE TO authenticated USING ((SELECT public.auth_is_su()))
                              WITH CHECK ((SELECT public.auth_is_su()));
CREATE POLICY security_config_delete ON public.security_config
  FOR DELETE TO authenticated USING ((SELECT public.auth_is_su()));

CREATE POLICY bloqueo_global ON public.security_config
  AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));

CREATE INDEX IF NOT EXISTS idx_security_config_updated_by ON public.security_config(updated_by);

-- El helper. STABLE para que envuelto en `(SELECT …)` se evalúe UNA vez por
-- consulta y no por fila — la diferencia medida entre 19 ms y 25,000 ms.
CREATE OR REPLACE FUNCTION public.sec_exige(p_key text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce((SELECT estado = 'exigir' FROM public.security_config WHERE key = p_key), false);
$$;
COMMENT ON FUNCTION public.sec_exige(text) IS
  'true sólo si ese control está en exigir. El default false es deliberado: si la fila no existe, NO exige — un control mal escrito nunca deja a nadie afuera por accidente.';

CREATE OR REPLACE FUNCTION public.sec_avisa(p_key text)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce((SELECT estado IN ('avisar','exigir') FROM public.security_config WHERE key = p_key), false);
$$;
COMMENT ON FUNCTION public.sec_avisa(text) IS
  'true si el control anota lo que pasa (avisar o exigir). Existe aparte de sec_exige porque el estado avisar tiene que ANOTAR sin bloquear, y con una sola función no se pueden distinguir los dos comportamientos.';

REVOKE EXECUTE ON FUNCTION public.sec_exige(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sec_avisa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sec_exige(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sec_avisa(text) TO authenticated, service_role;

-- ── 1.2 · El registro de egreso ──────────────────────────────────────────────
-- Puramente aditivo. Append-only: sin policy de UPDATE ni de DELETE, igual que
-- audit_logs — un registro que se puede editar no es un registro.
CREATE TABLE IF NOT EXISTS public.export_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  modulo       text NOT NULL,
  formato      text,
  filas        integer,
  detalle      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.export_log IS
  'Qué salió del portal: quién, de qué módulo, en qué formato y cuántas filas. Línea base de la Fase 3 — el techo de exportación se elige con estos datos, no con un número inventado.';

ALTER TABLE public.export_log ENABLE ROW LEVEL SECURITY;

-- Cada quien anota lo SUYO. `WITH CHECK (true)` acá dejaría fabricar una salida
-- a nombre de otro, que es justo lo que este registro existe para descartar.
CREATE POLICY export_log_insert ON public.export_log
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT public.auth_employee_id()));

-- Lo lee quien ya puede leer la bitácora.
CREATE POLICY export_log_select ON public.export_log
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('auditview','can_view')));

CREATE POLICY bloqueo_global ON public.export_log
  AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.auth_no_bloqueado()));

CREATE INDEX IF NOT EXISTS idx_export_log_employee ON public.export_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_export_log_created  ON public.export_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_log_modulo   ON public.export_log(modulo, created_at DESC);

-- ── Las filas de arranque, TODAS en observar ─────────────────────────────────
-- Se siembran ahora para que existan y se puedan mirar, no para que actúen.
INSERT INTO public.security_config (key, estado, nota) VALUES
  ('techo_exportacion',  'observar', 'Fase 3.3 — límite de filas por exportación. En observar hasta que export_log tenga un mes de línea base.'),
  ('dispositivo_conocido','observar', 'Fase 3.2 — avisar cuando alguien entra desde un equipo nunca visto. Empieza avisando, nunca bloqueando.'),
  ('segundo_humano',     'observar', 'Fase 3.1 — segundo par de ojos en lo irreversible (bajas, anulaciones, cambios de contraseña).'),
  ('lectura_masiva',     'observar', 'Fase 2 — cerrar la lectura de tablas completas a quien no las usa. OJO: el portal pagina de a 1000 filas por diseño (fetchAllRows), así que un umbral ingenuo de volumen lo apaga.')
ON CONFLICT (key) DO NOTHING;
