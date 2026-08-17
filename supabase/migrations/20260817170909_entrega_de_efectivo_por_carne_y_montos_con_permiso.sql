SET lock_timeout = '5s';

-- ═══ La entrega del efectivo se identifica SOLA, con el carné ═══════════════
--
-- Pedido del usuario (2026-08-17), mirando la pantalla:
--
--   «al dar entregar dinero, ¿por qué pregunta quién se lleva el efectivo y
--    sale el select? solo debe haber el selector de días (como ya está) y la
--    pantalla activa de espera de escanear, así como apoyo. de la misma forma,
--    no pongas el total de dinero, solo las bolsas. los totales de dinero no
--    los deben ver los dependientes, solo quien tenga permisos.»
--
-- Elegir a la persona de una lista y DESPUÉS pedirle el carné son dos pasos
-- para un solo dato: el carné YA dice quién es. La lista además obligaba a
-- publicarle a la sala la nómina entera para elegir a alguien de administración.
--
-- ── Por qué NO alcanza `identificar_por_carne` ─────────────────────────────
-- Esa función es la del apoyo de un pedido y exige `kiosco_cubre_empleado`, o
-- sea que la persona trabaje en ESA sala. Quien recolecta el efectivo es
-- justamente de administración — lo dice `entregar_bolsas` desde el 16-ago:
-- «no se exige que sea de ESA sala». Con el filtro de sucursal, el carné del
-- recolector no lo reconocería nunca ninguna sala.
--
-- ── Y por qué devuelve json en vez de RAISE ────────────────────────────────
-- `probar_identidad` registra el intento y después lanza cuando el secreto no
-- coincide. Un `RAISE` aborta la transacción, así que se lleva su propio
-- INSERT: el intento fallido NO queda registrado y el freno de los 5 fallos
-- cuenta sobre una tabla que nunca crece. Medido en prod: `intentos_identidad`
-- tiene 17 filas y las 17 son de `CARNE_LOOKUP` (esa función no lanza), cero de
-- `RETIRO`. Acá el «no lo reconocí» es un RESULTADO, no una excepción — la
-- transacción confirma, el intento queda escrito y el freno tiene contra qué
-- contar. El único `RAISE` que queda es el de permisos, que no registra nada.
CREATE OR REPLACE FUNCTION public.probar_identidad_por_carne(p_secreto text)
 RETURNS json
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_yo     uuid   := (SELECT auth_employee_id());
    v_sala   bigint := (SELECT auth_employee_branch_id());
    -- Igual que `kiosco_identificar` y que `identificar_por_carne`: se limpian
    -- TODOS los espacios, no sólo las puntas — un lector puede meter uno en
    -- medio y `btrim` no lo ve.
    v_limpio text   := upper(regexp_replace(coalesce(p_secreto, ''), '\s', '', 'g'));
    v_fallos integer;
    v_hit    uuid;
    v_token  uuid;
    v_emp    record;
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['bolsas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_limpio = '' THEN
        RETURN json_build_object('ok', false, 'motivo', 'No se leyo nada. Pasa el carne por el lector.');
    END IF;

    -- El freno cuenta los carnes que ESTE equipo no reconocio: acá no hay una
    -- persona elegida de antemano contra la que contar, que es la diferencia
    -- con `probar_identidad`. Mismo criterio que el lookup del apoyo.
    SELECT count(*) INTO v_fallos
      FROM public.intentos_identidad i
     WHERE i.quien = v_yo AND i.proposito = 'RETIRO'
       AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

    IF v_fallos >= 10 THEN
        RETURN json_build_object('ok', false,
            'motivo', 'Demasiados carnes sin reconocer seguidos. Espera unos minutos.');
    END IF;

    -- PIN primero, codigo despues. Es el orden de `kiosco_identificar` y el
    -- motivo esta medido (20260817154613): de los 46 carnes con PIN, CERO
    -- coinciden con su codigo, y lo que trae impreso el carne es el PIN.
    --
    -- Sin filtro de sucursal a proposito — ver el encabezado.
    SELECT e.id INTO v_hit
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.kiosk_pin, '')) <> ''
       AND upper(btrim(e.kiosk_pin)) = v_limpio
     LIMIT 1;

    IF v_hit IS NULL THEN
        SELECT e.id INTO v_hit
          FROM public.employees e
         WHERE e.status = 'ACTIVO'
           AND btrim(coalesce(e.code, '')) <> ''
           AND upper(btrim(e.code)) = v_limpio
         LIMIT 1;
    END IF;

    INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
    VALUES (v_yo, 'RETIRO', v_hit, 'CARNE', v_hit IS NOT NULL, v_sala);

    IF v_hit IS NULL THEN
        RETURN json_build_object('ok', false, 'motivo', 'Ese carne no es de nadie activo.');
    END IF;

    -- El vale es de un solo uso y vive 5 minutos; lo consume `entregar_bolsas`
    -- contra la MISMA persona. El navegador no puede elegir a quien se le
    -- atribuye el dinero: sale de acá.
    INSERT INTO public.identidad_vales (employee_id, metodo, emitido_por)
    VALUES (v_hit, 'CARNE', v_yo)
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

