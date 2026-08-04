SET lock_timeout = '5s';

-- Confirmar varias metas de una vez (2026-08-04, pedido del usuario: no querer
-- ir de a una).
--
-- Reusa `confirmar_meta_supervisor` en un bucle en vez de reescribir sus
-- validaciones: así el permiso, el estado válido, el monto y el aviso al gerente
-- siguen viviendo en UN solo lugar. Y al correr todo en una transacción, si una
-- falla no quedan tres confirmadas y tres no — o entran todas o no entra ninguna.
CREATE OR REPLACE FUNCTION public.confirmar_metas_lote(p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  it jsonb;
  n integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'ITEMS_INVALIDOS: se espera un arreglo';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;
  -- Tope de cordura: un mes tiene 6 salas. Un lote de cientos es un error de
  -- quien llama, no un caso de uso.
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'LOTE_DEMASIADO_GRANDE: %', jsonb_array_length(p_items);
  END IF;

  FOR it IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    PERFORM public.confirmar_meta_supervisor(
      (it->>'id')::bigint,
      NULLIF(it->>'monto', '')::numeric,
      NULL);
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_metas_lote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_metas_lote(jsonb) TO authenticated, service_role;
