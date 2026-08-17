SET lock_timeout = '5s';

-- ═══ El freno que contaba sobre una tabla que nunca crecía ═════════════════
--
-- `probar_identidad` corta a los 5 fallos en 15 minutos contra una persona, y
-- para contarlos guarda cada intento en `intentos_identidad`. El orden de las
-- dos cosas lo anulaba:
--
--     INSERT INTO intentos_identidad (..., exito) VALUES (..., false);
--     IF NOT v_ok THEN
--         RAISE EXCEPTION 'No se pudo comprobar la identidad...';   -- ← revierte el INSERT
--     END IF;
--
-- En Postgres, una excepción que sale de la función aborta la transacción
-- ENTERA, incluido lo que la propia función acababa de escribir. O sea que
-- anotaba el fallo y acto seguido lo borraba sola, sin que nada fallara a la
-- vista: la tabla contra la que cuenta el freno no crecía nunca, el contador
-- daba siempre cero y el corte de los 5 no llegaba jamás. Se podían probar
-- contraseñas sin límite y sin dejar rastro — exactamente lo que este código
-- creía impedir.
--
-- Medido en prod el 2026-08-17: `intentos_identidad` tenía 17 filas y las 17
-- eran de `CARNE_LOOKUP` —`identificar_por_carne` no lanza en esa rama, y por
-- eso sí registra—, CERO de `RETIRO`. Ese cero se lee como «nadie intentó
-- retirar efectivo» y significaba «esto no se puede registrar».
--
-- La ironía es que el encabezado de la migración que la creó
-- (`20260816014507`) razona bien sobre este mismo riesgo: partió la
-- comprobación en dos llamadas justamente para que «probar mil claves» dejara
-- rastro cuando la ESCRITURA del dinero abortara después. Cubrió el aborto de
-- afuera y no el `RAISE` de adentro.
--
-- ── El arreglo: el fracaso es un RESULTADO, no una excepción ───────────────
-- Devuelve json —`{ok:true, vale}` o `{ok:false, motivo}`— y la transacción
-- confirma, así que el intento queda escrito. Es la misma forma que ya tenían
-- `kiosco_identificar` y las dos funciones de la entrega del efectivo
-- (`20260817170909`, `20260817171651`), verificada en el branch de pruebas.
-- El único `RAISE` que queda es el de permisos y el del método inválido: los
-- dos corren ANTES del primer INSERT, así que no hay nada que perder.
--
-- Cambia el tipo de retorno (uuid → json), así que va con DROP: `CREATE OR
-- REPLACE` no puede cambiarlo. Se puede tirar sin ceremonia — con cero filas
-- `RETIRO` en la bitácora, esta función nunca llegó a confirmar una identidad
-- en producción. Su único llamador es «Sacar dinero» (`SalidaDeBolsa`), que se
-- adapta en el mismo commit; ninguna función de Postgres la invoca (verificado
-- sobre `pg_proc.prosrc`).
DROP FUNCTION IF EXISTS public.probar_identidad(uuid, text, text);

CREATE OR REPLACE FUNCTION public.probar_identidad(
    p_employee_id uuid, p_metodo text, p_secreto text)
 RETURNS json
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid := (SELECT auth_employee_id());
    v_fallos integer;
    v_ok     boolean;
    v_token  uuid;
    v_sala   bigint;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    -- Argumento del programa, no de una persona: acá un valor raro es un bug y
    -- no un intento que haya que contar. Corre antes de cualquier INSERT.
    IF p_metodo IS NULL OR p_metodo NOT IN ('CARNE','CLAVE') THEN
        RAISE EXCEPTION 'Quien retira el efectivo se identifica con su carne o con su usuario y contrasena.';
    END IF;
    IF p_employee_id IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'Falta elegir quien retira el efectivo.');
    END IF;

    -- El freno cuenta los fallos contra ESA persona, no contra quien pregunta:
    -- lo que hay que encarecer es adivinarle el carne a alguien en concreto.
    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.objetivo = p_employee_id AND i.proposito = 'RETIRO'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    SELECT branch_id INTO v_sala FROM public.employees WHERE id = p_employee_id;

    IF v_fallos >= 5 THEN
        INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
        VALUES (v_yo, 'RETIRO', p_employee_id, p_metodo, false, v_sala);
        RETURN json_build_object('ok', false,
            'motivo', 'Se intento demasiadas veces sin acertar. Hay que esperar 15 minutos antes de volver a probar con esta persona.');
    END IF;

    v_ok := public.verificar_persona(p_employee_id, p_metodo, p_secreto);

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'RETIRO', p_employee_id, p_metodo, coalesce(v_ok, false), v_sala);

    IF NOT coalesce(v_ok, false) THEN
        RETURN json_build_object('ok', false,
            'motivo', CASE WHEN p_metodo = 'CARNE'
                           THEN 'Ese carne no es de la persona elegida.'
                           ELSE 'La contrasena no coincide.' END);
    END IF;

    INSERT INTO public.identidad_vales (employee_id, metodo, emitido_por)
    VALUES (p_employee_id, p_metodo, v_yo)
    RETURNING token INTO v_token;

    RETURN json_build_object('ok', true, 'vale', v_token);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.probar_identidad(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.probar_identidad(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.probar_identidad(uuid, text, text) IS
 'Prueba que alguien es quien dice —carne o contrasena— y devuelve {ok:true,vale} con un comprobante de un solo uso valido 5 minutos, o {ok:false,motivo}. NO lanza cuando el secreto no coincide: un RAISE revertiria el INSERT del intento fallido y el freno de los 5 fallos contaria sobre una tabla que nunca crece (medido: cero filas RETIRO con la version anterior).';
