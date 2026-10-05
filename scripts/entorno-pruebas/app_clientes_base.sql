-- BORRADOR de migración — probado en el branch de pruebas (zkpypxvkyfyxsrnplpuy) el
-- 2026-10-05 con execute_sql. TODAVÍA NO está en producción: al aplicarlo con
-- apply_migration, archivarlo en supabase/migrations/ con la versión que devuelva.

-- La app de clientes (2026-10-05): sesión, pre-registro, ofertas y las
-- inyecciones que el cliente tiene por aplicar.
--
-- ── Por qué una sesión propia y no Supabase Auth ─────────────────────────────
-- El cliente entra con lo mismo que en /mis-puntos —documento + teléfono—, que
-- no es una contraseña y no se puede convertir en una cuenta de Auth sin
-- inventarle una. La sesión es un token opaco que emite `app-clientes` (edge
-- function, llave del servidor) y del que acá sólo se guarda la HUELLA: una
-- copia de la tabla no sirve para entrar. Ninguna tabla de este archivo es
-- legible por `anon`; las lee el personal con su permiso o el servidor.
--
-- ── Por qué el pre-registro no crea la ficha ─────────────────────────────────
-- La ficha nace en el sistema de la caja y se liga por su número, nunca por el
-- nombre (CLAUDE.md, fichas de clientes). Crearla desde un teléfono ajeno a la
-- sala sería abrir la puerta a duplicados y a datos inventados. El pre-registro
-- guarda lo que la persona escribió; cuando la sala la registra con ESE
-- documento y ESE teléfono, la app la reconoce sola en la siguiente consulta.
SET lock_timeout = '5s';

-- ── Pre-registros ────────────────────────────────────────────────────────────
CREATE TABLE public.app_cliente_preregistros (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre              text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 3 AND 120),
    documento           text NOT NULL CHECK (length(documento) BETWEEN 7 AND 20),
    telefono            text NOT NULL CHECK (telefono ~ '^[0-9]{8,15}$'),
    email               text,
    fecha_nacimiento    date,
    acepta_programa     boolean NOT NULL,
    acepta_promociones  boolean NOT NULL,
    version_aviso       text NOT NULL,
    estado              text NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente', 'vinculado', 'descartado')),
    customer_id         bigint REFERENCES public.customers(id) ON DELETE SET NULL,
    resuelto_at         timestamptz,
    resuelto_por        uuid REFERENCES public.employees(id),
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_cliente_preregistros_customer_idx ON public.app_cliente_preregistros (customer_id);
CREATE INDEX app_cliente_preregistros_pendientes_idx ON public.app_cliente_preregistros (created_at DESC)
    WHERE estado = 'pendiente';
-- Un documento no se pre-registra dos veces mientras espera.
CREATE UNIQUE INDEX app_cliente_preregistros_doc_pendiente_uq
    ON public.app_cliente_preregistros (documento) WHERE estado = 'pendiente';

ALTER TABLE public.app_cliente_preregistros ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_cliente_preregistros_select ON public.app_cliente_preregistros
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));
-- Sin INSERT/UPDATE/DELETE para el navegador: los escribe `app-clientes`
-- (alta) y `app_preregistro_resolver` (la sala).

-- ── Sesiones ─────────────────────────────────────────────────────────────────
CREATE TABLE public.app_cliente_sesiones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     bigint REFERENCES public.customers(id) ON DELETE CASCADE,
    preregistro_id  uuid REFERENCES public.app_cliente_preregistros(id) ON DELETE CASCADE,
    token_hash      text NOT NULL UNIQUE,
    plataforma      text CHECK (plataforma IN ('ios', 'android', 'web')),
    dispositivo     text,
    push_token      text,
    acepta_avisos   boolean,
    created_at      timestamptz NOT NULL DEFAULT now(),
    ultimo_uso_at   timestamptz NOT NULL DEFAULT now(),
    revocada_at     timestamptz,
    CHECK (customer_id IS NOT NULL OR preregistro_id IS NOT NULL)
);
CREATE INDEX app_cliente_sesiones_customer_idx ON public.app_cliente_sesiones (customer_id);
CREATE INDEX app_cliente_sesiones_prereg_idx ON public.app_cliente_sesiones (preregistro_id);
CREATE INDEX app_cliente_sesiones_push_idx ON public.app_cliente_sesiones (customer_id)
    WHERE push_token IS NOT NULL AND revocada_at IS NULL AND acepta_avisos;

