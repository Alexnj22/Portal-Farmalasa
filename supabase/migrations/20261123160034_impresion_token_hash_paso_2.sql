-- El token de las cajas de impresión se guarda como hash (paso 2 de 2: fuera el texto plano).
--
-- Después del paso 1 (`impresion_token_hash_paso_1`) las dos comparaciones van
-- por `impresion_token_ok` y todas las cajas tienen su hash; se verificó en
-- producción que las seis siguieron reclamando. Acá:
--   · `impresion_token_ok` queda de dos argumentos y sólo compara el hash;
--   · se borra la columna `token`;
--   · una caja recién creada nace con el hash de un token que nadie conoce
--     (`default`), y el token de verdad nace al vincularla:
--     `canjear_codigo_de_vinculacion` lo genera, guarda sólo su hash y lo
--     devuelve una vez al instalador. `registrar_caja_de_impresion` igual.
-- Las cajas vinculadas siguen con el MISMO token: sólo cambia lo guardado.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.impresion_token_ok(p_hash text, p_dado uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT p_dado IS NOT NULL
     AND p_hash = public.kiosco_token_hash(p_dado);
$$;
REVOKE EXECUTE ON FUNCTION public.impresion_token_ok(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.impresion_token_ok(text, uuid) TO service_role;

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
     WHERE d.id = p_device
       AND public.impresion_token_ok(d.token_hash, p_token)
       AND d.activo;
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

CREATE OR REPLACE FUNCTION public.confirmar_impresion(p_device uuid, p_token uuid, p_id bigint, p_ok boolean, p_error text DEFAULT NULL::text, p_definitivo boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_sala bigint;
BEGIN
    SELECT d.branch_id INTO v_sala FROM public.impresion_dispositivos d
     WHERE d.id = p_device
       AND public.impresion_token_ok(d.token_hash, p_token)
       AND d.activo;
    IF v_sala IS NULL THEN RAISE EXCEPTION 'Caja no reconocida.'; END IF;

    UPDATE public.cola_impresion
       SET estado = CASE WHEN p_ok THEN 'IMPRESO'
                         WHEN coalesce(p_definitivo, false) THEN 'ERROR'
                         ELSE 'PENDIENTE' END,
           impreso_at = CASE WHEN p_ok THEN now() END,
           error = CASE WHEN p_ok THEN NULL ELSE left(p_error, 400) END,
           reclamado_at = NULL
     WHERE id = p_id AND branch_id = v_sala;
END;
$function$;

DROP FUNCTION IF EXISTS public.impresion_token_ok(text, uuid, uuid);

DROP TRIGGER IF EXISTS trg_impresion_dispositivos_hash_del_token ON public.impresion_dispositivos;
DROP FUNCTION IF EXISTS public.impresion_dispositivos_hash_del_token();

-- Por si alguna fila quedó sin hash entre un paso y otro.
UPDATE public.impresion_dispositivos
   SET token_hash = public.kiosco_token_hash(token)
 WHERE token_hash IS NULL AND token IS NOT NULL;

ALTER TABLE public.impresion_dispositivos
  ALTER COLUMN token_hash SET DEFAULT public.kiosco_token_hash(gen_random_uuid()),
  ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE public.impresion_dispositivos DROP COLUMN token;

CREATE OR REPLACE FUNCTION public.canjear_codigo_de_vinculacion(p_codigo text, p_equipo text DEFAULT NULL::text, p_impresora text DEFAULT NULL::text)
 RETURNS TABLE(device_id uuid, device_token uuid, sala text, nombre text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    d public.impresion_dispositivos;
    -- El token nace acá y sale una sola vez, en esta respuesta: queda guardado
    -- sólo su hash.
    v_token uuid := gen_random_uuid();
BEGIN
    SELECT * INTO d FROM public.impresion_dispositivos x
     WHERE x.codigo_vinculacion = upper(btrim(coalesce(p_codigo,'')))
       AND btrim(coalesce(p_codigo,'')) <> ''
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese codigo no existe o ya se uso. Genera uno nuevo en el portal.';
    END IF;
    IF d.vinculacion_expira < now() THEN
        UPDATE public.impresion_dispositivos SET codigo_vinculacion = NULL WHERE id = d.id;
        RAISE EXCEPTION 'Ese codigo ya vencio. Genera uno nuevo en el portal.';
    END IF;

    UPDATE public.impresion_dispositivos
       SET codigo_vinculacion = NULL,
           vinculada_at = now(),
           token_hash = public.kiosco_token_hash(v_token),
           equipo = nullif(btrim(coalesce(p_equipo,'')), ''),
           impresora = coalesce(nullif(btrim(coalesce(p_impresora,'')), ''), impresora)
     WHERE id = d.id
     RETURNING * INTO d;

    RETURN QUERY
    SELECT d.id, v_token,
           (SELECT b.name FROM public.branches b WHERE b.id = d.branch_id),
           d.nombre;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_caja_de_impresion(p_branch_id bigint, p_nombre text, p_impresora text DEFAULT 'pos-80'::text)
 RETURNS TABLE(id uuid, token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_id    uuid;
    -- Sale una sola vez, en esta respuesta: queda guardado sólo su hash.
    v_token uuid := gen_random_uuid();
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_branch_id IS NULL OR btrim(coalesce(p_nombre,'')) = '' THEN
        RAISE EXCEPTION 'Falta la sucursal o el nombre de la caja.';
    END IF;

    INSERT INTO public.impresion_dispositivos (branch_id, nombre, impresora, created_by, token_hash)
    VALUES (p_branch_id, btrim(p_nombre), coalesce(nullif(btrim(p_impresora),''), 'pos-80'),
            (SELECT auth_employee_id()), public.kiosco_token_hash(v_token))
    RETURNING impresion_dispositivos.id INTO v_id;

    RETURN QUERY SELECT v_id, v_token;
END;
$function$;
