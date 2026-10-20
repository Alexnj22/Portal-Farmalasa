SET lock_timeout = '5s';

-- `promocional_ajustar` recibe una sucursal y se declara en
-- `scripts/alcance-manifest.json` como «modulo-de-red» (puntos_tab_niveles):
-- el gate exige que el cuerpo NOMBRE ese módulo, y el ayudante
-- `promocionales_puede_administrar()` lo escondía. Misma regla, escrita aquí.
CREATE OR REPLACE FUNCTION public.promocional_ajustar(p_id bigint, p_branch integer, p_delta integer, p_nota text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT coalesce((SELECT public.auth_has_module_permission('puntos_tab_niveles', 'can_edit')), false) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_delta, 0) = 0 THEN RAISE EXCEPTION 'La cantidad no puede ser cero.'; END IF;
  IF p_delta < 0 AND coalesce(length(btrim(p_nota)), 0) < 3 THEN
    RAISE EXCEPTION 'Para restar hay que decir por qué.';
  END IF;
  RETURN public.promocional_mover(p_id, p_branch, p_delta, CASE WHEN p_delta > 0 THEN 'ENTRADA' ELSE 'AJUSTE' END,
                                  p_nota, NULL, NULL);
END $function$;