ALTER TABLE public.app_cliente_sesiones ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_cliente_sesiones_select ON public.app_cliente_sesiones
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('clientes', 'can_view')));

-- ── Ofertas para clientes ────────────────────────────────────────────────────
-- NO son `promociones`: aquéllas son bonos de laboratorio para el personal y no
-- tienen nada que mostrarle a un cliente. Ésta es la vitrina de la app.
CREATE TABLE public.ofertas_clientes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo        text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 80),
    descripcion   text CHECK (descripcion IS NULL OR length(descripcion) <= 600),
    etiqueta      text CHECK (etiqueta IS NULL OR length(etiqueta) <= 16),
    condiciones   text CHECK (condiciones IS NULL OR length(condiciones) <= 400),
    imagen_path   text,
    inicio        date NOT NULL,
    fin           date NOT NULL,
    exclusiva     boolean NOT NULL DEFAULT false,
    branch_ids    integer[],
    publicada     boolean NOT NULL DEFAULT false,
    orden         integer NOT NULL DEFAULT 0,
    creada_por    uuid REFERENCES public.employees(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CHECK (fin >= inicio)
);
CREATE INDEX ofertas_clientes_vigentes_idx ON public.ofertas_clientes (fin) WHERE publicada;

ALTER TABLE public.ofertas_clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ofertas_clientes_select ON public.ofertas_clientes
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));
CREATE POLICY ofertas_clientes_insert ON public.ofertas_clientes
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')));
CREATE POLICY ofertas_clientes_update ON public.ofertas_clientes
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')))
    WITH CHECK ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')));
CREATE POLICY ofertas_clientes_delete ON public.ofertas_clientes
    FOR DELETE TO authenticated
    USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')));

-- Este proyecto NO otorga privilegios por defecto a tablas nuevas: sin esto,
-- ni la llave del servidor puede leerlas («permission denied», medido en el
-- branch de pruebas el 2026-10-05). El RLS decide lo demás.
REVOKE ALL ON public.app_cliente_sesiones, public.app_cliente_preregistros, public.ofertas_clientes FROM anon, authenticated;
GRANT SELECT ON public.app_cliente_sesiones, public.app_cliente_preregistros TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ofertas_clientes TO authenticated;
GRANT ALL ON public.app_cliente_sesiones, public.app_cliente_preregistros, public.ofertas_clientes TO service_role;

INSERT INTO public.role_permissions (role_id, module_key, can_view, can_edit, can_approve, scope)
SELECT r.id, 'ofertas_clientes', v.can_view, v.can_edit, false, 'ALL'
  FROM (VALUES ('Gerente General',                         true, true),
               ('Administrador',                           true, true),
               ('Agente de Atencion de Canales Digitales', true, true),
               ('Supervisor/a de Ventas',                  true, false)) v(nombre, can_view, can_edit)
  JOIN public.roles r ON r.name = v.nombre
 WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = r.id AND rp.module_key = 'ofertas_clientes');

-- La imagen de la oferta: bucket PRIVADO (regla 10); la app la recibe firmada
-- desde `app-clientes`.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ofertas-clientes', 'ofertas-clientes', false, 3145728,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY ofertas_clientes_obj_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'ofertas-clientes'
           AND (SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));
