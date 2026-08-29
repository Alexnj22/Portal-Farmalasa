SET lock_timeout = '5s';

-- Un faltante que nadie resuelve, y el que se descubre contando después.
--
-- Las dos mitades que le faltaban al circuito, y las dos las eligió el usuario:
--
--  1. **El recordatorio.** Se declaraba, salía el aviso, y si nadie lo miraba se
--     quedaba abierto para siempre. Una alarma que suena una vez y se calla se
--     pierde entre lo del día — la regla ya estaba escrita en el repo y el
--     modelo hecho (`avisar_envios_sin_decidir`, mismo cron de las 15 UTC).
--  2. **Declararlo después de recibir.** Se declaraba SÓLO al recibir, y el caso
--     real es el otro: se aprieta «ya llegó» y se cuenta diez minutos después.
--     Con plazo, porque un faltante declarado tres semanas más tarde ya no se
--     puede ir a buscar: se vuelve un reclamo sin caja.

-- ══════════════════════════════════════════════════════════════════════════
-- 1 · A quién se le avisa de un faltante, escrito UNA vez
-- ══════════════════════════════════════════════════════════════════════════
--
-- Estaba adentro de `avisar_faltantes` y el recordatorio habría sido la segunda
-- copia. Dos listas de destinatarios que se separan es cómo un aviso le llega a
-- alguien y su recordatorio a otro.
--
-- A la sala de ORIGEN porque es la única que todavía puede ir a mirar si la
-- bolsa quedó en su mostrador, **y a supervisión siempre** porque un faltante es
-- una diferencia de existencias entre dos salas y ninguna de las dos puede ser
-- la única que la sepa.
CREATE OR REPLACE FUNCTION public.destinatarios_de_faltante(
    p_origen integer,
    p_excepto uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_sala uuid[];
    v_sup  uuid[];
    v_out  uuid[];
BEGIN
    SELECT destinatarios INTO v_sala
      FROM public.resolver_destinatarios_traslado(p_origen);

    SELECT array_agg(e.id ORDER BY e.name) INTO v_sup
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND public.rango_de_empleado(e.id) >= 3
       AND public.puede_confirmar_traslado(e.id);

    -- Quien acaba de declararlo no se avisa a sí mismo: acaba de escribirlo en
    -- pantalla.
    SELECT array_agg(DISTINCT x) INTO v_out
      FROM unnest(coalesce(v_sala, ARRAY[]::uuid[]) || coalesce(v_sup, ARRAY[]::uuid[])) x
     WHERE x IS NOT NULL AND (p_excepto IS NULL OR x <> p_excepto);

    RETURN coalesce(v_out, ARRAY[]::uuid[]);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.destinatarios_de_faltante(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.destinatarios_de_faltante(integer, uuid) TO service_role;

-- Y `avisar_faltantes` pasa a usarla, para que la lista sea UNA.
CREATE OR REPLACE FUNCTION public.avisar_faltantes(
    p_request_id uuid,
    p_ids        uuid[],
    p_actor      uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    r        public.approval_requests%ROWTYPE;
    m        jsonb;
    v_n      integer;
    v_que    text;
    v_quien  text;
    v_sala   text;
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dest   uuid[];
BEGIN
    SELECT * INTO r FROM public.approval_requests WHERE id = p_request_id;
    IF r.id IS NULL THEN RETURN 0; END IF;
    m := coalesce(r.metadata, '{}'::jsonb);

    SELECT count(*),
           CASE WHEN count(*) = 1
                THEN max(coalesce(bf.descripcion, 'el producto #' || bf.erp_product_id))
                ELSE NULL END
      INTO v_n, v_que
      FROM public.bolsa_faltante bf
     WHERE bf.id = ANY(p_ids);
    IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

    SELECT name INTO v_quien FROM public.employees WHERE id = p_actor;
    v_quien := coalesce(v_quien, 'La sala que recibió');
    v_sala  := coalesce(nullif(m->>'branch_name', ''), 'la otra sala');

    v_dest := public.destinatarios_de_faltante(nullif(m->>'origen_branch_id','')::integer, p_actor);
    IF coalesce(array_length(v_dest, 1), 0) = 0 THEN RETURN 0; END IF;

    v_titulo := '⚠️ Faltó producto en una bolsa';
    v_cuerpo := v_quien || ' (' || v_sala || ') abrió la bolsa de '
             || coalesce(nullif(m->>'origen_branch_name',''), 'tu sala')
             || ' y falta '
             || coalesce(v_que, v_n || ' ' || CASE WHEN v_n = 1 THEN 'producto' ELSE 'productos' END)
             || '. Revisa si quedó en tu sala y responde en Traslados.';

    v_link := '/traslados?tab=faltantes&bolsa=' || r.id;

    INSERT INTO public.notifications
        (recipient_id, type, title, body, link, metadata, branch_id, created_by)
    SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
           jsonb_build_object('request_id', r.id, 'request_type', r.type, 'faltantes', to_jsonb(p_ids)),
           nullif(m->>'origen_branch_id','')::integer, p_actor
      FROM unnest(v_dest) d;

    PERFORM net.http_post(
        url     := public.push_function_url(),
        headers := public.push_function_headers(),
        body    := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                                      'target_type', 'EMPLOYEE', 'target_value', to_jsonb(v_dest)));

    RETURN coalesce(array_length(v_dest, 1), 0);
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2 · El recordatorio
-- ══════════════════════════════════════════════════════════════════════════
--
-- **Dos escalones y no uno por corrida**: al pasar 1 día y otra vez al pasar 3.
-- El número que ya se avisó se guarda en la fila, que es lo que evita repetirlo
-- todos los días. Una alarma que suena en cada corrida es ruido que se aprende a
-- ignorar; una que suena una sola vez se pierde entre lo del día. Es el mismo
-- escalonado de `avisar_envios_sin_decidir`, a propósito: son la misma clase de
-- espera y no tienen por qué comportarse distinto.
ALTER TABLE public.bolsa_faltante
    ADD COLUMN IF NOT EXISTS recordado_dias integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.avisar_faltantes_sin_resolver(p_dias integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    r        record;
    v_dest   uuid[];
    v_titulo text;
    v_cuerpo text;
    v_link   text;
    v_dias   integer;
    v_n      integer := 0;
BEGIN
    FOR r IN
        SELECT bf.id, bf.request_id, bf.descripcion, bf.erp_product_id, bf.cantidad,
               bf.origen_branch_id, bf.recordado_dias,
               bo.name AS origen, bd.name AS destino,
               floor(extract(epoch FROM now() - bf.declarado_at) / 86400)::integer AS dias
          FROM public.bolsa_faltante bf
          LEFT JOIN public.branches bo ON bo.id = bf.origen_branch_id
          LEFT JOIN public.branches bd ON bd.id = bf.destino_branch_id
         WHERE bf.estado = 'abierto'
           AND bf.declarado_at < now() - make_interval(days => greatest(1, p_dias))
    LOOP
        v_dias := CASE WHEN r.dias >= 3 THEN 3 ELSE p_dias END;
        CONTINUE WHEN coalesce(r.recordado_dias, 0) >= v_dias;

        v_dest := public.destinatarios_de_faltante(r.origen_branch_id, NULL);
        CONTINUE WHEN coalesce(array_length(v_dest, 1), 0) = 0;

        v_titulo := '⚠️ Un faltante lleva ' || r.dias
                 || CASE WHEN r.dias = 1 THEN ' día sin resolver' ELSE ' días sin resolver' END;
        -- Se nombra el PRODUCTO y el recorrido, no el número de la bolsa: quien
        -- lo lee tiene que saber qué ir a buscar, que es lo único accionable.
        v_cuerpo := coalesce(r.descripcion, 'El producto #' || r.erp_product_id)
                 || ' — faltaron ' || trim(to_char(r.cantidad, 'FM999,999,990.####'))
                 || ' en la bolsa de ' || coalesce(r.origen, 'una sala')
                 || ' a ' || coalesce(r.destino, 'otra sala')
                 || '. Si apareció, ciérralo; si no, di qué se hizo.';
        v_link := '/traslados?tab=faltantes&bolsa=' || r.request_id;

        -- Se anota ANTES de mandar: `pg_net` es transaccional, así que si algo de
        -- acá para abajo revienta, la anotación se va con él y el recordatorio se
        -- puede volver a intentar mañana.
        UPDATE public.bolsa_faltante SET recordado_dias = v_dias WHERE id = r.id;

        INSERT INTO public.notifications
            (recipient_id, type, title, body, link, metadata, branch_id, created_by)
        SELECT d, 'REQUEST_PENDING', v_titulo, v_cuerpo, v_link,
               jsonb_build_object('request_id', r.request_id, 'faltante_id', r.id,
                                  'recordatorio', v_dias),
               r.origen_branch_id, NULL
          FROM unnest(v_dest) d;

        PERFORM net.http_post(
            url := public.push_function_url(), headers := public.push_function_headers(),
            body := jsonb_build_object('title', v_titulo, 'message', v_cuerpo, 'url', v_link,
                    'target_type','EMPLOYEE','target_value', to_jsonb(v_dest)));
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.avisar_faltantes_sin_resolver(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avisar_faltantes_sin_resolver(integer) TO service_role;

-- Diez minutos después del aviso de envíos sin decidir, y no a la misma hora:
-- son dos avisos del mismo módulo y llegar juntos los vuelve un solo bloque que
-- se descarta entero.
SELECT cron.unschedule('avisar-faltantes-sin-resolver')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avisar-faltantes-sin-resolver');

SELECT cron.schedule(
    'avisar-faltantes-sin-resolver',
    '10 15 * * *',
    $cron$ SELECT public.avisar_faltantes_sin_resolver(1); $cron$
);
