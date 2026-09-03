-- Quien resuelve la ficha devuelve también su DUI, para que el saldo se pueda
-- buscar.
--
-- El sistema de puntos guarda la cuenta con el DUI como llave
-- (`Clientes.DUI`). Mientras el único camino de entrada era «DUI + teléfono»
-- eso no se notaba: el DUI ya estaba en la mano de quien preguntaba. Con el
-- código de acceso deja de estarlo — el cliente escribe siete caracteres y
-- nadie sabe con qué documento está inscrito.
--
-- Se devuelve a la EDGE FUNCTION, que corre con service_role y ya podía leer
-- `customers` entera; no viaja al navegador. La regla de «esta puerta no
-- devuelve el documento con el que se entró» sigue en pie y se cumple donde
-- importa, que es la respuesta.
--
-- Es DROP + CREATE y no CREATE OR REPLACE porque cambia el tipo de retorno.
-- Seguro: hoy nadie en producción la llama —la edge function desplegada todavía
-- usa `puntos_cliente_por_dui_y_telefono`— y se recrea en la misma transacción.
SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.puntos_cliente_por_documento(text, text);

CREATE FUNCTION public.puntos_cliente_por_documento(p_documento text, p_telefono text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, name text, dui text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_doc  text := upper(regexp_replace(coalesce(p_documento,''), '[^A-Za-z0-9]', '', 'g'));
  v_num  text := regexp_replace(coalesce(p_documento,''), '\D', '', 'g');
  v_tel  text := right(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), 8);
  v_hay_tel boolean := length(v_tel) = 8;
BEGIN
  IF length(v_doc) < 7 THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (
    -- 1 · el código. Es nuestro y es único, así que no puede empatar consigo
    --     mismo; sí podría empatar con un pasaporte de 7 caracteres, y por eso
    --     el conteo final sigue exigiendo uno solo.
    SELECT c.id, c.name, c.dui, true AS por_codigo
      FROM public.puntos_codigo_acceso k
      JOIN public.customers c ON c.id = k.customer_id
     WHERE k.codigo = v_doc
    UNION ALL
    -- 2 · el DUI: nueve dígitos, mirando sólo los dígitos porque el portal lo
    --     guarda con guion y el otro sistema no
    SELECT c.id, c.name, c.dui, false
      FROM public.customers c
     WHERE length(v_num) = 9
       AND regexp_replace(coalesce(c.dui,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 3 · el NIT
    SELECT c.id, c.name, c.dui, false
      FROM public.customers c
     WHERE length(v_num) >= 9
       AND regexp_replace(coalesce(c.nit,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 4 · el pasaporte: alfanumérico, sin separadores y en mayúscula
    SELECT c.id, c.name, c.dui, false
      FROM public.customers c
     WHERE upper(regexp_replace(coalesce(c.pasaporte,''), '[^A-Za-z0-9]', '', 'g')) = v_doc
  ),
  ok AS (
    SELECT DISTINCT cand.id, cand.name, cand.dui
      FROM cand
      JOIN public.customers c ON c.id = cand.id
     WHERE
       -- El código entra solo: se lo emite una persona en la caja, es nuestro,
       -- y su largo se eligió para aguantar esto. Si además vino un teléfono no
       -- se exige que coincida — el papel dice «escribí tu código» y quien de
       -- todos modos llenó el campo de arriba no puede quedar afuera por eso.
       cand.por_codigo
       -- Por documento sigue haciendo falta: el DUI de alguien no es un secreto
       -- ni lo emitimos nosotros, así que solo convertiría esto en un detector
       -- de «este DUI es cliente».
       OR (v_hay_tel AND (
             right(regexp_replace(coalesce(c.phone,''),     '\D', '', 'g'), 8) = v_tel
          OR right(regexp_replace(coalesce(c.telefono2,''), '\D', '', 'g'), 8) = v_tel))
  )
  SELECT ok.id, ok.name, ok.dui FROM ok WHERE (SELECT count(*) FROM ok) = 1;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.puntos_cliente_por_documento(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_cliente_por_documento(text, text) TO service_role;
