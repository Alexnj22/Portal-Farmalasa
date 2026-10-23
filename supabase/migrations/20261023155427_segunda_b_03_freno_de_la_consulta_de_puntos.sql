SET lock_timeout = '5s';

-- El freno de «Mis puntos» no puede depender sólo de la IP (HB1). La IP sale de
-- un encabezado que el que llama puede elegir; con IPs inventadas el freno de 8
-- fallos por IP no cuenta nada y se pueden probar códigos sin límite. Se agregan
-- dos topes que no dependen de quién dice ser el que llama (firma igual):
--   · POR DOCUMENTO: fallos sobre la misma huella en 15 min.
--   · GLOBAL: 60 fallos en 15 min en toda la red frenan a todos (devuelve 1000).
-- Calibrado con 60 días de producción (2026-10-23): máximo global 6 en 15 min,
-- máximo por huella 6 en una hora. Definición viva; la rama del acierto no cambia.

CREATE INDEX IF NOT EXISTS idx_puntos_intentos_huella
    ON public.puntos_consulta_intentos (huella_dui, created_at DESC)
    WHERE NOT acerto;

CREATE OR REPLACE FUNCTION public.puntos_consulta_registrar(p_ip text, p_huella_dui text, p_acerto boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  fallos integer;
  fallos_huella integer;
  fallos_red integer;
  TOPE_RED constant integer := 60;
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

  SELECT count(*) INTO fallos
  FROM public.puntos_consulta_intentos
  WHERE ip = p_ip AND NOT acerto AND created_at > now() - interval '15 minutes';

  SELECT count(*) INTO fallos_huella
  FROM public.puntos_consulta_intentos
  WHERE p_huella_dui IS NOT NULL AND huella_dui = p_huella_dui
    AND NOT acerto AND created_at > now() - interval '15 minutes';

  SELECT count(*) INTO fallos_red
  FROM public.puntos_consulta_intentos
  WHERE NOT acerto AND created_at > now() - interval '15 minutes';

  INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
  VALUES (p_ip, p_huella_dui, false);

  IF fallos_red >= TOPE_RED THEN
    RETURN 1000;
  END IF;
  RETURN greatest(fallos, fallos_huella);
END;
$function$;
