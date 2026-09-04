SET lock_timeout = '5s';

-- Por qué esta función y no un `.from('minmax_change_requests')` desde el
-- navegador: la policy `mmcr_select` deja ver una solicitud a quien la pidió, a
-- quien puede aprobarlas y a quien ve el módulo de solicitudes — y NINGUNA de
-- esas tres es «puede ver Min·Máx». Medido el 2026-09-04 sobre los 6 cargos con
-- `minmax.can_view`: **Gerente General no tiene ninguna de las tres**, así que
-- el motivo de la solicitud le volvería como cero filas, que en pantalla se lee
-- igual que «no hubo solicitud».
--
-- La guarda correcta es la del dato que se está mirando: si podés ver el MIN y
-- el MAX de este producto, podés ver POR QUÉ son ese número. No abre nada más
-- —filtra por un solo producto y una sola sala, que el llamador ya tiene en
-- pantalla— y no devuelve el `requested_by_id` (uuid de la cuenta), que no hace
-- falta para mostrar un nombre.
--
-- `plpgsql` y no `LANGUAGE sql`: la regla del CLAUDE.md sobre planes genéricos.
-- Acá el plan no depende de los argumentos (es una entrada por `mmcr_prod_idx`
-- con dos igualdades), así que no habría diferencia medible; se escribe en
-- plpgsql igual para no dejar el patrón malo copiable.
CREATE OR REPLACE FUNCTION public.get_minmax_solicitudes_de_producto(
  p_erp_product_id  integer,
  p_erp_sucursal_id integer
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_out json;
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('minmax', 'can_view')) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: se requiere permiso de lectura en Min/Max';
  END IF;

  SELECT coalesce(json_agg(to_json(t) ORDER BY t.requested_at DESC), '[]'::json)
    INTO v_out
  FROM (
    SELECT r.id,
           r.status,
           r.reason,
           r.requested_min,
           r.requested_max,
           r.requested_by_name,
           r.requested_at,
           r.decided_by,
           r.decided_at,
           r.decision_note
    FROM public.minmax_change_requests r
    WHERE r.erp_product_id  = p_erp_product_id
      AND r.erp_sucursal_id = p_erp_sucursal_id
  ) t;

  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_minmax_solicitudes_de_producto(integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_minmax_solicitudes_de_producto(integer, integer) TO authenticated, service_role;
