SET lock_timeout = '5s';

-- «1:06 p.» en un renglón y «m.» en el otro se leía como un error: la campana
-- partía el título justo ahí. Los dos espacios de la hora pasan a ser de los
-- que no se cortan (U+00A0), igual que en `hora12` del frente.
CREATE OR REPLACE FUNCTION public.hora_12(p_hora time)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT CASE WHEN p_hora IS NULL THEN NULL ELSE
    ((extract(hour FROM p_hora)::int + 11) % 12 + 1)::text || ':' || to_char(p_hora, 'MI')
    || chr(160)
    || CASE WHEN extract(hour FROM p_hora) < 12 THEN 'a.' ELSE 'p.' END || chr(160) || 'm.' END;
$function$;
