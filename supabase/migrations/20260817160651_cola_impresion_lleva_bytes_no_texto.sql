SET lock_timeout = '5s';

-- ── La cola lleva BYTES, no texto ───────────────────────────────────────────
--
-- Un ticket es un flujo ESC/POS: la letra normal se pide con `ESC ! \x00` y la
-- alineación a la izquierda con `ESC a \x00`, así que TODO ticket lleva un NUL.
-- Un NUL no cabe en `text` — Postgres corta con «unsupported Unicode escape
-- sequence» al parsear el JSON y PostgREST lo devuelve como 400.
--
-- Medido el 17-ago-2026: las dos reimpresiones de bolsa de Salud 5 (15:55:26 y
-- 15:55:34 UTC) dieron 400, y `cola_impresion` no había tenido NUNCA una fila.
-- No fallaba un documento: fallaban todos, desde el primer día. El portal lo
-- leía como «esta sala no tiene caja» y caía al diálogo del navegador, o sea
-- que el papel salía en la computadora de quien apretaba el botón en vez de en
-- la caja de la sala — justo lo que la cola existe para evitar.
--
-- El tipo de la columna es el arreglo, no un `replace` en el camino: mientras
-- diga `text`, cualquier llamador nuevo vuelve a estrellarse igual.
ALTER TABLE public.cola_impresion
    ALTER COLUMN contenido TYPE bytea USING convert_to(contenido, 'LATIN1');

-- El documento entra en base64 (JSON no transporta un NUL) y se guarda crudo.
CREATE OR REPLACE FUNCTION public.encolar_impresion(
    p_branch_id bigint, p_titulo text, p_contenido text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_pendientes integer; v_bytes bytea;
BEGIN
    IF (SELECT auth_employee_id()) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Falta decir en que sala se imprime.'; END IF;

    BEGIN
        v_bytes := decode(coalesce(p_contenido, ''), 'base64');
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'El documento vino mal armado y no se puede imprimir.';
    END;

    IF octet_length(v_bytes) = 0 THEN
        RAISE EXCEPTION 'No hay nada que imprimir.';
    END IF;
    IF octet_length(v_bytes) > 60000 THEN
        RAISE EXCEPTION 'Ese documento es demasiado largo para un rollo.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.impresion_dispositivos d
                    WHERE d.branch_id = p_branch_id AND d.activo
                      AND d.vinculada_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Esa sala no tiene una caja registrada para imprimir.';
    END IF;

    SELECT count(*) INTO v_pendientes FROM public.cola_impresion c
     WHERE c.branch_id = p_branch_id AND c.estado IN ('PENDIENTE','IMPRIMIENDO');
    IF v_pendientes >= 50 THEN
        RAISE EXCEPTION 'Esa caja tiene % documentos esperando: parece que la impresora no esta respondiendo.', v_pendientes;
    END IF;

    INSERT INTO public.cola_impresion (branch_id, titulo, contenido, creado_por)
    VALUES (p_branch_id, left(btrim(p_titulo), 120), v_bytes, (SELECT auth_employee_id()))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

-- Y sale en base64. La columna se llama `contenido_b64` y no `contenido` a
-- propósito: un agente viejo pide `contenido`, no lo encuentra y falla a la
-- vista en vez de tirar una hoja en blanco creyendo que imprimió.
DROP FUNCTION IF EXISTS public.reclamar_impresion(uuid, uuid);
CREATE FUNCTION public.reclamar_impresion(p_device uuid, p_token uuid)
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

    UPDATE public.impresion_dispositivos d
       SET ultimo_latido = now()
     WHERE d.id = p_device;

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

REVOKE EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reclamar_impresion(uuid, uuid) TO anon, authenticated, service_role;