REVOKE EXECUTE ON FUNCTION public.probar_identidad_por_carne(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.probar_identidad_por_carne(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.probar_identidad_por_carne(text) IS
 'Resuelve QUIEN es por el carne escaneado (PIN, y despues codigo) y devuelve un vale de un solo uso valido 5 minutos. Sin filtro de sucursal: quien recolecta el efectivo es de administracion. Devuelve {ok:false,motivo} en vez de lanzar para que el intento fallido quede registrado.';

-- ═══ Los montos de las bolsas, detrás de su propio permiso ═════════════════
--
-- «los totales de dinero no los deben ver los dependientes, solo quien tenga
-- permisos». Es el mismo canon que `facturacion_ver_montos`,
-- `clientes_ver_montos` y los otros seis `*_ver_montos`.
--
-- Y se siembra AL REVÉS que aquellas: las de agosto arrancaron encendidas para
-- todo rol que ya veía el módulo padre, y acá eso sería exactamente lo que el
-- usuario pidió apagar.
--
-- Los cuatro cargos son los que él nombró (2026-08-17): «aplicalo a gerencia,
-- admin, supervisor y talento». No es la lista de `bolsas_conteo`: quedan fuera
-- Jefe/a de Compras y Logística y QA / Testing (CI), que hoy pueden recibir y
-- contar. Y quedan fuera los cuatro cargos de sala —Dependiente de Farmacia,
-- Jefe/a y Subjefe/a de Sala, Regente de Enfermería—, que siguen guardando,
-- sacando y entregando bolsas sin ver las cifras.
--
-- Se resuelve por NOMBRE contra la tabla, no por `id` escrito a mano: los
-- nombres se verificaron contra las 24 filas de `roles` (ojo, «Regente de
-- Enfermeria» va sin tilde ahí — ver la regla del rótulo que no es clave). Si
-- alguno no coincidiera, este INSERT sembraría de menos en silencio, así que
-- abajo se comprueba que sean exactamente 4.
INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope, updated_at)
SELECT r.id, 'bolsas_ver_montos', true, false, false, 'ALL', now()
  FROM public.roles r
 WHERE r.name IN (
        'Gerente General',
        'Administrador',
        'Supervisor/a de Ventas',
        'Jefe/a de Talento Humano')
ON CONFLICT (role_id, module_key) DO UPDATE SET can_view = true, updated_at = now();

DO $$
DECLARE v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM public.role_permissions
     WHERE module_key = 'bolsas_ver_montos' AND can_view;
    IF v_n <> 4 THEN
        RAISE EXCEPTION 'Se esperaban 4 cargos con bolsas_ver_montos y quedaron %. Revisar los nombres de los roles.', v_n;
    END IF;
END $$;
