SET lock_timeout = '5s';

-- C1b (H22) — el NIT del proveedor sale de la columna 4 del mismo archivo que
-- el sync ya baja para el sello y la percepción. Rellena fichas SIN NIT; nunca
-- pisa una que ya lo tiene, nunca toma un NIT válido que ya pertenece a otra
-- ficha (eso es una fusión de proveedores y la decide una persona).
--
-- NOTA: esta versión NO crea la ficha cuando no existe. Eso llega en la
-- migración siguiente (C8, 20260803014456), que reemplaza esta función — al
-- probar ésta con BEGIN…ROLLBACK salió que PEPSI no tiene el NIT vacío: no
-- tiene ficha. Se deja el archivo porque es la historia real de prod.
CREATE OR REPLACE FUNCTION public.completar_nit_proveedores(p_pares jsonb)
 RETURNS TABLE(supplier_id bigint, nit text, resultado text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT (e->>'supplier_id')::bigint AS sid,
           regexp_replace(coalesce(e->>'nit',''), '[^0-9]', '', 'g') AS nit
    FROM jsonb_array_elements(coalesce(p_pares, '[]'::jsonb)) e
  LOOP
    CONTINUE WHEN r.sid IS NULL OR r.nit = '';
    IF NOT public.nit_sv_valido(r.nit) THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'nit_invalido'; RETURN NEXT; CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.proveedores_maestro pm
                WHERE pm.supplier_id = r.sid
                  AND nullif(btrim(coalesce(pm.nit, '')), '') IS NOT NULL) THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'ya_tenia'; RETURN NEXT; CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.proveedores_maestro pm
                WHERE regexp_replace(coalesce(pm.nit,''), '[^0-9]', '', 'g') = r.nit
                  AND coalesce(pm.supplier_id, -1) <> r.sid) THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'nit_de_otra_ficha'; RETURN NEXT; CONTINUE;
    END IF;
    UPDATE public.proveedores_maestro pm SET nit = r.nit, updated_at = now()
     WHERE pm.supplier_id = r.sid AND nullif(btrim(coalesce(pm.nit, '')), '') IS NULL;
    supplier_id := r.sid; nit := r.nit;
    resultado   := CASE WHEN FOUND THEN 'completado' ELSE 'sin_ficha' END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.completar_nit_proveedores(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.completar_nit_proveedores(jsonb) TO authenticated, service_role;
