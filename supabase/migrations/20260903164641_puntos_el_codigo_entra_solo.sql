-- El código de acceso entra SOLO, en cualquier ficha.
--
-- Hasta hoy el código valía sin teléfono únicamente en las fichas extranjeras.
-- Era una restricción escrita pensando en el ataque de «pegarle al de
-- cualquiera», y dejaba al circuito entero prometiendo algo que no cumplía: el
-- papel dice «escaneá y entrás» y su QR lleva sólo el código, así que para toda
-- ficha que no fuera extranjera —o sea casi todas— la pantalla contestaba «no
-- encontramos una ficha con ese documento y ese teléfono» sobre un código recién
-- emitido. Medido el 2026-09-03 con el primer código entregado en sala.
--
-- Decisión del usuario ese mismo día: **si es por código, el código alcanza.**
--
-- ── Qué protege el código, y qué cuesta pegarle ─────────────────────────────
-- Siete caracteres de un alfabeto de 25 sin parecidos son 6,103,515,625
-- combinaciones, y el freno del camino de código tolera CINCO fallos por IP en
-- 15 minutos (`TOPE_FALLOS_CODIGO` en la edge function `mis-puntos`), o sea 480
-- intentos por día y por IP. Con mil códigos emitidos, una sola IP necesitaría
-- del orden de 8,000 años para tener la mitad de probabilidad de pegarle a
-- alguno; hace falta un parque de miles de IP para que la cuenta se acerque a
-- días. Y lo que se gana es MIRAR un nombre y un saldo: esta puerta no canjea,
-- no edita la ficha y no devuelve el documento con el que se entró.
--
-- El teléfono nunca fue una contraseña —lo sabe la familia y sale en papeles—:
-- lo que hacía era volver el ataque «adivinar el par de fulano». Sacarlo del
-- camino del código deja al código cargando todo el peso, que es justo para lo
-- que se eligió su largo.
--
-- Lo que NO cambia: el camino del DOCUMENTO (DUI, NIT, pasaporte) sigue
-- exigiendo el teléfono. Ahí el primer dato no es secreto ni es nuestro.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.puntos_cliente_por_documento(p_documento text, p_telefono text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, name text)
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
    SELECT c.id, c.name, true AS por_codigo
      FROM public.puntos_codigo_acceso k
      JOIN public.customers c ON c.id = k.customer_id
     WHERE k.codigo = v_doc
    UNION ALL
    -- 2 · el DUI: nueve dígitos, mirando sólo los dígitos porque el portal lo
    --     guarda con guion y el otro sistema no
    SELECT c.id, c.name, false
      FROM public.customers c
     WHERE length(v_num) = 9
       AND regexp_replace(coalesce(c.dui,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 3 · el NIT
    SELECT c.id, c.name, false
      FROM public.customers c
     WHERE length(v_num) >= 9
       AND regexp_replace(coalesce(c.nit,''), '\D', '', 'g') = v_num
    UNION ALL
    -- 4 · el pasaporte: alfanumérico, sin separadores y en mayúscula
    SELECT c.id, c.name, false
      FROM public.customers c
     WHERE upper(regexp_replace(coalesce(c.pasaporte,''), '[^A-Za-z0-9]', '', 'g')) = v_doc
  ),
  ok AS (
    SELECT DISTINCT cand.id, cand.name
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
  SELECT ok.id, ok.name FROM ok WHERE (SELECT count(*) FROM ok) = 1;
END;
$function$;
