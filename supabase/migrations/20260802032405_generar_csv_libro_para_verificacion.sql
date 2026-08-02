SET lock_timeout = '5s';

-- Genera las líneas del CSV de cada libro, para PODER VERIFICARLAS contra el
-- archivo del ERP.
--
-- Es a propósito una SEGUNDA implementación, independiente de la del frontend:
-- si dos implementaciones escritas por separado producen el mismo archivo y ese
-- archivo coincide con el del origen, la prueba vale mucho más que reusar el
-- mismo código para verificarse a sí mismo.
--
-- No lleva el gate de permiso porque no la usa ninguna pantalla: sólo
-- service_role, desde `verificar-csv-libros`.
--
-- NOTA: el cuerpo definitivo de esta función quedó en la migración
-- 20260802033604 (extremos del día por id interno). Ésta es la primera versión,
-- que ordenaba por correlativo.
CREATE OR REPLACE FUNCTION public.generar_csv_libro(
    p_reporte text, p_desde date, p_hasta date, p_branch_id bigint)
RETURNS SETOF text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Reemplazada íntegramente por 20260802033604; se deja el esqueleto para
    -- que la historia sea aplicable en orden.
    RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generar_csv_libro(text, date, date, bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.generar_csv_libro(text, date, date, bigint) TO service_role;
