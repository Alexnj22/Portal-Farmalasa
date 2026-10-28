SET lock_timeout = '5s';

-- Un ticket que no salió se le AVISA a quien lo pidió, con «Reimprimir» (2026-10-28).
--
-- Desde hoy un ticket que espera más de 10 minutos ya no se imprime. Pero sólo
-- se vencía cuando la caja volvía a pedir trabajo —o sea, con la caja apagada,
-- a la mañana siguiente— y quien lo mandó no se enteraba nunca: la pantalla le
-- había dicho «sale en unos segundos». Ahora:
--   · el cron `impresion-vencer-2min` lo vence aunque la caja siga apagada;
--   · `vencer_impresiones_atrasadas` es el ÚNICO juez del vencimiento —lo llama
--     el cron y lo llama `reclamar_impresion`—, y avisa en el mismo paso;
--   · `reimprimir_impresion` lo vuelve a mandar pasando por `encolar_impresion`,
--     con sus mismos frenos (sala propia, caja registrada, cola llena).

ALTER TABLE public.cola_impresion
    ADD COLUMN IF NOT EXISTS reimpreso_como bigint REFERENCES public.cola_impresion(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cola_impresion_reimpreso_como_idx
    ON public.cola_impresion (reimpreso_como) WHERE reimpreso_como IS NOT NULL;

CREATE OR REPLACE FUNCTION public.vencer_impresiones_atrasadas(p_branch_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_n integer := 0;
    r record;
BEGIN
    FOR r IN
        WITH vencidos AS (
            UPDATE public.cola_impresion c
               SET estado = 'ERROR',
                   error  = 'No se imprimió: esperó más de 10 minutos a que la caja respondiera. Si todavía hace falta, vuelve a imprimirlo.'
             WHERE c.estado = 'PENDIENTE'
               AND c.created_at < now() - interval '10 minutes'
               AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
            RETURNING c.id, c.titulo, c.branch_id, c.creado_por
        )
        SELECT v.*, b.name AS sala FROM vencidos v LEFT JOIN public.branches b ON b.id = v.branch_id
    LOOP
        v_n := v_n + 1;
        IF r.creado_por IS NOT NULL THEN
            PERFORM public.notify_employees(
                ARRAY[r.creado_por],
                'IMPRESION_VENCIDA',
                'Tu ticket no se imprimió',
                format('«%s» esperó más de 10 minutos y la caja de %s no respondió. Si todavía hace falta, reimprímelo.',
                       coalesce(nullif(btrim(r.titulo), ''), 'Documento'), coalesce(r.sala, 'la sala')),
                NULL,
                jsonb_build_object('impresion_id', r.id, 'titulo', r.titulo),
                true,
                r.branch_id::integer
            );
        END IF;
    END LOOP;
    RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.vencer_impresiones_atrasadas(bigint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.vencer_impresiones_atrasadas(bigint) TO service_role;

-- La caja usa el mismo juez para su propia sala (en vez de su UPDATE suelto).
CREATE OR REPLACE FUNCTION public.reclamar_impresion(p_device uuid, p_token uuid, p_version text, p_canal text)
 RETURNS TABLE(id bigint, titulo text, contenido_b64 text, impresora text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_sala bigint; v_impresora text;
BEGIN
    SELECT d.branch_id, d.impresora INTO v_sala, v_impresora
      FROM public.impresion_dispositivos d
     WHERE d.id = p_device AND d.token = p_token AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;

    -- `coalesce` y no asignacion directa: la version de dos parametros llega
    -- con NULL, y no tiene por qué borrar lo que ya se sabia de esta caja.
    --
    -- El `WHERE` es lo que separa preguntar de ESCRIBIR: la fila se toca cuando
    -- el latido ya tiene 30 s, o cuando el agente dice algo distinto de lo
    -- guardado. En una caja quieta eso son 2 escrituras por minuto en vez de 60.
    UPDATE public.impresion_dispositivos d
       SET ultimo_latido  = now(),
           agente_version = coalesce(p_version, d.agente_version),
           agente_canal   = coalesce(p_canal,   d.agente_canal)
     WHERE d.id = p_device
       AND (d.ultimo_latido IS NULL
            OR d.ultimo_latido < now() - interval '30 seconds'
            OR (p_version IS NOT NULL AND p_version IS DISTINCT FROM d.agente_version)
            OR (p_canal   IS NOT NULL AND p_canal   IS DISTINCT FROM d.agente_canal));

    -- El que quedó a medias vuelve a la cola: el agente se murió con el papel
    -- en la mano y nadie más lo iba a reclamar.
    UPDATE public.cola_impresion c
       SET estado = 'PENDIENTE', reclamado_at = NULL
     WHERE c.branch_id = v_sala AND c.estado = 'IMPRIMIENDO'
       AND c.reclamado_at < now() - interval '2 minutes';

    -- Y el que ya falló tres veces deja de reintentarse: un ticket que no sale
    -- nunca taparía a los que sí saldrían.
    UPDATE public.cola_impresion c
       SET estado = 'ERROR', error = coalesce(c.error, 'No se pudo imprimir despues de 3 intentos.')
     WHERE c.branch_id = v_sala AND c.estado = 'PENDIENTE' AND c.intentos >= 3;

    -- El que espera más de 10 minutos tampoco sale (2026-10-28): con la caja
    -- apagada, un ticket de la tarde salía a la mañana siguiente, cuando ya
    -- nadie lo esperaba. Se cuenta desde que se pidió, no desde el reintento.
    -- El juez es uno solo y además le avisa a quien lo pidió.
    PERFORM public.vencer_impresiones_atrasadas(v_sala);

    RETURN QUERY
    UPDATE public.cola_impresion c
       SET estado = 'IMPRIMIENDO', reclamado_at = now(),
           intentos = c.intentos + 1, dispositivo = p_device
     WHERE c.id = (
        SELECT x.id FROM public.cola_impresion x
         WHERE x.branch_id = v_sala AND x.estado = 'PENDIENTE'
         ORDER BY x.id
         -- Dos agentes abiertos por error nunca se llevan la misma fila.
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
    RETURNING c.id, c.titulo, encode(c.contenido, 'base64'), v_impresora;
END;
$function$;

-- Reimprimir: sólo quien lo pidió, o quien edita la impresión. Una sola vez
-- por ticket (`reimpreso_como`): dos toques no sacan dos papeles.
CREATE OR REPLACE FUNCTION public.reimprimir_impresion(p_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo uuid := (SELECT public.auth_employee_id());
    v_job public.cola_impresion%ROWTYPE;
    v_nuevo bigint;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    SELECT * INTO v_job FROM public.cola_impresion c WHERE c.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese ticket ya no está en la cola: se borra a los pocos días. Vuelve a imprimirlo desde su pantalla.';
    END IF;
    IF v_job.creado_por IS DISTINCT FROM v_yo
       AND NOT (SELECT public.auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN: sólo quien lo mandó puede reimprimirlo';
    END IF;
    IF v_job.reimpreso_como IS NOT NULL THEN
        RETURN v_job.reimpreso_como;   -- ya se reimprimió: no sale dos veces
    END IF;
    IF v_job.estado <> 'ERROR' THEN
        RAISE EXCEPTION 'Ese ticket no falló: está %.', lower(v_job.estado);
    END IF;

    -- Los mismos frenos que un ticket nuevo: sala propia, caja registrada, cola llena.
    v_nuevo := public.encolar_impresion(v_job.branch_id, v_job.titulo, encode(v_job.contenido, 'base64'));
    UPDATE public.cola_impresion c SET reimpreso_como = v_nuevo WHERE c.id = p_id;
    RETURN v_nuevo;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reimprimir_impresion(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reimprimir_impresion(bigint) TO authenticated, service_role;

SELECT cron.schedule('impresion-vencer-2min', '*/2 * * * *', 'SELECT public.vencer_impresiones_atrasadas()');
