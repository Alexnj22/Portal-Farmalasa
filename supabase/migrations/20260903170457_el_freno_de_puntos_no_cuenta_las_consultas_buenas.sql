-- El freno contaba las consultas BUENAS, no sólo los intentos fallidos.
--
-- `mis-puntos` anota cada pedido como fallo ANTES de resolverlo —tiene que
-- hacerlo: si anotara después, quien corta la conexión no gastaría intentos— y
-- al acertar anotaba un acierto. Pero el conteo mira `NOT acerto`, así que la
-- fila de fallo se quedaba ahí y el acierto sumaba una fila más sin borrar
-- nada. O sea que el contador no medía «cuántas veces se equivocó» sino
-- **cuántas veces preguntó**.
--
-- Con el tope del camino de código en CINCO, eso significa que la SEXTA
-- consulta —correcta, de una persona distinta, con su propio código— recibe
-- «Demasiados intentos». Y el freno agrupa por IP: en una sala todos los
-- clientes salen por la misma. Medido el 2026-09-03 probando el circuito: seis
-- pedidos, cuatro de ellos exitosos, y la puerta cerrada.
--
-- El comentario de la edge function decía «se anota para que los fallos previos
-- no lo sigan penalizando». Esa era la intención y nunca fue lo que pasaba: el
-- acierto era un INSERT, no una corrección de su propia fila.
--
-- ── Se cancela la fila PROPIA, no todas ────────────────────────────────────
-- Limpiar todos los fallos de la IP al primer acierto le regalaría al que
-- prueba a ciegas una forma de poner el contador en cero: intercalar una
-- consulta que ya sabe buena. Cancelar sólo el intento que se acaba de resolver
-- deja la cuenta exacta — una consulta correcta no cuesta nada, una equivocada
-- cuesta uno — que es lo que el freno siempre quiso contar.
--
-- Verificado contra producción: siete consultas correctas seguidas pasan las
-- siete, y a la sexta equivocada la puerta se cierra.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_consulta_registrar(p_ip text, p_huella_dui text, p_acerto boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  fallos integer;
BEGIN
  IF p_acerto THEN
    -- Acertó: su propio intento deja de contar como fallo. Se corrige la fila
    -- que este mismo pedido abrió hace un instante — la más reciente de esa IP
    -- con esa huella — y no se inserta una segunda.
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
      -- No había fila que corregir (otra sesión la tomó, o pasó la ventana).
      -- Se anota igual: el registro de aciertos existe para poder auditarlo.
      INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
      VALUES (p_ip, p_huella_dui, true);
    END IF;
    RETURN 0;
  END IF;

  SELECT count(*) INTO fallos
  FROM public.puntos_consulta_intentos
  WHERE ip = p_ip AND NOT acerto AND created_at > now() - interval '15 minutes';

  INSERT INTO public.puntos_consulta_intentos (ip, huella_dui, acerto)
  VALUES (p_ip, p_huella_dui, false);

  RETURN fallos;
END;
$function$;
