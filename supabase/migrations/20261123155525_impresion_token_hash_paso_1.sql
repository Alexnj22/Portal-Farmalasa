-- El token de las cajas de impresión se guarda como hash (paso 1 de 2: compatible).
--
-- `impresion_dispositivos.token` era un uuid en claro que nunca vence. Con él
-- cualquiera reclama los tickets de la sucursal (`reclamar_impresion`) y los da
-- por impresos (`confirmar_impresion`). Mismo arreglo que el kiosco
-- (`20261123140631_kiosco_token_hash_paso_1`).
--
-- El agente de cada sucursal llama a `reclamar_impresion` cada ~2 s con el MISMO
-- token, y no se puede reinstalar: los tokens no cambian, sólo lo guardado.
--
-- Paso 1 (éste): se agrega `token_hash` (SHA-256, el mismo `kiosco_token_hash`),
-- se llena para todas las filas en la misma transacción que cambia las dos
-- comparaciones, y `impresion_token_ok` todavía acepta una fila sin hash
-- comparando en claro. Un trigger mantiene el hash mientras exista el plano
-- (`crear_codigo_de_vinculacion` inserta con el `default` de la columna).
-- Paso 2: se borra el texto plano.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.impresion_token_ok(p_hash text, p_plano uuid, p_dado uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT p_dado IS NOT NULL
     AND (p_hash = public.kiosco_token_hash(p_dado)
          OR (p_hash IS NULL AND p_plano = p_dado));
$$;
REVOKE EXECUTE ON FUNCTION public.impresion_token_ok(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.impresion_token_ok(text, uuid, uuid) TO service_role;

-- Sin GRANT de columna: `authenticated` lee esta tabla columna por columna, y el
-- hash no se publica.
ALTER TABLE public.impresion_dispositivos ADD COLUMN IF NOT EXISTS token_hash text;

UPDATE public.impresion_dispositivos
   SET token_hash = public.kiosco_token_hash(token)
 WHERE token IS NOT NULL
   AND token_hash IS DISTINCT FROM public.kiosco_token_hash(token);

CREATE UNIQUE INDEX IF NOT EXISTS impresion_dispositivos_token_hash_key
  ON public.impresion_dispositivos (token_hash);

CREATE OR REPLACE FUNCTION public.impresion_dispositivos_hash_del_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.token IS NOT NULL THEN
    NEW.token_hash := public.kiosco_token_hash(NEW.token);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.impresion_dispositivos_hash_del_token() FROM PUBLIC, anon, authenticated;

-- `UPDATE OF token`: el latido de `reclamar_impresion` no toca el token, así que
-- no dispara esto 30 veces por minuto.
DROP TRIGGER IF EXISTS trg_impresion_dispositivos_hash_del_token ON public.impresion_dispositivos;
CREATE TRIGGER trg_impresion_dispositivos_hash_del_token
  BEFORE INSERT OR UPDATE OF token ON public.impresion_dispositivos
  FOR EACH ROW EXECUTE FUNCTION public.impresion_dispositivos_hash_del_token();

-- ── Las dos funciones que comparaban el token en claro ──────────────────────
-- Cuerpos copiados de la definición viva; sólo cambia la línea del token.
-- (`reclamar_impresion(uuid,uuid)` delega en la de cuatro y no cambia.)

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
       AND public.impresion_token_ok(d.token_hash, d.token, p_token)
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
       AND public.impresion_token_ok(d.token_hash, d.token, p_token)
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
