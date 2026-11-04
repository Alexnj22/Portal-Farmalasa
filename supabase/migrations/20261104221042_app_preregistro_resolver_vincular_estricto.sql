-- app_preregistro_resolver: «vincular» deja de regalar la cuenta (auditoría 2026-11-04, ALTO)
--
-- Antes: el documento del pre-registro se buscaba con `position()` dentro de
-- `concat_ws('|', dui, nit, pasaporte)` — o sea, como SUBCADENA (un documento
-- corto coincidía dentro de un NIT ajeno) — y después TODAS las sesiones del
-- pre-registro pasaban a la ficha. Quien se pre-registraba con el DUI de otra
-- persona y SU propio teléfono quedaba, al vincular la sala, dentro de la
-- cuenta completa de la víctima.
--
-- Ahora:
--   1. El documento coincide por IGUALDAD de campo (normalizado: sólo letras y
--      dígitos, en mayúsculas) contra dui, nit o pasaporte.
--   2. Las sesiones sólo se mueven a la ficha si el teléfono del pre-registro
--      es uno de los de la ficha (phone o telefono2, últimos 8 dígitos). Si no
--      coincide, se REVOCAN: la persona vuelve a entrar con su DUI y el
--      teléfono de su ficha, que es la prueba que la app pide a todos.
--
-- Partió de pg_get_functiondef vivo (2026-11-04). Firma, SECURITY DEFINER,
-- search_path y GRANTs iguales. Probado en el branch de pruebas con
-- execute_sql (mismo DUI y teléfono → pasa; otro teléfono → revoca; DUI dentro
-- del NIT → DOCUMENTO_NO_COINCIDE). Sin DDL sobre tablas calientes.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_preregistro_resolver(p_id uuid, p_accion text, p_customer_id bigint DEFAULT NULL::bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_pre public.app_cliente_preregistros%ROWTYPE;
    v_doc text;
    v_coincide boolean;
    v_tel_pre text;
    v_tel_ok boolean := false;
    v_revocadas integer := 0;
BEGIN
    IF NOT (SELECT public.auth_has_module_permission('clientes', 'can_edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_pre FROM public.app_cliente_preregistros WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NO_EXISTE'; END IF;
    IF v_pre.estado <> 'pendiente' THEN RAISE EXCEPTION 'YA_RESUELTO'; END IF;

    IF p_accion = 'descartar' THEN
        UPDATE public.app_cliente_preregistros
           SET estado = 'descartado', resuelto_at = now(), resuelto_por = public.auth_employee_id()
         WHERE id = p_id;
        UPDATE public.app_cliente_sesiones SET revocada_at = now()
         WHERE preregistro_id = p_id AND revocada_at IS NULL;
    ELSIF p_accion = 'vincular' THEN
        v_doc := upper(regexp_replace(coalesce(v_pre.documento, ''), '[^A-Za-z0-9]', '', 'g'));
        v_tel_pre := right(regexp_replace(coalesce(v_pre.telefono, ''), '\D', '', 'g'), 8);

        SELECT v_doc <> '' AND (
                   upper(regexp_replace(coalesce(c.dui, ''), '[^A-Za-z0-9]', '', 'g')) = v_doc
                OR upper(regexp_replace(coalesce(c.nit, ''), '[^A-Za-z0-9]', '', 'g')) = v_doc
                OR upper(regexp_replace(coalesce(c.pasaporte, ''), '[^A-Za-z0-9]', '', 'g')) = v_doc),
               length(v_tel_pre) = 8 AND v_tel_pre IN (
                   right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 8),
                   right(regexp_replace(coalesce(c.telefono2, ''), '\D', '', 'g'), 8))
          INTO v_coincide, v_tel_ok
          FROM public.customers c WHERE c.id = p_customer_id;
        IF NOT coalesce(v_coincide, false) THEN
            RAISE EXCEPTION 'DOCUMENTO_NO_COINCIDE';
        END IF;
        v_tel_ok := coalesce(v_tel_ok, false);

        UPDATE public.app_cliente_preregistros
           SET estado = 'vinculado', customer_id = p_customer_id,
               resuelto_at = now(), resuelto_por = public.auth_employee_id()
         WHERE id = p_id;

        IF v_tel_ok THEN
            -- Mismo documento Y mismo teléfono: es la misma persona.
            UPDATE public.app_cliente_sesiones SET customer_id = p_customer_id
             WHERE preregistro_id = p_id AND revocada_at IS NULL;
        ELSE
            -- El teléfono no es de la ficha: nadie demostró ser su dueño.
            -- La sesión no hereda la cuenta; se cierra.
            UPDATE public.app_cliente_sesiones SET revocada_at = now(), push_token = NULL
             WHERE preregistro_id = p_id AND revocada_at IS NULL;
            GET DIAGNOSTICS v_revocadas = ROW_COUNT;
        END IF;
    ELSE
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    INSERT INTO public.audit_logs (user_id, action, target_id, details)
    VALUES (public.auth_employee_id(), 'app_preregistro_' || p_accion, p_id::text,
            jsonb_build_object('preregistro_id', p_id, 'customer_id', p_customer_id,
                               'telefono_coincide', CASE WHEN p_accion = 'vincular' THEN v_tel_ok END,
                               'sesiones_revocadas', v_revocadas));
    RETURN json_build_object('ok', true, 'telefono_coincide', CASE WHEN p_accion = 'vincular' THEN v_tel_ok END,
                             'sesiones_revocadas', v_revocadas);
END;
$function$;
