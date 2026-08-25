SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- Pasar la ronda: todo lo que se anota de una vuelta, en UNA llamada.
--
-- ── Por qué existe ─────────────────────────────────────────────────────────
-- Medido el 2026-08-25 sobre los 576 registros de las primeras nueve jornadas:
-- **394 (68%) se anotaron a menos de tres minutos del anterior, con 29 segundos
-- de promedio**, y 55 vueltas juntaron cinco o seis registros seguidos. O sea
-- que la sala YA trabaja por vuelta —se camina con el termohigrómetro, se mira
-- sala, bodega y refrigerador, se firma la limpieza— y el portal la obligaba a
-- ir casilla por casilla: trece diálogos al día por sala.
--
-- ── Cada renglón se guarda por su cuenta (SAVEPOINT por ítem) ──────────────
-- La alternativa —todo o nada— convierte un renglón rechazado (el clásico: una
-- temperatura fuera de rango sin acción anotada) en la pérdida de los otros
-- cinco, que YA estaban bien y que la persona tendría que volver a teclear de
-- pie. Y no hay ninguna razón de la norma para atarlos: cada lectura es un
-- registro independiente, con su hora, su área y su firma. Se guarda lo que se
-- puede y se devuelve, por su clave, lo que no entró y por qué.
--
-- ── La regla la siguen escribiendo las dos funciones de siempre ────────────
-- Esto NO reimplementa nada: llama a `registrar_lectura_bitacora` y a
-- `registrar_limpieza_bitacora`. Copiar acá el cálculo de «fuera de rango», de
-- «tarde» o la guarda de acceso habría creado una segunda verdad que el día que
-- alguien toque una de las dos deja de coincidir — y el registro que vale ante
-- un inspector sería el de la copia sin mantener.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.registrar_ronda_bitacora(p_items jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_item      jsonb;
    v_clave     text;
    v_guardados int := 0;
    v_fallidos  jsonb := '[]'::jsonb;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'La ronda tiene que ser una lista de registros.' USING ERRCODE = 'P0001';
    END IF;

    -- Un tope, porque una ronda es lo que cabe en una vuelta: la sala más
    -- cargada tiene trece casillas al día. Un número mayor no es una ronda, es
    -- una carga masiva — y ésa no puede entrar por acá sin que nadie la mire.
    IF jsonb_array_length(p_items) > 40 THEN
        RAISE EXCEPTION 'Son demasiados registros para una sola ronda.' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_clave := coalesce(v_item->>'clave', '');
        BEGIN
            IF (v_item->>'tipo') = 'limpieza' THEN
                PERFORM public.registrar_limpieza_bitacora(
                    (v_item->>'area_id')::bigint,
                    (v_item->>'fecha')::date,
                    v_item->>'turno',
                    v_item->>'observaciones'
                );
            ELSIF (v_item->>'tipo') = 'lectura' THEN
                PERFORM public.registrar_lectura_bitacora(
                    (v_item->>'area_id')::bigint,
                    (v_item->>'fecha')::date,
                    v_item->>'franja',
                    (v_item->>'temperatura')::numeric,
                    nullif(v_item->>'humedad', '')::numeric,
                    v_item->>'accion'
                );
            ELSE
                RAISE EXCEPTION 'Tipo de registro desconocido.' USING ERRCODE = 'P0001';
            END IF;
            v_guardados := v_guardados + 1;
        EXCEPTION WHEN OTHERS THEN
            -- El mensaje viaja tal cual: las dos funciones levantan con texto de
            -- negocio («hay que anotar qué se hizo»), y reescribirlo acá sería
            -- una segunda versión del mismo aviso.
            v_fallidos := v_fallidos || jsonb_build_object('clave', v_clave, 'error', SQLERRM);
        END;
    END LOOP;

    RETURN json_build_object('guardados', v_guardados, 'fallidos', v_fallidos);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_ronda_bitacora(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_ronda_bitacora(jsonb) TO authenticated, service_role;
