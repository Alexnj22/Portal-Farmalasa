-- El pre-registro de la app trae datos que la ficha no tiene (2026-11-16).
--
-- Una persona llena el alta de la app: nombre, documento, teléfono, correo y
-- fecha de nacimiento. Cuando el pre-registro se vincula a la ficha que ya
-- existía (solo, en `app-clientes`, o a mano con `app_preregistro_resolver`),
-- sólo se guardaba el enlace: el correo y el nacimiento se quedaban en
-- `app_cliente_preregistros` y la ficha seguía vacía. Caso que lo destapó: la
-- ficha 11447, vinculada hoy, sin correo ni nacimiento — o sea sin puntos de
-- cumpleaños — teniendo ambos datos a un join de distancia.
--
-- Reglas:
--  1. Se COMPLETA, nunca se pisa: sólo se escribe un campo vacío de la ficha.
--     Si la ficha ya tiene otro correo, el de la app va a la libreta de correos
--     de la persona (`app_cliente_correos`), donde la app ya lo ofrece para
--     mandar facturas. Nada se tira.
--  2. Sólo si el TELÉFONO del pre-registro es de la ficha. Es la misma prueba
--     que usa `app_preregistro_resolver` para dejar que la sesión herede la
--     cuenta: con documento solo, nadie demostró ser el dueño, y no se le
--     escribe la ficha a otro.
--  3. El correo viaja también al sistema de origen: se anota en
--     `customers_changelog` como cualquier edición del portal, así el cron de
--     `push-cliente-erp` lo empuja y `aplicar_espejo_erp` no lo borra con el
--     valor vacío de allá mientras esté pendiente.
--  4. El nacimiento NO se anota en el changelog: el empuje no tiene ese campo
--     (sólo existe en el alta) y la entrada volvería a la cola en cada pasada,
--     la trampa de `notes`. El espejo tampoco lo toca, así que no hace falta
--     protegerlo. Igual que `clientes_anotar_nacimiento`: sólo si está vacío.
--
-- Se dispara al pasar a `vinculado`, así cubre los dos caminos sin tocar la
-- edge function.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_preregistro_completar_ficha(p_pre uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pre   public.app_cliente_preregistros%ROWTYPE;
  v_cli   public.customers%ROWTYPE;
  v_tel   text;
  v_mail  text;
  v_correo text := 'sin_dato';
  v_nac    text := 'sin_dato';
BEGIN
  SELECT * INTO v_pre FROM public.app_cliente_preregistros WHERE id = p_pre;
  IF NOT FOUND OR v_pre.estado <> 'vinculado' OR v_pre.customer_id IS NULL THEN
    RETURN json_build_object('ok', false, 'motivo', 'no_vinculado');
  END IF;

  SELECT * INTO v_cli FROM public.customers WHERE id = v_pre.customer_id FOR UPDATE;
  IF NOT FOUND OR v_cli.anonimizada_at IS NOT NULL OR v_cli.deshabilitada_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'motivo', 'ficha_no_disponible');
  END IF;

  -- Regla 2: el teléfono del pre-registro tiene que ser de la ficha.
  v_tel := right(regexp_replace(coalesce(v_pre.telefono, ''), '\D', '', 'g'), 8);
  IF length(v_tel) <> 8 OR v_tel NOT IN (
       right(regexp_replace(coalesce(v_cli.phone, ''), '\D', '', 'g'), 8),
       right(regexp_replace(coalesce(v_cli.telefono2, ''), '\D', '', 'g'), 8)) THEN
    RETURN json_build_object('ok', false, 'motivo', 'telefono_no_coincide');
  END IF;

  -- Correo.
  v_mail := lower(btrim(coalesce(v_pre.email, '')));
  IF v_mail ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' AND length(v_mail) <= 254 THEN
    IF nullif(btrim(coalesce(v_cli.email, '')), '') IS NULL THEN
      UPDATE public.customers SET email = v_mail, updated_at = now() WHERE id = v_cli.id;
      INSERT INTO public.customers_changelog
        (customer_id, campo, valor_anterior, valor_nuevo, changed_by, changed_by_nombre)
      VALUES (v_cli.id, 'email', v_cli.email, v_mail, NULL, 'App de clientes (alta)');
      v_correo := 'ficha';
    ELSIF lower(btrim(v_cli.email)) = v_mail THEN
      v_correo := 'ya_estaba';
    ELSE
      INSERT INTO public.app_cliente_correos (customer_id, correo)
      SELECT v_cli.id, v_mail
      WHERE NOT EXISTS (SELECT 1 FROM public.app_cliente_correos
                        WHERE customer_id = v_cli.id AND correo = v_mail);
      v_correo := 'libreta';
    END IF;
  END IF;

  -- Nacimiento.
  IF v_pre.fecha_nacimiento IS NOT NULL THEN
    IF v_cli.fecha_nacimiento IS NULL THEN
      UPDATE public.customers SET fecha_nacimiento = v_pre.fecha_nacimiento, updated_at = now()
       WHERE id = v_cli.id;
      v_nac := 'ficha';
    ELSE
      v_nac := 'ya_tenia';
    END IF;
  END IF;

  IF v_correo IN ('ficha', 'libreta') OR v_nac = 'ficha' THEN
    INSERT INTO public.audit_logs (user_id, user_name, action, target_id, details)
    VALUES (NULL, 'App de clientes', 'app_preregistro_completar_ficha', v_cli.id::text,
            jsonb_build_object('preregistro_id', p_pre, 'customer_id', v_cli.id,
                               'correo', v_correo, 'nacimiento', v_nac));
  END IF;

  RETURN json_build_object('ok', true, 'customer_id', v_cli.id, 'correo', v_correo, 'nacimiento', v_nac);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_preregistro_completar_ficha(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_preregistro_completar_ficha(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.app_preregistro_al_vincular()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Completar la ficha nunca puede tumbar la vinculación: si falla, se avisa
  -- en el log de Postgres y la persona entra igual.
  BEGIN
    PERFORM public.app_preregistro_completar_ficha(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_preregistro_completar_ficha(%) falló: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_preregistro_al_vincular() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_preregistro_al_vincular ON public.app_cliente_preregistros;
CREATE TRIGGER app_preregistro_al_vincular
  AFTER UPDATE OF estado, customer_id ON public.app_cliente_preregistros
  FOR EACH ROW
  WHEN (NEW.estado = 'vinculado' AND NEW.customer_id IS NOT NULL
        AND (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.customer_id IS DISTINCT FROM NEW.customer_id))
  EXECUTE FUNCTION public.app_preregistro_al_vincular();

-- Lo ya vinculado antes de hoy.
SELECT public.app_preregistro_completar_ficha(id)
  FROM public.app_cliente_preregistros
 WHERE estado = 'vinculado' AND customer_id IS NOT NULL;
