-- La contraseña de una cuenta sólo cambia si alguien con permiso lo autorizó.
--
-- 2026-09-22: dos personas rompieron su carné cambiando «su» contraseña desde
-- una sesión abierta CON el carné — el cambio cayó en la cuenta del carné, cuya
-- clave tiene que ser su propio código. Se quitó el autoservicio de la
-- pantalla, pero Supabase sigue aceptando `PUT /auth/v1/user {password}` de
-- cualquier sesión válida. Esto lo cierra en la base.
--
-- El permiso vive en `raw_app_meta_data.cambio_de_clave`, que el usuario NO
-- puede escribir (sólo service_role). `raw_user_meta_data` no sirve: cada
-- quien reescribe el suyo con `updateUser({ data })`.
--
--   temporal       lo pone set-employee-password antes de fijar la temporal.
--                  Esa escritura lo baja a `primer_acceso`.
--   primer_acceso  la persona elige la suya en el login (cambio obligatorio).
--                  Esa escritura lo borra: no hay una segunda.
--   definitiva     una escritura y se borra (clave fijada por un
--                  administrador, carné de papel del día).
--
-- El permiso tiene que ponerse en una llamada APARTE y ANTES: en la misma,
-- Auth escribe la contraseña primero y este trigger todavía no lo vería.
--
-- Sólo se mira lo que llega por el servicio de Auth (`supabase_auth_admin`),
-- que es el único que habla con la API. Cualquier otro rol que llegue acá es
-- SQL de un dueño de la base: la purga nocturna de carnés de papel
-- (`apagar_cuenta_de_carne_temporal`, SECURITY DEFINER) y las reparaciones a
-- mano. Ningún rol de la API (`anon`, `authenticated`) puede tocar auth.users.
--
-- Probado en el branch de pruebas contra el Auth real: 16 casos.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guardia_cambio_de_contrasena()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public, extensions
AS $function$
DECLARE
    v_permiso text := OLD.raw_app_meta_data->>'cambio_de_clave';
BEGIN
    IF current_user <> 'supabase_auth_admin' THEN
        RETURN NEW;
    END IF;

    IF v_permiso = 'temporal' THEN
        NEW.raw_app_meta_data := coalesce(NEW.raw_app_meta_data, '{}'::jsonb)
                                 || jsonb_build_object('cambio_de_clave', 'primer_acceso');
    ELSIF v_permiso IN ('primer_acceso', 'definitiva') THEN
        NEW.raw_app_meta_data := NEW.raw_app_meta_data - 'cambio_de_clave';
    ELSE
        RAISE EXCEPTION 'CAMBIO_DE_CLAVE_NO_AUTORIZADO'
            USING ERRCODE = '42501',
                  HINT = 'La contraseña sólo la restablece alguien con permiso de editar personal.';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.guardia_cambio_de_contrasena() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.guardia_cambio_de_contrasena() TO supabase_auth_admin;

DROP TRIGGER IF EXISTS guardia_cambio_de_contrasena ON auth.users;
CREATE TRIGGER guardia_cambio_de_contrasena
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
    EXECUTE FUNCTION public.guardia_cambio_de_contrasena();
