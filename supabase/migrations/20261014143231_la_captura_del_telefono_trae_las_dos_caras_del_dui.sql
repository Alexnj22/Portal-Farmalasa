-- La captura del teléfono también trae las DOS caras del DUI de una vez.
--
-- Pedido del usuario el 2026-10-13: «al subir el DUI desde el teléfono, que
-- pregunte si es el frente o reverso, que se pueda subir de un solo ambos, y no
-- 1 y 1». Con `modo = 'dui'` el teléfono pide cada cara con su nombre y las
-- manda unidas en UNA imagen por `guardar_foto_de_captura` (la misma de la
-- foto), así que no hace falta otra función: sólo que el modo exista.
SET lock_timeout = '5s';

ALTER TABLE public.capturas_de_foto DROP CONSTRAINT IF EXISTS capturas_de_foto_modo_check;
ALTER TABLE public.capturas_de_foto
    ADD CONSTRAINT capturas_de_foto_modo_check CHECK (modo IN ('foto', 'qr', 'dui'));

CREATE OR REPLACE FUNCTION public.abrir_captura_de_foto(p_employee_id uuid DEFAULT NULL::uuid, p_modo text DEFAULT 'foto')
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin 0/O ni 1/I/L: el secreto puede terminar leyéndose de un registro, y
    -- confundir esas letras cuesta una investigación. Mismo alfabeto que el
    -- carné temporal.
    c_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    c_largo    constant int  := 16;
    v_yo      uuid := (SELECT auth_employee_id());
    v_bytes   bytea;
    v_secreto text := '';
    v_id      uuid;
    i         int;
BEGIN
    -- La única guarda: ser una persona con ficha y sesión.
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF coalesce(p_modo, 'foto') NOT IN ('foto', 'qr', 'dui') THEN RAISE EXCEPTION 'MODO_INVALIDO'; END IF;

    v_bytes := extensions.gen_random_bytes(c_largo);
    FOR i IN 1..c_largo LOOP
        v_secreto := v_secreto || substr(c_alfabeto, 1 + (get_byte(v_bytes, i - 1) % length(c_alfabeto)), 1);
    END LOOP;

    -- Las capturas anteriores de esta persona mueren: dos QR vivos a la vez son
    -- dos llaves, y la vieja se queda en una pantalla que alguien dejó abierta.
    UPDATE public.capturas_de_foto
       SET usada_el = now()
     WHERE solicitada_por = v_yo AND usada_el IS NULL AND vence_el > now();

    INSERT INTO public.capturas_de_foto (secreto_hash, solicitada_por, employee_id, vence_el, modo)
    VALUES (encode(extensions.digest(v_secreto, 'sha256'), 'hex'), v_yo, p_employee_id,
            now() + interval '5 minutes', coalesce(p_modo, 'foto'))
    RETURNING id INTO v_id;

    RETURN json_build_object('ok', true, 'id', v_id, 'secreto', v_secreto,
                             'vence_el', (now() + interval '5 minutes'));
END;
$function$;
