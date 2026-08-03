SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- C8 (H22) — si el proveedor tiene compras y el libro da su NIT, la ficha se
-- crea sola.
--
-- Al probar C1b con `BEGIN…ROLLBACK` salió que PEPSI no tiene el NIT vacío: no
-- tiene **ficha**. El barrido del maestro (E4) lo salteó a propósito —se importó
-- solo lo que traía NIT o NRC— y en el maestro PEPSI no trae ninguno de los dos.
-- Así que rellenar un vacío no alcanzaba: había que poder crear la fila.
--
-- Ahora la misma función hace las dos cosas, porque son el mismo hecho visto en
-- dos estados: «el libro dice el NIT de un proveedor al que le compramos». Los
-- candados no cambian —NIT válido, no pisar, no fusionar—, y se agrega el que
-- corresponde a crear: la ficha nace con `source='erp'` y el nombre que informa
-- la compra, para que se distinga de una cargada a mano.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.completar_nit_proveedores(
  p_pares jsonb   -- [{"supplier_id": 123, "nit": "06140101901012", "nombre": "PEPSI"}, …]
)
 RETURNS TABLE(supplier_id bigint, nit text, resultado text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT (e->>'supplier_id')::bigint AS sid,
           regexp_replace(coalesce(e->>'nit',''), '[^0-9]', '', 'g') AS nit,
           nullif(btrim(coalesce(e->>'nombre','')), '') AS nombre
    FROM jsonb_array_elements(coalesce(p_pares, '[]'::jsonb)) e
  LOOP
    CONTINUE WHEN r.sid IS NULL OR r.nit = '';

    IF NOT public.nit_sv_valido(r.nit) THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'nit_invalido';
      RETURN NEXT; CONTINUE;
    END IF;

    -- ¿la ficha ya tiene NIT? entonces no se toca, ni para "corregirlo".
    IF EXISTS (SELECT 1 FROM public.proveedores_maestro pm
                WHERE pm.supplier_id = r.sid
                  AND nullif(btrim(coalesce(pm.nit, '')), '') IS NOT NULL) THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'ya_tenia';
      RETURN NEXT; CONTINUE;
    END IF;

    -- ¿ese NIT ya es de otra ficha? es una fusión, no un dato faltante.
    IF EXISTS (SELECT 1 FROM public.proveedores_maestro pm
                WHERE regexp_replace(coalesce(pm.nit,''), '[^0-9]', '', 'g') = r.nit
                  AND coalesce(pm.supplier_id, -1) <> r.sid) THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'nit_de_otra_ficha';
      RETURN NEXT; CONTINUE;
    END IF;

    UPDATE public.proveedores_maestro pm
       SET nit = r.nit, updated_at = now()
     WHERE pm.supplier_id = r.sid
       AND nullif(btrim(coalesce(pm.nit, '')), '') IS NULL;

    IF FOUND THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'completado';
      RETURN NEXT; CONTINUE;
    END IF;

    -- C8: no había ficha. Se crea, pero solo si sabemos cómo llamarla — una
    -- ficha sin nombre es una fila que después nadie puede identificar, y el
    -- `nombre` es NOT NULL justamente por eso.
    IF r.nombre IS NULL THEN
      supplier_id := r.sid; nit := r.nit; resultado := 'sin_ficha_ni_nombre';
      RETURN NEXT; CONTINUE;
    END IF;

    INSERT INTO public.proveedores_maestro (nit, nombre, supplier_id, source, activo)
    VALUES (r.nit, r.nombre, r.sid, 'erp', true);

    supplier_id := r.sid; nit := r.nit; resultado := 'ficha_creada';
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.completar_nit_proveedores(jsonb) IS
  'C1b+C8/H22: desde la columna 4 del libro de compras que el sync ya descarga, rellena proveedores_maestro.nit cuando esta vacio y CREA la ficha cuando no existe (source=erp). Solo NITs validos, nunca pisa uno existente, y nunca toma un NIT que ya es de otra ficha: eso es una fusion de proveedores y la decide una persona. Devuelve el resultado por par para que el sync lo registre.';

REVOKE EXECUTE ON FUNCTION public.completar_nit_proveedores(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.completar_nit_proveedores(jsonb) TO authenticated, service_role;