CREATE POLICY ofertas_clientes_obj_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'ofertas-clientes'
                AND (SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')));
CREATE POLICY ofertas_clientes_obj_update ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'ofertas-clientes'
           AND (SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')));
CREATE POLICY ofertas_clientes_obj_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'ofertas-clientes'
           AND (SELECT public.auth_has_module_permission('ofertas_clientes', 'can_edit')));

-- ── Las inyecciones de UN cliente ────────────────────────────────────────────
-- Misma definición de «por aplicar» que `inyecciones_pendientes` (pagada, cobro
-- sin anular, no aplicada, no es parte de una mezcla), pero acotada a la ficha
-- y sin nombres de empleados: el cliente ve DÓNDE y CUÁNDO, no quién.
-- Las TRAIDAS sólo llevan el nombre escrito, sin ficha: no salen acá, y no se
-- adivinan por nombre (un nombre no es una clave).
-- Sólo `service_role`: la llama `app-clientes` con el customer_id que resolvió
-- la sesión, nunca con uno que mande el teléfono.
CREATE FUNCTION public.app_cliente_inyecciones(p_customer_id bigint)
RETURNS json LANGUAGE plpgsql STABLE
SET search_path = public, extensions AS $$
BEGIN
    RETURN json_build_object(
      'disponibles', coalesce((
        SELECT json_agg(x ORDER BY x.pagada_at DESC) FROM (
          SELECT a.id,
                 CASE WHEN mz.otros IS NULL THEN a.producto
                      ELSE a.producto || coalesce(' ' || trim_scale(a.dosis_ml) || ' ml', '') || ' + ' || mz.otros
                 END AS producto,
                 CASE WHEN mz.otros IS NULL THEN a.dosis_ml END AS dosis_ml,
                 c.registrado_at AS pagada_at,
                 b.name AS sala
            FROM inyeccion_aplicaciones a
            JOIN caja_movimientos_portal c ON c.id = a.cobro_id AND c.anulado_at IS NULL
            JOIN branches b ON b.id = a.branch_id
            LEFT JOIN LATERAL (
              SELECT string_agg(m.producto || coalesce(' ' || trim_scale(m.dosis_ml) || ' ml', ''), ' + ' ORDER BY m.id) AS otros
                FROM inyeccion_aplicaciones m WHERE m.mezcla_de = a.id
            ) mz ON true
           WHERE a.customer_id = p_customer_id
             AND a.confirmada AND a.aplicada_at IS NULL AND a.mezcla_de IS NULL
           ORDER BY c.registrado_at DESC
           LIMIT 100
        ) x), '[]'::json),
      'aplicadas', coalesce((
        SELECT json_agg(y ORDER BY y.aplicada_at DESC) FROM (
          SELECT a.producto, a.dosis_ml, a.aplicada_at, b.name AS sala
            FROM inyeccion_aplicaciones a
            LEFT JOIN branches b ON b.id = a.aplicada_branch_id
           WHERE a.customer_id = p_customer_id
             AND a.aplicada_at IS NOT NULL AND a.mezcla_de IS NULL
             AND a.aplicada_at > now() - interval '365 days'
           ORDER BY a.aplicada_at DESC
           LIMIT 30
        ) y), '[]'::json));
END;
$$;
ALTER FUNCTION public.app_cliente_inyecciones(bigint) SET plan_cache_mode = 'force_custom_plan';
REVOKE EXECUTE ON FUNCTION public.app_cliente_inyecciones(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_cliente_inyecciones(bigint) TO service_role;

-- ── La sala resuelve un pre-registro ─────────────────────────────────────────
-- Vincular exige que la ficha tenga el MISMO documento que se pre-registró: no
-- se liga a la persona equivocada por apuro. Descartar no borra la fila.
CREATE FUNCTION public.app_preregistro_resolver(p_id uuid, p_accion text, p_customer_id bigint DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_pre public.app_cliente_preregistros%ROWTYPE;
    v_doc text;
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
        SELECT upper(regexp_replace(concat_ws('|', dui, nit, pasaporte), '[^A-Za-z0-9|]', '', 'g'))
          INTO v_doc FROM public.customers WHERE id = p_customer_id;
        IF v_doc IS NULL OR position(v_pre.documento IN v_doc) = 0 THEN
            RAISE EXCEPTION 'DOCUMENTO_NO_COINCIDE';
        END IF;
        UPDATE public.app_cliente_preregistros
           SET estado = 'vinculado', customer_id = p_customer_id,
               resuelto_at = now(), resuelto_por = public.auth_employee_id()
         WHERE id = p_id;
        UPDATE public.app_cliente_sesiones SET customer_id = p_customer_id
         WHERE preregistro_id = p_id AND revocada_at IS NULL;
    ELSE
        RAISE EXCEPTION 'ACCION_INVALIDA';
    END IF;

    INSERT INTO public.audit_logs (user_id, action, target_id, details)
    VALUES (public.auth_employee_id(), 'app_preregistro_' || p_accion, p_id::text,
            jsonb_build_object('preregistro_id', p_id, 'customer_id', p_customer_id));
    RETURN json_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_preregistro_resolver(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_preregistro_resolver(uuid, text, bigint) TO authenticated, service_role;
