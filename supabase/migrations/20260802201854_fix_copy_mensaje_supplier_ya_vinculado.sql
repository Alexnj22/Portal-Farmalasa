SET lock_timeout = '5s';

-- El mensaje de A2, probado bajo ROLLBACK, salia asi:
--
--   "...ya esta vinculado a SKY SOLUTIONS, S.A. DE C.V.. Quita el vinculo..."
--                                                     ^^ punto doble
--
-- Casi toda razon social salvadorena termina en punto ("S.A. DE C.V."), asi que
-- no es un caso raro: es el caso normal. Se cambia el punto por una raya, que
-- ademas separa mejor la causa de la instruccion.
CREATE OR REPLACE FUNCTION public.set_proveedor_supplier(p_id bigint, p_supplier_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_otro text;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  BEGIN
    UPDATE public.proveedores_maestro
      SET supplier_id = p_supplier_id, updated_at = now()
      WHERE id = p_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT nombre INTO v_otro
      FROM public.proveedores_maestro
     WHERE supplier_id = p_supplier_id AND id <> p_id
     ORDER BY id LIMIT 1;
    RAISE EXCEPTION 'SUPPLIER_YA_VINCULADO: Ese proveedor del ERP ya esta vinculado a % — quita el vinculo alli antes de asignarlo aqui.',
      coalesce(nullif(btrim(v_otro), ''), 'otra ficha');
  END;
END;
$function$;
