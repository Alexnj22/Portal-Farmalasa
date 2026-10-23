-- La captura del teléfono trae las dos caras de CUALQUIER documento de dos
-- caras, no sólo del DUI.
--
-- Pedido del usuario el 2026-10-23: las licencias, los carnés de junta
-- (SRS, Enfermería, Médico, Contaduría) y las tarjetas de ISSS y AFP se
-- subían desde la computadora con DOS códigos QR —uno por cara— mientras el
-- DUI pedía uno solo. Con `modo = 'dos_caras'` el teléfono pide frente y
-- reverso con el nombre del documento (`documento`, lo escribe quien abre la
-- captura) y las manda unidas en una imagen, igual que el DUI.
--
-- La firma de `abrir_captura_de_foto` cambia (tercer parámetro), así que se
-- borra la vieja en vez de dejarla como sobrecarga: una sobrecarga vieja se
-- queda con sus permisos y nadie la vuelve a mirar.
SET lock_timeout = '5s';

ALTER TABLE public.capturas_de_foto ADD COLUMN IF NOT EXISTS documento text;
ALTER TABLE public.capturas_de_foto DROP CONSTRAINT IF EXISTS capturas_de_foto_modo_check;
ALTER TABLE public.capturas_de_foto
    ADD CONSTRAINT capturas_de_foto_modo_check CHECK (modo IN ('foto', 'qr', 'dui', 'dos_caras'));

DROP FUNCTION IF EXISTS public.abrir_captura_de_foto(uuid, text);

CREATE FUNCTION public.abrir_captura_de_foto(p_employee_id uuid DEFAULT NULL::uuid, p_modo text DEFAULT 'foto', p_documento text DEFAULT NULL)
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
    IF coalesce(p_modo, 'foto') NOT IN ('foto', 'qr', 'dui', 'dos_caras') THEN RAISE EXCEPTION 'MODO_INVALIDO'; END IF;

    v_bytes := extensions.gen_random_bytes(c_largo);
    FOR i IN 1..c_largo LOOP
        v_secreto := v_secreto || substr(c_alfabeto, 1 + (get_byte(v_bytes, i - 1) % length(c_alfabeto)), 1);
    END LOOP;

    -- Las capturas anteriores de esta persona mueren: dos QR vivos a la vez son
    -- dos llaves, y la vieja se queda en una pantalla que alguien dejó abierta.
    UPDATE public.capturas_de_foto
       SET usada_el = now()
     WHERE solicitada_por = v_yo AND usada_el IS NULL AND vence_el > now();

    -- `documento` es sólo el rótulo que el teléfono muestra; se acota para que
    -- la pantalla pública no pinte un texto arbitrario de cualquier largo.
    INSERT INTO public.capturas_de_foto (secreto_hash, solicitada_por, employee_id, vence_el, modo, documento)
    VALUES (encode(extensions.digest(v_secreto, 'sha256'), 'hex'), v_yo, p_employee_id,
            now() + interval '5 minutes', coalesce(p_modo, 'foto'),
            nullif(left(btrim(coalesce(p_documento, '')), 80), ''))
    RETURNING id INTO v_id;

    RETURN json_build_object('ok', true, 'id', v_id, 'secreto', v_secreto,
                             'vence_el', (now() + interval '5 minutes'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.captura_de_foto_vigente(p_secreto text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT coalesce(
      (SELECT json_build_object('ok', true, 'id', c.id, 'para', e.name, 'modo', c.modo, 'documento', c.documento)
         FROM public.capturas_de_foto c
         LEFT JOIN public.employees e ON e.id = c.employee_id
        WHERE c.secreto_hash = encode(extensions.digest(
                  upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g')), 'sha256'), 'hex')
          AND c.usada_el IS NULL
          AND c.vence_el > now()
        LIMIT 1),
      json_build_object('ok', false));
$function$;
