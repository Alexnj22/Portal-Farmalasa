-- El traspaso del teléfono también trae el TEXTO de un QR, no sólo una foto.
--
-- Pedido del usuario el 2026-10-13, sobre el carné digital de dependiente:
-- «que permita también desde el teléfono escanear el qr para guardar el enlace
-- … la foto no me sirve, debe ser el enlace / qr». Hasta hoy «Con el teléfono»
-- traía una FOTO y la computadora intentaba leer el QR en ella; una foto
-- reducida a 1600 px de un QR en una pantalla casi nunca se lee.
--
-- Con `modo = 'qr'` el teléfono abre el lector en vivo y entrega lo que leyó.
-- Mismo secreto de cinco minutos y un solo uso; la computadora valida el texto
-- igual que cuando se pega el enlace a mano.
SET lock_timeout = '5s';

ALTER TABLE public.capturas_de_foto
    ADD COLUMN IF NOT EXISTS modo  text NOT NULL DEFAULT 'foto',
    ADD COLUMN IF NOT EXISTS texto text;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capturas_de_foto_modo_check') THEN
        ALTER TABLE public.capturas_de_foto
            ADD CONSTRAINT capturas_de_foto_modo_check CHECK (modo IN ('foto', 'qr'));
    END IF;
    -- Un QR no pasa de unos cientos de caracteres; el tope evita que el canal
    -- sin sesión sirva para guardar cualquier cosa.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capturas_de_foto_texto_check') THEN
        ALTER TABLE public.capturas_de_foto
            ADD CONSTRAINT capturas_de_foto_texto_check CHECK (texto IS NULL OR length(texto) <= 1000);
    END IF;
END $$;

-- La firma cambia (se agrega `p_modo`): la vieja se borra para que no quede
-- una sobrecarga con sus propios permisos.
DROP FUNCTION IF EXISTS public.abrir_captura_de_foto(uuid);

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
    IF coalesce(p_modo, 'foto') NOT IN ('foto', 'qr') THEN RAISE EXCEPTION 'MODO_INVALIDO'; END IF;

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

REVOKE EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid, text) TO authenticated, service_role;

-- El teléfono necesita saber si toma una foto o abre el lector: el modo viaja
-- en la respuesta. Sigue sin devolver nada del expediente salvo el nombre.
CREATE OR REPLACE FUNCTION public.captura_de_foto_vigente(p_secreto text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT coalesce(
      (SELECT json_build_object('ok', true, 'id', c.id, 'para', e.name, 'modo', c.modo)
         FROM public.capturas_de_foto c
         LEFT JOIN public.employees e ON e.id = c.employee_id
        WHERE c.secreto_hash = encode(extensions.digest(
                  upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g')), 'sha256'), 'hex')
          AND c.usada_el IS NULL
          AND c.vence_el > now()
        LIMIT 1),
      json_build_object('ok', false));
$function$;

-- Gemela de `guardar_foto_de_captura`: deja el texto y quema el código en un
-- solo acto. Sólo para capturas abiertas en modo 'qr' — una captura de foto no
-- puede recibir texto, ni al revés por esta vía.
CREATE OR REPLACE FUNCTION public.guardar_texto_de_captura(p_secreto text, p_texto text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id uuid;
BEGIN
    IF coalesce(btrim(p_texto), '') = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'Sin código.');
    END IF;
    IF length(p_texto) > 1000 THEN
        RETURN json_build_object('ok', false, 'motivo', 'Ese código es demasiado largo.');
    END IF;

    UPDATE public.capturas_de_foto
       SET usada_el = now(), texto = btrim(p_texto)
     WHERE secreto_hash = encode(extensions.digest(
               upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g')), 'sha256'), 'hex')
       AND modo = 'qr'
       AND usada_el IS NULL
       AND vence_el > now()
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'Ese código ya se usó o venció.');
    END IF;
    RETURN json_build_object('ok', true, 'id', v_id);
END;
$function$;

-- Sin sesión a propósito, igual que su gemela: el teléfono que escanea puede no
-- tener el portal abierto. La llave es el secreto. Declarada en
-- auditoria/superficie-anon.json.
REVOKE EXECUTE ON FUNCTION public.guardar_texto_de_captura(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_texto_de_captura(text, text) TO anon, authenticated, service_role;
