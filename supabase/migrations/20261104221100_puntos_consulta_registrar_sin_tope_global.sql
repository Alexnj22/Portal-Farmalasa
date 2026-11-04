-- puntos_consulta_registrar: el tope de RED ya no deja a toda la red afuera,
-- y el de DOCUMENTO pasa a espera creciente (auditoría 2026-11-04, ALTO)
--
-- Antes:
--   · 60 fallos en 15 min en TODA la red → devolvía 1000 a cualquiera: un
--     script con 60 intentos dejaba sin entrar a todos los clientes (app y web).
--   · 8 fallos sobre una huella de documento, desde cualquier IP → bloqueo
--     absoluto de 15 min de ESE documento.
--
-- Ahora (el contrato no cambia: entero; 1000 significa «frena»):
--   1. Por IP: igual que antes.
--   2. Red con ≥ 60 fallos en 15 min: sólo una pausa de 20 s entre intentos a
--      una IP SIN aciertos en 30 días.
--   3. Por documento: desde 5 fallos, espera creciente desde el último (30 s,
--      1, 2, 4, 8 min, tope 15). Una IP que ya acertó con ESE documento no
--      espera. Un intento frenado se anota sin huella: no alarga la espera.
--
-- Partió de pg_get_functiondef vivo (2026-11-04). SECURITY INVOKER,
-- search_path y ACL iguales. Probado en el branch con execute_sql
-- (6.º fallo frena; dueño pasa; IP nueva bajo ataque espera 20 s; IP conocida
-- pasa). Llamadores (app-clientes, mis-puntos) sin cambio.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_consulta_registrar(p_ip text, p_huella_dui text, p_acerto boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  fallos integer;
  fallos_huella integer := 0;
  fallos_red integer;
  ultimo_huella timestamptz;
  ultimo_ip timestamptz;
  es_dueno boolean := false;
  ip_conocida boolean;
  espera interval;
  TOPE_RED constant integer := 60;
  PAUSA_RED constant interval := interval '20 seconds';
  TOPE_HUELLA constant integer := 5;
  ESPERA_MAX constant interval := interval '15 minutes';
BEGIN
  IF p_acerto THEN
    UPDATE public.puntos_consulta_intentos SET acerto = true
     WHERE id = (
       SELECT i.id FROM public.puntos_consulta_intentos i
        WHERE i.ip = p_ip
          AND i.huella_dui IS NOT DISTINCT FROM p_huella_dui
          AND NOT i.acerto
          AND i.created_at > now() - interval '15 minutes'
        ORDER BY i.created_at DESC
        LIMIT 1);
    IF NOT FOUND THEN
      INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
      VALUES (p_ip, p_huella_dui, true);
    END IF;
    RETURN 0;
  END IF;

  -- 1. La IP.
  SELECT count(*), max(created_at) INTO fallos, ultimo_ip
  FROM public.puntos_consulta_intentos
  WHERE ip = p_ip AND NOT acerto AND created_at > now() - interval '15 minutes';

  -- 3. El documento: espera creciente desde su último fallo.
  IF p_huella_dui IS NOT NULL THEN
    SELECT count(*), max(created_at) INTO fallos_huella, ultimo_huella
    FROM public.puntos_consulta_intentos
    WHERE huella_dui = p_huella_dui AND NOT acerto AND created_at > now() - interval '15 minutes';

    IF fallos_huella >= TOPE_HUELLA THEN
      SELECT EXISTS (
        SELECT 1 FROM public.puntos_consulta_intentos
         WHERE ip = p_ip AND huella_dui = p_huella_dui AND acerto
           AND created_at > now() - interval '30 days')
        INTO es_dueno;
      espera := least(ESPERA_MAX, interval '30 seconds' * power(2, least(fallos_huella - TOPE_HUELLA, 10)));
      IF NOT es_dueno AND now() < ultimo_huella + espera THEN
        -- Frenado: se anota sin huella para no alargar la espera del dueño.
        INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
        VALUES (p_ip, NULL, false);
        RETURN 1000;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
  VALUES (p_ip, p_huella_dui, false);

  -- 2. La red: sólo una pausa, y sólo para la IP que nunca acertó.
  SELECT count(*) INTO fallos_red
  FROM public.puntos_consulta_intentos
  WHERE NOT acerto AND created_at > now() - interval '15 minutes';

  IF fallos_red >= TOPE_RED AND ultimo_ip IS NOT NULL AND now() < ultimo_ip + PAUSA_RED THEN
    SELECT EXISTS (
      SELECT 1 FROM public.puntos_consulta_intentos
       WHERE ip = p_ip AND acerto AND created_at > now() - interval '30 days')
      INTO ip_conocida;
    IF NOT ip_conocida THEN
      RETURN 1000;
    END IF;
  END IF;

  RETURN fallos;
END;
$function$;
