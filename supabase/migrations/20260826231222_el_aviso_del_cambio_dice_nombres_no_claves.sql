-- El aviso dice nombres, no claves.
--
-- La primera versión salió con «se cambió a «credito»» —el valor tal como se
-- guarda, sin tilde— y con el CÓDIGO del vendedor. Quien lo lee no busca un
-- código: busca a una persona y una forma de pago escrita como en la pantalla.
-- Es la misma regla de siempre: lo que ve el usuario habla su idioma.
SET lock_timeout = '5s';

-- Cómo se dice cada cosa en pantalla.
--
-- El vendedor se resuelve por su código contra la ficha; si no hay ficha con
-- ese código se muestra «el vendedor 313», que es peor que un nombre y mucho
-- mejor que nada. La forma de pago se escribe como en la pantalla, con su
-- tilde: lo que se guarda es una clave, no un rótulo.
CREATE OR REPLACE FUNCTION public.nombre_de_vendedor(p_codigo text)
RETURNS text LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce(
    (SELECT e.name FROM public.employees e
      WHERE btrim(e.code) = btrim(coalesce(p_codigo, '')) AND btrim(coalesce(p_codigo,'')) <> ''
      ORDER BY CASE WHEN e.status = 'ACTIVO' THEN 0 ELSE 1 END
      LIMIT 1),
    CASE WHEN btrim(coalesce(p_codigo, '')) = '' THEN 'nadie'
         ELSE 'el vendedor ' || btrim(p_codigo) END);
$$;

CREATE OR REPLACE FUNCTION public.nombre_de_pago(p_valor text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = public, extensions AS $$
  SELECT CASE lower(btrim(coalesce(p_valor, '')))
           WHEN 'efectivo'      THEN 'Efectivo'
           WHEN 'credito'       THEN 'Crédito'
           WHEN 'tarjeta'       THEN 'Tarjeta'
           WHEN 'cheque'        THEN 'Cheque'
           WHEN 'bitcoin'       THEN 'Bitcoin'
           WHEN 'transferencia' THEN 'Transferencia'
           WHEN ''              THEN 'nada'
           ELSE btrim(p_valor)
         END;
$$;

REVOKE EXECUTE ON FUNCTION public.nombre_de_vendedor(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.nombre_de_pago(text)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.nombre_de_vendedor(text) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.nombre_de_pago(text)     TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.avisar_cambios_que_no_se_quedaron(p_horas integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    r          record;
    v_dest     uuid[];
    v_titulo   text;
    v_cuerpo   text;
    v_link     text;
    v_esperado text;
    v_actual   text;
    v_que      text;
    v_n        integer := 0;
BEGIN
    FOR r IN
        SELECT ar.id, ar.type, ar.employee_id, ar.approver_id,
               ar.metadata->'erp_aplicado'->>'campo' AS campo,
               ar.metadata->'erp_aplicado'->>'a'     AS aplicado,
               si.correlativo, si.cod_vendedor, si.tipo_pago, si.fecha,
               b.name AS sala
          FROM public.approval_requests ar
          JOIN public.sales_invoices si
            ON si.id = (ar.metadata->>'invoice_id')::bigint
          LEFT JOIN public.branches b ON b.id = si.branch_id
         WHERE ar.status = 'APPROVED'
           AND ar.metadata ? 'erp_aplicado'
           AND ar.metadata->'erp_aplicado'->>'campo' IN ('cod_vendedor', 'tipo_pago')
           AND coalesce((ar.metadata->>'avisado_no_se_quedo')::boolean, false) = false
           AND (ar.metadata->'erp_aplicado'->>'at')::timestamptz
                 < now() - make_interval(hours => greatest(1, p_horas))
           AND upper(coalesce(si.estado, '')) NOT IN ('NULA', 'DTE INVALIDADO EN MH')
           AND si.fecha >= date_trunc('month',
                             (now() AT TIME ZONE 'America/El_Salvador'))::date
    LOOP
        IF r.campo = 'cod_vendedor' THEN
            CONTINUE WHEN btrim(coalesce(r.aplicado, '')) = '';
            CONTINUE WHEN btrim(coalesce(r.cod_vendedor, '')) = btrim(r.aplicado);
            v_esperado := public.nombre_de_vendedor(r.aplicado);
            v_actual   := public.nombre_de_vendedor(r.cod_vendedor);
            v_que      := 'el vendedor';
        ELSE
            CONTINUE WHEN btrim(coalesce(r.aplicado, '')) = '';
            CONTINUE WHEN lower(btrim(coalesce(r.tipo_pago, ''))) = lower(btrim(r.aplicado));
            v_esperado := public.nombre_de_pago(r.aplicado);
            v_actual   := public.nombre_de_pago(r.tipo_pago);
            v_que      := 'la forma de pago';
        END IF;

        v_dest := (SELECT array_agg(DISTINCT x) FROM unnest(
                     ARRAY[r.approver_id, r.employee_id]) x WHERE x IS NOT NULL);
        v_dest := coalesce(v_dest, ARRAY[]::uuid[]);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un cambio de venta no se quedó';
        v_cuerpo := 'La venta ' || coalesce(r.correlativo, 'sin número')
                 || ' de ' || coalesce(r.sala, 'una sala')
                 || ' se cambió a ' || v_esperado || ', pero hoy vuelve a decir '
                 || v_actual || '. El cambio de ' || v_que
                 || ' no se quedó: hay que revisarla.';
        v_link := CASE WHEN public.es_solicitud_operativa(r.type)
                       THEN '/requests' ELSE '/requests-personales' END
               || '?solicitud=' || r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, created_by)
        SELECT d, 'REQUEST_DECIDED', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.id, 'request_type', r.type,
                                  'campo', r.campo,
                                  'esperado', r.aplicado,
                                  'en_el_portal', CASE WHEN r.campo = 'cod_vendedor'
                                                       THEN r.cod_vendedor ELSE r.tipo_pago END),
               r.employee_id
          FROM unnest(v_dest) d;

        UPDATE public.approval_requests
           SET metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('avisado_no_se_quedo', true)
         WHERE id = r.id;

        PERFORM net.http_post(
            url     := public.push_function_url(),
            headers := public.push_function_headers(),
            body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo,
                                          'url', v_link, 'target_type', 'EMPLOYEE',
                                          'target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;
