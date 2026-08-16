-- Vincular una caja con un código corto (2026-08-16).
--
-- La instalación pedía copiar dos UUID a mano a un archivo de texto en la
-- computadora de la caja. Eso no se le pide a nadie en una farmacia: se
-- transcribe mal, y un carácter cambiado da un error que no dice cuál de los
-- dos está mal.
--
-- Ahora el portal muestra **un código de 8 letras** y en la caja se escribe
-- eso y nada más. El instalador lo canjea por las credenciales de verdad y
-- escribe el archivo solo.
--
-- Por qué un código corto es seguro acá: **vive 15 minutos y se usa una sola
-- vez**. El alfabeto son 32 caracteres sin los que se confunden al leerlos
-- (sin O, sin 0, sin I, sin 1), o sea 32^8 ≈ 1.1 billones de combinaciones para
-- un puñado de códigos vivos a la vez. Adivinar uno antes de que expire no es
-- un ataque realista; transcribir un UUID sí es un problema real.
SET lock_timeout = '5s';

ALTER TABLE public.impresion_dispositivos
    ADD COLUMN IF NOT EXISTS codigo_vinculacion text,
    ADD COLUMN IF NOT EXISTS vinculacion_expira timestamptz,
    ADD COLUMN IF NOT EXISTS vinculada_at timestamptz,
    ADD COLUMN IF NOT EXISTS equipo text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_impresion_codigo_vivo
    ON public.impresion_dispositivos(codigo_vinculacion)
    WHERE codigo_vinculacion IS NOT NULL;

-- La columna del código tampoco se publica: quien la viera podría vincular una
-- caja ajena. Se muestra sólo en la respuesta de la función que lo crea.
REVOKE ALL ON public.impresion_dispositivos FROM anon, authenticated;
GRANT SELECT (id, branch_id, nombre, equipo, impresora, activo, ultimo_latido,
              vinculada_at, vinculacion_expira, created_at, created_by)
    ON public.impresion_dispositivos TO authenticated;

-- ── El portal crea la caja y muestra su código ─────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_codigo_de_vinculacion(
    p_branch_id bigint, p_nombre text)
 RETURNS TABLE(id uuid, codigo text, expira timestamptz)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    -- Sin O/0/I/1: en un papel escrito a mano esos cuatro se leen igual, y el
    -- error aparecería recién al final de la instalación.
    v_abc  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_cod  text := '';
    v_dev  uuid;
    i      integer;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['impresion'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF p_branch_id IS NULL OR btrim(coalesce(p_nombre,'')) = '' THEN
        RAISE EXCEPTION 'Falta la sala o el nombre de la caja.';
    END IF;

    FOR i IN 1..8 LOOP
        v_cod := v_cod || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
    END LOOP;

    INSERT INTO public.impresion_dispositivos
        (branch_id, nombre, created_by, codigo_vinculacion, vinculacion_expira)
    VALUES (p_branch_id, btrim(p_nombre), (SELECT auth_employee_id()),
            v_cod, now() + interval '15 minutes')
    RETURNING impresion_dispositivos.id INTO v_dev;

    RETURN QUERY SELECT v_dev, v_cod, now() + interval '15 minutes';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_codigo_de_vinculacion(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_codigo_de_vinculacion(bigint, text) TO authenticated, service_role;

-- ── Y la caja lo canjea por sus credenciales ───────────────────────────────
--
-- Es la única función que un equipo sin sesión puede llamar sin tener todavía
-- un token: por eso el código se quema en el mismo momento (`codigo = NULL`) y
-- la fila queda marcada con cuándo y desde qué equipo se vinculó.
CREATE OR REPLACE FUNCTION public.canjear_codigo_de_vinculacion(
    p_codigo text, p_equipo text DEFAULT NULL, p_impresora text DEFAULT NULL)
 RETURNS TABLE(device_id uuid, device_token uuid, sala text, nombre text)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    d public.impresion_dispositivos;
BEGIN
    SELECT * INTO d FROM public.impresion_dispositivos x
     WHERE x.codigo_vinculacion = upper(btrim(coalesce(p_codigo,'')))
       AND btrim(coalesce(p_codigo,'')) <> ''
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese codigo no existe o ya se uso. Genera uno nuevo en el portal.';
    END IF;
    IF d.vinculacion_expira < now() THEN
        UPDATE public.impresion_dispositivos SET codigo_vinculacion = NULL WHERE id = d.id;
        RAISE EXCEPTION 'Ese codigo ya vencio. Genera uno nuevo en el portal.';
    END IF;

    UPDATE public.impresion_dispositivos
       SET codigo_vinculacion = NULL,
           vinculada_at = now(),
           equipo = nullif(btrim(coalesce(p_equipo,'')), ''),
           impresora = coalesce(nullif(btrim(coalesce(p_impresora,'')), ''), impresora)
     WHERE id = d.id
     RETURNING * INTO d;

    RETURN QUERY
    SELECT d.id, d.token,
           (SELECT b.name FROM public.branches b WHERE b.id = d.branch_id),
           d.nombre;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.canjear_codigo_de_vinculacion(text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.canjear_codigo_de_vinculacion(text, text, text) TO anon, authenticated, service_role;

-- Una caja que se creó y nunca se vinculó no debe poder imprimir ni contar como
-- «esta sala ya tiene caja»: si no, `encolar_impresion` daría por bueno un
-- destino que no existe y el papel se quedaría esperando para siempre.
CREATE OR REPLACE FUNCTION public.encolar_impresion(
    p_branch_id bigint, p_titulo text, p_contenido text)
 RETURNS bigint
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_id bigint; v_pendientes integer;
BEGIN
    IF (SELECT auth_employee_id()) IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Falta decir en que sala se imprime.'; END IF;
    IF p_contenido IS NULL OR btrim(p_contenido) = '' THEN
        RAISE EXCEPTION 'No hay nada que imprimir.';
    END IF;
    IF length(p_contenido) > 60000 THEN
        RAISE EXCEPTION 'Ese documento es demasiado largo para un rollo.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.impresion_dispositivos d
                    WHERE d.branch_id = p_branch_id AND d.activo
                      AND d.vinculada_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Esa sala no tiene una caja registrada para imprimir.';
    END IF;

    SELECT count(*) INTO v_pendientes FROM public.cola_impresion c
     WHERE c.branch_id = p_branch_id AND c.estado IN ('PENDIENTE','IMPRIMIENDO');
    IF v_pendientes >= 50 THEN
        RAISE EXCEPTION 'Esa caja tiene % documentos esperando: parece que la impresora no esta respondiendo.', v_pendientes;
    END IF;

    INSERT INTO public.cola_impresion (branch_id, titulo, contenido, creado_por)
    VALUES (p_branch_id, left(btrim(p_titulo), 120), p_contenido, (SELECT auth_employee_id()))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.encolar_impresion(bigint, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.encolar_impresion(bigint, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.canjear_codigo_de_vinculacion(text, text, text) IS
 'La caja cambia un codigo de 8 letras por sus credenciales. Se quema al usarse y vive 15 minutos: es lo unico que un equipo sin token puede llamar.';
