SET lock_timeout = '5s';

-- La guarda de sala explícita (gate:alcance): la de cada renglón ya la hace
-- encargo_en_sucursal_crear, pero se mira antes de empezar y en esta función.
CREATE OR REPLACE FUNCTION public.encargos_en_sucursal_crear(p_branch_id bigint, p_customer_id bigint, p_lineas jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE l jsonb; v_out jsonb := '[]'::jsonb; v json;
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR public.auth_can_edit_any(ARRAY['ofertas_clientes'])) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lineas) < 1 THEN RAISE EXCEPTION 'Elige el producto.'; END IF;
  IF jsonb_array_length(p_lineas) > 10 THEN RAISE EXCEPTION 'Un encargo lleva hasta 10 productos.'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v := public.encargo_en_sucursal_crear(p_branch_id, p_customer_id, (l->>'producto_id')::bigint, l->>'producto_nombre',
           (l->>'factor')::integer, (l->>'cantidad')::integer, p_nota);
    v_out := v_out || jsonb_build_array(v::jsonb || jsonb_build_object('producto_nombre', l->>'producto_nombre', 'cantidad', (l->>'cantidad')::integer));
  END LOOP;
  RETURN v_out::json;
END $function$;
