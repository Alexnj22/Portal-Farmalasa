SET lock_timeout = '5s';

-- El push de aperturas, traslados por respaldo y depósito al banco también
-- con su línea corta (usuario, 24-sep: «corrígelo»). Los tres salen por
-- `notify_employees`, así que basta con enseñárselos a `texto_de_push`.

CREATE OR REPLACE FUNCTION public.texto_de_push(p_type text, p_body text, p_meta jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
-- La línea que llega al TELÉFONO (usuario, 24-sep). El cuerpo largo de cada
-- aviso era para la campana cuando la campana era texto; hoy la campana dibuja
-- la tarjeta y el cuerpo sólo lo lee el push, que muestra dos renglones. Esta
-- función arma una línea corta con lo esencial desde el MISMO metadata que
-- dibuja la tarjeta: «AGUA CRISTAL ×24 y 2 más · Monica Estrada».
--
-- Los nombres van CORTOS (nombre y primer apellido), por el mismo canónico de
-- la base, y el documento como CCF/COF. Sin nombre no se llama al canónico:
-- con los tres argumentos vacíos devuelve «Personal», y una línea terminaba en
-- «· Personal» o «lo lleva Personal».
--
-- Si el aviso no trae los datos, o algo falla, devuelve el cuerpo de siempre:
-- un push nunca sale vacío por culpa de esta función.
DECLARE
    m   jsonb := coalesce(p_meta, '{}'::jsonb);
    s   jsonb;
    v   text;
    n   integer;
    mas integer;
    p0  jsonb;
    t   numeric;
BEGIN
    BEGIN
        IF jsonb_typeof(m->'solicitud') = 'object' THEN
            s   := m->'solicitud';
            n   := coalesce(jsonb_array_length(s->'productos'), 0);
            mas := greatest(n - 1, 0) + coalesce((s->>'mas')::integer, 0);
            p0  := s->'productos'->0;
            IF s->>'tipo' = 'INVENTORY_TRANSFER_PUSH' THEN
                v := (n + coalesce((s->>'mas')::integer, 0)) || CASE WHEN n + coalesce((s->>'mas')::integer, 0) = 1 THEN ' producto' ELSE ' productos' END
                  || coalesce(', ' || trim(to_char((s->>'unidades')::numeric, 'FM999,999,990.##')) || ' unidades', '')
                  || coalesce(' · ' || nullif(split_part(s->>'motivo', ':', 1), ''), '');
            ELSIF s ? 'doc' THEN
                v := concat_ws(' · ',
                        -- CCF/COF: los avisos anteriores al 24-sep traen el nombre largo.
                        nullif(concat_ws(' ', CASE WHEN s->>'doc' ILIKE 'cr%dito fiscal' THEN 'CCF'
                                                   WHEN s->>'doc' ILIKE 'consumidor final' OR s->>'doc' = 'Factura' THEN 'COF'
                                                   ELSE s->>'doc' END,
                               CASE WHEN s->>'monto' IS NOT NULL THEN '$' || to_char((s->>'monto')::numeric, 'FM999,999,990.00') END), ''),
                        CASE WHEN s ? 'antes' AND s ? 'despues' THEN (s->>'antes') || ' → ' || (s->>'despues') END,
                        s->>'cliente');
            ELSIF p0 IS NOT NULL THEN
                v := concat_ws(' · ',
                        (p0->>'nombre') || coalesce(' ×' || trim(to_char((p0->>'cantidad')::numeric, 'FM999,999,990.##')), '')
                          || CASE WHEN mas > 0 THEN ' y ' || mas || ' más' ELSE '' END,
                        CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END);
            ELSIF s ? 'antes' AND s ? 'despues' THEN
                v := concat_ws(' · ', (s->>'antes') || ' → ' || (s->>'despues'), CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END);
            ELSE
                v := concat_ws(' · ', CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END, left(s->>'motivo', 90));
            END IF;

        ELSIF jsonb_typeof(m->'respuesta') = 'object' THEN
            s := m->'respuesta';
            IF s->>'tipo' = 'envio' THEN
                v := 'Se quedó con ' || coalesce(s->>'aceptados', '0')
                  || CASE WHEN coalesce(jsonb_array_length(s->'devueltos'), 0) > 0
                          THEN ' y te devuelve ' || jsonb_array_length(s->'devueltos') ELSE '' END
                  || CASE WHEN (s->>'no_llegaron')::integer > 0
                          THEN ' · ' || (s->>'no_llegaron') || ' no llegaron' ELSE '' END;
            ELSIF s->>'estado' = 'NO' THEN
                v := concat_ws(' · ', s->'productos'->0->>'nombre', s->>'motivo');
            ELSE
                n   := coalesce(jsonb_array_length(s->'productos'), 0);
                mas := greatest(n - 1, 0) + coalesce((s->>'mas')::integer, 0);
                p0  := s->'productos'->0;
                v := concat_ws(' · ',
                        (p0->>'nombre')
                          || CASE WHEN p0->>'enviada' IS NULL THEN ''
                                  WHEN (p0->>'enviada')::numeric < coalesce((p0->>'pedida')::numeric, 0)
                                    THEN ' ×' || (p0->>'enviada') || ' de ' || (p0->>'pedida')
                                  ELSE ' ×' || (p0->>'enviada') END
                          || CASE WHEN mas > 0 THEN ' y ' || mas || ' más' ELSE '' END,
                        CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END);
            END IF;

        ELSIF jsonb_typeof(m->'decision') = 'object' THEN
            s := m->'decision';
            v := CASE WHEN s->>'estado' = 'APPROVED'
                      THEN concat_ws(' · ', 'La aprobó ' || (CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END), left(s->>'instruccion', 90), left(s->>'nota', 90))
                      ELSE concat_ws(' · ', 'La rechazó ' || (CASE WHEN nullif(btrim(s->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, s->>'quien') END), left(s->>'nota', 110)) END;

        ELSIF p_type = 'CORTE_NUEVO' AND m ? 'tramo' THEN
            t := (m->>'tramo')::numeric;
            v := concat_ws(' · ',
                    CASE WHEN t IS NULL THEN 'Sin conteo de efectivo'
                         WHEN t <= -0.01 THEN 'Faltaron $' || to_char(abs(t), 'FM999,999,990.00')
                         WHEN t >=  0.01 THEN 'Sobraron $' || to_char(t, 'FM999,999,990.00')
                         ELSE 'Cuadró' END,
                    CASE WHEN nullif(btrim(m->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, m->>'quien') END);

        ELSIF jsonb_typeof(m->'hacienda') = 'object' THEN
            SELECT string_agg(concat_ws(' ', f->>'sala',
                                  CASE WHEN f->>'monto' IS NOT NULL THEN '$' || to_char((f->>'monto')::numeric, 'FM999,999,990.00') END), ' · ')
              INTO v
              FROM (SELECT f FROM jsonb_array_elements(coalesce(m->'hacienda'->'facturas', '[]'::jsonb)) f LIMIT 3) x;

        ELSIF jsonb_typeof(m->'diferencia') = 'object' THEN
            v := concat_ws(' · ', m->'diferencia'->>'producto', m->'diferencia'->>'salida');

        ELSIF p_type = 'MINMAX_PENDING' AND m ? 'min_nuevo' THEN
            v := concat_ws(' · ',
                    'MIN ' || coalesce(m->>'min_hoy', '—') || ' · MAX ' || coalesce(m->>'max_hoy', '—')
                      || ' → MIN ' || (m->>'min_nuevo') || ' · MAX ' || coalesce(m->>'max_nuevo', '—'),
                    m->>'producto');

        ELSIF p_type = 'APERTURAS_DE_LA_MANANA' AND m ? 'total' THEN
            IF coalesce(jsonb_array_length(m->'no_abrieron'), 0) > 0 THEN
                SELECT 'No abrió: ' || string_agg(x, ', ') INTO v FROM jsonb_array_elements_text(m->'no_abrieron') x;
            ELSE
                SELECT CASE WHEN count(*) = 0 THEN NULL
                            WHEN min(h) = max(h) THEN 'Abrieron a las ' || public.hora_12(min(h))
                            ELSE 'Abrieron entre las ' || public.hora_12(min(h)) || ' y las ' || public.hora_12(max(h)) END
                  INTO v
                  FROM (SELECT (x->>'hora')::time AS h FROM jsonb_array_elements(coalesce(m->'salas', '[]'::jsonb)) x
                         WHERE x->>'hora' ~ '^[0-9]{1,2}:[0-9]{2}') t;
            END IF;
            IF coalesce(jsonb_array_length(m->'sin_respuesta'), 0) > 0 THEN
                v := concat_ws(' · ', v, 'sin comprobar: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(m->'sin_respuesta') x));
            END IF;

        ELSIF p_type = 'TRASLADO_RESPALDO' AND jsonb_typeof(m->'traslados') = 'array' THEN
            SELECT jsonb_array_length(m->'traslados') || CASE WHEN jsonb_array_length(m->'traslados') = 1 THEN ' traslado' ELSE ' traslados' END
                     || coalesce(', ' || trim(to_char(coalesce((m->>'unidades')::numeric, sum((x->>'unidades')::numeric)), 'FM999,999,990.##')) || ' unidades', '')
                     || coalesce(' · ' || string_agg(DISTINCT x->>'destino', ', '), '')
              INTO v
              FROM jsonb_array_elements(m->'traslados') x;

        ELSIF p_type = 'DEPOSITO_BANCO' AND m ? 'monto_banco' THEN
            v := concat_ws(' · ',
                    CASE WHEN (m->>'monto_banco')::numeric > 0
                         THEN '$' || to_char((m->>'monto_banco')::numeric, 'FM999,999,990.00') || ' al banco' END,
                    m->>'banco',
                    -- Sólo el nombre de quien lo lleva: `entregado_a` dice si es
                    -- personal o transportadora, no quién.
                    'lo lleva ' || CASE WHEN nullif(btrim(m->>'quien'), '') IS NOT NULL THEN public.nombre_corto_de_empleado(NULL, NULL, m->>'quien') END,
                    CASE WHEN (m->>'remanente')::numeric > 0
                         THEN 'quedan $' || to_char((m->>'remanente')::numeric, 'FM999,999,990.00') END);

        ELSIF p_type = 'CONTEO_CICLICO' AND m ? 'productos' THEN
            v := (m->>'productos') || ' productos por contar, a ciegas';

        ELSIF jsonb_typeof(m->'promo') = 'object' AND m->'promo'->>'tipo' = 'lote' THEN
            v := concat_ws(' · ', (m->'promo'->>'vendido') || ' de ' || (m->'promo'->>'asignado') || ' vendidas',
                           m->'promo'->>'producto');
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v := NULL;
    END;

    RETURN coalesce(nullif(btrim(v), ''), left(coalesce(p_body, ''), 180));
END;
$function$;

REVOKE ALL ON FUNCTION public.texto_de_push(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.texto_de_push(text, text, jsonb) TO service_role;
