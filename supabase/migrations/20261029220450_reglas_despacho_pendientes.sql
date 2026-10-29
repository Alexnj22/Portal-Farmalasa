-- Una regla de despacho apunta a UNA presentación del catálogo
-- (dispatch_rules.dispatch_id_presentacion). Cuando esa presentación se apaga
-- o cambia de factor, la regla seguía viva con el tamaño viejo: DISTEM X 50
-- (2026-10-29) salió en el pedido como «14 cajas» porque la regla apuntaba a
-- una «CAJA» de factor 1 que el catálogo ya había reemplazado por UNIDAD ×1 y
-- CAJA ×50. Había 24 reglas así.
--
-- Decisión del usuario: cuando pase, la regla se QUITA, queda pendiente con su
-- motivo, y se le avisa al cargo que las mantiene (Jefe/a de Compras y
-- Logística) para que la corrija. Sin regla, el pedido sale en la presentación
-- normal del producto — nunca con un tamaño que ya no existe.
SET lock_timeout = '5s';

CREATE TABLE public.reglas_despacho_pendientes (
    id              bigserial PRIMARY KEY,
    created_at      timestamptz NOT NULL DEFAULT now(),
    erp_product_id  integer NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    motivo          text NOT NULL CHECK (motivo IN ('presentacion_inactiva', 'factor_cambio')),
    -- La regla tal como estaba, más el tipo y el factor de su presentación,
    -- para que la pantalla diga qué había antes.
    regla_anterior  jsonb NOT NULL,
    factor_antes    numeric,
    factor_ahora    numeric,
    resuelto_at     timestamptz,
    resuelto_por    uuid REFERENCES public.employees(id),
    resolucion      text CHECK (resolucion IN ('nueva_regla', 'sin_regla'))
);
CREATE INDEX reglas_despacho_pendientes_producto_idx ON public.reglas_despacho_pendientes (erp_product_id);
-- Una sola abierta por producto.
CREATE UNIQUE INDEX reglas_despacho_pendientes_abierta_uidx
    ON public.reglas_despacho_pendientes (erp_product_id) WHERE resuelto_at IS NULL;

ALTER TABLE public.reglas_despacho_pendientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY reglas_despacho_pendientes_select ON public.reglas_despacho_pendientes
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('pedidos_tab_reglas', 'can_view')));
-- Sin policies de escritura: la escriben el trigger y las funciones DEFINER.
REVOKE ALL ON public.reglas_despacho_pendientes FROM anon;

