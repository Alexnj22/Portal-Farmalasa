SET lock_timeout = '5s';

-- Quién vio cada historia de la app (2026-10-06). Una fila por persona y
-- historia: con cuenta, por su ficha; sin cuenta (vitrina pública), por un
-- identificador aleatorio del teléfono, sin nombre. La escribe sólo
-- `app-clientes` (service_role); el portal la lee con el permiso del módulo.
CREATE TABLE public.app_historias_vistas (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    historia_id  uuid NOT NULL REFERENCES public.app_historias(id) ON DELETE CASCADE,
    customer_id  bigint REFERENCES public.customers(id) ON DELETE CASCADE,
    dispositivo  text CHECK (dispositivo IS NULL OR length(dispositivo) BETWEEN 8 AND 64),
    toco_boton   boolean NOT NULL DEFAULT false,
    visto_at     timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (customer_id IS NOT NULL OR dispositivo IS NOT NULL)
);
CREATE UNIQUE INDEX app_historias_vistas_cliente_uq ON public.app_historias_vistas (historia_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX app_historias_vistas_disp_uq ON public.app_historias_vistas (historia_id, dispositivo) WHERE customer_id IS NULL;
CREATE INDEX app_historias_vistas_customer_idx ON public.app_historias_vistas (customer_id);

ALTER TABLE public.app_historias_vistas ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_historias_vistas_select ON public.app_historias_vistas
    FOR SELECT TO authenticated USING ((SELECT public.auth_has_module_permission('ofertas_clientes', 'can_view')));

-- Anotar una vista (o que tocó el botón). Idempotente: la misma persona no
-- cuenta dos veces; tocar el botón sólo sube de false a true.
CREATE FUNCTION public.app_historia_registrar_vista(p_historia uuid, p_customer bigint, p_dispositivo text, p_boton boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions AS $$
BEGIN
  IF p_customer IS NOT NULL THEN
    INSERT INTO app_historias_vistas (historia_id, customer_id, toco_boton)
    VALUES (p_historia, p_customer, coalesce(p_boton, false))
    ON CONFLICT (historia_id, customer_id) WHERE customer_id IS NOT NULL
    DO UPDATE SET toco_boton = true WHERE EXCLUDED.toco_boton AND NOT app_historias_vistas.toco_boton;
  ELSIF p_dispositivo IS NOT NULL THEN
    INSERT INTO app_historias_vistas (historia_id, dispositivo, toco_boton)
    VALUES (p_historia, p_dispositivo, coalesce(p_boton, false))
    ON CONFLICT (historia_id, dispositivo) WHERE customer_id IS NULL
    DO UPDATE SET toco_boton = true WHERE EXCLUDED.toco_boton AND NOT app_historias_vistas.toco_boton;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_historia_registrar_vista(uuid, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_historia_registrar_vista(uuid, bigint, text, boolean) TO service_role;

-- Para el portal: por historia, cuántos la vieron y cuántos tocaron el botón.
CREATE FUNCTION public.app_historias_vistas_resumen()
RETURNS json LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions AS $$
  SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM (
    SELECT historia_id,
           count(*)::int AS vistas,
           count(customer_id)::int AS con_cuenta,
           (count(*) - count(customer_id))::int AS visitantes,
           count(*) FILTER (WHERE toco_boton)::int AS tocaron
    FROM app_historias_vistas GROUP BY historia_id
  ) t;
$$;
REVOKE EXECUTE ON FUNCTION public.app_historias_vistas_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_historias_vistas_resumen() TO authenticated, service_role;

-- La lista de quién la vio (clientes con cuenta; los visitantes sólo se
-- cuentan). DEFINER para leer el nombre de la ficha, con el permiso del
-- módulo comprobado adentro.
CREATE FUNCTION public.app_historia_quienes_vieron(p_historia uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.auth_has_module_permission('ofertas_clientes', 'can_view') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(json_agg(to_json(t)), '[]'::json) FROM (
    SELECT v.customer_id, c.name AS cliente, v.visto_at, v.toco_boton
    FROM app_historias_vistas v JOIN customers c ON c.id = v.customer_id
    WHERE v.historia_id = p_historia
    ORDER BY v.visto_at DESC
    LIMIT 500
  ) t);
END $$;
REVOKE EXECUTE ON FUNCTION public.app_historia_quienes_vieron(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_historia_quienes_vieron(uuid) TO authenticated, service_role;
