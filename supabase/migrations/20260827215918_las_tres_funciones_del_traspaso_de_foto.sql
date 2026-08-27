SET lock_timeout = '5s';

-- 1 · ABRIR — sólo quien ya puede editar personal.
CREATE OR REPLACE FUNCTION public.abrir_captura_de_foto(p_employee_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF NOT (SELECT auth_can_edit_any(ARRAY['staff_list'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    v_bytes := extensions.gen_random_bytes(c_largo);
    FOR i IN 1..c_largo LOOP
        v_secreto := v_secreto || substr(c_alfabeto, 1 + (get_byte(v_bytes, i - 1) % length(c_alfabeto)), 1);
    END LOOP;

    -- Las capturas anteriores de esta persona mueren: dos QR vivos a la vez son
    -- dos llaves, y la vieja se queda en una pantalla que alguien dejó abierta.
    UPDATE public.capturas_de_foto
       SET usada_el = now()
     WHERE solicitada_por = v_yo AND usada_el IS NULL AND vence_el > now();

    INSERT INTO public.capturas_de_foto (secreto_hash, solicitada_por, employee_id, vence_el)
    VALUES (encode(extensions.digest(v_secreto, 'sha256'), 'hex'), v_yo, p_employee_id,
            now() + interval '5 minutes')
    RETURNING id INTO v_id;

    RETURN json_build_object('ok', true, 'id', v_id, 'secreto', v_secreto,
                             'vence_el', (now() + interval '5 minutes'));
END;
$$;

-- 2 · RESOLVER — la abre el teléfono, sin sesión. Sólo dice si sirve; no
--     devuelve nada del expediente.
CREATE OR REPLACE FUNCTION public.captura_de_foto_vigente(p_secreto text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
    SELECT coalesce(
      (SELECT json_build_object('ok', true, 'id', c.id, 'para', e.name)
         FROM public.capturas_de_foto c
         LEFT JOIN public.employees e ON e.id = c.employee_id
        WHERE c.secreto_hash = encode(extensions.digest(
                  upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g')), 'sha256'), 'hex')
          AND c.usada_el IS NULL
          AND c.vence_el > now()
        LIMIT 1),
      json_build_object('ok', false));
$$;

-- 3 · GUARDAR — el teléfono deja la foto y quema el secreto, en un solo acto.
--     El `usada_el IS NULL` dentro del UPDATE es lo que lo vuelve de un solo
--     uso: dos teléfonos con el mismo QR, sólo el primero escribe.
CREATE OR REPLACE FUNCTION public.guardar_foto_de_captura(p_secreto text, p_url text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
    IF coalesce(btrim(p_url), '') = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'Sin foto.');
    END IF;

    UPDATE public.capturas_de_foto
       SET usada_el = now(), foto_url = p_url
     WHERE secreto_hash = encode(extensions.digest(
               upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g')), 'sha256'), 'hex')
       AND usada_el IS NULL
       AND vence_el > now()
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'Ese código ya se usó o venció.');
    END IF;
    RETURN json_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid) TO authenticated, service_role;

-- Estas dos SÍ las alcanza `anon`: las llama el teléfono sin sesión, y su
-- guarda es el secreto del QR. Declaradas en auditoria/superficie-anon.json.
REVOKE EXECUTE ON FUNCTION public.captura_de_foto_vigente(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.captura_de_foto_vigente(text) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.guardar_foto_de_captura(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.guardar_foto_de_captura(text, text) TO anon, authenticated, service_role;

-- Para que la computadora se entere sola de que la foto llegó.
ALTER PUBLICATION supabase_realtime ADD TABLE public.capturas_de_foto;
