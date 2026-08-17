SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- El carné IMPRESO lleva el PIN de 8 caracteres, NO el código de empleado.
--
-- Está medido y escrito desde el 2026-08-14 en `useTimeClockEngine.js`: «medido
-- sobre los 46 carnés con PIN, CERO coinciden con su código». `kiosco_identificar`
-- ya lo resuelve así —PIN primero, código después—, pero las dos funciones de
-- abajo se quedaron comparando SÓLO el código, y por eso ninguna reconoció nunca
-- un carné real:
--
--   · `identificar_por_carne` (apoyo de un pedido): 16 escaneos el 2026-08-17,
--     CERO reconocidos, todos de Bodega. Ensayado contra prod: con el código,
--     0 de los 6 de Bodega se encuentran a sí mismos; con el PIN, 6 de 6.
--   · `verificar_persona` con método CARNE (prueba de identidad para retirar
--     efectivo): mismo defecto, todavía sin usar en producción.
--
-- El orden PIN → código es el mismo de `kiosco_identificar` y el motivo también:
-- el PIN son 8 alfanuméricos (espacio grande, y es lo que se escanea), el código
-- son 3 a 5 dígitos y va segundo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.identificar_por_carne(p_valor text)
 RETURNS TABLE(id uuid, name text, first_names text, last_names text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_sala   bigint := (SELECT auth_employee_branch_id());
    -- Igual que `kiosco_identificar`: se limpian TODOS los espacios, no sólo
    -- las puntas — un lector puede meter uno en medio y `btrim` no lo ve.
    v_limpio text := upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g'));
    v_fallos integer;
    v_hit    uuid;
    v_metodo text := NULL;
BEGIN
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    -- Sin sucursal no hay a quién comparar y la búsqueda devolvería «no lo
    -- encuentro» para siempre: se dice lo que pasa en vez de callar.
    IF v_sala IS NULL THEN
        RAISE EXCEPTION 'Tu ficha no tiene sucursal asignada: pide que te asignen una para poder confirmar carnes.';
    END IF;
    IF v_limpio = '' THEN RETURN; END IF;

    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.quien = v_yo AND i.proposito = 'CARNE_LOOKUP'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 20 THEN
        RAISE EXCEPTION 'Demasiados carnes sin reconocer seguidos. Espera unos minutos.';
    END IF;

    -- Primero el PIN del carné, después el código. `kiosco_cubre_empleado` es
    -- la MISMA definición de «esta persona trabaja en esta sucursal» que usa el
    -- kiosco: su sucursal, sus sucursales adicionales, o una cobertura de
    -- horario de los últimos 7 días.
    SELECT e.id, 'CARNE' INTO v_hit, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
       AND public.kiosco_cubre_empleado(e.id, v_sala)
     LIMIT 1;

    IF v_hit IS NULL THEN
        SELECT e.id, 'CODIGO' INTO v_hit, v_metodo
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND btrim(coalesce(e.code, '')) <> ''
           AND upper(btrim(e.code)) = v_limpio
           AND public.kiosco_cubre_empleado(e.id, v_sala)
         LIMIT 1;
    END IF;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'CARNE_LOOKUP', v_hit, coalesce(v_metodo, 'DESCONOCIDO'), v_hit IS NOT NULL, v_sala);

    RETURN QUERY
    SELECT e.id, e.name, e.first_names, e.last_names, e.photo_url
      FROM public.employees e WHERE e.id = v_hit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.identificar_por_carne(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.identificar_por_carne(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.verificar_persona(p_employee_id uuid, p_metodo text, p_secreto text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
    v_ok     boolean := false;
    v_limpio text    := upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g'));
BEGIN
    IF p_employee_id IS NULL OR v_limpio = '' THEN
        RETURN false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.employees e
                    WHERE e.id = p_employee_id AND e.status = 'ACTIVO') THEN
        RETURN false;
    END IF;

    IF p_metodo = 'CARNE' THEN
        -- El PIN es lo que trae el carné impreso; el código se acepta también
        -- porque este campo se puede teclear.
        SELECT true INTO v_ok FROM public.employees e
         WHERE e.id = p_employee_id
           AND (
                (btrim(coalesce(e.kiosk_pin, '')) <> '' AND upper(btrim(e.kiosk_pin)) = v_limpio)
             OR (btrim(coalesce(e.code, ''))      <> '' AND upper(btrim(e.code))      = v_limpio)
           );
        RETURN coalesce(v_ok, false);
    END IF;

    IF p_metodo = 'CLAVE' THEN
        -- La contraseña NO se normaliza: sus espacios y sus mayúsculas son
        -- parte del secreto.
        SELECT true INTO v_ok
          FROM auth.users u
         WHERE u.encrypted_password IS NOT NULL
           AND u.encrypted_password = extensions.crypt(p_secreto, u.encrypted_password)
           AND (u.id = p_employee_id
                OR u.id IN (SELECT l.auth_user_id FROM public.employee_auth_accounts l
                             WHERE l.employee_id = p_employee_id))
         LIMIT 1;
        RETURN coalesce(v_ok, false);
    END IF;

    RETURN false;
END;
$function$;

-- `authenticated` NO va en esta lista, y no es un olvido: esta función dice
-- «sí» o «no» a un secreto, o sea que expuesta es un oráculo para probar carnés
-- y contraseñas de a uno. Se llega a ella sólo por `probar_identidad`, que es
-- la que registra el intento y aplica el freno. Se repite el estado actual tal
-- cual para que quede escrito.
REVOKE EXECUTE ON FUNCTION public.verificar_persona(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verificar_persona(uuid, text, text) TO service_role;
