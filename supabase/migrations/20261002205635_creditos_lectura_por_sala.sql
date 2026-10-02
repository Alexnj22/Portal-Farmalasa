SET lock_timeout = '5s';

-- La pantalla de Cuentas por cobrar relee la caja de su sucursal al abrirse y
-- cada minuto mientras está a la vista. Esta tabla es el TOPE compartido: una
-- lectura por sala por ventana, sin importar cuántas pantallas estén abiertas.
-- El servidor decide —no el navegador—, así diez personas mirando cuestan lo
-- mismo que una.
CREATE TABLE IF NOT EXISTS public.creditos_lectura_sala (
  branch_id  bigint PRIMARY KEY REFERENCES public.branches(id),
  leido_el   timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creditos_lectura_sala ENABLE ROW LEVEL SECURITY;

CREATE POLICY creditos_lectura_sala_select ON public.creditos_lectura_sala
  FOR SELECT TO authenticated
  USING ((SELECT auth_has_module_permission('cuentas_por_cobrar', 'can_view')));

-- Reclama la lectura de una sala de forma ATÓMICA: devuelve true sólo a quien
-- le toca ir a la caja. Dos pantallas que llegan en el mismo instante no leen
-- las dos — el ON CONFLICT ... WHERE lo resuelve en una sola sentencia.
CREATE OR REPLACE FUNCTION public.creditos_tomar_lectura(p_branch_id bigint, p_segundos integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_tomada boolean;
BEGIN
  INSERT INTO public.creditos_lectura_sala (branch_id, leido_el)
  VALUES (p_branch_id, now())
  ON CONFLICT (branch_id) DO UPDATE SET leido_el = EXCLUDED.leido_el
    WHERE public.creditos_lectura_sala.leido_el < now() - make_interval(secs => p_segundos)
  RETURNING true INTO v_tomada;
  RETURN coalesce(v_tomada, false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.creditos_tomar_lectura(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creditos_tomar_lectura(bigint, integer) TO service_role;
