-- La captura dice QUÉ pide y CUÁNTAS acepta (2026-11-17).
--
-- Hasta hoy la computadora sólo le decía al teléfono el `modo` (foto, qr, dui,
-- dos_caras), y en `foto` el teléfono trataba todo como un documento de varias
-- hojas: el retrato del empleado entraba al editor de documentos, las fotos
-- libres (marketing, bitácoras, bolsas) se recortaban como papel, y donde sólo
-- cabe UNA imagen el teléfono dejaba juntar varias en un PDF que la
-- computadora rechazaba con el código ya gastado.
--
--   clase  : 'documento' (editor/escáner de papel) · 'retrato' · 'libre'
--   forma  : la forma del papel para el editor (`DOCS` de fotoDocumento.js)
--   varias : si acepta varias hojas (llegan como un PDF)
--
-- Los defaults son el comportamiento de hoy: una computadora vieja que no
-- manda los parámetros nuevos sigue igual.
SET lock_timeout = '5s';

ALTER TABLE public.capturas_de_foto
    ADD COLUMN IF NOT EXISTS clase  text    NOT NULL DEFAULT 'documento',
    ADD COLUMN IF NOT EXISTS forma  text,
    ADD COLUMN IF NOT EXISTS varias boolean NOT NULL DEFAULT true;

ALTER TABLE public.capturas_de_foto
    DROP CONSTRAINT IF EXISTS capturas_de_foto_clase_check,
    ADD CONSTRAINT capturas_de_foto_clase_check CHECK (clase IN ('documento', 'retrato', 'libre')),
    DROP CONSTRAINT IF EXISTS capturas_de_foto_forma_check,
    ADD CONSTRAINT capturas_de_foto_forma_check CHECK (forma IS NULL OR forma ~ '^[a-z_]{1,20}$');

-- La firma cambia: la vieja se borra para que no quede una sobrecarga con sus
-- propios permisos (regla 4 de la estructura de la base).
DROP FUNCTION IF EXISTS public.abrir_captura_de_foto(uuid, text, text);

CREATE FUNCTION public.abrir_captura_de_foto(
    p_employee_id uuid DEFAULT NULL::uuid,
    p_modo text DEFAULT 'foto'::text,
    p_documento text DEFAULT NULL::text,
    p_clase text DEFAULT 'documento'::text,
    p_forma text DEFAULT NULL::text,
    p_varias boolean DEFAULT true)
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
    v_clase   text := coalesce(p_clase, 'documento');
    v_forma   text := nullif(lower(btrim(coalesce(p_forma, ''))), '');
    i         int;
BEGIN
    -- La única guarda: ser una persona con ficha y sesión.
    IF v_yo IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF coalesce(p_modo, 'foto') NOT IN ('foto', 'qr', 'dui', 'dos_caras') THEN RAISE EXCEPTION 'MODO_INVALIDO'; END IF;
    IF v_clase NOT IN ('documento', 'retrato', 'libre') THEN RAISE EXCEPTION 'CLASE_INVALIDA'; END IF;
    -- Una forma que no se reconoce no frena la captura: el teléfono cae al
    -- recuadro genérico.
    IF v_forma IS NOT NULL AND v_forma !~ '^[a-z_]{1,20}$' THEN v_forma := NULL; END IF;

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
    INSERT INTO public.capturas_de_foto (secreto_hash, solicitada_por, employee_id, vence_el, modo, documento,
                                         clase, forma, varias)
    VALUES (encode(extensions.digest(v_secreto, 'sha256'), 'hex'), v_yo, p_employee_id,
            now() + interval '5 minutes', coalesce(p_modo, 'foto'),
            nullif(left(btrim(coalesce(p_documento, '')), 80), ''),
            v_clase, v_forma, coalesce(p_varias, true))
    RETURNING id INTO v_id;

    RETURN json_build_object('ok', true, 'id', v_id, 'secreto', v_secreto,
                             'vence_el', (now() + interval '5 minutes'));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_captura_de_foto(uuid, text, text, text, text, boolean) TO authenticated, service_role;

-- Misma firma: sólo devuelve los tres datos nuevos.
CREATE OR REPLACE FUNCTION public.captura_de_foto_vigente(p_secreto text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT coalesce(
      (SELECT json_build_object('ok', true, 'id', c.id, 'para', e.name, 'modo', c.modo, 'documento', c.documento,
                                'clase', c.clase, 'forma', c.forma, 'varias', c.varias)
         FROM public.capturas_de_foto c
         LEFT JOIN public.employees e ON e.id = c.employee_id
        WHERE c.secreto_hash = encode(extensions.digest(
                  upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g')), 'sha256'), 'hex')
          AND c.usada_el IS NULL
          AND c.vence_el > now()
        LIMIT 1),
      json_build_object('ok', false));
$function$;
