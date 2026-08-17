SET lock_timeout = '5s';

-- ═══ La escotilla: identificarse con usuario y contraseña ══════════════════
--
-- Pedido del usuario (2026-08-17), después de ver la pantalla de escaneo:
-- «agregalo, que aparezca un botón que diga: autenticar por usuario».
--
-- Es la salida para el carné que no lee. Sin ella, un lector sucio o un carné
-- despegado dejan a la sala sin poder entregar el efectivo del día, y lo único
-- que queda es el papel escrito a mano — justo lo que este circuito vino a
-- reemplazar.
--
-- ── Sigue sin haber lista de personas ──────────────────────────────────────
-- El usuario ES el nombre de quien se identifica, igual que el carné: se
-- resuelve contra `employees.username` y la contraseña se comprueba contra su
-- cuenta. No se elige a nadie de un desplegable — esa era la parte que el
-- usuario mandó sacar, y no vuelve por esta puerta.
--
-- ── El freno cuenta contra ESA persona ─────────────────────────────────────
-- Acá sí hay un objetivo antes de comprobar el secreto: el usuario se resuelve
-- primero (no es un dato secreto) y recién después se prueba la contraseña. Lo
-- que hay que encarecer es adivinarle la clave a alguien en concreto, que es el
-- mismo criterio de `probar_identidad`. Con el carné no se puede hacer así
-- porque ahí el secreto y la identidad son la misma cadena.
--
-- ── Y devuelve json en vez de RAISE, por lo mismo ──────────────────────────
-- Un `RAISE` aborta la transacción y se lleva el INSERT del intento fallido, o
-- sea que el freno contaría sobre una tabla que nunca crece. Medido en prod:
-- `intentos_identidad` tenía 17 filas, las 17 de `CARNE_LOOKUP` —la única del
-- grupo que no lanza— y cero de `RETIRO`. Ver `probar_identidad_por_carne`.
--
-- La comprobación de la contraseña NO se escribe acá: la hace `verificar_persona`,
-- que es privada (sin EXECUTE para `authenticated`) justamente para que no exista
-- un oráculo público de contraseñas. Dos implementaciones del mismo bcrypt se
-- corrigen por separado.
--
-- Medido antes de escribirlo: los 49 empleados activos tienen username único y
-- los 49 resuelven a una cuenta con contraseña, así que la escotilla sirve para
-- todos y no sólo para los de oficina.
CREATE OR REPLACE FUNCTION public.probar_identidad_por_usuario(
    p_usuario text, p_secreto text)
 RETURNS json
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid   := (SELECT auth_employee_id());
    v_user   text   := lower(btrim(coalesce(p_usuario, '')));
    v_fallos integer;
    v_hit    uuid;
    v_ok     boolean;
    v_token  uuid;
    v_sala   bigint;
    v_emp    record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_user = '' OR coalesce(btrim(p_secreto), '') = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'Falta el usuario o la contrasena.');
    END IF;

    -- Quien se lleva el efectivo tiene que estar activo. No se exige que sea de
    -- ESA sala: quien recolecta suele ser de administracion, igual que con el
    -- carne y que en `entregar_bolsas`.
    SELECT e.id INTO v_hit
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.username, '')) <> ''
       AND lower(btrim(e.username)) = v_user
     LIMIT 1;

    IF v_hit IS NULL THEN
        INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
        VALUES (v_yo, 'RETIRO', NULL, 'CLAVE', false, (SELECT auth_employee_branch_id()));
        RETURN json_build_object('ok', false, 'motivo', 'Ese usuario no existe o no esta activo.');
    END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.objetivo = v_hit AND i.proposito = 'RETIRO'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    SELECT branch_id INTO v_sala FROM public.employees WHERE id = v_hit;

    IF v_fallos >= 5 THEN
        INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
        VALUES (v_yo, 'RETIRO', v_hit, 'CLAVE', false, v_sala);
        RETURN json_build_object('ok', false,
            'motivo', 'Se intento demasiadas veces sin acertar. Hay que esperar 15 minutos antes de volver a probar con esta persona.');
    END IF;

    v_ok := public.verificar_persona(v_hit, 'CLAVE', p_secreto);

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'RETIRO', v_hit, 'CLAVE', coalesce(v_ok, false), v_sala);

    IF NOT coalesce(v_ok, false) THEN
        RETURN json_build_object('ok', false, 'motivo', 'La contrasena no coincide.');
    END IF;

    INSERT INTO public.identidad_vales (employee_id, metodo, emitido_por)
    VALUES (v_hit, 'CLAVE', v_yo)
    RETURNING token INTO v_token;

    SELECT e.id, e.name, e.photo_url INTO v_emp
      FROM public.employees e WHERE e.id = v_hit;

    RETURN json_build_object(
        'ok', true,
        'vale', v_token,
        'employee', json_build_object('id', v_emp.id, 'name', v_emp.name, 'photo_url', v_emp.photo_url)
    );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.probar_identidad_por_usuario(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.probar_identidad_por_usuario(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.probar_identidad_por_usuario(text, text) IS
 'La escotilla del carne que no lee: resuelve a la persona por `employees.username`, comprueba la contrasena con `verificar_persona` y devuelve un vale de un solo uso valido 5 minutos. Freno de 5 fallos en 15 minutos contra ESA persona. Devuelve {ok:false,motivo} en vez de lanzar para que el intento fallido quede registrado.';