-- Quita una regla y la deja pendiente. La usan el trigger del catálogo y la
-- reparación de abajo; NO se expone.
CREATE OR REPLACE FUNCTION public.regla_despacho_a_pendiente(
    p_regla_id bigint, p_motivo text, p_factor_antes numeric, p_factor_ahora numeric, p_avisar boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_regla   jsonb;
    v_pid     integer;
    v_nombre  text;
    v_tipo    text;
    v_dest    uuid[];
BEGIN
    SELECT to_jsonb(dr) || jsonb_build_object('tipo', pr.tipo, 'factor', pp.factor),
           dr.erp_product_id, p.nombre, coalesce(dr.dispatch_label, pr.tipo)
      INTO v_regla, v_pid, v_nombre, v_tipo
      FROM dispatch_rules dr
      JOIN products p ON p.id = dr.erp_product_id
      LEFT JOIN presentaciones pr ON pr.id = dr.dispatch_id_presentacion
      LEFT JOIN product_precios pp ON pp.product_id = dr.erp_product_id
                                  AND pp.id_presentacion = dr.dispatch_id_presentacion
     WHERE dr.id = p_regla_id;
    IF v_pid IS NULL THEN RETURN false; END IF;

    INSERT INTO reglas_despacho_pendientes (erp_product_id, motivo, regla_anterior, factor_antes, factor_ahora)
    VALUES (v_pid, p_motivo, v_regla, p_factor_antes, p_factor_ahora)
    ON CONFLICT (erp_product_id) WHERE resuelto_at IS NULL DO UPDATE
       SET motivo = EXCLUDED.motivo, regla_anterior = EXCLUDED.regla_anterior,
           factor_antes = EXCLUDED.factor_antes, factor_ahora = EXCLUDED.factor_ahora,
           created_at = now();

    DELETE FROM dispatch_rules WHERE id = p_regla_id;

    INSERT INTO audit_logs (user_id, user_name, action, target_id, details, source, severity)
    VALUES (NULL, 'Sistema', 'REGLA_DESPACHO_PENDIENTE', p_regla_id::text,
            jsonb_build_object('erp_product_id', v_pid, 'motivo', p_motivo, 'regla_anterior', v_regla,
                               'factor_antes', p_factor_antes, 'factor_ahora', p_factor_ahora),
            'SYSTEM', 'WARNING');

    -- Sólo si el producto se sigue pidiendo: uno inactivo no sale en ningún pedido.
    IF p_avisar AND EXISTS (SELECT 1 FROM products WHERE id = v_pid AND activo) THEN
        SELECT array_agg(e.id) INTO v_dest
          FROM employees e JOIN roles r ON r.id IN (e.role_id, e.secondary_role_id)
         WHERE r.name = 'Jefe/a de Compras y Logistica' AND e.status = 'ACTIVO';
        IF v_dest IS NOT NULL THEN
            PERFORM notify_employees(
                v_dest, 'PEDIDO_REGLA_PENDIENTE',
                'Regla de despacho por corregir',
                v_nombre || ': la regla era ' || coalesce(v_tipo, '—')
                    || CASE WHEN p_factor_antes IS NOT NULL THEN ' ×' || trim(to_char(p_factor_antes, 'FM999999990.##')) ELSE '' END
                    || ' y esa presentación cambió. Se quitó: hasta que la corrijas sale en su presentación normal.',
                '/pedidos?tab=reglas',
                jsonb_build_object('erp_product_id', v_pid, 'motivo', p_motivo),
                true, NULL);
        END IF;
    END IF;
    RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.regla_despacho_a_pendiente(bigint, text, numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.regla_despacho_a_pendiente(bigint, text, numeric, numeric, boolean) TO service_role;

-- El catálogo: una presentación que se apaga o cambia de factor deja pendiente
-- la regla que apuntaba a ella.
CREATE OR REPLACE FUNCTION public.trg_precio_vuelve_pendiente_la_regla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM dispatch_rules
     WHERE erp_product_id = NEW.product_id AND dispatch_id_presentacion = NEW.id_presentacion;
    IF v_id IS NOT NULL THEN
        PERFORM regla_despacho_a_pendiente(
            v_id,
            CASE WHEN NOT NEW.activo THEN 'presentacion_inactiva' ELSE 'factor_cambio' END,
            OLD.factor, CASE WHEN NEW.activo THEN NEW.factor END);
    END IF;
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_precio_vuelve_pendiente_la_regla() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER precio_vuelve_pendiente_la_regla
    AFTER UPDATE OF factor, activo ON public.product_precios
    FOR EACH ROW
    WHEN ((OLD.activo AND NOT NEW.activo) OR (NEW.activo AND OLD.factor IS DISTINCT FROM NEW.factor))
    EXECUTE FUNCTION public.trg_precio_vuelve_pendiente_la_regla();

-- Guardar una regla nueva para el producto cierra su pendiente.
CREATE OR REPLACE FUNCTION public.trg_regla_cierra_pendiente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NEW.dispatch_id_presentacion IS NOT NULL THEN
        UPDATE reglas_despacho_pendientes
           SET resuelto_at = now(), resuelto_por = auth_employee_id(), resolucion = 'nueva_regla'
         WHERE erp_product_id = NEW.erp_product_id AND resuelto_at IS NULL;
    END IF;
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_regla_cierra_pendiente() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER regla_cierra_pendiente
    AFTER INSERT OR UPDATE OF dispatch_id_presentacion ON public.dispatch_rules
    FOR EACH ROW EXECUTE FUNCTION public.trg_regla_cierra_pendiente();

-- «Dejarlo sin regla» también es una respuesta: cierra el pendiente.
CREATE OR REPLACE FUNCTION public.resolver_regla_pendiente_sin_regla(p_erp_product_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NOT (SELECT auth_can_edit_any(ARRAY['pedidos_tab_reglas'])) THEN
        RAISE EXCEPTION 'FORBIDDEN: sin permiso para editar reglas de despacho';
    END IF;
    UPDATE reglas_despacho_pendientes
       SET resuelto_at = now(), resuelto_por = auth_employee_id(), resolucion = 'sin_regla'
     WHERE erp_product_id = p_erp_product_id AND resuelto_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.resolver_regla_pendiente_sin_regla(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolver_regla_pendiente_sin_regla(integer) TO authenticated, service_role;

-- Reparación: las reglas que HOY apuntan a una presentación apagada. Sin un
-- aviso por regla; uno solo al final con la cuenta.
DO $$
DECLARE
    r       record;
    v_n     integer := 0;
    v_dest  uuid[];
BEGIN
    FOR r IN
        SELECT dr.id, pp.factor
          FROM dispatch_rules dr
          JOIN product_precios pp ON pp.product_id = dr.erp_product_id
                                 AND pp.id_presentacion = dr.dispatch_id_presentacion
         WHERE NOT pp.activo
    LOOP
        PERFORM public.regla_despacho_a_pendiente(r.id, 'presentacion_inactiva', r.factor, NULL, false);
    END LOOP;

    SELECT count(*) INTO v_n
      FROM public.reglas_despacho_pendientes q JOIN public.products p ON p.id = q.erp_product_id AND p.activo
     WHERE q.resuelto_at IS NULL;

    SELECT array_agg(e.id) INTO v_dest
      FROM public.employees e JOIN public.roles ro ON ro.id IN (e.role_id, e.secondary_role_id)
     WHERE ro.name = 'Jefe/a de Compras y Logistica' AND e.status = 'ACTIVO';

    IF v_n > 0 AND v_dest IS NOT NULL THEN
        PERFORM public.notify_employees(
            v_dest, 'PEDIDO_REGLA_PENDIENTE',
            'Reglas de despacho por corregir',
            v_n || ' productos tenían su regla en una presentación que ya cambió. Se quitaron y quedaron pendientes en Reglas de despacho.',
            '/pedidos?tab=reglas', jsonb_build_object('cuantas', v_n), true, NULL);
    END IF;
END;
$$;
