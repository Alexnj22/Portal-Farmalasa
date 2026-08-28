SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El QR para tomar con el teléfono deja de ser sólo de Personal
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nació el 27-ago para la foto del empleado y por eso exigía
-- `auth_can_edit_any(ARRAY['staff_list'])`. El pedido del usuario es que salga
-- «en cualquier lugar donde solicite documento a adjuntar»: bitácoras, bolsas,
-- facturación, sucursales, solicitudes. Con la guarda vieja, el QR habría
-- fallado para todo el que no sea Talento Humano — o sea, casi todos.
--
-- ── Por qué basta con tener sesión ─────────────────────────────────────────
--
-- Abrir una captura NO escribe en ninguna tabla de negocio. Lo único que
-- consigue es meter UNA imagen —cinco minutos, un solo uso— en un formulario
-- que la persona YA tiene abierto en su pantalla. Guardar ese formulario sigue
-- pidiendo el permiso del módulo, y ahí es donde está el riesgo real.
--
-- Pedir el permiso de editar personal para poder fotografiar una boleta es la
-- forma de [[feedback_una_verificacion_que_traba_la_accion_no_se_hace]]: la
-- regla es correcta pero está en el lugar equivocado, y el atajo que produce es
-- mandarse la foto por WhatsApp, que es exactamente lo que esto vino a evitar.
--
-- Se conserva todo lo demás: el secreto sigue siendo de 16 caracteres sin
-- letras confundibles, sigue viviendo cinco minutos, sigue quemándose al usarse
-- y abrir uno nuevo sigue matando los anteriores de esa misma persona — dos QR
-- vivos a la vez son dos llaves, y la vieja se queda en una pantalla que
-- alguien dejó abierta.
CREATE OR REPLACE FUNCTION public.abrir_captura_de_foto(p_employee_id uuid DEFAULT NULL::uuid)
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
    -- La única guarda: ser una persona con ficha y sesión. Ver el encabezado.
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

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
$function$;

REVOKE EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid) TO authenticated, service_role;
