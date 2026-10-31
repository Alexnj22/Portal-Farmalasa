SET lock_timeout = '5s';

-- ── Pausar las escrituras de Cargar compra al sistema (2026-10-31) ─────────
-- Append-only: cada fila es un cambio de estado; el vigente es el último.
-- Así el historial de quién pausó, cuándo y por qué es la tabla misma.
CREATE TABLE public.compra_pausa (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  pausada     boolean NOT NULL,
  motivo      text,
  por         uuid REFERENCES public.employees(id)
);
CREATE INDEX compra_pausa_por ON public.compra_pausa (por);
ALTER TABLE public.compra_pausa ENABLE ROW LEVEL SECURITY;
CREATE POLICY compra_pausa_select ON public.compra_pausa FOR SELECT TO authenticated USING (true);
-- Sin policies de escritura: sólo `compra_pausar`.

-- El estado vigente. Sin filas = no pausada (la falla segura de un interruptor
-- recién instalado es dejar todo como estaba).
CREATE OR REPLACE FUNCTION public.compra_pausa_estado()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT json_build_object(
    'pausada', coalesce(u.pausada, false),
    'motivo', u.motivo, 'desde', u.created_at, 'por', u.por, 'por_nombre', e.name,
    'puede_cambiar', EXISTS (SELECT 1 FROM public.employees x
                              WHERE x.id = (SELECT public.auth_employee_id()) AND x.role_id IN (2, 3)))
  FROM (SELECT 1) uno
  LEFT JOIN LATERAL (SELECT * FROM public.compra_pausa ORDER BY id DESC LIMIT 1) u ON true
  LEFT JOIN public.employees e ON e.id = u.por;
$$;
REVOKE EXECUTE ON FUNCTION public.compra_pausa_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_pausa_estado() TO authenticated, service_role;

-- Sólo Gerente General (2) y Administrador (3). Pausar exige motivo.
CREATE OR REPLACE FUNCTION public.compra_pausar(p_pausar boolean, p_motivo text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_emp uuid := public.auth_employee_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_emp AND role_id IN (2, 3)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_pausar AND coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Escribe por qué se pausa.';
  END IF;
  INSERT INTO public.compra_pausa (pausada, motivo, por) VALUES (p_pausar, nullif(btrim(p_motivo), ''), v_emp);
  RETURN public.compra_pausa_estado();
END $$;
REVOKE EXECUTE ON FUNCTION public.compra_pausar(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compra_pausar(boolean, text) TO authenticated, service_role;
