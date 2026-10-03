SET lock_timeout = '5s';

-- Reemplaza a `comprobante_de_caja_visible` (misma fecha): evaluada por fila,
-- recorrer el bucket con 8 personas agotó el tiempo, o sea que como policy
-- habría vuelto lento listar una carpeta. La regla es la misma, partida en dos
-- respuestas que NO dependen del archivo — así la policy las envuelve en
-- `(SELECT …)` y se calculan una sola vez por consulta (regla 3 de CLAUDE.md).
DROP FUNCTION IF EXISTS public.comprobante_de_caja_visible(text, uuid);

-- ¿Ve los comprobantes de caja de TODAS las salas? Alcance de red en alguno de
-- los módulos de caja.
CREATE OR REPLACE FUNCTION public.comprobantes_de_caja_red()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM unnest(ARRAY['bolsas', 'caja_vales', 'cortes_caja', 'cuentas_por_cobrar',
                        'requests_caja', 'requests_cuentas_por_cobrar']) AS m(modulo)
     WHERE public.auth_has_module_permission(m.modulo, 'can_view')
       AND public.auth_module_scope(m.modulo) = 'ALL');
$$;

-- La sala cuyos comprobantes de caja ve, si tiene alguno de esos módulos; NULL
-- si no tiene ninguno.
CREATE OR REPLACE FUNCTION public.comprobantes_de_caja_sala()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM unnest(ARRAY['bolsas', 'caja_vales', 'cortes_caja', 'cuentas_por_cobrar',
                        'requests_caja', 'requests_cuentas_por_cobrar']) AS m(modulo)
     WHERE public.auth_has_module_permission(m.modulo, 'can_view'))
  THEN public.auth_employee_branch_id()::text END;
$$;

REVOKE EXECUTE ON FUNCTION public.comprobantes_de_caja_red() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.comprobantes_de_caja_sala() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comprobantes_de_caja_red() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.comprobantes_de_caja_sala() TO authenticated, service_role;
