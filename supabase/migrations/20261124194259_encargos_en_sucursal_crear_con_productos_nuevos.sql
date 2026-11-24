SET lock_timeout = '5s';

-- Un encargo de varios productos puede llevar también productos que NO están
-- en el catálogo (2026-11-24, pedido del usuario: «no es práctico» mandarlos
-- uno por uno). Cada renglón `nuevo: true` va por `encargo_nuevo_en_sucursal_crear`
-- —sus mismas validaciones: nombre, 1 a 20, SRS, foto de esta sucursal— y el
-- resto por `encargo_en_sucursal_crear`, como antes. Todo en la misma
-- transacción: si uno falla, no queda ninguno a medias.
CREATE OR REPLACE FUNCTION public.encargos_en_sucursal_crear(p_branch_id bigint, p_customer_id bigint, p_lineas jsonb, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE l jsonb; v_out jsonb := '[]'::jsonb; v json; v_nuevo boolean; v_nombre text;
BEGIN
  IF NOT (p_branch_id = (SELECT public.auth_employee_branch_id()) OR (SELECT public.auth_can_edit_any(ARRAY['ofertas_clientes']))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lineas) < 1 THEN RAISE EXCEPTION 'Elige el producto.'; END IF;
  IF jsonb_array_length(p_lineas) > 10 THEN RAISE EXCEPTION 'Un encargo lleva hasta 10 productos.'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_nuevo := coalesce((l->>'nuevo')::boolean, false);
    IF v_nuevo THEN
      v_nombre := l->>'nombre';
      v := public.encargo_nuevo_en_sucursal_crear(p_branch_id, p_customer_id, v_nombre, (l->>'cantidad')::integer,
             coalesce(nullif(btrim(l->>'nota'), ''), p_nota),
             CASE WHEN jsonb_typeof(l->'srs') = 'object' THEN l->'srs' END,
             nullif(btrim(l->>'foto_url'), ''));
    ELSE
      v_nombre := l->>'producto_nombre';
      v := public.encargo_en_sucursal_crear(p_branch_id, p_customer_id, (l->>'producto_id')::bigint, v_nombre,
             (l->>'factor')::integer, (l->>'cantidad')::integer, p_nota);
    END IF;
    v_out := v_out || jsonb_build_array(v::jsonb || jsonb_build_object('producto_nombre', btrim(v_nombre),
             'cantidad', (l->>'cantidad')::integer, 'nuevo', v_nuevo));
  END LOOP;
  RETURN v_out::json;
END $function$;
