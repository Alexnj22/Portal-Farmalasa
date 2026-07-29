-- F1.3 — Las solicitudes de cambio, alineadas con el invariante real.
--
-- 1) mmcr_max_gt_min_chk exigia solo `requested_max > requested_min`, que deja
--    pasar pares que product_stock_params rechaza (chk_min_lt_max):
--    (0, 5) pasa la constraint de la solicitud y explota al aprobarla.
--    Se reemplaza por el MISMO predicado. Verificado antes: las 2 filas
--    historicas (id=4 (1,2), id=5 (30,60), ambas rejected) lo cumplen.
--
-- 2) approve_minmax_requests_bulk metia TODA excepcion desconocida en
--    `skipped_not_found`, que la UI traduce como "ya decidida por otra
--    persona". Una violacion de CHECK — o sea, una solicitud que no se puede
--    aplicar NUNCA — se reportaba como una carrera entre dos aprobadores.
--    Ahora tiene su propio bucket con el SQLERRM real.

SET lock_timeout = '5s';

ALTER TABLE public.minmax_change_requests DROP CONSTRAINT IF EXISTS mmcr_max_gt_min_chk;

ALTER TABLE public.minmax_change_requests
  ADD CONSTRAINT mmcr_pair_valid CHECK (
    requested_min IS NULL
    OR requested_max IS NULL
    OR (requested_min = 0  AND requested_max <= 1)
    OR (requested_min >= 1 AND requested_max > requested_min)
  ) NOT VALID;

ALTER TABLE public.minmax_change_requests VALIDATE CONSTRAINT mmcr_pair_valid;


CREATE OR REPLACE FUNCTION public.approve_minmax_requests_bulk(p_request_ids bigint[], p_decided_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id bigint;
  v_result jsonb;
  v_approved jsonb := '[]'::jsonb;
  v_skipped_bodega jsonb := '[]'::jsonb;
  v_skipped_hidden jsonb := '[]'::jsonb;
  v_skipped_invalid jsonb := '[]'::jsonb;
  v_skipped_not_found jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_id IN ARRAY p_request_ids LOOP
    BEGIN
      v_result := approve_minmax_request(v_id, p_decided_by, 'Aprobación masiva') || jsonb_build_object('id', v_id);
      v_approved := v_approved || jsonb_build_array(v_result);
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM LIKE 'BODEGA_NOT_APPROVABLE_HERE%' THEN
          v_skipped_bodega := v_skipped_bodega || jsonb_build_array(jsonb_build_object('id', v_id));
        ELSIF SQLERRM LIKE 'PRODUCT_HIDDEN%' THEN
          v_skipped_hidden := v_skipped_hidden || jsonb_build_array(jsonb_build_object('id', v_id));
        ELSIF SQLSTATE LIKE '23%' THEN
          -- Violacion de integridad (CHECK, unique, FK). NO es una carrera con
          -- otro aprobador: es una solicitud que no se puede aplicar nunca.
          -- Se devuelve el error real para que la UI lo pueda decir.
          v_skipped_invalid := v_skipped_invalid || jsonb_build_array(
            jsonb_build_object('id', v_id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
        ELSE
          v_skipped_not_found := v_skipped_not_found || jsonb_build_array(v_id);
        END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'approved', v_approved,
    'skipped_bodega', v_skipped_bodega,
    'skipped_hidden', v_skipped_hidden,
    'skipped_invalid', v_skipped_invalid,
    'skipped_not_found', v_skipped_not_found
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_minmax_requests_bulk(bigint[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_minmax_requests_bulk(bigint[], text) TO authenticated, service_role;
